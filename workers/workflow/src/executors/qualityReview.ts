import { callModel, type ModelConfig } from '@contentnode/ai'
import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface QualityReviewConfig {
  goal: string
  rubric?: string
  insight_threshold?: number  // score below this creates an insight (default 7)
  auto_create_insight?: boolean
  provider?: 'anthropic' | 'ollama'
  model?: string
  api_key_ref?: string
}

interface QualityReviewOutput {
  score: number
  strengths: string[]
  weaknesses: string[]
  overall_critique: string
  improved_prompt: string
  content_suggestions: string
  insight_created?: boolean
}

export class QualityReviewNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as QualityReviewConfig

    if (!cfg.goal) {
      throw new Error(`Quality Review node ${ctx.nodeId}: "goal" is required`)
    }

    const contentStr =
      typeof input === 'string'
        ? input
        : JSON.stringify(input)

    const threshold = cfg.insight_threshold ?? 7
    const autoInsight = cfg.auto_create_insight !== false

    const modelConfig: ModelConfig = {
      provider: cfg.provider ?? 'anthropic',
      model: cfg.model ?? 'claude-sonnet-4-6',
      api_key_ref: cfg.api_key_ref || 'ANTHROPIC_API_KEY',
      system_prompt: 'You are an expert content quality reviewer and prompt engineer. Always respond with valid JSON only.',
      temperature: 0.3,
    }

    const rubricSection = cfg.rubric
      ? `\nEvaluation Rubric:\n${cfg.rubric}`
      : ''

    const prompt = `You are evaluating AI-generated content against the stated goal.

Goal: ${cfg.goal}${rubricSection}

Content to evaluate:
${contentStr}

Respond with a JSON object (no markdown, no code fences) with exactly these fields:
{
  "score": <integer 1-10>,
  "strengths": [<string>, ...],
  "weaknesses": [<string>, ...],
  "overall_critique": "<2-3 sentence critique>",
  "improved_prompt": "<a better version of the instructions/prompt that would produce higher quality output>",
  "content_suggestions": "<specific improvements to make to this content>"
}`

    const result = await callModel(modelConfig, prompt)

    let reviewOutput: QualityReviewOutput
    try {
      // Strip markdown code fences the model sometimes adds despite instructions
      let jsonText = result.text.trim()
      const fenceMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/s)
      if (fenceMatch) jsonText = fenceMatch[1].trim()

      reviewOutput = JSON.parse(jsonText) as QualityReviewOutput
    } catch {
      reviewOutput = {
        score: 0,
        strengths: [],
        weaknesses: [],
        overall_critique: result.text,
        improved_prompt: '',
        content_suggestions: '',
      }
    }

    // Auto-create Insight if score is below threshold
    let insightCreated = false
    if (autoInsight && reviewOutput.score < threshold && ctx.agencyId && ctx.clientId) {
      try {
        await withAgency(ctx.agencyId, async () => {
          await prisma.insight.create({
            data: {
              agencyId: ctx.agencyId!,
              clientId: ctx.clientId!,
              type: 'structure',
              title: `Quality score ${reviewOutput.score}/10`,
              body: reviewOutput.overall_critique.slice(0, 120),
              suggestedNodeType: 'ai-generate',
              suggestedConfigChange: JSON.stringify({
                improved_prompt: reviewOutput.improved_prompt,
                content_suggestions: reviewOutput.content_suggestions,
              }),
              evidenceQuotes: [reviewOutput.overall_critique],
              instanceCount: 1,
              confidence: (10 - reviewOutput.score) / 10,
              status: 'pending',
            },
          })
        })
        insightCreated = true
      } catch (err) {
        console.error('[quality-review] failed to create insight:', err)
      }
    }

    return {
      output: { ...reviewOutput, insight_created: insightCreated },
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
