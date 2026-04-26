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
import type { FrameworkResearchJobData, AttachmentProcessJobData } from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentSource {
  type: 'document' | 'audio' | 'website'
  filename: string
  summary: string
}

interface AssemblyAITranscript {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text?: string
  error?: string
  audio_duration?: number // seconds
}

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction
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
          const out = pages.map((p) =>
            (p.Texts ?? []).map((t) => {
              const raw = t.R?.[0]?.T ?? ''
              try { return decodeURIComponent(raw) } catch { return raw }
            }).join(' ')
          ).join('\n\n')
          resolve(out)
        })
        parser.on('pdfParser_dataError', (err: Error | { parserError: Error }) => {
          reject(err instanceof Error ? err : err.parserError)
        })
        parser.loadPDF(tmpPath)
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`PDF parse timeout: ${label}`)), 20000)),
    ])
  } finally {
    try { unlinkSync(tmpPath) } catch {}
  }
}

async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const ext = extname(filename).toLowerCase()
  if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  if (ext === '.pdf' || mimeType.includes('pdf')) {
    return extractPDF(buffer, filename)
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
  if (['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext)) {
    return buffer.toString('utf8')
  }
  return null // audio/video — handled separately
}

// ─────────────────────────────────────────────────────────────────────────────
// AssemblyAI transcription (buffer-based, no temp file needed for upload)
// ─────────────────────────────────────────────────────────────────────────────

async function transcribeAudio(buffer: Buffer, apiKey: string): Promise<{ text: string; durationSecs: number }> {
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
    body: buffer,
  })
  if (!uploadRes.ok) throw new Error(`AssemblyAI upload failed: ${uploadRes.status}`)
  const { upload_url } = (await uploadRes.json()) as { upload_url: string }

  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, speaker_labels: true }),
  })
  if (!transcriptRes.ok) throw new Error(`AssemblyAI request failed: ${transcriptRes.status}`)
  const { id } = (await transcriptRes.json()) as { id: string }

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    })
    const data = (await pollRes.json()) as AssemblyAITranscript
    if (data.status === 'completed') return { text: data.text ?? '', durationSecs: Math.round(data.audio_duration ?? 0) }
    if (data.status === 'error') throw new Error(`AssemblyAI error: ${data.error}`)
  }
  throw new Error('AssemblyAI timed out after 10 minutes')
}

// ─────────────────────────────────────────────────────────────────────────────
// Website scrape (basic — fetch home + /services or /solutions)
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeWebsite(url: string): Promise<string> {
  const strip = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8000)

  const pages = [url, `${url.replace(/\/$/, '')}/services`, `${url.replace(/\/$/, '')}/solutions`]
  const texts: string[] = []

  for (const page of pages) {
    try {
      const res = await fetch(page, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (res.ok) {
        const html = await res.text()
        const text = strip(html)
        if (text.length > 200) texts.push(`[${page}]\n${text}`)
      }
    } catch { /* skip unreachable pages */ }
  }
  return texts.join('\n\n---\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude summarisation — condense raw text to GTM-relevant bullets
// ─────────────────────────────────────────────────────────────────────────────

async function summarise(rawText: string, sourceLabel: string, clientName: string, verticalName: string): Promise<string> {
  if (rawText.trim().length < 100) return rawText.trim()

  const truncated = rawText.slice(0, 28000)
  const result = await callModel(
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      api_key_ref: 'ANTHROPIC_API_KEY',
      max_tokens: 1200,
      temperature: 0.2,
    },
    `You are analyzing a document to extract GTM (go-to-market) intelligence for a sales and marketing team.

CLIENT: ${clientName}
VERTICAL: ${verticalName}
SOURCE: ${sourceLabel}

Analyze this content and structure your findings by category with an importance rating.

Format each section EXACTLY like this (include the ## header and — importance tag):
## [Category Name] — High importance
- bullet
- bullet

## [Category Name] — Medium importance
- bullet

Only include these categories if relevant content exists:
- Services & Solutions Offered
- Target Markets & Buyer Profiles
- Value Propositions & Differentiators
- Core Pain Points Addressed
- Competitive Positioning
- Proof Points & Case Studies
- Brand Voice & Messaging Style
- Pricing & Packaging Signals
- Strategic Direction & Focus Areas
- Regulatory & Compliance Context
- Key Quotes & Language to Reuse

Rules:
- 3–6 bullets per section maximum
- Skip any section with no relevant content
- Be specific — use actual numbers, names, and phrases from the document
- Flag anything that sounds like a strategic direction or positioning shift

DOCUMENT:
${truncated}`,
  )
  return result.text
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-attachment processor — runs on upload, stores extracted text + summary
// ─────────────────────────────────────────────────────────────────────────────

export async function processAttachment(job: AttachmentProcessJobData): Promise<void> {
  const { agencyId, attachmentId, clientName, verticalName } = job
  console.log(`[attachment-process] processing attachment=${attachmentId}`)

  await withAgency(agencyId, async () => {
    await prisma.clientFrameworkAttachment.update({
      where: { id: attachmentId },
      data: { summaryStatus: 'processing' },
    })

    const att = await prisma.clientFrameworkAttachment.findFirst({
      where: { id: attachmentId, agencyId },
    })
    if (!att) throw new Error(`Attachment ${attachmentId} not found`)

    const apiKey = process.env.ASSEMBLYAI_API_KEY ?? ''
    let rawText: string | null = null

    try {
      // Reuse brand mirror's extracted text if available — avoids redundant download + extraction
      const brandMirror = await prisma.clientBrandAttachment.findFirst({
        where: { agencyId, storageKey: att.storageKey, extractedText: { not: null } },
        select: { extractedText: true },
      })
      if (brandMirror?.extractedText) {
        rawText = brandMirror.extractedText
        console.log(`[attachment-process] reusing brand mirror text for attachment=${attachmentId}`)
      }

      if (rawText === null) {
        const buffer = await downloadBuffer(att.storageKey)
        const isAudio = att.mimeType.startsWith('audio/') || att.mimeType.startsWith('video/')

        if (isAudio) {
          if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set')
          const { text, durationSecs } = await transcribeAudio(buffer, apiKey)
          rawText = text

          // Record AssemblyAI usage
          if (durationSecs > 0) {
            const now = new Date()
            await prisma.usageRecord.create({
              data: {
                agencyId,
                metric: 'assemblyai_seconds',
                quantity: durationSecs,
                periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
                periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
                metadata: { attachmentId, filename: att.filename, clientName, clientId: att.clientId } as object,
              },
            })
          }
        } else {
          rawText = await extractText(buffer, att.filename, att.mimeType)
        }
      }

      if (!rawText || rawText.trim().length < 20) {
        await prisma.clientFrameworkAttachment.update({
          where: { id: attachmentId },
          data: { summaryStatus: 'failed', errorMessage: 'Could not extract readable text from this file' },
        })
        return
      }

      const summary = await summarise(rawText, att.filename, clientName, verticalName)

      await prisma.clientFrameworkAttachment.update({
        where: { id: attachmentId },
        data: {
          summaryStatus: 'ready',
          extractedText: rawText.slice(0, 500_000), // cap at 500KB
          summary,
          errorMessage: null,
        },
      })
      console.log(`[attachment-process] done — attachment=${attachmentId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await prisma.clientFrameworkAttachment.update({
        where: { id: attachmentId },
        data: { summaryStatus: 'failed', errorMessage: msg },
      })
      throw err
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processor — assembles pre-computed per-file summaries + optional website
// ─────────────────────────────────────────────────────────────────────────────

export async function runFrameworkResearch(job: FrameworkResearchJobData): Promise<void> {
  const { agencyId, clientId, verticalId, websiteUrl } = job
  console.log(`[framework-research] starting website scrape for client=${clientId}`)

  if (!websiteUrl) {
    console.log('[framework-research] no website URL provided — nothing to do')
    return
  }

  await withAgency(agencyId, async () => {
    // Mark as running
    await prisma.clientFrameworkResearch.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, status: 'running', websiteUrl, sources: [] },
      update: { status: 'running', errorMessage: null, websiteUrl },
    })

    const [client, vertical] = await Promise.all([
      prisma.client.findFirstOrThrow({ where: { id: clientId, agencyId }, select: { name: true } }),
      prisma.vertical.findFirstOrThrow({ where: { id: verticalId, agencyId }, select: { name: true } }),
    ])

    let sources: DocumentSource[] = []
    try {
      const rawText = await scrapeWebsite(websiteUrl)
      if (rawText.length > 200) {
        const summary = await summarise(rawText, websiteUrl, client.name, vertical.name)
        sources = [{ type: 'website', filename: websiteUrl, summary }]
      }
    } catch (err) {
      console.error('[framework-research] website scrape failed:', err)
    }

    await prisma.clientFrameworkResearch.update({
      where: { clientId_verticalId: { clientId, verticalId } },
      data: {
        status: sources.length > 0 ? 'ready' : 'failed',
        sources: sources as object[],
        errorMessage: sources.length === 0 ? 'Could not extract content from the website.' : null,
        researchedAt: new Date(),
      },
    })

    console.log(`[framework-research] website scrape done for client=${clientId}`)
  })
}
