import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'

export interface StoryboardImagePromptBuilderConfig {
  clientName?: string
  verticalName?: string
  brandStyle?: string
  modelConfig?: { provider?: string; model?: string; apiKeyRef?: string }
}

interface SceneWithPrompt extends SceneObject {
  imagePrompt: string
}

const SYSTEM_PROMPT = `You are a visual director writing image generation prompts for a B2B video storyboard.

Given an array of scene objects, return a JSON array where each element is the original scene object
plus an "imagePrompt" field — a concise, vivid single-paragraph prompt for generating a storyboard frame.

Return ONLY valid JSON — no markdown fences, no commentary.

Each prompt must:
- Be 2–4 sentences, describing composition, lighting, and mood
- Match the sectionLabel / animation intent
- NOT include any text overlays, titles, or watermarks
- Use professional B2B visual language (clean, modern, aspirational)
- Reference the brand context provided`

export class StoryboardImagePromptBuilderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const scenes = Array.isArray(input) ? input as SceneObject[] : []
    if (scenes.length === 0) {
      throw new Error('StoryboardImagePromptBuilder: expected SceneObject[] — got empty input.')
    }

    const cfg = config as StoryboardImagePromptBuilderConfig
    const clientName   = cfg.clientName   || 'the client'
    const verticalName = cfg.verticalName || 'the industry'
    const brandStyle   = cfg.brandStyle   || 'modern, professional, clean'
    const modelConfig  = cfg.modelConfig  ?? {}

    const userPrompt = [
      `Brand context: ${clientName} — ${verticalName}. Visual style: ${brandStyle}.`,
      '',
      'Scenes:',
      JSON.stringify(scenes, null, 2),
    ].join('\n')

    console.log(`[storyboard-image-prompt-builder] writing prompts for ${scenes.length} scene(s)`)

    const result = await callModel(
      {
        provider: ((modelConfig as Record<string, unknown>).provider as 'anthropic' | 'openai' | 'ollama') ?? 'anthropic',
        model: (modelConfig as Record<string, unknown>).model as string ?? 'claude-sonnet-4-6',
        api_key_ref: (modelConfig as Record<string, unknown>).apiKeyRef as string | undefined,
        max_tokens: 4096,
        temperature: 0.3,
      },
      `${SYSTEM_PROMPT}\n\n${userPrompt}`,
    )

    const raw = result.text.trim()

    let scenesWithPrompts: SceneWithPrompt[]
    try {
      const parsed = JSON.parse(raw) as unknown[]
      scenesWithPrompts = parsed.map((s, i) => {
        const obj = s as Record<string, unknown>
        return { ...scenes[i], imagePrompt: String(obj.imagePrompt ?? '') }
      })
    } catch (e) {
      throw new Error(`StoryboardImagePromptBuilder: failed to parse JSON — ${(e as Error).message}\n\nRaw: ${raw.slice(0, 500)}`)
    }

    console.log(`[storyboard-image-prompt-builder] done — ${scenesWithPrompts.length} scene(s) with image prompts`)
    return { output: scenesWithPrompts, tokensUsed: result.tokens_used }
  }
}
