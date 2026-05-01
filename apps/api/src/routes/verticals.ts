import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { uploadStream, deleteObject } from '@contentnode/storage'
import { getVerticalBrainProcessQueue } from '../lib/queues.js'

const createBody = z.object({ name: z.string().min(1).max(100), dimensionType: z.string().min(1).max(50).optional() })
const updateBody = z.object({ name: z.string().min(1).max(100).optional(), dimensionType: z.string().min(1).max(50).optional() })

const VERTICAL_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#6366f1']

function deriveColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return VERTICAL_COLORS[hash % VERTICAL_COLORS.length]
}

export async function verticalRoutes(app: FastifyInstance) {

  // ── GET /api/v1/verticals ─────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const verticals = await prisma.vertical.findMany({
      where: { agencyId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, dimensionType: true, color: true, createdAt: true },
    })
    // Lazy-assign colors for any vertical created before this migration
    const needsColor = verticals.filter((v) => !v.color)
    if (needsColor.length > 0) {
      await Promise.all(needsColor.map((v) =>
        prisma.vertical.update({ where: { id: v.id }, data: { color: deriveColor(v.id) } }).catch(() => {}),
      ))
      for (const v of needsColor) (v as typeof v & { color: string }).color = deriveColor(v.id)
    }
    return reply.send({ data: verticals })
  })

  // ── POST /api/v1/verticals ────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' })

    // Prevent duplicates within an agency
    const exists = await prisma.vertical.findFirst({
      where: { agencyId, name: { equals: parsed.data.name, mode: 'insensitive' } },
    })
    if (exists) return reply.code(409).send({ error: 'A vertical with that name already exists' })

    const vertical = await prisma.vertical.create({
      data: { agencyId, name: parsed.data.name, dimensionType: parsed.data.dimensionType ?? 'vertical' },
    })
    // Assign deterministic color based on ID (stable across reloads)
    const color = deriveColor(vertical.id)
    const verticalWithColor = await prisma.vertical.update({ where: { id: vertical.id }, data: { color } })
    return reply.code(201).send({ data: verticalWithColor })
  })

  // ── PATCH /api/v1/verticals/:id ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' })

    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const updated = await prisma.vertical.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.dimensionType ? { dimensionType: parsed.data.dimensionType } : {}),
      },
    })
    return reply.send({ data: updated })
  })

  // ── DELETE /api/v1/verticals/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.vertical.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Vertical Brain ────────────────────────────────────────────────────────────

  const ALLOWED_BRAIN_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md', '.csv', '.json', '.html', '.htm'])

  // GET synthesised context
  app.get<{ Params: { id: string } }>('/:id/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId }, select: { brainContext: true } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    return reply.send({ data: { context: vertical.brainContext ?? null } })
  })

  // PATCH synthesised context (manual override)
  app.patch<{ Params: { id: string }; Body: { context: string } }>('/:id/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    await prisma.vertical.update({ where: { id: req.params.id }, data: { brainContext: req.body.context } })
    return reply.send({ data: { ok: true } })
  })

  // GET attachment list
  app.get<{ Params: { id: string } }>('/:id/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const verticalId = req.params.id
    const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    const attachments = await prisma.verticalBrainAttachment.findMany({
      where: { agencyId, verticalId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true, uploadMethod: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // POST upload file
  app.post<{ Params: { id: string } }>('/:id/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const verticalId = req.params.id
    const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const fileExt = extname(filename).toLowerCase()
    if (!ALLOWED_BRAIN_EXTS.has(fileExt)) {
      return reply.code(400).send({ error: `File type ${fileExt} not supported. Allowed: ${[...ALLOWED_BRAIN_EXTS].join(', ')}` })
    }

    const storageKey = `vertical-brain/${agencyId}/${verticalId}/${crypto.randomUUID()}${fileExt}`
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const { Readable } = await import('node:stream')
    await uploadStream(storageKey, Readable.from(buffer), mimetype)

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })

    const attachment = await prisma.verticalBrainAttachment.create({
      data: {
        agencyId, verticalId, filename, storageKey, mimeType: mimetype,
        sizeBytes: buffer.byteLength, uploadMethod: 'file',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getVerticalBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, verticalId })
    return reply.code(201).send({ data: attachment })
  })

  // POST from URL
  app.post<{ Params: { id: string }; Body: { url: string } }>('/:id/brain/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const verticalId = req.params.id
    const urlParsed = z.object({ url: z.string().url().max(2048) }).safeParse(req.body)
    if (!urlParsed.success) return reply.code(400).send({ error: 'Valid url is required' })
    const { url } = urlParsed.data

    const vertical = await prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    let hostname = url
    try { hostname = new URL(url).hostname } catch {}

    const attachment = await prisma.verticalBrainAttachment.create({
      data: {
        agencyId, verticalId, filename: hostname, sourceUrl: url, mimeType: 'text/html',
        sizeBytes: 0, uploadMethod: 'url',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getVerticalBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, verticalId, url })
    return reply.code(201).send({ data: attachment })
  })

  // DELETE attachment
  app.delete<{ Params: { id: string; attachmentId: string } }>('/:id/brain/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: verticalId, attachmentId } = req.params
    const attachment = await prisma.verticalBrainAttachment.findFirst({ where: { id: attachmentId, agencyId, verticalId } })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    await prisma.verticalBrainAttachment.delete({ where: { id: attachmentId } })
    if (attachment.storageKey) {
      try { await deleteObject(attachment.storageKey) } catch {}
    }
    return reply.send({ data: { ok: true } })
  })
}
