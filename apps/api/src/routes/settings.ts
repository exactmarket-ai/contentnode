import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'
import { uploadStream, deleteObject } from '@contentnode/storage'
import { getAgencyBrainProcessQueue } from '../lib/queues.js'

export async function settingsRoutes(app: FastifyInstance) {
  // ── GET / — get agency settings (upserts defaults on first access) ─────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth

    const settings = await prisma.agencySettings.upsert({
      where: { agencyId },
      create: { agencyId },
      update: {},
    })

    return reply.send({ data: settings })
  })

  // ── PATCH / — update agency settings ────────────────────────────────────────
  app.patch('/', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = z.object({
      tempContactExpiryDays: z.number().int().positive().nullable().optional(),
      // doc style fields
      docPrimaryColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      docSecondaryColor:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      docHeadingFont:     z.string().max(100).optional(),
      docBodyFont:        z.string().max(100).optional(),
      docAgencyName:      z.string().max(200).nullable().optional(),
      docCoverPage:       z.boolean().optional(),
      docPageNumbers:     z.boolean().optional(),
      docFooterText:      z.string().max(500).nullable().optional(),
      docApplyToGtm:      z.boolean().optional(),
      docApplyToDemandGen: z.boolean().optional(),
      docApplyToBranding: z.boolean().optional(),
      verticalTerm: z.string().min(1).max(50).optional(),
    }).safeParse(req.body)

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { tempContactExpiryDays, ...docStyle } = parsed.data
    const updateData: Record<string, unknown> = {}
    if (tempContactExpiryDays !== undefined) updateData.tempContactExpiryDays = tempContactExpiryDays
    Object.entries(docStyle).forEach(([k, v]) => { if (v !== undefined) updateData[k] = v })

    const settings = await prisma.agencySettings.upsert({
      where: { agencyId },
      create: { agencyId, ...updateData },
      update: updateData,
    })

    return reply.send({ data: settings })
  })

  // ── POST /doc-logo — upload agency doc logo ──────────────────────────────────
  app.post('/doc-logo', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })
    const LOGO_MIME: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    }
    const ext = extname(data.filename).toLowerCase()
    if (!LOGO_MIME[ext]) return reply.code(400).send({ error: 'Only JPG, PNG, GIF, WEBP, SVG allowed' })
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (buffer.byteLength > 5 * 1024 * 1024) return reply.code(400).send({ error: 'Logo must be under 5 MB' })
    const base64 = `data:${LOGO_MIME[ext]};base64,${buffer.toString('base64')}`
    await prisma.agencySettings.upsert({
      where: { agencyId },
      create: { agencyId, docLogoStorageKey: base64 },
      update: { docLogoStorageKey: base64 },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── DELETE /doc-logo ──────────────────────────────────────────────────────────
  app.delete('/doc-logo', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.agencySettings.upsert({
      where: { agencyId },
      create: { agencyId },
      update: { docLogoStorageKey: null },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── Agency Brain ──────────────────────────────────────────────────────────────

  const ALLOWED_BRAIN_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md', '.csv', '.json', '.html', '.htm'])

  // GET synthesised context
  app.get('/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { brainContext: true } })
    return reply.send({ data: { context: agency?.brainContext ?? null } })
  })

  // PATCH synthesised context (manual override)
  app.patch<{ Body: { context: string } }>('/brain/context', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.agency.update({ where: { id: agencyId }, data: { brainContext: req.body.context } })
    return reply.send({ data: { ok: true } })
  })

  // GET attachment list
  app.get('/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const attachments = await prisma.agencyBrainAttachment.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true, uploadMethod: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // POST upload file
  app.post('/brain/attachments', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const fileExt = extname(filename).toLowerCase()
    if (!ALLOWED_BRAIN_EXTS.has(fileExt)) {
      return reply.code(400).send({ error: `File type ${fileExt} not supported. Allowed: ${[...ALLOWED_BRAIN_EXTS].join(', ')}` })
    }

    const storageKey = `agency-brain/${agencyId}/${crypto.randomUUID()}${fileExt}`
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const { Readable } = await import('node:stream')
    await uploadStream(storageKey, Readable.from(buffer), mimetype)

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })

    const attachment = await prisma.agencyBrainAttachment.create({
      data: {
        agencyId, filename, storageKey, mimeType: mimetype,
        sizeBytes: buffer.byteLength, uploadMethod: 'file',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getAgencyBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id })
    return reply.code(201).send({ data: attachment })
  })

  // POST from URL
  app.post<{ Body: { url: string } }>('/brain/attachments/from-url', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const urlParsed = z.object({ url: z.string().url().max(2048) }).safeParse(req.body)
    if (!urlParsed.success) return reply.code(400).send({ error: 'Valid url is required' })
    const { url } = urlParsed.data

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    let hostname = url
    try { hostname = new URL(url).hostname } catch {}

    const attachment = await prisma.agencyBrainAttachment.create({
      data: {
        agencyId, filename: hostname, sourceUrl: url, mimeType: 'text/html',
        sizeBytes: 0, uploadMethod: 'url',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getAgencyBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, url })
    return reply.code(201).send({ data: attachment })
  })

  // DELETE attachment
  app.delete<{ Params: { attachmentId: string } }>('/brain/attachments/:attachmentId', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const { attachmentId } = req.params
    const attachment = await prisma.agencyBrainAttachment.findFirst({ where: { id: attachmentId, agencyId } })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    await prisma.agencyBrainAttachment.delete({ where: { id: attachmentId } })
    if (attachment.storageKey) {
      try { await deleteObject(attachment.storageKey) } catch {}
    }
    return reply.send({ data: { ok: true } })
  })
}
