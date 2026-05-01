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
import type {
  ClientBrainProcessJobData,
  AgencyBrainProcessJobData,
  VerticalBrainProcessJobData,
  ClientVerticalBrainProcessJobData,
} from './queues.js'

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
  if (['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext) ||
      mimeType.startsWith('text/') || mimeType === 'application/json') {
    return buffer.toString('utf-8')
  }
  return null
}

export async function fetchUrlText(url: string): Promise<string> {
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

export async function synthesiseClientContext(agencyId: string, clientId: string): Promise<void> {
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
// Agency brain synthesis — rebuilds Agency.brainContext from all ready attachments
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesiseAgencyContext(agencyId: string): Promise<void> {
  const attachments = await prisma.agencyBrainAttachment.findMany({
    where: { agencyId, summaryStatus: 'ready' },
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

  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } })
  if (!agency) return

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 2048, temperature: 0.2 },
    `You are building an Agency Brain context for an AI-powered marketing agency.

Agency: "${agency.name}"

The following documents have been uploaded to define this agency's identity, methodology, and expertise:

${combined}

Write a rich Agency Brain context in plain text. This will be injected into every AI content workflow this agency runs, regardless of client. Include:
- Who this agency is and their specialisms
- Their content methodology, frameworks, and creative philosophy
- Their voice principles and what "good work" looks like to them
- Key differentiators vs. generic AI-generated content
- Any standing instructions that should always influence output

Be thorough but clear. Write in structured prose with short labelled sections. 800-1200 words.`,
  )

  await prisma.agency.update({ where: { id: agencyId }, data: { brainContext: result.text } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical brain synthesis — rebuilds Vertical.brainContext from all ready attachments
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesiseVerticalContext(agencyId: string, verticalId: string): Promise<void> {
  const attachments = await prisma.verticalBrainAttachment.findMany({
    where: { agencyId, verticalId, summaryStatus: 'ready' },
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

  const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } })
  if (!vertical) return

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 2048, temperature: 0.2 },
    `You are building a Vertical Brain context for the "${vertical.name}" industry vertical at a marketing agency.

The following documents contain industry research, trends, news, and intelligence for this vertical:

${combined}

Write a rich Vertical Brain context in plain text. This will be injected into AI content workflows that target this vertical, shared across all clients in this space. Include:
- State of the industry — key trends, pressures, and tailwinds
- Audience dynamics — how buyers in this vertical think and decide
- Language and vocabulary — what resonates vs. what sounds generic
- Competitive landscape themes — patterns worth knowing about
- Content opportunities — what angles are working in this vertical right now
- What to avoid — common mistakes in content aimed at this audience

Be thorough but clear. Write in structured prose with short labelled sections. 800-1200 words.`,
  )

  await prisma.vertical.update({ where: { id: verticalId }, data: { brainContext: result.text } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Layered context assembly — called at workflow run time
// Pulls from all four tiers and returns a formatted context string
// ─────────────────────────────────────────────────────────────────────────────

export async function assembleLayeredContext(
  agencyId: string,
  clientId: string | null | undefined,
  verticalId: string | null | undefined,
): Promise<string> {
  const sections: string[] = []

  await withAgency(agencyId, async () => {
    // ── Tier 1: Agency Brain ─────────────────────────────────────────────────
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, brainContext: true },
    })
    if (agency?.brainContext) {
      sections.push(`# Agency Brain — ${agency.name}\n\n${agency.brainContext}`)
    }

    // ── Tier 2: Vertical Brain ───────────────────────────────────────────────
    if (verticalId) {
      const vertical = await prisma.vertical.findFirst({
        where: { id: verticalId, agencyId },
        select: { name: true, brainContext: true },
      })
      if (vertical?.brainContext) {
        sections.push(`# Vertical Brain — ${vertical.name}\n\n${vertical.brainContext}`)
      }
    }

    // ── Tier 3: Client Brain ─────────────────────────────────────────────────
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: { name: true, brainContext: true },
      })
      if (client?.brainContext) {
        sections.push(`# Client Brain — ${client.name}\n\n${client.brainContext}`)
      }

      // ── Tier 4: Client × Vertical Brain ───────────────────────────────────
      if (verticalId) {
        const cvDocs = await prisma.clientVerticalBrainAttachment.findMany({
          where: { agencyId, clientId, verticalId, summaryStatus: 'ready' },
          orderBy: { createdAt: 'asc' },
          select: { filename: true, summary: true, sourceUrl: true },
        })
        if (cvDocs.length > 0) {
          const vertical = await prisma.vertical.findFirst({
            where: { id: verticalId, agencyId },
            select: { name: true },
          })
          const client2 = await prisma.client.findFirst({
            where: { id: clientId, agencyId },
            select: { name: true },
          })
          const label = `${client2?.name ?? clientId} × ${vertical?.name ?? verticalId}`
          const lines = cvDocs.map((d, i) => {
            const src = d.sourceUrl ?? d.filename
            return `## Source ${i + 1}: ${src}\n${d.summary ?? ''}`
          })
          sections.push(`# Client × Vertical Brain — ${label}\n\n${lines.join('\n\n')}`)
        }
      }
    }
  })

  return sections.join('\n\n---\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Thought Leader brain synthesis
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesiseThoughtLeaderContext(
  agencyId: string,
  clientId: string,
  leadershipMemberId: string,
): Promise<void> {
  const attachments = await prisma.thoughtLeaderBrainAttachment.findMany({
    where: { agencyId, leadershipMemberId },
    orderBy: { createdAt: 'asc' },
    select: { source: true, content: true, createdAt: true },
  })
  if (attachments.length === 0) return

  const member = await prisma.leadershipMember.findFirst({
    where: { id: leadershipMemberId, agencyId },
    select: { name: true, role: true },
  })
  if (!member) return

  const parts = attachments.map((a) => {
    const label = a.source.replace(/_/g, ' ').toUpperCase()
    return `[${label} — ${a.createdAt.toISOString().split('T')[0]}]\n${a.content}`
  })
  const combined = parts.join('\n\n---\n\n').slice(0, 50000)

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 1500, temperature: 0.3 },
    `You are building a voice and positioning profile for a thought leader.
This profile will be used to generate content that sounds authentically
like them — not a generic executive, not their company's marketing voice,
but specifically this person.

THOUGHT LEADER ATTACHMENTS (all signal sources, chronological):
${combined}

Synthesize everything above into a compiled voice profile. Cover:

1. VOICE AND STYLE
   How this person writes and speaks. Sentence length, vocabulary level,
   use of data vs narrative, formality level, how they open and close.
   Be specific — use examples from their actual content where available.

2. PERSPECTIVE AND WORLDVIEW
   What they believe about their industry. What conventional wisdom they
   reject. What they are willing to say that peers won't. What they
   consistently come back to.

3. SIGNATURE PATTERNS
   Topics they own. Stories or examples they return to. Frameworks or
   mental models they apply repeatedly.

4. HARD CONSTRAINTS
   Words, phrases, and approaches they would never use. Non-negotiable
   voice rules derived from their profile and edit history.

5. RECENT CONTEXT
   What they are actively thinking and posting about right now. Current
   preoccupations. Timely angles that would be authentic for them.

6. GENERATION GUIDANCE
   3-5 specific instructions for a content generator writing in this
   person's voice. E.g. "Always open with an observation, never a
   question." "Use short declarative sentences in the first paragraph."
   "Reference operational reality before strategy."

Keep the profile under 600 words. Be specific. Use their actual words
and topics as examples wherever the signal supports it.
Return the profile text only. No preamble, no headers.`,
  )

  await prisma.thoughtLeaderBrain.upsert({
    where: { leadershipMemberId },
    create: { agencyId, clientId, leadershipMemberId, context: result.text, lastSynthesisAt: new Date() },
    update: { context: result.text, lastSynthesisAt: new Date() },
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
        { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Agency brain job processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processAgencyBrainAttachment(job: { data: AgencyBrainProcessJobData }): Promise<void> {
  const { agencyId, attachmentId, url } = job.data

  await withAgency(agencyId, async () => {
    const attachment = await prisma.agencyBrainAttachment.findFirst({
      where: { id: attachmentId, agencyId },
    })
    if (!attachment) {
      console.warn(`[agency-brain] attachment ${attachmentId} not found`)
      return
    }

    await prisma.agencyBrainAttachment.update({
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
      await prisma.agencyBrainAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: extractedText ? 'ready' : 'failed', extractedText: extractedText ?? null },
      })
    } catch (err) {
      console.error(`[agency-brain] extraction failed for ${attachmentId}:`, err)
      await prisma.agencyBrainAttachment.update({ where: { id: attachmentId }, data: { extractionStatus: 'failed' } })
      return
    }

    if (!extractedText) return

    await prisma.agencyBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'processing' } })

    try {
      const label = url ? `web page at ${url}` : `document "${attachment.filename}"`
      const summaryResult = await callModel(
        { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
        `You are reviewing content uploaded to an Agency Brain for a marketing agency.

Content source: ${label}

Extracted text (first 20KB):
${extractedText.slice(0, 20000)}

Write a concise 3-5 sentence summary of what this content contributes to the agency's identity, methodology, expertise, or creative philosophy. Be specific, not generic.`,
      )
      await prisma.agencyBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: summaryResult.text, summaryStatus: 'ready' },
      })
    } catch (err) {
      console.error(`[agency-brain] summary failed for ${attachmentId}:`, err)
      await prisma.agencyBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'failed' } })
    }

    try {
      await synthesiseAgencyContext(agencyId)
    } catch (err) {
      console.error(`[agency-brain] synthesis failed for agency ${agencyId}:`, err)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical brain job processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processVerticalBrainAttachment(job: { data: VerticalBrainProcessJobData }): Promise<void> {
  const { agencyId, attachmentId, verticalId, url } = job.data

  await withAgency(agencyId, async () => {
    const attachment = await prisma.verticalBrainAttachment.findFirst({
      where: { id: attachmentId, agencyId, verticalId },
    })
    if (!attachment) {
      console.warn(`[vertical-brain] attachment ${attachmentId} not found`)
      return
    }

    await prisma.verticalBrainAttachment.update({
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
      await prisma.verticalBrainAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: extractedText ? 'ready' : 'failed', extractedText: extractedText ?? null },
      })
    } catch (err) {
      console.error(`[vertical-brain] extraction failed for ${attachmentId}:`, err)
      await prisma.verticalBrainAttachment.update({ where: { id: attachmentId }, data: { extractionStatus: 'failed' } })
      return
    }

    if (!extractedText) return

    await prisma.verticalBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'processing' } })

    try {
      const label = url ? `web page at ${url}` : `document "${attachment.filename}"`
      const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } })
      const summaryResult = await callModel(
        { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
        `You are reviewing content uploaded to a Vertical Brain for the "${vertical?.name ?? verticalId}" industry vertical at a marketing agency.

Content source: ${label}

Extracted text (first 20KB):
${extractedText.slice(0, 20000)}

Write a concise 3-5 sentence summary of what this content contributes to understanding this vertical. Focus on: industry trends, audience dynamics, competitive landscape, or content opportunities specific to this vertical. Be specific, not generic.`,
      )
      await prisma.verticalBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: summaryResult.text, summaryStatus: 'ready' },
      })
    } catch (err) {
      console.error(`[vertical-brain] summary failed for ${attachmentId}:`, err)
      await prisma.verticalBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'failed' } })
    }

    try {
      await synthesiseVerticalContext(agencyId, verticalId)
    } catch (err) {
      console.error(`[vertical-brain] synthesis failed for vertical ${verticalId}:`, err)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Client × Vertical brain job processor (extract + summarize; no parent synthesis)
// ─────────────────────────────────────────────────────────────────────────────

export async function processClientVerticalBrainAttachment(job: { data: ClientVerticalBrainProcessJobData }): Promise<void> {
  const { agencyId, attachmentId, clientId, verticalId, url } = job.data

  await withAgency(agencyId, async () => {
    const attachment = await prisma.clientVerticalBrainAttachment.findFirst({
      where: { id: attachmentId, agencyId, clientId, verticalId },
    })
    if (!attachment) {
      console.warn(`[client-vertical-brain] attachment ${attachmentId} not found`)
      return
    }

    await prisma.clientVerticalBrainAttachment.update({
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
      await prisma.clientVerticalBrainAttachment.update({
        where: { id: attachmentId },
        data: { extractionStatus: extractedText ? 'ready' : 'failed', extractedText: extractedText ?? null },
      })
    } catch (err) {
      console.error(`[client-vertical-brain] extraction failed for ${attachmentId}:`, err)
      await prisma.clientVerticalBrainAttachment.update({ where: { id: attachmentId }, data: { extractionStatus: 'failed' } })
      return
    }

    if (!extractedText) return

    await prisma.clientVerticalBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'processing' } })

    try {
      const label = url ? `web page at ${url}` : `document "${attachment.filename}"`
      const [client, vertical] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
        prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } }),
      ])
      const summaryResult = await callModel(
        { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 512, temperature: 0.1 },
        `You are reviewing content uploaded to a Client × Vertical Brain for "${client?.name ?? clientId}" in the "${vertical?.name ?? verticalId}" vertical at a marketing agency.

Content source: ${label}

Extracted text (first 20KB):
${extractedText.slice(0, 20000)}

Write a concise 3-5 sentence summary of what this content contributes to understanding this specific client in this specific vertical. Focus on: how this client operates in this vertical, their unique position, specific audience segments, or campaign insights that only apply to this vertical context. Be specific, not generic.`,
      )
      await prisma.clientVerticalBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: summaryResult.text, summaryStatus: 'ready' },
      })
    } catch (err) {
      console.error(`[client-vertical-brain] summary failed for ${attachmentId}:`, err)
      await prisma.clientVerticalBrainAttachment.update({ where: { id: attachmentId }, data: { summaryStatus: 'failed' } })
    }
  })
}
