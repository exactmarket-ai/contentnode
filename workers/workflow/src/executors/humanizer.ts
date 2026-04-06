import { callModel, type ModelConfig } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { DetectionOutput } from './detection.js'

// ─────────────────────────────────────────────────────────────────────────────
// Humanizer node executor — rewrites content to reduce AI detection score
// ─────────────────────────────────────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<string, string> = {
  'executive-natural':  'Write like a senior executive who values clarity and directness. Avoid corporate jargon.',
  'conversational':     'Write as you would speak to a knowledgeable friend. Use contractions, varied sentence lengths, and natural rhythm.',
  'confident-expert':   'Write with authoritative confidence. State opinions directly without hedging.',
  'premium-brand':      'Write with polished, sophisticated language. Elevated but not stuffy.',
  'founder-voice':      'Write with the energy and conviction of a startup founder who deeply believes in their mission.',
  'sales-polished':     'Write persuasively with a focus on outcomes and benefits. Professional but driven.',
  'journalistic-clean': 'Write in a clean, factual journalistic style. Lead with the news, be precise.',
  'social-native':      'Write for social media: punchy, engaging, formatted for quick scanning.',
  'custom':             'Follow the additional instructions provided.',
}

function buildSliderInstructions(sliders: Record<string, number>): string {
  const lines: string[] = []

  const map = (val: number, low: string, high: string) =>
    val < 33 ? `lean ${low}` : val > 66 ? `lean ${high}` : `balance between ${low} and ${high}`

  lines.push(`Naturalness: ${map(sliders.naturalness, 'structured', 'organic and unpredictable')}`)
  lines.push(`Energy: ${map(sliders.energy, 'calm and measured', 'vibrant and punchy')}`)
  lines.push(`Precision: ${map(sliders.precision, 'approximate and impressionistic', 'exact and specific')}`)
  lines.push(`Formality: ${map(sliders.formality, 'casual and relaxed', 'formal and polished')}`)
  lines.push(`Boldness: ${map(sliders.boldness, 'understated', 'assertive and direct')}`)
  lines.push(`Compression: ${map(sliders.compression, 'expansive and detailed', 'tight and concise')}`)
  lines.push(`Personality: ${map(sliders.personality, 'neutral', 'distinctly personal')}`)
  lines.push(`Safety: ${map(sliders.safety, 'edgy and unconventional', 'safe and broadly acceptable')}`)

  return lines.join('\n')
}

function buildFullRewritePrompt(
  content: string,
  mode: string,
  sliders: Record<string, number>,
): string {
  const modeDesc = MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['conversational']
  const sliderInstructions = buildSliderInstructions(sliders)

  return `You are a professional content humanizer. Rewrite the following content to read as naturally human-written while preserving all factual information and the core message.

VOICE STYLE:
${modeDesc}

STYLE PARAMETERS (adjust your writing accordingly):
${sliderInstructions}

RULES:
- Preserve all facts, claims, and information exactly
- Do NOT add new information or change the meaning
- Do NOT use common AI phrases like "furthermore", "moreover", "it is worth noting", "delve into", "tapestry", "multifaceted"
- Vary sentence length — mix short punchy sentences with longer ones
- Use active voice where possible
- Return ONLY the rewritten content, no preamble

CONTENT TO REWRITE:
${content}`
}

function buildTargetedRewritePrompt(
  content: string,
  flaggedSentences: string[],
  mode: string,
  sliders: Record<string, number>,
): string {
  const modeDesc = MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['conversational']
  const sliderInstructions = buildSliderInstructions(sliders)
  const flaggedList = flaggedSentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')

  return `You are a professional content humanizer. Rewrite ONLY the flagged sentences in the content below to read as naturally human-written. Leave all other sentences exactly as they appear.

VOICE STYLE:
${modeDesc}

STYLE PARAMETERS:
${sliderInstructions}

FLAGGED SENTENCES TO REWRITE:
${flaggedList}

RULES:
- ONLY rewrite the flagged sentences listed above — leave everything else word-for-word
- Preserve all facts and meaning
- Do NOT use: "furthermore", "moreover", "it is worth noting", "delve into", "tapestry", "multifaceted"
- Vary sentence length naturally
- Return the FULL content with only the flagged sentences replaced
- Do NOT add any preamble or explanation

FULL CONTENT:
${content}`
}

export class HumanizerNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    // Accept either a DetectionOutput or raw string/content
    const inputObj = input as Partial<DetectionOutput> | null
    const content: string =
      typeof inputObj?.content === 'string'
        ? inputObj.content
        : typeof input === 'string'
        ? input
        : JSON.stringify(input)

    const flaggedSentences: string[] | null =
      Array.isArray(inputObj?.flagged_sentences) ? (inputObj.flagged_sentences as string[]) : null

    const targetedRewrite = (config.targeted_rewrite as boolean) ?? true
    const mode = (config.mode as string) ?? 'executive-natural'

    const sliders: Record<string, number> = {
      naturalness:  (config.naturalness  as number) ?? 70,
      energy:       (config.energy       as number) ?? 60,
      precision:    (config.precision    as number) ?? 65,
      formality:    (config.formality    as number) ?? 50,
      boldness:     (config.boldness     as number) ?? 55,
      compression:  (config.compression  as number) ?? 40,
      personality:  (config.personality  as number) ?? 60,
      safety:       (config.safety       as number) ?? 80,
    }

    const useTargeted = targetedRewrite && flaggedSentences !== null && flaggedSentences.length > 0
    const prompt = useTargeted
      ? buildTargetedRewritePrompt(content, flaggedSentences!, mode, sliders)
      : buildFullRewritePrompt(content, mode, sliders)

    // Resolve model — node override takes priority, else fall back to env defaults
    const modelCfg = config.model_config as Record<string, unknown> | null
    const modelConfig: ModelConfig = {
      provider: ((modelCfg?.provider as string) ?? 'anthropic') as 'anthropic' | 'ollama',
      model:    (modelCfg?.model as string) ?? 'claude-sonnet-4-5',
      api_key_ref: 'ANTHROPIC_API_KEY',
      temperature: (modelCfg?.temperature as number) ?? 0.85,
    }

    const result = await callModel(modelConfig, prompt)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
