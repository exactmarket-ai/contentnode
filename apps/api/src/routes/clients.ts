import crypto from 'node:crypto'
import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, auditService } from '@contentnode/database'
import { uploadStream, downloadBuffer, deleteObject, isS3Mode } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import { getFrameworkResearchQueue, getAttachmentProcessQueue, getBrandAttachmentProcessQueue, getClientBrainProcessQueue } from '../lib/queues.js'
import { markStaleIfBrainChanged } from './templateLibrary.js'
import { getClerkUserNames } from '../lib/clerk.js'

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
  // Logos are stored as base64 data URLs in the DB column so they survive
  // container restarts on Railway without needing S3/R2 configured.
  app.post<{ Params: { id: string } }>('/:id/logo', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } }) // 5 MB max
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file } = data
    const ext = extname(filename).toLowerCase()
    if (!LOGO_MIME[ext]) {
      file.resume()
      return reply.code(400).send({ error: `Unsupported logo format. Use: ${Object.keys(LOGO_MIME).join(', ')}` })
    }

    // Read into memory and encode as a data URL — persists in the DB across restarts
    const chunks: Buffer[] = []
    for await (const chunk of file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const fileBuffer = Buffer.concat(chunks)
    const contentType = LOGO_MIME[ext] ?? 'application/octet-stream'
    const dataUrl = `data:${contentType};base64,${fileBuffer.toString('base64')}`

    // Clean up old file-based logo if it was previously stored on disk/S3
    if (existing.logoStorageKey && !existing.logoStorageKey.startsWith('data:')) {
      try { await deleteObject(existing.logoStorageKey) } catch {}
    }

    await prisma.client.update({
      where: { id: req.params.id },
      data: { logoStorageKey: dataUrl },
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

    reply.header('Cache-Control', 'public, max-age=86400')
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin')

    // Data URL stored directly in DB (current approach — no S3 needed)
    if (client.logoStorageKey.startsWith('data:')) {
      const [header, base64] = client.logoStorageKey.split(',')
      const contentType = header.replace('data:', '').replace(';base64', '')
      return reply.header('Content-Type', contentType).send(Buffer.from(base64, 'base64'))
    }

    // Legacy: file stored on disk or S3
    const ext = extname(client.logoStorageKey).toLowerCase()
    const contentType = LOGO_MIME[ext] ?? 'application/octet-stream'
    reply.header('Content-Type', contentType)
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
    const runIdSet = new Set(runIds)

    // Fetch all usage records attributed to this client's workflow runs in one shot
    const runRecords = runIds.length
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: { in: ['ai_tokens', 'humanizer_words', 'image_generations', 'video_generations', 'translation_chars', 'detection_call', 'video_intelligence_call', 'assemblyai_seconds', 'voice_generation_chars', 'character_animation_secs', 'music_generation_secs', 'video_composition_secs'] } },
          select: { metric: true, quantity: true, metadata: true },
        })
      : []

    const clientRunRecords = runRecords.filter((r) => {
      const runId = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      return runId && runIdSet.has(runId)
    })

    // ── Reference rates for cost estimation ────────────────────────────────────
    // These are approximate public list prices. Actual costs depend on plan/volume.
    const RATES = {
      // Anthropic tokens: input / output per million tokens
      tokens: {
        'claude-opus-4-6':         { in: 15.00,  out: 75.00 },
        'claude-sonnet-4-6':       { in: 3.00,   out: 15.00 },
        'claude-sonnet-4-5':       { in: 3.00,   out: 15.00 },
        'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
        'claude-haiku-4-5':        { in: 0.80,   out: 4.00 },
        'gpt-4o':                  { in: 5.00,   out: 15.00 },
        'gpt-4o-mini':             { in: 0.15,   out: 0.60 },
      } as Record<string, { in: number; out: number }>,
      // Image gen: estimated USD per image
      imagePerImage: {
        dalle3: 0.04, openai: 0.04,
        falai: 0.03, fal: 0.03,
        stability: 0.025, stabilityai: 0.025,
        imagineart: 0.02,
        comfyui: 0, automatic1111: 0, local: 0,
      } as Record<string, number>,
      // Video gen: USD per second of generated video
      videoPerSec: {
        runway: 0.05, kling: 0.075, luma: 0.03, pika: 0.05, lumalabs: 0.03,
        stability: 0, veo2: 0, local: 0,
      } as Record<string, number>,
      // Humanizer: USD per 1000 words
      humPer1kWords: {
        undetectable: 0.50, bypassgpt: 0.30, stealthgpt: 0.40,
        claude: 0, cnhumanizer: 0, humanizeai: 0, local: 0,
      } as Record<string, number>,
      // Detection: USD per call
      detectionPerCall: {
        gptzero: 0.01, originality: 0.01, sapling: 0.01, copyleaks: 0.01,
        local: 0,
      } as Record<string, number>,
      // Translation: USD per 1000 chars
      translationPer1kChars: {
        deepl: 0.025, google: 0.020,
      } as Record<string, number>,
      // AssemblyAI: USD per minute
      assemblyaiPerMin: 0.0065,
    }

    const rate = <T extends Record<string, number>>(map: T, key: string) =>
      map[key.toLowerCase()] ?? map['default'] ?? 0

    // ── AI tokens by model ──────────────────────────────────────────────────────
    const tokensByModel: Record<string, number> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'ai_tokens')) {
      const model = ((r.metadata as Record<string, unknown>)['model'] as string) ?? 'unknown'
      tokensByModel[model] = (tokensByModel[model] ?? 0) + r.quantity
    }

    // ── Humanizer by service ────────────────────────────────────────────────────
    const humByService: Record<string, number> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'humanizer_words')) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      humByService[service] = (humByService[service] ?? 0) + r.quantity
    }

    // ── Image generation by provider ───────────────────────────────────────────
    const imageByProvider: Record<string, { count: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'image_generations')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? (meta['service'] as string) ?? 'unknown'
      const perImage = rate(RATES.imagePerImage, provider)
      imageByProvider[provider] = imageByProvider[provider] ?? { count: 0, costUsd: 0 }
      imageByProvider[provider].count   += r.quantity
      imageByProvider[provider].costUsd += r.quantity * perImage
    }

    // ── Video generation by provider ────────────────────────────────────────────
    const videoGenByProvider: Record<string, { count: number; secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'video_generations')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? (meta['service'] as string) ?? 'unknown'
      const secs = (meta['durationSecs'] as number) ?? 0
      const perSec = rate(RATES.videoPerSec, provider)
      videoGenByProvider[provider] = videoGenByProvider[provider] ?? { count: 0, secs: 0, costUsd: 0 }
      videoGenByProvider[provider].count   += r.quantity
      videoGenByProvider[provider].secs    += secs
      videoGenByProvider[provider].costUsd += secs * perSec
    }

    // ── Detection by service ────────────────────────────────────────────────────
    const detectionByService: Record<string, { calls: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'detection_call')) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      const perCall = rate(RATES.detectionPerCall, service)
      detectionByService[service] = detectionByService[service] ?? { calls: 0, costUsd: 0 }
      detectionByService[service].calls   += 1
      detectionByService[service].costUsd += perCall
    }

    // ── Translation by provider ─────────────────────────────────────────────────
    const translationByProvider: Record<string, { chars: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'translation_chars')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      const per1k = rate(RATES.translationPer1kChars, provider)
      translationByProvider[provider] = translationByProvider[provider] ?? { chars: 0, costUsd: 0 }
      translationByProvider[provider].chars   += r.quantity
      translationByProvider[provider].costUsd += (r.quantity / 1000) * per1k
    }

    // ── Video intelligence calls (Google Gemini) ────────────────────────────────
    const videoIntelligenceCalls = clientRunRecords.filter((r) => r.metric === 'video_intelligence_call').length

    // AssemblyAI from workflow runs (video transcription node)
    const workflowAssemblyaiSecs = clientRunRecords
      .filter((r) => r.metric === 'assemblyai_seconds')
      .reduce((s, r) => s + r.quantity, 0)

    // Transcription — real-time sessions (Transcription tab)
    const transcriptSessions = await prisma.transcriptSession.findMany({
      where: { agencyId, clientId, status: 'ready' },
      select: { durationSecs: true },
    })
    const transcriptionMinutes = Math.round(
      transcriptSessions.reduce((sum, s) => sum + (s.durationSecs ?? 0), 0) / 60
    )

    // AssemblyAI transcription from Brand / GTM file uploads
    // Query brand + framework attachments for this client, then match UsageRecords
    const [brandAttIds, fwAttIds] = await Promise.all([
      prisma.clientBrandAttachment.findMany({
        where: { agencyId, clientId },
        select: { id: true },
      }).then((rows) => rows.map((r) => r.id)),
      prisma.clientFrameworkAttachment.findMany({
        where: { agencyId, clientId },
        select: { id: true },
      }).then((rows) => rows.map((r) => r.id)),
    ])
    const allAttIds = new Set([...brandAttIds, ...fwAttIds])

    const fileAssemblyaiRecords = allAttIds.size
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: 'assemblyai_seconds' },
          select: { quantity: true, metadata: true },
        })
      : []
    const fileAssemblyaiSecs = fileAssemblyaiRecords
      .filter((r) => {
        const attId = (r.metadata as Record<string, unknown>)['attachmentId'] as string | undefined
        return attId && allAttIds.has(attId)
      })
      .reduce((s, r) => s + r.quantity, 0)
    const assemblyaiMinutes = Math.round((workflowAssemblyaiSecs + fileAssemblyaiSecs) / 60)
    const assemblyaiCostUsd = assemblyaiMinutes * RATES.assemblyaiPerMin

    // Brand / GTM files processed for this client
    const [brandFilesReady, fwFilesReady] = await Promise.all([
      prisma.clientBrandAttachment.count({ where: { agencyId, clientId, extractionStatus: 'ready' } }),
      prisma.clientFrameworkAttachment.count({ where: { agencyId, clientId, summaryStatus: 'ready' } }),
    ])

    const totalTokens = Object.values(tokensByModel).reduce((s, n) => s + n, 0)
    const totalHumWords = Object.values(humByService).reduce((s, n) => s + n, 0)

    // AI token cost estimates (assume ~50/50 input/output split)
    const totalTokensCostUsd = Object.entries(tokensByModel).reduce((sum, [model, tokens]) => {
      const r = RATES.tokens[model] ?? RATES.tokens['claude-sonnet-4-5'] ?? { in: 3.00, out: 15.00 }
      return sum + (tokens / 2 / 1_000_000) * r.in + (tokens / 2 / 1_000_000) * r.out
    }, 0)

    // Humanizer cost
    const humBySvcArray = Object.entries(humByService).map(([service, words]) => ({
      service, words,
      costUsd: (words / 1000) * rate(RATES.humPer1kWords, service),
    })).sort((a, b) => b.words - a.words)
    const totalHumCostUsd = humBySvcArray.reduce((s, v) => s + v.costUsd, 0)

    // Detection cost
    const detectionArray = Object.entries(detectionByService).map(([service, d]) => ({ service, ...d })).sort((a, b) => b.calls - a.calls)
    const totalDetectionCalls = detectionArray.reduce((s, v) => s + v.calls, 0)
    const totalDetectionCostUsd = detectionArray.reduce((s, v) => s + v.costUsd, 0)

    // Translation cost
    const translationArray = Object.entries(translationByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.chars - a.chars)
    const totalTranslationChars = translationArray.reduce((s, v) => s + v.chars, 0)
    const totalTranslationCostUsd = translationArray.reduce((s, v) => s + v.costUsd, 0)

    // Image generation totals
    const imageArray = Object.entries(imageByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.count - a.count)
    const totalImagesGenerated = imageArray.reduce((s, v) => s + v.count, 0)
    const totalImageCostUsd = imageArray.reduce((s, v) => s + v.costUsd, 0)

    // Video generation totals
    const videoGenArray = Object.entries(videoGenByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.count - a.count)
    const totalVideosGenerated = videoGenArray.reduce((s, v) => s + v.count, 0)
    const totalVideoGenSecs = videoGenArray.reduce((s, v) => s + v.secs, 0)
    const totalVideoGenCostUsd = videoGenArray.reduce((s, v) => s + v.costUsd, 0)

    // ── Media billing: voice / animation / music / composition ────────────────
    const voiceByProvider: Record<string, { chars: number; secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'voice_generation_chars')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      voiceByProvider[provider] = voiceByProvider[provider] ?? { chars: 0, secs: 0, costUsd: 0 }
      voiceByProvider[provider].chars   += r.quantity
      voiceByProvider[provider].secs    += (meta['durationSecs'] as number) ?? 0
      voiceByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const charAnimByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'character_animation_secs')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      charAnimByProvider[provider] = charAnimByProvider[provider] ?? { secs: 0, costUsd: 0 }
      charAnimByProvider[provider].secs    += r.quantity
      charAnimByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const musicByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'music_generation_secs')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      musicByProvider[provider] = musicByProvider[provider] ?? { secs: 0, costUsd: 0 }
      musicByProvider[provider].secs    += r.quantity
      musicByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const videoCompRecords = clientRunRecords.filter((r) => r.metric === 'video_composition_secs')
    const totalVideoCompSecs = videoCompRecords.reduce((s, r) => s + r.quantity, 0)
    const totalVideoCompCostUsd = videoCompRecords.reduce((s, r) => s + (((r.metadata as Record<string, unknown>)['estimatedCostUsd'] as number) ?? 0), 0)

    const totalVoiceChars   = Object.values(voiceByProvider).reduce((s, v) => s + v.chars, 0)
    const totalVoiceSecs    = Object.values(voiceByProvider).reduce((s, v) => s + v.secs, 0)
    const totalVoiceCostUsd = Object.values(voiceByProvider).reduce((s, v) => s + v.costUsd, 0)
    const totalCharAnimSecs    = Object.values(charAnimByProvider).reduce((s, v) => s + v.secs, 0)
    const totalCharAnimCostUsd = Object.values(charAnimByProvider).reduce((s, v) => s + v.costUsd, 0)
    const totalMusicSecs    = Object.values(musicByProvider).reduce((s, v) => s + v.secs, 0)
    const totalMusicCostUsd = Object.values(musicByProvider).reduce((s, v) => s + v.costUsd, 0)

    // Grand total estimated cost across ALL services
    const grandTotalCostUsd =
      totalTokensCostUsd + totalHumCostUsd + totalDetectionCostUsd +
      totalTranslationCostUsd + totalImageCostUsd + totalVideoGenCostUsd +
      totalVoiceCostUsd + totalCharAnimCostUsd + totalMusicCostUsd +
      totalVideoCompCostUsd + assemblyaiCostUsd

    return reply.send({
      data: {
        totalRuns: runIds.length,
        brandFilesReady,
        fwFilesReady,

        // ── AI text generation ─────────────────────────────────────────────
        totalTokens,
        totalTokensCostUsd,
        tokensByModel: Object.entries(tokensByModel).map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens),

        // ── Humanizer ─────────────────────────────────────────────────────
        totalHumWords,
        totalHumCostUsd,
        humWordsByService: humBySvcArray,

        // ── Image generation ───────────────────────────────────────────────
        totalImagesGenerated,
        totalImageCostUsd,
        imageGeneration: { byProvider: imageArray },

        // ── Video generation ───────────────────────────────────────────────
        totalVideosGenerated,
        totalVideoGenSecs,
        totalVideoGenCostUsd,
        videoGeneration: { byProvider: videoGenArray },

        // ── Voice TTS ──────────────────────────────────────────────────────
        voiceGeneration: {
          totalChars: totalVoiceChars,
          totalSecs: totalVoiceSecs,
          totalCostUsd: totalVoiceCostUsd,
          byProvider: Object.entries(voiceByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.chars - a.chars),
        },

        // ── Character animation ────────────────────────────────────────────
        characterAnimation: {
          totalSecs: totalCharAnimSecs,
          totalCostUsd: totalCharAnimCostUsd,
          byProvider: Object.entries(charAnimByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },

        // ── Music generation ───────────────────────────────────────────────
        musicGeneration: {
          totalSecs: totalMusicSecs,
          totalCostUsd: totalMusicCostUsd,
          byProvider: Object.entries(musicByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },

        // ── Video composition ──────────────────────────────────────────────
        videoComposition: { totalSecs: totalVideoCompSecs, totalCostUsd: totalVideoCompCostUsd },

        // ── AI detection ───────────────────────────────────────────────────
        detectionCalls: totalDetectionCalls,
        totalDetectionCostUsd,
        detectionByService: detectionArray,

        // ── Translation ────────────────────────────────────────────────────
        totalTranslationChars,
        totalTranslationCostUsd,
        translationByProvider: translationArray,

        // ── Transcription ──────────────────────────────────────────────────
        transcriptionMinutes,
        assemblyaiMinutes,
        assemblyaiCostUsd,

        // ── Video intelligence (Google Gemini) ─────────────────────────────
        videoIntelligenceCalls,

        // ── Grand total ────────────────────────────────────────────────────
        grandTotalCostUsd,
      },
    })
  })

  // ── Manual Usage Entries ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/manual-usage', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const entries = await prisma.manualUsageEntry.findMany({
      where: { agencyId, clientId },
      orderBy: { date: 'desc' },
    })
    return reply.send({ data: entries })
  })

  app.post<{ Params: { id: string }; Body: { date: string; service: string; description?: string; quantity: number; unit: string } }>(
    '/:id/manual-usage',
    async (req, reply) => {
      const { agencyId, userId } = req.auth
      const clientId = req.params.id
      const { date, service, description, quantity, unit } = req.body

      if (!date || !service || quantity == null || !unit) {
        return reply.code(400).send({ error: 'date, service, quantity, and unit are required' })
      }

      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      const entry = await prisma.manualUsageEntry.create({
        data: {
          agencyId,
          clientId,
          date: new Date(date),
          service: service.trim(),
          description: description?.trim() || null,
          quantity: Number(quantity),
          unit,
          createdBy: userId ?? null,
        },
      })
      return reply.code(201).send({ data: entry })
    }
  )

  app.delete<{ Params: { id: string; entryId: string } }>('/:id/manual-usage/:entryId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, entryId } = req.params

    const entry = await prisma.manualUsageEntry.findFirst({ where: { id: entryId, agencyId, clientId } })
    if (!entry) return reply.code(404).send({ error: 'Entry not found' })

    await prisma.manualUsageEntry.delete({ where: { id: entryId } })
    return reply.code(204).send()
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
        model: 'claude-sonnet-4-6',
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
    try {
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
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      const errBody = await aiRes.json().catch(() => ({}))
      req.log.error({ status: aiRes.status, errBody }, '[autofill] Anthropic API error')
      return reply.code(502).send({ error: `AI service error ${aiRes.status}`, detail: errBody })
    }

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
    } catch (err) {
      req.log.error({ err, profileId: req.params.profileId, clientId: req.params.id }, '[autofill] unhandled error')
      return reply.code(500).send({ error: (err instanceof Error ? err.message : String(err)) })
    }
  })

  // ── GET /:id/framework — return GTM framework data for a client
  // ── GET /:id/verticals — list verticals assigned to a client
  app.get<{ Params: { id: string } }>('/:id/verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const assignments = await prisma.clientVertical.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { vertical: { select: { id: true, name: true } } },
      orderBy: { vertical: { name: 'asc' } },
    })
    return reply.send({ data: assignments.map((a) => a.vertical) })
  })

  // ── POST /:id/verticals — assign a vertical to a client
  app.post<{ Params: { id: string } }>('/:id/verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const { verticalId } = req.body as { verticalId?: string }
    if (!verticalId) return reply.code(400).send({ error: 'verticalId is required' })

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.clientVertical.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId } },
      create: { agencyId, clientId: req.params.id, verticalId },
      update: {},
    })
    return reply.code(201).send({ data: vertical })
  })

  // ── DELETE /:id/verticals/:verticalId — unassign a vertical from a client
  app.delete<{ Params: { id: string; verticalId: string } }>('/:id/verticals/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    await prisma.clientVertical.deleteMany({
      where: { clientId: req.params.id, verticalId: req.params.verticalId, agencyId },
    })
    return reply.code(204).send()
  })

  // ── GET /:id/framework/:verticalId — return GTM framework for client+vertical
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const fw = await prisma.clientFramework.findUnique({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
    })
    return reply.send({ data: fw?.data ?? null })
  })

  // ── GET /:id/demand-gen/base — return company-wide demand gen data for a client
  app.get<{ Params: { id: string } }>('/:id/demand-gen/base', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const record = await prisma.clientDemandGenBase.findUnique({ where: { clientId: req.params.id } })
    return reply.send({ data: record?.data ?? null })
  })

  // ── PUT /:id/demand-gen/base — upsert company-wide demand gen data for a client
  app.put<{ Params: { id: string } }>('/:id/demand-gen/base', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })
    const record = await prisma.clientDemandGenBase.upsert({
      where: { clientId: req.params.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: record.data })
  })

  // ── GET /:id/demand-gen/:verticalId — return demand gen data for a client+vertical
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/demand-gen/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const record = await prisma.clientDemandGen.findUnique({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
    })
    return reply.send({ data: record?.data ?? null })
  })

  // ── PUT /:id/demand-gen/:verticalId — upsert demand gen data for a client+vertical
  app.put<{ Params: { id: string; verticalId: string } }>('/:id/demand-gen/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })

    const record = await prisma.clientDemandGen.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, verticalId: req.params.verticalId, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: record.data })
  })

  // ── PUT /:id/framework/:verticalId — upsert GTM framework for client+vertical
  app.put<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })

    const fw = await prisma.clientFramework.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, verticalId: req.params.verticalId, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: fw.data })
  })

  // ── GET /:id/framework/:verticalId/attachments — list framework attachments
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const attachments = await prisma.clientFrameworkAttachment.findMany({
      where: { clientId, verticalId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, summaryStatus: true, summary: true },
    })
    // Attach the Brand read for each file so the GTM room can show both lenses
    const storageKeys = attachments.map((a) => a.storageKey)
    const brandMirrors = storageKeys.length
      ? await prisma.clientBrandAttachment.findMany({
          where: { clientId, agencyId, storageKey: { in: storageKeys } },
          select: { id: true, storageKey: true, summary: true, summaryStatus: true },
        })
      : []
    const brandMap = new Map(brandMirrors.map((m) => [m.storageKey, m]))
    const data = attachments.map((a) => ({
      ...a,
      brandSummary: brandMap.get(a.storageKey)?.summary ?? null,
      brandSummaryStatus: brandMap.get(a.storageKey)?.summaryStatus ?? null,
      brandAttachmentId: brandMap.get(a.storageKey)?.id ?? null,
    }))
    return reply.send({ data })
  })

  // ── POST /:id/framework/:verticalId/attachments — upload framework attachment
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = `framework-attachments/${agencyId}/${clientId}/${verticalId}/${crypto.randomUUID()}-${safeName}`

    try {
      await uploadStream(storageKey, file, mimetype)
    } catch (err) {
      app.log.error(err, 'Failed to store framework attachment')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    const attachment = await prisma.clientFrameworkAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: mimetype, sizeBytes },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, summaryStatus: true, summary: true },
    })

    // Enqueue GTM framework processing (text extraction + Claude summarisation)
    await getAttachmentProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      clientName: client.name,
      verticalName: vertical.name,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    // Cross-post to Branding brain — same storageKey, no re-upload
    const brandVertical = await prisma.clientBrandVertical.findFirst({
      where: { clientId, agencyId, sourceVerticalId: verticalId },
    })
    if (brandVertical) {
      const brandAttachment = await prisma.clientBrandAttachment.create({
        data: { agencyId, clientId, verticalId: brandVertical.id, filename, storageKey, mimeType: mimetype, sizeBytes },
      })
      await getBrandAttachmentProcessQueue().add('process', {
        agencyId,
        attachmentId: brandAttachment.id,
        clientId,
        verticalId: brandVertical.id,
      }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
    }

    return reply.code(201).send({ data: attachment })
  })

  // ── PATCH /:id/framework/:verticalId/attachments/:attachmentId — update summary
  app.patch<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params
      const { summary } = (req.body ?? {}) as { summary?: string }

      const att = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
      })
      if (!att) return reply.code(404).send({ error: 'Attachment not found' })

      const updated = await prisma.clientFrameworkAttachment.update({
        where: { id: attachmentId },
        data: { summary: summary ?? null },
        select: { id: true, summary: true, summaryStatus: true },
      })
      return reply.send({ data: updated })
    },
  )

  // ── GET /:id/framework/:verticalId/attachments/:attachmentId/text — raw extracted text
  app.get<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId/text',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params

      const att = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
        select: { extractedText: true, filename: true },
      })
      if (!att) return reply.code(404).send({ error: 'Attachment not found' })

      return reply.send({ data: { text: att.extractedText ?? null, filename: att.filename } })
    },
  )

  // ── DELETE /:id/framework/:verticalId/attachments/:attachmentId — delete attachment
  app.delete<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params

      const attachment = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
      })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })

      // Delete mirrored brand attachment (same storageKey, shared brain)
      const mirrorBrand = await prisma.clientBrandAttachment.findFirst({
        where: { clientId, agencyId, storageKey: attachment.storageKey },
      })
      if (mirrorBrand) {
        await prisma.clientBrandAttachment.delete({ where: { id: mirrorBrand.id } })
      }

      await prisma.clientFrameworkAttachment.delete({ where: { id: attachmentId } })
      try { await deleteObject(attachment.storageKey) } catch { /* file may already be gone */ }
      return reply.code(204).send()
    },
  )

  // ── GET /:id/framework/:verticalId/research — get research status + sources
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const research = await prisma.clientFrameworkResearch.findUnique({
      where: { clientId_verticalId: { clientId, verticalId } },
      select: { id: true, status: true, sources: true, websiteUrl: true, researchedAt: true, errorMessage: true, updatedAt: true },
    })
    return reply.send({ data: research ?? null })
  })

  // ── POST /:id/framework/:verticalId/research — trigger research job
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { websiteUrl } = (req.body ?? {}) as { websiteUrl?: string }

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    // Upsert to pending so polling can track it immediately
    await prisma.clientFrameworkResearch.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, status: 'pending', sources: [], websiteUrl: websiteUrl ?? null },
      update: { status: 'pending', errorMessage: null, websiteUrl: websiteUrl ?? null },
    })

    await getFrameworkResearchQueue().add('research', { agencyId, clientId, verticalId, websiteUrl }, {
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    })

    return reply.code(202).send({ data: { status: 'pending' } })
  })

  // ── POST /:id/framework/:verticalId/draft — draft a single field using stored research
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/draft', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { sectionNum, sectionTitle, fieldKey, fieldLabel, currentValue } =
      (req.body ?? {}) as {
        sectionNum?: string; sectionTitle?: string
        fieldKey?: string; fieldLabel?: string; currentValue?: string
      }

    if (!sectionNum || !fieldLabel) return reply.code(400).send({ error: 'sectionNum and fieldLabel are required' })

    const [client, vertical, research] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } }),
      prisma.clientFrameworkResearch.findUnique({
        where: { clientId_verticalId: { clientId, verticalId } },
        select: { status: true, sources: true },
      }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    // Build context block from live attachment summaries (permanent brain) + cached website scrape
    const readyAttachments = await prisma.clientFrameworkAttachment.findMany({
      where: { clientId, verticalId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, mimeType: true, summary: true },
      orderBy: { createdAt: 'asc' },
    })

    const websiteSources = research
      ? (research.sources as Array<{ type: string; filename: string; summary: string }>)
          .filter((s) => s.type === 'website')
      : []

    if (readyAttachments.length === 0 && websiteSources.length === 0) {
      return reply.code(422).send({ error: 'No research context available. Upload files or scrape a website first.' })
    }

    const contextBlock = [
      ...readyAttachments
        .filter((a) => a.summary && a.summary.trim())
        .map((a) => `--- ${a.filename} ---\n${a.summary}`),
      ...websiteSources.map((s) => `--- Website: ${s.filename} ---\n${s.summary}`),
    ].join('\n\n')

    const result = await callModel(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens: 600,
        temperature: 0.3,
      },
      `You are filling in a GTM (go-to-market) framework for a client.

CLIENT: ${client.name}
VERTICAL: ${vertical.name}
SECTION: ${sectionNum} — ${sectionTitle ?? ''}
FIELD: ${fieldLabel}

RESEARCH CONTEXT (extracted from attached documents, audio recordings, and website):
${contextBlock}

${currentValue ? `CURRENT VALUE (may be partial or placeholder):\n${currentValue}\n\n` : ''}Write a draft value for this field. Be specific — use language, stats, and details drawn directly from the research context where possible. Write in the voice that fits a professional GTM document. Return ONLY the field value with no preamble, labels, or explanation.`,
    )

    return reply.send({ data: { draft: result.text.trim() } })
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

  // ══════════════════════════════════════════════════════════════════════════
  // BRAND — verticals, profiles, builder, attachments
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /:id/brand-verticals ───────────────────────────────────────────────
  // Auto-syncs from the client's assigned Structure verticals so the branding
  // sidebar always mirrors what's in the Structure tab.
  app.get<{ Params: { id: string } }>('/:id/brand-verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Fetch Structure verticals assigned to this client
    const structureVerticals = await prisma.clientVertical.findMany({
      where: { clientId, agencyId },
      include: { vertical: { select: { id: true, name: true } } },
    })

    // Fetch existing brand verticals (may have been created manually or via prior sync)
    const existing = await prisma.clientBrandVertical.findMany({
      where: { clientId, agencyId },
    })

    // Create brand vertical records for any Structure verticals not yet synced
    for (const cv of structureVerticals) {
      const alreadySynced = existing.some((b) => b.sourceVerticalId === cv.vertical.id)
      if (!alreadySynced) {
        // Check for an unlinked brand vertical with the same name (created before sourceVerticalId migration)
        const unlinked = existing.find((b) => !b.sourceVerticalId && b.name === cv.vertical.name)
        if (unlinked) {
          await prisma.clientBrandVertical.update({
            where: { id: unlinked.id },
            data: { sourceVerticalId: cv.vertical.id },
          })
        } else {
          await prisma.clientBrandVertical.create({
            data: {
              agencyId,
              clientId,
              name: cv.vertical.name,
              sourceVerticalId: cv.vertical.id,
            },
          })
        }
      } else {
        // Keep name in sync if it changed in Structure
        const linked = existing.find((b) => b.sourceVerticalId === cv.vertical.id)
        if (linked && linked.name !== cv.vertical.name) {
          await prisma.clientBrandVertical.update({
            where: { id: linked.id },
            data: { name: cv.vertical.name },
          })
        }
      }
    }

    // Return fresh list
    const verticals = await prisma.clientBrandVertical.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    })
    return reply.send({ data: verticals })
  })

  // ── POST /:id/brand-verticals ──────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/brand-verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const { name } = (req.body ?? {}) as { name?: string }
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' })
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const vertical = await prisma.clientBrandVertical.create({
      data: { agencyId, clientId, name: name.trim() },
      select: { id: true, name: true, createdAt: true },
    })
    return reply.code(201).send({ data: vertical })
  })

  // ── DELETE /:id/brand-verticals/:verticalId ────────────────────────────────
  app.delete<{ Params: { id: string; verticalId: string } }>('/:id/brand-verticals/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const vertical = await prisma.clientBrandVertical.findFirst({
      where: { id: verticalId, clientId, agencyId },
    })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    await prisma.clientBrandVertical.delete({ where: { id: verticalId } })
    return reply.code(204).send()
  })

  // ── GET /:id/brand-profile ─────────────────────────────────────────────────
  // ?verticalId= omitted or empty → General brand
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    return reply.send({ data: profile ?? null })
  })

  // ── PATCH /:id/brand-profile ───────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { editedJson, websiteUrl } = (req.body ?? {}) as { editedJson?: Record<string, unknown>; websiteUrl?: string }
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const existing = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    const updateData: Record<string, unknown> = {}
    if (editedJson !== undefined) updateData.editedJson = editedJson ?? null
    if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl?.trim() || null
    let profile
    if (existing) {
      profile = await prisma.clientBrandProfile.update({ where: { id: existing.id }, data: updateData })
    } else {
      profile = await prisma.clientBrandProfile.create({
        data: { agencyId, clientId, verticalId, extractionStatus: 'idle', ...updateData },
      })
    }
    // Mark AI templates stale if the Brain changed (fire-and-forget)
    markStaleIfBrainChanged(clientId, agencyId).catch(() => {})
    return reply.send({ data: profile })
  })

  // ── POST /:id/brand-profile/scrape ────────────────────────────────────────
  // Enqueue a brand-scrape job that fetches the website URL and re-runs extraction
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/scrape', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Get or create profile to confirm websiteUrl is set
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
      select: { id: true, websiteUrl: true },
    })
    if (!profile?.websiteUrl) {
      return reply.code(422).send({ error: 'No website URL saved on the brand profile. Save a URL first.' })
    }

    await prisma.clientBrandProfile.update({
      where: { id: profile.id },
      data: { extractionStatus: 'extracting', errorMessage: null },
    })

    // Enqueue via brand-attachment queue — the processor will detect website source
    await getBrandAttachmentProcessQueue().add('scrape', {
      agencyId,
      attachmentId: '', // empty signals website-scrape mode
      clientId,
      verticalId,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    return reply.send({ data: { status: 'extracting' } })
  })

  // ── GET /:id/brand-profile/attachments ────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const attachments = await prisma.clientBrandAttachment.findMany({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, extractionStatus: true, errorMessage: true, extractedText: true, summary: true, summaryStatus: true },
    })
    // Attach the GTM read for each file so the Branding room can show both lenses
    const storageKeys = attachments.map((a) => a.storageKey).filter(Boolean)
    const gtmMirrors = storageKeys.length
      ? await prisma.clientFrameworkAttachment.findMany({
          where: { clientId, agencyId, storageKey: { in: storageKeys } },
          select: { id: true, storageKey: true, verticalId: true, summary: true, summaryStatus: true },
        })
      : []
    const gtmMap = new Map(gtmMirrors.map((m) => [m.storageKey, m]))
    // Trim extractedText to a preview — full text is served via /:attachmentId/text
    const data = attachments.map((a) => ({
      ...a,
      extractedText: a.extractedText ? a.extractedText.slice(0, 2000) : null,
      gtmSummary: gtmMap.get(a.storageKey)?.summary ?? null,
      gtmSummaryStatus: gtmMap.get(a.storageKey)?.summaryStatus ?? null,
      gtmAttachmentId: gtmMap.get(a.storageKey)?.id ?? null,
      gtmVerticalId: gtmMap.get(a.storageKey)?.verticalId ?? null,
    }))
    return reply.send({ data })
  })

  // ── POST /:id/brand-profile/attachments ───────────────────────────────────
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId } })
      if (!vert) return reply.code(404).send({ error: 'Vertical not found' })
    }

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data

    const allowedExts = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv', '.json', '.html', '.htm', '.mp4', '.mov', '.mp3', '.m4a', '.wav', '.webm'])
    const fileExt = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!allowedExts.has(fileExt)) {
      file.resume()
      return reply.code(400).send({ error: `Unsupported file type "${fileExt}". Accepted: PDF, DOCX, TXT, MD, CSV, JSON, HTML, MP4, MOV, MP3, M4A, WAV` })
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = `brand-attachments/${agencyId}/${clientId}/${verticalId ?? 'general'}/${crypto.randomUUID()}-${safeName}`

    try {
      await uploadStream(storageKey, file, mimetype)
    } catch (err) {
      app.log.error(err, 'Failed to store brand attachment')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    const brandUploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    const brandUploaderId = brandUploader?.id ?? req.auth.userId

    const attachment = await prisma.clientBrandAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: mimetype, sizeBytes, uploadedByUserId: brandUploaderId },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, extractionStatus: true, errorMessage: true },
    })

    await getBrandAttachmentProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      clientId,
      verticalId,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    // Cross-post to GTM Framework brain — same storageKey, no re-upload
    if (verticalId) {
      const brandVert = await prisma.clientBrandVertical.findFirst({
        where: { id: verticalId, clientId, agencyId },
        select: { sourceVerticalId: true },
      })
      if (brandVert?.sourceVerticalId) {
        const [clientRecord, verticalRecord] = await Promise.all([
          prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
          prisma.vertical.findFirst({ where: { id: brandVert.sourceVerticalId, agencyId }, select: { name: true } }),
        ])
        if (clientRecord && verticalRecord) {
          const fwAttachment = await prisma.clientFrameworkAttachment.create({
            data: { agencyId, clientId, verticalId: brandVert.sourceVerticalId, filename, storageKey, mimeType: mimetype, sizeBytes },
          })
          await getAttachmentProcessQueue().add('process', {
            agencyId,
            attachmentId: fwAttachment.id,
            clientName: clientRecord.name,
            verticalName: verticalRecord.name,
          }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
        }
      }
    }

    return reply.code(201).send({ data: attachment })
  })

  // ── DELETE /:id/brand-profile/attachments/:attachmentId ───────────────────
  app.delete<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })

    // Delete mirrored GTM framework attachment (same storageKey, shared brain)
    const mirrorFw = await prisma.clientFrameworkAttachment.findFirst({
      where: { clientId, agencyId, storageKey: attachment.storageKey },
    })
    if (mirrorFw) {
      await prisma.clientFrameworkAttachment.delete({ where: { id: mirrorFw.id } })
    }

    await prisma.clientBrandAttachment.delete({ where: { id: attachmentId } })
    try { await deleteObject(attachment.storageKey) } catch {}
    return reply.code(204).send()
  })

  // ── PATCH /:id/brand-profile/attachments/:attachmentId — edit summary ────
  app.patch<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const { summary } = (req.body ?? {}) as { summary?: string }
    if (typeof summary !== 'string') return reply.code(400).send({ error: 'summary is required' })
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    const updated = await prisma.clientBrandAttachment.update({
      where: { id: attachmentId },
      data: { summary: summary.trim(), summaryStatus: 'ready' },
      select: { id: true, summary: true, summaryStatus: true },
    })
    return reply.send({ data: updated })
  })

  // ── GET /:id/brand-profile/attachments/:attachmentId/text — raw original ──
  app.get<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId/text', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
      select: { extractedText: true, filename: true },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    return reply.send({ data: { text: attachment.extractedText ?? '', filename: attachment.filename } })
  })

  // ── POST /:id/brand-profile/attachments/from-url — ingest a URL into the brain
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { url } = (req.body ?? {}) as { url?: string }

    if (!url?.trim()) return reply.code(400).send({ error: 'url is required' })
    let parsedUrl: URL
    try { parsedUrl = new URL(url.trim()) } catch {
      return reply.code(400).send({ error: 'Invalid URL' })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId } })
      if (!vert) return reply.code(404).send({ error: 'Vertical not found' })
    }

    const hostname = parsedUrl.hostname.replace(/^www\./, '')
    const date = new Date().toISOString().slice(0, 10)
    const filename = `${hostname}-${date}.txt`
    const storageKey = `url-import/${agencyId}/${clientId}/${verticalId ?? 'general'}/${crypto.randomUUID()}`

    const attachment = await prisma.clientBrandAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: 'text/plain', sizeBytes: 0, extractionStatus: 'processing' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, extractionStatus: true, summaryStatus: true },
    })

    await getBrandAttachmentProcessQueue().add('process', {
      agencyId, attachmentId: attachment.id, clientId, verticalId, url: parsedUrl.toString(),
    }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })

    return reply.code(201).send({ data: attachment })
  })

  // ── GET /:id/brand-builder ─────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-builder', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const builder = await prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    return reply.send({ data: builder ?? null })
  })

  // ── PUT /:id/brand-builder ─────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-builder', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { dataJson } = (req.body ?? {}) as { dataJson?: Record<string, unknown> }
    if (!dataJson) return reply.code(400).send({ error: 'dataJson is required' })
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const existing = await prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    let builder
    if (existing) {
      builder = await prisma.clientBrandBuilder.update({ where: { id: existing.id }, data: { dataJson } })
    } else {
      builder = await prisma.clientBrandBuilder.create({ data: { agencyId, clientId, verticalId, dataJson } })
    }
    // Mark AI templates stale if the Brain changed (fire-and-forget)
    markStaleIfBrainChanged(clientId, agencyId).catch(() => {})
    return reply.send({ data: builder })
  })

  // ── GET /:id/brand ─────────────────────────────────────────────────────────
  // Returns merged brand data for workflow node consumption
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null

    const [client, profile, builder] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      prisma.clientBrandProfile.findFirst({
        where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
        select: { editedJson: true, extractedJson: true },
      }),
      prisma.clientBrandBuilder.findFirst({
        where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
        select: { dataJson: true },
      }),
    ])

    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const profileData = (profile?.editedJson ?? profile?.extractedJson ?? null) as Record<string, unknown> | null
    const builderData = (builder?.dataJson ?? null) as Record<string, unknown> | null

    // Merge: builder values take priority, profile fills gaps
    const merged = profileData || builderData
      ? { ...(profileData ?? {}), ...(builderData ?? {}) }
      : null

    let verticalName: string | null = null
    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId }, select: { name: true } })
      verticalName = vert?.name ?? null
    }

    return reply.send({
      data: {
        clientId,
        clientName: client.name,
        vertical: verticalName ?? 'General',
        brand: merged,
        hasBrandProfile: profileData !== null,
        hasBrandBuilder: builderData !== null,
        source: profileData && builderData ? 'merged' : profileData ? 'brand_profile' : builderData ? 'brand_builder' : null,
      },
    })
  })

  // ── Client Brain ──────────────────────────────────────────────────────────────

  const ALLOWED_CLIENT_BRAIN_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv', '.json', '.html', '.htm'])

  // GET context
  app.get<{ Params: { clientId: string } }>('/:clientId/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { brainContext: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    return reply.send({ data: { context: client.brainContext ?? null } })
  })

  // PATCH context
  app.patch<{ Params: { clientId: string }; Body: { context: string } }>('/:clientId/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const { context } = req.body
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    await prisma.client.update({ where: { id: clientId }, data: { brainContext: context } })
    return reply.send({ data: { ok: true } })
  })

  // GET attachments list (optionally filtered by ?source=)
  app.get<{ Params: { clientId: string }; Querystring: { source?: string } }>('/:clientId/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const sourceFilter = req.query.source?.trim() || undefined
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const attachments = await prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, ...(sourceFilter ? { source: sourceFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, campaignId: true, campaignScopedOnly: true,
        uploadMethod: true, uploadedByUserId: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // POST upload file (optional ?source= and ?verticalId= query params)
  app.post<{ Params: { clientId: string }; Querystring: { source?: string; verticalId?: string } }>('/:clientId/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const source = req.query.source?.trim() || 'client'
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const fileExt = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_CLIENT_BRAIN_EXTS.has(fileExt)) {
      return reply.code(400).send({ error: `File type ${fileExt} not supported. Allowed: ${[...ALLOWED_CLIENT_BRAIN_EXTS].join(', ')}` })
    }

    const storageKey = `client-brain/${agencyId}/${clientId}/${crypto.randomUUID()}${fileExt}`
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const { Readable } = await import('node:stream')
    await uploadStream(storageKey, Readable.from(buffer), mimetype)

    // Resolve internal user ID from Clerk user ID for audit trail.
    // If no DB User record is linked yet, fall back to storing the Clerk user ID directly —
    // the master view resolves it via Clerk API on read.
    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true, name: true, email: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    const attachment = await prisma.clientBrainAttachment.create({
      data: {
        agencyId, clientId, filename, storageKey, mimeType: mimetype,
        sizeBytes: buffer.byteLength, extractionStatus: 'pending', summaryStatus: 'pending',
        source, verticalId, uploadMethod: 'file',
        uploadedByUserId: storedUploaderId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, uploadMethod: true,
      },
    })

    await getClientBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId })
    return reply.code(201).send({ data: { ...attachment, uploadedByName: uploader?.name ?? uploader?.email ?? null } })
  })

  // POST from URL (optional ?source= and ?verticalId= query params)
  app.post<{ Params: { clientId: string }; Body: { url: string }; Querystring: { source?: string; verticalId?: string } }>('/:clientId/brain/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const { url } = req.body
    const source = req.query.source?.trim() || 'client'
    const verticalId = req.query.verticalId?.trim() || null
    if (!url) return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true, name: true, email: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    let hostname = url
    try { hostname = new URL(url).hostname } catch {}

    const attachment = await prisma.clientBrainAttachment.create({
      data: {
        agencyId, clientId, filename: hostname, sourceUrl: url, mimeType: 'text/html',
        sizeBytes: 0, extractionStatus: 'pending', summaryStatus: 'pending',
        source, verticalId, uploadMethod: 'url',
        uploadedByUserId: storedUploaderId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, uploadMethod: true,
      },
    })

    await getClientBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId, url })
    return reply.code(201).send({ data: { ...attachment, uploadedByName: uploader?.name ?? uploader?.email ?? null } })
  })

  // PATCH summary (manual edit)
  app.patch<{ Params: { clientId: string; attachmentId: string }; Body: { summary: string } }>(
    '/:clientId/brain/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({ where: { id: attachmentId, clientId, agencyId } })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: req.body.summary, summaryStatus: 'ready' },
      })
      return reply.send({ data: { ok: true } })
    }
  )

  // GET /:clientId/brain/all — master view: all brain attachments across all surfaces
  app.get<{ Params: { clientId: string } }>('/:clientId/brain/all', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // 1. ClientBrainAttachment (unified table — source: client | demand_gen | gtm_framework | branding)
    const clientBrainDocs = await prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, sourceUrl: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, campaignId: true, campaignScopedOnly: true,
        uploadedByUserId: true, uploadMethod: true,
      },
    })

    // 2. CampaignBrainAttachment (separate table, always source='campaign')
    const campaignBrainDocs = await prisma.campaignBrainAttachment.findMany({
      where: { agencyId, campaign: { clientId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, sourceUrl: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        campaignScopedOnly: true, uploadedByUserId: true,
        campaign: { select: { id: true, name: true } },
      },
    })

    // 3. ClientBrandAttachment (branding brain — separate table, always source='branding')
    const brandDocs = await prisma.clientBrandAttachment.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        verticalId: true, uploadedByUserId: true,
        vertical: { select: { id: true, name: true } },
      },
    })

    // Resolve uploader display names across all three tables.
    // uploadedByUserId may be an internal User UUID or a Clerk user ID (user_xxx fallback).
    const allUploaderIds = [...new Set([
      ...clientBrainDocs.map((d) => d.uploadedByUserId),
      ...campaignBrainDocs.map((d) => d.uploadedByUserId),
      ...brandDocs.map((d) => d.uploadedByUserId),
    ].filter(Boolean) as string[])]

    const uploaderMap: Record<string, string | null> = {}
    if (allUploaderIds.length > 0) {
      const internalIds = allUploaderIds.filter((id) => !id.startsWith('user_'))
      const clerkIds = allUploaderIds.filter((id) => id.startsWith('user_'))

      if (internalIds.length > 0) {
        const dbUsers = await prisma.user.findMany({ where: { id: { in: internalIds }, agencyId }, select: { id: true, name: true, email: true } })
        for (const u of dbUsers) uploaderMap[u.id] = u.name ?? u.email ?? null
      }
      if (clerkIds.length > 0) {
        const clerkNames = await getClerkUserNames(clerkIds)
        for (const [clerkId, { name, email }] of Object.entries(clerkNames)) {
          uploaderMap[clerkId] = name ?? email ?? null
        }
      }
    }

    const SOURCE_LABELS: Record<string, string> = {
      client: 'Client Brain', campaign: 'Campaign', gtm_framework: 'GTM Framework',
      demand_gen: 'Demand Gen', branding: 'Branding',
    }

    const allDocs = [
      ...clientBrainDocs.map((d) => ({
        id: d.id, table: 'client_brain_attachments',
        filename: d.filename, sourceUrl: d.sourceUrl, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: d.source, sourceLabel: SOURCE_LABELS[d.source] ?? d.source,
        verticalId: d.verticalId, verticalName: null as string | null,
        campaignId: d.campaignId, campaignName: null as string | null,
        campaignScopedOnly: d.campaignScopedOnly,
        uploadMethod: d.uploadMethod,
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
      ...campaignBrainDocs.map((d) => ({
        id: d.id, table: 'campaign_brain_attachments',
        filename: d.filename, sourceUrl: d.sourceUrl, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: 'campaign', sourceLabel: 'Campaign',
        verticalId: null, verticalName: null,
        campaignId: d.campaign.id, campaignName: d.campaign.name,
        campaignScopedOnly: d.campaignScopedOnly,
        uploadMethod: d.sourceUrl ? 'url' : 'file',
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
      ...brandDocs.map((d) => ({
        id: d.id, table: 'client_brand_attachments',
        filename: d.filename, sourceUrl: null, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: 'branding', sourceLabel: 'Branding',
        verticalId: d.verticalId, verticalName: d.vertical?.name ?? null,
        campaignId: null, campaignName: null, campaignScopedOnly: false,
        uploadMethod: 'file',
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return reply.send({ data: allDocs })
  })

  // GET raw extracted text for a client brain attachment
  app.get<{ Params: { clientId: string; attachmentId: string } }>(
    '/:clientId/brain/attachments/:attachmentId/text',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({
        where: { id: attachmentId, clientId, agencyId },
        select: { extractedText: true, filename: true },
      })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      return reply.send({ data: { text: attachment.extractedText ?? '', filename: attachment.filename } })
    }
  )

  // POST /:clientId/setup-suggest — AI magic: suggest setup field values from client brain
  app.post<{ Params: { clientId: string } }>(
    '/:clientId/setup-suggest',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId } = req.params
      const { verticalId, fields } = req.body as {
        verticalId?: string
        fields: Array<{ nodeId: string; field: string; label: string; placeholder?: string }>
      }

      if (!fields || fields.length === 0) return reply.code(400).send({ error: 'fields is required' })

      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: {
          name: true,
          industry: true,
          brandBuilders: { take: 1, orderBy: { createdAt: 'desc' }, select: { dataJson: true } },
          brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
        },
      })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      // Load relevant brain docs (GTM framework + demand gen base — highest signal for keywords/topics)
      const brainDocs = await prisma.clientBrainAttachment.findMany({
        where: {
          clientId, agencyId,
          summaryStatus: 'ready',
          source: { in: ['gtm_framework', 'demand_gen', 'client'] },
          ...(verticalId && verticalId !== '__company__' ? { verticalId } : {}),
        },
        select: { filename: true, summary: true, source: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })

      const brandProfile = client.brandProfiles[0]
      const brandBuilder = client.brandBuilders[0]
      const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson ?? brandBuilder?.dataJson

      const contextParts: string[] = [
        `CLIENT: ${client.name}`,
        `INDUSTRY: ${client.industry ?? 'not specified'}`,
      ]
      if (brandData) {
        const b = brandData as Record<string, unknown>
        const audience = b.target_audience ?? b.audience
        const positioning = b.positioning ?? b.value_proposition ?? b.tagline
        if (positioning) contextParts.push(`POSITIONING: ${JSON.stringify(positioning)}`)
        if (audience) contextParts.push(`TARGET AUDIENCE: ${JSON.stringify(audience)}`)
      }
      if (brainDocs.length > 0) {
        contextParts.push('\nKNOWLEDGE BASE:')
        for (const doc of brainDocs) {
          if (doc.summary?.trim()) {
            contextParts.push(`--- ${doc.filename} (${doc.source}) ---\n${doc.summary.trim()}`)
          }
        }
      }

      const fieldLines = fields.map((f, idx) =>
        `${idx + 1}. field="${f.field}" label="${f.label}"${f.placeholder ? ` example="${f.placeholder}"` : ''}`
      ).join('\n')

      const result = await callModel(
        {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          api_key_ref: 'ANTHROPIC_API_KEY',
          max_tokens: 400,
          temperature: 0.4,
        },
        `You are helping set up a content workflow for a marketing agency client.

${contextParts.join('\n')}

FIELDS TO FILL:
${fieldLines}

Based on the client context above, suggest the best value for each field.
Return ONLY a valid JSON object mapping field names to suggested string values.
Be specific and use real details from the context — do not use generic placeholders.
If a field asks for URLs that aren't clearly present in the context, omit it or return an empty string.
Example format: {"field1":"value1","field2":"value2"}`,
      )

      let suggestions: Record<string, string> = {}
      try {
        const text = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
        suggestions = JSON.parse(text)
      } catch {
        // Return empty suggestions rather than erroring — UI will handle gracefully
      }

      return reply.send({ data: { suggestions } })
    }
  )

  // DELETE attachment
  app.delete<{ Params: { clientId: string; attachmentId: string } }>(
    '/:clientId/brain/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({ where: { id: attachmentId, clientId, agencyId } })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      if (attachment.storageKey) {
        try { await deleteObject(attachment.storageKey) } catch {}
      }
      await prisma.clientBrainAttachment.delete({ where: { id: attachmentId } })
      return reply.send({ data: { ok: true } })
    }
  )
}
