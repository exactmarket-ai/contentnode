import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { getHumanizerSynthesisQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// cnHumanizer Intelligence Routes — /api/v1/cn-humanizer-intelligence
//
// Exposes the HumanizerProfile and HumanizerSignal data collected from
// content library approval edits.
// ─────────────────────────────────────────────────────────────────────────────

export async function cnHumanizerIntelligenceRoutes(app: FastifyInstance) {

  // ── GET /profiles — list all compiled profiles for this agency ────────────
  app.get('/profiles', async (req, reply) => {
    const { agencyId } = req.auth

    const profiles = await prisma.humanizerProfile.findMany({
      where: { agencyId },
      orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true, scope: true, scopeId: true,
        profile: true, signalCount: true,
        lastSynthesisAt: true, updatedAt: true,
      },
    })

    return reply.send({ data: profiles })
  })

  // ── GET /profiles/:scope — get a single profile (agency/client/content_type) ─
  app.get<{
    Params: { scope: string }
    Querystring: { scopeId?: string }
  }>('/profiles/:scope', async (req, reply) => {
    const { agencyId } = req.auth
    const { scope } = req.params
    const { scopeId } = req.query

    const profile = await prisma.humanizerProfile.findFirst({
      where: {
        agencyId,
        scope,
        scopeId: scopeId ?? null,
      },
    })

    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return reply.send({ data: profile })
  })

  // ── POST /profiles/:scope/synthesize — manually trigger synthesis ─────────
  app.post<{
    Params: { scope: string }
    Body: { scopeId?: string }
  }>('/profiles/:scope/synthesize', async (req, reply) => {
    const { agencyId } = req.auth
    const { scope } = req.params
    const scopeId = req.body?.scopeId ?? null

    if (!['agency', 'client', 'content_type'].includes(scope)) {
      return reply.code(400).send({ error: 'scope must be agency | client | content_type' })
    }

    const queue = getHumanizerSynthesisQueue()
    await queue.add(
      `manual-synth-${scope}-${scopeId ?? agencyId}`,
      { agencyId, scope: scope as 'agency' | 'client' | 'content_type', scopeId },
      {
        jobId:            `humanizer-synth-manual-${agencyId}-${scope}-${scopeId ?? 'agency'}`,
        removeOnComplete: { count: 5 },
        removeOnFail:     { count: 10 },
      },
    )

    return reply.send({ data: { ok: true, queued: true } })
  })

  // ── GET /signals — paginated edit signals ─────────────────────────────────
  app.get('/signals', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const clientId    = q.clientId    || null
    const contentType = q.contentType || null
    const page        = Math.max(1, parseInt(q.page ?? '1', 10) || 1)
    const limit       = Math.min(50, Math.max(1, parseInt(q.limit ?? '25', 10) || 25))
    const offset      = (page - 1) * limit

    const [signals, total] = await Promise.all([
      prisma.humanizerSignal.findMany({
        where: {
          agencyId,
          source: 'content_library_approval',
          ...(clientId    ? { clientId }    : {}),
          ...(contentType ? { contentType } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          clientId: true,
          contentType: true,
          assignmentType: true,
          diffSummary: true,
          originalText: true,
          editedText: true,
          createdAt: true,
        },
      }),
      prisma.humanizerSignal.count({
        where: {
          agencyId,
          source: 'content_library_approval',
          ...(clientId    ? { clientId }    : {}),
          ...(contentType ? { contentType } : {}),
        },
      }),
    ])

    // Enrich with client names
    const clientIds = [...new Set(signals.map((s) => s.clientId))]
    const clients = clientIds.length > 0
      ? await prisma.client.findMany({
          where: { id: { in: clientIds }, agencyId },
          select: { id: true, name: true },
        })
      : []
    const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]))

    return reply.send({
      data: signals.map((s) => ({
        id:             s.id,
        clientId:       s.clientId,
        clientName:     clientMap[s.clientId] ?? null,
        contentType:    s.contentType,
        assignmentType: s.assignmentType,
        editSummary:    s.diffSummary,
        originalExcerpt: s.originalText?.slice(0, 100) ?? null,
        approvedExcerpt: s.editedText?.slice(0, 100) ?? null,
        createdAt:      s.createdAt,
      })),
      pagination: {
        page, limit, total,
        pages: Math.ceil(total / limit),
      },
    })
  })

  // ── GET /content-types — content types that have accumulated signals ───────
  app.get('/content-types', async (req, reply) => {
    const { agencyId } = req.auth

    type Row = { content_type: string; signal_count: bigint; last_signal_at: Date | null }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT content_type, COUNT(*) AS signal_count, MAX(created_at) AS last_signal_at
      FROM humanizer_signals
      WHERE agency_id = ${agencyId}
        AND source = 'content_library_approval'
        AND content_type IS NOT NULL
      GROUP BY content_type
      ORDER BY signal_count DESC
    `

    // Load existing profiles for these content types
    const profiles = await prisma.humanizerProfile.findMany({
      where: { agencyId, scope: 'content_type' },
      select: { scopeId: true, signalCount: true, lastSynthesisAt: true },
    })
    const profileMap = Object.fromEntries(profiles.map((p) => [p.scopeId ?? '', p]))

    return reply.send({
      data: rows.map((r) => ({
        contentType:      r.content_type,
        signalCount:      Number(r.signal_count),
        lastSignalAt:     r.last_signal_at,
        hasProfile:       !!(profileMap[r.content_type]),
        profileSignalCount: profileMap[r.content_type]?.signalCount ?? 0,
        lastSynthesisAt:  profileMap[r.content_type]?.lastSynthesisAt ?? null,
      })),
    })
  })
}
