import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

const SEED_PROMPTS = [
  {
    name: 'Hero — The Platform',
    styleTags: 'hero, platform, brand',
    promptText: 'Warm off-white background (#f5f4ef), abstract flowing data streams converging into a single luminous node, vivid electric purple (#a200ee) and soft violet (#c44fff) gradient light trails, clean minimal composition with strong negative space, cinematic depth of field, soft volumetric lighting, premium B2B SaaS aesthetic, no people, no text, ultra high resolution, editorial technology photography style, subtle particle field in background, 16:9 landscape',
    notes: null,
    sortOrder: 0,
  },
  {
    name: 'Brain — Institutional Memory',
    styleTags: 'brain, memory, intelligence',
    promptText: 'Warm off-white background (#f5f4ef), three-dimensional network of interconnected glowing nodes in layered tiers, vivid electric purple (#a200ee) core light radiating outward to soft violet (#c44fff) and pale lavender (#f0d6ff) on outer edges, each node pulsing with stored intelligence, clean geometric connections, deep field blur on outer edges, no human figures, no brain anatomy, architectural and abstract, premium technology brand aesthetic, cinematic, 16:9',
    notes: null,
    sortOrder: 1,
  },
  {
    name: 'Workflow — Production Pipeline',
    styleTags: 'workflow, pipeline, production',
    promptText: 'Warm off-white background (#f5f4ef), clean horizontal pipeline visualization, discrete glowing stages connected by luminous flow lines in electric purple (#a200ee) to soft violet (#c44fff), each stage a precise geometric card with subtle inner glow, minimal flat design meets cinematic lighting, strong left-to-right visual direction, deep negative space above and below, no icons no text no people, premium editorial technology aesthetic, 16:9',
    notes: null,
    sortOrder: 2,
  },
  {
    name: 'Client Brain — Personalization',
    styleTags: 'client, personalization, clusters',
    promptText: 'Warm off-white background (#f5f4ef), multiple distinct glowing clusters in a clean grid, each cluster a unique constellation of nodes with subtle color differentiation in purple and lavender tones (#a200ee, #c44fff, #f0d6ff), clusters connected by thin luminous threads, architectural precision, cinematic depth of field with central cluster in sharp focus, no faces no people no text, premium B2B SaaS brand aesthetic, 16:9',
    notes: null,
    sortOrder: 3,
  },
  {
    name: 'Learning Loop — Signals',
    styleTags: 'learning, signals, loop',
    promptText: 'Warm off-white background (#f5f4ef), abstract circular flow visualization, content moving through stages as clean geometric forms, electric purple (#a200ee) light tracing the loop with soft violet (#c44fff) trailing glow, subtle edit marks rendered as minimal geometric accents, loop tightening toward center suggesting compounding intelligence, no people no text, cinematic lighting with soft volumetric purple glow, premium technology editorial aesthetic, 16:9',
    notes: null,
    sortOrder: 4,
  },
  {
    name: 'Agency Scale — Multi-Client',
    styleTags: 'agency, scale, multi-client',
    promptText: 'Warm off-white background (#f5f4ef), clean isometric grid of identical workflow structures each with subtle unique purple accent (#a200ee to #c44fff) suggesting distinct client identity, precise geometric forms with soft inner glow, strong vertical composition showing scale, all structures connected to a single luminous purple spine suggesting shared infrastructure, no people no text no logos, premium B2B SaaS aesthetic, 16:9',
    notes: null,
    sortOrder: 5,
  },
]

const ADMIN_ROLES = new Set(['owner', 'admin', 'org_admin'])

export async function imagePromptRoutes(app: FastifyInstance) {
  // GET / — list image prompts (active only)
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, global: globalOnly } = req.query as { clientId?: string; global?: string }

    const prompts = await prisma.imagePrompt.findMany({
      where: {
        agencyId,
        deletedAt: null,
        ...(globalOnly === 'true' ? { clientId: null } : clientId ? { clientId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return reply.send({ data: prompts })
  })

  // GET /trash — soft-deleted image prompts (admin only)
  app.get('/trash', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const { clientId } = req.query as { clientId?: string }
    const prompts = await prisma.imagePrompt.findMany({
      where: { agencyId, clientId: clientId ?? null, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    })
    return reply.send({ data: prompts })
  })

  // GET /picker — combined list for canvas picker: client prompts + global prompts
  app.get('/picker', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as { clientId?: string }

    const [clientPrompts, globalPrompts] = await Promise.all([
      clientId
        ? prisma.imagePrompt.findMany({
            where: { agencyId, clientId, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          })
        : Promise.resolve([]),
      prisma.imagePrompt.findMany({
        where: { agencyId, clientId: null, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ])
    return reply.send({ data: { clientPrompts, globalPrompts } })
  })

  // POST / — create image prompt
  app.post('/', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const body = req.body as { name: string; promptText: string; styleTags?: string; notes?: string; clientId?: string | null; sortOrder?: number }

    if (!body.name?.trim() || !body.promptText?.trim()) {
      return reply.code(400).send({ error: 'name and promptText are required' })
    }

    const prompt = await prisma.imagePrompt.create({
      data: {
        agencyId,
        clientId: body.clientId ?? null,
        name: body.name.trim(),
        promptText: body.promptText.trim(),
        styleTags: body.styleTags?.trim() ?? '',
        notes: body.notes?.trim() || null,
        sortOrder: body.sortOrder ?? 0,
        createdBy: userId,
      },
    })
    return reply.code(201).send({ data: prompt })
  })

  // PATCH /:id — update image prompt
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; promptText?: string; styleTags?: string; notes?: string; sortOrder?: number }

    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId, deletedAt: null } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    const prompt = await prisma.imagePrompt.update({
      where: { id },
      data: {
        ...(body.name !== undefined      ? { name: body.name.trim() }           : {}),
        ...(body.promptText !== undefined ? { promptText: body.promptText.trim() } : {}),
        ...(body.styleTags !== undefined  ? { styleTags: body.styleTags.trim() }   : {}),
        ...(body.notes !== undefined      ? { notes: body.notes?.trim() || null }   : {}),
        ...(body.sortOrder !== undefined  ? { sortOrder: body.sortOrder }           : {}),
      },
    })
    return reply.send({ data: prompt })
  })

  // DELETE /:id — soft delete (owner or admin)
  app.delete('/:id', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId, deletedAt: null } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    const isAdmin = ADMIN_ROLES.has(role)
    const isOwner = existing.createdBy === userId
    if (!isAdmin && !isOwner) return reply.code(403).send({ error: 'You can only delete prompts you created' })

    await prisma.imagePrompt.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: userId },
    })
    return reply.send({ data: { ok: true } })
  })

  // POST /:id/restore — restore soft-deleted (admin only)
  app.post('/:id/restore', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const { id } = req.params as { id: string }
    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })
    await prisma.imagePrompt.update({ where: { id }, data: { deletedAt: null, deletedBy: null } })
    return reply.send({ data: { ok: true } })
  })

  // DELETE /:id/permanent — hard delete (admin only)
  app.delete('/:id/permanent', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const { id } = req.params as { id: string }
    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })
    await prisma.imagePrompt.delete({ where: { id } })
    return reply.send({ data: { ok: true } })
  })

  // POST /seed-client — copy agency prompts to a specific client (seeds agency first if empty)
  app.post('/seed-client', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.body as { clientId?: string }
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Ensure agency has global prompts — seed defaults if not
    const agencyCount = await prisma.imagePrompt.count({ where: { agencyId, clientId: null } })
    if (agencyCount === 0) {
      await prisma.imagePrompt.createMany({
        data: SEED_PROMPTS.map((p) => ({ ...p, agencyId, clientId: null })),
      })
    }

    // Check if client already has prompts
    const clientCount = await prisma.imagePrompt.count({ where: { agencyId, clientId } })
    if (clientCount > 0) {
      return reply.send({ data: { skipped: true, message: 'Client already has image prompts' } })
    }

    await seedImagePromptsForClient(agencyId, clientId)
    return reply.send({ data: { seeded: true } })
  })

  // POST /seed — idempotent seed of global starter prompts (admin only)
  app.post('/seed', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.imagePrompt.count({ where: { agencyId, clientId: null } })
    if (existing > 0) {
      return reply.send({ data: { skipped: true, message: 'Global prompts already seeded' } })
    }

    await prisma.imagePrompt.createMany({
      data: SEED_PROMPTS.map((p) => ({ ...p, agencyId, clientId: null })),
    })
    return reply.send({ data: { seeded: SEED_PROMPTS.length } })
  })
}

// Called after client creation to copy all global agency prompts to the new client
export async function seedImagePromptsForClient(agencyId: string, clientId: string): Promise<void> {
  try {
    const globals = await prisma.imagePrompt.findMany({
      where: { agencyId, clientId: null },
      orderBy: { sortOrder: 'asc' },
    })
    if (!globals.length) return
    await prisma.imagePrompt.createMany({
      data: globals.map((p) => ({
        agencyId,
        clientId,
        name: p.name,
        promptText: p.promptText,
        styleTags: p.styleTags,
        notes: p.notes,
        sortOrder: p.sortOrder,
      })),
    })
  } catch (err) {
    console.error('[imagePrompts] seedForClient failed (non-fatal):', err)
  }
}
