import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'

export async function divisionRoutes(app: FastifyInstance) {
  // ── GET /:clientId/divisions — list divisions with their jobs ──────────────
  app.get<{ Params: { clientId: string } }>('/:clientId/divisions', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params

    // Verify client belongs to agency
    const client = await prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: { id: true },
    })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const divisions = await prisma.division.findMany({
      where: { clientId, agencyId },
      include: {
        jobs: {
          where: { agencyId },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    return reply.send({ data: divisions })
  })

  // ── POST /:clientId/divisions — create division ───────────────────────────
  app.post<{ Params: { clientId: string } }>('/:clientId/divisions', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const body = z.object({ name: z.string().min(1) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'name is required' })

    const client = await prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: { id: true },
    })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const division = await prisma.division.create({
      data: {
        agencyId,
        clientId,
        name: body.data.name.trim(),
      },
      include: { jobs: true },
    })

    return reply.code(201).send({ data: division })
  })

  // ── PATCH /:clientId/divisions/:id — rename ───────────────────────────────
  app.patch<{ Params: { clientId: string; id: string } }>('/:clientId/divisions/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params
    const body = z.object({ name: z.string().min(1) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'name is required' })

    const existing = await prisma.division.findFirst({
      where: { id, clientId, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Division not found' })

    const division = await prisma.division.update({
      where: { id },
      data: { name: body.data.name.trim() },
      include: { jobs: true },
    })

    return reply.send({ data: division })
  })

  // ── DELETE /:clientId/divisions/:id — delete (cascades jobs) ─────────────
  app.delete<{ Params: { clientId: string; id: string } }>('/:clientId/divisions/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params

    const existing = await prisma.division.findFirst({
      where: { id, clientId, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Division not found' })

    await prisma.division.delete({ where: { id } })
    return reply.code(204).send()
  })

  // ── POST /:clientId/divisions/:divisionId/jobs — create job ──────────────
  app.post<{ Params: { clientId: string; divisionId: string } }>(
    '/:clientId/divisions/:divisionId/jobs',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, divisionId } = req.params
      const body = z.object({
        name: z.string().min(1),
        budgetCents: z.number().int().positive().optional(),
      }).safeParse(req.body)
      if (!body.success) return reply.code(400).send({ error: 'name is required' })

      const division = await prisma.division.findFirst({
        where: { id: divisionId, clientId, agencyId },
      })
      if (!division) return reply.code(404).send({ error: 'Division not found' })

      const job = await prisma.job.create({
        data: {
          agencyId,
          divisionId,
          name: body.data.name.trim(),
          budgetCents: body.data.budgetCents ?? null,
        },
      })

      return reply.code(201).send({ data: job })
    },
  )

  // ── PATCH /:clientId/divisions/:divisionId/jobs/:id — update job ─────────
  app.patch<{ Params: { clientId: string; divisionId: string; id: string } }>(
    '/:clientId/divisions/:divisionId/jobs/:id',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, divisionId, id } = req.params
      const body = z.object({
        name: z.string().min(1).optional(),
        budgetCents: z.number().int().positive().nullable().optional(),
      }).safeParse(req.body)
      if (!body.success) return reply.code(400).send({ error: 'Invalid body', details: body.error.issues })

      // Verify division belongs to this client/agency
      const division = await prisma.division.findFirst({
        where: { id: divisionId, clientId, agencyId },
      })
      if (!division) return reply.code(404).send({ error: 'Division not found' })

      const existing = await prisma.job.findFirst({
        where: { id, divisionId, agencyId },
      })
      if (!existing) return reply.code(404).send({ error: 'Job not found' })

      const job = await prisma.job.update({
        where: { id },
        data: {
          ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
          ...(body.data.budgetCents !== undefined ? { budgetCents: body.data.budgetCents } : {}),
        },
      })

      return reply.send({ data: job })
    },
  )

  // ── DELETE /:clientId/divisions/:divisionId/jobs/:id — delete job ─────────
  app.delete<{ Params: { clientId: string; divisionId: string; id: string } }>(
    '/:clientId/divisions/:divisionId/jobs/:id',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, divisionId, id } = req.params

      const division = await prisma.division.findFirst({
        where: { id: divisionId, clientId, agencyId },
      })
      if (!division) return reply.code(404).send({ error: 'Division not found' })

      const existing = await prisma.job.findFirst({
        where: { id, divisionId, agencyId },
      })
      if (!existing) return reply.code(404).send({ error: 'Job not found' })

      await prisma.job.delete({ where: { id } })
      return reply.code(204).send()
    },
  )
}
