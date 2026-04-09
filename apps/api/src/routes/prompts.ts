import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'

const CATEGORIES = ['general', 'content', 'seo', 'social', 'email', 'other'] as const

const createBody = z.object({
  name:        z.string().min(1).max(120),
  body:        z.string().min(1),
  category:    z.enum(CATEGORIES).default('general'),
  description: z.string().max(300).optional(),
  parentId:    z.string().optional(),
  clientId:    z.string().optional(),
})

const updateBody = createBody.partial()

export async function promptRoutes(app: FastifyInstance) {
  // ── GET / — list prompt templates (optional ?clientId= filter) ──────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    const templates = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: clientId ?? null },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, category: true, description: true, parentId: true, clientId: true, useCount: true, createdAt: true, updatedAt: true, body: true },
    })
    return reply.send({ data: templates })
  })

  // ── POST / — create a new prompt template ────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const template = await prisma.promptTemplate.create({
      data: { agencyId, ...parsed.data } as any,
    })
    return reply.code(201).send({ data: template })
  })

  // ── PATCH /:id — update name / body / category / description ─────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const template = await prisma.promptTemplate.update({
      where: { id: req.params.id },
      data: parsed.data,
    })
    return reply.send({ data: template })
  })

  // ── POST /:id/use — increment use count (fire-and-forget from frontend) ──
  app.post<{ Params: { id: string } }>('/:id/use', async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.promptTemplate.updateMany({
      where: { id: req.params.id, agencyId },
      data: { useCount: { increment: 1 } },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    await prisma.promptTemplate.delete({ where: { id: req.params.id } })
    return reply.send({ data: { ok: true } })
  })
}
