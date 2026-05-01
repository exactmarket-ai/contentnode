import { callModel } from '@contentnode/ai'
import { getModelForRole } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export interface InstructionObject {
  role_context: string
  audience: string
  tone: string
  strategic_direction: string
  visual_language: string
  constraints: string[]
  gaps: string[]
  confidence: Record<string, 'direct' | 'inferred'>
}

export class InstructionTranslatorExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const rawText = (config.raw_text as string | undefined)?.trim()
    if (!rawText) throw new Error('Instruction Translator: no brief or notes provided')
    const { model: regModel } = await getModelForRole('brain_processing')

    const prompt = `You are an expert content strategist. Analyze the following brief, notes, or instructions and extract a structured instruction object.

Return ONLY valid JSON with no markdown fences, matching this exact shape:
{
  "role_context": "the role or context for the content creator",
  "audience": "the target audience description",
  "tone": "the tone and voice requirements",
  "strategic_direction": "the core strategic goal or message",
  "visual_language": "visual style, formatting, or media guidance (empty string if not mentioned)",
  "constraints": ["hard constraints — things the content must or must not do"],
  "gaps": ["information missing from the brief that would improve the output"],
  "confidence": {
    "role_context": "direct",
    "audience": "direct",
    "tone": "inferred",
    "strategic_direction": "direct",
    "visual_language": "inferred",
    "constraints": "direct",
    "gaps": "direct"
  }
}

Use "direct" if the information was explicitly stated in the brief, "inferred" if you derived it from context.
If a field has no relevant information, use an empty string or empty array.

Brief / Notes:
${rawText}`

    const result = await callModel(
      {
        provider: 'anthropic',
        model: regModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        temperature: 0.2,
        max_tokens: 1200,
      },
      prompt,
    )

    let parsed: InstructionObject
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      parsed = JSON.parse(jsonMatch[0]) as InstructionObject
    } catch {
      throw new Error(`Instruction Translator: failed to parse AI response — ${result.text.slice(0, 200)}`)
    }

    return { output: parsed, tokensUsed: result.tokens_used, inputTokens: result.input_tokens, outputTokens: result.output_tokens }
  }
}
