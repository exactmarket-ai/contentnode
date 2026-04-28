import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export interface VideoScriptReaderConfig {
  source?: 'kit_session' | 'file_upload' | 'passthrough'
  kitSessionId?: string
  // asset index in generatedFiles.assets — defaults to 5 (Video Script)
  assetIndex?: number
}

/**
 * Reads a video script from a KitSession generated asset or passes through
 * the upstream input string directly.
 *
 * Output: raw markdown/HTML string of the video script content.
 */
export class VideoScriptReaderExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const cfg = config as unknown as VideoScriptReaderConfig
    const source = cfg.source ?? 'passthrough'

    if (source === 'kit_session' && cfg.kitSessionId) {
      const session = await prisma.kitSession.findUnique({
        where: { id: cfg.kitSessionId },
        select: { generatedFiles: true },
      })
      if (!session) throw new Error(`KitSession not found: ${cfg.kitSessionId}`)

      const files = session.generatedFiles as Record<string, unknown>
      const assets = (files.assets as Array<Record<string, unknown>>) ?? []
      const idx = cfg.assetIndex ?? 5
      const asset = assets[idx]

      if (!asset?.content) {
        throw new Error(`KitSession ${cfg.kitSessionId} asset[${idx}] has no content`)
      }
      return { output: asset.content as string }
    }

    // passthrough or file_upload — just forward the input
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    return { output: text }
  }
}
