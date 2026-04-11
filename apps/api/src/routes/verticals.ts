import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'

const createBody = z.object({ name: z.string().min(1).max(100) })
const updateBody = z.object({ name: z.string().min(1).max(100) })

export async function verticalRoutes(app: FastifyInstance) {

  // ── GET /api/v1/verticals ─────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const verticals = await prisma.vertical.findMany({
      where: { agencyId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, createdAt: true },
    })
    return reply.send({ data: verticals })
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
      data: { agencyId, name: parsed.data.name },
    })
    return reply.code(201).send({ data: vertical })
  })

  // ── PATCH /api/v1/verticals/:id ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'name is required' })

    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const updated = await prisma.vertical.update({
      where: { id: req.params.id },
      data: { name: parsed.data.name },
    })
    return reply.send({ data: updated })
  })

  // ── DELETE /api/v1/verticals/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const vertical = await prisma.vertical.findFirst({ where: { id: req.params.id, agencyId } })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.vertical.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })
}
