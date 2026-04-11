import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { downloadToFile, saveGeneratedFile, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'
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
      const ext = videoFile.name.split('.').pop()?.toLowerCase() ?? 'mp4'
      tempFilePath = join(tmpdir(), `vid_${randomUUID()}.${ext}`)
      await downloadToFile(videoFile.storageKey, tempFilePath)
      const sizeBytes = statSync(tempFilePath).size
      console.log(`[video-frame-extractor] downloaded ${videoFile.name}: ${Math.round(sizeBytes / 1024 / 1024)}MB`)
      filePath = tempFilePath
    } else {
      filePath = join(UPLOAD_DIR, videoFile.storageKey)
      if (!existsSync(filePath)) {
        throw new Error(`Video file not found on disk: ${videoFile.storageKey}`)
      }
    }

    // Fix MP4 files where moov atom is at end of file (common with screen recorders).
    // Use a large probesize so ffmpeg scans the full file before giving up on the moov.
    const fixedPath = join(tmpdir(), `vid_fixed_${randomUUID()}.mp4`)
    let remuxOk = false
    try {
      execSync(
        `ffmpeg -y -probesize 500M -analyzeduration 500M -i "${filePath}" -c copy -movflags +faststart "${fixedPath}"`,
        { stdio: 'pipe', timeout: 120000 },
      )
      remuxOk = true
      if (tempFilePath) { try { unlinkSync(tempFilePath) } catch { /* ignore */ } }
      tempFilePath = fixedPath
      filePath = fixedPath
    } catch {
      try { unlinkSync(fixedPath) } catch { /* ignore */ }
    }

    if (!remuxOk) {
      // Validate whether ffprobe can even read the file — if not, it's genuinely corrupt
      try {
        execSync(`ffprobe -v error -i "${filePath}" -show_entries format=duration`, { stdio: 'pipe', timeout: 15000 })
      } catch {
        throw new Error(
          'Video file appears to be incomplete or corrupted (video metadata missing). ' +
          'This usually means the recording was interrupted before it finished writing. ' +
          'Please re-export or re-record the video and upload again.',
        )
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

    // Extract frame to a temp file (always use /tmp — UPLOAD_DIR may not exist in containers)
    const frameFilename = `frame_${randomUUID()}.jpg`
    const framePath = join(tmpdir(), frameFilename)

    try {
      execSync(
        `ffmpeg -y -ss ${seekSecs.toFixed(3)} -i "${filePath}" -vframes 1 -q:v 2 "${framePath}"`,
        { stdio: 'pipe', timeout: 30000 },
      )
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim() ?? ''
      throw new Error(
        `ffmpeg frame extraction failed: ${stderr || (err instanceof Error ? err.message : String(err))}`,
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
