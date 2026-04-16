import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import {
  getScheduledResearchQueue,
  type ScheduledResearchJobData,
} from '../lib/queues.js'
import { seedDefaultTasksForAllClients } from '../lib/defaultScheduledTasks.js'

const createBody = z.object({
  label: z.string().min(1).max(120),
  scope: z.enum(['company', 'client', 'vertical']),
  type: z.enum(['web_scrape', 'review_miner', 'audience_signal', 'seo_intent', 'research_brief']),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  clientId: z.string().optional(),
  verticalId: z.string().nullish(),
  config: z.record(z.unknown()).default({}),
})

const updateBody = createBody
  .partial()
  .omit({ scope: true, type: true })
  .extend({ enabled: z.boolean().optional() })

function computeNextRunAt(frequency: string): Date {
  const now = new Date()
  if (frequency === 'daily') return new Date(now.getTime() + 86_400_000)
  if (frequency === 'monthly') return new Date(now.getTime() + 30 * 86_400_000)
  return new Date(now.getTime() + 7 * 86_400_000)
}

export async function scheduledTaskRoutes(app: FastifyInstance) {

  // ── GET /api/v1/scheduled-tasks ───────────────────────────────────────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query

    const tasks = await prisma.scheduledTask.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { vertical: { select: { id: true, name: true } } },
    })
    return reply.send({ data: tasks })
  })

  // ── POST /api/v1/scheduled-tasks ──────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const { label, scope, type, frequency, clientId, verticalId, config } = parsed.data

    if (scope === 'client' && !clientId) {
      return reply.code(400).send({ error: 'clientId required for client-scoped tasks' })
    }
    if (scope === 'vertical' && (!clientId || !verticalId)) {
      return reply.code(400).send({ error: 'clientId and verticalId required for vertical-scoped tasks' })
    }

    const task = await prisma.scheduledTask.create({
      data: {
        agencyId,
        clientId: clientId ?? null,
        verticalId: verticalId ?? null,
        scope,
        type,
        label,
        frequency,
        config: config as object,
        nextRunAt: computeNextRunAt(frequency),
      },
    })
    return reply.code(201).send({ data: task })
  })

  // ── PATCH /api/v1/scheduled-tasks/:id ────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })

    const { label, frequency, config, enabled, clientId, verticalId } = parsed.data
    const updateData: Record<string, unknown> = {}
    if (label !== undefined) updateData.label = label
    if (frequency !== undefined) {
      updateData.frequency = frequency
      updateData.nextRunAt = computeNextRunAt(frequency)
    }
    if (config !== undefined) updateData.config = config
    if (enabled !== undefined) updateData.enabled = enabled
    if (clientId !== undefined) updateData.clientId = clientId
    if (verticalId !== undefined) {
      updateData.verticalId = verticalId ?? null
      // Scope follows vertical selection: vertical set → 'vertical', cleared → 'client'
      updateData.scope = verticalId ? 'vertical' : 'client'
    }

    const task = await prisma.scheduledTask.update({
      where: { id },
      data: updateData,
    })
    return reply.send({ data: task })
  })

  // ── DELETE /api/v1/scheduled-tasks/:id ───────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })
    await prisma.scheduledTask.delete({ where: { id } })
    return reply.code(204).send()
  })

  // ── POST /api/v1/scheduled-tasks/:id/run-now ─────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/run-now', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const task = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    if (task.lastStatus === 'running') return reply.code(409).send({ error: 'Task already running' })

    const queue = getScheduledResearchQueue()
    await queue.add(
      'run-research',
      { taskId: id, agencyId } satisfies ScheduledResearchJobData,
      { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
    )

    return reply.send({ data: { queued: true } })
  })

  // ── GET /api/v1/scheduled-tasks/:id/output ───────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/output', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const task = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!task) return reply.code(404).send({ error: 'Task not found' })

    const label = `[Scheduled] ${task.label}`

    // All scopes now write to clientBrainAttachment (vertical-scoped entries have verticalId set)
    if (task.clientId) {
      const att = await prisma.clientBrainAttachment.findFirst({
        where: {
          agencyId,
          clientId: task.clientId,
          source: 'scheduled',
          filename: label,
          ...(task.verticalId ? { verticalId: task.verticalId } : {}),
        },
        select: { extractedText: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send({ data: { text: att?.extractedText ?? null, updatedAt: att?.createdAt ?? null } })
    }
    return reply.send({ data: { text: null, updatedAt: null } })
  })

  // ── POST /api/v1/scheduled-tasks/seed-defaults ───────────────────────────
  app.post('/seed-defaults', async (req, reply) => {
    const { agencyId } = req.auth
    const clientsSeeded = await seedDefaultTasksForAllClients(agencyId)
    return reply.send({ data: { clientsSeeded } })
  })

  // ── POST /api/v1/scheduled-tasks/:id/dismiss ─────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/dismiss', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })
    await prisma.scheduledTask.update({
      where: { id },
      data: { changeDetected: false },
    })
    return reply.send({ data: { dismissed: true } })
  })
}
