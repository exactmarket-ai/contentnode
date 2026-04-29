import { PDFDocument } from 'pdf-lib'
import { uploadBuffer } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { FramedScene } from './storyboardFrameGen.js'
import type { DocStyle } from '../kitGenerator.js'
import {
  getSharedBrowser,
  closeSharedBrowser,
  buildStoryboardPageHtml,
  buildStoryboardCoverHtml,
} from '../storyboardHtml.js'

export interface StoryboardPdfBuilderConfig {
  clientName?: string
  verticalName?: string
  filename?: string
  version?: string
}

/**
 * Storyboard PDF Builder — renders a cover + all framed scenes to a single PDF.
 *
 * Input:  FramedScene[]  (from storyboard-frame-gen)
 * Output: { storageKey, filename, sceneCount }
 */
export class StoryboardPdfBuilderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const framedScenes = Array.isArray(input) ? input as FramedScene[] : []
    if (framedScenes.length === 0) {
      throw new Error('StoryboardPdfBuilder: expected FramedScene[] from Frame Generator — got empty input.')
    }

    const cfg          = config as StoryboardPdfBuilderConfig
    const clientName   = cfg.clientName   || 'Client'
    const verticalName = cfg.verticalName || 'Vertical'
    const version      = cfg.version      || 'v1'
    const docStyle: DocStyle = { primaryColor: '#1B1F3B', secondaryColor: '#4A90D9', headingFont: 'sans-serif', bodyFont: 'sans-serif' }
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const pdfPages: Uint8Array[] = []
    const browser = await getSharedBrowser()

    try {
      // Cover page
      const coverPage = await browser.newPage()
      await coverPage.setContent(
        buildStoryboardCoverHtml({ clientName, verticalName, version, date, docStyle }),
        { waitUntil: 'networkidle0' },
      )
      pdfPages.push(await coverPage.pdf({ width: '1123px', height: '794px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }))
      await coverPage.close()

      // Scene pages
      const totalScenes = framedScenes.length
      for (const { scene, frameImageUrls } of framedScenes) {
        const scenePage = await browser.newPage()
        await scenePage.setContent(
          buildStoryboardPageHtml({ scene, frameImageUrls, docStyle, clientName, verticalName, totalScenes }),
          { waitUntil: 'networkidle0' },
        )
        pdfPages.push(await scenePage.pdf({ width: '1123px', height: '794px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }))
        await scenePage.close()
      }
    } finally {
      await closeSharedBrowser()
    }

    // Assemble
    const combined = await PDFDocument.create()
    for (const buf of pdfPages) {
      const src      = await PDFDocument.load(buf)
      const [copied] = await combined.copyPages(src, [0])
      combined.addPage(copied)
    }
    const pdfBytes = await combined.save()

    const safeName    = `${clientName} ${verticalName}`.replace(/[^a-zA-Z0-9 ]/g, '').trim()
    const pdfFilename = cfg.filename || `${safeName} - Video Storyboard Draft ${version}.pdf`
    const storageKey  = `storyboards/${ctx.agencyId}/${ctx.runId}/${pdfFilename}`

    await uploadBuffer(storageKey, Buffer.from(pdfBytes), 'application/pdf')

    console.log(`[storyboard-pdf-builder] uploaded ${storageKey} (${framedScenes.length} scenes)`)
    return {
      output: {
        storageKey,
        filename: pdfFilename,
        sceneCount: framedScenes.length,
        message: `Storyboard PDF ready — ${framedScenes.length} scenes. Storage key: ${storageKey}`,
      },
    }
  }
}
