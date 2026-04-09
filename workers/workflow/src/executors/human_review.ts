import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

/**
 * Human Review node — pauses the workflow and surfaces the input content
 * for a human to review and optionally edit before the run continues.
 *
 * If the input is a transcription session result, fetches the full
 * transcript text (with speaker names) from the database.
 */
export class HumanReviewNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    _config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = await this.resolveContent(input)

    return {
      output: content,
      waitingReview: true,
      reviewContent: content,
    }
  }

  private async resolveContent(input: unknown): Promise<string> {
    // If input looks like a transcription session result, fetch the transcript text
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const obj = input as Record<string, unknown>
      if (obj.sessionId && typeof obj.sessionId === 'string') {
        return this.fetchTranscriptText(obj.sessionId)
      }
    }

    if (typeof input === 'string') return input
    if (Array.isArray(input)) {
      return input.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n\n')
    }
    return JSON.stringify(input, null, 2)
  }

  private async fetchTranscriptText(sessionId: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segments = await (prisma.transcriptSegment as any).findMany({
      where: { sessionId },
      orderBy: { startMs: 'asc' },
      select: { speaker: true, speakerName: true, startMs: true, text: true },
    }) as Array<{ speaker: string | null; speakerName: string | null; startMs: number; text: string }>

    if (segments.length === 0) return `[Transcript session ${sessionId} — no segments found]`

    return segments
      .map((seg) => {
        const name = seg.speakerName ?? (seg.speaker ? `Speaker ${seg.speaker}` : 'Unknown')
        const time = this.formatMs(seg.startMs)
        return `[${time}] ${name}: ${seg.text}`
      })
      .join('\n\n')
  }

  private formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
}
