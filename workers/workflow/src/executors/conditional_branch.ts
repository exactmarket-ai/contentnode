import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { DetectionOutput } from './detection.js'

// ─────────────────────────────────────────────────────────────────────────────
// Conditional Branch node executor — routes based on score / count / retries
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchOutput {
  route: 'pass' | 'fail'
  evaluated_value: number
  condition_type: string
  input: unknown
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function extractContent(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.output === 'string') return obj.output
  }
  return JSON.stringify(input)
}

export class ConditionalBranchNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const conditionType = (config.condition_type as string) ?? 'detection_score'
    const operator     = (config.operator       as string) ?? 'above'
    const threshold    = (config.value          as number) ?? 20

    let actualValue: number

    const inputObj = input as Partial<DetectionOutput & { retry_count?: number }>

    switch (conditionType) {
      case 'detection_score':
        actualValue = typeof inputObj?.overall_score === 'number' ? inputObj.overall_score : 0
        break
      case 'word_count':
        actualValue = wordCount(extractContent(input))
        break
      case 'retry_count':
        actualValue = typeof inputObj?.retry_count === 'number' ? inputObj.retry_count : 0
        break
      default:
        actualValue = 0
    }

    const conditionMet = operator === 'above' ? actualValue > threshold : actualValue < threshold
    // "above threshold" = fail (content is too AI-like), "below" = pass
    const route: 'pass' | 'fail' = conditionMet ? 'fail' : 'pass'

    const output: BranchOutput = {
      route,
      evaluated_value: actualValue,
      condition_type: conditionType,
      input,
    }

    return {
      output,
      routePath: route,
    }
  }
}
