import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '@contentnode/database'
import { auditService } from '../services/audit.js'
import { getWorkflowRunsQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createRunBody = z.object({
  workflowId: z.string().min(1),
  input: z.record(z.unknown()).optional().default({}),
})

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function runRoutes(app: FastifyInstance) {
  // ── POST / — trigger a workflow run ───────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createRunBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const { workflowId, input } = parsed.data
    const { agencyId, userId } = req.auth

    // Validate workflow belongs to this agency
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, agencyId },
    })

    if (!workflow) {
      return reply.code(404).send({ error: 'Workflow not found' })
    }

    if (workflow.status === 'archived') {
      return reply.code(422).send({ error: 'Cannot run an archived workflow' })
    }

    // Create the run record with status 'pending'
    const run = await prisma.workflowRun.create({
      data: {
        workflowId,
        agencyId,
        triggeredBy: userId,
        status: 'pending',
        input: input as Prisma.InputJsonValue,
        output: { nodeStatuses: {} } as Prisma.InputJsonValue,
      },
    })

    // Enqueue the job — worker picks it up asynchronously
    const queue = getWorkflowRunsQueue()
    await queue.add(
      'run-workflow',
      { workflowRunId: run.id, agencyId },
      { jobId: run.id } // deduplicate by run id
    )

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'workflow.run.created',
      resourceType: 'WorkflowRun',
      resourceId: run.id,
      metadata: { workflowId },
    })

    return reply.code(202).send({
      data: {
        runId: run.id,
        status: run.status,
        workflowId,
      },
    })
  })

  // ── GET /:id — poll run status ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
      include: {
        workflow: {
          select: { id: true, name: true, connectivityMode: true },
        },
      },
    })

    if (!run) {
      return reply.code(404).send({ error: 'Run not found' })
    }

    // The output JSON carries per-node statuses and final output
    const output = run.output as {
      nodeStatuses?: Record<string, unknown>
      finalOutput?: unknown
    }

    return reply.send({
      data: {
        id: run.id,
        status: run.status,
        workflowId: run.workflowId,
        workflow: run.workflow,
        triggeredBy: run.triggeredBy,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
        nodeStatuses: output.nodeStatuses ?? {},
        finalOutput: output.finalOutput ?? null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
    })
  })

  // ── GET / — list runs for the agency ─────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const query = req.query as { workflowId?: string; limit?: string; offset?: string }

    const runs = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(query.limit ?? '20', 10), 100),
      skip: parseInt(query.offset ?? '0', 10),
      select: {
        id: true,
        workflowId: true,
        status: true,
        triggeredBy: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        createdAt: true,
      },
    })

    return reply.send({ data: runs, meta: { count: runs.length } })
  })

  // ── POST /:id/cancel — request cancellation ───────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/cancel', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id } = req.params

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
    })

    if (!run) {
      return reply.code(404).send({ error: 'Run not found' })
    }

    const cancellable = ['pending', 'running']
    if (!cancellable.includes(run.status)) {
      return reply.code(422).send({
        error: `Cannot cancel a run with status "${run.status}"`,
      })
    }

    await prisma.workflowRun.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'workflow.run.cancelled',
      resourceType: 'WorkflowRun',
      resourceId: id,
    })

    return reply.code(202).send({ data: { id, status: 'cancelled' } })
  })
}
