/**
 * imageResize.ts
 *
 * Resizes an image to a preset (or custom) size using sharp.
 * Accepts input from: Image Generation, Video Frame Extractor, or any node
 * that outputs { storageKey } or { assets: [{ storageKey }] }.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { downloadBuffer, saveGeneratedFile, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export interface ResizePreset {
  width: number
  height: number
  label: string
  category: string
}

export const RESIZE_PRESETS: Record<string, ResizePreset> = {
  // Social
  'instagram-square':    { width: 1080, height: 1080, label: 'Instagram Square',    category: 'Social' },
  'instagram-portrait':  { width: 1080, height: 1350, label: 'Instagram Portrait',   category: 'Social' },
  'instagram-landscape': { width: 1080, height: 566,  label: 'Instagram Landscape',  category: 'Social' },
  'facebook-linkedin':   { width: 1200, height: 630,  label: 'Facebook / LinkedIn',  category: 'Social' },
  'twitter-x':           { width: 1200, height: 675,  label: 'Twitter / X',          category: 'Social' },
  'pinterest':           { width: 1000, height: 1500, label: 'Pinterest',            category: 'Social' },
  // Video
  'youtube-thumbnail':   { width: 1280, height: 720,  label: 'YouTube Thumbnail',    category: 'Video' },
  // Web
  'blog-thumbnail':      { width: 400,  height: 300,  label: 'Blog / CMS Thumbnail', category: 'Web' },
  'open-graph':          { width: 1200, height: 630,  label: 'Open Graph Preview',   category: 'Web' },
  'article-card':        { width: 800,  height: 450,  label: 'Article Card',         category: 'Web' },
  'avatar':              { width: 200,  height: 200,  label: 'Avatar / Profile',     category: 'Web' },
  // General
  'full-hd':             { width: 1920, height: 1080, label: 'Full HD',              category: 'General' },
  'custom':              { width: 0,    height: 0,    label: 'Custom',               category: 'General' },
}

function extractImageRef(input: unknown): { storageKey: string; filename?: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  // Image Generation output: { assets: [{ storageKey, localPath }] }
  if (Array.isArray(obj.assets) && obj.assets.length > 0) {
    const asset = obj.assets[0] as Record<string, unknown>
    if (typeof asset.storageKey === 'string') {
      return { storageKey: asset.storageKey, filename: asset.filename as string | undefined }
    }
  }

  // Video Frame Extractor / direct: { storageKey, filename? }
  if (typeof obj.storageKey === 'string' && obj.storageKey) {
    return { storageKey: obj.storageKey, filename: obj.filename as string | undefined }
  }

  return null
}

export class ImageResizeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const ref = extractImageRef(input)
    if (!ref) {
      throw new Error('Image Resize: no image found — connect an Image Generation or Video Frame Extractor node')
    }

    const preset = (config.preset as string) ?? 'instagram-square'
    const fit = ((config.fit as string) ?? 'cover') as 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
    const format = (config.format as string) ?? 'same'
    const quality = Math.min(100, Math.max(1, (config.quality as number) ?? 85))

    // Resolve dimensions
    let width: number
    let height: number
    if (preset === 'custom') {
      width  = Math.max(1, (config.width  as number) ?? 800)
      height = Math.max(1, (config.height as number) ?? 600)
    } else {
      const p = RESIZE_PRESETS[preset]
      if (!p) throw new Error(`Image Resize: unknown preset "${preset}"`)
      width  = p.width
      height = p.height
    }

    // Load image buffer
    let buffer: Buffer
    if (isS3Mode()) {
      buffer = Buffer.from(await downloadBuffer(ref.storageKey))
    } else {
      buffer = readFileSync(join(UPLOAD_DIR, ref.storageKey))
    }

    // Determine output format
    const srcExt = (ref.filename ?? ref.storageKey).split('.').pop()?.toLowerCase() ?? 'jpg'
    const outFmt = format === 'same'
      ? (srcExt === 'png' ? 'png' : srcExt === 'webp' ? 'webp' : 'jpeg')
      : format

    // Resize with sharp
    let sharpPipeline = sharp(buffer).resize(width, height, { fit })
    if (outFmt === 'jpeg')      sharpPipeline = sharpPipeline.jpeg({ quality })
    else if (outFmt === 'png')  sharpPipeline = sharpPipeline.png({ compressionLevel: 9 })
    else if (outFmt === 'webp') sharpPipeline = sharpPipeline.webp({ quality })

    const resizedBuffer = await sharpPipeline.toBuffer()

    const ext = outFmt === 'jpeg' ? 'jpg' : outFmt
    const filename = `resized_${width}x${height}_${randomUUID()}.${ext}`
    const mimeType = outFmt === 'jpeg' ? 'image/jpeg' : outFmt === 'png' ? 'image/png' : 'image/webp'
    const storageKey = await saveGeneratedFile(resizedBuffer, filename, mimeType)

    console.log(`[image-resize] ${ref.storageKey} → ${width}×${height} ${outFmt} (${Math.round(resizedBuffer.length / 1024)}KB)`)

    return {
      output: {
        storageKey,
        localPath: `/files/generated/${filename}`,
        filename,
        width,
        height,
        format: outFmt,
      },
    }
  }
}
