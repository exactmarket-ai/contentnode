import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export class InternalLinkSuggesterExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    if (!content.trim()) throw new Error('Internal Link Suggester: no content received from upstream node')

    const { provider: regProvider, model: regModel } = await getModelForRole('generation_fast')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.3,
      max_tokens: 2048,
    }

    const maxSuggestions = Math.min(15, Math.max(3, (config.maxSuggestions as number) ?? 5))
    const style          = (config.style          as string)   ?? 'anchor-text-only'
    const pageTypes      = ((config.pageTypes      as string[]) ?? []).filter(Boolean)

    const pageTypeContext = pageTypes.length > 0
      ? `The site has these page types available for internal linking: ${pageTypes.join(', ')}.`
      : 'Suggest destination page types based on what would most logically exist on the site.'

    const styleInstructions = {
      'anchor-text-only': `Return a numbered list of up to ${maxSuggestions} suggestions. For each:
Anchor text: [exact phrase from the content]
Why: [one sentence explaining why this is a strong link candidate]
Link to: [recommended destination page type]`,

      'inline-annotated': `Return the FULL content with up to ${maxSuggestions} anchor text opportunities marked inline using this format: [LINK: anchor text → destination page type]
After the annotated content, also include a numbered summary list of every suggested link.`,
    }

    const prompt = `You are an SEO specialist identifying internal linking opportunities in content.

${pageTypeContext}

Rules:
- Do not invent URLs. Suggest anchor text phrases and destination page types only.
- Choose anchor text that already exists verbatim in the content — do not rephrase.
- Prioritise phrases that describe a concept, product, or topic the site would logically have a page about.
- Avoid linking common words ("this", "here", "click") or overly long phrases (>6 words).
- Each suggestion must name the exact anchor text as it appears in the content.

OUTPUT FORMAT:
${styleInstructions[style as keyof typeof styleInstructions] ?? styleInstructions['anchor-text-only']}

CONTENT:
${content.slice(0, 5000)}`

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
