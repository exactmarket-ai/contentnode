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

const BRAND_EXTRACTION_SYSTEM_PROMPT = `You are a brand analyst. The user has uploaded brand-related documents. Extract and structure the brand profile from this content. Return only valid JSON matching this schema:

{
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
}

Return only JSON. No preamble, no explanation, no markdown code fences.`

async function runBrandExtraction(
  agencyId: string,
  clientId: string,
  verticalId: string | null,
): Promise<void> {
  await withAgency(agencyId, async () => {
    // Load all ready attachments for this client+vertical
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

    if (attachments.length === 0) return

    const combinedText = attachments
      .filter((a) => a.extractedText?.trim())
      .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n')

    if (!combinedText.trim()) return

    // Mark profile as extracting
    const existing = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })

    const profileData = {
      agencyId,
      clientId,
      verticalId: verticalId ?? null,
      extractionStatus: 'extracting',
      sourceText: combinedText.slice(0, 500_000),
    }

    if (existing) {
      await prisma.clientBrandProfile.update({
        where: { id: existing.id },
        data: profileData,
      })
    } else {
      await prisma.clientBrandProfile.create({ data: profileData })
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
          max_tokens: 2000,
          temperature: 0.1,
          system_prompt: BRAND_EXTRACTION_SYSTEM_PROMPT,
        },
        combinedText.slice(0, 50_000),
      )

      // Strip any markdown fences Claude might still add
      let raw = result.text.trim()
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }
      extractedJson = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      console.error('[brand-extraction] Claude call failed:', errorMessage)
    }

    // Update profile record
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    if (profile) {
      await prisma.clientBrandProfile.update({
        where: { id: profile.id },
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
// Main job handler
// ─────────────────────────────────────────────────────────────────────────────

export async function processBrandAttachment(job: BrandAttachmentProcessJobData): Promise<void> {
  const { agencyId, attachmentId, clientId, verticalId } = job
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
      },
    })

    // Whether or not this attachment succeeded, re-run the full brand extraction
    // using whatever ready attachments exist for this client+vertical
    if (extractedText !== null) {
      await runBrandExtraction(agencyId, clientId, verticalId)
    }
  })

  console.log(`[brand-attachment-process] done — attachment=${attachmentId}`)
}
