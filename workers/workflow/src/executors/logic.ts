import { callModel, type ModelConfig } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface LogicNodeConfig {
  provider: 'anthropic' | 'ollama'
  model: string
  /** Env var name holding the API key */
  api_key_ref: string
  system_prompt?: string
  temperature?: number
  max_tokens?: number
  /**
   * Prompt template. Use {{input}} as a placeholder for the upstream content.
   * Defaults to just passing the input directly.
   */
  prompt_template?: string
}

function buildPrompt(template: string | undefined, input: unknown): string {
  const inputStr =
    typeof input === 'string'
      ? input
      : Array.isArray(input)
      ? input.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n\n')
      : JSON.stringify(input)

  if (!template) return inputStr
  return template.replace('{{input}}', inputStr)
}

/**
 * Logic node — calls the AI provider abstraction with upstream content.
 *
 * All AI calls go through packages/ai/src/provider.ts per architectural rule #4.
 */
export class LogicNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as LogicNodeConfig

    if (!cfg.provider || !cfg.model) {
      throw new Error(
        `Logic node ${ctx.nodeId}: config must include provider and model`
      )
    }

    const modelConfig: ModelConfig = {
      provider: cfg.provider,
      model: cfg.model,
      api_key_ref: cfg.api_key_ref ?? '',
      system_prompt: cfg.system_prompt,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
    }

    const prompt = buildPrompt(cfg.prompt_template, input)
    const result = await callModel(modelConfig, prompt)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
