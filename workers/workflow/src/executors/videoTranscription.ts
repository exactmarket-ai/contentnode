import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { downloadBuffer, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult, asyncPoll } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface VideoRef {
  storageKey: string
  filename?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractVideoRef(input: unknown): VideoRef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return { storageKey: obj.storageKey, filename: typeof obj.filename === 'string' ? obj.filename : undefined }
  }
  return null
}

async function transcribeWithAssemblyAI(audioPath: string, apiKeyRef: string): Promise<string> {
  const apiKey = process.env[apiKeyRef]
  if (!apiKey) throw new Error(`AssemblyAI API key env var "${apiKeyRef}" is not set`)

  const audioBuffer = readFileSync(audioPath)

  // Upload audio
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey, 'Content-Type': 'audio/mpeg' },
    body: audioBuffer,
  })
  if (!uploadRes.ok) throw new Error(`AssemblyAI upload failed (HTTP ${uploadRes.status})`)
  const { upload_url } = await uploadRes.json() as { upload_url: string }

  // Submit transcript job
  const createRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_detection: true }),
  })
  if (!createRes.ok) throw new Error(`AssemblyAI job creation failed (HTTP ${createRes.status})`)
  const { id: transcriptId } = await createRes.json() as { id: string }

  // Poll until complete
  return asyncPoll({
    poll: async () => {
      const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      })
      if (!res.ok) return null
      const data = await res.json() as { status: string; text?: string; error?: string }
      if (data.status === 'completed') return data.text ?? ''
      if (data.status === 'error') throw new Error(`AssemblyAI error: ${data.error ?? 'Unknown error'}`)
      return null
    },
    intervalMs: 3000,
    timeoutMs: 600_000,
    label: 'AssemblyAI video transcription',
  })
}

async function transcribeWithWhisper(audioPath: string, apiKeyRef: string): Promise<string> {
  const apiKey = process.env[apiKeyRef]
  if (!apiKey) throw new Error(`OpenAI API key env var "${apiKeyRef}" is not set`)

  const audioBuffer = readFileSync(audioPath)
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3')
  formData.append('model', 'whisper-1')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI Whisper failed (HTTP ${res.status}): ${err}`)
  }
  const { text } = await res.json() as { text: string }
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class VideoTranscriptionExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    // If the workflow's AI model provider leaked into config.provider (e.g. 'anthropic'),
    // fall back to assemblyai — that's always the correct default for transcription.
    const rawProvider = config.provider as string | undefined
    const provider = (rawProvider && !['anthropic', 'ollama', 'openai'].includes(rawProvider))
      ? rawProvider
      : 'assemblyai'
    const apiKeyRef = (config.api_key_ref as string) ?? 'ASSEMBLYAI_API_KEY'

    // Get video reference from upstream input
    const videoRef = extractVideoRef(input)
    if (!videoRef) {
      throw new Error(
        'Video Transcription: no video file received — connect a Video Upload node to this node\'s input',
      )
    }

    // Mock / local dev — return placeholder immediately without calling any API
    if (provider === 'mock' || provider === 'local') {
      return {
        output: {
          text: `[Mock transcript for: ${videoRef.filename ?? videoRef.storageKey}]\n\nThis is a placeholder transcript for development. Switch the provider to AssemblyAI or OpenAI Whisper in the node config to get a real transcript.`,
        },
      }
    }

    // Resolve the video file path
    let filePath: string
    let tempVideoPath: string | null = null

    if (isS3Mode()) {
      const buffer = await downloadBuffer(videoRef.storageKey)
      const ext    = (videoRef.filename ?? 'video.mp4').split('.').pop()?.toLowerCase() ?? 'mp4'
      tempVideoPath = join(tmpdir(), `vt_${randomUUID()}.${ext}`)
      writeFileSync(tempVideoPath, buffer)
      filePath = tempVideoPath
    } else {
      filePath = join(UPLOAD_DIR, videoRef.storageKey)
      if (!existsSync(filePath)) {
        throw new Error(`Video Transcription: video file not found on disk: ${videoRef.storageKey}`)
      }
    }

    // Extract audio with ffmpeg
    const audioPath = join(tmpdir(), `vt_audio_${randomUUID()}.mp3`)

    try {
      try {
        execSync('ffmpeg -version', { stdio: 'ignore' })
      } catch {
        throw new Error('ffmpeg is not installed on this server — required for video transcription')
      }

      try {
        execSync(
          `ffmpeg -y -i "${filePath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 4 "${audioPath}"`,
          { stdio: 'ignore', timeout: 120_000 },
        )
      } catch (err) {
        throw new Error(
          `ffmpeg audio extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      if (!existsSync(audioPath)) {
        throw new Error('ffmpeg produced no audio output — check the video file is valid')
      }

      // Transcribe
      let transcript: string
      try {
        if (provider === 'assemblyai') {
          transcript = await transcribeWithAssemblyAI(audioPath, apiKeyRef)
        } else if (provider === 'openai-whisper') {
          transcript = await transcribeWithWhisper(audioPath, apiKeyRef)
        } else {
          throw new Error(`Unknown transcription provider: "${provider}"`)
        }
      } finally {
        try { unlinkSync(audioPath) } catch { /* ignore */ }
      }

      return { output: { text: transcript } }
    } finally {
      if (tempVideoPath) { try { unlinkSync(tempVideoPath) } catch { /* ignore */ } }
    }
  }
}
