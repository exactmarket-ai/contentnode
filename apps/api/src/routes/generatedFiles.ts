import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { downloadBuffer, isS3Mode, UPLOAD_DIR } from '@contentnode/storage'

const MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
}

/**
 * Public static file serving for generated assets.
 * No auth required — files are served by storage key only (opaque filenames).
 * Route: GET /files/generated/:filename
 */
export async function generatedFileRoutes(app: FastifyInstance) {
  app.get<{ Params: { filename: string } }>(
    '/generated/:filename',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { filename } = req.params

      // Prevent path traversal
      if (filename.includes('/') || filename.includes('..') || filename.startsWith('.')) {
        return reply.code(400).send({ error: 'Invalid filename' })
      }

      const storageKey = `generated/${filename}`
      const ext = extname(filename).toLowerCase()
      const contentType = MIME[ext] ?? 'application/octet-stream'

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin')

      if (!isS3Mode()) {
        // Local mode: stream directly from disk
        const filePath = resolve(join(UPLOAD_DIR, storageKey))
        // Ensure resolved path stays within UPLOAD_DIR (path traversal guard)
        if (!filePath.startsWith(resolve(UPLOAD_DIR))) {
          return reply.code(400).send({ error: 'Invalid path' })
        }
        if (!existsSync(filePath)) {
          return reply.code(404).send({ error: 'File not found' })
        }
        return reply.send(createReadStream(filePath))
      }

      // S3 mode: download buffer and send
      try {
        const buffer = await downloadBuffer(storageKey)
        return reply.send(buffer)
      } catch {
        return reply.code(404).send({ error: 'File not found' })
      }
    },
  )
}
