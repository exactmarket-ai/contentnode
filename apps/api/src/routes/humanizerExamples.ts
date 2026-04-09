import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Humanizer Examples Routes — /api/v1/humanizer-examples
//
// Training data dashboard for the cnHumanizer model.
// Exposes aggregated stats, paginated list, full detail, and approval updates.
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_LENGTH = 300

function truncate(text: string | null | undefined, len: number): string | null {
  if (text == null) return null
  return text.length > len ? text.slice(0, len) : text
}

export async function humanizerExampleRoutes(app: FastifyInstance) {
  // ── GET /stats — aggregate stats across all examples ─────────────────────
  app.get('/stats', async (req, reply) => {
    const { agencyId } = req.auth

    const examples = await prisma.humanizerExample.findMany({
      where: { agencyId },
      select: {
        approved: true,
        source: true,
        service: true,
        contentBefore: true,
        detectionScoreBefore: true,
        detectionScoreAfter: true,
      },
    })

    const total = examples.length
    const approved = examples.filter((e) => e.approved).length
    const readyForTraining = examples.filter((e) => e.approved && e.contentBefore !== null).length

    // bySource
    const bySource: Record<string, number> = {}
    for (const e of examples) {
      bySource[e.source] = (bySource[e.source] ?? 0) + 1
    }

    // byService
    const byService: Record<string, number> = {}
    for (const e of examples) {
      byService[e.service] = (byService[e.service] ?? 0) + 1
    }

    // avg scores
    const withBefore = examples.filter((e) => e.detectionScoreBefore !== null)
    const withAfter = examples.filter((e) => e.detectionScoreAfter !== null)
    const withBoth = examples.filter(
      (e) => e.detectionScoreBefore !== null && e.detectionScoreAfter !== null,
    )

    const avgScoreBefore =
      withBefore.length > 0
        ? withBefore.reduce((s, e) => s + (e.detectionScoreBefore as number), 0) /
          withBefore.length
        : null

    const avgScoreAfter =
      withAfter.length > 0
        ? withAfter.reduce((s, e) => s + (e.detectionScoreAfter as number), 0) /
          withAfter.length
        : null

    const avgImprovement =
      withBoth.length > 0
        ? withBoth.reduce(
            (s, e) =>
              s +
              ((e.detectionScoreBefore as number) - (e.detectionScoreAfter as number)),
            0,
          ) / withBoth.length
        : null

    return reply.send({
      data: {
        total,
        approved,
        readyForTraining,
        bySource,
        byService,
        avgScoreBefore,
        avgScoreAfter,
        avgImprovement,
      },
    })
  })

  // ── GET / — paginated list with optional filters ──────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const query = req.query as {
      source?: string
      service?: string
      approved?: string
      limit?: string
      offset?: string
      search?: string
    }

    const limit = Math.min(Number(query.limit ?? 50), 200)
    const offset = Number(query.offset ?? 0)

    // Build where clause
    const where: Record<string, unknown> = { agencyId }

    if (query.source) where['source'] = query.source
    if (query.service) where['service'] = query.service

    if (query.approved === 'true') {
      where['approved'] = true
    } else if (query.approved === 'false') {
      where['approved'] = false
    }
    // 'all' or omitted — no filter

    if (query.search) {
      where['contentAfter'] = { contains: query.search, mode: 'insensitive' }
    }

    const [rows, total] = await Promise.all([
      prisma.humanizerExample.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.humanizerExample.count({ where }),
    ])

    const data = rows.map((e) => ({
      ...e,
      contentBeforePreview: truncate(e.contentBefore, PREVIEW_LENGTH),
      contentAfterPreview: truncate(e.contentAfter, PREVIEW_LENGTH),
    }))

    return reply.send({ data, meta: { total } })
  })

  // ── GET /:id — full example (no truncation) ───────────────────────────────
  app.get('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const example = await prisma.humanizerExample.findFirst({
      where: { id, agencyId },
    })

    if (!example) {
      return reply.code(404).send({ error: 'Not found' })
    }

    return reply.send({ data: example })
  })

  // ── PATCH /:id — update approved field ───────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { approved?: boolean }

    if (typeof body.approved !== 'boolean') {
      return reply.code(400).send({ error: '`approved` must be a boolean' })
    }

    // Verify the record belongs to this agency before updating
    const existing = await prisma.humanizerExample.findFirst({
      where: { id, agencyId },
      select: { id: true },
    })

    if (!existing) {
      return reply.code(404).send({ error: 'Not found' })
    }

    const updated = await prisma.humanizerExample.update({
      where: { id },
      data: { approved: body.approved },
    })

    return reply.send({ data: updated })
  })

  // ── DELETE /:id — remove a training example ───────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.humanizerExample.findFirst({
      where: { id, agencyId },
      select: { id: true },
    })

    if (!existing) {
      return reply.code(404).send({ error: 'Not found' })
    }

    await prisma.humanizerExample.delete({ where: { id } })
    return reply.code(204).send()
  })
}
