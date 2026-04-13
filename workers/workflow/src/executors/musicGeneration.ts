import { randomUUID } from 'node:crypto'
import { saveGeneratedFile } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─── Output type ─────────────────────────────────────────────────────────────

export interface MusicGenerationResult {
  localPath: string
  storageKey: string
  prompt: string
  duration_seconds: number
  provider: string
  service: string   // 'music' | 'sfx' | 'local'
  type: 'audio'
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class MusicGenerationNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const service  = (config.service as string) ?? 'music'   // 'music' | 'sfx' | 'local'
    const prompt   = (config.prompt as string) ?? ''
    const duration = (config.duration_seconds as number) ?? 30

    // Allow upstream text node to override the prompt
    const upstreamText = extractUpstreamText(input)
    const finalPrompt  = upstreamText || prompt
    if (!finalPrompt.trim()) throw new Error('Music Generation: prompt is required')

    // Validate ElevenLabs key up-front for non-local services
    const apiKey = service !== 'local' ? (process.env.ELEVENLABS_API_KEY ?? '') : ''
    console.log(`[MusicGen] service=${service} apiKey=${apiKey ? `set(${apiKey.slice(0,8)}...)` : 'NOT SET'}`)
    if (service !== 'local' && !apiKey) {
      throw new Error('Music Generation: ELEVENLABS_API_KEY is not set in worker env')
    }

    let audioBuffer: Buffer
    let actualDuration: number
    let audioMimeType = 'audio/mpeg'
    let fileExt = 'mp3'
    let provider = 'elevenlabs'

    if (service === 'local') {
      // ── Local MusicGen server ───────────────────────────────────────────────
      const baseUrl = (process.env.MUSIC_BASE_URL ?? 'http://localhost:8881').replace(/\/$/, '')
      const localDuration = Math.min(Math.max(duration, 1), 120)

      const res = await fetch(`${baseUrl}/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, duration_seconds: localDuration }),
      }).catch((err: unknown) => {
        throw new Error(
          `Local MusicGen: cannot reach server at ${baseUrl} — ${(err as Error).message}. ` +
          `Run: python scripts/musicgen_server.py`
        )
      })

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText)
        throw new Error(`Local MusicGen error (${res.status}): ${err}`)
      }

      audioBuffer    = Buffer.from(await res.arrayBuffer())
      actualDuration = localDuration
      audioMimeType  = 'audio/wav'
      fileExt        = 'wav'
      provider       = 'local'

    } else if (service === 'music') {
      // ── ElevenLabs Music (/v1/music) ────────────────────────────────────────
      const musicLengthMs = Math.min(Math.max(duration * 1000, 3000), 600_000)

      const res = await fetch('https://api.elevenlabs.io/v1/music', {
        method:  'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          prompt:             finalPrompt,
          music_length_ms:    musicLengthMs,
          model_id:           'music_v1',
          force_instrumental: (config.force_instrumental as boolean) ?? true,
        }),
      })

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText)
        throw new Error(`ElevenLabs Music error (${res.status}): ${err}`)
      }

      audioBuffer    = Buffer.from(await res.arrayBuffer())
      actualDuration = duration

    } else {
      // ── ElevenLabs Sound Effects (/v1/sound-generation) ────────────────────
      const sfxDuration     = Math.min(Math.max(duration, 0.5), 30)
      const promptInfluence = (config.prompt_influence as number) ?? 0.3

      const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method:  'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text:             finalPrompt,
          duration_seconds: sfxDuration,
          prompt_influence: promptInfluence,
        }),
      })

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText)
        throw new Error(`ElevenLabs SFX error (${res.status}): ${err}`)
      }

      audioBuffer    = Buffer.from(await res.arrayBuffer())
      actualDuration = sfxDuration
    }

    const filename   = `music_${randomUUID()}.${fileExt}`
    const storageKey = await saveGeneratedFile(audioBuffer, filename, audioMimeType)
    const localPath  = `/files/generated/${filename}`

    const result: MusicGenerationResult = {
      localPath,
      storageKey,
      prompt:           finalPrompt,
      duration_seconds: actualDuration,
      provider,
      service,
      type:             'audio',
    }

    return {
      output: result,
      mediaUsage: {
        provider:    provider,   // 'elevenlabs' | 'local'
        subtype:     'music_generation',
        durationSecs: actualDuration,
        model:       service === 'music' ? 'music_v1' : service === 'sfx' ? 'sfx_default' : 'local',
        isOnline:    provider !== 'local',
      },
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractUpstreamText(input: unknown): string {
  if (typeof input === 'string') return input.replace(/^##\s+[^\n]*\n+/gm, '').trim()
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const val = o.content ?? o.text ?? o.output ?? ''
    return extractUpstreamText(val)
  }
  return ''
}
