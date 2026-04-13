import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
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
}

function resolveInputs(input: unknown): ResolvedInputs {
  let audioKey:       string | null = null
  let audioLocalPath: string | null = null
  let imageKey:       string | null = null

  const items: StructuredInput[] = []

  if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).inputs)) {
    items.push(...((input as Record<string, unknown>).inputs as StructuredInput[]))
  } else if (Array.isArray(input)) {
    items.push(...(input as StructuredInput[]))
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
    }
    return { audioKey, audioLocalPath, imageKey }
  }

  for (const item of items) {
    const content = item.content as Record<string, unknown> | null
    if (!content || typeof content.storageKey !== 'string') continue
    const key = content.storageKey as string
    if (content.type === 'audio' || typeof content.transcript === 'string') {
      if (!audioKey) {
        audioKey = key
        audioLocalPath = (content.localPath as string) ?? null
      }
    } else if (content.type === 'image') {
      imageKey = imageKey ?? key
    } else {
      if (!audioKey) {
        audioKey = key
        audioLocalPath = (content.localPath as string) ?? null
      }
    }
  }

  return { audioKey, audioLocalPath, imageKey }
}

// ─── Photo resolution ────────────────────────────────────────────────────────
// Returns { buffer, mime } for providers that upload the file,
// or a plain URL string for providers that need a hosted link.

interface PhotoAsset { buffer: Buffer; mime: string }

// Resize + compress to stay under provider upload limits (D-ID: 10 MB)
async function compressPhoto(photo: PhotoAsset, maxBytes = 8 * 1024 * 1024): Promise<PhotoAsset> {
  if (photo.buffer.length <= maxBytes) return photo
  // Resize to max 1280px wide, convert to jpeg at quality 85
  const compressed = await sharp(photo.buffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  // If still too large, reduce quality further
  if (compressed.length > maxBytes) {
    const smaller = await sharp(photo.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()
    return { buffer: smaller, mime: 'image/jpeg' }
  }
  return { buffer: compressed, mime: 'image/jpeg' }
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
  audioLocalPath: string,
  photo: PhotoAsset,
  expressionScale: number,
): Promise<Buffer> {
  const apiKey = process.env.DID_API_KEY
  if (!apiKey) throw new Error('Character Animation (D-ID): DID_API_KEY not set')

  const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  if (!apiBase || apiBase.includes('localhost') || apiBase.includes('127.0.0.1')) {
    throw new Error(
      'Character Animation (D-ID): API_BASE_URL must be a public URL (e.g. your Railway API URL) so D-ID can fetch the audio. ' +
      'Set API_BASE_URL in workers/workflow/.env, or use SadTalker for local testing.'
    )
  }

  const auth     = didAuth(apiKey)
  const audioUrl = `${apiBase}${audioLocalPath}`

  // Compress photo to stay under D-ID's 10 MB limit
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

  // Create talk — audio_url must be a public URL
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

// ─── HeyGen ───────────────────────────────────────────────────────────────────

async function generateWithHeyGen(
  audioKey: string,
  photo: PhotoAsset,
  avatarId: string,
): Promise<Buffer> {
  const apiKey = process.env.HEYGEN_API_KEY
  if (!apiKey) throw new Error('Character Animation (HeyGen): HEYGEN_API_KEY not set')

  // Upload audio
  const audioBuffer    = await downloadBuffer(audioKey)
  const audioUploadRes = await fetch('https://upload.heygen.com/v1/asset', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'audio/mpeg' },
    body: audioBuffer,
  })
  if (!audioUploadRes.ok) {
    const err = await audioUploadRes.text()
    throw new Error(`Character Animation (HeyGen): audio upload failed (${audioUploadRes.status}) — ${err}`)
  }
  const audioAsset   = await audioUploadRes.json() as { data: { id: string } }
  const audioAssetId = audioAsset.data.id

  // Build character input
  type CharacterInput =
    | { type: 'avatar'; avatar_id: string; avatar_style: string }
    | { type: 'talking_photo'; talking_photo_id: string }

  let character: CharacterInput
  if (avatarId) {
    character = { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' }
  } else {
    const photoUploadRes = await fetch('https://upload.heygen.com/v1/asset', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': photo.mime },
      body: photo.buffer,
    })
    if (!photoUploadRes.ok) {
      const err = await photoUploadRes.text()
      throw new Error(`Character Animation (HeyGen): photo upload failed (${photoUploadRes.status}) — ${err}`)
    }
    const photoAsset = await photoUploadRes.json() as { data: { id: string } }
    character = { type: 'talking_photo', talking_photo_id: photoAsset.data.id }
  }

  // Generate video
  const genRes = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_inputs: [{
        character,
        voice:      { type: 'audio', audio_asset_id: audioAssetId },
        background: { type: 'color', value: '#000000' },
      }],
      dimension: { width: 1280, height: 720 },
    }),
  })
  if (!genRes.ok) {
    const err = await genRes.text()
    throw new Error(`Character Animation (HeyGen): video generation failed (${genRes.status}) — ${err}`)
  }
  const genData = await genRes.json() as { data: { video_id: string } }
  const videoId = genData.data.video_id

  const resultUrl = await pollHeyGen(videoId, apiKey)
  return Buffer.from(await (await fetch(resultUrl)).arrayBuffer())
}

async function pollHeyGen(videoId: string, apiKey: string, maxMs = 300_000): Promise<string> {
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
  throw new Error('Character Animation (HeyGen): timed out after 5 minutes')
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
    const provider        = (config.provider as string)         ?? 'did'
    const characterImage  = (config.character_image as string)  ?? ''
    const heygenAvatarId  = (config.heygen_avatar_id as string) ?? ''
    const sadtalkerUrl    = (config.sadtalker_base_url as string) ?? 'http://localhost:7860'
    const expressionScale = (config.expression_scale as number) ?? 1.0
    const stillMode       = (config.still_mode as boolean)      ?? false

    const { audioKey, audioLocalPath, imageKey } = resolveInputs(input)
    if (!audioKey) throw new Error('Character Animation: no audio input connected')
    if (!audioLocalPath) throw new Error('Character Animation: audio input missing localPath — reconnect the Voice Output or Audio Mix node')

    const photo = await resolvePhoto(imageKey, characterImage)
    if (!photo) throw new Error('Character Animation: no character photo — drop a photo onto the node or connect an Image Generation node')

    let videoBuffer: Buffer

    switch (provider) {
      case 'did':
        videoBuffer = await generateWithDID(audioLocalPath, photo, expressionScale)
        break
      case 'heygen':
        videoBuffer = await generateWithHeyGen(audioKey, photo, heygenAvatarId)
        break
      case 'sadtalker':
        videoBuffer = await generateWithSadTalker(audioKey, photo, sadtalkerUrl, stillMode, expressionScale)
        break
      default:
        throw new Error(`Character Animation: unknown provider "${provider}"`)
    }

    const filename   = `char_anim_${randomUUID()}.mp4`
    const storageKey = await saveGeneratedFile(videoBuffer, filename, 'video/mp4')
    const localPath  = `/files/generated/${filename}`

    return {
      output: {
        localPath,
        storageKey,
        type:     'video',
        provider,
      } satisfies CharacterAnimationResult,
    }
  }
}
