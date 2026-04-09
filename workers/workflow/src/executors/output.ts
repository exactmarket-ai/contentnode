import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

type OutputFormat = 'text' | 'html' | 'json' | 'markdown'

interface OutputNodeConfig {
  format?: OutputFormat
  /**
   * Optional wrapper template. Use {{content}} as placeholder.
   * Example: "<article>{{content}}</article>"
   */
  template?: string
  /** Human-readable label for this output (stored in result metadata) */
  label?: string
}

function applyTemplate(template: string | undefined, content: string): string {
  if (!template) return content
  return template.replace('{{content}}', content)
}

function coerceToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((v) => coerceToString(v))
      .join('\n\n')
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Any node that returns { content: string, ... } — extract the text
    if (typeof obj.content === 'string') {
      return obj.content
    }
  }
  return JSON.stringify(value, null, 2)
}

/**
 * Output node — formats the result of upstream logic nodes.
 *
 * For JSON format the content is parsed back into an object if possible.
 * For all other formats the content is returned as a string.
 */
export class OutputNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const cfg = config as OutputNodeConfig
    const format: OutputFormat = cfg.format ?? 'text'

    let content = coerceToString(input)
    content = applyTemplate(cfg.template, content)

    let finalOutput: unknown = content

    if (format === 'json') {
      try {
        finalOutput = JSON.parse(content)
      } catch {
        // Not valid JSON — wrap it so downstream consumers can still read it
        finalOutput = { text: content, parseError: true }
      }
    }

    return {
      output: {
        format,
        content: finalOutput,
        label: cfg.label ?? `output-${ctx.nodeId}`,
      },
    }
  }
}
