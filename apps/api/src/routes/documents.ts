import type { FastifyInstance } from 'fastify'
import { pipeline } from 'node:stream/promises'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html'])

export async function documentRoutes(app: FastifyInstance) {
  // POST /api/v1/documents — accepts multipart file upload, stores locally
  app.post('/', async (req, reply) => {
    const data = await req.file()
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' })
    }

    const { filename, file } = data
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      // Drain stream to prevent memory leak
      file.resume()
      return reply.code(400).send({
        error: `Unsupported file type .${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      })
    }

    const docId = randomUUID()
    const storageKey = `${docId}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const filePath = join(UPLOAD_DIR, storageKey)

    try {
      await pipeline(file, createWriteStream(filePath))
    } catch (err) {
      app.log.error(err, 'Failed to write uploaded file')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    // bytesRead is set on the BusBoy file stream after the pipeline completes
    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    return reply.code(201).send({
      data: {
        id: docId,
        filename,
        storageKey,
        sizeBytes,
      },
    })
  })
}
