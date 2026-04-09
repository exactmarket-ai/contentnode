import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'

export async function calendarRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const query = z.object({
      clientId: z.string().optional(),
      year:  z.coerce.number().int().min(2020).max(2100).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    }).safeParse(req.query)

    if (!query.success) {
      return reply.code(400).send({ error: 'Invalid query', details: query.error.issues })
    }

    const { agencyId } = req.auth
    const now = new Date()
    const year  = query.data.year  ?? now.getFullYear()
    const month = query.data.month ?? (now.getMonth() + 1)
    const clientId = query.data.clientId

    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const monthEnd   = new Date(Date.UTC(year, month, 1))

    // ── Runs for the month ───────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runsWhere: any = {
      agencyId,
      createdAt: { gte: monthStart, lt: monthEnd },
    }
    if (clientId) runsWhere.workflow = { clientId }

    const rawRuns = await prisma.workflowRun.findMany({
      where: runsWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        workflowId: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        output: true,
        workflow: {
          select: {
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
        feedbacks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { decision: true, starRating: true },
        },
        qualityRecord: {
          select: { detectionScores: true },
        },
      },
    })

    const runs = rawRuns.map((r) => {
      const scores = r.qualityRecord?.detectionScores as Array<{ scoreAfter?: number }> | null
      const detectionScore = scores?.at(-1)?.scoreAfter ?? null
      return {
        id: r.id,
        workflowId: r.workflowId,
        workflowName: r.workflow.name,
        clientId: r.workflow.client?.id ?? null,
        clientName: r.workflow.client?.name ?? null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        feedback: r.feedbacks[0]
          ? { decision: r.feedbacks[0].decision, starRating: r.feedbacks[0].starRating }
          : null,
        detectionScore,
      }
    })

    // ── Scheduled runs for the month ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedWhere: any = {
      agencyId,
      status: 'active',
      nextRunAt: { gte: monthStart, lt: monthEnd },
    }
    if (clientId) schedWhere.workflow = { clientId }

    const rawSchedules = await prisma.workflowSchedule.findMany({
      where: schedWhere,
      orderBy: { nextRunAt: 'asc' },
      select: {
        id: true,
        workflowId: true,
        cronExpr: true,
        timezone: true,
        status: true,
        nextRunAt: true,
        workflow: {
          select: {
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    })

    const scheduledRuns = rawSchedules.map((s) => ({
      id: s.id,
      workflowId: s.workflowId,
      workflowName: s.workflow.name,
      clientId: s.workflow.client?.id ?? null,
      clientName: s.workflow.client?.name ?? null,
      nextRunAt: s.nextRunAt!.toISOString(),
      cronExpr: s.cronExpr,
      timezone: s.timezone,
      status: s.status,
    }))

    return reply.send({ data: { runs, scheduledRuns, year, month } })
  })
}
