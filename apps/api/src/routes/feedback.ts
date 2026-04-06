import type { FastifyInstance } from 'fastify'
import { prisma, auditService } from '@contentnode/database'
import { getPatternDetectionQueue } from '../lib/queues.js'

export async function feedbackRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowRunId, stakeholderId, clientId } = req.query as Record<string, string>

    const data = await prisma.feedback.findMany({
      where: {
        agencyId,
        ...(workflowRunId ? { workflowRunId } : {}),
        ...(stakeholderId ? { stakeholderId } : {}),
        ...(clientId ? { workflowRun: { workflow: { clientId } } } : {}),
      },
      include: {
        stakeholder: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data, meta: { total: data.length } })
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const data = await prisma.feedback.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        stakeholder: { select: { id: true, name: true, role: true } },
        workflowRun: { select: { id: true, workflowId: true } },
      },
    })

    if (!data) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ data })
  })

  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const body = req.body as {
      workflowRunId?: string
      documentId?: string
      stakeholderId: string
      decision?: string
      comment?: string
      starRating?: number
      toneFeedback?: string
      contentTags?: string[]
      specificChanges?: object[]
    }

    const feedback = await prisma.feedback.create({
      data: {
        agencyId,
        workflowRunId: body.workflowRunId,
        documentId: body.documentId,
        stakeholderId: body.stakeholderId,
        decision: body.decision,
        comment: body.comment,
        starRating: body.starRating,
        toneFeedback: body.toneFeedback,
        contentTags: (body.contentTags ?? []) as string[],
        specificChanges: (body.specificChanges ?? []) as object[],
      },
      include: {
        workflowRun: {
          select: {
            workflowId: true,
            workflow: { select: { clientId: true } },
          },
        },
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      action: 'feedback.created',
      resourceType: 'Feedback',
      resourceId: feedback.id,
      metadata: { workflowRunId: body.workflowRunId, decision: body.decision },
    })

    // Trigger pattern detection asynchronously
    const clientId = (feedback.workflowRun as { workflow?: { clientId?: string } } | null)
      ?.workflow?.clientId
    if (clientId) {
      const queue = getPatternDetectionQueue()
      await queue.add('detect', { feedbackId: feedback.id, clientId, agencyId })
    }

    return reply.code(201).send({ data: feedback })
  })
}
