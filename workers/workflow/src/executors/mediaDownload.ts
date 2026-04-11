import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

/**
 * Media Download output node — receives an image or video file reference from
 * upstream (e.g. Video Frame Extractor) and passes it through as the node's
 * output so the frontend config panel can render a preview and download button.
 */
export class MediaDownloadExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    _config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    if (!input) {
      throw new Error('Media Download: no file received from upstream node')
    }

    // Pass through the file reference as-is
    return { output: input }
  }
}
