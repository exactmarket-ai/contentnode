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

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
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
  'gemini-1.5-flash':     0.00004,
  'gemini-1.5-flash-001': 0.00004,
  'gemini-1.5-flash-002': 0.00004,
  'gemini-1.5-flash-8b':  0.00002,
  'gemini-1.5-pro':       0.001,
  'gemini-1.5-pro-001':   0.001,
  'gemini-1.5-pro-002':   0.001,
}

// Ordered fallback list — first working model wins
const MODEL_FALLBACK = [
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro-002',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro',
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
    try {
      console.log(`[video-intelligence] trying: ${model}`)
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
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${model}: ${msg}`)
      if (isModelUnavailableError(err)) {
        console.warn(`[video-intelligence] ${model}: unavailable, trying next`)
        continue
      }
      throw err
    }
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
    const preferredModel = VALID_MODELS.has(rawModel) ? rawModel : 'gemini-1.5-flash-002'
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

    let text: string
    let usedModel: string
    let videoSecs = 0

    try {
      const fileManager = new GoogleAIFileManager(apiKey)

      const uploadResult = await fileManager.uploadFile(tmpPath, {
        mimeType,
        displayName: 'contentnode_video',
      })

      console.log(`[video-intelligence] uploaded as ${uploadResult.file.name}, waiting for processing`)

      // Poll until ACTIVE
      let file = uploadResult.file
      while (file.state === FileState.PROCESSING) {
        await new Promise((r) => setTimeout(r, 5000))
        file = await fileManager.getFile(file.name)
      }

      if (file.state === FileState.FAILED) {
        throw new Error('Gemini File API: file processing failed')
      }

      // Parse video duration from metadata for cost tracking
      const durationStr = (file.videoMetadata as { videoDuration?: string } | undefined)?.videoDuration
      videoSecs = parseDurationSecs(durationStr)

      const result = await generateContent(file.uri, mimeType, prompt, preferredModel, apiKey)
      text = result.text
      usedModel = result.model
      console.log(`[video-intelligence] done with ${usedModel} — ${videoSecs}s video`)

    } finally {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
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
