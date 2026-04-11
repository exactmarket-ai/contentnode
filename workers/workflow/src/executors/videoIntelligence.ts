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
 * Model discovery: on first run, calls ListModels to find what's actually available
 * under this API key, then picks the best video-capable model. Cached per process.
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
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

// Cost per second of video by model (USD) — approximate Gemini pricing
const COST_PER_SECOND: Record<string, number> = {
  'gemini-1.5-flash':     0.00004,
  'gemini-1.5-flash-001': 0.00004,
  'gemini-1.5-flash-002': 0.00004,
  'gemini-1.5-flash-8b':  0.00002,
  'gemini-1.5-pro':       0.001,
  'gemini-1.5-pro-001':   0.001,
  'gemini-1.5-pro-002':   0.001,
  'gemini-2.0-flash':     0.00006,
  'gemini-2.0-flash-exp': 0.00006,
}

// Ordered preference — first match wins
const MODEL_PREFERENCE = [
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro-002',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
]

const VALID_MODELS = new Set(MODEL_PREFERENCE)

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

// Module-level cache — discovered once per worker process start
let resolvedModel: string | null = null

async function discoverModel(preferredModel: string, apiKey: string): Promise<string> {
  if (resolvedModel) return resolvedModel

  try {
    const res = await fetch(`${GEMINI_BASE}/v1beta/models?key=${apiKey}&pageSize=100`)
    const data = await res.json() as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>
    }
    const available = new Set(
      (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace('models/', ''))
    )
    console.log(`[video-intelligence] available models: ${[...available].join(', ')}`)

    // Use preferred if available, otherwise fall through preference list
    if (available.has(preferredModel)) {
      resolvedModel = preferredModel
    } else {
      for (const m of MODEL_PREFERENCE) {
        if (available.has(m)) { resolvedModel = m; break }
      }
    }
    if (!resolvedModel) {
      throw new Error(`No supported Gemini model found. Available: ${[...available].join(', ')}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('No supported')) throw err
    // ListModels failed — fall back to preferred and let generateContent surface any real error
    console.warn('[video-intelligence] ListModels failed, falling back to preferred model:', err)
    resolvedModel = preferredModel
  }

  console.log(`[video-intelligence] using model: ${resolvedModel}`)
  return resolvedModel
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

    // Discover which model is actually available under this API key
    const model = await discoverModel(preferredModel, apiKey)

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

      console.log(`[video-intelligence] file active, generating content with ${model}`)

      // Parse video duration from metadata for cost tracking
      const durationStr = (file.videoMetadata as { videoDuration?: string } | undefined)?.videoDuration
      videoSecs = parseDurationSecs(durationStr)

      const genAI = new GoogleGenerativeAI(apiKey)
      const genModel = genAI.getGenerativeModel({ model })

      const result = await genModel.generateContent([
        { fileData: { mimeType, fileUri: file.uri } },
        { text: prompt },
      ])

      text = result.response.text()
      if (!text) throw new Error('Gemini: no text in response')

    } finally {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
    }

    const durationMs = Date.now() - startMs
    const costPerSec = COST_PER_SECOND[model] ?? 0.001
    const estimatedCostUsd = videoSecs > 0 ? videoSecs * costPerSec : videoBuffer.length / (1024 * 1024) * 0.01

    console.log(`[video-intelligence] done — ${videoSecs}s video, ~$${estimatedCostUsd.toFixed(4)}`)

    // Record usage for billing
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
      model,
      isOnline:         true,
      inputMediaCount:  1,
      estimatedCostUsd,
      durationMs,
      status:           'success',
    })

    return { output: text }
  }
}
