import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const SYSTEM_PROMPT = `You are an expert at writing prompts for image generation models.

Given a creative brief or content, generate a structured image prompt.

Return ONLY valid JSON with no markdown, no code fences, no explanation — just the raw JSON object:
{
  "positivePrompt": "detailed visual description of what to generate",
  "negativePrompt": "what to avoid, e.g. blurry, watermark, text, low quality",
  "aspectRatio": "16:9",
  "styleTag": "e.g. photorealistic, cinematic, illustration, oil painting",
  "modelPreference": "e.g. dall-e-3, stable-diffusion, flux"
}

aspectRatio must be one of: 1:1, 16:9, 9:16, 4:3

Make the positivePrompt rich and descriptive. Include lighting, mood, style, composition, color palette where relevant. Do not include people's names or brand names.`

interface ImagePromptBuilderConfig {
  provider?: string
  model?: string
  aspect_ratio_override?: string
  style_hint?: string
}

export interface ImagePromptOutput {
  positivePrompt: string
  negativePrompt: string
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3'
  styleTag: string
  modelPreference: string
}

export class ImagePromptBuilderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as ImagePromptBuilderConfig

    const stylePrefix = cfg.style_hint ? `Style preference: ${cfg.style_hint}\n\n` : ''
    let userMessage: string

    if (input && typeof input === 'object' && !Array.isArray(input) && 'inputs' in (input as object)) {
      // Structured multi-input: synthesize a prompt from all sources
      const { inputs } = input as { inputs: Array<{ nodeLabel: string; nodeType: string; content: unknown }> }
      userMessage = `${stylePrefix}Synthesize a single coherent image generation prompt from these inputs:\n\n${JSON.stringify(inputs, null, 2)}`
    } else {
      const inputStr =
        typeof input === 'string'
          ? input
          : Array.isArray(input)
          ? input.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n\n')
          : JSON.stringify(input)
      userMessage = `${stylePrefix}Content/brief:\n${inputStr}`
    }

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

    let parsed: ImagePromptOutput
    try {
      // Strip any accidental markdown fences before parsing
      const cleaned = result.text.replace(/```(?:json)?/g, '').trim()
      parsed = JSON.parse(cleaned) as ImagePromptOutput
    } catch {
      throw new Error(`Image Prompt Builder: LLM returned invalid JSON: ${result.text.slice(0, 200)}`)
    }

    // Apply overrides from node config
    if (cfg.aspect_ratio_override && cfg.aspect_ratio_override !== 'auto') {
      parsed.aspectRatio = cfg.aspect_ratio_override as ImagePromptOutput['aspectRatio']
    }

    return {
      output: parsed,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
