/**
 * videoIntelligence.ts
 *
 * Sends a video to Google Gemini and returns a text analysis of its content
 * (visuals, on-screen text, topics, tone, summary).
 *
 * Uses the platform GEMINI_API_KEY — no per-user key needed.
 * Records a UsageEvent per run so each org is billed for their usage.
 *
 * Flow: upload to Gemini File API → poll until ACTIVE → generateContent → return text
 *
 * Model selection: tries the configured model first, then falls through the
 * preference list until one succeeds. The working model is cached per process.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server'
import { isS3Mode, downloadBuffer } from '@contentnode/storage'
import { usageEventService } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')

// Cost per second of video by model (USD) — approximate Gemini pricing
const COST_PER_SECOND: Record<string, number> = {
  'gemini-2.5-flash':          0.00015,
  'gemini-2.5-pro':            0.0015,
  'gemini-2.0-flash-lite-001': 0.00005,
  'gemini-flash-latest':       0.00015,
  'gemini-pro-latest':         0.0015,
  // legacy — kept for cost lookup on old runs
  'gemini-1.5-flash':          0.00004,
  'gemini-1.5-pro':            0.001,
}

// Ordered fallback list — first working model wins
const MODEL_FALLBACK = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash-lite-001',
  'gemini-flash-latest',
  'gemini-pro-latest',
]

const VALID_MODELS = new Set(MODEL_FALLBACK)

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4',
}

interface VideoRef { storageKey: string; filename?: string }

function extractVideoRef(input: unknown): VideoRef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return { storageKey: obj.storageKey, filename: typeof obj.filename === 'string' ? obj.filename : undefined }
  }
  return null
}

function parseDurationSecs(durationStr?: string): number {
  if (!durationStr) return 0
  return parseFloat(durationStr.replace('s', '')) || 0
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

// Models confirmed not callable even when listed by ListModels
const MODEL_BLOCKLIST = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-001'])

function isModelUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('404') || msg.includes('not found') || msg.includes('no longer available')
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('503') || msg.includes('high demand') || msg.includes('try again later') || msg.includes('overloaded')
}

// Cached per worker process — set once the first successful model is found
let cachedWorkingModel: string | null = null

async function getModelsToTry(preferredModel: string, apiKey: string): Promise<string[]> {
  if (cachedWorkingModel) return [cachedWorkingModel]

  // Ask the API what's actually available under this key
  try {
    const res = await fetch(`${GEMINI_BASE}/v1beta/models?key=${apiKey}&pageSize=200`)
    const data = await res.json() as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>
    }
    const listed = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((m) => !MODEL_BLOCKLIST.has(m))

    console.log(`[video-intelligence] available models: ${listed.join(', ')}`)

    // Preferred first, then everything else listed
    return [preferredModel, ...listed.filter((m) => m !== preferredModel)]
  } catch {
    // ListModels failed — fall back to our standard list
    console.warn('[video-intelligence] ListModels failed, using default fallback list')
    return [preferredModel, ...MODEL_FALLBACK.filter((m) => m !== preferredModel)]
  }
}

async function generateContent(
  fileUri: string,
  mimeType: string,
  prompt: string,
  preferredModel: string,
  apiKey: string,
): Promise<{ text: string; model: string }> {
  const modelsToTry = await getModelsToTry(preferredModel, apiKey)
  const genAI = new GoogleGenerativeAI(apiKey)
  const errors: string[] = []

  for (const model of modelsToTry) {
    let lastErr: unknown
    // Retry up to 3 times on transient 503s before moving to next model
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[video-intelligence] trying: ${model}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
        const genModel = genAI.getGenerativeModel({ model })
        const result = await genModel.generateContent([
          { fileData: { mimeType, fileUri } },
          { text: prompt },
        ])
        const text = result.response.text()
        if (!text) throw new Error('empty response')
        cachedWorkingModel = model
        console.log(`[video-intelligence] success with: ${model}`)
        return { text, model }
      } catch (err) {
        lastErr = err
        if (isTransientError(err) && attempt < 3) {
          const delay = attempt * 4000
          console.warn(`[video-intelligence] ${model}: 503 overloaded, retrying in ${delay / 1000}s`)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        break
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    errors.push(`${model}: ${msg}`)
    if (isModelUnavailableError(lastErr)) {
      console.warn(`[video-intelligence] ${model}: unavailable, trying next`)
      continue
    }
    if (isTransientError(lastErr)) {
      console.warn(`[video-intelligence] ${model}: still overloaded after retries, trying next`)
      continue
    }
    throw lastErr
  }

  throw new Error(`No Gemini model succeeded.\n${errors.join('\n')}`)
}

export class VideoIntelligenceExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const apiKey = process.env.GEMINI_API_KEY ?? ''
    if (!apiKey) throw new Error('Video Intelligence: GEMINI_API_KEY is not set on the worker')

    const rawModel = (config.model as string) ?? ''
    const preferredModel = VALID_MODELS.has(rawModel) ? rawModel : 'gemini-2.5-flash'
    const prompt = (config.prompt as string) ??
      'Analyze this video and provide: (1) what it is about, (2) key topics and visuals, (3) any on-screen text or graphics, (4) the tone and purpose, (5) a 2–3 sentence summary for content planning.'

    const videoRef = extractVideoRef(input)
    if (!videoRef) {
      throw new Error('Video Intelligence: connect a Video Upload node to this node\'s input')
    }

    // Load video into buffer
    let videoBuffer: Buffer
    if (isS3Mode()) {
      videoBuffer = Buffer.from(await downloadBuffer(videoRef.storageKey))
    } else {
      videoBuffer = readFileSync(join(UPLOAD_DIR, videoRef.storageKey))
    }

    const ext = (videoRef.filename ?? videoRef.storageKey).split('.').pop()?.toLowerCase() ?? 'mp4'
    const mimeType = MIME_TYPES[ext] ?? 'video/mp4'
    const startMs = Date.now()

    const displayName = videoRef.filename ?? videoRef.storageKey
    console.log(`[video-intelligence] uploading ${displayName} (${Math.round(videoBuffer.length / 1024 / 1024)}MB) to Gemini`)

    // Write buffer to a temp file — GoogleAIFileManager requires a file path
    const tmpPath = join(tmpdir(), `contentnode_video_${randomUUID()}.${ext}`)
    writeFileSync(tmpPath, videoBuffer)

    // Fix MP4 files where moov atom is at end of file (common with screen recorders).
    // This remuxes without re-encoding and moves moov to front so Gemini can process it.
    let uploadPath = tmpPath
    const fixedPath = join(tmpdir(), `contentnode_video_fixed_${randomUUID()}.${ext}`)
    try {
      execSync(`ffmpeg -y -i "${tmpPath}" -c copy -movflags +faststart "${fixedPath}"`, { stdio: 'pipe', timeout: 120000 })
      uploadPath = fixedPath
      console.log(`[video-intelligence] remuxed with faststart`)
    } catch {
      // Remux failed — try uploading original and let Gemini surface the real error
    }

    let text: string
    let usedModel: string
    let videoSecs = 0

    try {
      const fileManager = new GoogleAIFileManager(apiKey)

      // Retry upload+poll up to 2 times — Gemini occasionally fails large file processing
      let file: Awaited<ReturnType<typeof fileManager.getFile>> | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        const uploadResult = await fileManager.uploadFile(uploadPath, {
          mimeType,
          displayName: 'contentnode_video',
        })
        console.log(`[video-intelligence] uploaded as ${uploadResult.file.name}, waiting for processing`)

        let f = uploadResult.file
        while (f.state === FileState.PROCESSING) {
          await new Promise((r) => setTimeout(r, 5000))
          f = await fileManager.getFile(f.name)
        }

        if (f.state === FileState.FAILED) {
          if (attempt < 2) {
            console.warn('[video-intelligence] file processing failed, re-uploading...')
            continue
          }
          throw new Error('Gemini File API: file processing failed after 2 attempts')
        }
        file = f
        break
      }
      if (!file) throw new Error('Gemini File API: file processing failed')

      // Parse video duration from metadata for cost tracking
      const durationStr = (file.videoMetadata as { videoDuration?: string } | undefined)?.videoDuration
      videoSecs = parseDurationSecs(durationStr)

      const result = await generateContent(file!.uri, mimeType, prompt, preferredModel, apiKey)
      text = result.text
      usedModel = result.model
      console.log(`[video-intelligence] done with ${usedModel} — ${videoSecs}s video`)

    } finally {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      try { if (existsSync(fixedPath)) unlinkSync(fixedPath) } catch { /* ignore */ }
    }

    const durationMs = Date.now() - startMs
    const costPerSec = COST_PER_SECOND[usedModel!] ?? 0.001
    const estimatedCostUsd = videoSecs > 0 ? videoSecs * costPerSec : videoBuffer.length / (1024 * 1024) * 0.01

    console.log(`[video-intelligence] ~$${estimatedCostUsd.toFixed(4)}`)

    usageEventService.record({
      agencyId:         ctx.agencyId,
      userId:           ctx.userId ?? undefined,
      userRole:         ctx.userRole ?? undefined,
      workflowId:       ctx.workflowId ?? undefined,
      workflowRunId:    ctx.workflowRunId,
      nodeId:           ctx.nodeId,
      nodeType:         'logic:video-intelligence',
      toolType:         'video',
      toolSubtype:      'video_intelligence',
      provider:         'gemini',
      model:            usedModel!,
      isOnline:         true,
      inputMediaCount:  1,
      estimatedCostUsd,
      durationMs,
      status:           'success',
    })

    return { output: text }
  }
}
