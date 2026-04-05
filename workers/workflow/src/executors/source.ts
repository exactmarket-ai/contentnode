import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface SourceNodeConfig {
  /** ID of the Document to read parsed text from */
  documentId?: string
  /** Inline text to use when no documentId is provided (useful for testing) */
  inlineText?: string
}

/**
 * Source node — entry point for content.
 *
 * Reads `parsed_text` from a Document's metadata field and passes it
 * downstream. Falls back to `inlineText` from config if no documentId.
 */
export class SourceNodeExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const { documentId, inlineText } = config as SourceNodeConfig

    if (inlineText) {
      return { output: inlineText }
    }

    if (!documentId) {
      throw new Error(
        `Source node ${ctx.nodeId}: config must include documentId or inlineText`
      )
    }

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    })

    if (!doc) {
      throw new Error(
        `Source node ${ctx.nodeId}: document "${documentId}" not found`
      )
    }

    const meta = doc.metadata as Record<string, unknown>
    const parsedText = meta['parsed_text']

    if (typeof parsedText !== 'string') {
      throw new Error(
        `Source node ${ctx.nodeId}: document "${documentId}" has no parsed_text in metadata`
      )
    }

    return { output: parsedText }
  }
}
