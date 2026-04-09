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
  /** Frontend saves prompt as 'prompt' — executor accepts both */
  prompt?: string
  /** Additional instructions appended after the main prompt */
  additional_instructions?: string
  /** Task type label from the frontend (expand/summarize/etc.) */
  task_type?: string
}

function buildPrompt(template: string | undefined, input: unknown): string {
  const inputStr =
    typeof input === 'string'
      ? input
      : Array.isArray(input)
      ? input.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n\n---\n\n')
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

    const defaultKeyRef = cfg.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : ''
    const modelConfig: ModelConfig = {
      provider: cfg.provider,
      model: cfg.model,
      api_key_ref: cfg.api_key_ref || defaultKeyRef,
      system_prompt: cfg.system_prompt,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
    }

    const baseTemplate = cfg.prompt_template ?? cfg.prompt
    const additionalInstructions = cfg.additional_instructions

    // Build the final prompt: instructions first, then the input content
    let fullTemplate: string | undefined
    if (baseTemplate && additionalInstructions) {
      fullTemplate = `${additionalInstructions}\n\n${baseTemplate}`
    } else if (additionalInstructions && !baseTemplate) {
      fullTemplate = `${additionalInstructions}\n\n{{input}}`
    } else {
      fullTemplate = baseTemplate
    }

    const prompt = buildPrompt(fullTemplate, input)
    const result = await callModel(modelConfig, prompt)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
