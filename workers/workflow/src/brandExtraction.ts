import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import { prisma, withAgency } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import type { BrandAttachmentProcessJobData } from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// JSON repair — recovers a partial brand JSON object when Claude's response
// was cut off mid-string due to a token limit or network issue.
// Closes any open string, then closes open objects/arrays in reverse order.
// ─────────────────────────────────────────────────────────────────────────────

function repairTruncatedJson(raw: string): Record<string, unknown> | null {
  try {
    let s = raw.trimEnd()

    // Close an open string if the last non-whitespace char suggests truncation
    const inString = (str: string) => {
      let open = false
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '"' && (i === 0 || str[i - 1] !== '\\')) open = !open
      }
      return open
    }
    if (inString(s)) s += '"'

    // Remove trailing comma before we close containers
    s = s.replace(/,\s*$/, '')

    // Count unclosed braces/brackets
    const stack: string[] = []
    let inStr = false
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' || ch === ']') stack.pop()
    }

    // Close them in reverse
    for (let i = stack.length - 1; i >= 0; i--) {
      s += stack[i] === '{' ? '}' : ']'
    }

    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction (mirrors frameworkResearch.ts)
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

async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const ext = extname(filename).toLowerCase()
  if (ext === '.docx' || mimeType.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  if (ext === '.pdf' || mimeType.includes('pdf')) {
    return extractPDF(buffer, filename)
  }
  if (['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext)) {
    return buffer.toString('utf8')
  }
  // Image files — return null; brand images can be uploaded but won't contribute text
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand JSON extraction via Claude
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_JSON_SCHEMA = `{
  "brand_name": "",
  "tagline": "",
  "mission": "",
  "vision": "",
  "values": [],
  "voice_and_tone": {
    "personality_traits": [],
    "writing_style": "",
    "vocabulary_to_use": [],
    "vocabulary_to_avoid": []
  },
  "visual_identity": {
    "primary_colors": [],
    "secondary_colors": [],
    "typography": "",
    "imagery_style": ""
  },
  "target_audience": {
    "primary": "",
    "secondary": "",
    "psychographics": []
  },
  "positioning": {
    "category": "",
    "differentiators": [],
    "competitive_context": ""
  },
  "messaging": {
    "core_message": "",
    "proof_points": [],
    "value_propositions": []
  },
  "do_not_use": []
}`

const BRAND_EXTRACTION_SYSTEM_PROMPT = `You are a brand analyst. The user has uploaded brand-related documents. Extract and structure the brand profile from this content. Return only valid JSON matching this schema:

${BRAND_JSON_SCHEMA}

Return only JSON. No preamble, no explanation, no markdown code fences.`

function buildVerticalExtractionPrompt(verticalName: string, baseBrandJson: string): string {
  return `You are a brand analyst. This brand has an established base profile shown below. The user has uploaded additional documents specific to the "${verticalName}" vertical.

Extract how this brand's voice, tone, messaging, and positioning adapts for the "${verticalName}" vertical. The result should represent how the brand expresses itself in this vertical context — inheriting the core identity but specialised for this vertical's audience, language, and goals.

Rules:
- Keep brand_name, tagline, mission, vision, and values from the base unless the vertical documents explicitly override them
- Adapt voice_and_tone, target_audience, positioning, and messaging to reflect the vertical's specific context
- Only add vocabulary_to_avoid or do_not_use terms that are specific to this vertical
- If a vertical document adds new information not in the base, include it

Base brand profile (JSON):
${baseBrandJson}

Return only valid JSON matching this schema. No preamble, no explanation, no markdown code fences:

${BRAND_JSON_SCHEMA}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Website scraping (fetches home + /about + /brand)
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeWebsiteForBrand(url: string): Promise<string> {
  const base = url.replace(/\/$/, '')
  const pages = [base, `${base}/about`, `${base}/about-us`, `${base}/brand`]

  const strip = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 10000)

  const texts: string[] = []
  for (const page of pages) {
    try {
      const res = await fetch(page, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (res.ok) {
        const text = strip(await res.text())
        if (text.length > 200) texts.push(`[${page}]\n${text}`)
      }
    } catch { /* skip unreachable pages */ }
  }
  return texts.join('\n\n---\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Core extraction — combines attachment text + website text → Claude JSON
// ─────────────────────────────────────────────────────────────────────────────

async function runBrandExtraction(
  agencyId: string,
  clientId: string,
  verticalId: string | null,
): Promise<void> {
  await withAgency(agencyId, async () => {
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
      select: { id: true, websiteUrl: true },
    })

    // Load all ready file attachments for this brain (general or vertical-specific)
    const attachments = await prisma.clientBrandAttachment.findMany({
      where: {
        clientId,
        agencyId,
        extractionStatus: 'ready',
        ...(verticalId ? { verticalId } : { verticalId: null }),
      },
      orderBy: { createdAt: 'asc' },
      select: { filename: true, extractedText: true },
    })

    const parts: string[] = attachments
      .filter((a) => a.extractedText?.trim())
      .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)

    // Scrape website if URL is set
    const websiteUrl = profile?.websiteUrl
    if (websiteUrl) {
      try {
        const scraped = await scrapeWebsiteForBrand(websiteUrl)
        if (scraped.trim()) parts.push(`--- Website: ${websiteUrl} ---\n${scraped}`)
      } catch (err) {
        console.error('[brand-extraction] website scrape failed:', err)
      }
    }

    if (parts.length === 0) return

    const combinedText = parts.join('\n\n')

    // For vertical extractions, load the main brand profile as base context
    let systemPrompt = BRAND_EXTRACTION_SYSTEM_PROMPT
    if (verticalId) {
      const vertical = await prisma.clientBrandVertical.findFirst({
        where: { id: verticalId, agencyId },
        select: { name: true },
      })
      const mainProfile = await prisma.clientBrandProfile.findFirst({
        where: { clientId, agencyId, verticalId: null },
        select: { editedJson: true, extractedJson: true },
      })
      const mainJson = mainProfile?.editedJson ?? mainProfile?.extractedJson
      if (vertical?.name && mainJson) {
        systemPrompt = buildVerticalExtractionPrompt(
          vertical.name,
          JSON.stringify(mainJson, null, 2),
        )
        console.log(`[brand-extraction] vertical "${vertical.name}" — using main brand as base context`)
      }
    }

    // Mark profile as extracting
    const upsertBase = { agencyId, clientId, verticalId: verticalId ?? null, extractionStatus: 'extracting', sourceText: combinedText.slice(0, 500_000) }
    if (profile) {
      await prisma.clientBrandProfile.update({ where: { id: profile.id }, data: upsertBase })
    } else {
      await prisma.clientBrandProfile.create({ data: upsertBase })
    }

    // Call Claude for structured brand JSON
    let extractedJson: Record<string, unknown> | null = null
    let errorMessage: string | null = null

    try {
      const result = await callModel(
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          api_key_ref: 'ANTHROPIC_API_KEY',
          max_tokens: 8192,
          temperature: 0.1,
          system_prompt: systemPrompt,
        },
        combinedText.slice(0, 50_000),
      )

      let raw = result.text.trim()
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }

      // If the response was truncated mid-JSON, attempt to close it gracefully
      // before parsing so we get a partial profile rather than a hard failure.
      try {
        extractedJson = JSON.parse(raw) as Record<string, unknown>
      } catch {
        const repaired = repairTruncatedJson(raw)
        if (repaired) {
          console.warn('[brand-extraction] JSON was truncated — used repaired partial response')
          extractedJson = repaired
        } else {
          throw new Error(`JSON parse failed and repair was not possible. Raw length: ${raw.length}`)
        }
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      console.error('[brand-extraction] Claude call failed:', errorMessage)
    }

    // Persist result
    const final = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    if (final) {
      await prisma.clientBrandProfile.update({
        where: { id: final.id },
        data: {
          extractionStatus: extractedJson ? 'ready' : 'failed',
          extractedJson: (extractedJson ?? undefined) as object | undefined,
          sourceText: combinedText.slice(0, 500_000),
          errorMessage,
        },
      })
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file Claude interpretation — what this file contributes to the brand
// ─────────────────────────────────────────────────────────────────────────────

const FILE_SUMMARY_SYSTEM_PROMPT = `You are a brand analyst. A document has been uploaded to build a client's brand profile.

Review the extracted content and write a concise 3-5 sentence interpretation:
1. What type of document this is and its purpose
2. The key brand attributes, voice characteristics, or guidelines it establishes
3. How this content will specifically shape the brand profile (tone, vocabulary, messaging, audience, etc.)

Be direct and specific. No preamble. Focus on what Claude will learn from this file.`

async function generateFileSummary(
  attachmentId: string,
  extractedText: string,
): Promise<void> {
  await prisma.clientBrandAttachment.update({
    where: { id: attachmentId },
    data: { summaryStatus: 'processing' },
  })

  let summary: string | null = null
  let summaryStatus = 'failed'

  try {
    const result = await callModel(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens: 512,
        temperature: 0.2,
        system_prompt: FILE_SUMMARY_SYSTEM_PROMPT,
      },
      extractedText.slice(0, 20_000),
    )
    summary = result.text.trim()
    summaryStatus = 'ready'
    console.log(`[brand-attachment-process] summary generated for ${attachmentId}`)
  } catch (err) {
    console.error(`[brand-attachment-process] summary generation failed for ${attachmentId}:`, err)
  }

  await prisma.clientBrandAttachment.update({
    where: { id: attachmentId },
    data: { summary, summaryStatus },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job handler
// ─────────────────────────────────────────────────────────────────────────────

export async function processBrandAttachment(job: BrandAttachmentProcessJobData): Promise<void> {
  const { agencyId, attachmentId, clientId, verticalId } = job

  // Website-scrape-only mode — no file to extract, just re-run full extraction
  // which will now include the websiteUrl stored on the profile
  if (!attachmentId) {
    console.log(`[brand-attachment-process] website scrape for client=${clientId}`)
    await runBrandExtraction(agencyId, clientId, verticalId)
    console.log(`[brand-attachment-process] website scrape done for client=${clientId}`)
    return
  }

  console.log(`[brand-attachment-process] processing attachment=${attachmentId}`)

  await withAgency(agencyId, async () => {
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, agencyId },
    })
    if (!attachment) {
      console.warn(`[brand-attachment-process] attachment ${attachmentId} not found`)
      return
    }

    // Mark as processing
    await prisma.clientBrandAttachment.update({
      where: { id: attachmentId },
      data: { extractionStatus: 'processing' },
    })

    let extractedText: string | null = null
    let errorMessage: string | null = null

    try {
      const buffer = await downloadBuffer(attachment.storageKey)
      extractedText = await extractText(buffer, attachment.filename, attachment.mimeType)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[brand-attachment-process] text extraction failed:`, errorMessage)
    }

    await prisma.clientBrandAttachment.update({
      where: { id: attachmentId },
      data: {
        extractionStatus: extractedText !== null ? 'ready' : 'failed',
        extractedText: extractedText?.slice(0, 500_000) ?? null,
        errorMessage,
        // Mark summary as failed if text extraction failed (nothing to summarise)
        ...(extractedText === null ? { summaryStatus: 'failed' } : {}),
      },
    })

    if (extractedText !== null) {
      // Generate per-file interpretation, then re-run the full brand JSON extraction
      await generateFileSummary(attachmentId, extractedText)
      await runBrandExtraction(agencyId, clientId, verticalId)
    }
  })

  console.log(`[brand-attachment-process] done — attachment=${attachmentId}`)
}
