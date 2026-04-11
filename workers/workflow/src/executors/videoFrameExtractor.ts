import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { saveGeneratedFile } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')

interface VideoFile {
  id: string
  name: string
  storageKey: string
}

export class VideoFrameExtractorExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const videoFiles = (config.video_files as VideoFile[]) ?? []
    const timestampMode = (config.timestamp_mode as string) ?? 'percent'
    const timestampValue = (config.timestamp_value as number) ?? 50

    if (videoFiles.length === 0) {
      throw new Error('Video Frame Extractor: no video file configured — upload a video in the node config')
    }

    // Verify ffmpeg is available
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' })
    } catch {
      throw new Error('ffmpeg is not installed on this server — required for video frame extraction')
    }

    const videoFile = videoFiles[0]
    const filePath = join(UPLOAD_DIR, videoFile.storageKey)

    if (!existsSync(filePath)) {
      throw new Error(`Video file not found on disk: ${videoFile.storageKey}`)
    }

    // Get video duration via ffprobe
    let durationSecs = 60
    try {
      const result = execSync(
        `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf8', timeout: 15000 },
      )
      const parsed = parseFloat(result.trim())
      if (!isNaN(parsed) && parsed > 0) durationSecs = parsed
    } catch {
      // Fallback to 60s — frame extraction will still work, just at a best-guess position
    }

    // Calculate seek position
    let seekSecs: number
    if (timestampMode === 'percent') {
      seekSecs = (Math.min(100, Math.max(0, timestampValue)) / 100) * durationSecs
    } else {
      seekSecs = Math.min(timestampValue, Math.max(0, durationSecs - 0.1))
    }
    seekSecs = Math.max(0, seekSecs)

    // Extract frame to a temp location inside UPLOAD_DIR
    const framesDir = join(UPLOAD_DIR, 'frames')
    mkdirSync(framesDir, { recursive: true })
    const frameFilename = `frame_${randomUUID()}.jpg`
    const framePath = join(framesDir, frameFilename)

    try {
      execSync(
        `ffmpeg -y -ss ${seekSecs.toFixed(3)} -i "${filePath}" -vframes 1 -q:v 2 "${framePath}"`,
        { stdio: 'ignore', timeout: 30000 },
      )
    } catch (err) {
      throw new Error(
        `ffmpeg frame extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (!existsSync(framePath)) {
      throw new Error('Frame extraction completed but output file was not created')
    }

    // Read extracted frame and save to storage
    const frameBuffer = Buffer.from(readFileSync(framePath))
    const storageKey = await saveGeneratedFile(frameBuffer, frameFilename, 'image/jpeg')

    return {
      output: {
        storageKey,
        localPath: `/files/${storageKey}`,
        filename: frameFilename,
        videoName: videoFile.name,
        timestampSecs: Math.round(seekSecs * 10) / 10,
        durationSecs: Math.round(durationSecs),
      },
    }
  }
}
