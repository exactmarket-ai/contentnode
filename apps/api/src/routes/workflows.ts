import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma, auditService } from '@contentnode/database'
import { getWorkflowRunsQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createWorkflowBody = z.object({
  name: z.string().min(1).max(200),
  clientId: z.string().min(1),
  description: z.string().optional(),
  connectivityMode: z.enum(['online', 'offline']).default('online'),
  defaultModelConfig: z.record(z.unknown()).optional(),
})

const updateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  clientId: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function workflowRoutes(app: FastifyInstance) {
  // ── GET / — list workflows ────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, status } = req.query as Record<string, string>

    const workflows = await prisma.workflow.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        client: { select: { id: true, name: true, slug: true } },
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return reply.send({ data: workflows, meta: { total: workflows.length } })
  })

  // ── GET /:id — single workflow with nodes + edges ─────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        client: { select: { id: true, name: true, slug: true } },
        nodes: { orderBy: { createdAt: 'asc' } },
        edges: { orderBy: { createdAt: 'asc' } },
        _count: { select: { runs: true } },
      },
    })

    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
    return reply.send({ data: workflow })
  })

  // ── POST / — create workflow ──────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createWorkflowBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { agencyId, userId } = req.auth
    const { name, clientId, description, connectivityMode } = parsed.data

    // Validate client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const workflow = await prisma.workflow.create({
      data: {
        agencyId,
        clientId,
        name,
        description: description ?? null,
        connectivityMode,
        status: 'draft',
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'workflow.created',
      resourceType: 'Workflow',
      resourceId: workflow.id,
      metadata: { name, clientId },
    })

    return reply.code(201).send({ data: workflow })
  })

  // ── PATCH /:id — update workflow ──────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = updateWorkflowBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const existing = await prisma.workflow.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Workflow not found' })

    // Validate new clientId if provided
    if (parsed.data.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: parsed.data.clientId, agencyId },
      })
      if (!client) return reply.code(404).send({ error: 'Client not found' })
    }

    const workflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.clientId ? { clientId: parsed.data.clientId } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
      include: {
        client: { select: { id: true, name: true, slug: true } },
      },
    })

    return reply.send({ data: workflow })
  })

  // ── DELETE /:id — delete workflow ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.workflow.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Workflow not found' })

    await prisma.workflow.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── POST /:id/run — trigger a workflow run ────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id: workflowId } = req.params

    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, agencyId } })
    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })
    if (workflow.status === 'archived') {
      return reply.code(422).send({ error: 'Cannot run an archived workflow' })
    }

    const run = await prisma.workflowRun.create({
      data: {
        workflowId,
        agencyId,
        triggeredBy: userId,
        status: 'pending',
        input: {} as Prisma.InputJsonValue,
        output: { nodeStatuses: {} } as Prisma.InputJsonValue,
      },
    })

    const queue = getWorkflowRunsQueue()
    await queue.add('run-workflow', { workflowRunId: run.id, agencyId }, { jobId: run.id })

    return reply.code(202).send({ data: { runId: run.id, status: run.status, workflowId } })
  })
}
