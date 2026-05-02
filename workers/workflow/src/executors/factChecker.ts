import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export class FactCheckerExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    if (!content.trim()) throw new Error('Fact Checker: no content received from upstream node')

    const { provider: regProvider, model: regModel } = await getModelForRole('scoring_review')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.1,
      max_tokens: 4096,
    }

    const checkMode  = (config.checkMode  as string) ?? 'claims_statistics'
    const action     = (config.action     as string) ?? 'annotate'
    const sensitivity = (config.sensitivity as string) ?? 'medium'

    const checkModeInstructions: Record<string, string> = {
      claims_statistics: 'Focus on numerical data (statistics, percentages, dates, dollar amounts), attributed quotes, and specific factual assertions. Do not flag general opinion or hedged language.',
      all_statements:    'Check all factual claims including general statements about industries, products, events, best practices, and cause-and-effect assertions.',
      statistics_only:   'Check ONLY numerical data: statistics, percentages, figures, dates, and quantities. Ignore all other claims.',
    }

    const sensitivityInstructions: Record<string, string> = {
      low:    'Flag only claims that appear factually incorrect based on your training knowledge. Do not flag claims just because they lack a citation.',
      medium: 'Flag claims that are unverifiable (no named source, vague attribution) OR that appear inaccurate. Flag statistics without context.',
      high:   'Flag any claim that does not have a specific, named citation. Flag vague attributions like "studies show" or "experts say".',
    }

    const actionInstructions: Record<string, string> = {
      annotate:    'Return the original content with inline annotations after each flagged claim using this format: [FLAG: reason | suggested action]',
      remove:      'Return the content with flagged claims removed. After each removal insert: [REMOVED: brief description of removed claim]',
      placeholder: 'Return the content with flagged claims replaced by: [VERIFY: description of what needs to be verified or sourced]',
    }

    const prompt = `You are a rigorous fact-checker reviewing content for accuracy and verifiability.

CHECK MODE: ${checkModeInstructions[checkMode] ?? checkModeInstructions['claims_statistics']}

SENSITIVITY: ${sensitivityInstructions[sensitivity] ?? sensitivityInstructions['medium']}

ACTION: ${actionInstructions[action] ?? actionInstructions['annotate']}

After processing the content, append a ## FACT CHECK SUMMARY section. List each flagged item in this exact format:

**Claim:** [the flagged claim or a short paraphrase]
**Reason:** [why it was flagged]
**Action:** [suggested action]

Separate each item with a blank line. If no items were flagged, write "No issues found."

Note: You are evaluating based on your training knowledge only — you do not have access to live search.

CONTENT TO CHECK:
${content.slice(0, 6000)}`

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
