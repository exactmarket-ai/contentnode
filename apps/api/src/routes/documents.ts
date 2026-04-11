import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline as streamPipeline } from 'node:stream'
import { promisify } from 'node:util'
import { uploadStream } from '@contentnode/storage'

const pipeline = promisify(streamPipeline)

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v'])

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4',
}

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html',
  'mp3', 'wav', 'm4a', 'ogg', 'flac',
  'mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v',
])

export async function documentRoutes(app: FastifyInstance) {
  // POST /api/v1/documents — accepts multipart file upload
  app.post('/', async (req, reply) => {
    const data = await req.file()
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' })
    }

    const { filename, file } = data
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      file.resume()
      return reply.code(400).send({
        error: `Unsupported file type .${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      })
    }

    const docId = randomUUID()
    const storageKey = `${docId}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    // ── Video files: stream to temp, normalize moov atom, then upload ─────────
    if (VIDEO_EXTENSIONS.has(ext)) {
      const tmpPath   = join(tmpdir(), `upload_${randomUUID()}.${ext}`)
      const fixedPath = join(tmpdir(), `upload_fixed_${randomUUID()}.${ext}`)
      let uploadPath  = tmpPath

      try {
        // Step 1: stream multipart body to temp file
        await pipeline(file, createWriteStream(tmpPath))
        const sizeBytes = statSync(tmpPath).size
        app.log.info({ storageKey, sizeBytes }, 'video upload: saved to tmp, normalizing...')

        // Step 2: fast remux to move moov atom to front (no re-encode, ~seconds)
        try {
          execSync(
            `ffmpeg -y -probesize 500M -analyzeduration 500M -i "${tmpPath}" -c copy -movflags +faststart "${fixedPath}"`,
            { stdio: 'pipe', timeout: 300_000 }, // 5 min max
          )
          uploadPath = fixedPath
          app.log.info({ storageKey }, 'video upload: moov normalization OK')
        } catch (ffmpegErr) {
          // If remux fails, upload the original — don't block the user
          app.log.warn({ storageKey, err: (ffmpegErr as Error).message }, 'video upload: faststart remux failed, uploading original')
        }

        // Step 3: upload (possibly fixed) file to storage
        const mimeType = VIDEO_MIME_TYPES[ext] ?? 'video/mp4'
        await uploadStream(storageKey, createReadStream(uploadPath), mimeType)
        const finalSize = statSync(uploadPath).size

        return reply.code(201).send({
          data: { id: docId, filename, storageKey, sizeBytes: finalSize },
        })
      } catch (err) {
        app.log.error(err, 'Failed to store uploaded video')
        return reply.code(500).send({ error: 'Failed to store file' })
      } finally {
        try { unlinkSync(tmpPath) } catch { /* ignore */ }
        try { if (existsSync(fixedPath)) unlinkSync(fixedPath) } catch { /* ignore */ }
      }
    }

    // ── Non-video: stream directly to storage ─────────────────────────────────
    try {
      await uploadStream(storageKey, file, `application/${ext}`)
    } catch (err) {
      app.log.error(err, 'Failed to store uploaded file')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    return reply.code(201).send({
      data: { id: docId, filename, storageKey, sizeBytes },
    })
  })
}
