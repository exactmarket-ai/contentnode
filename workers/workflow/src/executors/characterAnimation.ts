import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const execAsync = promisify(exec)

/** Probe an audio/video buffer for duration using ffprobe. Returns 0 on failure. */
async function probeDuration(buf: Buffer, ext = 'mp3'): Promise<number> {
  const tmp = path.join(os.tmpdir(), `probe_${randomUUID()}.${ext}`)
  try {
    fs.writeFileSync(tmp, buf)
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmp}"`,
      { timeout: 10_000 },
    )
    return parseFloat(stdout.trim()) || 0
  } catch {
    return 0
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
import { saveGeneratedFile, downloadBuffer } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─── Output type ─────────────────────────────────────────────────────────────

export interface CharacterAnimationResult {
  localPath: string
  storageKey: string
  type: 'video'
  provider: string
}

// ─── Input resolution ────────────────────────────────────────────────────────

interface StructuredInput {
  nodeId:    string
  nodeLabel: string
  nodeType:  string
  content:   unknown
}

interface ResolvedInputs {
  audioKey:       string | null
  audioLocalPath: string | null   // e.g. '/files/generated/tts_xxx.mp3'
  imageKey:       string | null
  textInput:      string | null   // plain text from upstream (AI Generate, Text Input, etc.)
}

function resolveInputs(input: unknown): ResolvedInputs {
  let audioKey:       string | null = null
  let audioLocalPath: string | null = null
  let imageKey:       string | null = null
  let textInput:      string | null = null

  const items: StructuredInput[] = []

  if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).inputs)) {
    items.push(...((input as Record<string, unknown>).inputs as StructuredInput[]))
  } else if (Array.isArray(input)) {
    items.push(...(input as StructuredInput[]))
  } else if (typeof input === 'string') {
    // Plain text directly
    textInput = input.trim() || null
    return { audioKey, audioLocalPath, imageKey, textInput }
  } else if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (typeof o.storageKey === 'string') {
      if (o.type === 'audio' || typeof o.transcript === 'string') {
        audioKey = o.storageKey
        audioLocalPath = (o.localPath as string) ?? null
      } else if (o.type === 'image') {
        imageKey = o.storageKey
      } else {
        audioKey = o.storageKey
        audioLocalPath = (o.localPath as string) ?? null
      }
    } else if (typeof o.output === 'string') {
      // Wrapped output object from another node
      textInput = o.output.trim() || null
    }
    return { audioKey, audioLocalPath, imageKey, textInput }
  }

  for (const rawItem of items) {
    // Items may be:
    //   (a) StructuredInput wrappers { nodeId, nodeLabel, nodeType, content } — from MULTI_INPUT path
    //   (b) Raw node outputs (string or object) — from the regular multi-upstream path
    // Handle (b) first so plain strings and plain audio/image objects are always caught.

    // --- raw string ---
    if (typeof rawItem === 'string') {
      if (!textInput) textInput = (rawItem as string).trim() || null
      continue
    }

    if (!rawItem || typeof rawItem !== 'object') continue
    const o = rawItem as Record<string, unknown>

    // --- raw audio/image/video object (has storageKey at top level) ---
    if (typeof o.storageKey === 'string') {
      const key = o.storageKey as string
      if (o.type === 'audio' || typeof o.transcript === 'string') {
        if (!audioKey) { audioKey = key; audioLocalPath = (o.localPath as string) ?? null }
      } else if (o.type === 'image') {
        imageKey = imageKey ?? key
      } else {
        if (!audioKey) { audioKey = key; audioLocalPath = (o.localPath as string) ?? null }
      }
      continue
    }

    // --- StructuredInput wrapper (from MULTI_INPUT nodes) ---
    const content = o.content as Record<string, unknown> | string | null | undefined
    if (!content) continue

    if (typeof content === 'string') {
      if (!textInput) textInput = content.trim() || null
      continue
    }
    if (typeof content !== 'object') continue

    if (typeof content.storageKey === 'string') {
      const key = content.storageKey as string
      if (content.type === 'audio' || typeof content.transcript === 'string') {
        if (!audioKey) { audioKey = key; audioLocalPath = (content.localPath as string) ?? null }
      } else if (content.type === 'image') {
        imageKey = imageKey ?? key
      } else {
        if (!audioKey) { audioKey = key; audioLocalPath = (content.localPath as string) ?? null }
      }
    } else if (typeof content.output === 'string') {
      if (!textInput) textInput = (content.output as string).trim() || null
    }
  }

  return { audioKey, audioLocalPath, imageKey, textInput }
}

// ─── Photo resolution ────────────────────────────────────────────────────────
// Returns { buffer, mime } for providers that upload the file,
// or a plain URL string for providers that need a hosted link.

interface PhotoAsset { buffer: Buffer; mime: string }

// Compress to stay under D-ID's 10 MB upload limit
async function compressPhoto(photo: PhotoAsset, maxBytes = 8 * 1024 * 1024): Promise<PhotoAsset> {
  if (photo.buffer.length <= maxBytes) return photo
  const compressed = await sharp(photo.buffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  if (compressed.length <= maxBytes) return { buffer: compressed, mime: 'image/jpeg' }
  const smaller = await sharp(photo.buffer)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()
  return { buffer: smaller, mime: 'image/jpeg' }
}

async function resolvePhoto(imageKey: string | null, configImage: string): Promise<PhotoAsset | null> {
  // Base64 data URI from node drag-and-drop or config panel
  if (configImage && configImage.startsWith('data:')) {
    const [header, b64] = configImage.split(',')
    const mime = header.replace('data:', '').replace(';base64', '')
    return { buffer: Buffer.from(b64, 'base64'), mime }
  }

  // External URL — fetch the bytes
  if (configImage && configImage.startsWith('http')) {
    const res = await fetch(configImage)
    if (!res.ok) throw new Error(`Character Animation: failed to fetch photo from ${configImage}`)
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    return { buffer: Buffer.from(await res.arrayBuffer()), mime }
  }

  // Upstream Image Generation node
  if (imageKey) {
    const buf  = await downloadBuffer(imageKey)
    const mime = imageKey.endsWith('.png') ? 'image/png' : 'image/jpeg'
    return { buffer: buf, mime }
  }

  return null
}

// ─── D-ID auth helper ────────────────────────────────────────────────────────
// D-ID keys are "base64(email):secret". Decode the email to reconstruct
// proper Basic auth credentials.

function didAuth(apiKey: string): string {
  // D-ID API keys are already formatted as base64(email):secret — use as-is
  return `Basic ${apiKey}`
}

// ─── D-ID ────────────────────────────────────────────────────────────────────

async function generateWithDID(
  audioKey: string,
  photo: PhotoAsset,
  expressionScale: number,
): Promise<Buffer> {
  const apiKey = process.env.DID_API_KEY
  if (!apiKey) throw new Error('Character Animation (D-ID): DID_API_KEY not set')

  const auth = didAuth(apiKey)

  // Download via storage abstraction (works for both local filesystem and S3)
  const audioBuffer  = await downloadBuffer(audioKey)
  const audioForm    = new FormData()
  audioForm.append('audio', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'voice.mp3')

  const audioUploadRes = await fetch('https://api.d-id.com/audios', {
    method: 'POST',
    headers: { Authorization: auth },
    body: audioForm,
  })
  if (!audioUploadRes.ok) {
    const err = await audioUploadRes.text()
    throw new Error(`Character Animation (D-ID): audio upload failed (${audioUploadRes.status}) — ${err}`)
  }
  const audioData = await audioUploadRes.json() as { url: string }
  const audioUrl  = audioData.url

  const compressed = await compressPhoto(photo)
  const photoExt   = compressed.mime.includes('png') ? 'png' : 'jpg'

  // Upload photo to D-ID /images → get a D-ID-hosted URL for source_url
  const photoForm = new FormData()
  photoForm.append('image', new Blob([compressed.buffer], { type: compressed.mime }), `photo.${photoExt}`)

  const imgRes = await fetch('https://api.d-id.com/images', {
    method: 'POST',
    headers: { Authorization: auth },
    body: photoForm,
  })
  if (!imgRes.ok) {
    const err = await imgRes.text()
    throw new Error(`Character Animation (D-ID): image upload failed (${imgRes.status}) — ${err}`)
  }
  const imgData  = await imgRes.json() as { url: string }
  const sourceUrl = imgData.url

  // Create talk
  const talkRes = await fetch('https://api.d-id.com/talks', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_url: sourceUrl,
      script: {
        type:      'audio',
        audio_url: audioUrl,
      },
      config: {
        result_format:     'mp4',
        expression_factor: Math.min(Math.max(expressionScale, 0), 1),
      },
    }),
  })
  if (!talkRes.ok) {
    const err = await talkRes.text()
    throw new Error(`Character Animation (D-ID): talk creation failed (${talkRes.status}) — ${err}`)
  }
  const talkData = await talkRes.json() as { id: string }

  // Poll until done
  const resultUrl = await pollDID(talkData.id, auth)
  const videoRes  = await fetch(resultUrl)
  if (!videoRes.ok) throw new Error(`Character Animation (D-ID): video download failed (${videoRes.status})`)
  return Buffer.from(await videoRes.arrayBuffer())
}

async function pollDID(talkId: string, auth: string, maxMs = 300_000): Promise<string> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    const res  = await fetch(`https://api.d-id.com/talks/${talkId}`, { headers: { Authorization: auth } })
    const data = await res.json() as { status: string; result_url?: string; error?: unknown }
    if (data.status === 'done' && data.result_url) return data.result_url
    if (data.status === 'error') throw new Error(`Character Animation (D-ID): generation failed — ${JSON.stringify(data.error)}`)
  }
  throw new Error('Character Animation (D-ID): timed out after 5 minutes')
}

// ─── HeyGen helpers ──────────────────────────────────────────────────────────

/** Return the first available English voice on the account (used when no voice_id is configured). */
async function fetchDefaultHeyGenVoiceId(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.heygen.com/v2/voices', {
      headers: { 'X-Api-Key': apiKey },
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: { voices?: Array<{ voice_id: string; language: string; name: string }> } }
    const voices = data.data?.voices ?? []
    // Prefer English voices; fall back to whatever is first
    const english = voices.find(v => v.language?.toLowerCase().startsWith('en'))
    const chosen = english ?? voices[0]
    if (chosen) {
      console.log(`[character-animation] HeyGen TTS: using default voice "${chosen.name}" (${chosen.voice_id})`)
    }
    return chosen?.voice_id ?? null
  } catch {
    return null
  }
}

/** Fetch all avatar + talking-photo IDs on this HeyGen account for error diagnostics. */
async function listHeyGenIds(apiKey: string): Promise<string> {
  const headers = { 'X-Api-Key': apiKey }
  const lines: string[] = []

  try {
    // Avatars (stock + custom)
    const aRes  = await fetch('https://api.heygen.com/v2/avatars', { headers })
    if (aRes.ok) {
      const aData = await aRes.json() as { data?: { avatars?: Array<{ avatar_id: string; avatar_name: string }> } }
      const avatars = aData.data?.avatars ?? []
      if (avatars.length > 0) {
        lines.push('Available avatars on your account:')
        for (const a of avatars.slice(0, 10)) {
          lines.push(`  avatar_id: ${a.avatar_id}  (${a.avatar_name})`)
        }
        if (avatars.length > 10) lines.push(`  … and ${avatars.length - 10} more`)
      }
    }
  } catch { /* non-critical */ }

  try {
    // Talking photos
    const tRes  = await fetch('https://api.heygen.com/v1/talking_photo.list', { headers })
    if (tRes.ok) {
      const tData = await tRes.json() as { data?: { list?: Array<{ id: string; circle_image: string }> } }
      const photos = tData.data?.list ?? []
      if (photos.length > 0) {
        lines.push('Available talking photos on your account:')
        for (const p of photos.slice(0, 10)) {
          lines.push(`  talking_photo_id: ${p.id}`)
        }
        if (photos.length > 10) lines.push(`  … and ${photos.length - 10} more`)
      }
    }
  } catch { /* non-critical */ }

  if (lines.length === 0) {
    return 'Could not retrieve available IDs — check that HEYGEN_API_KEY is correct and the avatar exists in the same HeyGen workspace as the API key.'
  }
  return lines.join('\n')
}

// ─── HeyGen ───────────────────────────────────────────────────────────────────
// TODO: HeyGen renders are very slow (10–20 min per clip) and the UX is poor compared to D-ID.
//       Test this path end-to-end before shipping to users. Consider removing and directing
//       everyone to D-ID unless HeyGen performance improves significantly.

async function generateWithHeyGen(
  audioKey: string | null,
  photo: PhotoAsset,
  avatarId: string,
  talkingPhotoId: string,
  textInput: string | null,
  heygenVoiceId: string,
): Promise<Buffer> {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) throw new Error('Character Animation (HeyGen): HEYGEN_API_KEY not set')

  // Build voice input — prefer uploaded audio, fall back to HeyGen native TTS
  type VoiceInput =
    | { type: 'audio'; audio_asset_id: string }
    | { type: 'text'; input_text: string; voice_id?: string }

  let voice: VoiceInput

  if (textInput) {
    // Prefer HeyGen native TTS when text is available — avoids the asset upload entirely
    // voice_id is required by HeyGen; if not configured, fetch the account's first voice
    const resolvedVoiceId = heygenVoiceId || await fetchDefaultHeyGenVoiceId(apiKey)
    if (!resolvedVoiceId) throw new Error(
      'Character Animation (HeyGen): could not resolve a voice_id for TTS. ' +
      'Add a Voice ID in the node config (HeyGen dashboard → Voices).'
    )
    voice = { type: 'text', input_text: textInput, voice_id: resolvedVoiceId }
  } else if (audioKey) {
    // No text — upload pre-rendered audio (e.g. from ElevenLabs Voice Output node)
    const audioBuffer = await downloadBuffer(audioKey)
    const ext = audioKey.split('.').pop()?.toLowerCase() ?? 'mp3'
    const contentType = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg'
    let audioAssetId: string | null = null
    let uploadErr = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      const audioUploadRes = await fetch('https://upload.heygen.com/v1/asset', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': contentType },
        body: audioBuffer,
      })
      if (audioUploadRes.ok) {
        const audioAsset = await audioUploadRes.json() as { data: { id: string } }
        audioAssetId = audioAsset.data.id
        break
      }
      uploadErr = await audioUploadRes.text()
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
    }
    if (!audioAssetId) throw new Error(`Character Animation (HeyGen): audio upload failed after 3 attempts — ${uploadErr}`)
    voice = { type: 'audio', audio_asset_id: audioAssetId }
  } else {
    throw new Error(
      'Character Animation (HeyGen): no audio or text input. ' +
      'Connect a Voice Output node OR an AI Generate / Text Input node with the script.'
    )
  }

  // The same ID may be an avatar or a talking_photo — HeyGen treats them differently.
  // Try avatar first; if HeyGen returns 404 ("avatar look not found"), automatically
  // retry as talking_photo so the user doesn't need to know which field to use.
  type CharacterInput =
    | { type: 'avatar'; avatar_id: string; avatar_style: string }
    | { type: 'talking_photo'; talking_photo_id: string }

  const resolvedId = avatarId || talkingPhotoId
  if (!resolvedId) {
    throw new Error(
      'Character Animation (HeyGen): no Avatar ID or Talking Photo ID configured. ' +
      'Paste the ID from your HeyGen dashboard into the Avatar ID field in the node config.'
    )
  }

  // Prefer talking_photo when ID came from the talking photo field, else try avatar first
  const tryOrder: CharacterInput[] = talkingPhotoId
    ? [
        { type: 'talking_photo', talking_photo_id: resolvedId },
        { type: 'avatar',        avatar_id: resolvedId, avatar_style: 'normal' },
      ]
    : [
        { type: 'avatar',        avatar_id: resolvedId, avatar_style: 'normal' },
        { type: 'talking_photo', talking_photo_id: resolvedId },
      ]

  let videoId: string | null = null
  let lastErr = ''

  for (const character of tryOrder) {
    const genRes = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_inputs: [{ character, voice, background: { type: 'color', value: '#000000' } }],
        dimension: { width: 1280, height: 720 },
      }),
    })
    if (genRes.ok) {
      const genData = await genRes.json() as { data: { video_id: string } }
      videoId = genData.data.video_id
      break
    }
    const errBody = await genRes.text()
    // Only retry on 404 "avatar look not found" — propagate all other errors immediately
    if (genRes.status === 404 && errBody.includes('avatar look not found')) {
      lastErr = errBody
      continue
    }
    throw new Error(`Character Animation (HeyGen): video generation failed (${genRes.status}) — ${errBody}`)
  }

  if (!videoId) {
    // Fetch available IDs from the account to give an actionable error
    const hint = await listHeyGenIds(apiKey)
    throw new Error(
      `Character Animation (HeyGen): ID "${resolvedId}" not found on this account.\n` +
      hint
    )
  }

  const resultUrl = await pollHeyGen(videoId, apiKey)
  return Buffer.from(await (await fetch(resultUrl)).arrayBuffer())
}

async function pollHeyGen(videoId: string, apiKey: string, maxMs = 900_000): Promise<string> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000))
    const res  = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': apiKey },
    })
    const data = await res.json() as { data: { status: string; video_url?: string; error?: string } }
    const { status, video_url, error } = data.data
    if (status === 'completed' && video_url) return video_url
    if (status === 'failed') throw new Error(`Character Animation (HeyGen): generation failed — ${error ?? 'unknown'}`)
  }
  throw new Error('Character Animation (HeyGen): timed out after 15 minutes')
}

// ─── SadTalker (local) ───────────────────────────────────────────────────────

async function generateWithSadTalker(
  audioKey: string,
  photo: PhotoAsset,
  sadtalkerUrl: string,
  stillMode: boolean,
  expressionScale: number,
): Promise<Buffer> {
  const base        = sadtalkerUrl.replace(/\/$/, '')

  // Pre-flight: confirm server is up before sending large payloads
  try {
    const ping = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) })
    if (!ping.ok && ping.status !== 404) throw new Error(`status ${ping.status}`)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Character Animation (SadTalker): server not reachable at ${base} (${reason}). ` +
      `Start it with: bash scripts/start-local-audio.sh sadtalker`
    )
  }

  const audioBuffer = await downloadBuffer(audioKey)
  const photoExt    = photo.mime.includes('png') ? 'png' : 'jpg'

  const formData = new FormData()
  formData.append('audio',            new Blob([audioBuffer], { type: 'audio/mpeg' }), 'voice.mp3')
  formData.append('image',            new Blob([photo.buffer], { type: photo.mime }), `photo.${photoExt}`)
  formData.append('still',            String(stillMode))
  formData.append('expression_scale', String(expressionScale))
  formData.append('enhancer',         'gfpgan')

  const res = await fetch(`${base}/generate`, { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Character Animation (SadTalker): server error (${res.status}) — ${err}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('video')) return Buffer.from(await res.arrayBuffer())

  const json = await res.json() as { video_url?: string; localPath?: string }
  if (json.video_url) return Buffer.from(await (await fetch(json.video_url)).arrayBuffer())
  if (json.localPath) return fs.readFileSync(json.localPath)
  throw new Error('Character Animation (SadTalker): no video in response')
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class CharacterAnimationNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const providerRaw        = (config.provider as string)              ?? 'did'
    // Normalize common misspellings/variants from AI-generated configs
    const provider           = providerRaw === 'heyegen' || providerRaw === 'hey-gen' ? 'heygen'
                             : providerRaw === 'd-id'    || providerRaw === 'did.ai'  ? 'did'
                             : providerRaw
    const characterImage     = (config.character_image as string)        ?? ''
    const heygenAvatarId     = (config.heygen_avatar_id as string)       ?? ''
    const heygenTalkingPhoto = (config.heygen_talking_photo_id as string) ?? ''
    const sadtalkerUrl    = (config.sadtalker_base_url as string) ?? 'http://localhost:7860'
    const expressionScale = (config.expression_scale as number) ?? 1.0
    const stillMode       = (config.still_mode as boolean)      ?? false

    const heygenVoiceId = (config.heygen_voice_id as string) ?? ''

    const { audioKey, audioLocalPath, imageKey, textInput } = resolveInputs(input)

    // D-ID and SadTalker always need a pre-rendered audio file.
    // HeyGen can use its own TTS from a text input — audio is optional.
    if (provider === 'did' || provider === 'sadtalker') {
      if (!audioKey) throw new Error('Character Animation: no audio input connected — connect a Voice Output or Audio Mix node')
    }

    const photo = await resolvePhoto(imageKey, characterImage)
    if (!photo) throw new Error('Character Animation: no character photo — drop a photo onto the node or connect an Image Generation node')

    let videoBuffer: Buffer

    switch (provider) {
      case 'did':
        videoBuffer = await generateWithDID(audioKey!, photo, expressionScale)
        break
      case 'heygen':
        videoBuffer = await generateWithHeyGen(audioKey, photo, heygenAvatarId, heygenTalkingPhoto, textInput, heygenVoiceId)
        break
      case 'sadtalker':
        videoBuffer = await generateWithSadTalker(audioKey!, photo, sadtalkerUrl, stillMode, expressionScale)
        break
      default:
        throw new Error(`Character Animation: unknown provider "${provider}"`)
    }

    const filename   = `char_anim_${randomUUID()}.mp4`
    const storageKey = await saveGeneratedFile(videoBuffer, filename, 'video/mp4')
    const localPath  = `/files/generated/${filename}`

    // Probe output video duration for billing — non-blocking, failure returns 0
    const durationSecs = await probeDuration(videoBuffer, 'mp4')

    return {
      output: {
        localPath,
        storageKey,
        type:     'video',
        provider,
      } satisfies CharacterAnimationResult,
      mediaUsage: {
        provider:    provider === 'sadtalker' ? 'local' : provider,
        subtype:     'character_animation',
        durationSecs,
        model:       'default',
        isOnline:    provider !== 'sadtalker',
      },
    }
  }
}
