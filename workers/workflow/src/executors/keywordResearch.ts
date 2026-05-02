import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export class KeywordResearchExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const seedTopic = ((config.seedTopic as string) ?? '').trim()
    // Also accept seed topic piped in from upstream
    const upstreamSeed = typeof input === 'string' ? input.trim() : ''
    const topic = seedTopic || upstreamSeed

    if (!topic) throw new Error('Keyword Research: provide a seed topic or keyword')

    const { provider: regProvider, model: regModel } = await getModelForRole('research_synthesis')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.4,
      max_tokens: 4096,
    }

    const targetAudience       = ((config.targetAudience   as string)   ?? '').trim()
    const funnelStages         = ((config.funnelStages     as string[]) ?? ['all'])
    const outputVolume         = (config.outputVolume      as string)   ?? 'focused'
    const includeIntentLabels  = (config.includeIntentLabels as boolean) ?? true

    const keywordCount = outputVolume === 'comprehensive' ? '40–60' : '15–20'

    const audienceContext = targetAudience
      ? `Target audience: ${targetAudience}. Tailor keyword language and search behavior to this audience.`
      : 'Target a general professional audience.'

    const stagesContext = funnelStages.includes('all') || funnelStages.length === 0
      ? 'Cover all funnel stages: Awareness, Consideration, and Decision.'
      : `Focus on these funnel stages: ${funnelStages.join(', ')}.`

    const intentInstruction = includeIntentLabels
      ? 'Label each keyword with its search intent: Informational | Commercial | Transactional | Navigational'
      : 'Do not add intent labels.'

    const prompt = `You are an SEO strategist building a comprehensive keyword map for content planning.

Seed topic: ${topic}
${audienceContext}
${stagesContext}
Total keywords to generate: ${keywordCount}
${intentInstruction}

Output the keyword map in this exact structure:

## Keyword Research: ${topic}

### Primary Keyword
[Single best primary keyword for this topic — highest volume, clearest intent]
${includeIntentLabels ? 'Intent: [label]' : ''}

### Secondary Keywords (grouped by theme)

**[Theme Name]**
- [keyword] ${includeIntentLabels ? '| [intent]' : ''}
- [keyword] ${includeIntentLabels ? '| [intent]' : ''}

(repeat theme blocks for each cluster)

### Long-tail Variants
- [3+ word specific keyword phrase] ${includeIntentLabels ? '| [intent]' : ''}
(10–15 long-tail keywords)

### Question Keywords
- [question phrased as someone would search it] ${includeIntentLabels ? '| [intent]' : ''}
(8–12 question keywords — "how to", "what is", "why does", etc.)

### Funnel Distribution Summary
| Stage | Count | Example keyword |
|-------|-------|----------------|
| Awareness | X | ... |
| Consideration | X | ... |
| Decision | X | ... |

### Content Opportunities
3–5 specific content angles with highest potential based on this keyword map.`

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
