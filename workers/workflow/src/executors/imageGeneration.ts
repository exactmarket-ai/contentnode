import { randomUUID } from 'node:crypto'
import { saveGeneratedFile, downloadBuffer } from '@contentnode/storage'
import { callModel, type ImageInput } from '@contentnode/ai'
import { prisma, withAgency, usageEventService, costEstimator, type Prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult, type GeneratedAsset, asyncPoll } from './base.js'
import type { ImagePromptOutput } from './imagePromptBuilder.js'

const OFFLINE_IMAGE_PROVIDERS = new Set(['comfyui', 'automatic1111'])

// ─────────────────────────────────────────────────────────────────────────────
// Service map — exact model/service used per provider (for pricing + tracking)
// ─────────────────────────────────────────────────────────────────────────────

interface ImageServiceInfo { costProvider: string; model: string; displayService: string }

const IMAGE_SERVICE_MAP: Record<string, ImageServiceInfo> = {
  dalle3:         { costProvider: 'openai',   model: 'dall-e-3',         displayService: 'DALL-E 3' },
  gptimage15:     { costProvider: 'openai',   model: 'gpt-image-1.5',    displayService: 'GPT Image 1.5' },
  gptimage1mini:  { costProvider: 'openai',   model: 'gpt-image-1-mini', displayService: 'GPT Image 1 Mini' },
  gptimage2:      { costProvider: 'openai',   model: 'gpt-image-2',      displayService: 'GPT Image 2' },
  ideogram:       { costProvider: 'ideogram', model: 'ideogram-v2',      displayService: 'Ideogram v2' },
  leonardo:       { costProvider: 'leonardo', model: 'leonardo-phoenix',  displayService: 'Leonardo Phoenix' },
  fal:            { costProvider: 'fal',      model: 'flux-dev',         displayService: 'FAL FLUX Dev' },
  comfyui:        { costProvider: '',         model: 'comfyui',          displayService: 'ComfyUI' },
  automatic1111:  { costProvider: '',         model: 'automatic1111',    displayService: 'AUTOMATIC1111' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

type Provider = 'dalle3' | 'gptimage15' | 'gptimage1mini' | 'gptimage2' | 'ideogram' | 'leonardo' | 'fal' | 'comfyui' | 'automatic1111'
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3'
type Quality = 'draft' | 'standard' | 'high'

interface ImageGenerationConfig {
  provider: Provider
  aspect_ratio?: AspectRatio
  quality?: Quality
  num_outputs?: number
  cfg_scale?: number
  seed?: number | null
  negative_prompt?: string
  /** Base64 or URL for image-to-image / style reference */
  reference_image?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Reference image extraction
// ─────────────────────────────────────────────────────────────────────────────

interface AssetRef {
  storageKey: string
  localPath: string
}

/** Pull image assets out of structured multi-inputs from upstream generation nodes. */
function extractAssetRefs(input: unknown): AssetRef[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const obj = input as Record<string, unknown>
  if (!Array.isArray(obj.inputs)) return []

  const refs: AssetRef[] = []
  for (const item of obj.inputs as Record<string, unknown>[]) {
    const content = item.content as Record<string, unknown> | undefined
    if (!content) continue

    // Upstream image-generation node: { assets: [{ storageKey, localPath, type }] }
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

    // Manually uploaded reference file: { type: 'image', localPath, storageKey }
    if (content.type === 'image' && content.localPath) {
      // storageKey may not be present for old refs — derive from localPath
      const path = content.localPath as string
      const key = (content.storageKey as string | undefined) ?? path.replace(/^\/files\//, '')
      refs.push({ storageKey: key, localPath: path })
    }
  }
  return refs
}

/** Download asset bytes and return as ImageInput for vision models. */
/** Detect real image media type from buffer magic bytes — never trust the file extension. */
function detectMediaType(buf: Buffer): ImageInput['mediaType'] {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[6] === 0x57 && buf[7] === 0x45) return 'image/webp'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  return 'image/jpeg' // safe fallback
}

async function fetchImageInputs(refs: AssetRef[]): Promise<ImageInput[]> {
  const results: ImageInput[] = []
  for (const ref of refs) {
    try {
      const buf = await downloadBuffer(ref.storageKey)
      results.push({ base64: buf.toString('base64'), mediaType: detectMediaType(buf) })
    } catch (err) {
      console.warn(`[imageGeneration] could not fetch reference ${ref.storageKey}:`, err)
    }
  }
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt extraction / synthesis
// ─────────────────────────────────────────────────────────────────────────────

/** Extract plain text from any input shape without invoking any AI. */
function extractTextFromInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return String(input)
  const obj = input as Record<string, unknown>

  // Already a structured prompt from ImagePromptBuilder
  if (typeof obj.positivePrompt === 'string') return obj.positivePrompt

  // Multi-input wrapper: join all text inputs with newlines
  if (Array.isArray(obj.inputs)) {
    const parts: string[] = []
    for (const item of obj.inputs as Record<string, unknown>[]) {
      const content = item.content
      if (!content) continue
      // Skip asset-only inputs (images handled separately via referenceImages)
      if (typeof content === 'object' && content !== null && (content as Record<string, unknown>).assets) continue
      if (typeof content === 'string') parts.push(content)
      else if (typeof content === 'object') {
        const c = content as Record<string, unknown>
        // ImagePromptOutput from upstream image-prompt-builder
        if (typeof c.positivePrompt === 'string') parts.push(c.positivePrompt)
        else if (typeof c.text === 'string') parts.push(c.text)
        else parts.push(JSON.stringify(content))
      }
    }
    if (parts.length > 0) return parts.join('\n')
  }

  return JSON.stringify(obj)
}

/** Return true when v looks like a full ImagePromptOutput from image-prompt-builder. */
function isImagePromptOutput(v: unknown): v is ImagePromptOutput {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).positivePrompt === 'string'
  )
}

/** Find a structured ImagePromptOutput in the input — either directly or inside the runner's inputs[] wrapper. */
function findStructuredPrompt(input: unknown): ImagePromptOutput | null {
  if (isImagePromptOutput(input)) return input
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (Array.isArray(obj.inputs)) {
      for (const item of obj.inputs as Record<string, unknown>[]) {
        if (isImagePromptOutput(item.content)) return item.content as ImagePromptOutput
      }
    }
  }
  return null
}

async function extractPrompt(input: unknown, referenceImages: ImageInput[]): Promise<ImagePromptOutput> {
  const hasRefs = referenceImages.length > 0

  // If upstream is an image-prompt-builder, use its full structured output
  // (preserves negativePrompt, aspectRatio, styleTag, modelPreference).
  const structured = findStructuredPrompt(input)
  if (structured) {
    if (!hasRefs) return structured
    // With reference images: describe them and prepend to the positive prompt
    const result = await callModel(
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        api_key_ref: '',
        system_prompt: 'Describe the key visual subjects in the provided image(s) in one concise sentence. No extra commentary.',
        temperature: 0.3,
        max_tokens: 150,
      },
      'Describe what you see.',
      referenceImages,
    )
    const description = result.text.trim()
    return {
      ...structured,
      positivePrompt: description ? `${description}. ${structured.positivePrompt}` : structured.positivePrompt,
    }
  }

  // Always use the user's text as-is — never rewrite or expand it automatically.
  // If reference images are present, ask Claude only to describe them so they can
  // be incorporated, then prepend that description to the user's prompt.
  const userText = extractTextFromInput(input)

  if (hasRefs) {
    const result = await callModel(
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        api_key_ref: '',
        system_prompt: 'Describe the key visual subjects in the provided image(s) in one concise sentence. No extra commentary.',
        temperature: 0.3,
        max_tokens: 150,
      },
      'Describe what you see.',
      referenceImages,
    )
    const description = result.text.trim()
    return {
      positivePrompt: description ? `${description}. ${userText}` : userText,
      negativePrompt: '',
      aspectRatio: '1:1',
      styleTag: '',
      modelPreference: '',
    }
  }

  return {
    positivePrompt: userText,
    negativePrompt: '',
    aspectRatio: '1:1',
    styleTag: '',
    modelPreference: '',
  }
}

function aspectToDimensions(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '16:9':  return { width: 1344, height: 768 }
    case '9:16':  return { width: 768,  height: 1344 }
    case '4:3':   return { width: 1152, height: 896 }
    case '1:1':
    default:      return { width: 1024, height: 1024 }
  }
}

function dalleSize(ratio: AspectRatio): '1024x1024' | '1792x1024' | '1024x1792' {
  if (ratio === '16:9') return '1792x1024'
  if (ratio === '9:16') return '1024x1792'
  return '1024x1024'
}

// ─────────────────────────────────────────────────────────────────────────────
// DALL-E 3 (OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

async function generateDalle3(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const quality = cfg.quality === 'high' ? 'hd' : 'standard'
  const size = dalleSize(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')
  const n = Math.min(cfg.num_outputs ?? 1, 4)

  // DALL-E 3 max prompt length is 4000 chars — truncate at a word boundary if needed
  const DALLE3_MAX = 4000
  const rawPrompt = prompt.positivePrompt
  const safePrompt = rawPrompt.length > DALLE3_MAX
    ? rawPrompt.slice(0, DALLE3_MAX).replace(/\s+\S*$/, '')
    : rawPrompt

  // DALL-E 3 only supports n=1 per request — batch if needed
  const urls: string[] = []
  for (let i = 0; i < n; i++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: safePrompt,
        n: 1,
        size,
        quality,
        response_format: 'url',
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`DALL-E 3 error: ${res.status} ${err}`)
    }
    const data = await res.json() as { data: { url: string }[] }
    urls.push(data.data[0].url)
  }
  return urls
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT Image 1.5 / 1 Mini / 2 (OpenAI) — returns base64, not URLs
// ─────────────────────────────────────────────────────────────────────────────

function gptImageSize(ratio: AspectRatio): '1024x1024' | '1536x1024' | '1024x1536' {
  if (ratio === '16:9' || ratio === '4:3') return '1536x1024'
  if (ratio === '9:16') return '1024x1536'
  return '1024x1024'
}

async function generateGptImage(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
  model: string,
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const size = gptImageSize(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')
  const quality = cfg.quality === 'high' ? 'high' : cfg.quality === 'draft' ? 'low' : 'medium'
  const n = Math.min(cfg.num_outputs ?? 1, 4)

  const dataUrls: string[] = []
  for (let i = 0; i < n; i++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt: prompt.positivePrompt, n: 1, size, quality }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`${model} error: ${res.status} ${err}`)
    }
    const data = await res.json() as { data: { b64_json: string }[] }
    dataUrls.push(`data:image/png;base64,${data.data[0].b64_json}`)
  }
  return dataUrls
}

// ─────────────────────────────────────────────────────────────────────────────
// Ideogram v2
// ─────────────────────────────────────────────────────────────────────────────

const IDEOGRAM_ASPECT_MAP: Record<string, string> = {
  '1:1':  'ASPECT_1_1',
  '16:9': 'ASPECT_16_9',
  '9:16': 'ASPECT_9_16',
  '4:3':  'ASPECT_4_3',
  '3:4':  'ASPECT_3_4',
}

async function generateIdeogram(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const apiKey = process.env.IDEOGRAM_API_KEY
  if (!apiKey) throw new Error('IDEOGRAM_API_KEY is not set')

  const aspectRatio = IDEOGRAM_ASPECT_MAP[cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1'] ?? 'ASPECT_1_1'
  const model = cfg.quality === 'draft' ? 'V_2_TURBO' : 'V_2'
  const n = Math.min(cfg.num_outputs ?? 1, 8)

  const negPrompt = [prompt.negativePrompt, cfg.negative_prompt].filter(Boolean).join(' ').trim()

  const imageRequest: Record<string, unknown> = {
    prompt: prompt.positivePrompt,
    model,
    aspect_ratio: aspectRatio,
    style_type: (cfg as Record<string, unknown>).style_type ?? 'AUTO',
    num_images: n,
    magic_prompt_option: 'AUTO',
    ...(negPrompt ? { negative_prompt: negPrompt } : {}),
    ...(cfg.seed != null ? { seed: cfg.seed } : {}),
  }

  const res = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body: JSON.stringify({ image_request: imageRequest }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ideogram v2 error: ${res.status} ${err}`)
  }

  const raw = await res.json() as Record<string, unknown>
  console.log('[ideogram] response top-level keys:', Object.keys(raw))
  const items = Array.isArray(raw.data) ? raw.data as { url?: string }[] : []
  console.log('[ideogram] items count:', items.length, '| first url:', items[0]?.url?.slice(0, 60))
  const urls = items.map((d) => d.url).filter((u): u is string => typeof u === 'string')
  if (urls.length === 0) throw new Error(`Ideogram returned no image URLs. Raw: ${JSON.stringify(raw).slice(0, 300)}`)
  return urls
}

// ─────────────────────────────────────────────────────────────────────────────
// Leonardo.ai
// ─────────────────────────────────────────────────────────────────────────────

// Leonardo Phoenix — their latest flagship model
const LEONARDO_MODEL_ID = 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3'

const LEONARDO_ASPECT_DIMS: Record<string, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '16:9': { width: 1360, height: 768  },
  '9:16': { width: 768,  height: 1360 },
  '4:3':  { width: 1232, height: 928  },
  '3:4':  { width: 928,  height: 1232 },
}

async function generateLeonardo(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const apiKey = process.env.LEONARDO_API_KEY
  if (!apiKey) throw new Error('LEONARDO_API_KEY is not set')

  const dims = LEONARDO_ASPECT_DIMS[cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1'] ?? LEONARDO_ASPECT_DIMS['1:1']
  const n = Math.min(cfg.num_outputs ?? 1, 8)
  const negPrompt = [prompt.negativePrompt, cfg.negative_prompt].filter(Boolean).join(' ').trim()

  const body: Record<string, unknown> = {
    prompt: prompt.positivePrompt,
    modelId: LEONARDO_MODEL_ID,
    width: dims.width,
    height: dims.height,
    num_images: n,
    guidance_scale: cfg.cfg_scale ?? 7,
    num_inference_steps: cfg.quality === 'high' ? 40 : cfg.quality === 'draft' ? 15 : 25,
    presetStyle: (cfg as Record<string, unknown>).preset_style ?? 'DYNAMIC',
    ...(negPrompt ? { negative_prompt: negPrompt } : {}),
    ...(cfg.seed != null ? { seed: cfg.seed } : {}),
  }

  const submitRes = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Leonardo.ai submit error: ${submitRes.status} ${err}`)
  }

  const submitData = await submitRes.json() as { sdGenerationJob: { generationId: string } }
  const generationId = submitData.sdGenerationJob?.generationId
  if (!generationId) throw new Error('Leonardo.ai did not return a generationId')

  const result = await asyncPoll({
    poll: async () => {
      const res = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`Leonardo.ai poll error: ${res.status}`)
      const data = await res.json() as { generations_by_pk: { status: string; generated_images: { url: string }[] } }
      const job = data.generations_by_pk
      if (job.status !== 'COMPLETE') return null
      return job.generated_images.map((img) => img.url)
    },
    intervalMs: 3000,
    timeoutMs: 120_000,
    label: 'Leonardo.ai generation',
  })

  return result as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Fal.ai
// ─────────────────────────────────────────────────────────────────────────────

async function generateFal(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const apiKey = process.env.FAL_API_KEY
  if (!apiKey) throw new Error('FAL_API_KEY is not set')

  // Submit job
  const submitRes = await fetch('https://queue.fal.run/fal-ai/flux/dev', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: prompt.positivePrompt,
      image_size: cfg.aspect_ratio === '16:9' ? 'landscape_16_9'
        : cfg.aspect_ratio === '9:16' ? 'portrait_9_16'
        : 'square_hd',
      num_images: Math.min(cfg.num_outputs ?? 1, 4),
      ...(cfg.seed != null ? { seed: cfg.seed } : {}),
    }),
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Fal.ai submit error: ${submitRes.status} ${err}`)
  }

  const { request_id } = await submitRes.json() as { request_id: string }

  // Poll for completion
  const result = await asyncPoll({
    poll: async () => {
      const statusRes = await fetch(`https://queue.fal.run/fal-ai/flux/requests/${request_id}/status`, {
        headers: { Authorization: `Key ${apiKey}` },
      })
      if (!statusRes.ok) return null
      const status = await statusRes.json() as { status: string; response_url?: string }
      if (status.status === 'COMPLETED' && status.response_url) return status.response_url
      if (status.status === 'FAILED') throw new Error('Fal.ai generation failed')
      return null
    },
    intervalMs: 3000,
    timeoutMs: 300_000,
    label: 'fal.ai image generation',
  })

  const resultRes = await fetch(result as string, {
    headers: { Authorization: `Key ${apiKey}` },
  })
  const resultData = await resultRes.json() as { images: { url: string }[] }
  return resultData.images.map((img) => img.url)
}

// ─────────────────────────────────────────────────────────────────────────────
// ComfyUI (local — http://localhost:8188)
// ─────────────────────────────────────────────────────────────────────────────
//
// Env vars:
//   COMFYUI_BASE_URL  — URL of the running ComfyUI instance (default: http://localhost:8188)
//   COMFYUI_MODEL     — checkpoint filename in models/checkpoints/
//                       e.g. flux1-dev-fp8.safetensors  (default: v1-5-pruned-emaonly.ckpt)
//
// FLUX is detected when COMFYUI_MODEL contains "flux" (case-insensitive).
// FLUX merged checkpoints (single file bundling UNet + text encoders + VAE)
// are loaded via CheckpointLoaderSimple — no separate companion files needed.
// For SDXL / SD1.5, the same workflow is used with standard CFG settings.

function isFluxModel(modelName: string): boolean {
  return modelName.toLowerCase().includes('flux')
}

async function generateComfyUI(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const baseUrl   = process.env.COMFYUI_BASE_URL ?? 'http://localhost:8188'
  const modelName = process.env.COMFYUI_MODEL    ?? 'v1-5-pruned-emaonly.ckpt'
  const { width, height } = aspectToDimensions(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')
  const clientId  = randomUUID()
  const seed      = cfg.seed ?? Math.floor(Math.random() * 2 ** 32)

  let workflow: Record<string, unknown>

  if (isFluxModel(modelName)) {
    // ── FLUX merged checkpoint workflow ───────────────────────────────────────
    // Merged checkpoints bundle UNet + text encoders + VAE in one file.
    // Place in models/checkpoints/ and load via CheckpointLoaderSimple.
    // FLUX does not use CFG guidance (cfg=1) and ignores negative prompts.
    // Dev: 20 steps  |  Schnell: 4 steps
    const isSchnell = modelName.toLowerCase().includes('schnell')
    const steps     = isSchnell
      ? 4
      : cfg.quality === 'high' ? 30 : cfg.quality === 'draft' ? 10 : 20

    workflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: modelName } },
      '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt.positivePrompt } },
      '3': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: cfg.num_outputs ?? 1 } },
      '4': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0], positive: ['2', 0], negative: ['2', 0],
          latent_image: ['3', 0],
          sampler_name: 'euler', scheduler: 'simple',
          steps, cfg: 1, seed, denoise: 1,
        },
      },
      '5': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
      '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'contentnode' } },
    }
  } else {
    // ── SDXL / SD1.5 workflow (legacy CheckpointLoaderSimple) ────────────────
    workflow = {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: modelName } },
      '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt.positivePrompt } },
      '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt.negativePrompt || cfg.negative_prompt || '' } },
      '3': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0], positive: ['6', 0], negative: ['7', 0],
          latent_image: ['5', 0], sampler_name: 'euler', scheduler: 'normal',
          steps: cfg.quality === 'high' ? 30 : cfg.quality === 'draft' ? 10 : 20,
          cfg: cfg.cfg_scale ?? 7,
          seed, denoise: 1,
        },
      },
      '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: cfg.num_outputs ?? 1 } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'contentnode' } },
    }
  }

  const queueRes = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })

  if (!queueRes.ok) throw new Error(`ComfyUI queue error: ${queueRes.status}`)
  const { prompt_id } = await queueRes.json() as { prompt_id: string }

  // Poll history until job completes
  const outputs = await asyncPoll({
    poll: async () => {
      const histRes = await fetch(`${baseUrl}/history/${prompt_id}`)
      if (!histRes.ok) return null
      const history = await histRes.json() as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>
      const job = history[prompt_id]
      if (!job?.outputs) return null
      const images: string[] = []
      for (const node of Object.values(job.outputs)) {
        for (const img of node.images ?? []) {
          images.push(`${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)
        }
      }
      return images.length > 0 ? images : null
    },
    intervalMs: 2000,
    timeoutMs: 300_000,
    label: 'ComfyUI image generation',
  })

  return outputs as string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIC1111 (local — http://localhost:7860)
// ─────────────────────────────────────────────────────────────────────────────

async function generateAutomatic1111(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const baseUrl = process.env.A1111_BASE_URL ?? 'http://localhost:7860'
  const { width, height } = aspectToDimensions(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')

  const body = {
    prompt: prompt.positivePrompt,
    negative_prompt: [prompt.negativePrompt, cfg.negative_prompt].filter(Boolean).join(', '),
    width,
    height,
    batch_size: Math.min(cfg.num_outputs ?? 1, 4),
    cfg_scale: cfg.cfg_scale ?? 7,
    steps: cfg.quality === 'high' ? 50 : cfg.quality === 'draft' ? 15 : 25,
    ...(cfg.seed != null ? { seed: cfg.seed } : { seed: -1 }),
  }

  const res = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AUTOMATIC1111 error: ${res.status} ${err}`)
  }

  const data = await res.json() as { images: string[] }
  // A1111 returns base64 PNG
  return data.images.map((b64) => `data:image/png;base64,${b64}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Save all generated images to storage
// ─────────────────────────────────────────────────────────────────────────────

function mimeToExt(mime: string | null): { ext: string; contentType: string } {
  if (mime?.includes('png'))  return { ext: 'png', contentType: 'image/png' }
  if (mime?.includes('webp')) return { ext: 'webp', contentType: 'image/webp' }
  if (mime?.includes('gif'))  return { ext: 'gif', contentType: 'image/gif' }
  return { ext: 'jpg', contentType: 'image/jpeg' }
}

async function saveImages(
  sources: string[],
  provider: Provider,
): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = []

  for (const source of sources) {
    let buffer: Buffer
    let ext: string
    let contentType: string

    if (source.startsWith('data:')) {
      // base64 data URI — type is declared in the URI
      const mimeMatch = source.match(/^data:([^;]+);/)
      ;({ ext, contentType } = mimeToExt(mimeMatch?.[1] ?? null))
      const base64 = source.split(',')[1]
      buffer = Buffer.from(base64, 'base64')
    } else {
      // URL — fetch and detect real content type from response headers
      const res = await fetch(source)
      if (!res.ok) throw new Error(`Failed to fetch generated image: HTTP ${res.status}`)
      ;({ ext, contentType } = mimeToExt(res.headers.get('content-type')))
      buffer = Buffer.from(await res.arrayBuffer())
    }

    const filename = `${randomUUID()}.${ext}`
    const storageKey = await saveGeneratedFile(buffer, filename, contentType)
    console.log(`[saveImages] saved ${provider} image → storageKey=${storageKey} size=${buffer.byteLength}`)
    assets.push({
      type: 'image',
      storageKey,
      localPath: `/files/generated/${filename}`,
      provider,
      generatedAt: new Date().toISOString(),
    })
  }

  return assets
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class ImageGenerationExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as ImageGenerationConfig

    // Normalize provider aliases — nodePILOT and node configs may use 'dall-e-3', 'openai', etc.
    const PROVIDER_ALIASES: Record<string, Provider> = {
      'dall-e-3':   'dalle3',
      'dall-e-2':   'dalle3',
      'dalle-3':    'dalle3',
      'openai':     'dalle3',
      'ideogram-v2':    'ideogram',
      'ideogram2':      'ideogram',
      'leonardo-ai':    'leonardo',
      'leonardo-phoenix':'leonardo',
      'flux':       'fal',
      'flux-dev':   'fal',
    }
    const rawProvider = (cfg.provider ?? 'dalle3') as string
    const provider: Provider = (PROVIDER_ALIASES[rawProvider] ?? rawProvider) as Provider
    const isOnline = !OFFLINE_IMAGE_PROVIDERS.has(provider)
    const svc = IMAGE_SERVICE_MAP[provider] ?? { costProvider: provider, model: provider, displayService: provider }
    const startMs = Date.now()

    // Extract reference images from connected upstream generation nodes
    const assetRefs = extractAssetRefs(input)
    const referenceImages = assetRefs.length > 0 ? await fetchImageInputs(assetRefs) : []

    const prompt = await extractPrompt(input, referenceImages)
    console.log(`[imageGeneration] prompt sent to ${provider}:`, JSON.stringify(prompt))

    // Guard: if we still have no usable prompt, give the user a clear message
    // rather than sending "null" or raw JSON to the image API.
    if (!prompt.positivePrompt || prompt.positivePrompt === 'null' || prompt.positivePrompt.startsWith('{')) {
      throw new Error(
        'Image generation received no prompt text. Make sure the upstream node (AI Generate, Image Prompt Builder, or Text Input) is connected to this node and produced output before running.',
      )
    }

    let rawUrls: string[]

    try {
      switch (provider) {
        case 'dalle3':
          rawUrls = await generateDalle3(prompt, cfg)
          break
        case 'gptimage15':
          rawUrls = await generateGptImage(prompt, cfg, 'gpt-image-1.5')
          break
        case 'gptimage1mini':
          rawUrls = await generateGptImage(prompt, cfg, 'gpt-image-1-mini')
          break
        case 'gptimage2':
          rawUrls = await generateGptImage(prompt, cfg, 'gpt-image-2')
          break
        case 'ideogram':
          rawUrls = await generateIdeogram(prompt, cfg)
          break
        case 'leonardo':
          rawUrls = await generateLeonardo(prompt, cfg)
          break
        case 'fal':
          rawUrls = await generateFal(prompt, cfg)
          break
        case 'comfyui':
          rawUrls = await generateComfyUI(prompt, cfg)
          break
        case 'automatic1111':
          rawUrls = await generateAutomatic1111(prompt, cfg)
          break
        default:
          throw new Error(`Unknown image generation provider: ${String(provider)}`)
      }
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : String(err)
      const errorMessage = `${baseMessage}\n\nPrompt sent: ${prompt.positivePrompt}`
      usageEventService.record({
        agencyId:          ctx.agencyId,
        userId:            ctx.userId ?? undefined,
        userRole:          ctx.userRole ?? undefined,
        clientId:          ctx.clientId ?? undefined,
        toolType:          'graphics',
        toolSubtype:       'image_generation',
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
      throw new Error(errorMessage)
    }

    const assets = await saveImages(rawUrls, provider)

    // Infer resolution from aspect_ratio / num_outputs for cost estimation
    const resolution = cfg.aspect_ratio === '16:9' ? '1792x1024'
      : cfg.aspect_ratio === '9:16' ? '1024x1792'
      : '1024x1024'
    const costUsd = costEstimator.estimateImageCost(
      svc.costProvider || provider,
      svc.model,
      assets.length,
      resolution,
      isOnline,
    )

    usageEventService.record({
      agencyId:          ctx.agencyId,
      userId:            ctx.userId ?? undefined,
      userRole:          ctx.userRole ?? undefined,
      clientId:          ctx.clientId ?? undefined,
      toolType:          'graphics',
      toolSubtype:       'image_generation',
      provider,
      model:             svc.model,
      isOnline,
      workflowId:        ctx.workflowId,
      workflowRunId:     ctx.workflowRunId,
      nodeId:            ctx.nodeId,
      nodeType:          'output',
      inputMediaCount:   referenceImages.length,
      outputMediaCount:  assets.length,
      outputResolution:  resolution,
      estimatedCostUsd:  costUsd ?? undefined,
      durationMs:        Date.now() - startMs,
      status:            'success',
      permissionsAtTime: ctx.resolvedPermissions,
    }).catch(() => {})

    // Monthly-bucket UsageRecord (keeps the existing dashboard in sync)
    const now = new Date()
    withAgency(ctx.agencyId, () =>
      prisma.usageRecord.create({
        data: {
          agencyId:    ctx.agencyId,
          metric:      'image_generations',
          quantity:    assets.length,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0),
          metadata:    { provider, service: svc.displayService, model: svc.model, userId: ctx.userId ?? undefined, workflowRunId: ctx.workflowRunId, resolution } as Prisma.InputJsonValue,
        },
      })
    ).catch(() => {})

    return {
      output: {
        assets,
        prompt,
        provider,
      },
      generatedAssets: assets,
    }
  }
}
