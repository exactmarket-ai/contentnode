import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { uploadStream, deleteObject } from '@contentnode/storage'

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.html',
])

const LIBRARY_CATEGORIES = [
  'brand-guidelines', 'instructions', 'standards', 'templates',
  'approved-examples', 'legal', 'other',
]

export async function clientLibraryRoutes(app: FastifyInstance) {
  // ── GET / — list client library files ────────────────────────────────────
  app.get<{ Params: { clientId: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const files = await prisma.clientFile.findMany({
      where: { clientId, agencyId },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    })
    return reply.send({ data: files })
  })

  // ── POST / — upload a file to client library ─────────────────────────────
  app.post<{ Params: { clientId: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file } = data
    const ext = extname(filename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      file.resume()
      return reply.code(400).send({
        error: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      })
    }

    const fileId = randomUUID()
    const storageKey = `clib-${fileId}${ext}`

    try {
      await uploadStream(storageKey, file)
    } catch (err) {
      app.log.error(err, 'Failed to store client library file')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0
    const fields = (data as unknown as { fields?: Record<string, { value: string }> }).fields ?? {}
    const label = (fields['label']?.value ?? '').trim() || null
    const category = LIBRARY_CATEGORIES.includes(fields['category']?.value ?? '')
      ? fields['category']!.value
      : 'other'

    const clientFile = await prisma.clientFile.create({
      data: { agencyId, clientId, originalName: filename, storageKey, label, category, sizeBytes },
    })

    return reply.code(201).send({ data: clientFile })
  })

  // ── PATCH /:id — update label / category ─────────────────────────────────
  app.patch<{ Params: { clientId: string; id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params
    const existing = await prisma.clientFile.findFirst({ where: { id, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'File not found' })

    const body = req.body as Record<string, unknown>
    const updated = await prisma.clientFile.update({
      where: { id },
      data: {
        ...(typeof body.label === 'string' ? { label: body.label || null } : {}),
        ...(typeof body.category === 'string' && LIBRARY_CATEGORIES.includes(body.category)
          ? { category: body.category }
          : {}),
      },
    })
    return reply.send({ data: updated })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  app.delete<{ Params: { clientId: string; id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params
    const existing = await prisma.clientFile.findFirst({ where: { id, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'File not found' })

    await deleteObject(existing.storageKey).catch(() => {})
    await prisma.clientFile.delete({ where: { id } })
    return reply.send({ data: { ok: true } })
  })
}
