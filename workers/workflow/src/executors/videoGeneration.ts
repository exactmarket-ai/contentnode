import { randomUUID, createHmac } from 'node:crypto'
import { saveGeneratedFile, downloadBuffer } from '@contentnode/storage'
import { callModel, type ImageInput } from '@contentnode/ai'
import { prisma, withAgency, usageEventService, costEstimator, type Prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult, type GeneratedAsset, asyncPoll } from './base.js'
import type { VideoPromptOutput } from './videoPromptBuilder.js'

const OFFLINE_VIDEO_PROVIDERS = new Set(['comfyui-animatediff', 'cogvideox', 'wan21'])

// ─────────────────────────────────────────────────────────────────────────────
// Service map — exact model/service used per provider (for pricing + tracking)
// ─────────────────────────────────────────────────────────────────────────────

interface VideoServiceInfo { costProvider: string; model: string; displayService: string }

const VIDEO_SERVICE_MAP: Record<string, VideoServiceInfo> = {
  runway:               { costProvider: 'runway',    model: 'gen3_alpha_turbo',        displayService: 'Runway Gen-3 Turbo' },
  kling:                { costProvider: 'kling',     model: 'kling-v1-6',              displayService: 'Kling v1.6' },
  luma:                 { costProvider: 'luma',      model: 'dream-machine',            displayService: 'Luma Dream Machine' },
  pika:                 { costProvider: 'pika',      model: 'pika-1.5',                displayService: 'Pika 1.5' },
  veo2:                 { costProvider: 'veo2',      model: 'veo-2',                   displayService: 'Google Veo 2' },
  'comfyui-animatediff':{ costProvider: '',          model: 'comfyui-animatediff',      displayService: 'ComfyUI AnimateDiff' },
  cogvideox:            { costProvider: '',          model: 'cogvideox',               displayService: 'CogVideoX' },
  wan21:                { costProvider: '',          model: 'wan21',                   displayService: 'Wan2.1' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

type Provider =
  | 'runway'
  | 'kling'
  | 'luma'
  | 'pika'
  | 'veo2'
  | 'comfyui-animatediff'
  | 'cogvideox'
  | 'wan21'

interface VideoGenerationConfig {
  provider: Provider
  duration_seconds?: number
  resolution?: '720p' | '1080p'
  fps?: 24 | 30
  camera_motion?: string
  motion_intensity?: 'low' | 'medium' | 'high'
  seed?: number | null
  start_frame?: string  // URL or base64 data URI for manual attachment
  end_frame?: string    // URL or base64 data URI (Kling / Luma only)
}

// ─────────────────────────────────────────────────────────────────────────────
// Input helpers
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_MERGE_SYSTEM_PROMPT = `You are an expert at writing prompts for AI video generation models.

Given a collection of inputs, synthesize a single coherent video generation prompt.

Return ONLY valid JSON:
{
  "positivePrompt": "detailed motion and scene description",
  "negativePrompt": "what to avoid",
  "durationSeconds": 5,
  "aspectRatio": "16:9",
  "cameraMotion": "static",
  "motionIntensity": "medium",
  "mode": "text-to-video",
  "referenceImageUrl": null
}

Rules: aspectRatio ∈ {1:1,16:9,9:16,4:3}, cameraMotion ∈ {static,pan-left,pan-right,zoom-in,zoom-out,dolly,orbit}, motionIntensity ∈ {low,medium,high}, durationSeconds 3-10, referenceImageUrl always null.`

const VIDEO_COMPOSE_SYSTEM_PROMPT = `You are an expert at writing prompts for AI video generation models.

You are given one or more REFERENCE IMAGES showing a scene, subjects, or composition that should be animated into a video.
Write a prompt that brings the scene to life with natural motion.

Return ONLY valid JSON:
{
  "positivePrompt": "detailed scene and motion description faithful to the reference images",
  "negativePrompt": "what to avoid",
  "durationSeconds": 5,
  "aspectRatio": "16:9",
  "cameraMotion": "static",
  "motionIntensity": "medium",
  "mode": "image-to-video",
  "referenceImageUrl": null
}

Rules: aspectRatio ∈ {1:1,16:9,9:16,4:3}, cameraMotion ∈ {static,pan-left,pan-right,zoom-in,zoom-out,dolly,orbit}, motionIntensity ∈ {low,medium,high}, durationSeconds 3-10, referenceImageUrl always null (the caller sets it).`

// Extract image asset refs from structured multi-inputs
interface AssetRef { storageKey: string; localPath: string }

function extractAssetRefs(input: unknown): AssetRef[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const obj = input as Record<string, unknown>
  if (!Array.isArray(obj.inputs)) return []
  const refs: AssetRef[] = []
  for (const item of obj.inputs as Record<string, unknown>[]) {
    const content = item.content as Record<string, unknown> | undefined
    if (!content) continue
    if (Array.isArray(content.assets)) {
      for (const a of content.assets as Record<string, unknown>[]) {
        const key = a.storageKey as string | undefined
        const path = a.localPath as string | undefined
        const type = a.type as string | undefined
        if (key && path && (type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(path))) {
          refs.push({ storageKey: key, localPath: path })
        }
      }
    }
    if (content.type === 'image' && content.localPath) {
      const path = content.localPath as string
      const key = (content.storageKey as string | undefined) ?? path.replace(/^\/files\//, '')
      refs.push({ storageKey: key, localPath: path })
    }
  }
  return refs
}

function detectMediaType(buf: Buffer): ImageInput['mediaType'] {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[6] === 0x57 && buf[7] === 0x45) return 'image/webp'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  return 'image/jpeg'
}

async function fetchImageInputs(refs: AssetRef[]): Promise<ImageInput[]> {
  const results: ImageInput[] = []
  for (const ref of refs.slice(0, 3)) { // cap at 3 for video (cost/speed)
    try {
      const buf = await downloadBuffer(ref.storageKey)
      results.push({ base64: buf.toString('base64'), mediaType: detectMediaType(buf) })
    } catch (err) {
      console.warn(`[videoGeneration] could not fetch reference ${ref.storageKey}:`, err)
    }
  }
  return results
}

async function extractVideoPrompt(input: unknown, cfg: VideoGenerationConfig, referenceImages: ImageInput[] = []): Promise<VideoPromptOutput> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    // VideoPromptOutput from Video Prompt Builder
    if (typeof obj.positivePrompt === 'string' && typeof obj.mode === 'string') {
      return obj as unknown as VideoPromptOutput
    }
    // Image Generation node output — auto-derive image-to-video
    if (Array.isArray(obj.assets) && obj.assets.length > 0) {
      const asset = obj.assets[0] as { localPath: string }
      const prompt = obj.prompt as Record<string, unknown> | undefined
      return {
        positivePrompt: typeof prompt?.positivePrompt === 'string'
          ? prompt.positivePrompt
          : 'Generate a cinematic video from the reference image',
        negativePrompt: '',
        durationSeconds: cfg.duration_seconds ?? 5,
        aspectRatio: '16:9',
        cameraMotion: (cfg.camera_motion as VideoPromptOutput['cameraMotion']) ?? 'static',
        motionIntensity: cfg.motion_intensity ?? 'medium',
        mode: 'image-to-video',
        referenceImageUrl: asset.localPath,
      }
    }
    // Structured multi-input: LLM merge, with vision if reference images provided
    if (Array.isArray(obj.inputs) || referenceImages.length > 0) {
      const hasRefs = referenceImages.length > 0
      // First image asset found becomes the start frame (localPath for providers)
      let referenceImageLocalPath: string | null = null
      if (Array.isArray(obj.inputs)) {
        for (const inp of obj.inputs as Array<{ nodeType?: string; content: unknown }>) {
          if (inp.nodeType === 'uploaded-reference') {
            const c = inp.content as { type?: string; localPath?: string }
            if (c.type === 'image' && c.localPath) { referenceImageLocalPath = c.localPath; break }
          }
          if (inp.content && typeof inp.content === 'object') {
            const c = inp.content as Record<string, unknown>
            if (Array.isArray(c.assets) && c.assets.length > 0) {
              const a = c.assets[0] as { localPath?: string }
              if (a.localPath) { referenceImageLocalPath = a.localPath; break }
            }
          }
        }
      }

      const textContext = Array.isArray(obj.inputs)
        ? `Inputs:\n${JSON.stringify(obj.inputs, null, 2)}`
        : 'Animate the reference image(s) into a video.'

      const result = await callModel(
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          api_key_ref: '',
          system_prompt: hasRefs ? VIDEO_COMPOSE_SYSTEM_PROMPT : VIDEO_MERGE_SYSTEM_PROMPT,
          temperature: 0.7,
          max_tokens: 512,
        },
        hasRefs
          ? `${referenceImages.length} reference image(s) attached. ${textContext}\n\nWrite a video prompt that animates this scene.`
          : `Synthesize a single coherent video generation prompt:\n\n${textContext}`,
        hasRefs ? referenceImages : undefined,
      )
      try {
        const cleaned = result.text.replace(/```(?:json)?/g, '').trim()
        const parsed = JSON.parse(cleaned) as VideoPromptOutput
        if (referenceImageLocalPath) {
          parsed.mode = 'image-to-video'
          parsed.referenceImageUrl = referenceImageLocalPath
        }
        return parsed
      } catch {
        throw new Error(`Video Generation: LLM merge returned invalid JSON: ${result.text.slice(0, 200)}`)
      }
    }
  }
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  return {
    positivePrompt: text,
    negativePrompt: '',
    durationSeconds: cfg.duration_seconds ?? 5,
    aspectRatio: '16:9',
    cameraMotion: (cfg.camera_motion as VideoPromptOutput['cameraMotion']) ?? 'static',
    motionIntensity: cfg.motion_intensity ?? 'medium',
    mode: cfg.start_frame ? 'image-to-video' : 'text-to-video',
    referenceImageUrl: cfg.start_frame ?? null,
  }
}

/**
 * Resolve any image reference (relative path, data URI, or URL) to a form
 * that external providers (Runway, Kling, etc.) can use as promptImage.
 *
 * Priority:
 *   1. Already an http(s) URL — use as-is
 *   2. Already a data URI — use as-is
 *   3. /files/... path + API_BASE_URL set — return public API URL (preferred;
 *      avoids large base64 payloads in the JSON request body)
 *   4. /files/... path — read from storage and return as base64 data URI
 */
async function resolveImageUrl(imageRef: string): Promise<string> {
  if (imageRef.startsWith('http')) return imageRef

  if (imageRef.startsWith('data:')) return imageRef

  if (imageRef.startsWith('/files/')) {
    // Prefer a publicly accessible URL — providers handle URLs more reliably
    // than multi-MB base64 payloads in JSON request bodies.
    const apiBase = process.env.API_BASE_URL
    if (apiBase) return `${apiBase}${imageRef}`

    // No public URL available — read from storage and encode as base64
    const storageKey = imageRef.replace(/^\/files\//, '')
    const buf = await downloadBuffer(storageKey)
    const mime = detectMediaType(buf)
    return `data:${mime};base64,${buf.toString('base64')}`
  }

  return imageRef
}

// ─────────────────────────────────────────────────────────────────────────────
// Save generated video to storage
// ─────────────────────────────────────────────────────────────────────────────

async function saveVideos(
  sources: (string | Buffer)[],
  provider: Provider,
): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = []
  for (const source of sources) {
    const filename = `${randomUUID()}.mp4`
    const storageKey = await saveGeneratedFile(source as string | Buffer, filename, 'video/mp4')
    assets.push({
      type: 'video',
      storageKey,
      localPath: `/files/${storageKey}`,
      provider,
      generatedAt: new Date().toISOString(),
    })
  }
  return assets
}

// ─────────────────────────────────────────────────────────────────────────────
// Runway Gen-3 Alpha
// ─────────────────────────────────────────────────────────────────────────────

async function generateRunway(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const apiKey = process.env.RUNWAY_API_KEY
  if (!apiKey) throw new Error('RUNWAY_API_KEY is not set')

  const duration = cfg.duration_seconds === 10 ? 10 : 5
  const ratio = prompt.aspectRatio === '9:16' ? '768:1280' : '1280:768'

  // Runway's image_to_video endpoint always requires promptImage
  const imageUrl = prompt.referenceImageUrl ?? cfg.start_frame ?? null
  if (!imageUrl) {
    throw new Error(
      'Runway requires a start frame image. ' +
      'Attach a Start Frame in the Video Generation node config, ' +
      'or connect an Image Generation node upstream.'
    )
  }

  const body: Record<string, unknown> = {
    model: 'gen3a_turbo',
    promptText: prompt.positivePrompt,
    promptImage: await resolveImageUrl(imageUrl),
    duration,
    ratio,
    watermark: false,
    ...(cfg.seed != null ? { seed: cfg.seed } : {}),
  }

  const submitRes = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Runway submit error: ${submitRes.status} ${err}`)
  }

  const { id } = await submitRes.json() as { id: string }

  const outputUrls = await asyncPoll({
    poll: async () => {
      const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
      })
      if (!res.ok) return null
      const task = await res.json() as { status: string; output?: string[]; failure?: string }
      if (task.status === 'SUCCEEDED') return task.output ?? []
      if (task.status === 'FAILED') throw new Error(`Runway generation failed: ${task.failure ?? 'unknown'}`)
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'Runway Gen-3 generation',
  })

  return outputUrls as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Kling AI
// ─────────────────────────────────────────────────────────────────────────────

function klingJWT(keyId: string, keySecret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: keyId, exp: now + 1800, nbf: now - 5 }
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const h = encode(header)
  const p = encode(payload)
  const sig = createHmac('sha256', keySecret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

async function generateKling(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const keyId = process.env.KLING_ACCESS_KEY_ID
  const keySecret = process.env.KLING_ACCESS_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('KLING_ACCESS_KEY_ID and KLING_ACCESS_KEY_SECRET are not set')

  const token = klingJWT(keyId, keySecret)
  const duration = String(cfg.duration_seconds === 10 ? 10 : 5)

  const isImg2Vid = prompt.mode === 'image-to-video' && prompt.referenceImageUrl
  const endpoint = isImg2Vid
    ? 'https://api.klingai.com/v1/videos/image2video'
    : 'https://api.klingai.com/v1/videos/text2video'

  const body: Record<string, unknown> = {
    model_name: 'kling-v1-6',
    prompt: prompt.positivePrompt,
    negative_prompt: prompt.negativePrompt || undefined,
    cfg_scale: 0.5,
    mode: 'std',
    duration,
    aspect_ratio: prompt.aspectRatio,
  }

  if (isImg2Vid) {
    body.image = await resolveImageUrl(prompt.referenceImageUrl!)
    if (cfg.end_frame) body.image_tail = await resolveImageUrl(cfg.end_frame)
  }

  const submitRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Kling submit error: ${submitRes.status} ${err}`)
  }

  const { data } = await submitRes.json() as { data: { task_id: string } }

  const pollBase = isImg2Vid
    ? `https://api.klingai.com/v1/videos/image2video/${data.task_id}`
    : `https://api.klingai.com/v1/videos/text2video/${data.task_id}`

  const videos = await asyncPoll({
    poll: async () => {
      const res = await fetch(pollBase, {
        headers: { Authorization: `Bearer ${klingJWT(keyId!, keySecret!)}` },
      })
      if (!res.ok) return null
      const result = await res.json() as {
        data: {
          task_status: string
          task_result?: { videos?: { url: string }[] }
          task_status_msg?: string
        }
      }
      const { task_status, task_result, task_status_msg } = result.data
      if (task_status === 'succeed') return task_result?.videos?.map((v) => v.url) ?? []
      if (task_status === 'failed') throw new Error(`Kling generation failed: ${task_status_msg ?? 'unknown'}`)
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'Kling AI generation',
  })

  return videos as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Luma Dream Machine
// ─────────────────────────────────────────────────────────────────────────────

async function generateLuma(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const apiKey = process.env.LUMAAI_API_KEY
  if (!apiKey) throw new Error('LUMAAI_API_KEY is not set')

  const body: Record<string, unknown> = {
    prompt: prompt.positivePrompt,
    aspect_ratio: prompt.aspectRatio,
    loop: false,
  }

  if (prompt.mode === 'image-to-video' && prompt.referenceImageUrl) {
    const keyframes: Record<string, unknown> = {
      frame0: { type: 'image', url: await resolveImageUrl(prompt.referenceImageUrl) },
    }
    if (cfg.end_frame) {
      keyframes.frame1 = { type: 'image', url: await resolveImageUrl(cfg.end_frame) }
    }
    body.keyframes = keyframes
  }

  const submitRes = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Luma submit error: ${submitRes.status} ${err}`)
  }

  const { id } = await submitRes.json() as { id: string }

  const videoUrl = await asyncPoll({
    poll: async () => {
      const res = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return null
      const gen = await res.json() as {
        state: string
        failure_reason?: string
        assets?: { video?: string }
      }
      if (gen.state === 'completed' && gen.assets?.video) return gen.assets.video
      if (gen.state === 'failed') throw new Error(`Luma generation failed: ${gen.failure_reason ?? 'unknown'}`)
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'Luma Dream Machine generation',
  })

  return [videoUrl as string]
}

// ─────────────────────────────────────────────────────────────────────────────
// Pika Labs
// ─────────────────────────────────────────────────────────────────────────────

function pikaCameraMotion(motion: string): { pan?: string; zoom?: string } {
  switch (motion) {
    case 'pan-left':  return { pan: 'left' }
    case 'pan-right': return { pan: 'right' }
    case 'zoom-in':   return { zoom: 'in' }
    case 'zoom-out':  return { zoom: 'out' }
    default:          return {}
  }
}

async function generatePika(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const apiKey = process.env.PIKA_API_KEY
  if (!apiKey) throw new Error('PIKA_API_KEY is not set')

  const camera = pikaCameraMotion(prompt.cameraMotion)
  const motionStrength = prompt.motionIntensity === 'high' ? 3 : prompt.motionIntensity === 'low' ? 1 : 2

  const body: Record<string, unknown> = {
    prompt_text: prompt.positivePrompt,
    negative_prompt: prompt.negativePrompt || undefined,
    options: {
      aspectRatio: prompt.aspectRatio,
      frameRate: cfg.fps ?? 24,
      camera: {
        pan: camera.pan ?? 'none',
        tilt: 'none',
        rotate: 'none',
        zoom: camera.zoom ?? 'none',
      },
      guidanceScale: 16,
      motion: motionStrength,
      ...(cfg.seed != null ? { seed: cfg.seed } : {}),
    },
  }

  if (prompt.mode === 'image-to-video' && prompt.referenceImageUrl) {
    body.image = await resolveImageUrl(prompt.referenceImageUrl)
  }

  const submitRes = await fetch('https://api.pika.art/v2/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Pika submit error: ${submitRes.status} ${err}`)
  }

  const { data: { task_id } } = await submitRes.json() as { data: { task_id: string } }

  const videoUrl = await asyncPoll({
    poll: async () => {
      const res = await fetch(`https://api.pika.art/v2/tasks/${task_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return null
      const result = await res.json() as {
        data: { status: string; videos?: { url: string }[] }
      }
      const { status, videos } = result.data
      if (status === 'completed' && videos?.[0]) return videos[0].url
      if (status === 'failed') throw new Error('Pika generation failed')
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'Pika Labs generation',
  })

  return [videoUrl as string]
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Veo 2 (via Vertex AI)
// ─────────────────────────────────────────────────────────────────────────────

async function generateVeo2(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const projectId = process.env.VERTEX_PROJECT_ID
  const location = process.env.VERTEX_LOCATION ?? 'us-central1'
  const bearerToken = process.env.GOOGLE_BEARER_TOKEN

  if (!projectId) throw new Error('VERTEX_PROJECT_ID is not set')
  if (!bearerToken) throw new Error('GOOGLE_BEARER_TOKEN is not set (run: gcloud auth print-access-token)')

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/veo-002:predict`

  const instance: Record<string, unknown> = { prompt: prompt.positivePrompt }
  if (prompt.mode === 'image-to-video' && prompt.referenceImageUrl) {
    const refUrl = await resolveImageUrl(prompt.referenceImageUrl)
    const imgRes = await fetch(refUrl)
    const imgBuf = Buffer.from(await imgRes.arrayBuffer())
    instance.image = { bytesBase64Encoded: imgBuf.toString('base64') }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: prompt.aspectRatio,
        durationSeconds: cfg.duration_seconds ?? 5,
        negativePrompt: prompt.negativePrompt || undefined,
        sampleCount: 1,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Veo 2 error: ${res.status} ${err}`)
  }

  const data = await res.json() as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[]
    error?: { message: string }
  }

  if (data.error) throw new Error(`Veo 2 error: ${data.error.message}`)
  if (!data.predictions?.length) throw new Error('Veo 2 returned no predictions')

  // Veo 2 returns base64-encoded video in predictions
  const buffers = data.predictions
    .filter((p) => p.bytesBase64Encoded)
    .map((p) => Buffer.from(p.bytesBase64Encoded!, 'base64'))

  // Save immediately and return storage keys as "URLs" (handled in saveVideos)
  const assets: string[] = []
  for (const buf of buffers) {
    const filename = `${randomUUID()}.mp4`
    const storageKey = await saveGeneratedFile(buf, filename, 'video/mp4')
    assets.push(`__stored__:${storageKey}`)
  }
  return assets
}

// ─────────────────────────────────────────────────────────────────────────────
// ComfyUI + AnimateDiff (local)
// ─────────────────────────────────────────────────────────────────────────────

async function generateComfyUIVideo(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const baseUrl = process.env.COMFYUI_BASE_URL ?? 'http://localhost:8188'
  const clientId = randomUUID()
  const frames = Math.round((cfg.duration_seconds ?? 5) * (cfg.fps ?? 24))

  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: process.env.COMFYUI_MODEL ?? 'v1-5-pruned-emaonly.ckpt' } },
    '2': {
      class_type: 'ADE_AnimateDiffLoaderWithContext',
      inputs: { model: ['1', 0], motion_module: process.env.COMFYUI_ANIMATEDIFF_MODEL ?? 'mm_sd_v15_v2.ckpt', beta_schedule: 'autoselect', context_options: ['context_opt', 0] },
    },
    'context_opt': {
      class_type: 'ADE_StandardUniformContextOptions',
      inputs: { context_length: 16, context_stride: 1, context_overlap: 4, closed_loop: false },
    },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt.positivePrompt } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt.negativePrompt || '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: frames } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
        sampler_name: 'ddim', scheduler: 'linear',
        steps: 20, cfg: 7,
        seed: cfg.seed ?? Math.floor(Math.random() * 2 ** 32),
        denoise: 1,
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['7', 0], frame_rate: cfg.fps ?? 24, loop_count: 0,
        filename_prefix: 'contentnode_video', format: 'video/h264-mp4', pingpong: false, save_output: true,
      },
    },
  }

  const queueRes = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })

  if (!queueRes.ok) throw new Error(`ComfyUI queue error: ${queueRes.status}`)
  const { prompt_id } = await queueRes.json() as { prompt_id: string }

  const videoUrls = await asyncPoll({
    poll: async () => {
      const histRes = await fetch(`${baseUrl}/history/${prompt_id}`)
      if (!histRes.ok) return null
      const history = await histRes.json() as Record<string, {
        outputs?: Record<string, { videos?: { filename: string; subfolder: string; type: string }[] }>
      }>
      const job = history[prompt_id]
      if (!job?.outputs) return null
      const urls: string[] = []
      for (const node of Object.values(job.outputs)) {
        for (const vid of node.videos ?? []) {
          urls.push(`${baseUrl}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder)}&type=${vid.type}`)
        }
      }
      return urls.length > 0 ? urls : null
    },
    intervalMs: 3000,
    timeoutMs: 600_000,
    label: 'ComfyUI AnimateDiff generation',
  })

  return videoUrls as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// CogVideoX (local REST wrapper)
// ─────────────────────────────────────────────────────────────────────────────

async function generateCogVideoX(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const baseUrl = process.env.COGVIDEOX_BASE_URL ?? 'http://localhost:7870'

  const submitRes = await fetch(`${baseUrl}/v1/video/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: prompt.positivePrompt,
      negative_prompt: prompt.negativePrompt || undefined,
      num_frames: 49,
      fps: 8,
      width: 720,
      height: 480,
      ...(cfg.seed != null ? { seed: cfg.seed } : {}),
    }),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`CogVideoX submit error: ${submitRes.status} ${err}`)
  }

  const { task_id } = await submitRes.json() as { task_id: string }

  const videoUrl = await asyncPoll({
    poll: async () => {
      const res = await fetch(`${baseUrl}/v1/video/task/${task_id}`)
      if (!res.ok) return null
      const result = await res.json() as { status: string; video_url?: string; error?: string }
      if (result.status === 'completed' && result.video_url) return result.video_url
      if (result.status === 'failed') throw new Error(`CogVideoX failed: ${result.error ?? 'unknown'}`)
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'CogVideoX generation',
  })

  return [videoUrl as string]
}

// ─────────────────────────────────────────────────────────────────────────────
// Wan2.1 (local REST wrapper)
// ─────────────────────────────────────────────────────────────────────────────

async function generateWan21(prompt: VideoPromptOutput, cfg: VideoGenerationConfig): Promise<string[]> {
  const baseUrl = process.env.WAN_BASE_URL ?? 'http://localhost:7880'

  const submitRes = await fetch(`${baseUrl}/v1/video/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: prompt.positivePrompt,
      negative_prompt: prompt.negativePrompt || undefined,
      duration: cfg.duration_seconds ?? 5,
      fps: cfg.fps ?? 16,
      resolution: cfg.resolution ?? '720p',
      ...(cfg.seed != null ? { seed: cfg.seed } : {}),
    }),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Wan2.1 submit error: ${submitRes.status} ${err}`)
  }

  const { task_id } = await submitRes.json() as { task_id: string }

  const videoUrl = await asyncPoll({
    poll: async () => {
      const res = await fetch(`${baseUrl}/v1/video/task/${task_id}`)
      if (!res.ok) return null
      const result = await res.json() as { status: string; video_url?: string; error?: string }
      if (result.status === 'completed' && result.video_url) return result.video_url
      if (result.status === 'failed') throw new Error(`Wan2.1 failed: ${result.error ?? 'unknown'}`)
      return null
    },
    intervalMs: 5000,
    timeoutMs: 600_000,
    label: 'Wan2.1 generation',
  })

  return [videoUrl as string]
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class VideoGenerationExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as VideoGenerationConfig
    const provider: Provider = cfg.provider ?? 'runway'
    const isOnline = !OFFLINE_VIDEO_PROVIDERS.has(provider)
    const svc = VIDEO_SERVICE_MAP[provider] ?? { costProvider: provider, model: provider, displayService: provider }
    const startMs = Date.now()

    // Extract reference images from connected upstream generation nodes
    const assetRefs = extractAssetRefs(input)
    const referenceImages = assetRefs.length > 0 ? await fetchImageInputs(assetRefs) : []

    const prompt = await extractVideoPrompt(input, cfg, referenceImages)

    // Merge manual start_frame into prompt if not already set by upstream
    if (cfg.start_frame && !prompt.referenceImageUrl) {
      prompt.referenceImageUrl = cfg.start_frame
      prompt.mode = 'image-to-video'
    }

    let assets: GeneratedAsset[]

    try {
      switch (provider) {
        case 'runway': {
          const urls = await generateRunway(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'kling': {
          const urls = await generateKling(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'luma': {
          const urls = await generateLuma(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'pika': {
          const urls = await generatePika(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'veo2': {
          const refs = await generateVeo2(prompt, cfg)
          assets = refs.map((ref) => {
            const storageKey = ref.replace('__stored__:', '')
            return {
              type: 'video' as const,
              storageKey,
              localPath: `/files/${storageKey}`,
              provider,
              generatedAt: new Date().toISOString(),
            }
          })
          break
        }
        case 'comfyui-animatediff': {
          const urls = await generateComfyUIVideo(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'cogvideox': {
          const urls = await generateCogVideoX(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        case 'wan21': {
          const urls = await generateWan21(prompt, cfg)
          assets = await saveVideos(urls, provider)
          break
        }
        default:
          throw new Error(`Unknown video generation provider: ${String(provider)}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      usageEventService.record({
        agencyId:          ctx.agencyId,
        userId:            ctx.userId ?? undefined,
        userRole:          ctx.userRole ?? undefined,
        clientId:          ctx.clientId ?? undefined,
        toolType:          'video',
        toolSubtype:       'video_generation',
        provider,
        model:             svc.model,
        isOnline,
        workflowId:        ctx.workflowId,
        workflowRunId:     ctx.workflowRunId,
        nodeId:            ctx.nodeId,
        nodeType:          'output',
        inputMediaCount:   referenceImages.length,
        durationMs:        Date.now() - startMs,
        status:            'error',
        errorMessage,
        permissionsAtTime: ctx.resolvedPermissions,
      }).catch(() => {})
      throw err
    }

    const durationSecs = cfg.duration_seconds ?? 4
    const resolution   = cfg.resolution ?? '1080p'
    const costUsd = costEstimator.estimateVideoCost(
      svc.costProvider || provider,
      svc.model,
      durationSecs * assets.length,
      isOnline,
    )

    usageEventService.record({
      agencyId:           ctx.agencyId,
      userId:             ctx.userId ?? undefined,
      userRole:           ctx.userRole ?? undefined,
      clientId:           ctx.clientId ?? undefined,
      toolType:           'video',
      toolSubtype:        'video_generation',
      provider,
      model:              svc.model,
      isOnline,
      workflowId:         ctx.workflowId,
      workflowRunId:      ctx.workflowRunId,
      nodeId:             ctx.nodeId,
      nodeType:           'output',
      inputMediaCount:    referenceImages.length,
      outputMediaCount:   assets.length,
      outputDurationSecs: durationSecs * assets.length,
      outputResolution:   resolution,
      estimatedCostUsd:   costUsd ?? undefined,
      durationMs:         Date.now() - startMs,
      status:             'success',
      permissionsAtTime:  ctx.resolvedPermissions,
    }).catch(() => {})

    // Monthly-bucket UsageRecord (keeps the existing dashboard in sync)
    const now = new Date()
    withAgency(ctx.agencyId, () =>
      prisma.usageRecord.create({
        data: {
          agencyId:    ctx.agencyId,
          metric:      'video_generations',
          quantity:    assets.length,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0),
          metadata:    { provider, service: svc.displayService, model: svc.model, userId: ctx.userId ?? undefined, workflowRunId: ctx.workflowRunId, resolution, durationSecs: durationSecs * assets.length } as Prisma.InputJsonValue,
        },
      })
    ).catch(() => {})

    return {
      output: { assets, prompt, provider },
      generatedAssets: assets,
    }
  }
}
