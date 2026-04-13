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
import sharp from 'sharp'
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
  bgPath:       string          // local filesystem path to background image or video
  bgIsVideo:    boolean         // true when bgPath is a video file (skip loop filter)
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
  bgStorageKey:   string | null
  bgUrl:          string | null
  videoKey:       string | null   // upstream video (character-animation, video-generation, etc.)
  text:           string | null
  audioKey:       string | null
  audioLocalPath: string | null
  audioIsTTS:     boolean         // true when audio came from a Voice Output node (has transcript)
}

function resolveInputs(input: unknown): ResolvedInputs {
  let bgStorageKey:   string | null = null
  let bgUrl:          string | null = null
  let videoKey:       string | null = null
  let text:           string | null = null
  let audioKey:       string | null = null
  let audioLocalPath: string | null = null
  let audioIsTTS                    = false

  // Plain string — single source/text-input node connected (runner prefixes "## Label\n\n")
  if (typeof input === 'string') {
    const body = input.replace(/^##[^\n]*\n\n/, '').trim()
    return { bgStorageKey: null, bgUrl: null, videoKey: null, text: body || null, audioKey: null, audioLocalPath: null, audioIsTTS: false }
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
    // Image generation output: { assets: [{ type: 'image', storageKey, localPath }] }
    if (Array.isArray(o.assets)) {
      for (const a of o.assets as Record<string, unknown>[]) {
        if (a.type === 'image' && typeof a.storageKey === 'string') {
          bgStorageKey = a.storageKey
          break
        }
      }
    }
    if (typeof o.storageKey === 'string') {
      if (o.type === 'audio' || typeof o.transcript === 'string') {
        audioKey = o.storageKey; audioLocalPath = (o.localPath as string) ?? null
        audioIsTTS = typeof o.transcript === 'string'
      } else if (o.type === 'video') {
        videoKey = o.storageKey
      } else if (o.type === 'image') {
        bgStorageKey = o.storageKey
      } else if (typeof o.localPath === 'string' && (o.localPath as string).match(/\.(mp3|wav|m4a|ogg)$/i)) {
        audioKey = o.storageKey; audioLocalPath = o.localPath as string
      } else if (typeof o.localPath === 'string' && (o.localPath as string).match(/\.(mp4|mov|webm)$/i)) {
        videoKey = o.storageKey
      }
    }
    if (typeof o.url === 'string' && o.type === 'image') bgUrl = o.url
    return { bgStorageKey, bgUrl, videoKey, text, audioKey, audioLocalPath, audioIsTTS }
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
    // Image generation output: { assets: [{ type: 'image', storageKey, localPath }] }
    if (!bgStorageKey && Array.isArray(c.assets)) {
      for (const a of c.assets as Record<string, unknown>[]) {
        if (a.type === 'image' && typeof a.storageKey === 'string') {
          bgStorageKey = a.storageKey
          break
        }
      }
    }
    // Direct storageKey on content (video upload, resize, etc.)
    if (typeof c.storageKey === 'string') {
      if (c.type === 'video' && !videoKey) {
        videoKey = c.storageKey
      } else if (c.type === 'image' && !bgStorageKey) {
        bgStorageKey = c.storageKey
      } else if (c.type === 'audio' || typeof c.transcript === 'string') {
        const isTTS = typeof c.transcript === 'string'
        // Prefer non-TTS (background music) over TTS — when bgIsVideo the voiceover is
        // already embedded in the video; mixing it again would create an echo.
        if (!audioKey || (audioIsTTS && !isTTS)) {
          audioKey       = c.storageKey
          audioLocalPath = (c.localPath as string) ?? null
          audioIsTTS     = isTTS
        }
      } else if (typeof c.localPath === 'string' && (c.localPath as string).match(/\.(mp4|mov|webm)$/i)) {
        if (!videoKey) videoKey = c.storageKey
      } else if (!bgStorageKey) {
        bgStorageKey = c.storageKey
      }
    }
    if (typeof c.url === 'string' && c.type === 'image' && !bgUrl) bgUrl = c.url
  }

  return { bgStorageKey, bgUrl, videoKey, text, audioKey, audioLocalPath, audioIsTTS }
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

// ─── Sharp SVG text fallback (used when ffmpeg lacks libfreetype) ─────────────

/** Escape special XML characters for safe embedding in SVG text nodes */
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Composite text onto an image file using sharp + SVG.
 * Used as a fallback when the local ffmpeg build lacks drawtext (libfreetype).
 * Overwrites `imagePath` in-place with the composited result.
 */
async function addTextWithSharp(
  imagePath:    string,
  title:        string,
  subtitle:     string,
  overlayStyle: string,
  fontSize:     number,
): Promise<void> {
  const img = sharp(imagePath)
  const { width: w = 1280, height: h = 720 } = await img.metadata()

  // dominant-baseline="hanging" → y is the top of the text (matches ffmpeg drawtext y semantics)
  // dominant-baseline="middle"  → y is the vertical center of the text
  const FONT  = 'font-family="Arial, Helvetica, sans-serif"'
  const BOLD  = `${FONT} font-weight="bold"`
  const HANG  = 'dominant-baseline="hanging"'   // top-aligned (matches ffmpeg drawtext y)
  const MID   = 'dominant-baseline="middle"'    // center-aligned

  let textSvg: string

  switch (overlayStyle) {
    case 'lower_third': {
      // Mirror the dynamic barH calculation from renderLocal
      const vPad     = 14
      const lineGap  = 6
      const subFont  = subtitle ? Math.round(fontSize * 0.65) : 0
      const contentH = subtitle ? fontSize + lineGap + subFont : fontSize
      const barH     = contentH + vPad * 2
      // Use dominant-baseline="middle" with y at the visual center of each text line.
      // Single line: center of the whole bar. Multi-line: each line centered within its slot.
      if (subtitle) {
        const titleCenterY = h - barH + vPad + fontSize / 2
        const subCenterY   = h - barH + vPad + fontSize + lineGap + subFont / 2
        textSvg = `
          <text x="20" y="${titleCenterY}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
          <text x="20" y="${subCenterY}" ${MID} font-size="${subFont}" fill="#dddddd" ${FONT}>${escXml(subtitle)}</text>
        `
      } else {
        // Single line: vertically center within the bar
        const titleCenterY = h - barH / 2
        textSvg = `
          <text x="20" y="${titleCenterY}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
        `
      }
      break
    }
    case 'title_card':
      // Text centered in the image (bar is also centered)
      textSvg = `
        <text x="${w / 2}" y="${h / 2}" ${MID} text-anchor="middle" font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
      `
      break
    case 'pill_badge': {
      const pad = 12
      const bh  = fontSize + pad * 2
      // Center text vertically within the badge box using dominant-baseline="middle"
      const badgeCenterY = pad + bh / 2
      textSvg = `
        <text x="${pad * 2}" y="${badgeCenterY}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
      `
      break
    }
    case 'fullscreen': {
      const bigFont = Math.round(fontSize * 1.5)
      textSvg = `
        <text x="${w / 2}" y="${h / 2}" ${MID} text-anchor="middle" font-size="${bigFont}" fill="white" ${BOLD}>${escXml(title)}</text>
        ${subtitle ? `<text x="${w / 2}" y="${h / 2 + bigFont}" ${MID} text-anchor="middle" font-size="${fontSize}" fill="#dddddd" ${FONT}>${escXml(subtitle)}</text>` : ''}
      `
      break
    }
    default:
      textSvg = `
        <text x="20" y="8" ${HANG} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
      `
  }

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${textSvg}</svg>`
  )

  const composited = await sharp(imagePath)
    .composite([{ input: svg, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer()

  fs.writeFileSync(imagePath, composited)
}

/**
 * Create a transparent PNG with the text overlay at the given dimensions.
 * Used as a fallback when ffmpeg lacks libfreetype (drawtext unavailable) and the
 * background is a video — in that case addTextWithSharp can't be used directly.
 * The caller overlays this PNG onto the video using ffmpeg's overlay filter.
 */
async function createTextOverlayPng(
  pngPath:      string,
  title:        string,
  subtitle:     string,
  overlayStyle: string,
  brandColor:   string,
  fontSize:     number,
  w = 1280,
  h = 720,
): Promise<void> {
  const FONT  = 'font-family="Arial, Helvetica, sans-serif"'
  const BOLD  = `${FONT} font-weight="bold"`
  const MID   = 'dominant-baseline="middle"'

  function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  let boxSvg = ''
  let textSvg = ''

  switch (overlayStyle) {
    case 'lower_third': {
      const vPad     = 14
      const lineGap  = 6
      const subFont  = subtitle ? Math.round(fontSize * 0.65) : 0
      const contentH = subtitle ? fontSize + lineGap + subFont : fontSize
      const barH     = contentH + vPad * 2
      const boxColor = hexToRgba(brandColor, 0.8)
      boxSvg  = `<rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${boxColor}"/>`
      if (subtitle) {
        textSvg = `
          <text x="20" y="${h - barH / 2 - fontSize / 2 - lineGap / 2}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>
          <text x="20" y="${h - barH / 2 + subFont / 2 + lineGap / 2}" ${MID} font-size="${subFont}" fill="#dddddd" ${FONT}>${escXml(subtitle)}</text>
        `
      } else {
        textSvg = `<text x="20" y="${h - barH / 2}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>`
      }
      break
    }
    case 'title_card': {
      const barH     = fontSize + 60
      const boxColor = hexToRgba(brandColor, 0.8)
      boxSvg  = `<rect x="0" y="${(h - barH) / 2}" width="${w}" height="${barH}" fill="${boxColor}"/>`
      textSvg = `<text x="${w / 2}" y="${h / 2}" ${MID} text-anchor="middle" font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>`
      break
    }
    case 'pill_badge': {
      const pad      = 12
      const bh       = fontSize + pad * 2
      const bw       = Math.max(title.length * (fontSize * 0.6), 120) + pad * 2
      const boxColor = hexToRgba(brandColor, 0.8)
      boxSvg  = `<rect x="${pad}" y="${pad}" width="${Math.round(bw)}" height="${bh}" rx="999" fill="${boxColor}"/>`
      textSvg = `<text x="${pad * 2}" y="${pad + bh / 2}" ${MID} font-size="${fontSize}" fill="white" ${BOLD}>${escXml(title)}</text>`
      break
    }
    case 'fullscreen':
    default: {
      const bigFont = Math.round(fontSize * 1.5)
      textSvg = `
        <text x="${w / 2}" y="${h / 2}" ${MID} text-anchor="middle" font-size="${bigFont}" fill="white" stroke="black" stroke-width="2" ${BOLD}>${escXml(title)}</text>
        ${subtitle ? `<text x="${w / 2}" y="${h / 2 + bigFont}" ${MID} text-anchor="middle" font-size="${fontSize}" fill="#dddddd" ${FONT}>${escXml(subtitle)}</text>` : ''}
      `
    }
  }

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${boxSvg}${textSvg}</svg>`
  )

  await sharp(svg).png().toFile(pngPath)
}

// ─── Local ffmpeg renderer ────────────────────────────────────────────────────

async function renderLocal(input: RenderInput, tmpDir?: string): Promise<void> {
  const { bgPath, bgIsVideo, text, audioPath, overlayStyle, brandColor, fontSize, duration, outputPath, outputFormat } = input

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
      // Bar height adapts to font size so text is always vertically centered
      const vPad    = 14
      const lineGap = 6
      const subFont = subtitle ? Math.round(fontSize * 0.65) : 0
      const contentH = subtitle ? fontSize + lineGap + subFont : fontSize
      const barH    = contentH + vPad * 2
      // Use runtime `text_h` so centering is based on actual rendered glyph height
      // (not fontSize, which includes reserved ascender/descender space in the em square)
      // Single line:   y = h - barH + (barH - text_h) / 2
      // Multi-line:    title anchored at barTop + vPad; subtitle below title
      if (subtitle) {
        vf = [
          `drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:color=${colorA}:t=fill`,
          `drawtext=text='${esc(title)}':x=20:y=h-${barH}+(${barH}-text_h)/2:fontsize=${fontSize}:fontcolor=white:${FONT}`,
          `drawtext=text='${esc(subtitle)}':x=20:y=h-${barH - vPad - fontSize - lineGap}+(${fontSize + lineGap}-text_h)/2:fontsize=${subFont}:fontcolor=#dddddd:${FONT}`,
          'fade=t=in:st=0:d=0.5',
        ].join(',')
      } else {
        vf = [
          `drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:color=${colorA}:t=fill`,
          `drawtext=text='${esc(title)}':x=20:y=h-${barH}+(${barH}-text_h)/2:fontsize=${fontSize}:fontcolor=white:${FONT}`,
          'fade=t=in:st=0:d=0.5',
        ].join(',')
      }
      break
    }

    case 'title_card': {
      // Full-width bar centered vertically; text centered in both axes
      const barH = fontSize + 60
      // Use explicit h/2 - fontSize/2 instead of text_h variable (more reliable cross-build)
      vf = [
        `drawbox=x=0:y=(ih-${barH})/2:w=iw:h=${barH}:color=${colorA}:t=fill`,
        `drawtext=text='${esc(title)}':x=(w-text_w)/2:y=(h-${fontSize})/2:fontsize=${fontSize}:fontcolor=white:${FONT}`,
        'fade=t=in:st=0:d=0.5',
      ].join(',')
      break
    }

    case 'pill_badge': {
      // Padded box top-left with text (simpler than geq, no native rounding in ffmpeg drawbox)
      const pad = 12
      const bh  = fontSize + pad * 2
      const bw  = Math.max(title.length * (fontSize * 0.6), 120) + pad * 2
      // Use runtime `text_h` to center text vertically within the badge box
      vf = [
        `drawbox=x=${pad}:y=${pad}:w=${Math.round(bw)}:h=${bh}:color=${colorA}:t=fill`,
        `drawtext=text='${esc(title)}':x=${pad * 2}:y=${pad}+(${bh}-text_h)/2:fontsize=${fontSize}:fontcolor=white:${FONT}`,
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

  // Fade filter only makes sense for static-image-to-video.
  // For bgIsVideo (character animation), it blacks out the first 0.5s while audio plays —
  // creating a perceptual echo (voice heard before face is visible). Strip it.
  // For image output (single frame) it also makes no sense — strip it there too.
  const activeVf = (outputFormat === 'image' || bgIsVideo)
    ? vf.split(',').filter(f => !f.trim().startsWith('fade=')).join(',') || 'null'
    : vf

  const audioInputs = (outputFormat === 'video' && audioPath && fs.existsSync(audioPath))
    ? [audioPath] : []

  // Build ffmpeg command from a given filter string (called twice if drawtext unavailable)
  const buildCmd = (filterStr: string): string => {
    if (outputFormat === 'image') {
      return [
        'ffmpeg -y -loglevel error -nostats',
        `-i "${bgPath}"`,
        `-vf "${filterStr}"`,
        '-map 0:v',
        '-frames:v 1 -f image2',
        `"${outputPath}"`,
      ].join(' ')
    }
    // Video input: use directly — no loop filter needed, video already has motion
    // Image input: use loop filter to hold the single decoded frame for the full duration
    const vf = bgIsVideo ? filterStr : `loop=loop=-1:size=1:start=0,${filterStr}`

    if (bgIsVideo) {
      // Preserve D-ID lip-sync audio. Do NOT mix external audio here — use Audio Mix node after.
      return [
        'ffmpeg -y -loglevel error -nostats',
        `-i "${bgPath}"`,
        `-vf "${vf}"`,
        '-map 0:v',
        '-map 0:a:0?',        // first audio stream only; ? = skip silently if absent
        '-c:v libx264 -preset fast -crf 18',
        '-c:a copy',          // copy audio stream as-is — zero re-encoding drift
        `"${outputPath}"`,
      ].join(' ')
    }

    return [
      'ffmpeg -y -loglevel error -nostats',
      `-i "${bgPath}"`,
      ...audioInputs.map(a => `-i "${a}"`),
      `-vf "${vf}"`,
      '-map 0:v',
      ...audioInputs.map((_, i) => `-map ${i + 1}:a`),
      '-shortest',
      '-c:v libx264 -preset fast -crf 23',
      audioInputs.length ? '-c:a aac -b:a 128k' : '',
      `-t ${duration}`,
      `"${outputPath}"`,
    ].filter(Boolean).join(' ')
  }

  const execOpts = { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 } // 50 MB — ffmpeg progress output is verbose
  try {
    await execAsync(buildCmd(activeVf), execOpts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // drawtext requires libfreetype — not compiled into all ffmpeg builds (e.g. macOS Homebrew default).
    // Render without drawtext first, then composite text via sharp SVG for image output.
    if (activeVf.includes('drawtext') && (msg.includes('drawtext') || msg.includes('Filter not found'))) {
      console.warn('[video-composition] drawtext unavailable (ffmpeg lacks libfreetype) — using sharp SVG text fallback')
      const vfNoText = activeVf.split(',').filter(f => !f.trim().startsWith('drawtext=')).join(',')
      await execAsync(buildCmd(vfNoText || 'null'), execOpts)
      if (outputFormat === 'image' && title) {
        // Image: composite text directly onto the output JPEG using sharp
        await addTextWithSharp(outputPath, title, subtitle, overlayStyle, fontSize)
      } else if (outputFormat === 'video' && bgIsVideo && title && tmpDir) {
        // Video: generate a transparent PNG overlay with the text, then composite via ffmpeg
        const overlayPng  = path.join(tmpDir, `vc_txt_${randomUUID()}.png`)
        const withTextTmp = path.join(tmpDir, `vc_txt2_${randomUUID()}.mp4`)
        await createTextOverlayPng(overlayPng, title, subtitle, overlayStyle, brandColor, fontSize)
        await execAsync([
          'ffmpeg -y -loglevel error -nostats',
          `-i "${outputPath}"`,
          `-i "${overlayPng}"`,
          // scale the PNG to match video dimensions, then overlay at top-left
          `-filter_complex "[1:v]scale=iw:ih[txt];[0:v][txt]overlay=0:0"`,
          '-map 0:a:0?',
          '-c:v libx264 -preset fast -crf 18',
          '-c:a copy',
          `"${withTextTmp}"`,
        ].join(' '), execOpts)
        fs.renameSync(withTextTmp, outputPath)
        try { fs.unlinkSync(overlayPng) } catch { /* ignore */ }
      }
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

    const { bgStorageKey, bgUrl, videoKey, text: inputText, audioKey, audioLocalPath, audioIsTTS } = resolveInputs(input)
    const text = inputText ?? configText
    if (!text) throw new Error('Video Composition: no text connected — connect a text/content node or set text in config')

    const tmpDir = os.tmpdir()

    // ── Resolve background — video takes priority over static image ────────
    let bgPath: string
    let bgIsVideo = false

    if (videoKey) {
      // Animated video input (character-animation, video-generation, etc.)
      const buf = await downloadBuffer(videoKey)
      bgPath = path.join(tmpDir, `vcbg_${randomUUID()}.mp4`)
      fs.writeFileSync(bgPath, Buffer.from(buf))
      bgIsVideo = true
    } else if (configBgUrl && configBgUrl.startsWith('data:')) {
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
      throw new Error('Video Composition: no background — connect a Character Animation, Image Generation, or Video Generation node')
    }

    // ── Resolve audio ──────────────────────────────────────────────────────
    // When the background is a video (D-ID/HeyGen), the voiceover is already embedded.
    // Mixing TTS audio again would create an echo. Only resolve non-TTS audio (background music).
    const resolvedAudioKey        = (bgIsVideo && audioIsTTS) ? null : audioKey
    const resolvedAudioLocalPath  = resolvedAudioKey ? audioLocalPath : null

    let audioPath: string | null = null
    if (resolvedAudioKey) {
      const localCheck = resolvedAudioLocalPath
        ? path.join(process.env.UPLOAD_DIR ?? './uploads', resolvedAudioLocalPath.replace(/^\/files\//, ''))
        : null
      if (localCheck && fs.existsSync(localCheck)) {
        audioPath = localCheck
      } else {
        const buf = await downloadBuffer(resolvedAudioKey)
        audioPath = path.join(tmpDir, `vcaud_${randomUUID()}.mp3`)
        fs.writeFileSync(audioPath, Buffer.from(buf))
      }
    }

    // Build public audio URL for cloud renderer
    const apiBase  = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
    const audioUrl = (resolvedAudioLocalPath && apiBase && !apiBase.includes('localhost'))
      ? `${apiBase}${resolvedAudioLocalPath}`
      : null

    const outputExt = outputFormat === 'image' ? 'jpg' : 'mp4'
    const outputTmp = path.join(tmpDir, `vc_${randomUUID()}.${outputExt}`)

    const renderInput: RenderInput = {
      bgPath,
      bgIsVideo,
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
        await renderLocal(renderInput, tmpDir)
      }
    } else {
      await renderLocal(renderInput, tmpDir)
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
      // Only track Shotstack renders (local ffmpeg has no per-use cost)
      ...(actualMode === 'cloud' && outputFormat === 'video' ? {
        mediaUsage: {
          provider:    'shotstack',
          subtype:     'video_composition',
          durationSecs: duration,
          model:       'default',
          isOnline:    true,
        },
      } : {}),
    }
  }
}
