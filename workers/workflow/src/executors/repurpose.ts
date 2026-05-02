import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const FORMAT_SPECS: Record<string, { label: string; instruction: string }> = {
  linkedin_post: {
    label: 'LinkedIn Post',
    instruction: 'A LinkedIn post with a strong hook, 2–3 body paragraphs, and a CTA. 150–300 words. Personal, direct tone.',
  },
  twitter_thread: {
    label: 'X/Twitter Thread',
    instruction: 'A Twitter/X thread of 5–8 numbered tweets. Each tweet MUST be under 280 characters. Start tweet 1 with a hook. End the thread with a takeaway tweet.',
  },
  email_newsletter: {
    label: 'Email Newsletter Intro',
    instruction: 'An email newsletter intro with: Subject: [subject line], Preview: [preview text], then a 150-word intro paragraph that draws readers in and sets up the rest of the email.',
  },
  executive_summary: {
    label: 'Executive Summary',
    instruction: 'Exactly 5 bullet points. Each bullet is one complete sentence capturing a key insight or action. No sub-bullets.',
  },
  pull_quotes: {
    label: 'Pull Quotes',
    instruction: '3–5 standalone pull quotes suitable for social media or design callouts. Each quote should be a single sentence or short paragraph extracted or lightly rephrased from the content. No attribution needed.',
  },
  video_script: {
    label: 'Short-form Video Script',
    instruction: 'A 60-second video script in three sections: HOOK (15 seconds — the opening grab), KEY POINT (35 seconds — the core message with one specific example), CTA (10 seconds — what the viewer should do next). Include direction cues in [brackets].',
  },
}

export class RepurposeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    if (!content.trim()) throw new Error('Repurpose: no content received from upstream node')

    const { provider: regProvider, model: regModel } = await getModelForRole('generation_primary')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.6,
      max_tokens: 4096,
    }

    const selectedFormats = ((config.targetFormats as string[]) ?? []).filter(
      (f) => FORMAT_SPECS[f],
    )
    if (selectedFormats.length === 0) {
      throw new Error('Repurpose: select at least one target format')
    }

    const preserveBrandVoice = (config.preserveBrandVoice as boolean) ?? true
    const voiceInstruction = preserveBrandVoice
      ? 'Preserve the tone, terminology, and voice of the original content. Do not default to generic marketing language.'
      : 'Write each format in a clear, engaging style appropriate for the format.'

    const formatSections = selectedFormats
      .map((f) => `## ${FORMAT_SPECS[f].label}\n${FORMAT_SPECS[f].instruction}`)
      .join('\n\n')

    const prompt = `You are a content strategist repurposing long-form content into shorter formats.

${voiceInstruction}

Source content (use this as the basis for all formats below):
${content.slice(0, 6000)}

---

Generate each of the following formats. Use the exact header shown (##) for each section. Follow the format specifications precisely.

${formatSections}`

    const result = await callModel({ ...modelCfg }, prompt)

    return {
      output:       result.text.trim(),
      tokensUsed:   result.tokens_used,
      inputTokens:  result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed:    result.model_used,
    }
  }
}
