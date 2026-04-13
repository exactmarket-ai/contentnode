import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { saveGeneratedFile } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractText(input: unknown): string {
  if (typeof input === 'string') {
    // Strip runner-injected section headers (e.g. "## Text Input\n\n")
    return input.replace(/^##\s+[^\n]*\n+/gm, '').trim()
  }
  if (Array.isArray(input)) return input.map(extractText).filter(Boolean).join('\n\n')
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const val = o.content ?? o.text ?? o.output ?? o.transcript ?? o.script ?? ''
    return extractText(val)
  }
  return ''
}

// ─── Output type ─────────────────────────────────────────────────────────────

export interface VoiceOutputResult {
  localPath: string
  storageKey: string
  transcript: string
  duration_estimate_seconds: number
  word_count: number
  voice: string
  model: string
  provider: string
  format: string
  type: 'audio'
}

// ─── ElevenLabs voices ───────────────────────────────────────────────────────
// Map friendly name → voice ID for common preset voices.
// Users can also paste a custom voice ID directly.

export const ELEVENLABS_VOICES: Record<string, string> = {
  rachel:    '21m00Tcm4TlvDq8ikWAM',
  adam:      'pNInz6obpgDQGcFmaJgB',
  daniel:    'onwK4e9ZLuTAKqWW03F9',
  josh:      'TxGEqnHWrfWFTfGW9XjX',
  sarah:     'EXAVITQu4vr4xnSDxMaL',
  emily:     'LcfcDJNUP1GQjkzn1xUU',
  charlotte: 'XB0fDUnXU5powFXDhCwa',
  matilda:   'XrExE9yKIg1WjnnlVkGX',
  harry:     'SOYHLrjzK2X1ezoPC6cr',
  dorothy:   'ThT5KcBeYPX3keUQqHPh',
  liam:      'TX3LPaxmHKxFdv7VOQHJ',
  ethan:     'g5CIjZEefAph4nQFvHAz',
}

function resolveElevenLabsVoiceId(voice: string): string {
  // If it looks like a voice ID (long alphanumeric), use it directly
  if (/^[A-Za-z0-9]{20,}$/.test(voice)) return voice
  // Otherwise look up the friendly name
  return ELEVENLABS_VOICES[voice.toLowerCase()] ?? ELEVENLABS_VOICES.rachel
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class VoiceOutputNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const provider  = (config.provider as string) ?? 'openai'
    const rawVoice  = (config.voice as string) ?? 'alloy'
    // Map legacy OpenAI voice names that were removed from the API to current equivalents
    const LEGACY_VOICE_MAP: Record<string, string> = { nova: 'echo', fable: 'alloy', onyx: 'shimmer' }
    const OPENAI_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'])
    const mappedVoice = LEGACY_VOICE_MAP[rawVoice] ?? rawVoice
    // If an ElevenLabs voice name was configured but provider is openai, fall back gracefully
    const voice = (provider === 'openai' && !OPENAI_VOICES.has(mappedVoice)) ? 'alloy' : mappedVoice
    const speed     = Math.max(0.25, Math.min(4.0, (config.speed as number) ?? 1.0))
    const format    = ((config.format as string) ?? 'mp3') as 'mp3' | 'wav' | 'opus'
    const mergeMode = (config.merge_mode as string) ?? 'concatenate'

    // Resolve script text from input
    let script = extractText(input)
    if (!script) throw new Error('Voice Output: no text content received from upstream nodes')

    // Trim script to 4096 chars (OpenAI TTS limit); ElevenLabs allows more
    if (provider === 'openai' || provider === 'local') {
      if (script.length > 4096) script = script.slice(0, 4096)
    }

    const filename = `tts_${randomUUID()}.${format}`
    const contentType = format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg'

    let audioBuffer: Buffer

    // ── OpenAI TTS ──────────────────────────────────────────────────────────
    if (provider === 'openai' || provider === 'local') {
      const isLocal = provider === 'local'
      const baseURL = isLocal
        ? `${(process.env.TTS_BASE_URL ?? 'http://localhost:8880').replace(/\/$/, '')}/v1`
        : undefined

      const client = new OpenAI({
        apiKey: isLocal ? 'local' : (process.env.OPENAI_API_KEY ?? ''),
        ...(baseURL ? { baseURL } : {}),
      })

      const model = isLocal
        ? ((config.local_model as string) ?? 'kokoro')
        : ((config.model as string) ?? 'tts-1')

      const responseFormat = format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'mp3'

      let response: Response
      try {
        response = await client.audio.speech.create({
          model,
          voice,
          input: script,
          speed,
          response_format: responseFormat,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Voice Output (OpenAI TTS): ${msg} [model=${model}, voice=${voice}, chars=${script.length}]`)
      }

      audioBuffer = Buffer.from(await response.arrayBuffer())

    // ── ElevenLabs ──────────────────────────────────────────────────────────
    } else if (provider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY
      if (!apiKey) throw new Error('Voice Output: ELEVENLABS_API_KEY is not set in worker env')

      const voiceId  = resolveElevenLabsVoiceId(voice)
      const elModel  = (config.elevenlabs_model as string) ?? 'eleven_turbo_v2_5'
      const stability       = (config.stability as number) ?? 0.5
      const similarityBoost = (config.similarity_boost as number) ?? 0.75
      const styleExaggeration = (config.style_exaggeration as number) ?? 0.0

      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key':   apiKey,
            'Content-Type': 'application/json',
            'Accept':       'audio/mpeg',
          },
          body: JSON.stringify({
            text:     script,
            model_id: elModel,
            voice_settings: {
              stability,
              similarity_boost: similarityBoost,
              style:            styleExaggeration,
              use_speaker_boost: true,
            },
          }),
        },
      )

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`ElevenLabs TTS error (${res.status}): ${errText}`)
      }

      audioBuffer = Buffer.from(await res.arrayBuffer())

    } else {
      throw new Error(`Voice Output: unknown provider "${provider}"`)
    }

    // ── Save to storage ──────────────────────────────────────────────────────
    const storageKey = await saveGeneratedFile(audioBuffer, filename, contentType)
    const localPath  = `/files/generated/${filename}`

    // Rough duration: ~150 words/min at speed 1.0
    const wordCount = script.split(/\s+/).filter(Boolean).length
    const durationSeconds = Math.round((wordCount / 150) * 60 / speed)

    const result: VoiceOutputResult = {
      localPath,
      storageKey,
      transcript: script,
      duration_estimate_seconds: durationSeconds,
      word_count: wordCount,
      voice,
      model:    provider === 'elevenlabs' ? (config.elevenlabs_model as string ?? 'eleven_turbo_v2_5') : (config.model as string ?? 'tts-1'),
      provider,
      format,
      type: 'audio',
    }

    return {
      output: result,
      wordsProcessed: wordCount,
      mediaUsage: {
        provider:    provider === 'local' ? 'local' : provider,  // 'openai' | 'elevenlabs' | 'local'
        subtype:     'voice_generation',
        durationSecs: durationSeconds,
        charCount:   script.length,
        model:       result.model,
        isOnline:    provider !== 'local',
      },
    }
  }
}
