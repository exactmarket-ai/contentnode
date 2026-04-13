/**
 * videoTrimmer.ts
 *
 * Extract a time range from an upstream video using ffmpeg stream-copy (no re-encode).
 * Accepts input from: Video Upload, Video Composition, Video Generation, or any node
 * that outputs { storageKey, localPath? }.
 */

import { exec }        from 'node:child_process'
import { promisify }   from 'node:util'
import { randomUUID }  from 'node:crypto'
import path            from 'node:path'
import fs              from 'node:fs'
import os              from 'node:os'
import { downloadToFile, saveGeneratedFile, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const execAsync = promisify(exec)

// ─── Input resolution ─────────────────────────────────────────────────────────

interface VideoRef {
  storageKey: string
  filename?:  string
  localPath?: string
}

function extractVideoRef(input: unknown): VideoRef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return {
      storageKey: obj.storageKey,
      filename:   typeof obj.filename  === 'string' ? obj.filename  : undefined,
      localPath:  typeof obj.localPath === 'string' ? obj.localPath : undefined,
    }
  }
  return null
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export class VideoTrimmerExecutor extends NodeExecutor {
  async execute(
    input:  unknown,
    config: Record<string, unknown>,
    _ctx:   NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const ref = extractVideoRef(input)
    if (!ref) {
      throw new Error('Video Trimmer: no video found — connect a Video Upload, Video Composition, or Video Generation node')
    }

    const startSec = Math.max(0, (config.start_time as number) ?? 0)
    const trimMode = (config.trim_mode as string) ?? 'duration'   // 'duration' | 'end_time'
    const rawEnd   = (config.end_time   as number) ?? 10
    const rawDur   = (config.duration   as number) ?? 10

    let durationSec: number
    if (trimMode === 'end_time') {
      durationSec = Math.max(0.1, rawEnd - startSec)
    } else {
      durationSec = Math.max(0.1, rawDur)
    }

    const tmpDir   = os.tmpdir()
    let inputPath: string
    let tempInput: string | null = null

    if (isS3Mode()) {
      const ext = (ref.filename ?? ref.storageKey).split('.').pop()?.toLowerCase() ?? 'mp4'
      tempInput = path.join(tmpDir, `trim_in_${randomUUID()}.${ext}`)
      await downloadToFile(ref.storageKey, tempInput)
      inputPath = tempInput
    } else {
      // Local: resolve from UPLOAD_DIR or a generated-files path
      const candidate = ref.localPath
        ? path.join(process.env.UPLOAD_DIR ?? UPLOAD_DIR, ref.localPath.replace(/^\/files\//, ''))
        : path.join(process.env.UPLOAD_DIR ?? UPLOAD_DIR, ref.storageKey)
      if (!fs.existsSync(candidate)) {
        throw new Error(`Video Trimmer: source file not found on disk (${ref.storageKey})`)
      }
      inputPath = candidate
    }

    const outputFilename = `trimmed_${randomUUID()}.mp4`
    const outputTmp      = path.join(tmpDir, outputFilename)

    // Re-encode to guarantee exact frame-accurate trim.
    // Stream copy (-c copy) fails on videos with sparse keyframes (e.g. looped-image
    // compositions) because the container duration metadata is not updated correctly.
    // veryfast preset adds ~2-3s overhead for a typical clip — acceptable for trim accuracy.
    const cmd = [
      'ffmpeg -y',
      `-ss ${startSec}`,
      `-i "${inputPath}"`,
      `-t ${durationSec}`,
      '-c:v libx264 -preset veryfast -crf 23',
      '-c:a aac -b:a 128k',
      '-movflags +faststart',
      `"${outputTmp}"`,
    ].join(' ')

    try {
      await execAsync(cmd, { timeout: 300_000 })
    } finally {
      if (tempInput) try { fs.unlinkSync(tempInput) } catch { /* ignore */ }
    }

    const videoBuffer = fs.readFileSync(outputTmp)
    fs.unlinkSync(outputTmp)

    const storageKey = await saveGeneratedFile(videoBuffer, outputFilename, 'video/mp4')
    const localPath  = `/files/generated/${outputFilename}`

    console.log(`[video-trimmer] ${ref.storageKey} → ${startSec}s + ${durationSec}s → ${outputFilename}`)

    return {
      output: {
        storageKey,
        localPath,
        filename:    outputFilename,
        startSec,
        durationSec,
        type:        'video',
      },
    }
  }
}
