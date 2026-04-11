import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { uploadStream } from '@contentnode/storage'

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'html', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v'])

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

    try {
      await uploadStream(storageKey, file, `application/${ext}`)
    } catch (err) {
      app.log.error(err, 'Failed to store uploaded file')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

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
