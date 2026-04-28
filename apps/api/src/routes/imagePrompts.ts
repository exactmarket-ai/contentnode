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
    promptText: 'Deep dark background (#1a1a14), abstract circular flow visualization, content moving through stages as clean geometric forms, electric purple (#a200ee) light tracing the loop with soft violet (#c44fff) trailing glow, subtle edit marks rendered as minimal geometric accents, loop tightening toward center suggesting compounding intelligence, no people no text, cinematic lighting with soft volumetric purple glow, premium technology editorial aesthetic, 16:9',
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

export async function imagePromptRoutes(app: FastifyInstance) {
  // GET / — list image prompts
  // ?clientId= to get client-specific prompts
  // ?global=true to get only agency-level (no clientId)
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, global: globalOnly } = req.query as { clientId?: string; global?: string }

    const prompts = await prisma.imagePrompt.findMany({
      where: {
        agencyId,
        ...(globalOnly === 'true' ? { clientId: null } : clientId ? { clientId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
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
            where: { agencyId, clientId },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          })
        : Promise.resolve([]),
      prisma.imagePrompt.findMany({
        where: { agencyId, clientId: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ])
    return reply.send({ data: { clientPrompts, globalPrompts } })
  })

  // POST / — create image prompt
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
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
      },
    })
    return reply.code(201).send({ data: prompt })
  })

  // PATCH /:id — update image prompt
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; promptText?: string; styleTags?: string; notes?: string; sortOrder?: number }

    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId } })
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

  // DELETE /:id — admin only
  app.delete('/:id', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.imagePrompt.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    await prisma.imagePrompt.delete({ where: { id } })
    return reply.send({ data: { ok: true } })
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
