import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { uploadBuffer } from '@contentnode/storage'

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.webm'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

/**
 * POST /api/v1/reference-files
 * Upload a reference image or video for use as a generation input.
 * Returns { localPath, storageKey, type, filename }.
 */
export async function referenceFileRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })

    const ext = extname(data.filename).toLowerCase()
    if (!ALLOWED.has(ext)) {
      return reply.code(400).send({ error: `Unsupported file type: ${ext}. Allowed: jpg, png, webp, gif, mp4, mov, webm` })
    }

    const filename = `ref-${randomUUID()}${ext}`
    const storageKey = `generated/${filename}`

    const chunks: Buffer[] = []
    let totalBytes = 0
    for await (const chunk of data.file) {
      const buf = Buffer.from(chunk)
      totalBytes += buf.byteLength
      if (totalBytes > 25 * 1024 * 1024) return reply.code(400).send({ error: 'File must be under 25 MB' })
      chunks.push(buf)
    }
    const buffer = Buffer.concat(chunks)

    await uploadBuffer(storageKey, buffer, data.mimetype || 'application/octet-stream')

    return reply.send({
      data: {
        localPath: `/files/generated/${filename}`,
        storageKey,
        type: IMAGE_EXTS.has(ext) ? 'image' : 'video',
        filename: data.filename,
      },
    })
  })
}
