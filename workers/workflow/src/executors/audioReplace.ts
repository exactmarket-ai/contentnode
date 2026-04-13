/**
 * audioReplace.ts
 *
 * Mix or replace the audio track on any upstream video.
 * Two modes:
 *   replace — discard the video's original audio, use the new audio track
 *             (looped if shorter than the video, trimmed if longer)
 *   mix     — blend the video's original audio with the new track at
 *             configurable volumes
 *
 * Accepts any video-bearing upstream node (Character Animation, Video
 * Composition, Video Generation, Video Trimmer, etc.) plus any audio-bearing
 * node (Music Generation, Audio Mix, Voice Output, Audio Input).
 */

import { exec }        from 'node:child_process'
import { promisify }   from 'node:util'
import { randomUUID }  from 'node:crypto'
import path            from 'node:path'
import fs              from 'node:fs'
import os              from 'node:os'
import {
  saveGeneratedFile,
  downloadToFile,
  isS3Mode,
  localPath as storagePath,
} from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const execAsync = promisify(exec)

// ─── Input resolution ─────────────────────────────────────────────────────────

interface StructuredInput {
  nodeId:    string
  nodeLabel: string
  nodeType:  string
  content:   unknown
}

interface ResolvedInputs {
  videoKey:       string | null
  videoLocalPath: string | null
  audioKey:       string | null
  audioLocalPath: string | null
}

function resolveInputs(input: unknown): ResolvedInputs {
  let videoKey:       string | null = null
  let videoLocalPath: string | null = null
  let audioKey:       string | null = null
  let audioLocalPath: string | null = null

  const items: StructuredInput[] = []

  if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).inputs)) {
    items.push(...((input as Record<string, unknown>).inputs as StructuredInput[]))
  } else if (Array.isArray(input)) {
    items.push(...(input as StructuredInput[]))
  } else if (input && typeof input === 'object') {
    // Single upstream node
    const o = input as Record<string, unknown>
    if (typeof o.storageKey === 'string') {
      if (o.type === 'video' || (typeof o.localPath === 'string' && /\.(mp4|mov|webm)$/i.test(o.localPath as string))) {
        videoKey = o.storageKey
        videoLocalPath = (o.localPath as string) ?? null
      } else if (o.type === 'audio' || typeof o.transcript === 'string') {
        audioKey = o.storageKey
        audioLocalPath = (o.localPath as string) ?? null
      }
    }
    return { videoKey, videoLocalPath, audioKey, audioLocalPath }
  }

  for (const item of items) {
    const c = item.content as Record<string, unknown> | null
    if (!c || typeof c.storageKey !== 'string') continue
    const key     = c.storageKey as string
    const lp      = (c.localPath as string | undefined) ?? null
    const isVideo = c.type === 'video' || (lp && /\.(mp4|mov|webm)$/i.test(lp))
    const isAudio = c.type === 'audio' || typeof c.transcript === 'string' ||
                    (lp && /\.(mp3|wav|m4a|ogg|aac)$/i.test(lp))

    if (isVideo && !videoKey) {
      videoKey = key
      videoLocalPath = lp
    } else if (isAudio && !audioKey) {
      audioKey = key
      audioLocalPath = lp
    }
  }

  return { videoKey, videoLocalPath, audioKey, audioLocalPath }
}

// ─── Duration probe ──────────────────────────────────────────────────────────

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "${filePath}"`
    )
    const d = parseFloat(stdout.trim())
    return isFinite(d) && d > 0 ? d : 0
  } catch {
    return 0
  }
}

// ─── Temp-file helpers ────────────────────────────────────────────────────────

async function resolveLocalPath(
  key: string,
  localPathHint: string | null,
  ext: string,
  tmpDir: string,
  temps: string[],
): Promise<string> {
  if (isS3Mode()) {
    const tmp = path.join(tmpDir, `ar_${randomUUID()}${ext}`)
    await downloadToFile(key, tmp)
    temps.push(tmp)
    return tmp
  }
  // Local: use filesystem path directly
  const fp = storagePath(key)
  if (!fs.existsSync(fp)) {
    throw new Error(`Audio Replace: file not found on disk — ${key}`)
  }
  return fp
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class AudioReplaceExecutor extends NodeExecutor {
  async execute(
    input:  unknown,
    config: Record<string, unknown>,
    _ctx:   NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const mode          = (config.mode          as string)  ?? 'replace'
    const videoVolume   = (config.video_volume  as number)  ?? 1.0
    const musicVolume   = (config.music_volume  as number)  ?? 0.3
    const loopAudio     = (config.loop_audio    as boolean) ?? true
    const fadeIn        = (config.fade_in_seconds  as number) ?? 1.0
    const fadeOut       = (config.fade_out_seconds as number) ?? 2.0

    const { videoKey, videoLocalPath, audioKey, audioLocalPath } = resolveInputs(input)

    if (!videoKey) {
      throw new Error('Audio Replace: no video input connected — connect a Character Animation, Video Composition, or any video node')
    }
    if (!audioKey) {
      throw new Error('Audio Replace: no audio input connected — connect a Music Generation, Audio Mix, or Voice Output node')
    }

    const tmpDir = os.tmpdir()
    const temps: string[] = []

    // Detect extensions
    const videoExt = (videoLocalPath ?? videoKey).split('.').pop()?.toLowerCase() ?? 'mp4'
    const audioExt = (audioLocalPath ?? audioKey).split('.').pop()?.toLowerCase() ?? 'mp3'

    const [videoPath, inputAudioPath] = await Promise.all([
      resolveLocalPath(videoKey, videoLocalPath, `.${videoExt}`, tmpDir, temps),
      resolveLocalPath(audioKey, audioLocalPath, `.${audioExt}`, tmpDir, temps),
    ])

    const outputFilename = `audio_replace_${randomUUID()}.mp4`
    const outputTmp      = path.join(tmpDir, outputFilename)
    temps.push(outputTmp)

    const videoDuration = await getVideoDuration(videoPath)

    let cmd: string

    if (mode === 'mix') {
      // Blend video's original audio + new audio track
      const loopFilter = loopAudio ? 'aloop=loop=-1:size=2e+09,' : ''
      const durSuffix  = videoDuration > 0 ? `:d=${videoDuration.toFixed(3)}` : ''
      const fadeOutSt  = videoDuration > fadeOut ? (videoDuration - fadeOut).toFixed(3) : '0'

      const filterComplex = [
        `[0:a]volume=${videoVolume}[orig]`,
        `[1:a]${loopFilter}volume=${musicVolume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutSt}:d=${fadeOut}[music]`,
        `[orig][music]amix=inputs=2:duration=first:dropout_transition=1[aout]`,
      ].join(';')

      cmd = [
        'ffmpeg -y',
        `-i "${videoPath}"`,
        `-i "${inputAudioPath}"`,
        `-filter_complex "${filterComplex}"`,
        '-map 0:v:0',
        '-map "[aout]"',
        '-c:v copy',
        '-c:a aac -b:a 192k',
        '-movflags +faststart',
        videoDuration > 0 ? `-t ${videoDuration.toFixed(3)}` : '',
        `"${outputTmp}"`,
      ].filter(Boolean).join(' ')
    } else {
      // Replace mode — discard original audio, use new track (looped/trimmed to video length)
      const loopFlag  = loopAudio ? '-stream_loop -1' : ''
      const durationT = videoDuration > 0 ? `-t ${videoDuration.toFixed(3)}` : ''
      const fadeOutSt = videoDuration > fadeOut ? (videoDuration - fadeOut).toFixed(3) : '0'

      // Apply fade in/out to the replacement audio via filter
      const afilter = `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutSt}:d=${fadeOut},volume=${musicVolume}`

      cmd = [
        'ffmpeg -y',
        `-i "${videoPath}"`,
        loopFlag,
        `-i "${inputAudioPath}"`,
        `-filter_complex "[1:a]${afilter}[aout]"`,
        '-map 0:v:0',
        '-map "[aout]"',
        '-c:v copy',
        '-c:a aac -b:a 192k',
        '-movflags +faststart',
        durationT,
        `"${outputTmp}"`,
      ].filter(Boolean).join(' ')
    }

    try {
      await execAsync(cmd, { timeout: 300_000 })
    } finally {
      // Clean up download temps (not outputTmp — we still need it)
      for (const t of temps.filter((t) => t !== outputTmp)) {
        try { fs.unlinkSync(t) } catch { /* ignore */ }
      }
    }

    const videoBuffer = fs.readFileSync(outputTmp)
    try { fs.unlinkSync(outputTmp) } catch { /* ignore */ }

    const storageKey = await saveGeneratedFile(videoBuffer, outputFilename, 'video/mp4')
    const localPath  = `/files/generated/${outputFilename}`

    console.log(`[audio-replace] mode=${mode} ${videoKey} + ${audioKey} → ${outputFilename}`)

    return {
      output: {
        storageKey,
        localPath,
        filename: outputFilename,
        mode,
        type: 'video',
      },
    }
  }
}
