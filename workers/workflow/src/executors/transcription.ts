import { execSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { prisma } from '@contentnode/database'
import { isS3Mode, downloadBuffer } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AudioFile {
  id: string
  name: string
  storageKey: string
}

interface DeepgramWord {
  word: string
  start: number
  end: number
  speaker?: number
  punctuated_word?: string
  confidence?: number
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        words: DeepgramWord[]
        transcript: string
      }>
    }>
  }
  metadata: {
    duration: number
    channels: number
  }
}

interface AssemblyAITranscript {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text?: string
  utterances?: Array<{
    speaker: string
    start: number
    end: number
    text: string
  }>
  audio_duration?: number
}

interface ParsedSegment {
  speaker: string       // "0", "1", "2" …
  startMs: number
  endMs: number
  text: string
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')
const CLIPS_DIR = join(UPLOAD_DIR, 'clips')

// ─────────────────────────────────────────────────────────────────────────────
// Deepgram API caller
// ─────────────────────────────────────────────────────────────────────────────

async function callDeeepgram(
  filePath: string,
  apiKey: string,
  enableDiarization: boolean,
  maxSpeakers: number | null,
): Promise<{ segments: ParsedSegment[]; durationSecs: number }> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  }
  const contentType = mimeMap[ext] ?? 'audio/mpeg'

  const params = new URLSearchParams({
    model: 'nova-2',
    punctuate: 'true',
    diarize: enableDiarization ? 'true' : 'false',
    ...(enableDiarization && maxSpeakers ? { diarize_version: 'latest', max_speakers: String(maxSpeakers) } : {}),
  })

  const stream = createReadStream(filePath)
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: stream as unknown,
    // @ts-ignore — Node 20 fetch supports ReadStream bodies with duplex
    duplex: 'half',
  } as RequestInit)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Deepgram API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as DeepgramResponse
  const words = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? []
  const durationSecs = data.metadata?.duration ?? 0

  return {
    segments: parseWordsIntoSegments(words, enableDiarization),
    durationSecs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AssemblyAI API caller (polling flow)
// ─────────────────────────────────────────────────────────────────────────────

async function callAssemblyAI(
  filePath: string,
  apiKey: string,
  enableDiarization: boolean,
): Promise<{ segments: ParsedSegment[]; durationSecs: number }> {
  // Step 1: upload audio (read into buffer for reliable Node.js fetch compatibility)
  const fileBuffer = readFileSync(filePath)
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
    body: fileBuffer,
  })
  if (!uploadRes.ok) throw new Error(`AssemblyAI upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  const { upload_url } = (await uploadRes.json()) as { upload_url: string }

  // Step 2: request transcription
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      speaker_labels: enableDiarization,
      speech_models: ['universal-2'],
    }),
  })
  if (!transcriptRes.ok) throw new Error(`AssemblyAI transcript request failed: ${transcriptRes.status} ${await transcriptRes.text()}`)
  const { id } = (await transcriptRes.json()) as { id: string }

  // Step 3: poll until completed (up to 10 minutes)
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    })
    const data = (await pollRes.json()) as AssemblyAITranscript
    if (data.status === 'completed') {
      const durationSecs = (data.audio_duration ?? 0) / 1000
      console.log(`[assemblyai] completed — utterances: ${data.utterances?.length ?? 0}, text preview: ${data.text?.slice(0, 100)}`)
      const segments: ParsedSegment[] = (data.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        startMs: u.start,
        endMs: u.end,
        text: u.text,
      }))
      return { segments, durationSecs }
    }
    if (data.status === 'error') throw new Error(`AssemblyAI transcription failed: ${JSON.stringify(data)}`)
  }
  throw new Error('AssemblyAI transcription timed out after 10 minutes')
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Whisper (no diarization — produces single speaker segments)
// ─────────────────────────────────────────────────────────────────────────────

async function callWhisper(
  filePath: string,
  apiKey: string,
): Promise<{ segments: ParsedSegment[]; durationSecs: number }> {
  const formData = new FormData()
  const stream = createReadStream(filePath)
  formData.append('file', stream as unknown as Blob, filePath.split('/').pop())
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })
  if (!res.ok) throw new Error(`Whisper API error ${res.status}: ${await res.text()}`)

  const data = (await res.json()) as {
    duration: number
    segments: Array<{ start: number; end: number; text: string }>
  }
  const segments: ParsedSegment[] = (data.segments ?? []).map((s) => ({
    speaker: '0',
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: s.text.trim(),
  }))
  return { segments, durationSecs: data.duration ?? 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local mock transcription (for dev / offline)
// ─────────────────────────────────────────────────────────────────────────────

function localMockTranscription(filename: string): { segments: ParsedSegment[]; durationSecs: number } {
  const segments: ParsedSegment[] = [
    { speaker: '0', startMs: 0,     endMs: 8000,  text: 'Thanks for joining the call today. I wanted to go over how the content strategy has been working for us.' },
    { speaker: '1', startMs: 8500,  endMs: 18000, text: 'Of course. I think the blog series has been performing well, but we have been struggling to get the email campaigns to convert.' },
    { speaker: '0', startMs: 18500, endMs: 28000, text: 'What do you think the main issue is? Is it the subject lines or the content itself?' },
    { speaker: '1', startMs: 28500, endMs: 40000, text: 'Honestly, I think the content is too generic. It does not speak to our specific pain points around compliance and reporting.' },
    { speaker: '0', startMs: 40500, endMs: 52000, text: 'That is really helpful. So the ideal outcome would be content that positions you as a compliance-first company?' },
    { speaker: '1', startMs: 52500, endMs: 65000, text: 'Exactly. Our customers care deeply about audit trails and SOC 2 compliance. If we can lead with that messaging it would resonate much better.' },
  ]
  console.log(`[transcription] local mock for file: ${filename}`)
  return { segments, durationSecs: 65 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Word-level diarization → speaker turn segments
// ─────────────────────────────────────────────────────────────────────────────

function parseWordsIntoSegments(words: DeepgramWord[], diarize: boolean): ParsedSegment[] {
  if (!diarize || words.length === 0) {
    // No diarization — treat as single speaker
    const text = words.map((w) => w.punctuated_word ?? w.word).join(' ')
    const startMs = Math.round((words[0]?.start ?? 0) * 1000)
    const endMs = Math.round((words[words.length - 1]?.end ?? 0) * 1000)
    return [{ speaker: '0', startMs, endMs, text }]
  }

  const segments: ParsedSegment[] = []
  let currentSpeaker = String(words[0].speaker ?? 0)
  let currentWords: DeepgramWord[] = []

  for (const word of words) {
    const speaker = String(word.speaker ?? 0)
    if (speaker !== currentSpeaker && currentWords.length > 0) {
      segments.push(buildSegment(currentSpeaker, currentWords))
      currentSpeaker = speaker
      currentWords = []
    }
    currentWords.push(word)
  }
  if (currentWords.length > 0) {
    segments.push(buildSegment(currentSpeaker, currentWords))
  }
  return segments
}

function buildSegment(speaker: string, words: DeepgramWord[]): ParsedSegment {
  return {
    speaker,
    startMs: Math.round((words[0].start) * 1000),
    endMs: Math.round((words[words.length - 1].end) * 1000),
    text: words.map((w) => w.punctuated_word ?? w.word).join(' ').trim(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract a 10-second representative audio clip per speaker using ffmpeg
// ─────────────────────────────────────────────────────────────────────────────

function extractAudioClip(
  sourceFile: string,
  startSec: number,
  speakerLabel: string,
  sessionId: string,
): string | null {
  try {
    // Check if ffmpeg is available
    execSync('ffmpeg -version', { stdio: 'ignore' })
  } catch {
    return null  // ffmpeg not installed — skip clip extraction
  }

  mkdirSync(CLIPS_DIR, { recursive: true })
  const clipName = `clip_${sessionId}_speaker_${speakerLabel}_${randomUUID().slice(0, 8)}.mp3`
  const clipPath = join(CLIPS_DIR, clipName)

  try {
    const startFormatted = formatSeconds(startSec)
    execSync(
      `ffmpeg -y -i "${sourceFile}" -ss ${startFormatted} -t 10 -acodec libmp3lame -q:a 4 "${clipPath}"`,
      { stdio: 'ignore', timeout: 30000 },
    )
    return `clips/${clipName}`
  } catch {
    return null
  }
}

function formatSeconds(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = (secs % 60).toFixed(3)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.padStart(6, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Video input helpers (when Transcription node is connected to a Video Upload)
// ─────────────────────────────────────────────────────────────────────────────

interface VideoRef { storageKey: string; filename?: string }

function extractVideoRef(input: unknown): VideoRef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return { storageKey: obj.storageKey, filename: typeof obj.filename === 'string' ? obj.filename : undefined }
  }
  return null
}

/**
 * Extract audio track from a video file using ffmpeg.
 * Returns the path to a temp mp3 file (caller must delete after use).
 */
function extractAudioFromVideo(videoPath: string): string {
  const audioPath = join(tmpdir(), `audio_${randomUUID()}.mp3`)
  execSync(
    `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 "${audioPath}"`,
    { stdio: 'ignore', timeout: 180_000 },
  )
  return audioPath
}

// ─────────────────────────────────────────────────────────────────────────────
// TranscriptionNodeExecutor
// ─────────────────────────────────────────────────────────────────────────────

export class TranscriptionNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const provider = (config.provider as string) ?? 'local'
    const apiKeyRef = (config.api_key_ref as string) ?? ''
    const enableDiarization = (config.enable_diarization as boolean) ?? true
    const maxSpeakers = (config.max_speakers as number | null) ?? null
    const targetNodeIds = (config.target_node_ids as string[]) ?? []
    const stakeholderIdForSession = (config.stakeholder_id as string | null) ?? null
    const audioFiles = (config.audio_files as AudioFile[]) ?? []

    // ── Upstream input mode (video or audio from a connected node) ──────────
    // When the Transcription node receives input from an upstream node (e.g.
    // Video Upload, or another audio source), skip the speaker-assignment flow
    // and just return the transcript text for downstream AI nodes.
    const upstreamRef = extractVideoRef(input)
    if (upstreamRef) {
      const apiKey = apiKeyRef ? (process.env[apiKeyRef] ?? '') : ''
      const isVideo = /\.(mp4|mov|avi|webm|mkv|m4v)(\?|$)/i.test(upstreamRef.filename ?? upstreamRef.storageKey)

      // Locate or download the source file
      let sourcePath: string
      let tempVideoPath: string | null = null
      if (isS3Mode()) {
        const buffer = await downloadBuffer(upstreamRef.storageKey)
        tempVideoPath = join(tmpdir(), `src_${randomUUID()}.${isVideo ? 'mp4' : 'mp3'}`)
        writeFileSync(tempVideoPath, Buffer.from(buffer))
        sourcePath = tempVideoPath
      } else {
        sourcePath = join(UPLOAD_DIR, upstreamRef.storageKey)
      }

      // Extract audio from video if needed
      let audioPath: string
      let tempAudioPath: string | null = null
      if (isVideo) {
        audioPath = extractAudioFromVideo(sourcePath)
        tempAudioPath = audioPath
      } else {
        audioPath = sourcePath
      }

      try {
        let text: string
        if (provider === 'local' || provider === 'mock') {
          text = `[Mock transcript for: ${upstreamRef.filename ?? upstreamRef.storageKey}]`
        } else if (provider === 'deepgram') {
          if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for Deepgram`)
          const { segments } = await callDeeepgram(audioPath, apiKey, false, null)
          text = segments.map((s) => s.text).join(' ')
        } else if (provider === 'assemblyai') {
          if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for AssemblyAI`)
          const { segments } = await callAssemblyAI(audioPath, apiKey, false)
          text = segments.map((s) => s.text).join(' ')
        } else if (provider === 'openai-whisper') {
          if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for OpenAI Whisper`)
          const { segments } = await callWhisper(audioPath, apiKey)
          text = segments.map((s) => s.text).join(' ')
        } else {
          throw new Error(`Unknown transcription provider: "${provider}"`)
        }
        return { output: { text } }
      } finally {
        // Clean up temp files
        if (tempAudioPath) try { unlinkSync(tempAudioPath) } catch { /* ignore */ }
        if (tempVideoPath) try { unlinkSync(tempVideoPath) } catch { /* ignore */ }
      }
    }

    // ── Standalone mode (audio files configured in the node) ────────────────
    if (audioFiles.length === 0) {
      throw new Error('Transcription node: no audio files configured — upload audio files or connect an upstream node')
    }

    // Resolve API key from env
    const apiKey = apiKeyRef ? (process.env[apiKeyRef] ?? '') : ''

    // Use first audio file for now (future: merge multiple files)
    const firstFile = audioFiles[0]
    const filePath = join(UPLOAD_DIR, firstFile.storageKey)

    if (!existsSync(filePath)) {
      throw new Error(`Audio file not found: ${firstFile.storageKey}`)
    }

    // ── Transcribe ───────────────────────────────────────────────────────────
    let segments: ParsedSegment[]
    let durationSecs: number

    if (provider === 'local') {
      ;({ segments, durationSecs } = localMockTranscription(firstFile.name))
    } else if (provider === 'deepgram') {
      if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for Deepgram`)
      ;({ segments, durationSecs } = await callDeeepgram(filePath, apiKey, enableDiarization, maxSpeakers))
    } else if (provider === 'assemblyai') {
      if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for AssemblyAI`)
      console.log(`[transcription] calling AssemblyAI, file: ${filePath}, diarization: ${enableDiarization}, keyRef: ${apiKeyRef}, keyLen: ${apiKey.length}`)
      try {
        ;({ segments, durationSecs } = await callAssemblyAI(filePath, apiKey, enableDiarization))
        console.log(`[transcription] AssemblyAI returned ${segments.length} segments`)
      } catch (err) {
        console.error(`[transcription] AssemblyAI threw:`, err)
        throw err
      }
    } else if (provider === 'openai-whisper') {
      if (!apiKey) throw new Error(`Transcription: API key env var "${apiKeyRef}" is not set for OpenAI Whisper`)
      ;({ segments, durationSecs } = await callWhisper(filePath, apiKey))
    } else {
      throw new Error(`Unknown transcription provider: ${provider}`)
    }

    // ── Determine unique speakers ────────────────────────────────────────────
    const speakerLabels = [...new Set(segments.map((s) => s.speaker))].sort()

    // ── Extract representative audio clips (one per speaker) ─────────────────
    const speakerClipKeys = new Map<string, string | null>()
    for (const speakerLabel of speakerLabels) {
      const firstSegForSpeaker = segments.find((s) => s.speaker === speakerLabel)
      if (firstSegForSpeaker) {
        const clipKey = extractAudioClip(
          filePath,
          firstSegForSpeaker.startMs / 1000,
          speakerLabel,
          ctx.nodeId,
        )
        speakerClipKeys.set(speakerLabel, clipKey)
      }
    }

    // ── Persist TranscriptSession + TranscriptSegments ───────────────────────
    const clientId = await this.resolveClientId(ctx)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await (prisma.transcriptSession.create as any)({
      data: {
        agencyId: ctx.agencyId,
        clientId,
        stakeholderId: stakeholderIdForSession ?? undefined,
        workflowRunId: ctx.workflowRunId,
        nodeId: ctx.nodeId,
        targetNodeIds: targetNodeIds,
        title: `Transcription — ${firstFile.name}`,
        recordingUrl: firstFile.storageKey,
        status: 'awaiting_assignment',
        durationSecs: Math.round(durationSecs),
        metadata: {
          provider,
          originalFilename: firstFile.name,
          speakerCount: speakerLabels.length,
          segmentCount: segments.length,
        },
      },
    }) as { id: string }

    // Create segments in batch
    await prisma.$transaction(
      segments.map((seg) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma.transcriptSegment.create as any)({
          data: {
            agencyId: ctx.agencyId,
            sessionId: session.id,
            speaker: seg.speaker,
            audioClipKey: speakerClipKeys.get(seg.speaker) ?? undefined,
            startMs: seg.startMs,
            endMs: seg.endMs,
            text: seg.text,
          },
        }),
      ),
    )

    console.log(
      `[transcription] session ${session.id}: ${speakerLabels.length} speakers, ${segments.length} segments`,
    )

    return {
      output: {
        sessionId: session.id,
        status: 'awaiting_assignment',
        speakerCount: speakerLabels.length,
        segmentCount: segments.length,
        durationSecs: Math.round(durationSecs),
        targetNodeIds,
      },
      paused: true,
      pendingSessionId: session.id,
    }
  }

  /** Resolve clientId from the workflow linked to this run */
  private async resolveClientId(ctx: NodeExecutionContext): Promise<string> {
    const run = await prisma.workflowRun.findUnique({
      where: { id: ctx.workflowRunId },
      include: { workflow: { select: { clientId: true } } },
    })
    if (!run?.workflow.clientId) {
      throw new Error(`Cannot resolve clientId for workflowRun ${ctx.workflowRunId}`)
    }
    return run.workflow.clientId
  }
}
