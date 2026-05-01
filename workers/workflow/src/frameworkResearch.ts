import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import ExcelJS from 'exceljs'
import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import type { FrameworkResearchJobData, AttachmentProcessJobData, ClientGtmUploadJobData } from './queues.js'

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

async function scrapeWebsite(url: string, maxPages = 10): Promise<string> {
  const strip = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 6000)

  const extractLinks = (html: string, base: string): string[] => {
    const hrefs: string[] = []
    const re = /href=["']([^"'#?]+)["']/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      try {
        const abs = new URL(m[1], base).href
        if (abs.startsWith(base.replace(/\/$/, ''))) hrefs.push(abs)
      } catch { /* invalid URL */ }
    }
    return hrefs
  }

  const origin = new URL(url).origin
  const visited = new Set<string>()
  const queue: string[] = [url, `${url.replace(/\/$/, '')}/services`, `${url.replace(/\/$/, '')}/solutions`, `${url.replace(/\/$/, '')}/about`]
  const texts: string[] = []

  for (const page of queue) {
    if (visited.has(page) || texts.length >= maxPages) break
    visited.add(page)
    try {
      const res = await fetch(page, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) continue
      const html = await res.text()
      const text = strip(html)
      if (text.length > 200) texts.push(`[${page}]\n${text}`)
      // BFS: add discovered links from same origin
      const links = extractLinks(html, origin).filter((l) => !visited.has(l))
      for (const link of links.slice(0, 5)) {
        if (!queue.includes(link)) queue.push(link)
      }
    } catch { /* skip unreachable pages */ }
  }
  return texts.join('\n\n---\n\n')
}

async function braveSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return ''
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&result_filter=web`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return ''
    const data = await res.json() as { web?: { results?: Array<{ title: string; description: string; url: string }> } }
    const results = data.web?.results ?? []
    return results.map((r) => `${r.title} — ${r.description} (${r.url})`).join('\n')
  } catch { return '' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude summarisation — condense raw text to GTM-relevant bullets
// ─────────────────────────────────────────────────────────────────────────────

async function summarise(rawText: string, sourceLabel: string, clientName: string, verticalName: string): Promise<string> {
  if (rawText.trim().length < 100) return rawText.trim()

  const truncated = rawText.slice(0, 28000)
  const { provider: rProv, model: rModel } = await getModelForRole('research_synthesis')
  const result = await callModel(
    {
      provider: rProv as 'anthropic' | 'openai' | 'ollama',
      model: rModel,
      api_key_ref: defaultApiKeyRefForProvider(rProv),
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
  const { agencyId, clientId, verticalId, websiteUrl, companyBrief, researchMode = 'established', mergeWithExisting = false } = job
  console.log(`[framework-research] starting for client=${clientId} mode=${researchMode} merge=${mergeWithExisting}`)

  await withAgency(agencyId, async () => {
    // Mark legacy research record as running (keeps researchReady/DraftButton working)
    await prisma.clientFrameworkResearch.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, status: 'running', websiteUrl: websiteUrl ?? null, companyBrief: companyBrief ?? null, sources: [] },
      update: { status: 'running', errorMessage: null, ...(websiteUrl ? { websiteUrl } : {}), ...(companyBrief ? { companyBrief } : {}) },
    })

    // Create versioned run record
    const runRecord = await prisma.clientFrameworkResearchRun.create({
      data: { agencyId, clientId, verticalId, status: 'running', researchMode },
    })

    const [client, vertical, existingResearch, existingFramework] = await Promise.all([
      prisma.client.findFirstOrThrow({ where: { id: clientId, agencyId }, select: { name: true, industry: true } }),
      prisma.vertical.findFirstOrThrow({ where: { id: verticalId, agencyId }, select: { name: true } }),
      prisma.clientFrameworkResearch.findUnique({
        where: { clientId_verticalId: { clientId, verticalId } },
        select: { websiteUrl: true, companyBrief: true },
      }),
      prisma.clientFramework.findUnique({
        where: { clientId_verticalId: { clientId, verticalId } },
        select: { data: true, primaryBriefId: true },
      }),
    ])

    // Resolve website URL: job data takes priority, then fall back to stored URL from prior research
    const resolvedWebsiteUrl = websiteUrl || existingResearch?.websiteUrl || null

    // Load brief library: company-level briefs + vertical primary brief
    let resolvedBrief = companyBrief || existingResearch?.companyBrief || null
    try {
      const briefParts: string[] = []
      const companyBriefs = await prisma.clientBrief.findMany({
        where: { agencyId, clientId, status: 'active', type: 'company' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { content: true },
      })
      if (companyBriefs[0]?.content) briefParts.push(`COMPANY BRIEF:\n${companyBriefs[0].content}`)

      const primaryBriefId = (existingFramework as { primaryBriefId?: string | null })?.primaryBriefId
      if (primaryBriefId) {
        const pb = await prisma.clientBrief.findFirst({
          where: { id: primaryBriefId, agencyId, clientId, status: 'active' },
          select: { content: true, type: true, name: true },
        })
        if (pb?.content) {
          briefParts.push(`${pb.type.toUpperCase().replace('_', ' ')} BRIEF (${pb.name}):\n${pb.content}`)
        }
      }

      if (briefParts.length > 0) resolvedBrief = briefParts.join('\n\n')
    } catch { /* non-fatal — fall back to legacy companyBrief */ }

    const contextParts: string[] = []
    const sources: DocumentSource[] = []

    // 0a. Company brief — what the client does in plain language (highest-signal context)
    if (resolvedBrief) {
      contextParts.push(`[COMPANY BRIEF — what this company does]\n${resolvedBrief}`)
    }

    // 0b. Existing framework data — what the strategist has already filled in
    if (existingFramework?.data) {
      const fw = existingFramework.data as Record<string, unknown>
      const fwParts: string[] = []
      const s01 = fw['s01'] as Record<string, string> | undefined
      const s02 = fw['s02'] as Record<string, unknown> | undefined
      const s05 = fw['s05'] as Record<string, unknown> | undefined
      const s06 = fw['s06'] as Record<string, unknown> | undefined
      if (s01?.positioningStatement) fwParts.push(`Positioning: ${s01.positioningStatement}`)
      if (s01?.whatIsNot) fwParts.push(`What we are NOT: ${s01.whatIsNot}`)
      if (s02?.industry) fwParts.push(`Target industry: ${s02.industry}`)
      if (s02?.companySize) fwParts.push(`Target company size: ${s02.companySize}`)
      if (s05) {
        const pillars = (s05['pillars'] as Array<{ pillar?: string; valueProp?: string }> | undefined) ?? []
        const pillarText = pillars.filter((p) => p.valueProp).map((p) => `${p.pillar ?? 'Pillar'}: ${p.valueProp}`).join('\n')
        if (pillarText) fwParts.push(`Service pillars:\n${pillarText}`)
      }
      if (s06) {
        const diffs = (s06['differentiators'] as Array<{ label?: string; position?: string }> | undefined) ?? []
        const diffText = diffs.filter((d) => d.label).map((d) => `${d.label}: ${d.position ?? ''}`).join('\n')
        if (diffText) fwParts.push(`Why us:\n${diffText}`)
      }
      if (fwParts.length > 0) {
        contextParts.push(`[EXISTING GTM FRAMEWORK — what the strategist has already defined]\n${fwParts.join('\n\n')}`)
      }
    }

    // 1. Agency brain (corporate identity)
    try {
      const agencyAttachments = await prisma.agencyBrainAttachment.findMany({
        where: { agencyId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        take: 10,
      })
      for (const a of agencyAttachments) {
        if (a.summary) {
          contextParts.push(`[AGENCY BRAIN — ${a.filename}]\n${a.summary}`)
          sources.push({ type: 'document', filename: a.filename, summary: a.summary.slice(0, 200) })
        }
      }
    } catch (err) { console.error('[framework-research] agency brain fetch failed:', err) }

    // 2. Client-vertical brain
    try {
      const verticalAttachments = await prisma.clientVerticalBrainAttachment.findMany({
        where: { agencyId, clientId, verticalId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        take: 15,
      })
      for (const a of verticalAttachments) {
        if (a.summary) {
          contextParts.push(`[VERTICAL BRAIN — ${a.filename}]\n${a.summary}`)
          sources.push({ type: 'document', filename: a.filename, summary: a.summary.slice(0, 200) })
        }
      }
    } catch (err) { console.error('[framework-research] vertical brain fetch failed:', err) }

    // 3. Full client brain (all sources)
    try {
      const clientAttachments = await prisma.clientBrainAttachment.findMany({
        where: { agencyId, clientId, summaryStatus: 'ready' },
        select: { filename: true, summary: true, source: true },
        take: 20,
      })
      for (const a of clientAttachments) {
        if (a.summary) {
          contextParts.push(`[CLIENT BRAIN (${a.source}) — ${a.filename}]\n${a.summary}`)
          sources.push({ type: 'document', filename: a.filename, summary: a.summary.slice(0, 200) })
        }
      }
    } catch (err) { console.error('[framework-research] client brain fetch failed:', err) }

    // 4. Framework attachments (Research & Supporting Files)
    try {
      const fwAttachments = await prisma.clientFrameworkAttachment.findMany({
        where: { agencyId, clientId, verticalId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        take: 15,
      })
      for (const a of fwAttachments) {
        if (a.summary) {
          contextParts.push(`[FRAMEWORK ATTACHMENT — ${a.filename}]\n${a.summary}`)
          sources.push({ type: 'document', filename: a.filename, summary: a.summary.slice(0, 200) })
        }
      }
    } catch (err) { console.error('[framework-research] framework attachments fetch failed:', err) }

    // 5. Company website BFS scrape
    if (resolvedWebsiteUrl) {
      try {
        const rawText = await scrapeWebsite(resolvedWebsiteUrl, 10)
        if (rawText.length > 200) {
          const summary = await summarise(rawText, resolvedWebsiteUrl, client.name, vertical.name)
          contextParts.push(`[WEBSITE — ${resolvedWebsiteUrl}]\n${summary}`)
          sources.push({ type: 'website', filename: resolvedWebsiteUrl, summary: summary.slice(0, 200) })
        }
      } catch (err) { console.error('[framework-research] website scrape failed:', err) }
    }

    // 6. Brave vertical stats
    if (researchMode === 'new_vertical') {
      const queries = [
        `${client.name} ${vertical.name} managed services`,
        `${vertical.name} IT managed services market statistics 2025`,
        `${vertical.name} IT buyer challenges pain points`,
        `${vertical.name} compliance regulatory requirements`,
      ]
      for (const q of queries) {
        try {
          const results = await braveSearch(q)
          if (results) {
            contextParts.push(`[VERTICAL MARKET RESEARCH — "${q}"]\n${results}`)
            sources.push({ type: 'website', filename: `Brave: ${q}`, summary: results.slice(0, 200) })
          }
        } catch { /* non-fatal */ }
      }
    }

    if (contextParts.length === 0 && !resolvedWebsiteUrl && !resolvedBrief) {
      await Promise.all([
        prisma.clientFrameworkResearch.update({
          where: { clientId_verticalId: { clientId, verticalId } },
          data: { status: 'failed', errorMessage: 'No research context available. Add brain attachments or a website URL.', researchedAt: new Date() },
        }),
        prisma.clientFrameworkResearchRun.update({
          where: { id: runRecord.id },
          data: { status: 'failed', errorMessage: 'No research context available.' },
        }),
      ])
      return
    }

    // Section-mapped synthesis
    const fullContext = contextParts.join('\n\n' + '─'.repeat(60) + '\n\n')
    const truncatedContext = fullContext.slice(0, 40000)

    let sectionResults: Record<string, string | null> = {}
    try {
      const { provider: rProv, model: rModel } = await getModelForRole('research_synthesis')
      const synthesis = await callModel(
        {
          provider: rProv as 'anthropic' | 'openai' | 'ollama',
          model: rModel,
          api_key_ref: defaultApiKeyRefForProvider(rProv),
          max_tokens: 4000,
          temperature: 0.2,
        },
        `You are a senior GTM strategist analyzing research to fill in a Go-to-Market Framework for a sales and marketing team.

CLIENT: ${client.name}${client.industry ? ` (${client.industry})` : ''}
VERTICAL BEING RESEARCHED: ${vertical.name}
WEBSITE: ${resolvedWebsiteUrl ?? 'not available'}
${resolvedBrief ? `COMPANY BRIEF: ${resolvedBrief}\n` : ''}MODE: ${researchMode === 'new_vertical' ? 'New market entry — client is expanding into this vertical' : 'Established vertical — client already operates here'}
GOAL: Extract intelligence that helps a strategist complete the 18-section GTM Framework for ${client.name} targeting the ${vertical.name} vertical.

RESEARCH CONTEXT:
${truncatedContext}

Based on this research, extract findings for each GTM Framework section below.
Output ONLY valid JSON — no markdown, no explanation, no code fences.
Return null for any section where the research contains insufficient data.

{
  "01": "Positioning signals: what the company does, what it is not, how it should be positioned in this vertical. Include any 'what we are not' signals.",
  "02": "ICP signals: target company size, buyer roles and titles, IT posture, compliance status, contract signals, geography.",
  "03": "Market pressures and statistics. Include any specific numbers, percentages, or dollar figures found WITH their sources and URLs.",
  "04": "Core challenge signals: what pain points drive buying decisions in this vertical. Include why they exist and business consequences.",
  "06": "Competitive differentiation signals: how the client stands out vs alternatives in this vertical.",
  "07": "Sub-segment vocabulary and buyer framing: specific language buyers in this vertical use, segment names, entry point signals.",
  "08": "Messaging signals: core narrative language, outcome language, value proposition signals from community or reviews.",
  "10": "Objection signals: common pushback buyers give in this vertical. Include any rebuttals found.",
  "12": "Competitor signals: who the alternatives are in this vertical, how they position, where they are weak.",
  "17": "Regulatory and compliance signals: frameworks, requirements, acronyms, enforcement bodies relevant to this vertical."
}`,
      )
      try {
        sectionResults = JSON.parse(synthesis.text.trim()) as Record<string, string | null>
      } catch {
        console.error('[framework-research] synthesis JSON parse failed, storing raw')
        sectionResults = { '01': synthesis.text }
      }
    } catch (err) {
      console.error('[framework-research] synthesis failed:', err)
    }

    // If merging: blend with prior run
    let mergedFromIds: string[] = []
    if (mergeWithExisting) {
      try {
        const priorRun = await prisma.clientFrameworkResearchRun.findFirst({
          where: { agencyId, clientId, verticalId, status: 'ready' },
          orderBy: { createdAt: 'desc' },
        })
        if (priorRun?.sectionResults) {
          mergedFromIds = [priorRun.id]
          const prior = priorRun.sectionResults as Record<string, string | null>
          for (const key of Object.keys(prior)) {
            if (!sectionResults[key]) sectionResults[key] = prior[key]
          }
        }
      } catch { /* non-fatal */ }
    }

    const now = new Date()
    await Promise.all([
      prisma.clientFrameworkResearchRun.update({
        where: { id: runRecord.id },
        data: {
          status: 'ready',
          sectionResults: sectionResults as object,
          sources: sources as object[],
          mergedFromIds,
          researchedAt: now,
        },
      }),
      prisma.clientFrameworkResearch.update({
        where: { clientId_verticalId: { clientId, verticalId } },
        data: {
          status: 'ready',
          sources: sources as object[],
          errorMessage: null,
          researchedAt: now,
        },
      }),
    ])

    console.log(`[framework-research] done for client=${clientId} — ${Object.keys(sectionResults).length} sections populated`)
  })
}

export async function processClientGtmUpload(job: ClientGtmUploadJobData): Promise<void> {
  const { agencyId, clientId, verticalId, uploadId } = job
  console.log(`[client-gtm-upload] processing upload=${uploadId}`)

  await withAgency(agencyId, async () => {
    const upload = await prisma.clientFrameworkUploadedGtm.findFirst({
      where: { id: uploadId, agencyId },
    })
    if (!upload) throw new Error(`Upload ${uploadId} not found`)

    try {
      const buffer = await downloadBuffer(upload.storageKey)
      const rawText = await extractText(buffer, upload.filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      if (!rawText || rawText.trim().length < 100) {
        await prisma.clientFrameworkUploadedGtm.update({
          where: { id: uploadId },
          data: { status: 'failed', errorMessage: 'Could not extract text from uploaded document.' },
        })
        return
      }

      // Map extracted text → 18 sections
      const { provider: rProv, model: rModel } = await getModelForRole('research_synthesis')
      const mappingResult = await callModel(
        {
          provider: rProv as 'anthropic' | 'openai' | 'ollama',
          model: rModel,
          api_key_ref: defaultApiKeyRefForProvider(rProv),
          max_tokens: 4000,
          temperature: 0.1,
        },
        `You are analyzing a client-provided GTM Framework document to extract its content section by section.

Extract the content for each of the 18 GTM Framework sections below.
Return ONLY valid JSON — no markdown, no code fences.
Use null for sections with no content found.

{
  "01": "content from Vertical Overview / Positioning section",
  "02": "content from Customer Definition / ICP / Target Profile section",
  "03": "content from Market Pressures / Statistics section",
  "04": "content from Core Challenges / Pain Points section",
  "05": "content from Solutions / Service Stack / Pillars section",
  "06": "content from Why [Company] / Differentiators section",
  "07": "content from Segments / Buyer Profiles section",
  "08": "content from Messaging Framework / Value Proposition section",
  "09": "content from Proof Points / Case Studies section",
  "10": "content from Objection Handling section",
  "11": "content from Brand Voice / Tone of Voice section",
  "12": "content from Competitive Differentiation section",
  "13": "content from Customer Quotes / Testimonials section",
  "14": "content from Campaign Themes / Asset Mapping section",
  "15": "content from FAQs section",
  "16": "content from Content Funnel / Buyer Journey section",
  "17": "content from Regulatory / Compliance section",
  "18": "content from CTAs / Next Steps / Contact section"
}

DOCUMENT CONTENT:
${rawText.slice(0, 35000)}`,
      )

      let extractedSections: Record<string, string | null> = {}
      try {
        extractedSections = JSON.parse(mappingResult.text.trim()) as Record<string, string | null>
      } catch {
        extractedSections = { '01': rawText.slice(0, 2000) }
      }

      // Compare against current framework + latest research run to generate conflict log
      const [framework, latestRun] = await Promise.all([
        prisma.clientFramework.findFirst({
          where: { clientId, verticalId, agencyId },
          select: { data: true },
        }),
        prisma.clientFrameworkResearchRun.findFirst({
          where: { agencyId, clientId, verticalId, status: 'ready' },
          orderBy: { createdAt: 'desc' },
          select: { sectionResults: true },
        }),
      ])

      const conflictLog: Array<{ sectionNum: string; clientClaim: string; researchFinds: string; recommendation: string }> = []
      const researchResults = (latestRun?.sectionResults ?? {}) as Record<string, string | null>

      // Generate conflict analysis using Claude
      if (Object.keys(researchResults).length > 0) {
        const conflictableSections = ['01', '02', '03', '04', '06', '07', '12']
        for (const sec of conflictableSections) {
          const clientText = extractedSections[sec]
          const researchText = researchResults[sec]
          if (!clientText || !researchText) continue

          try {
            const { provider: cProv, model: cModel } = await getModelForRole('research_synthesis')
            const conflictCheck = await callModel(
              {
                provider: cProv as 'anthropic' | 'openai' | 'ollama',
                model: cModel,
                api_key_ref: defaultApiKeyRefForProvider(cProv),
                max_tokens: 500,
                temperature: 0.1,
              },
              `You are comparing what a client claims about their market vs. what independent research shows.

SECTION: §${sec}

CLIENT'S VERSION:
${clientText.slice(0, 1500)}

INDEPENDENT RESEARCH:
${researchText.slice(0, 1500)}

If there is a meaningful conflict (not just different wording), return JSON:
{"conflict": true, "clientClaim": "brief summary of client's position", "researchFinds": "brief summary of what research shows", "recommendation": "which to trust and why"}

If no meaningful conflict, return: {"conflict": false}

Return ONLY valid JSON.`,
            )
            const parsed = JSON.parse(conflictCheck.text.trim()) as { conflict: boolean; clientClaim?: string; researchFinds?: string; recommendation?: string }
            if (parsed.conflict && parsed.clientClaim && parsed.researchFinds) {
              conflictLog.push({
                sectionNum: sec,
                clientClaim: parsed.clientClaim,
                researchFinds: parsed.researchFinds,
                recommendation: parsed.recommendation ?? '',
              })
            }
          } catch { /* non-fatal per section */ }
        }
      }

      await prisma.clientFrameworkUploadedGtm.update({
        where: { id: uploadId },
        data: {
          status: 'ready',
          extractedSections: extractedSections as object,
          conflictLog: conflictLog as object[],
          processedAt: new Date(),
          errorMessage: null,
        },
      })

      console.log(`[client-gtm-upload] done — upload=${uploadId} conflicts=${conflictLog.length}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await prisma.clientFrameworkUploadedGtm.update({
        where: { id: uploadId },
        data: { status: 'failed', errorMessage: msg },
      })
      throw err
    }
  })
}
