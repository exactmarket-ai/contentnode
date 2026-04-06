import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, auditService } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createClientBody = z.object({
  name: z.string().min(1).max(100),
  industry: z.string().optional(),
  timezone: z.string().optional(),
})

const updateClientBody = createClientBody.partial()

const createStakeholderBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.string().optional(),
  seniority: z.enum(['owner', 'senior', 'member', 'junior']).default('member'),
})

const updateStakeholderBody = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().optional(),
  seniority: z.enum(['owner', 'senior', 'member', 'junior']).optional(),
})

const TOKEN_TTL_MS = 60 * 24 * 30 * 60 * 1000 // 30 days

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function clientRoutes(app: FastifyInstance) {
  // ── GET / — list clients with summary stats ───────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth

    const clients = await prisma.client.findMany({
      where: { agencyId },
      include: {
        _count: { select: { stakeholders: true, workflows: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Aggregate feedback counts and last activity per client
    const clientIds = clients.map((c) => c.id)

    const feedbackCounts = await prisma.feedback.groupBy({
      by: ['agencyId'],
      where: {
        agencyId,
        workflowRun: { workflow: { clientId: { in: clientIds } } },
      },
      _count: { id: true },
    })

    // Get last run per client
    const lastRuns = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        workflow: { clientId: { in: clientIds } },
      },
      select: { createdAt: true, workflow: { select: { clientId: true } } },
      orderBy: { createdAt: 'desc' },
      distinct: ['workflowId'],
    })

    const lastRunByClient: Record<string, Date> = {}
    for (const run of lastRuns) {
      const cid = (run as unknown as { workflow: { clientId: string } }).workflow.clientId
      if (!lastRunByClient[cid] || run.createdAt > lastRunByClient[cid]) {
        lastRunByClient[cid] = run.createdAt
      }
    }

    // Per-client feedback count
    const perClientFeedback: Record<string, number> = {}
    for (const cid of clientIds) {
      const count = await prisma.feedback.count({
        where: {
          agencyId,
          workflowRun: { workflow: { clientId: cid } },
        },
      })
      perClientFeedback[cid] = count
    }

    const data = clients.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      industry: c.industry,
      createdAt: c.createdAt,
      stakeholderCount: c._count.stakeholders,
      workflowCount: c._count.workflows,
      feedbackCount: perClientFeedback[c.id] ?? 0,
      lastActivity: lastRunByClient[c.id] ?? null,
    }))

    return reply.send({ data, meta: { total: data.length } })
  })

  // ── POST / — create client ────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createClientBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { agencyId, userId } = req.auth
    const { name, industry } = parsed.data

    // Ensure unique slug within agency
    const baseSlug = slugify(name)
    let slug = baseSlug
    let i = 1
    while (await prisma.client.findFirst({ where: { agencyId, slug } })) {
      slug = `${baseSlug}-${i++}`
    }

    const client = await prisma.client.create({
      data: { agencyId, name, slug, industry: industry ?? null },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'client.created',
      resourceType: 'Client',
      resourceId: client.id,
      metadata: { name },
    })

    return reply.code(201).send({ data: client })
  })

  // ── GET /:id — client detail with relations ───────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        stakeholders: {
          include: { _count: { select: { feedbacks: true } } },
          orderBy: [{ seniority: 'asc' }, { createdAt: 'asc' }],
        },
        workflows: {
          select: {
            id: true,
            name: true,
            status: true,
            connectivityMode: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { runs: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        insights: {
          where: { status: { in: ['pending', 'applied'] } },
          select: {
            id: true, type: true, title: true, body: true,
            confidence: true, status: true, isCollective: true,
            instanceCount: true, createdAt: true,
          },
          orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
          take: 20,
        },
        _count: { select: { stakeholders: true, workflows: true } },
      },
    })

    if (!client) return reply.code(404).send({ error: 'Client not found' })
    return reply.send({ data: client })
  })

  // ── PATCH /:id — update client ────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = updateClientBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.industry !== undefined ? { industry: parsed.data.industry } : {}),
      },
    })

    return reply.send({ data: client })
  })

  // ── DELETE /:id — delete client ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    await prisma.client.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Stakeholder sub-routes  /clients/:id/stakeholders
  // ─────────────────────────────────────────────────────────────────────────

  // ── GET /:id/stakeholders ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/stakeholders', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { _count: { select: { feedbacks: true } } },
      orderBy: [{ seniority: 'asc' }, { createdAt: 'asc' }],
    })

    return reply.send({ data: stakeholders })
  })

  // ── POST /:id/stakeholders ────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/stakeholders', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const parsed = createStakeholderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { name, email, role, seniority } = parsed.data

    const existing = await prisma.stakeholder.findFirst({
      where: { clientId: req.params.id, email },
    })
    if (existing) {
      return reply.code(409).send({ error: 'A stakeholder with this email already exists for this client' })
    }

    const stakeholder = await prisma.stakeholder.create({
      data: {
        agencyId,
        clientId: req.params.id,
        name,
        email,
        role: role ?? null,
        seniority,
      },
    })

    return reply.code(201).send({ data: stakeholder })
  })

  // ── PATCH /:id/stakeholders/:sid ──────────────────────────────────────────
  app.patch<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = updateStakeholderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const updated = await prisma.stakeholder.update({
      where: { id: req.params.sid },
      data: parsed.data,
    })

    return reply.send({ data: updated })
  })

  // ── DELETE /:id/stakeholders/:sid ─────────────────────────────────────────
  app.delete<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    await prisma.stakeholder.delete({ where: { id: req.params.sid } })
    return reply.code(204).send()
  })

  // ── POST /:id/stakeholders/:sid/send-invite ───────────────────────────────
  app.post<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/send-invite', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

    await prisma.stakeholder.update({
      where: { id: req.params.sid },
      data: { magicLinkToken: token, magicLinkExpiresAt: expiresAt },
    })

    const portalUrl = `${process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'}/portal?token=${token}`

    return reply.send({
      data: {
        token,
        portalUrl,
        expiresAt,
        stakeholder: { id: stakeholder.id, name: stakeholder.name, email: stakeholder.email },
      },
    })
  })

  // ── GET /:id/stakeholders/:sid/feedback ───────────────────────────────────
  app.get<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/feedback', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const feedbacks = await prisma.feedback.findMany({
      where: { stakeholderId: req.params.sid, agencyId },
      include: {
        workflowRun: {
          select: {
            id: true, status: true, createdAt: true,
            workflow: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return reply.send({ data: feedbacks })
  })

  // ── GET /:id/stakeholders/:sid/insights ───────────────────────────────────
  app.get<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/insights', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const allInsights = await prisma.insight.findMany({
      where: { clientId: req.params.id, agencyId },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    })

    // Filter to insights that mention this stakeholder
    const insights = allInsights.filter((insight) => {
      const ids = insight.stakeholderIds as string[]
      return Array.isArray(ids) && ids.includes(req.params.sid)
    })

    return reply.send({ data: insights })
  })
}
