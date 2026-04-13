/**
 * videoResize.ts
 *
 * Crop and scale a video to a social-platform aspect ratio using ffmpeg.
 * Smart center-crop: scales up to fill the target AR, then crops to exact dimensions.
 * Accepts input from: Video Upload, Video Composition, Video Generation, Video Trimmer,
 * or any node that outputs { storageKey }.
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

// ─── Presets ──────────────────────────────────────────────────────────────────

export interface VideoResizePreset {
  label:    string
  width:    number
  height:   number
  platform: string
}

export const VIDEO_RESIZE_PRESETS: Record<string, VideoResizePreset> = {
  'reels':       { label: 'Reels / TikTok / Shorts (9:16)', width: 1080, height: 1920, platform: 'Instagram / TikTok / YouTube' },
  'square':      { label: 'Square (1:1)',                   width: 1080, height: 1080, platform: 'Instagram / Facebook' },
  'instagram45': { label: 'Instagram Feed (4:5)',           width: 1080, height: 1350, platform: 'Instagram' },
  'landscape':   { label: 'Landscape (16:9)',               width: 1920, height: 1080, platform: 'YouTube / Twitter / LinkedIn' },
  'custom':      { label: 'Custom',                         width: 0,    height: 0,    platform: '' },
}

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

export class VideoResizeExecutor extends NodeExecutor {
  async execute(
    input:  unknown,
    config: Record<string, unknown>,
    _ctx:   NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const ref = extractVideoRef(input)
    if (!ref) {
      throw new Error('Social Video Resizer: no video found — connect a Video Upload, Video Composition, or Video Generation node')
    }

    const preset = (config.preset as string) ?? 'reels'
    let targetW: number
    let targetH: number

    if (preset === 'custom') {
      targetW = Math.max(2, (config.width  as number) ?? 1080)
      targetH = Math.max(2, (config.height as number) ?? 1920)
      // ffmpeg requires even dimensions
      if (targetW % 2 !== 0) targetW++
      if (targetH % 2 !== 0) targetH++
    } else {
      const p = VIDEO_RESIZE_PRESETS[preset]
      if (!p) throw new Error(`Social Video Resizer: unknown preset "${preset}"`)
      targetW = p.width
      targetH = p.height
    }

    const crf     = Math.min(51, Math.max(0, (config.crf as number) ?? 23))
    const preset_ = (config.encode_preset as string) ?? 'fast'

    const tmpDir   = os.tmpdir()
    let inputPath: string
    let tempInput: string | null = null

    if (isS3Mode()) {
      const ext = (ref.filename ?? ref.storageKey).split('.').pop()?.toLowerCase() ?? 'mp4'
      tempInput = path.join(tmpDir, `resize_in_${randomUUID()}.${ext}`)
      await downloadToFile(ref.storageKey, tempInput)
      inputPath = tempInput
    } else {
      const candidate = ref.localPath
        ? path.join(process.env.UPLOAD_DIR ?? UPLOAD_DIR, ref.localPath.replace(/^\/files\//, ''))
        : path.join(process.env.UPLOAD_DIR ?? UPLOAD_DIR, ref.storageKey)
      if (!fs.existsSync(candidate)) {
        throw new Error(`Social Video Resizer: source file not found on disk (${ref.storageKey})`)
      }
      inputPath = candidate
    }

    const outputFilename = `resized_${targetW}x${targetH}_${randomUUID()}.mp4`
    const outputTmp      = path.join(tmpDir, outputFilename)

    // Smart center-crop: scale up to fill target AR, then crop to exact size.
    // scale=${targetW}:${targetH}:force_original_aspect_ratio=increase  → fills the frame
    // crop=${targetW}:${targetH}                                         → center-crops to exact
    const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`

    const cmd = [
      'ffmpeg -y',
      `-i "${inputPath}"`,
      `-vf "${vf}"`,
      `-c:v libx264 -preset ${preset_} -crf ${crf}`,
      '-c:a aac -b:a 128k',
      '-movflags +faststart',
      `"${outputTmp}"`,
    ].join(' ')

    try {
      await execAsync(cmd, { timeout: 600_000 })
    } finally {
      if (tempInput) try { fs.unlinkSync(tempInput) } catch { /* ignore */ }
    }

    const videoBuffer = fs.readFileSync(outputTmp)
    fs.unlinkSync(outputTmp)

    const storageKey = await saveGeneratedFile(videoBuffer, outputFilename, 'video/mp4')
    const localPath  = `/files/generated/${outputFilename}`

    console.log(`[video-resize] ${ref.storageKey} → ${targetW}×${targetH} (${preset}) → ${outputFilename}`)

    return {
      output: {
        storageKey,
        localPath,
        filename: outputFilename,
        width:    targetW,
        height:   targetH,
        preset,
        type:     'video',
      },
    }
  }
}
