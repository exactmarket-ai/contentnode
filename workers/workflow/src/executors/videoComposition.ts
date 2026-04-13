/**
 * videoComposition.ts
 *
 * Compose a video from a background image + text overlay + optional audio.
 * Two render paths:
 *   local  — ffmpeg (default, no cloud cost)
 *   cloud  — Shotstack API (falls back to local on failure)
 */

import { exec }       from 'node:child_process'
import { promisify }  from 'node:util'
import { randomUUID } from 'node:crypto'
import path           from 'node:path'
import fs             from 'node:fs'
import os             from 'node:os'
import { saveGeneratedFile, downloadBuffer, localPath as storagePath } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const execAsync = promisify(exec)

// ─── Output type ──────────────────────────────────────────────────────────────

export interface VideoCompositionResult {
  localPath:  string
  storageKey: string
  renderMode: 'local' | 'cloud'
  cloudUrl?:  string
  duration:   number
  type:       'video' | 'image'
  outputFormat: 'video' | 'image'
}

// ─── Shared render input ──────────────────────────────────────────────────────

interface RenderInput {
  bgPath:       string          // local filesystem path to background image
  text:         string          // main text content
  audioPath:    string | null   // local path to audio, or null
  audioUrl:     string | null   // public URL for cloud renderers
  overlayStyle: OverlayStyle
  brandColor:   string          // hex e.g. '#1a73e8'
  fontSize:     number
  duration:     number
  outputPath:   string
  outputFormat: 'video' | 'image'
}

type OverlayStyle = 'lower_third' | 'title_card' | 'pill_badge' | 'fullscreen'

// ─── Input resolution ─────────────────────────────────────────────────────────

interface StructuredInput {
  nodeId:    string
  nodeLabel: string
  nodeType:  string
  content:   unknown
}

interface ResolvedInputs {
  bgStorageKey:  string | null
  bgUrl:         string | null
  text:          string | null
  audioKey:      string | null
  audioLocalPath: string | null
}

function resolveInputs(input: unknown): ResolvedInputs {
  let bgStorageKey:   string | null = null
  let bgUrl:          string | null = null
  let text:           string | null = null
  let audioKey:       string | null = null
  let audioLocalPath: string | null = null

  // Plain string — single source/text-input node connected (runner prefixes "## Label\n\n")
  if (typeof input === 'string') {
    const body = input.replace(/^##[^\n]*\n\n/, '').trim()
    return { bgStorageKey: null, bgUrl: null, text: body || null, audioKey: null, audioLocalPath: null }
  }

  const items: StructuredInput[] = []

  if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).inputs)) {
    items.push(...((input as Record<string, unknown>).inputs as StructuredInput[]))
  } else if (Array.isArray(input)) {
    items.push(...(input as StructuredInput[]))
  } else if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    if (typeof o.text === 'string')       text = o.text
    if (typeof o.content === 'string')    text = text ?? o.content
    if (typeof o.storageKey === 'string') {
      if (o.type === 'audio' || typeof o.transcript === 'string') {
        audioKey = o.storageKey; audioLocalPath = (o.localPath as string) ?? null
      } else if (o.type === 'image') {
        bgStorageKey = o.storageKey
      } else if (typeof o.localPath === 'string' && (o.localPath as string).match(/\.(mp3|wav|m4a|ogg)$/i)) {
        audioKey = o.storageKey; audioLocalPath = o.localPath as string
      }
    }
    if (typeof o.url === 'string' && o.type === 'image') bgUrl = o.url
    return { bgStorageKey, bgUrl, text, audioKey, audioLocalPath }
  }

  for (const item of items) {
    // Plain string content — e.g. text-input / source node output
    if (typeof item.content === 'string') {
      if (!text) {
        const body = item.content.replace(/^##[^\n]*\n\n/, '').trim()
        text = body || null
      }
      continue
    }

    const c = item.content as Record<string, unknown> | null
    if (!c) continue
    // Text fields
    if (typeof c.text === 'string' && !text)    text = c.text
    if (typeof c.content === 'string' && !text) text = c.content
    if (typeof c.output === 'string' && !text)  text = c.output
    // Image
    if (typeof c.storageKey === 'string') {
      if (c.type === 'image' && !bgStorageKey) bgStorageKey = c.storageKey
      else if (c.type === 'audio' || typeof c.transcript === 'string') {
        if (!audioKey) { audioKey = c.storageKey; audioLocalPath = (c.localPath as string) ?? null }
      } else if (!bgStorageKey) bgStorageKey = c.storageKey
    }
    if (typeof c.url === 'string' && c.type === 'image' && !bgUrl) bgUrl = c.url
  }

  return { bgStorageKey, bgUrl, text, audioKey, audioLocalPath }
}

// ─── Hex helpers ──────────────────────────────────────────────────────────────

/** Convert #rrggbb to ffmpeg 0xRRGGBB format */
function hexToFfmpeg(hex: string): string {
  const h = hex.replace('#', '')
  return `0x${h.toUpperCase()}`
}

/** Convert #rrggbb to ffmpeg 0xRRGGBBaa (with alpha) */
function hexToFfmpegAlpha(hex: string, alpha = 'CC'): string {
  const h = hex.replace('#', '')
  return `0x${h.toUpperCase()}${alpha}`
}

// ─── Local ffmpeg renderer ────────────────────────────────────────────────────

async function renderLocal(input: RenderInput): Promise<void> {
  const { bgPath, text, audioPath, overlayStyle, brandColor, fontSize, duration, outputPath, outputFormat } = input

  // Split text into title + subtitle at first newline or mid-point
  const lines    = text.split('\n')
  const title    = lines[0]?.trim() ?? text.trim()
  const subtitle = lines[1]?.trim() ?? ''

  const colorA   = hexToFfmpegAlpha(brandColor)

  // Sanitize text for ffmpeg drawtext (escape colons, backslashes, apostrophes)
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")

  let vf: string

  // Font bundled via font-dejavu apk package (Dockerfile.worker)
  const FONT = 'fontfile=/usr/share/fonts/dejavu/DejaVuSans.ttf'

  switch (overlayStyle) {
    case 'lower_third': {
      // Colored bar at bottom + two text lines; global fade-in via fade filter
      vf = [
        `drawbox=x=0:y=ih-120:w=600:h=80:color=${colorA}:t=fill`,
        `drawtext=text='${esc(title)}':x=20:y=h-100:fontsize=${fontSize}:fontcolor=white:${FONT}`,
        subtitle ? `drawtext=text='${esc(subtitle)}':x=20:y=h-72:fontsize=${Math.round(fontSize * 0.65)}:fontcolor=#aaaaaa:${FONT}` : '',
        'fade=t=in:st=0:d=0.5',
      ].filter(Boolean).join(',')
      break
    }

    case 'title_card': {
      // Semi-transparent full-width bar, centered text
      vf = [
        `drawbox=x=0:y=(ih-${fontSize + 60})/2:w=iw:h=${fontSize + 60}:color=${colorA}:t=fill`,
        `drawtext=text='${esc(title)}':x=(w-text_w)/2:y='(h-text_h)/2':fontsize=${fontSize}:fontcolor=white:${FONT}`,
        'fade=t=in:st=0:d=0.5',
      ].join(',')
      break
    }

    case 'pill_badge': {
      // Padded box top-left with text (simpler than geq, no native rounding in ffmpeg drawbox)
      const pad = 12
      const bh  = fontSize + pad * 2
      const bw  = Math.max(title.length * (fontSize * 0.6), 120) + pad * 2
      vf = [
        `drawbox=x=${pad}:y=${pad}:w=${Math.round(bw)}:h=${bh}:color=${colorA}:t=fill`,
        `drawtext=text='${esc(title)}':x=${pad * 2}:y=${pad + 2}:fontsize=${fontSize}:fontcolor=white:${FONT}`,
        'fade=t=in:st=0:d=0.5',
      ].join(',')
      break
    }

    case 'fullscreen': {
      // Large centered text, no box
      vf = [
        `drawtext=text='${esc(title)}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=${Math.round(fontSize * 1.5)}:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:${FONT}`,
        subtitle ? `drawtext=text='${esc(subtitle)}':x=(w-text_w)/2:y=(h+${Math.round(fontSize * 1.5)})/2:fontsize=${fontSize}:fontcolor=#dddddd:${FONT}` : '',
        'fade=t=in:st=0:d=0.5',
      ].filter(Boolean).join(',')
      break
    }

    default:
      vf = `drawtext=text='${esc(title)}':x=20:y=20:fontsize=${fontSize}:fontcolor=white:${FONT}`
  }

  const audioInputs = (outputFormat === 'video' && audioPath && fs.existsSync(audioPath))
    ? [audioPath] : []

  // Build ffmpeg command from a given filter string (called twice if drawtext unavailable)
  const buildCmd = (filterStr: string): string => {
    if (outputFormat === 'image') {
      return [
        'ffmpeg -y',
        `-loop 1 -t 1 -i "${bgPath}"`,
        `-vf "${filterStr}"`,
        '-map 0:v',
        '-frames:v 1 -f image2',
        `"${outputPath}"`,
      ].join(' ')
    }
    return [
      'ffmpeg -y',
      `-loop 1 -t ${duration} -i "${bgPath}"`,
      ...audioInputs.map(a => `-i "${a}"`),
      `-vf "${filterStr}"`,
      '-map 0:v',
      ...audioInputs.map(() => '-map 1:a'),
      ...audioInputs.map(() => '-shortest'),
      '-c:v libx264 -preset fast -crf 23',
      audioInputs.length ? '-c:a aac -b:a 128k' : '',
      `-t ${duration}`,
      `"${outputPath}"`,
    ].filter(Boolean).join(' ')
  }

  try {
    await execAsync(buildCmd(vf), { timeout: 120_000 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // drawtext requires libfreetype — not compiled into all ffmpeg builds (e.g. macOS Homebrew default).
    // Fall back to rendering without text overlay so local dev still works.
    if (vf.includes('drawtext') && (msg.includes('drawtext') || msg.includes('Filter not found'))) {
      const vfNoText = vf.split(',').filter(f => !f.trim().startsWith('drawtext=')).join(',')
      const fallbackVf = vfNoText || 'null'
      console.warn('[video-composition] drawtext unavailable (ffmpeg built without libfreetype) — rendering without text overlay')
      await execAsync(buildCmd(fallbackVf), { timeout: 120_000 })
    } else {
      throw err
    }
  }
}

// ─── Shotstack cloud renderer ─────────────────────────────────────────────────

interface ShotstackTrack {
  clips: ShotstackClip[]
}
interface ShotstackClip {
  asset: Record<string, unknown>
  start:    number
  length:   number
  position?: string
  offset?:  { x: number; y: number }
  transition?: { in?: string; out?: string }
  fit?:     string
}

function buildShotstackTimeline(input: RenderInput): Record<string, unknown> {
  const { bgPath, text, audioUrl, overlayStyle, brandColor, fontSize, duration } = input

  const lines    = text.split('\n')
  const title    = lines[0]?.trim() ?? text.trim()
  const subtitle = lines[1]?.trim() ?? ''

  const bgAsset = bgPath.startsWith('http')
    ? { type: 'image', src: bgPath }
    : { type: 'image', src: bgPath } // will be replaced with public URL at call site

  const bgClip: ShotstackClip = {
    asset: bgAsset,
    start: 0, length: duration, fit: 'cover',
    transition: { in: 'fade', out: 'fade' },
  }

  let textClip: ShotstackClip

  switch (overlayStyle) {
    case 'lower_third':
      textClip = {
        asset: {
          type: 'title',
          text: subtitle ? `${title}\n${subtitle}` : title,
          style: 'subtitle',
          color: '#ffffff',
          size: fontSize <= 24 ? 'small' : fontSize <= 32 ? 'medium' : 'large',
          background: brandColor,
        },
        start: 0, length: duration, position: 'bottom',
        transition: { in: 'slideUp' },
      }
      break

    case 'title_card':
      textClip = {
        asset: {
          type: 'title',
          text: title,
          style: 'minimal',
          color: '#ffffff',
          size: 'large',
          background: brandColor,
        },
        start: 0, length: duration, position: 'center',
        transition: { in: 'fade' },
      }
      break

    case 'pill_badge':
      textClip = {
        asset: {
          type: 'html',
          html: `<p style="background:${brandColor};color:#fff;padding:8px 18px;border-radius:999px;font-size:${fontSize}px;font-family:sans-serif;white-space:nowrap">${title}</p>`,
          width: 400, height: 80,
        },
        start: 0, length: duration, position: 'topLeft',
        offset: { x: 0.05, y: 0.05 },
        transition: { in: 'fade' },
      }
      break

    case 'fullscreen':
    default:
      textClip = {
        asset: {
          type: 'title',
          text: subtitle ? `${title}\n${subtitle}` : title,
          style: 'future',
          color: '#ffffff',
          size: 'x-large',
        },
        start: 0, length: duration, position: 'center',
        transition: { in: 'fade' },
      }
  }

  const tracks: ShotstackTrack[] = [
    { clips: [bgClip] },
    { clips: [textClip] },
  ]

  const timeline: Record<string, unknown> = { tracks }
  if (audioUrl) {
    timeline.soundtrack = { src: audioUrl, effect: 'fadeOut' }
  }

  return {
    timeline,
    output: { format: 'mp4', resolution: 'hd' },
  }
}

async function renderCloud(input: RenderInput): Promise<string> {
  const apiKey = process.env.SHOTSTACK_API_KEY
  if (!apiKey) throw new Error('Video Composition (Shotstack): SHOTSTACK_API_KEY not set')

  const env     = (process.env.SHOTSTACK_ENV ?? 'stage') === 'production' ? 'v1' : 'stage/v1'
  const apiBase = `https://api.shotstack.io/${env}`

  const payload = buildShotstackTimeline(input)

  const res = await fetch(`${apiBase}/render`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Video Composition (Shotstack): render request failed (${res.status}) — ${err}`)
  }
  const data = await res.json() as { response: { id: string } }
  const renderId = data.response.id

  return renderId
}

async function pollShotstack(renderId: string, maxMs = 120_000): Promise<string> {
  const apiKey  = process.env.SHOTSTACK_API_KEY!
  const env     = (process.env.SHOTSTACK_ENV ?? 'stage') === 'production' ? 'v1' : 'stage/v1'
  const apiBase = `https://api.shotstack.io/${env}`
  const deadline = Date.now() + maxMs

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    const res  = await fetch(`${apiBase}/render/${renderId}`, {
      headers: { 'x-api-key': apiKey },
    })
    const data = await res.json() as { response: { status: string; url?: string; error?: string } }
    const { status, url, error } = data.response
    if (status === 'done' && url)   return url
    if (status === 'failed')        throw new Error(`Video Composition (Shotstack): render failed — ${error ?? 'unknown'}`)
  }
  throw new Error('Video Composition (Shotstack): timed out after 2 minutes')
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export class VideoCompositionExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const renderMode    = (config.render_mode as string)    ?? 'local'
    const outputFormat  = (config.output_format as 'video' | 'image') ?? 'video'
    const overlayStyle  = (config.overlay_style as OverlayStyle) ?? 'lower_third'
    const brandColor    = (config.brand_color as string)   ?? '#1a73e8'
    const fontSize      = (config.font_size as number)     ?? 28
    const duration      = (config.duration as number)      ?? 10
    const configText    = (config.text as string)          ?? ''
    const configBgUrl   = (config.background_url as string) ?? ''

    const { bgStorageKey, bgUrl, text: inputText, audioKey, audioLocalPath } = resolveInputs(input)
    const text = inputText ?? configText
    if (!text) throw new Error('Video Composition: no text connected — connect a text/content node or set text in config')

    // ── Resolve background image to a local file ───────────────────────────
    const tmpDir = os.tmpdir()
    let bgPath:  string

    if (configBgUrl && configBgUrl.startsWith('data:')) {
      // Base64 data URI from config panel
      const [, b64] = configBgUrl.split(',')
      bgPath = path.join(tmpDir, `vcbg_${randomUUID()}.jpg`)
      fs.writeFileSync(bgPath, Buffer.from(b64, 'base64'))
    } else if (bgStorageKey) {
      const buf = await downloadBuffer(bgStorageKey)
      bgPath = path.join(tmpDir, `vcbg_${randomUUID()}.jpg`)
      fs.writeFileSync(bgPath, Buffer.from(buf))
    } else if ((configBgUrl || bgUrl) && (configBgUrl || bgUrl)!.startsWith('http')) {
      const url = (configBgUrl || bgUrl)!
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Video Composition: failed to fetch background image from ${url}`)
      bgPath = path.join(tmpDir, `vcbg_${randomUUID()}.jpg`)
      fs.writeFileSync(bgPath, Buffer.from(await res.arrayBuffer()))
    } else {
      throw new Error('Video Composition: no background image — connect an Image Generation node or paste a URL in config')
    }

    // ── Resolve audio ──────────────────────────────────────────────────────
    let audioPath: string | null = null
    if (audioKey) {
      const resolvedLocal = audioLocalPath
        ? path.join(process.env.UPLOAD_DIR ?? './uploads', audioLocalPath.replace(/^\/files\//, ''))
        : null
      if (resolvedLocal && fs.existsSync(resolvedLocal)) {
        audioPath = resolvedLocal
      } else {
        const buf = await downloadBuffer(audioKey)
        audioPath = path.join(tmpDir, `vcaud_${randomUUID()}.mp3`)
        fs.writeFileSync(audioPath, Buffer.from(buf))
      }
    }

    // Build public audio URL for cloud renderer
    const apiBase  = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
    const audioUrl = (audioLocalPath && apiBase && !apiBase.includes('localhost'))
      ? `${apiBase}${audioLocalPath}`
      : null

    const outputExt = outputFormat === 'image' ? 'jpg' : 'mp4'
    const outputTmp = path.join(tmpDir, `vc_${randomUUID()}.${outputExt}`)

    const renderInput: RenderInput = {
      bgPath,
      text,
      audioPath,
      audioUrl,
      overlayStyle,
      brandColor,
      fontSize,
      duration,
      outputPath: outputTmp,
      outputFormat,
    }

    let actualMode: 'local' | 'cloud' = renderMode as 'local' | 'cloud'
    let cloudUrl: string | undefined

    // Image mode always uses local ffmpeg (Shotstack doesn't produce still images)
    if (outputFormat === 'image') actualMode = 'local'

    if (renderMode === 'cloud' && outputFormat !== 'image') {
      try {
        const renderId = await renderCloud(renderInput)
        const videoUrl = await pollShotstack(renderId)
        cloudUrl = videoUrl

        // Download the cloud video to the tmp output path
        const vidRes = await fetch(videoUrl)
        if (!vidRes.ok) throw new Error(`Shotstack video download failed (${vidRes.status})`)
        fs.writeFileSync(outputTmp, Buffer.from(await vidRes.arrayBuffer()))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[video-composition] Shotstack failed (${msg}), falling back to local ffmpeg`)
        actualMode = 'local'
        cloudUrl   = undefined
        await renderLocal(renderInput)
      }
    } else {
      await renderLocal(renderInput)
    }

    const videoBuffer = fs.readFileSync(outputTmp)
    fs.unlinkSync(outputTmp)

    // Cleanup temp bg/audio files
    try { fs.unlinkSync(bgPath) } catch { /* ignore */ }
    if (audioPath && audioPath.startsWith(tmpDir)) {
      try { fs.unlinkSync(audioPath) } catch { /* ignore */ }
    }

    const isImage    = outputFormat === 'image'
    const filename   = isImage ? `video_comp_${randomUUID()}.jpg` : `video_comp_${randomUUID()}.mp4`
    const mimeType   = isImage ? 'image/jpeg' : 'video/mp4'
    const storageKey = await saveGeneratedFile(videoBuffer, filename, mimeType)
    const localPath  = `/files/generated/${filename}`

    return {
      output: {
        localPath,
        storageKey,
        renderMode: actualMode,
        cloudUrl,
        duration,
        outputFormat,
        type: isImage ? 'image' : 'video',
      } satisfies VideoCompositionResult,
    }
  }
}
