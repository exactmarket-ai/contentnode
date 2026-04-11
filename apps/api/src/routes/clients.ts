import crypto from 'node:crypto'
import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, auditService } from '@contentnode/database'
import { uploadStream, downloadBuffer, deleteObject, isS3Mode } from '@contentnode/storage'

const LOGO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createClientBody = z.object({
  name: z.string().min(1).max(100),
  industry: z.string().optional(),
  timezone: z.string().optional(),
})

const updateClientBody = createClientBody.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
  industry: z.string().nullable().optional(),
  requireOffline: z.boolean().optional(),
})

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
  archived: z.boolean().optional(),
  clientId: z.string().optional(), // move to different client
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
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    })

    // Aggregate feedback counts and last activity per client
    const clientIds = clients.map((c) => c.id)

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
      logoUrl: c.logoStorageKey ? `/api/v1/clients/${c.id}/logo` : null,
      status: c.status,
      archivedAt: c.archivedAt,
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
    return reply.send({
      data: {
        ...client,
        logoUrl: client.logoStorageKey ? `/api/v1/clients/${client.id}/logo` : null,
      },
    })
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

    // requireOffline is an admin-only policy setting
    if (parsed.data.requireOffline !== undefined && !['owner', 'admin'].includes(req.auth.role ?? '')) {
      return reply.code(403).send({ error: 'Only admins can change the AI policy for a client.' })
    }

    const isArchiving = parsed.data.status === 'archived'
    const isUnarchiving = parsed.data.status === 'active'
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.industry !== undefined ? { industry: parsed.data.industry } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(isArchiving ? { archivedAt: new Date() } : {}),
        ...(isUnarchiving ? { archivedAt: null } : {}),
        ...(parsed.data.requireOffline !== undefined ? { requireOffline: parsed.data.requireOffline } : {}),
      },
    })

    return reply.send({ data: client })
  })

  // ── POST /:id/logo — upload client logo ──────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/logo', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const ext = extname(filename).toLowerCase()
    if (!LOGO_MIME[ext]) {
      file.resume()
      return reply.code(400).send({ error: `Unsupported logo format. Use: ${Object.keys(LOGO_MIME).join(', ')}` })
    }

    const storageKey = `logos/logo-${req.params.id}-${crypto.randomUUID()}${ext}`

    try {
      await uploadStream(storageKey, file, LOGO_MIME[ext] ?? 'application/octet-stream')
    } catch (err) {
      app.log.error(err, 'Failed to write logo file')
      return reply.code(500).send({ error: 'Failed to store logo' })
    }

    // Delete old logo file if there was one
    if (existing.logoStorageKey) {
      try { await deleteObject(existing.logoStorageKey) } catch {}
    }

    await prisma.client.update({
      where: { id: req.params.id },
      data: { logoStorageKey: storageKey },
    })

    return reply.send({ data: { logoUrl: `/api/v1/clients/${req.params.id}/logo` } })
  })

  // ── GET /:id/logo — serve client logo (no auth required) ─────────────────
  app.get<{ Params: { id: string } }>('/:id/logo', async (req, reply) => {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id },
      select: { logoStorageKey: true },
    })
    if (!client?.logoStorageKey) return reply.code(404).send({ error: 'No logo' })

    const ext = extname(client.logoStorageKey).toLowerCase()
    const contentType = LOGO_MIME[ext] ?? 'application/octet-stream'
    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=86400')

    try {
      const buffer = await downloadBuffer(client.logoStorageKey)
      return reply.send(buffer)
    } catch {
      return reply.code(404).send({ error: 'Logo file not found' })
    }
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

    const now = new Date()
    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { _count: { select: { feedbacks: true } } },
      orderBy: [{ seniority: 'asc' }, { createdAt: 'asc' }],
    })

    // Auto-archive expired temp contacts (lazy cleanup on list) + revoke all portal access
    const expired = stakeholders.filter(
      (s) => s.source === 'deliverable_share' && s.expiresAt && s.expiresAt < now && !s.archivedAt,
    )
    if (expired.length > 0) {
      const expiredIds = expired.map((s) => s.id)
      await prisma.stakeholder.updateMany({
        where: { id: { in: expiredIds } },
        data: { archivedAt: now, magicLinkToken: null, magicLinkExpiresAt: null },
      })
      // Revoke all active DeliverableAccess grants for expired contacts
      prisma.deliverableAccess.updateMany({
        where: { stakeholderId: { in: expiredIds }, agencyId, revokedAt: null },
        data: { revokedAt: now },
      }).catch(() => {})
      for (const s of expired) s.archivedAt = now
    }

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

    // Validate target client belongs to same agency when moving
    if (parsed.data.clientId) {
      const targetClient = await prisma.client.findFirst({ where: { id: parsed.data.clientId, agencyId } })
      if (!targetClient) return reply.code(400).send({ error: 'Target client not found' })

      // Check for email collision at target client
      const collision = await prisma.stakeholder.findFirst({
        where: { clientId: parsed.data.clientId, email: stakeholder.email },
      })
      if (collision) {
        return reply.code(409).send({
          error: `${targetClient.name} already has a contact with email ${stakeholder.email}. Use "Copy" to add a second profile, or remove the existing contact there first.`,
        })
      }
    }

    const { archived, clientId: targetClientId, name, role, seniority } = parsed.data

    // Build update payload explicitly to avoid Prisma type inference issues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (role !== undefined) updateData.role = role
    if (seniority !== undefined) updateData.seniority = seniority
    const isArchiving = archived === true && !stakeholder.archivedAt
    if (archived === true) updateData.archivedAt = new Date()
    if (archived === false) updateData.archivedAt = null
    if (targetClientId !== undefined) updateData.clientId = targetClientId

    // Revoke portal access when archiving — null out magic link + revoke all DeliverableAccess
    if (isArchiving) {
      updateData.magicLinkToken = null
      updateData.magicLinkExpiresAt = null
    }

    let updated
    try {
      updated = await prisma.stakeholder.update({
        where: { id: req.params.sid },
        data: updateData,
      })
    } catch (err: unknown) {
      req.log.error({ err }, 'stakeholder update failed')
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: msg })
    }

    // Revoke all active DeliverableAccess grants for this stakeholder (fire-and-forget)
    if (isArchiving) {
      prisma.deliverableAccess.updateMany({
        where: { stakeholderId: req.params.sid, agencyId, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {})
    }

    return reply.send({ data: updated })
  })

  // ── DELETE /:id/stakeholders/:sid ─────────────────────────────────────────
  app.delete<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    // Null out stakeholderId on related records before deleting (no cascade defined)
    try {
      await prisma.feedback.updateMany({ where: { stakeholderId: req.params.sid }, data: { stakeholderId: null } })
      await prisma.stakeholder.deleteMany({ where: { id: req.params.sid } })
    } catch (err) {
      req.log.error(err, 'Failed to delete stakeholder')
      return reply.code(500).send({ error: 'Failed to delete contact' })
    }
    return reply.code(204).send()
  })

  // ── POST /:id/stakeholders/:sid/copy-to — copy stakeholder to another client
  app.post<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/copy-to', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = z.object({ targetClientId: z.string() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'targetClientId required' })

    const source = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!source) return reply.code(404).send({ error: 'Stakeholder not found' })

    const targetClient = await prisma.client.findFirst({ where: { id: parsed.data.targetClientId, agencyId } })
    if (!targetClient) return reply.code(400).send({ error: 'Target client not found' })

    // Check for email collision at target client
    const collision = await prisma.stakeholder.findFirst({
      where: { clientId: parsed.data.targetClientId, email: source.email },
    })
    if (collision) return reply.code(409).send({ error: `A contact with email ${source.email} already exists at ${targetClient.name}` })

    const copy = await prisma.stakeholder.create({
      data: {
        agencyId,
        clientId: parsed.data.targetClientId,
        name: source.name,
        email: source.email,
        role: source.role,
        seniority: source.seniority,
      },
    })

    return reply.code(201).send({ data: copy })
  })

  // ── POST /:id/stakeholders/:sid/send-invite ───────────────────────────────
  app.post<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/send-invite', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const token = crypto.randomBytes(32).toString('hex')
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

  // ── GET /:id/usage — token + activity breakdown for this client ──────────
  app.get<{ Params: { id: string } }>('/:id/usage', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // All workflow runs for this client
    const runs = await prisma.workflowRun.findMany({
      where: { agencyId, workflow: { clientId } },
      select: { id: true, output: true },
    })
    const runIds = runs.map((r) => r.id)

    // AI token records
    const tokenRecords = runIds.length
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: 'ai_tokens' },
          select: { quantity: true, metadata: true },
        })
      : []

    // Filter to records belonging to this client's runs
    const runIdSet = new Set(runIds)
    const clientTokenRecords = tokenRecords.filter((r) => {
      const runId = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      return runId && runIdSet.has(runId)
    })

    // Group by model
    const tokensByModel: Record<string, number> = {}
    for (const r of clientTokenRecords) {
      const model = ((r.metadata as Record<string, unknown>)['model'] as string) ?? 'unknown'
      tokensByModel[model] = (tokensByModel[model] ?? 0) + r.quantity
    }

    // Humanizer word records
    const humRecords = runIds.length
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: 'humanizer_words' },
          select: { quantity: true, metadata: true },
        })
      : []

    const clientHumRecords = humRecords.filter((r) => {
      const runId = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      return runId && runIdSet.has(runId)
    })

    const humWordsByService: Record<string, number> = {}
    for (const r of clientHumRecords) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      humWordsByService[service] = (humWordsByService[service] ?? 0) + r.quantity
    }

    // Transcription minutes
    const transcriptSessions = await prisma.transcriptSession.findMany({
      where: { agencyId, clientId, status: 'ready' },
      select: { durationSecs: true },
    })
    const transcriptionMinutes = Math.round(
      transcriptSessions.reduce((sum, s) => sum + (s.durationSecs ?? 0), 0) / 60
    )

    // Detection runs — runs that have detection node outputs
    let detectionRuns = 0
    for (const run of runs) {
      const nodeStatuses = (run.output as Record<string, unknown>)?.['nodeStatuses'] as Record<string, unknown> | undefined
      if (nodeStatuses && Object.keys(nodeStatuses).some((k) => k.includes('detection') || (nodeStatuses[k] as Record<string, unknown>)?.modelUsed === 'detection')) {
        detectionRuns++
      }
    }

    // Total runs
    const totalRuns = runIds.length
    const totalTokens = Object.values(tokensByModel).reduce((s, n) => s + n, 0)
    const totalHumWords = Object.values(humWordsByService).reduce((s, n) => s + n, 0)

    return reply.send({
      data: {
        totalRuns,
        totalTokens,
        tokensByModel: Object.entries(tokensByModel)
          .map(([model, tokens]) => ({ model, tokens }))
          .sort((a, b) => b.tokens - a.tokens),
        totalHumWords,
        humWordsByService: Object.entries(humWordsByService)
          .map(([service, words]) => ({ service, words }))
          .sort((a, b) => b.words - a.words),
        transcriptionMinutes,
        detectionRuns,
      },
    })
  })

  // ── GET /:id/stakeholder-stats ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/stakeholder-stats', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId, agencyId, archivedAt: null },
      select: { id: true, name: true, email: true, role: true, seniority: true },
    })

    const stats = await Promise.all(
      stakeholders.map(async (s) => {
        const feedbacks = await prisma.feedback.findMany({
          where: { stakeholderId: s.id, agencyId },
          select: { decision: true, starRating: true, toneFeedback: true, contentTags: true, specificChanges: true, createdAt: true },
        })

        // Decision breakdown
        const decisions: Record<string, number> = {}
        for (const f of feedbacks) {
          const k = f.decision ?? 'no_decision'
          decisions[k] = (decisions[k] ?? 0) + 1
        }

        // Tone preferences
        const tones: Record<string, number> = {}
        for (const f of feedbacks) {
          if (f.toneFeedback) tones[f.toneFeedback] = (tones[f.toneFeedback] ?? 0) + 1
        }

        // Content tags
        const tags: Record<string, number> = {}
        for (const f of feedbacks) {
          const arr = f.contentTags as string[]
          if (Array.isArray(arr)) {
            for (const t of arr) tags[t] = (tags[t] ?? 0) + 1
          }
        }

        // Corrections count
        const totalCorrections = feedbacks.reduce((sum, f) => {
          const arr = f.specificChanges as unknown[]
          return sum + (Array.isArray(arr) ? arr.length : 0)
        }, 0)

        // Avg star rating
        const rated = feedbacks.filter((f) => f.starRating != null)
        const avgRating = rated.length > 0
          ? Math.round((rated.reduce((sum, f) => sum + (f.starRating ?? 0), 0) / rated.length) * 10) / 10
          : null

        // Last active
        const lastFeedback = feedbacks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

        return {
          id: s.id,
          name: s.name,
          email: s.email,
          role: s.role,
          seniority: s.seniority,
          totalFeedback: feedbacks.length,
          totalCorrections,
          avgRating,
          decisions,
          tones,
          tags,
          lastActive: lastFeedback?.createdAt ?? null,
        }
      })
    )

    return reply.send({ data: stats.sort((a, b) => b.totalFeedback - a.totalFeedback) })
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

  // ── GET /:id/run-intelligence — enriched run history for Content Intelligence tab
  app.get<{ Params: { id: string } }>('/:id/run-intelligence', async (req, reply) => {
    const { agencyId } = req.auth
    const { limit = '50', offset = '0', search = '' } = req.query as Record<string, string>

    const runs = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        workflow: { clientId: req.params.id },
        status: { in: ['completed', 'failed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
      skip: parseInt(offset),
      include: {
        workflow: { select: { id: true, name: true } },
        feedbacks: {
          select: { id: true, decision: true, starRating: true, toneFeedback: true, comment: true, createdAt: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    }) as unknown as Array<{
      id: string; status: string; createdAt: Date; completedAt: Date | null; output: unknown;
      contentHash: string | null;
      workflow: { id: string; name: string } | null;
      feedbacks: Array<{ decision: string; starRating: number | null; comment: string | null }>;
    }>

    // Check which runs have writer examples
    const runIds = runs.map((r) => r.id)
    const writerExamples = runIds.length
      ? await prisma.humanizerExample.findMany({
          where: { agencyId, workflowRunId: { in: runIds }, source: 'writer' },
          select: { workflowRunId: true, id: true },
        })
      : []
    const writerExampleByRun = Object.fromEntries(writerExamples.map((e) => [e.workflowRunId, e.id]))

    // Load node configs for all workflows referenced in these runs
    const wfIds = [...new Set(runs.map((r) => r.workflow?.id).filter(Boolean) as string[])]
    const workflowNodes = wfIds.length
      ? await prisma.node.findMany({
          where: { workflowId: { in: wfIds }, agencyId },
          select: { id: true, workflowId: true, type: true, config: true },
        })
      : []
    const nodeConfigByRunWorkflow: Record<string, Record<string, { type: string; config: Record<string, unknown> }>> = {}
    for (const n of workflowNodes) {
      if (!nodeConfigByRunWorkflow[n.workflowId]) nodeConfigByRunWorkflow[n.workflowId] = {}
      nodeConfigByRunWorkflow[n.workflowId][n.id] = { type: n.type, config: (n.config ?? {}) as Record<string, unknown> }
    }

    const enriched = runs.map((run) => {
      const nodeStatuses = (run.output as Record<string, unknown>)?.nodeStatuses as Record<string, Record<string, unknown>> | undefined
      const nodeConfigs = run.workflow ? (nodeConfigByRunWorkflow[run.workflow.id] ?? {}) : {}

      const llms: { model: string; provider: string; tokens?: number }[] = []
      const humanizers: { service: string; wordsBefore?: number; wordsAfter?: number }[] = []
      const detections: { service: string; scoreBefore?: number; scoreAfter?: number }[] = []
      const translations: { provider: string; targetLanguage: string; chars?: number }[] = []
      let finalWordCount: number | null = null
      const sourceParts: string[] = []

      if (nodeStatuses) {
        for (const [nodeId, ns] of Object.entries(nodeStatuses)) {
          const out = ns.output as Record<string, unknown> | string | undefined
          const nodeDef = nodeConfigs[nodeId]
          const subtype = nodeDef?.config?.subtype as string | undefined
          const nodeType = nodeDef?.type

          // Source label — collect identifiers from ALL source nodes
          if (nodeType === 'source') {
            const cfg = nodeDef?.config as Record<string, unknown> | undefined
            if (subtype === 'file-upload' || subtype === 'document-source') {
              // Filenames are stored in nodeStatus.sourceFiles (set by source executor at runtime)
              const storedFiles = ns.sourceFiles as string[] | undefined
              if (storedFiles && storedFiles.length > 0) {
                sourceParts.push(...storedFiles)
              }
            } else if (subtype === 'url' || subtype === 'web-scrape') {
              const url = (cfg?.url as string) ?? (typeof out === 'string' ? out : '')
              if (url) sourceParts.push(url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] + (url.includes('/') ? '/…' : ''))
            } else if (subtype === 'text-input' || subtype === 'text') {
              const text = (cfg?.content as string) ?? (typeof out === 'string' ? out : '')
              if (text) sourceParts.push('"' + text.trim().slice(0, 40) + (text.length > 40 ? '…' : '') + '"')
            } else if (subtype === 'audio-transcription') {
              const audioFiles = (cfg?.audioFiles as string[] | undefined) ?? []
              if (audioFiles.length > 0) sourceParts.push(...audioFiles.map((f: string) => f.split('/').pop() ?? f))
              else sourceParts.push('Audio')
            }
          }

          // AI Generate — has modelUsed and tokensUsed in nodeStatus
          if (ns.modelUsed && ns.tokensUsed !== undefined) {
            const model = ns.modelUsed as string
            const provider = model.startsWith('claude') ? 'anthropic' : model.startsWith('gpt') || model.startsWith('o') ? 'openai' : 'unknown'
            llms.push({ model, provider, tokens: ns.tokensUsed as number })
          }

          // Humanizer — detect by subtype (wordsProcessed may be missing for loop passes pre-fix)
          if (subtype && (subtype === 'humanizer-pro' || subtype === 'humanizer') && ns.status === 'passed') {
            const service = (nodeDef?.config?.humanizer_service as string) ?? 'auto'
            const humanizedText = typeof out === 'string' ? out : ''
            humanizers.push({
              service,
              wordsBefore: ns.wordsProcessed as number | undefined,
              wordsAfter: humanizedText ? humanizedText.split(/\s+/).filter(Boolean).length : undefined,
            })
          }

          // Detection — output has overall_score
          if (out && typeof out === 'object' && (out as Record<string, unknown>).overall_score !== undefined) {
            const o = out as Record<string, unknown>
            detections.push({
              service: (nodeDef?.config?.service as string) ?? 'unknown',
              scoreAfter: o.overall_score as number,
            })
          }

          // Translation — output has targetLanguage + provider
          if (out && typeof out === 'object') {
            const o = out as Record<string, unknown>
            if (o.targetLanguage && o.provider && o.charCount !== undefined) {
              translations.push({
                provider: o.provider as string,
                targetLanguage: o.targetLanguage as string,
                chars: o.charCount as number,
              })
            }
          }

          // Final word count from output nodes
          if (nodeType === 'output' && out && typeof out === 'object') {
            const o = out as Record<string, unknown>
            if (typeof o.content === 'string') {
              const wc = o.content.split(/\s+/).filter(Boolean).length
              if (wc > (finalWordCount ?? 0)) finalWordCount = wc
            }
          }
        }
      }

      // Filter by search
      const wfName = run.workflow?.name ?? ''
      if (search && !wfName.toLowerCase().includes(search.toLowerCase())) return null

      return {
        id: run.id,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        contentHash: run.contentHash ?? null,
        sourceLabel: sourceParts.length > 0 ? sourceParts.join(' + ') : null,
        workflow: run.workflow,
        llms,
        humanizers,
        detections,
        translations,
        finalWordCount,
        feedback: run.feedbacks[0] ?? null,
        writerExampleId: writerExampleByRun[run.id] ?? null,
      }
    }).filter(Boolean)

    const total = await prisma.workflowRun.count({
      where: { agencyId, workflow: { clientId: req.params.id }, status: { in: ['completed', 'failed'] } },
    })

    return reply.send({ data: enriched, meta: { total } })
  })

  // ── GET /:id/profiles — list all brand profiles ──────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profiles = await prisma.clientProfile.findMany({
      where: { clientId, agencyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, label: true, status: true, crawledFrom: true, updatedAt: true, createdAt: true },
    })
    return reply.send({ data: profiles })
  })

  // ── POST /:id/profiles — create new brand profile ────────────────────────────
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/:id/profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientProfile.create({
      data: { agencyId, clientId, label: req.body?.label ?? null },
    })
    return reply.code(201).send({ data: profile })
  })

  // ── GET /:id/profiles/:profileId ─────────────────────────────────────────────
  app.get<{ Params: { id: string; profileId: string } }>('/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const profile = await prisma.clientProfile.findFirst({
      where: { id: req.params.profileId, clientId: req.params.id, agencyId },
    })
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return reply.send({ data: profile })
  })

  // ── GET /:id/profile — compat: get first active profile ──────────────────────
  app.get<{ Params: { id: string } }>('/:id/profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientProfile.findFirst({
      where: { clientId, agencyId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    }) ?? await prisma.clientProfile.create({ data: { agencyId, clientId } })
    return reply.send({ data: profile })
  })

  // ── PUT /:id/profile — upsert client profile ─────────────────────────────────
  const profileBody = z.object({
    brandTone:                   z.string().optional(),
    formality:                   z.enum(['formal', 'semi-formal', 'casual']).optional(),
    pov:                         z.enum(['first_person', 'second_person', 'third_person']).optional(),
    signaturePhrases:            z.array(z.string()).optional(),
    avoidPhrases:                z.array(z.string()).optional(),
    primaryBuyer:                z.record(z.unknown()).optional(),
    secondaryBuyer:              z.record(z.unknown()).optional(),
    buyerMotivations:            z.array(z.string()).optional(),
    buyerFears:                  z.array(z.string()).optional(),
    visualStyle:                 z.string().optional(),
    colorTemperature:            z.enum(['warm', 'cool', 'neutral']).optional(),
    photographyVsIllustration:   z.enum(['photography', 'illustration', 'mixed']).optional(),
    approvedVisualThemes:        z.array(z.string()).optional(),
    avoidVisual:                 z.array(z.string()).optional(),
    currentPositioning:          z.string().optional(),
    campaignThemesApproved:      z.array(z.string()).optional(),
    manualOverrides:             z.array(z.record(z.unknown())).optional(),
    confidenceMap:               z.record(z.string()).optional(),
    crawledFrom:                 z.string().optional(),
  })

  // ── PUT /:id/profiles/:profileId — update specific brand profile ─────────────
  app.put<{ Params: { id: string; profileId: string }; Body: z.infer<typeof profileBody> & { label?: string } }>(
    '/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params

    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })

    const parsed = profileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const data = parsed.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSafe = (v: unknown) => (v as any) ?? undefined

    const profileData = {
      label:                      (req.body as { label?: string }).label ?? existing.label,
      brandTone:                  data.brandTone,
      formality:                  data.formality,
      pov:                        data.pov,
      signaturePhrases:           jsonSafe(data.signaturePhrases),
      avoidPhrases:               jsonSafe(data.avoidPhrases),
      primaryBuyer:               jsonSafe(data.primaryBuyer),
      secondaryBuyer:             jsonSafe(data.secondaryBuyer),
      buyerMotivations:           jsonSafe(data.buyerMotivations),
      buyerFears:                 jsonSafe(data.buyerFears),
      visualStyle:                data.visualStyle,
      colorTemperature:           data.colorTemperature,
      photographyVsIllustration:  data.photographyVsIllustration,
      approvedVisualThemes:       jsonSafe(data.approvedVisualThemes),
      avoidVisual:                jsonSafe(data.avoidVisual),
      currentPositioning:         data.currentPositioning,
      campaignThemesApproved:     jsonSafe(data.campaignThemesApproved),
      manualOverrides:            jsonSafe(data.manualOverrides),
      confidenceMap:              jsonSafe(data.confidenceMap),
      crawledFrom:                data.crawledFrom,
    }

    const profile = await prisma.clientProfile.update({ where: { id: profileId }, data: profileData })
    return reply.send({ data: profile })
  })

  // ── PATCH /:id/profiles/:profileId — archive/unarchive brand profile ──────────
  app.patch<{ Params: { id: string; profileId: string }; Body: { status?: string; label?: string } }>(
    '/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })
    const profile = await prisma.clientProfile.update({
      where: { id: profileId },
      data: { status: req.body?.status ?? existing.status, label: req.body?.label ?? existing.label },
    })
    return reply.send({ data: profile })
  })

  // ── DELETE /:id/profiles/:profileId — delete brand profile ───────────────────
  app.delete<{ Params: { id: string; profileId: string } }>('/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })
    await prisma.clientProfile.delete({ where: { id: profileId } })
    return reply.code(204).send()
  })

  // ── PUT /:id/profile — compat: update first active brand profile ──────────────
  app.put<{ Params: { id: string }; Body: z.infer<typeof profileBody> }>('/:id/profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const parsed = profileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    const data = parsed.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSafe = (v: unknown) => (v as any) ?? undefined
    const profileData = {
      brandTone: data.brandTone, formality: data.formality, pov: data.pov,
      signaturePhrases: jsonSafe(data.signaturePhrases), avoidPhrases: jsonSafe(data.avoidPhrases),
      primaryBuyer: jsonSafe(data.primaryBuyer), secondaryBuyer: jsonSafe(data.secondaryBuyer),
      buyerMotivations: jsonSafe(data.buyerMotivations), buyerFears: jsonSafe(data.buyerFears),
      visualStyle: data.visualStyle, colorTemperature: data.colorTemperature,
      photographyVsIllustration: data.photographyVsIllustration,
      approvedVisualThemes: jsonSafe(data.approvedVisualThemes), avoidVisual: jsonSafe(data.avoidVisual),
      currentPositioning: data.currentPositioning, campaignThemesApproved: jsonSafe(data.campaignThemesApproved),
      manualOverrides: jsonSafe(data.manualOverrides), confidenceMap: jsonSafe(data.confidenceMap),
      crawledFrom: data.crawledFrom,
    }
    let profile = await prisma.clientProfile.findFirst({ where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    if (profile) {
      profile = await prisma.clientProfile.update({ where: { id: profile.id }, data: profileData })
    } else {
      profile = await prisma.clientProfile.create({ data: { agencyId, clientId, ...profileData } })
    }
    return reply.send({ data: profile })
  })

  // ── POST /:id/profiles/:profileId/autofill — autofill specific brand profile ──
  app.post<{ Params: { id: string; profileId: string }; Body: { url: string } }>('/:id/profiles/:profileId/autofill', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const profileId = req.params.profileId
    const { url } = req.body ?? {}

    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ error: 'url is required' })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' })

    // ── 1. Fetch website content ────────────────────────────────────────────
    let rawHtml = ''
    try {
      const siteRes = await fetch(url, {
        headers: { 'User-Agent': 'ContentNode-ProfileBot/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      rawHtml = await siteRes.text()
    } catch (err) {
      return reply.code(422).send({ error: `Could not fetch ${url} — check the URL and try again` })
    }

    // ── 2. Strip HTML to readable text ──────────────────────────────────────
    const textContent = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 12000)

    if (textContent.length < 100) {
      return reply.code(422).send({ error: 'Could not extract readable content from that URL' })
    }

    // ── 3. Ask Claude to extract all profile fields ─────────────────────────
    const prompt = `You are a brand strategist building a detailed client profile from a company's website content.

Client name: ${client.name}
Industry: ${client.industry ?? 'unknown'}
Website URL: ${url}

Website content (extracted text):
${textContent}

Analyze this content and extract a complete brand profile. Return ONLY valid JSON matching this exact shape — no markdown, no explanation:

{
  "brandTone": "concise description of the brand's voice and tone",
  "formality": "formal" | "semi-formal" | "casual",
  "pov": "first_person" | "second_person" | "third_person",
  "signaturePhrases": ["phrase1", "phrase2"],
  "avoidPhrases": ["phrase or pattern to avoid"],
  "primaryBuyer": {
    "title": "job title or persona name",
    "age_range": "e.g. 30-50",
    "pain_points": ["pain 1", "pain 2"],
    "goals": ["goal 1", "goal 2"]
  },
  "secondaryBuyer": {
    "title": "",
    "age_range": "",
    "pain_points": [],
    "goals": []
  },
  "buyerMotivations": ["motivation 1", "motivation 2"],
  "buyerFears": ["fear 1", "fear 2"],
  "visualStyle": "description of visual aesthetic",
  "colorTemperature": "warm" | "cool" | "neutral",
  "photographyVsIllustration": "photography" | "illustration" | "mixed",
  "approvedVisualThemes": ["theme 1", "theme 2"],
  "avoidVisual": ["visual element to avoid"],
  "currentPositioning": "1-2 sentence description of how they position themselves",
  "campaignThemesApproved": ["recurring theme 1", "recurring theme 2"],
  "confidenceMap": {
    "brandTone": "crawled",
    "formality": "crawled",
    "pov": "crawled",
    "signaturePhrases": "crawled",
    "avoidPhrases": "inferred",
    "primaryBuyer": "inferred",
    "secondaryBuyer": "inferred",
    "buyerMotivations": "inferred",
    "buyerFears": "inferred",
    "visualStyle": "crawled",
    "colorTemperature": "inferred",
    "photographyVsIllustration": "crawled",
    "currentPositioning": "crawled",
    "campaignThemesApproved": "crawled"
  }
}

Rules:
- Only use "crawled" confidence for things explicitly stated on the site
- Use "inferred" for things you derived from context
- signaturePhrases: actual phrases or taglines used repeatedly on the site (2-6 items)
- avoidPhrases: language inconsistent with their brand (2-4 items based on what's clearly absent)
- Be specific and actionable — vague answers like "professional" are unhelpful
- If you cannot determine something, use an empty string or empty array`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      return reply.code(502).send({ error: 'AI service unavailable' })
    }

    const aiBody = await aiRes.json() as { content: Array<{ text: string }> }
    const text = aiBody.content?.[0]?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return reply.code(422).send({ error: 'AI could not extract profile data — try a different URL' })

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(match[0])
    } catch {
      return reply.code(422).send({ error: 'AI returned malformed data — try again' })
    }

    // ── 4. Update the specific profile record with extracted data ────────────
    const existingProfile = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existingProfile) return reply.code(404).send({ error: 'Profile not found' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any

    const brandData = {
      brandTone:                 extracted.brandTone as string ?? null,
      formality:                 extracted.formality as string ?? null,
      pov:                       extracted.pov as string ?? null,
      signaturePhrases:          js(extracted.signaturePhrases ?? []),
      avoidPhrases:              js(extracted.avoidPhrases ?? []),
      primaryBuyer:              js(extracted.primaryBuyer ?? {}),
      secondaryBuyer:            js(extracted.secondaryBuyer ?? {}),
      buyerMotivations:          js(extracted.buyerMotivations ?? []),
      buyerFears:                js(extracted.buyerFears ?? []),
      visualStyle:               extracted.visualStyle as string ?? null,
      colorTemperature:          extracted.colorTemperature as string ?? null,
      photographyVsIllustration: extracted.photographyVsIllustration as string ?? null,
      approvedVisualThemes:      js(extracted.approvedVisualThemes ?? []),
      avoidVisual:               js(extracted.avoidVisual ?? []),
      currentPositioning:        extracted.currentPositioning as string ?? null,
      campaignThemesApproved:    js(extracted.campaignThemesApproved ?? []),
      confidenceMap:             js(extracted.confidenceMap ?? {}),
      crawledFrom:               url,
      lastCrawledAt:             new Date(),
      crawledSnapshot:           js(extracted),
      label:                     existingProfile.label ?? new URL(url).hostname,
    }
    const profile = await prisma.clientProfile.update({ where: { id: profileId }, data: brandData })

    return reply.send({ data: profile })
  })

  // ── GET /:id/company-profile ──────────────────────────────────────────────────
  // ── GET /:id/company-profiles — list all company profiles ────────────────────
  app.get<{ Params: { id: string } }>('/:id/company-profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profiles = await prisma.companyProfile.findMany({
      where: { clientId, agencyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, label: true, status: true, crawledFrom: true, about: true, industry: true, updatedAt: true, createdAt: true },
    })
    return reply.send({ data: profiles })
  })

  // ── POST /:id/company-profiles — create new company profile ──────────────────
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/:id/company-profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.companyProfile.create({
      data: { agencyId, clientId, label: req.body?.label ?? null },
    })
    return reply.code(201).send({ data: profile })
  })

  // ── GET /:id/company-profiles/:profileId — get specific company profile ───────
  app.get<{ Params: { id: string; profileId: string } }>('/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const profile = await prisma.companyProfile.findFirst({
      where: { id: req.params.profileId, clientId: req.params.id, agencyId },
    })
    if (!profile) return reply.code(404).send({ error: 'Company profile not found' })
    return reply.send({ data: profile })
  })

  // ── GET /:id/company-profile — compat: get/create first active company profile ─
  app.get<{ Params: { id: string } }>('/:id/company-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.companyProfile.findFirst({
      where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' },
    }) ?? await prisma.companyProfile.create({ data: { agencyId, clientId } })
    return reply.send({ data: profile })
  })

  // ── Schema for company profile body ──────────────────────────────────────────
  const companyProfileBody = z.object({
    label:               z.string().optional(),
    about:               z.string().optional(),
    founded:             z.string().optional(),
    headquarters:        z.string().optional(),
    industry:            z.string().optional(),
    globalReach:         z.string().optional(),
    companyCategory:     z.string().optional(),
    businessType:        z.string().optional(),
    employees:           z.string().optional(),
    coreValues:          z.array(z.string()).optional(),
    keyAchievements:     z.array(z.string()).optional(),
    leadershipMessage:   z.string().optional(),
    leadershipTeam:      z.array(z.record(z.unknown())).optional(),
    whatTheyDo:          z.string().optional(),
    keyOfferings:        z.array(z.string()).optional(),
    industriesServed:    z.array(z.string()).optional(),
    partners:            z.array(z.string()).optional(),
    milestones:          z.array(z.string()).optional(),
    visionForFuture:     z.string().optional(),
    website:             z.string().optional(),
    generalInquiries:    z.string().optional(),
    phone:               z.string().optional(),
    headquartersAddress: z.string().optional(),
    crawledFrom:         z.string().optional(),
  })

  // ── PUT /:id/company-profiles/:profileId — update specific company profile ────
  app.put<{ Params: { id: string; profileId: string }; Body: z.infer<typeof companyProfileBody> }>(
    '/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    const parsed = companyProfileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any
    const d = parsed.data
    const data = {
      label: d.label ?? existing.label,
      about: d.about, founded: d.founded, headquarters: d.headquarters,
      industry: d.industry, globalReach: d.globalReach, companyCategory: d.companyCategory,
      businessType: d.businessType, employees: d.employees,
      coreValues: js(d.coreValues), keyAchievements: js(d.keyAchievements),
      leadershipMessage: d.leadershipMessage, leadershipTeam: js(d.leadershipTeam),
      whatTheyDo: d.whatTheyDo, keyOfferings: js(d.keyOfferings),
      industriesServed: js(d.industriesServed), partners: js(d.partners),
      milestones: js(d.milestones), visionForFuture: d.visionForFuture,
      website: d.website, generalInquiries: d.generalInquiries,
      phone: d.phone, headquartersAddress: d.headquartersAddress,
      crawledFrom: d.crawledFrom,
    }
    const profile = await prisma.companyProfile.update({ where: { id: profileId }, data })
    return reply.send({ data: profile })
  })

  // ── PATCH /:id/company-profiles/:profileId — archive/label ───────────────────
  app.patch<{ Params: { id: string; profileId: string }; Body: { status?: string; label?: string } }>(
    '/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    const profile = await prisma.companyProfile.update({
      where: { id: profileId },
      data: { status: req.body?.status ?? existing.status, label: req.body?.label ?? existing.label },
    })
    return reply.send({ data: profile })
  })

  // ── DELETE /:id/company-profiles/:profileId ───────────────────────────────────
  app.delete<{ Params: { id: string; profileId: string } }>('/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    await prisma.companyProfile.delete({ where: { id: profileId } })
    return reply.code(204).send()
  })

  // ── PUT /:id/company-profile — compat: update first active company profile ────
  app.put<{ Params: { id: string }; Body: z.infer<typeof companyProfileBody> }>('/:id/company-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const parsed = companyProfileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any
    const d = parsed.data
    const data = {
      about: d.about, founded: d.founded, headquarters: d.headquarters,
      industry: d.industry, globalReach: d.globalReach, companyCategory: d.companyCategory,
      businessType: d.businessType, employees: d.employees,
      coreValues: js(d.coreValues), keyAchievements: js(d.keyAchievements),
      leadershipMessage: d.leadershipMessage, leadershipTeam: js(d.leadershipTeam),
      whatTheyDo: d.whatTheyDo, keyOfferings: js(d.keyOfferings),
      industriesServed: js(d.industriesServed), partners: js(d.partners),
      milestones: js(d.milestones), visionForFuture: d.visionForFuture,
      website: d.website, generalInquiries: d.generalInquiries,
      phone: d.phone, headquartersAddress: d.headquartersAddress,
      crawledFrom: d.crawledFrom,
    }
    let profile = await prisma.companyProfile.findFirst({ where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    if (profile) {
      profile = await prisma.companyProfile.update({ where: { id: profile.id }, data })
    } else {
      profile = await prisma.companyProfile.create({ data: { agencyId, clientId, ...data } })
    }
    return reply.send({ data: profile })
  })

  // ── POST /:id/company-profiles/:profileId/autofill — autofill company profile ─
  app.post<{ Params: { id: string; profileId: string }; Body: { url: string } }>('/:id/company-profiles/:profileId/autofill', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const profileId = req.params.profileId
    const { url } = req.body ?? {}
    if (!url || typeof url !== 'string') return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' })

    // ── Helper: fetch one URL and strip HTML to plain text ─────────────────
    const stripHtml = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        // Preserve heading text with markers so Claude understands page structure
        .replace(/<h[1-3][^>]*>/gi, '\n## ').replace(/<\/h[1-3]>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
        .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    const fetchPage = async (pageUrl: string): Promise<string> => {
      try {
        const res = await fetch(pageUrl, {
          headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' },
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return ''
        return stripHtml(await res.text())
      } catch {
        return ''
      }
    }

    // ── Crawl homepage + discover high-value sub-pages ──────────────────────
    const base = (() => { try { const u = new URL(url); return `${u.protocol}//${u.host}` } catch { return '' } })()

    const homepageHtml = await (async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' }, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return ''
        return await res.text()
      } catch { return '' }
    })()

    if (!homepageHtml) return reply.code(422).send({ error: `Could not fetch ${url} — check the URL and try again` })

    // Extract all internal links from the homepage
    const internalLinks = Array.from(homepageHtml.matchAll(/href=["']([^"']+)["']/gi))
      .map((m) => {
        const href = m[1]
        if (href.startsWith('http')) return href
        if (href.startsWith('/') && base) return `${base}${href}`
        return null
      })
      .filter((h): h is string => !!h && h.startsWith(base))
      .map((h) => h.split('#')[0].replace(/\/$/, '').toLowerCase())

    // Score links by how likely they contain useful backgrounder info
    const pageScore = (u: string) => {
      const p = u.replace(base, '').toLowerCase()
      if (/\/(partner|ecosystem|alliance|integration|reseller|technology-partner)/.test(p)) return 10
      if (/\/(about|about-us|company|who-we-are|our-story|mission|history|story|since|founded)/.test(p)) return 9
      if (/\/(team|leadership|management|executives|founders|people|our-team)/.test(p)) return 8
      if (/\/(customer|client|case-stud|success-stor|trusted-by|who-we-serve)/.test(p)) return 7
      if (/\/(product|solution|platform|service|offering|feature)/.test(p)) return 6
      if (/\/(press|news|milestone|award|achievement)/.test(p)) return 5
      if (/\/(contact|contact-us|office|location|reach-us|get-in-touch)/.test(p)) return 5
      return 0
    }

    // Pick top 4 sub-pages to crawl in addition to homepage
    const subPages = [...new Set(internalLinks)]
      .filter((u) => u !== url.replace(/\/$/, '').toLowerCase() && u !== base)
      .sort((a, b) => pageScore(b) - pageScore(a))
      .filter((u) => pageScore(u) > 0)
      .slice(0, 5)

    // Extract earliest copyright year from raw HTML as a founding-date hint
    const copyrightYears = Array.from(homepageHtml.matchAll(/©\s*(\d{4})\s*[-–]\s*(\d{4})|©\s*(\d{4})/g))
      .flatMap((m) => [m[1], m[2], m[3]].filter(Boolean).map(Number))
    const earliestCopyright = copyrightYears.length > 0 ? Math.min(...copyrightYears) : null

    // ── External intelligence sources (run in parallel with sub-page crawl) ──
    const subTexts = await Promise.all(subPages.map((u) => fetchPage(u).then((t) => ({ url: u, text: t.slice(0, 4000) }))))

    // Derive the actual company name from the page title or domain — NOT client.name,
    // which is the agency's client record name and may differ from the researched company
    const researchedCompanyName = (() => {
      const titleMatch = homepageHtml.match(/<title[^>]*>([^<]{2,80})<\/title>/i)
      if (titleMatch) {
        const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim()
        // Take the part before any separator (dash, pipe, colon, bullet)
        const name = title.split(/\s*[-–—|·•:]\s*/)[0].trim()
        if (name.length >= 2) return name
      }
      // Fall back to domain name (microsoft from microsoft.com)
      try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0] } catch { return client.name }
    })()

    const homepageText = stripHtml(homepageHtml).slice(0, 6000)

    // Assemble multi-page content with clear section labels
    let combinedContent = `=== Homepage (${url}) ===\n${homepageText}\n\n`
    for (const { url: subUrl, text } of subTexts) {
      if (text.length > 100) {
        const pageName = subUrl.replace(base, '') || '/'
        combinedContent += `=== Page: ${pageName} ===\n${text}\n\n`
      }
    }

    if (combinedContent.trim().length < 100) {
      return reply.code(422).send({ error: 'Could not extract readable content from that URL' })
    }

    const sourcesSummary = `company website (${subPages.length + 1} pages)`

    const prompt = `You are a senior business analyst building a thorough company backgrounder from multiple intelligence sources.

Company name: ${client.name}
Industry: ${client.industry ?? 'unknown'}
Main URL: ${url}
Sources: ${sourcesSummary}${earliestCopyright ? `\nEarliest copyright year found in page footer: ${earliestCopyright} (use as a founding year hint if no explicit date is found)` : ''}

---
RESEARCH CONTENT (multiple sources):
${combinedContent}
---

INSTRUCTIONS:
- Read ALL sources. The section labeled "=== Source: Wikipedia ===" is the most reliable for factual data like founding date, employee count, and HQ — prefer it over the company's own website for these facts.
- Use the MOST RELEVANT source/page for each field:
  • "about", "headquarters", "globalReach", "coreValues" → use Wikipedia first, then /about, /about-us, /company, /our-story pages
  • "founded" → use Wikipedia first, then look for "Founded in", "Since", "Established in", "In [year] we" on website pages, then fall back to earliest copyright year hint
  • "employees" → use Wikipedia infobox first, then website
  • "leadershipTeam", "leadershipMessage" → use content from pages labeled /team, /leadership, /management, /executives, or /founders — include every named person with title
  • "partners" → use content from pages labeled /partners, /ecosystem, /integrations, /alliances, or /marketplace. Also look for: "Powered by", "Built on", "Works with", "Certified by", partner logos, co-marketing mentions, "Platinum/Gold/Silver partner" tiers, AppExchange/marketplace listings. List each distinct partner or technology as a separate item.
  • "keyAchievements", "milestones" → use press/news/awards pages plus Wikipedia notable events
  • "whatTheyDo", "keyOfferings", "industriesServed" → use product/solution/services pages
  • "visionForFuture" → use about, company, or mission pages
  • "generalInquiries", "phone", "headquartersAddress" → use pages labeled /contact, /contact-us, or /about — look for email addresses, phone numbers, and mailing/office addresses
- Be thorough — extract more rather than less. Do NOT skip a field just because it wasn't on the homepage.

Return ONLY valid JSON with no markdown, no explanation:

{
  "about": "2-4 sentence company overview based on all pages",
  "founded": "year or date founded",
  "headquarters": "city, country",
  "industry": "primary industry",
  "globalReach": "description of geographic presence and market reach",
  "companyCategory": "e.g. Enterprise Software, SaaS, Professional Services",
  "businessType": "e.g. B2B, B2C, B2G, Mixed",
  "employees": "headcount or range",
  "coreValues": ["value 1", "value 2", "..."],
  "keyAchievements": ["achievement 1", "achievement 2", "..."],
  "leadershipMessage": "direct quote or summary of message from CEO/leadership if found",
  "leadershipTeam": [
    { "name": "Full Name", "title": "Job Title", "location": "City or empty string", "linkedin": "linkedin URL or empty string" }
  ],
  "whatTheyDo": "detailed paragraph describing their core business, model, and differentiation",
  "keyOfferings": ["product/service 1", "product/service 2", "..."],
  "industriesServed": ["industry 1", "industry 2", "..."],
  "partners": ["Partner Company A", "Partner Company B", "Technology X", "..."],
  "milestones": ["milestone 1", "milestone 2", "..."],
  "visionForFuture": "their stated vision, mission, or strategic direction",
  "website": "${url}",
  "generalInquiries": "email address for general contact if found",
  "phone": "main phone number if found",
  "headquartersAddress": "full street address if found"
}

Use empty string "" or empty array [] for any field not found. Never invent information.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) return reply.code(502).send({ error: 'AI service unavailable' })

    const aiBody = await aiRes.json() as { content: Array<{ text: string }> }
    const text = aiBody.content?.[0]?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return reply.code(422).send({ error: 'AI could not extract company data — try a different URL' })

    let extracted: Record<string, unknown>
    try { extracted = JSON.parse(match[0]) } catch { return reply.code(422).send({ error: 'AI returned malformed data' }) }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any

    const existingCompanyProfile = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existingCompanyProfile) return reply.code(404).send({ error: 'Company profile not found' })

    const snapshot = js(extracted)
    const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()

    // ── Enrich founded / headquarters / employees from external sources ────────
    // Priority: DDG/Wikipedia (always wins for known companies) → web search → Claude's website extraction

    const enrich: { founded?: string; headquarters?: string; employees?: string; phone?: string; generalInquiries?: string; headquartersAddress?: string } = {}

    // Step 1: DDG Instant Answer — Wikipedia-backed structured data, reliable for any company with a Wikipedia page
    try {
      type DDGItem = { label?: string; value?: unknown }
      type DDGResponse = { AbstractText?: string; Infobox?: { content?: DDGItem[] } }
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(researchedCompanyName)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' }, signal: AbortSignal.timeout(8000) }
      )
      if (ddgRes.ok) {
        const d = await ddgRes.json() as DDGResponse
        const facts: Record<string, string> = {}
        for (const item of (d.Infobox?.content ?? [])) {
          if (typeof item.label === 'string' && typeof item.value === 'string' && item.value.trim())
            facts[item.label.toLowerCase()] = item.value.trim()
        }
        if (facts['founded']) enrich.founded = facts['founded']

        // Parse "Key people" from DDG infobox and merge with Claude's website extraction
        const keyPeople = facts['key people'] ?? facts['founders'] ?? ''
        if (keyPeople) {
          const ddgMembers: Array<{ name: string; title: string; location: string; linkedin: string }> = []
          for (const entry of keyPeople.split(/,(?![^(]*\))/)) {
            const m = entry.trim().match(/^(.+?)\s*\(([^)]+)\)$/)
            if (m) ddgMembers.push({ name: m[1].trim(), title: m[2].trim(), location: '', linkedin: '' })
            else if (entry.trim()) ddgMembers.push({ name: entry.trim(), title: '', location: '', linkedin: '' })
          }
          if (ddgMembers.length > 0) {
            const claudeTeam = Array.isArray(extracted.leadershipTeam) ? extracted.leadershipTeam as Array<{ name?: string; title?: string; location?: string; linkedin?: string }> : []
            const existingNames = new Set(claudeTeam.map((m) => (m.name ?? '').toLowerCase()))
            for (const m of ddgMembers) {
              if (!existingNames.has(m.name.toLowerCase())) claudeTeam.push(m)
            }
            extracted.leadershipTeam = claudeTeam
          }
        }
        // Fuzzy match for employee count — label varies ("Number of employees", "Employees", etc.)
        const empKey = Object.keys(facts).find((k) => k.includes('employee'))
        if (empKey) enrich.employees = facts[empKey]
        // Also try extracting from AbstractText (e.g. "with 228,000 employees")
        if (!enrich.employees && d.AbstractText) {
          const empMatch = d.AbstractText.match(/(\d[\d,]+)\s+employees/i) ?? d.AbstractText.match(/workforce of\s+([\d,]+)/i)
          if (empMatch) enrich.employees = empMatch[1]
        }
        // Grab everything after "headquartered in" up to the period, strip trailing country
        const hqMatch = d.AbstractText?.match(/headquartered in ([^.]+)/i)
        if (hqMatch) {
          enrich.headquarters = hqMatch[1]
            .replace(/,?\s*(U\.?S\.?A?\.?|United States|United Kingdom|England)\.?$/i, '')
            .trim()
        }
      }
    } catch { /* DDG lookup failed — continue with other sources */ }

    // Step 2: Web search + Haiku — for companies not in Wikipedia, searches the open web
    const stillNeeded = (['founded', 'headquarters', 'employees', 'phone', 'generalInquiries', 'headquartersAddress'] as const).filter((f) => !enrich[f] && (!extracted[f] || extracted[f] === ''))
    if (stillNeeded.length > 0) {
      try {
        const needsContact = stillNeeded.some((f) => ['phone', 'generalInquiries', 'headquartersAddress'].includes(f))
        const q = needsContact
          ? `"${researchedCompanyName}" headquarters address street phone number`
          : stillNeeded.length === 1 && stillNeeded[0] === 'employees'
            ? `${researchedCompanyName} number of employees headcount workforce 2024 2025`
            : `${researchedCompanyName} company founded headquarters employees`
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: AbortSignal.timeout(12000),
        })
        if (res.ok) {
          const text = (await res.text())
            .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s{2,}/g, ' ').trim()
            .slice(0, 4000)
          if (text.length > 100) {
            const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 300,
                temperature: 0,
                messages: [{ role: 'user', content: `From this web search text about "${researchedCompanyName}", extract these fields (leave empty string if not found — do NOT guess):\n- "phone": main company phone number (not a support line 1-800 number if possible)\n- "generalInquiries": general contact email address (skip if only a contact form exists)\n- "headquartersAddress": full street address including street name, city, state, zip code\n- "founded": year or date founded\n- "headquarters": city and state/country\n- "employees": headcount or range\nOnly extract fields from this list: ${stillNeeded.join(', ')}.\nReturn ONLY JSON: {${stillNeeded.map((f) => `"${f}":"value or empty string"`).join(',')}}\n\n${text}` }],
              }),
            })
            if (extractRes.ok) {
              const body = await extractRes.json() as { content: Array<{ text: string }> }
              const m = (body.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/)
              if (m) {
                const p = JSON.parse(m[0]) as Record<string, string>
                if (!enrich.founded          && p.founded)          enrich.founded          = p.founded
                if (!enrich.headquarters     && p.headquarters)     enrich.headquarters     = p.headquarters
                if (!enrich.employees        && p.employees)        enrich.employees        = p.employees
                if (!enrich.phone            && p.phone)            enrich.phone            = p.phone
                if (!enrich.generalInquiries && p.generalInquiries) enrich.generalInquiries = p.generalInquiries
                if (!enrich.headquartersAddress && p.headquartersAddress) enrich.headquartersAddress = p.headquartersAddress
              }
            }
          }
        }
      } catch { /* continue */ }
    }

    // Apply: external sources win over Claude's website extraction
    if (enrich.founded)             extracted.founded             = enrich.founded
    if (enrich.headquarters)        extracted.headquarters        = enrich.headquarters
    if (enrich.employees)           extracted.employees           = enrich.employees
    if (enrich.phone)               extracted.phone               = enrich.phone
    if (enrich.generalInquiries)    extracted.generalInquiries    = enrich.generalInquiries
    if (enrich.headquartersAddress) extracted.headquartersAddress = enrich.headquartersAddress

    const companyData = {
      label:              existingCompanyProfile.label ?? hostname,
      about:              js(extracted.about), founded: js(extracted.founded),
      headquarters:       js(extracted.headquarters), industry: js(extracted.industry),
      globalReach:        js(extracted.globalReach), companyCategory: js(extracted.companyCategory),
      businessType:       js(extracted.businessType), employees: js(extracted.employees),
      coreValues:         js(extracted.coreValues ?? []), keyAchievements: js(extracted.keyAchievements ?? []),
      leadershipMessage:  js(extracted.leadershipMessage), leadershipTeam: js(extracted.leadershipTeam ?? []),
      whatTheyDo:         js(extracted.whatTheyDo), keyOfferings: js(extracted.keyOfferings ?? []),
      industriesServed:   js(extracted.industriesServed ?? []), partners: js(extracted.partners ?? []),
      milestones:         js(extracted.milestones ?? []), visionForFuture: js(extracted.visionForFuture),
      website:            js(extracted.website), generalInquiries: js(extracted.generalInquiries),
      phone:              js(extracted.phone), headquartersAddress: js(extracted.headquartersAddress),
      crawledFrom: url, lastCrawledAt: new Date(), crawledSnapshot: snapshot,
    }
    const profile = await prisma.companyProfile.update({ where: { id: profileId }, data: companyData })

    return reply.send({ data: profile })
  })

  // ── POST /:id/writer-examples — upload writer-polished version for a run
  app.post<{ Params: { id: string } }>('/:id/writer-examples', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowRunId, contentAfter } = req.body as { workflowRunId: string; contentAfter: string }

    if (!workflowRunId || !contentAfter?.trim()) {
      return reply.code(400).send({ error: 'workflowRunId and contentAfter are required' })
    }

    // Verify run belongs to this client + agency
    const run = await prisma.workflowRun.findFirst({
      where: { id: workflowRunId, agencyId, workflow: { clientId: req.params.id } },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Remove any existing writer example for this run
    await prisma.humanizerExample.deleteMany({
      where: { agencyId, workflowRunId, source: 'writer' },
    })

    const wordCount = contentAfter.trim().split(/\s+/).filter(Boolean).length
    const example = await prisma.humanizerExample.create({
      data: {
        agencyId,
        contentAfter: contentAfter.trim(),
        wordCountAfter: wordCount,
        service: 'writer',
        source: 'writer',
        workflowRunId,
        approved: true,
      },
    })

    return reply.code(201).send({ data: example })
  })
}
