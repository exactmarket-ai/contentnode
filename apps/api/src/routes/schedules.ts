import type { FastifyInstance } from 'fastify'
import { Cron } from 'croner'
import { prisma } from '@contentnode/database'

function computeNextRunAt(cronExpr: string, timezone: string): Date | null {
  try {
    return new Cron(cronExpr, { timezone }).nextRun() ?? null
  } catch {
    return null
  }
}

function validateCron(cronExpr: string): boolean {
  try {
    new Cron(cronExpr)
    return true
  } catch {
    return false
  }
}

export async function scheduleRoutes(app: FastifyInstance) {

  // ── GET /api/v1/workflows/:workflowId/schedules ───────────────────────────
  app.get<{ Params: { workflowId: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowId } = req.params

    // Verify workflow belongs to agency
    const wf = await prisma.workflow.findFirst({ where: { id: workflowId, agencyId }, select: { id: true } })
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const schedules = await prisma.workflowSchedule.findMany({
      where: { workflowId, agencyId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: schedules })
  })

  // ── POST /api/v1/workflows/:workflowId/schedules ──────────────────────────
  app.post<{ Params: { workflowId: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowId } = req.params
    const { cronExpr, timezone = 'UTC', name, status = 'active' } = req.body as {
      cronExpr: string; timezone?: string; name?: string; status?: string
    }

    if (!cronExpr?.trim()) return reply.code(400).send({ error: 'cronExpr is required' })
    if (!validateCron(cronExpr)) return reply.code(400).send({ error: 'Invalid cron expression' })

    const wf = await prisma.workflow.findFirst({ where: { id: workflowId, agencyId }, select: { id: true } })
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const nextRunAt = computeNextRunAt(cronExpr, timezone)

    const schedule = await prisma.workflowSchedule.create({
      data: {
        agencyId,
        workflowId,
        cronExpr: cronExpr.trim(),
        timezone,
        name: name?.trim() ?? null,
        status,
        nextRunAt,
      },
    })
    return reply.code(201).send({ data: schedule })
  })

  // ── PATCH /api/v1/workflows/:workflowId/schedules/:id ────────────────────
  app.patch<{ Params: { workflowId: string; id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowId, id } = req.params
    const body = req.body as {
      cronExpr?: string; timezone?: string; name?: string; status?: string
    }

    const existing = await prisma.workflowSchedule.findFirst({
      where: { id, workflowId, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' })

    if (body.cronExpr && !validateCron(body.cronExpr)) {
      return reply.code(400).send({ error: 'Invalid cron expression' })
    }

    const newCronExpr = body.cronExpr ?? existing.cronExpr
    const newTimezone = body.timezone ?? existing.timezone
    const nextRunAt = computeNextRunAt(newCronExpr, newTimezone)

    const schedule = await prisma.workflowSchedule.update({
      where: { id },
      data: {
        ...(body.cronExpr && { cronExpr: body.cronExpr.trim() }),
        ...(body.timezone && { timezone: body.timezone }),
        ...(body.name !== undefined && { name: body.name?.trim() ?? null }),
        ...(body.status && { status: body.status }),
        nextRunAt,
      },
    })
    return reply.send({ data: schedule })
  })

  // ── DELETE /api/v1/workflows/:workflowId/schedules/:id ───────────────────
  app.delete<{ Params: { workflowId: string; id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowId, id } = req.params

    const existing = await prisma.workflowSchedule.findFirst({
      where: { id, workflowId, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' })

    await prisma.workflowSchedule.delete({ where: { id } })
    return reply.code(204).send()
  })
}
