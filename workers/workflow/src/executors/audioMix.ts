import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { saveGeneratedFile, localPath as storagePath } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const execAsync = promisify(exec)

// ─── Output type ─────────────────────────────────────────────────────────────

export interface AudioMixResult {
  localPath: string
  storageKey: string
  duration_seconds: number
  voice_volume: number
  music_volume: number
  type: 'audio'
}

// ─── Input resolution ────────────────────────────────────────────────────────
// Receives structured multi-input: { inputs: [{ nodeId, nodeLabel, nodeType, content }] }
// Identifies voice vs music by the presence of a `transcript` field.

interface StructuredInput {
  nodeId:    string
  nodeLabel: string
  nodeType:  string
  content:   unknown
}

function resolveAudioInputs(input: unknown): { voiceKey: string | null; musicKey: string | null } {
  let voiceKey: string | null = null
  let musicKey: string | null = null

  const inputs: StructuredInput[] = []

  if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).inputs)) {
    inputs.push(...((input as Record<string, unknown>).inputs as StructuredInput[]))
  } else if (Array.isArray(input)) {
    inputs.push(...(input as StructuredInput[]))
  } else if (input && typeof input === 'object') {
    // Single input — treat as voice
    const o = input as Record<string, unknown>
    if (typeof o.storageKey === 'string') voiceKey = o.storageKey
    return { voiceKey, musicKey }
  }

  for (const item of inputs) {
    const content = item.content as Record<string, unknown> | null
    if (!content || typeof content.storageKey !== 'string') continue
    const key = content.storageKey as string

    // Voice: has transcript. Music: has service or prompt field.
    if (typeof content.transcript === 'string') {
      voiceKey = voiceKey ?? key
    } else if (content.service === 'music' || content.service === 'sfx' || typeof content.prompt === 'string') {
      musicKey = musicKey ?? key
    } else {
      // Unknown — assign to first available slot
      if (!voiceKey) voiceKey = key
      else if (!musicKey) musicKey = key
    }
  }

  return { voiceKey, musicKey }
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class AudioMixNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const voiceVolume = (config.voice_volume as number) ?? 1.0
    const musicVolume = (config.music_volume as number) ?? 0.25
    const duckEnabled = (config.duck_enabled as boolean) ?? true
    const loopMusic   = (config.loop_music as boolean) ?? true
    const fadeIn      = (config.fade_in_seconds as number) ?? 1.0
    const fadeOut     = (config.fade_out_seconds as number) ?? 2.0
    const voiceDelay  = Math.max(0, (config.voice_delay_seconds as number) ?? 0)
    const musicDelay  = Math.max(0, (config.music_delay_seconds as number) ?? 0)

    const { voiceKey, musicKey } = resolveAudioInputs(input)
    if (!voiceKey) throw new Error('Audio Mix: no voice audio input connected')
    if (!musicKey) throw new Error('Audio Mix: no music audio input connected')

    // Resolve real filesystem paths
    const voicePath = storagePath(voiceKey)
    const musicPath = storagePath(musicKey)

    if (!fs.existsSync(voicePath)) throw new Error(`Audio Mix: voice file not found at ${voicePath}`)
    if (!fs.existsSync(musicPath)) throw new Error(`Audio Mix: music file not found at ${musicPath}`)

    // Output to a temp file first, then save to storage
    const tmpDir    = os.tmpdir()
    const tmpOut    = path.join(tmpDir, `mix_${randomUUID()}.mp3`)

    const filterComplex = duckEnabled
      ? buildDuckingFilter(voiceVolume, musicVolume, voiceDelay, musicDelay, loopMusic)
      : buildSimpleMixFilter(voiceVolume, musicVolume, fadeIn, fadeOut, voiceDelay, musicDelay, loopMusic)

    const cmd = [
      'ffmpeg -y',
      `-i "${voicePath}"`,
      `-i "${musicPath}"`,
      `-filter_complex "${filterComplex}"`,
      `-map "[out]"`,
      `-codec:a libmp3lame -q:a 2`,
      `"${tmpOut}"`,
    ].join(' ')

    try {
      await execAsync(cmd)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Audio Mix: ffmpeg failed — ${message}`)
    }

    const buffer     = fs.readFileSync(tmpOut)
    fs.unlinkSync(tmpOut)

    const filename   = `mix_${randomUUID()}.mp3`
    const storageKey = await saveGeneratedFile(buffer, filename, 'audio/mpeg')
    const localPath  = `/files/generated/${filename}`

    // Estimate duration from voice track
    const durationSeconds = await getAudioDuration(voicePath)

    const result: AudioMixResult = {
      localPath,
      storageKey,
      duration_seconds: durationSeconds,
      voice_volume:     voiceVolume,
      music_volume:     musicVolume,
      type: 'audio',
    }

    return { output: result }
  }
}

// ─── ffmpeg filter builders ───────────────────────────────────────────────────

/**
 * Simple mix: voice at voiceVolume, music looped and faded, mixed together.
 * Duration follows the voice track (or longest when delays are applied).
 */
function buildSimpleMixFilter(
  voiceVolume: number,
  musicVolume: number,
  fadeIn: number,
  fadeOut: number,
  voiceDelay: number = 0,
  musicDelay: number = 0,
  loopMusic: boolean = true,
): string {
  const hasDelay = voiceDelay > 0 || musicDelay > 0
  const voiceMs  = Math.round(voiceDelay * 1000)
  const musicMs  = Math.round(musicDelay * 1000)
  const duration = hasDelay ? 'longest' : 'first'
  const loopFilter = loopMusic ? 'aloop=loop=-1:size=2e+09,' : ''

  const voiceChain = voiceDelay > 0
    ? `[0:a]volume=${voiceVolume},adelay=${voiceMs}:all=1[v]`
    : `[0:a]volume=${voiceVolume}[v]`

  const musicChain = musicDelay > 0
    ? `[1:a]${loopFilter}volume=${musicVolume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=9999:d=${fadeOut},adelay=${musicMs}:all=1[m]`
    : `[1:a]${loopFilter}volume=${musicVolume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=9999:d=${fadeOut}[m]`

  return [
    voiceChain,
    musicChain,
    `[v][m]amix=inputs=2:duration=${duration}:dropout_transition=2[out]`,
  ].join(';')
}

/**
 * Sidechain ducking: music automatically drops when voice is present.
 * Uses sidechaincompress filter — requires ffmpeg with libavfilter.
 */
function buildDuckingFilter(
  voiceVolume: number,
  musicVolume: number,
  voiceDelay: number = 0,
  musicDelay: number = 0,
  loopMusic: boolean = true,
): string {
  const hasDelay = voiceDelay > 0 || musicDelay > 0
  const voiceMs  = Math.round(voiceDelay * 1000)
  const musicMs  = Math.round(musicDelay * 1000)
  const duration = hasDelay ? 'longest' : 'first'
  const loopFilter = loopMusic ? 'aloop=loop=-1:size=2e+09,' : ''

  const voiceChain = voiceDelay > 0
    ? `[0:a]volume=${voiceVolume},adelay=${voiceMs}:all=1,asplit=2[voice_out][sc]`
    : `[0:a]volume=${voiceVolume},asplit=2[voice_out][sc]`

  const musicChain = musicDelay > 0
    ? `[1:a]${loopFilter}volume=${musicVolume * 2},adelay=${musicMs}:all=1[music]`
    : `[1:a]${loopFilter}volume=${musicVolume * 2}[music]`

  return [
    voiceChain,
    musicChain,
    `[music][sc]sidechaincompress=threshold=0.02:ratio=8:attack=100:release=600[ducked]`,
    `[voice_out][ducked]amix=inputs=2:duration=${duration}:dropout_transition=2[out]`,
  ].join(';')
}

// ─── Duration probe ───────────────────────────────────────────────────────────

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    )
    return Math.round(parseFloat(stdout.trim()))
  } catch {
    return 0
  }
}
