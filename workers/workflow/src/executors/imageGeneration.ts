import { randomUUID } from 'node:crypto'
import { saveGeneratedFile } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult, type GeneratedAsset, asyncPoll } from './base.js'
import type { ImagePromptOutput } from './imagePromptBuilder.js'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

type Provider = 'dalle3' | 'stability' | 'fal' | 'comfyui' | 'automatic1111'
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

const IMAGE_MERGE_SYSTEM_PROMPT = `You are an expert at writing prompts for image generation models.

Given a collection of inputs (briefs, descriptions, reference files, style guides), synthesize a single coherent image generation prompt.

Return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "positivePrompt": "detailed visual description of what to generate",
  "negativePrompt": "what to avoid, e.g. blurry, watermark, text, low quality",
  "aspectRatio": "16:9",
  "styleTag": "e.g. photorealistic, cinematic, illustration",
  "modelPreference": "e.g. dall-e-3, stable-diffusion"
}

aspectRatio must be one of: 1:1, 16:9, 9:16, 4:3. Make the positivePrompt rich and descriptive.`

async function extractPrompt(input: unknown): Promise<ImagePromptOutput> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    // Already a prompt object from ImagePromptBuilder
    if (typeof obj.positivePrompt === 'string') {
      return obj as unknown as ImagePromptOutput
    }
    // Structured multi-input: do quick LLM merge
    if (Array.isArray(obj.inputs)) {
      const result = await callModel(
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          api_key_ref: '',
          system_prompt: IMAGE_MERGE_SYSTEM_PROMPT,
          temperature: 0.7,
          max_tokens: 512,
        },
        `Synthesize a single coherent image generation prompt from these inputs:\n\n${JSON.stringify(obj.inputs, null, 2)}`,
      )
      try {
        const cleaned = result.text.replace(/```(?:json)?/g, '').trim()
        return JSON.parse(cleaned) as ImagePromptOutput
      } catch {
        throw new Error(`Image Generation: LLM merge returned invalid JSON: ${result.text.slice(0, 200)}`)
      }
    }
  }
  // Fallback: treat input as plain text
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  return {
    positivePrompt: text,
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

  // DALL-E 3 only supports n=1 per request — batch if needed
  const urls: string[] = []
  for (let i = 0; i < n; i++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt.positivePrompt,
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
// Stability AI
// ─────────────────────────────────────────────────────────────────────────────

async function generateStability(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const apiKey = process.env.STABILITY_API_KEY
  if (!apiKey) throw new Error('STABILITY_API_KEY is not set')

  const { width, height } = aspectToDimensions(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')
  const n = Math.min(cfg.num_outputs ?? 1, 4)

  const body: Record<string, unknown> = {
    text_prompts: [
      { text: prompt.positivePrompt, weight: 1 },
      ...(prompt.negativePrompt || cfg.negative_prompt
        ? [{ text: `${prompt.negativePrompt} ${cfg.negative_prompt ?? ''}`.trim(), weight: -1 }]
        : []),
    ],
    width,
    height,
    samples: n,
    cfg_scale: cfg.cfg_scale ?? 7,
    steps: cfg.quality === 'high' ? 50 : cfg.quality === 'draft' ? 20 : 30,
    ...(cfg.seed != null ? { seed: cfg.seed } : {}),
  }

  const res = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Stability AI error: ${res.status} ${err}`)
  }

  const data = await res.json() as { artifacts: { base64: string }[] }
  // Stability returns base64 — convert to Buffers
  return data.artifacts.map((a) => `data:image/png;base64,${a.base64}`)
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

async function generateComfyUI(
  prompt: ImagePromptOutput,
  cfg: ImageGenerationConfig,
): Promise<string[]> {
  const baseUrl = process.env.COMFYUI_BASE_URL ?? 'http://localhost:8188'
  const { width, height } = aspectToDimensions(cfg.aspect_ratio ?? prompt.aspectRatio ?? '1:1')
  const clientId = randomUUID()

  // Minimal text-to-image workflow
  const workflow = {
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt.positivePrompt } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt.negativePrompt || cfg.negative_prompt || '' } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: process.env.COMFYUI_MODEL ?? 'v1-5-pruned-emaonly.ckpt' } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0],
        latent_image: ['5', 0], sampler_name: 'euler', scheduler: 'normal',
        steps: cfg.quality === 'high' ? 30 : cfg.quality === 'draft' ? 10 : 20,
        cfg: cfg.cfg_scale ?? 7,
        seed: cfg.seed ?? Math.floor(Math.random() * 2 ** 32),
        denoise: 1,
      },
    },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: cfg.num_outputs ?? 1 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'contentnode' } },
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

async function saveImages(
  sources: string[],
  provider: Provider,
): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = []

  for (const source of sources) {
    const ext = source.startsWith('data:image/png') ? 'png' : 'jpg'
    const filename = `${randomUUID()}.${ext}`
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    let buffer: Buffer
    if (source.startsWith('data:')) {
      // base64 data URI
      const base64 = source.split(',')[1]
      buffer = Buffer.from(base64, 'base64')
    } else {
      // URL — saveGeneratedFile will fetch it
      const storageKey = await saveGeneratedFile(source, filename, contentType)
      assets.push({
        type: 'image',
        storageKey,
        localPath: `/files/generated/${filename}`,
        provider,
        generatedAt: new Date().toISOString(),
      })
      continue
    }

    const storageKey = await saveGeneratedFile(buffer, filename, contentType)
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
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as ImageGenerationConfig
    const provider: Provider = cfg.provider ?? 'dalle3'
    const prompt = await extractPrompt(input)

    let rawUrls: string[]

    switch (provider) {
      case 'dalle3':
        rawUrls = await generateDalle3(prompt, cfg)
        break
      case 'stability':
        rawUrls = await generateStability(prompt, cfg)
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

    const assets = await saveImages(rawUrls, provider)

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
