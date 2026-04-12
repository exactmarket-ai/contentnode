import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─── Output type (same shape as VoiceOutput / MusicGeneration) ───────────────

export interface AudioInputResult {
  localPath:  string
  storageKey: string
  type:       'audio'
  filename?:  string
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class AudioInputNodeExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config:  Record<string, unknown>,
    _ctx:    NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const stored = config.stored_audio as {
      storageKey: string
      localPath:  string
      filename?:  string
    } | undefined

    if (!stored?.storageKey) {
      throw new Error('Audio Input: no audio file uploaded — open the node and upload a file first')
    }

    const result: AudioInputResult = {
      localPath:  stored.localPath,
      storageKey: stored.storageKey,
      type:       'audio',
      filename:   stored.filename,
    }

    return { output: result }
  }
}
