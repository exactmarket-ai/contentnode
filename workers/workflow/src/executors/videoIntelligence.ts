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
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isS3Mode, downloadBuffer } from '@contentnode/storage'
import { usageEventService } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

// Cost per second of video by model (USD) — approximate Gemini pricing
const COST_PER_SECOND: Record<string, number> = {
  'gemini-2.0-flash':            0.00006,
  'gemini-2.0-flash-lite':       0.00003,
  'gemini-1.5-flash':            0.00004,
  'gemini-1.5-flash-latest':     0.00004,
  'gemini-1.5-flash-8b':         0.00002,
  'gemini-1.5-pro':              0.001,
  'gemini-1.5-pro-latest':       0.001,
}

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

interface GeminiFile {
  name: string
  uri: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED'
  videoMetadata?: { videoDuration?: string }
}

async function uploadToGemini(videoBuffer: Buffer, mimeType: string, apiKey: string): Promise<GeminiFile> {
  // Initiate resumable upload
  const initRes = await fetch(
    `${GEMINI_BASE}/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(videoBuffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({ file: { displayName: 'contentnode_video' } }),
    }
  )
  const uploadUrl = initRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini File API: no upload URL in response')

  // Upload bytes
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(videoBuffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: videoBuffer,
  })
  const data = await uploadRes.json() as { file?: GeminiFile }
  if (!data.file?.name) throw new Error(`Gemini File API: upload failed — ${JSON.stringify(data)}`)
  return data.file
}

async function pollUntilActive(fileName: string, apiKey: string): Promise<GeminiFile> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const res = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`)
    const file = await res.json() as GeminiFile
    if (file.state === 'ACTIVE') return file
    if (file.state === 'FAILED') throw new Error('Gemini File API: file processing failed')
  }
  throw new Error('Gemini File API: timed out waiting for file to be ready (5 min)')
}

async function generateContent(fileUri: string, mimeType: string, prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `${GEMINI_BASE}/v1/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: prompt },
          ],
        }],
        generation_config: { max_output_tokens: 2048 },
      }),
    }
  )
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message: string }
  }
  if (data.error) throw new Error(`Gemini API error: ${data.error.message}`)
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini: no text in response')
  return text
}

function parseDurationSecs(videoDuration?: string): number {
  // Gemini returns duration as "Xs" e.g. "127.5s"
  if (!videoDuration) return 0
  return parseFloat(videoDuration.replace('s', '')) || 0
}

export class VideoIntelligenceExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const apiKey = process.env.GEMINI_API_KEY ?? ''
    if (!apiKey) throw new Error('Video Intelligence: GEMINI_API_KEY is not set on the worker')

    const model = (config.model as string) ?? 'gemini-2.0-flash'
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

    console.log(`[video-intelligence] uploading ${videoRef.filename ?? videoRef.storageKey} (${Math.round(videoBuffer.length / 1024 / 1024)}MB) to Gemini`)

    // Upload → poll → generate
    const uploadedFile = await uploadToGemini(videoBuffer, mimeType, apiKey)
    console.log(`[video-intelligence] uploaded as ${uploadedFile.name}, waiting for processing`)

    const activeFile = await pollUntilActive(uploadedFile.name, apiKey)
    console.log(`[video-intelligence] file active, generating content with ${model}`)

    const text = await generateContent(activeFile.uri, mimeType, prompt, model, apiKey)
    const durationMs = Date.now() - startMs

    // Parse video duration from Gemini metadata for accurate cost tracking
    const videoSecs = parseDurationSecs(activeFile.videoMetadata?.videoDuration)
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
