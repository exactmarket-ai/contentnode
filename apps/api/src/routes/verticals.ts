import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { uploadStream, deleteObject } from '@contentnode/storage'
import { getVerticalBrainProcessQueue } from '../lib/queues.js'

const createBody = z.object({ name: z.string().min(1).max(100), dimensionType: z.string().min(1).max(50).optional(), parentVerticalId: z.string().nullable().optional() })
const updateBody = z.object({
  name:                  z.string().min(1).max(100).optional(),
  dimensionType:         z.string().min(1).max(50).optional(),
  parentVerticalId:      z.string().nullable().optional(),
  // Voice / tone fields — stored via raw SQL (new columns added by migration)
  targetAudience:        z.string().max(500).optional(),
  toneDescriptors:       z.array(z.string()).optional(),
  keyMessages:           z.array(z.string()).optional(),
  voiceAvoidPhrases:     z.array(z.string()).optional(),
  // Integration fields
  defaultContentPackId:  z.string().nullable().optional(),
  mondayBoardId:         z.string().nullable().optional(),
  mondayColumnMapping:   z.record(z.unknown()).nullable().optional(),
  boxFolderId:           z.string().nullable().optional(),
})

const VERTICAL_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#6366f1']

function deriveColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return VERTICAL_COLORS[hash % VERTICAL_COLORS.length]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fetch extended voice/tone + integration fields for a vertical
// (stored in columns added by migration — gracefully degrade if not yet applied)
// ─────────────────────────────────────────────────────────────────────────────

type VerticalExtended = {
  targetAudience:       string | null
  toneDescriptors:      string[]
  keyMessages:          string[]
  voiceAvoidPhrases:    string[]
  defaultContentPackId: string | null
  mondayBoardId:        string | null
  mondayColumnMapping:  Record<string, unknown> | null
  boxFolderId:          string | null
}

async function getVerticalExtended(verticalId: string): Promise<VerticalExtended> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      target_audience:        string | null
      tone_descriptors:       unknown
      key_messages:           unknown
      voice_avoid_phrases:    unknown
      default_content_pack_id: string | null
      monday_board_id:        string | null
      monday_column_mapping:  unknown
      box_folder_id:          string | null
    }>>`
      SELECT target_audience, tone_descriptors, key_messages, voice_avoid_phrases,
             default_content_pack_id, monday_board_id, monday_column_mapping, box_folder_id
      FROM verticals WHERE id = ${verticalId}
    `
    const row = rows[0]
    if (!row) return emptyExtended()
    return {
      targetAudience:       row.target_audience,
      toneDescriptors:      Array.isArray(row.tone_descriptors) ? (row.tone_descriptors as string[]) : [],
      keyMessages:          Array.isArray(row.key_messages) ? (row.key_messages as string[]) : [],
      voiceAvoidPhrases:    Array.isArray(row.voice_avoid_phrases) ? (row.voice_avoid_phrases as string[]) : [],
      defaultContentPackId: row.default_content_pack_id,
      mondayBoardId:        row.monday_board_id,
      mondayColumnMapping:  row.monday_column_mapping && typeof row.monday_column_mapping === 'object'
        ? (row.monday_column_mapping as Record<string, unknown>)
        : null,
      boxFolderId:          row.box_folder_id,
    }
  } catch {
    return emptyExtended()
  }
}

function emptyExtended(): VerticalExtended {
  return {
    targetAudience:       null,
    toneDescriptors:      [],
    keyMessages:          [],
    voiceAvoidPhrases:    [],
    defaultContentPackId: null,
    mondayBoardId:        null,
    mondayColumnMapping:  null,
    boxFolderId:          null,
  }
}

export async function verticalRoutes(app: FastifyInstance) {

  // ── GET /api/v1/verticals ─────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const verticals = await prisma.vertical.findMany({
      where: { agencyId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, dimensionType: true, color: true, parentVerticalId: true, createdAt: true },
    })
    // Lazy-assign colors for any vertical created before this migration
    const needsColor = verticals.filter((v) => !v.color)
    if (needsColor.length > 0) {
      await Promise.all(needsColor.map((v) =>
        prisma.vertical.update({ where: { id: v.id }, data: { color: deriveColor(v.id) } }).catch(() => {}),
      ))
      for (const v of needsColor) (v as typeof v & { color: string }).color = deriveColor(v.id)
    }
    // Attach extended fields
    const withExtended = await Promise.all(verticals.map(async (v) => ({
      ...v,
      ...await getVerticalExtended(v.id),
    })))
    return reply.send({ data: withExtended })
  })

  // ── GET /api/v1/verticals/:id ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const vertical = await prisma.vertical.findFirst({
      where: { id: req.params.id, agencyId },
      select: { id: true, name: true, dimensionType: true, color: true, parentVerticalId: true, brainContext: true, createdAt: true, updatedAt: true },
    })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    const extended = await getVerticalExtended(vertical.id)
    return reply.send({ data: { ...vertical, ...extended } })
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
      data: {
        agencyId,
        name: parsed.data.name,
        dimensionType: parsed.data.dimensionType ?? 'vertical',
        ...(parsed.data.parentVerticalId ? { parentVerticalId: parsed.data.parentVerticalId } : {}),
      },
    })
    // Assign deterministic color based on ID (stable across reloads)
    const color = deriveColor(vertical.id)
    const verticalWithColor = await prisma.vertical.update({ where: { id: vertical.id }, data: { color } })
    return reply.code(201).send({ data: { ...verticalWithColor, ...emptyExtended() } })
  })

  // ── PATCH /api/v1/verticals/:id ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' })

    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    // Update core Prisma-managed fields
    const updated = await prisma.vertical.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.dimensionType ? { dimensionType: parsed.data.dimensionType } : {}),
        ...(parsed.data.parentVerticalId !== undefined ? { parentVerticalId: parsed.data.parentVerticalId } : {}),
      },
    })

    // Update extended fields via raw SQL (gracefully skip if columns don't exist yet)
    const {
      targetAudience, toneDescriptors, keyMessages, voiceAvoidPhrases,
      defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId,
    } = parsed.data

    const hasExtended = [
      targetAudience, toneDescriptors, keyMessages, voiceAvoidPhrases,
      defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId,
    ].some((v) => v !== undefined)

    if (hasExtended) {
      try {
        if (targetAudience !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET target_audience = ${targetAudience} WHERE id = ${req.params.id}`
        }
        if (toneDescriptors !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET tone_descriptors = ${JSON.stringify(toneDescriptors)}::jsonb WHERE id = ${req.params.id}`
        }
        if (keyMessages !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET key_messages = ${JSON.stringify(keyMessages)}::jsonb WHERE id = ${req.params.id}`
        }
        if (voiceAvoidPhrases !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET voice_avoid_phrases = ${JSON.stringify(voiceAvoidPhrases)}::jsonb WHERE id = ${req.params.id}`
        }
        if (defaultContentPackId !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET default_content_pack_id = ${defaultContentPackId} WHERE id = ${req.params.id}`
        }
        if (mondayBoardId !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET monday_board_id = ${mondayBoardId} WHERE id = ${req.params.id}`
        }
        if (mondayColumnMapping !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET monday_column_mapping = ${JSON.stringify(mondayColumnMapping)}::jsonb WHERE id = ${req.params.id}`
        }
        if (boxFolderId !== undefined) {
          await prisma.$executeRaw`UPDATE verticals SET box_folder_id = ${boxFolderId} WHERE id = ${req.params.id}`
        }
      } catch {
        // Columns not yet created — ignore, schema migration needed
      }
    }

    const extended = await getVerticalExtended(req.params.id)
    return reply.send({ data: { ...updated, ...extended } })
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
