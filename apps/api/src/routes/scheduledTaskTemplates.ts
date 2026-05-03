import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'

const STRATEGIST_ROLES = new Set(['owner', 'admin', 'strategist'])

const bodySchema = z.object({
  name:      z.string().min(1).max(120),
  summary:   z.string().max(300).nullish(),
  type:      z.enum(['web_scrape', 'review_miner', 'audience_signal', 'seo_intent', 'research_brief']),
  frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  config:    z.record(z.unknown()).default({}),
})

const updateSchema = bodySchema.partial().omit({ type: true })

export async function scheduledTaskTemplateRoutes(app: FastifyInstance) {

  // ── GET / — list all templates for this agency ────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const templates = await prisma.scheduledTaskTemplate.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return reply.send({ data: templates })
  })

  // ── POST / — create template (strategist+) ────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    if (!STRATEGIST_ROLES.has(role)) return reply.code(403).send({ error: 'Strategist or above required' })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const { name, summary, type, frequency, config } = parsed.data

    const dbUser = userId ? await prisma.user.findFirst({ where: { clerkUserId: userId, agencyId }, select: { id: true } }) : null

    const template = await prisma.scheduledTaskTemplate.create({
      data: { agencyId, name, summary: summary ?? null, type, frequency, config: config as object, createdById: dbUser?.id ?? null },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return reply.code(201).send({ data: template })
  })

  // ── PATCH /:id — update template (strategist+) ────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!STRATEGIST_ROLES.has(role)) return reply.code(403).send({ error: 'Strategist or above required' })

    const existing = await prisma.scheduledTaskTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const { name, summary, frequency, config } = parsed.data

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (summary !== undefined) updateData.summary = summary ?? null
    if (frequency !== undefined) updateData.frequency = frequency
    if (config !== undefined) updateData.config = config

    const template = await prisma.scheduledTaskTemplate.update({
      where: { id: req.params.id },
      data: updateData,
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return reply.send({ data: template })
  })

  // ── DELETE /:id — delete template (strategist+) ───────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!STRATEGIST_ROLES.has(role)) return reply.code(403).send({ error: 'Strategist or above required' })

    const existing = await prisma.scheduledTaskTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    await prisma.scheduledTaskTemplate.delete({ where: { id: req.params.id } })
    return reply.send({ success: true })
  })
}
