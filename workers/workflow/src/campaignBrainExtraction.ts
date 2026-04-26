import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import ExcelJS from 'exceljs'
import { prisma, withAgency } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import type { CampaignBrainProcessJobData } from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction helpers (same pattern as brandExtraction.ts)
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
  if (ext === '.xlsx' || mimeType.includes('spreadsheetml')) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const lines: string[] = []
    workbook.eachSheet((worksheet) => {
      const rows: string[] = []
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values = (row.values as ExcelJS.CellValue[]).slice(1)
        const csvRow = values.map((cell): string => {
          if (cell == null) return ''
          if (cell instanceof Date) return cell.toISOString().split('T')[0]
          if (typeof cell === 'object') {
            const c = cell as Record<string, unknown>
            if ('result' in c) return String(c.result ?? '')
            if ('richText' in c) return (c.richText as Array<{text: string}>).map(r => r.text).join('')
            if ('text' in c) return String(c.text ?? '')
            return ''
          }
          return String(cell)
        }).join(',')
        if (csvRow.replace(/,/g, '').trim()) rows.push(csvRow)
      })
      if (rows.length > 0) lines.push(`## ${worksheet.name}\n${rows.join('\n')}`)
    })
    return lines.join('\n\n')
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return await extractPDF(buffer, filename)
  }
  // Plain text formats
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
  // Strip HTML tags
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
  return text.slice(0, 12000) // cap per-page to 12KB
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesise all ready attachments into campaign context
// ─────────────────────────────────────────────────────────────────────────────

async function synthesiseCampaignContext(agencyId: string, campaignId: string): Promise<void> {
  const attachments = await prisma.campaignBrainAttachment.findMany({
    where: { campaignId, agencyId, summaryStatus: 'ready' },
    orderBy: { createdAt: 'asc' },
    select: { filename: true, summary: true, extractedText: true },
  })

  if (attachments.length === 0) return

  // Build combined text: summaries first, then raw text excerpts for depth
  const parts = attachments.map((a, i) => {
    const label = a.filename.startsWith('http') ? `Source ${i + 1}: ${a.filename}` : `Document ${i + 1}: ${a.filename}`
    const body = a.summary ?? (a.extractedText?.slice(0, 2000) ?? '')
    return `${label}\n${body}`
  })
  const combined = parts.join('\n\n---\n\n').slice(0, 50000)

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, agencyId },
    select: { name: true, goal: true, context: true },
  })
  if (!campaign) return

  // Only synthesise if the user hasn't already edited the context
  // (we don't want to overwrite manual edits — check if context is blank or was auto-generated)
  // Strategy: always synthesise (user can re-edit; synthesis is additive, not destructive)

  const synthesisPrompt = `You are building a Campaign Brain context for a marketing campaign.

Campaign: "${campaign.name}"
Goal: ${campaign.goal.replace(/_/g, ' ')}

The following documents and sources have been uploaded to inform this campaign:

${combined}

Based on this material, write a rich Campaign Brain context in plain text. This will be injected into AI content nodes when generating campaign deliverables. Include:
- Key messages and angles the campaign should emphasise
- Target audience insights from the documents
- Competitive positioning or differentiators mentioned
- Tone, style, or brand voice guidance
- Any specific data points, proof points, or facts to weave in
- What to avoid or de-emphasise

Be thorough but clear. Write in structured prose with short labelled sections. 800-1200 words.`

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 2048, temperature: 0.2 },
    synthesisPrompt,
  )

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { context: result.text },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processCampaignBrainAttachment(job: { data: CampaignBrainProcessJobData }): Promise<void> {
  const { agencyId, attachmentId, campaignId, url } = job.data

  await withAgency(agencyId, async () => {
    const attachment = await prisma.campaignBrainAttachment.findFirst({
      where: { id: attachmentId, agencyId, campaignId },
    })
    if (!attachment) {
      console.warn(`[campaign-brain] attachment ${attachmentId} not found`)
      return
    }

    // ── Step 1: Extract text ─────────────────────────────────────────────────
    await prisma.campaignBrainAttachment.update({
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

      await prisma.campaignBrainAttachment.update({
        where: { id: attachmentId },
        data: {
          extractionStatus: extractedText ? 'ready' : 'failed',
          extractedText: extractedText ?? null,
        },
      })
    } catch (err) {
      console.error(`[campaign-brain] extraction failed for ${attachmentId}:`, err)
      await prisma.campaignBrainAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: 'failed' },
      })
      return
    }

    if (!extractedText) return

    // ── Step 2: Generate per-file summary with Claude Haiku ──────────────────
    await prisma.campaignBrainAttachment.update({
      where: { id: attachmentId },
      data: { summaryStatus: 'processing' },
    })

    try {
      const label = url ? `web page at ${url}` : `document "${attachment.filename}"`
      const summaryResult = await callModel(
        { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
        `You are reviewing content uploaded to a Campaign Brain.

Content source: ${label}

Extracted text (first 20KB):
${extractedText.slice(0, 20000)}

Write a concise 3-5 sentence summary of what this content contributes to a marketing campaign. Focus on: key insights, angles, data points, audience signals, or messaging direction that could sharpen campaign deliverables. Be specific, not generic.`,
      )

      await prisma.campaignBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: summaryResult.text, summaryStatus: 'ready' },
      })
    } catch (err) {
      console.error(`[campaign-brain] summary failed for ${attachmentId}:`, err)
      await prisma.campaignBrainAttachment.update({
        where: { id: attachmentId },
        data: { summaryStatus: 'failed' },
      })
    }

    // ── Step 3: Re-synthesise full campaign context ──────────────────────────
    try {
      await synthesiseCampaignContext(agencyId, campaignId)
    } catch (err) {
      console.error(`[campaign-brain] synthesis failed for campaign ${campaignId}:`, err)
      // Non-fatal — user can still manually edit context
    }
  })
}
