import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'
import type { DocStyle } from '../kitGenerator.js'
import {
  getSharedBrowser,
  closeSharedBrowser,
  buildStoryboardPageHtml,
  buildStoryboardCoverHtml,
} from '../storyboardHtml.js'

export { getSharedBrowser, closeSharedBrowser }

export interface StoryboardComposerConfig {
  clientName?: string
  verticalName?: string
  version?: string
}

export interface StoryboardPageInput {
  scene: SceneObject
  frameImageUrls: string[]
  docStyle: DocStyle
  clientName: string
  verticalName: string
  isCover?: boolean
  coverVersion?: string
  coverDate?: string
}

/**
 * Storyboard Page Composer — renders one storyboard page (or cover) to PDF bytes.
 *
 * Input: StoryboardPageInput object.
 * Output: { pdfBytes: number[] } — a single-page PDF as a number array (for JSON serialisation).
 */
export class StoryboardComposerExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const data = input as StoryboardPageInput
    if (!data || typeof data !== 'object') {
      throw new Error('StoryboardComposer expects a StoryboardPageInput object as input.')
    }

    const cfg = config as StoryboardComposerConfig
    const clientName   = data.clientName   || cfg.clientName   || 'Client'
    const verticalName = data.verticalName || cfg.verticalName || 'Vertical'

    const html = data.isCover
      ? buildStoryboardCoverHtml({
          clientName, verticalName,
          version:  data.coverVersion ?? 'v1',
          date:     data.coverDate    ?? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          docStyle: data.docStyle,
        })
      : buildStoryboardPageHtml({
          scene:          data.scene,
          frameImageUrls: data.frameImageUrls ?? [],
          docStyle:       data.docStyle,
          clientName, verticalName,
        })

    const browser = await getSharedBrowser()
    const page    = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const pdfBuffer = await page.pdf({
        width:           '1400px',
        height:          '1050px',
        printBackground: true,
        margin:          { top: '0', right: '0', bottom: '0', left: '0' },
      })
      return { output: { pdfBytes: Array.from(pdfBuffer) } }
    } finally {
      await page.close()
    }
  }
}
