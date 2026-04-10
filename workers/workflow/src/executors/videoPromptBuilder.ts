import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Output interface
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoPromptOutput {
  positivePrompt: string
  negativePrompt: string
  durationSeconds: number
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3'
  cameraMotion: 'static' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'dolly' | 'orbit'
  motionIntensity: 'low' | 'medium' | 'high'
  mode: 'text-to-video' | 'image-to-video'
  referenceImageUrl: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert at writing prompts for AI video generation models.

Given a creative brief, content description, or image description, generate a structured video prompt.

Return ONLY valid JSON with no markdown, no code fences, no explanation — just the raw JSON object:
{
  "positivePrompt": "detailed motion and scene description for video generation",
  "negativePrompt": "what to avoid, e.g. blurry, watermark, still image, low quality, artifacts",
  "durationSeconds": 5,
  "aspectRatio": "16:9",
  "cameraMotion": "static",
  "motionIntensity": "medium",
  "mode": "text-to-video",
  "referenceImageUrl": null
}

Rules:
- aspectRatio must be one of: 1:1, 16:9, 9:16, 4:3
- cameraMotion must be one of: static, pan-left, pan-right, zoom-in, zoom-out, dolly, orbit
- motionIntensity must be one of: low, medium, high
- mode must be one of: text-to-video, image-to-video
- durationSeconds: integer between 3 and 10
- referenceImageUrl: always null — the system fills this in automatically

For positivePrompt: describe the motion, flow, camera movement, lighting changes, atmosphere, and visual transitions. Think cinematically — what moves, how fast, in what direction. Do not include people's names or brand names.`

// ─────────────────────────────────────────────────────────────────────────────
// Input helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract a reference image URL from an upstream Image Generation node's output */
function extractReferenceImage(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (Array.isArray(obj.assets) && obj.assets.length > 0) {
    const asset = obj.assets[0] as { localPath?: string }
    return asset.localPath ?? null
  }
  return null
}

/** Convert any input type to a text description for the LLM */
function getInputText(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    // Image or Video Prompt Builder output
    if (typeof obj.positivePrompt === 'string') return obj.positivePrompt
    // Image Generation node output — extract embedded prompt
    if (Array.isArray(obj.assets)) {
      const prompt = obj.prompt as Record<string, unknown> | undefined
      if (prompt && typeof prompt.positivePrompt === 'string') return prompt.positivePrompt
      return 'Generate a cinematic video based on the provided reference image'
    }
  }
  return JSON.stringify(input)
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

interface VideoPromptBuilderConfig {
  provider?: string
  model?: string
  duration_hint?: number
  camera_motion_hint?: string
  style_hint?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class VideoPromptBuilderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as VideoPromptBuilderConfig
    const referenceImageUrl = extractReferenceImage(input)
    const inputText = getInputText(input)

    const hints = [
      cfg.style_hint        ? `Style preference: ${cfg.style_hint}` : '',
      cfg.camera_motion_hint ? `Preferred camera motion: ${cfg.camera_motion_hint}` : '',
      cfg.duration_hint     ? `Target duration: ${cfg.duration_hint} seconds` : '',
      referenceImageUrl     ? 'A reference image is available — consider image-to-video mode.' : '',
    ].filter(Boolean).join('\n')

    const userMessage = [hints, `Content/brief:\n${inputText}`].filter(Boolean).join('\n\n')

    const result = await callModel(
      {
        provider: (cfg.provider as 'anthropic' | 'openai' | 'ollama') ?? 'anthropic',
        model: (cfg.model as string) ?? 'claude-haiku-4-5-20251001',
        api_key_ref: '',
        system_prompt: SYSTEM_PROMPT,
        temperature: 0.7,
        max_tokens: 512,
      },
      userMessage,
    )

    let parsed: VideoPromptOutput
    try {
      const cleaned = result.text.replace(/```(?:json)?/g, '').trim()
      parsed = JSON.parse(cleaned) as VideoPromptOutput
    } catch {
      throw new Error(`Video Prompt Builder: LLM returned invalid JSON: ${result.text.slice(0, 200)}`)
    }

    // Auto-populate image-to-video when upstream image is available
    if (referenceImageUrl) {
      parsed.mode = 'image-to-video'
      parsed.referenceImageUrl = referenceImageUrl
    }

    return {
      output: parsed,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
