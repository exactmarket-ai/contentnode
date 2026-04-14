import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import * as XLSX from 'xlsx'
import { prisma, withAgency } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import type { ClientBrainProcessJobData } from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

async function extractPDF(buffer: Buffer, label: string): Promise<string> {
  const tmpPath = join(tmpdir(), `${randomUUID()}.pdf`)
  mkdirSync(tmpdir(), { recursive: true })
  writeFileSync(tmpPath, buffer)
  try {
    return await Promise.race([
      new Promise<string>((resolve, reject) => {
        const parser = new PDFParser(null, true)
        parser.on('pdfParser_dataReady', (data: { Pages: Array<{ Texts: Array<{ R: Array<{ T: string }> }> }> }) => {
          const pages = data.Pages ?? []
          const out = pages
            .map((p) =>
              (p.Texts ?? [])
                .map((t) => {
                  const raw = t.R?.[0]?.T ?? ''
                  try { return decodeURIComponent(raw) } catch { return raw }
                })
                .join(' ')
            )
            .join('\n\n')
          resolve(out)
        })
        parser.on('pdfParser_dataError', (err: Error | { parserError: Error }) => {
          reject(err instanceof Error ? err : err.parserError)
        })
        parser.loadPDF(tmpPath)
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`PDF parse timeout: ${label}`)), 20000)
      ),
    ])
  } finally {
    try { unlinkSync(tmpPath) } catch {}
  }
}

async function extractTextFromBuffer(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const ext = extname(filename).toLowerCase()
  if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  if (ext === '.xlsx' || ext === '.xls' ||
      mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const lines: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      if (csv.trim()) lines.push(`## ${sheetName}\n${csv}`)
    }
    return lines.join('\n\n')
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return await extractPDF(buffer, filename)
  }
  if (['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext) ||
      mimeType.startsWith('text/') || mimeType === 'application/json') {
    return buffer.toString('utf-8')
  }
  return null
}

async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ContentNodeBot/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const html = await res.text()
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
  return text.slice(0, 12000)
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesise all ready attachments into client brain context
// ─────────────────────────────────────────────────────────────────────────────

async function synthesiseClientContext(agencyId: string, clientId: string): Promise<void> {
  const attachments = await prisma.clientBrainAttachment.findMany({
    where: { clientId, agencyId, summaryStatus: 'ready' },
    orderBy: { createdAt: 'asc' },
    select: { filename: true, summary: true, extractedText: true },
  })

  if (attachments.length === 0) return

  const parts = attachments.map((a, i) => {
    const label = a.filename.startsWith('http') ? `Source ${i + 1}: ${a.filename}` : `Document ${i + 1}: ${a.filename}`
    const body = a.summary ?? (a.extractedText?.slice(0, 2000) ?? '')
    return `${label}\n${body}`
  })
  const combined = parts.join('\n\n---\n\n').slice(0, 50000)

  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId },
    select: { name: true, industry: true },
  })
  if (!client) return

  const synthesisPrompt = `You are building a Client Brain context for a marketing agency client.

Client: "${client.name}"${client.industry ? `\nIndustry: ${client.industry}` : ''}

The following documents and sources have been uploaded to inform all content work for this client:

${combined}

Based on this material, write a rich Client Brain context in plain text. This will be injected into AI content nodes when generating any deliverable for this client. Include:
- Who this client is and what they do
- Their target audience and key buyer personas
- Core messaging, value propositions, and differentiators
- Brand voice and tone guidance
- Important proof points, data, or case studies
- What to avoid or de-emphasise in content

Be thorough but clear. Write in structured prose with short labelled sections. 800-1200 words.`

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 2048, temperature: 0.2 },
    synthesisPrompt,
  )

  await prisma.client.update({
    where: { id: clientId },
    data: { brainContext: result.text },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processClientBrainAttachment(job: { data: ClientBrainProcessJobData }): Promise<void> {
  const { agencyId, attachmentId, clientId, url } = job.data

  await withAgency(agencyId, async () => {
    const attachment = await prisma.clientBrainAttachment.findFirst({
      where: { id: attachmentId, agencyId, clientId },
    })
    if (!attachment) {
      console.warn(`[client-brain] attachment ${attachmentId} not found`)
      return
    }

    // ── Step 1: Extract text ─────────────────────────────────────────────────
    await prisma.clientBrainAttachment.update({
      where: { id: attachmentId },
      data: { extractionStatus: 'processing' },
    })

    let extractedText: string | null = null
    try {
      if (url) {
        extractedText = await fetchUrlText(url)
      } else if (attachment.storageKey) {
        const buffer = await downloadBuffer(attachment.storageKey)
        extractedText = await extractTextFromBuffer(buffer, attachment.filename, attachment.mimeType)
      }

      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: {
          extractionStatus: extractedText ? 'ready' : 'failed',
          extractedText: extractedText ?? null,
        },
      })
    } catch (err) {
      console.error(`[client-brain] extraction failed for ${attachmentId}:`, err)
      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: 'failed' },
      })
      return
    }

    if (!extractedText) return

    // ── Step 2: Generate per-file summary with Claude Haiku ──────────────────
    await prisma.clientBrainAttachment.update({
      where: { id: attachmentId },
      data: { summaryStatus: 'processing' },
    })

    try {
      const label = url ? `web page at ${url}` : `document "${attachment.filename}"`
      const summaryResult = await callModel(
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
        `You are reviewing content uploaded to a Client Brain for a marketing agency.

Content source: ${label}

Extracted text (first 20KB):
${extractedText.slice(0, 20000)}

Write a concise 3-5 sentence summary of what this content contributes to understanding this client. Focus on: key insights about the client's business, audience, messaging, voice, differentiators, or any context that would sharpen content deliverables. Be specific, not generic.`,
      )

      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: summaryResult.text, summaryStatus: 'ready' },
      })
    } catch (err) {
      console.error(`[client-brain] summary failed for ${attachmentId}:`, err)
      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: { summaryStatus: 'failed' },
      })
    }

    // ── Step 3: Re-synthesise full client context ────────────────────────────
    try {
      await synthesiseClientContext(agencyId, clientId)
    } catch (err) {
      console.error(`[client-brain] synthesis failed for client ${clientId}:`, err)
    }
  })
}
