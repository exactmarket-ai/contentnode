import { PDFDocument } from 'pdf-lib'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import { uploadBuffer } from '@contentnode/storage'

export interface PdfAssemblerInput {
  // Each item is either a { pdfBytes: number[] } from StoryboardComposer
  // or a serialised Buffer / Uint8Array
  pages: Array<{ pdfBytes: number[] } | number[]>
  filename?: string
}

/**
 * PDF Assembler — merges an ordered array of single-page PDF buffers into
 * one combined PDF and uploads it to storage.
 *
 * Input: { pages: Array<{ pdfBytes: number[] }>, filename?: string }
 * Output: { storageKey: string, localPath: string, pageCount: number }
 */
export class PdfAssemblerExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const data = input as PdfAssemblerInput
    if (!data?.pages?.length) {
      throw new Error('PDF Assembler received no pages.')
    }

    const combined = await PDFDocument.create()

    for (const page of data.pages) {
      const bytes = Array.isArray(page) ? page : (page as { pdfBytes: number[] }).pdfBytes
      if (!bytes?.length) continue
      const src = await PDFDocument.load(new Uint8Array(bytes))
      const [copied] = await combined.copyPages(src, [0])
      combined.addPage(copied)
    }

    const pdfBytes = await combined.save()

    const filename  = (data.filename ?? (config.filename as string | undefined) ?? `storyboard_${ctx.workflowRunId}.pdf`)
    const storageKey = `storyboards/${ctx.agencyId}/${filename}`

    await uploadBuffer(storageKey, Buffer.from(pdfBytes), 'application/pdf')

    const localPath = `/files/${storageKey}`
    console.log(`[pdfAssembler] assembled ${combined.getPageCount()} page(s) → ${storageKey}`)

    return {
      output: {
        storageKey,
        localPath,
        pageCount: combined.getPageCount(),
        filename,
      },
    }
  }
}
