import mammoth from 'mammoth'
import { downloadBuffer } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export interface DocxReaderConfig {
  storageKey?: string
}

/**
 * DOCX Reader — downloads a .docx (or .txt/.md) by storageKey and returns plain text.
 *
 * Input:  string | { storageKey: string } | null
 * Output: string — raw extracted text
 *
 * storageKey resolution order:
 *   1. config.storageKey
 *   2. input.storageKey  (if input is an object)
 *   3. input as string   (if input is already a storage key / plain text)
 */
export class DocxReaderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as DocxReaderConfig

    let storageKey: string | undefined = cfg.storageKey

    if (!storageKey && input && typeof input === 'object') {
      storageKey = (input as Record<string, unknown>).storageKey as string | undefined
    }

    if (!storageKey && typeof input === 'string' && input.trim()) {
      // Input is plain text already — pass through
      console.log('[docx-reader] input is plain text — passing through')
      return { output: input }
    }

    if (!storageKey) {
      throw new Error('DocxReader: no storageKey provided — set config.storageKey or pass { storageKey } as input.')
    }

    console.log(`[docx-reader] downloading ${storageKey}`)
    const buffer = await downloadBuffer(storageKey)

    const ext = storageKey.split('.').pop()?.toLowerCase() ?? ''
    let text: string

    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else {
      text = buffer.toString('utf8')
    }

    if (!text.trim()) {
      throw new Error(`DocxReader: extracted text is empty from "${storageKey}"`)
    }

    console.log(`[docx-reader] extracted ${text.length} chars from ${storageKey}`)
    return { output: text }
  }
}
