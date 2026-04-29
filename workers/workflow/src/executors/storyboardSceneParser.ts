import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'

export interface StoryboardSceneParserConfig {
  modelConfig?: { provider?: string; model?: string; apiKeyRef?: string }
}

const SYSTEM_PROMPT = `You are a storyboard pre-production assistant.
You will receive the plain text of a video script and must extract every scene as structured JSON.

Return ONLY a JSON array — no markdown fences, no commentary.

Each element:
{
  "sceneNumber": <number, 1-indexed>,
  "timecode": <string, e.g. "0:00–0:05" or empty "">,
  "onScreenText": <string, on-screen title / lower-third / text overlay for this scene>,
  "voiceover": <string, spoken narration for this scene, or "">,
  "animationNotes": <string, camera movement, graphic, animation direction>,
  "sectionLabel": <string, the section or beat name, e.g. "The Hook" / "Problem Statement">
}

Rules:
- Include every scene. Do not skip any.
- If the script has section headings (e.g. "HOOK", "PROBLEM", "CTA"), use them as sectionLabel.
  Otherwise derive a short label from the scene content.
- If a field is absent in the source text, use an empty string — never null.
- sceneNumber must be a plain integer, not a string.`

export class StoryboardSceneParserExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const text = typeof input === 'string' ? input.trim() : ''
    if (!text) {
      throw new Error('StoryboardSceneParser: received empty input — expected plain-text video script.')
    }

    const cfg = config as StoryboardSceneParserConfig
    const modelConfig = cfg.modelConfig ?? {}

    console.log('[storyboard-scene-parser] parsing script with Claude...')

    const result = await callModel(
      {
        provider: ((modelConfig as Record<string, unknown>).provider as 'anthropic' | 'openai' | 'ollama') ?? 'anthropic',
        model: (modelConfig as Record<string, unknown>).model as string ?? 'claude-sonnet-4-6',
        api_key_ref: (modelConfig as Record<string, unknown>).apiKeyRef as string | undefined,
        max_tokens: 4096,
        temperature: 0,
      },
      `${SYSTEM_PROMPT}\n\n---\n\n${text}`,
    )

    const raw = result.text.trim()

    let scenes: SceneObject[]
    try {
      const parsed = JSON.parse(raw) as unknown[]
      scenes = parsed.map((s, i) => {
        const obj = s as Record<string, unknown>
        return {
          sceneNumber: typeof obj.sceneNumber === 'number' ? obj.sceneNumber : i + 1,
          timecode:       String(obj.timecode      ?? ''),
          onScreenText:   String(obj.onScreenText  ?? ''),
          voiceover:      String(obj.voiceover     ?? ''),
          animationNotes: String(obj.animationNotes ?? ''),
          sectionLabel:   String(obj.sectionLabel  ?? `Scene ${i + 1}`),
          version: 'A' as const,
        }
      })
    } catch (e) {
      throw new Error(`StoryboardSceneParser: failed to parse Claude JSON response — ${(e as Error).message}\n\nRaw: ${raw.slice(0, 500)}`)
    }

    if (scenes.length === 0) {
      throw new Error('StoryboardSceneParser: Claude returned 0 scenes.')
    }

    console.log(`[storyboard-scene-parser] parsed ${scenes.length} scene(s)`)
    return { output: scenes, tokensUsed: result.tokens_used }
  }
}
