import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { downloadBuffer, saveGeneratedFile, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface VideoFile {
  id: string
  name: string
  storageKey: string
}

interface VideoRef {
  storageKey: string
  filename?: string
}

function extractUpstreamVideoRef(input: unknown): VideoRef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return { storageKey: obj.storageKey, filename: typeof obj.filename === 'string' ? obj.filename : undefined }
  }
  return null
}

export class VideoFrameExtractorExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const timestampMode = (config.timestamp_mode as string) ?? 'percent'
    const timestampValue = (config.timestamp_value as number) ?? 50
    const videoContext = (config.video_context as string) ?? ''

    // Prefer upstream input (when used as a logic node downstream of Video Upload)
    const upstreamRef = extractUpstreamVideoRef(input)
    let videoFile: VideoFile

    if (upstreamRef) {
      videoFile = { id: 'upstream', name: upstreamRef.filename ?? 'video.mp4', storageKey: upstreamRef.storageKey }
    } else {
      const videoFiles = (config.video_files as VideoFile[]) ?? []
      if (videoFiles.length === 0) {
        throw new Error('Video Frame Extractor: no video file — connect a Video Upload node or upload a file in the config')
      }
      videoFile = videoFiles[0]
    }

    // Verify ffmpeg is available
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' })
    } catch {
      throw new Error('ffmpeg is not installed on this server — required for video frame extraction')
    }

    // Resolve video file path — in S3/R2 mode download to a temp file for ffmpeg
    let filePath: string
    let tempFilePath: string | null = null

    if (isS3Mode()) {
      const buffer = await downloadBuffer(videoFile.storageKey)
      const ext = videoFile.name.split('.').pop()?.toLowerCase() ?? 'mp4'
      tempFilePath = join(tmpdir(), `vid_${randomUUID()}.${ext}`)
      writeFileSync(tempFilePath, buffer)
      filePath = tempFilePath
    } else {
      filePath = join(UPLOAD_DIR, videoFile.storageKey)
      if (!existsSync(filePath)) {
        throw new Error(`Video file not found on disk: ${videoFile.storageKey}`)
      }
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

    // Clean up temp files
    try { unlinkSync(framePath) } catch { /* ignore */ }
    if (tempFilePath) { try { unlinkSync(tempFilePath) } catch { /* ignore */ } }

    // Build the text output that downstream AI nodes will use
    const contextLines: string[] = []
    contextLines.push(`Video: ${videoFile.name}`)
    if (videoContext.trim()) contextLines.push(`\n${videoContext.trim()}`)

    return {
      output: {
        storageKey,
        localPath: `/files/${storageKey}`,
        filename: frameFilename,
        videoName: videoFile.name,
        timestampSecs: Math.round(seekSecs * 10) / 10,
        durationSecs: Math.round(durationSecs),
        // text field is what downstream nodes receive as their input
        text: contextLines.join('\n'),
      },
    }
  }
}
