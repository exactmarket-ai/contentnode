import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, auditService } from '@contentnode/database'
import { getPatternDetectionQueue } from '../lib/queues.js'

// MEDIUM #7: Zod schema for POST /api/v1/feedback body validation
const specificChangeSchema = z.object({
  text:        z.string(),
  instruction: z.string(),
  startOffset: z.number().optional(),
  endOffset:   z.number().optional(),
})

const createFeedbackSchema = z.object({
  workflowRunId:    z.string().optional(),
  documentId:       z.string().optional(),
  stakeholderId:    z.string().optional(),
  decision:         z.enum(['approved', 'approved_with_changes', 'needs_revision', 'rejected']).optional(),
  comment:          z.string().optional(),
  starRating:       z.number().int().min(1).max(5).optional(),
  toneFeedback:     z.enum(['too_formal', 'too_casual', 'just_right', 'too_generic']).optional(),
  contentTags:      z.array(z.string()).default([]),
  specificChanges:  z.array(specificChangeSchema).default([]),
  outputDecisions:  z.record(z.object({ decision: z.string(), comment: z.string().optional() })).default({}),
})

export async function feedbackRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowRunId, stakeholderId, clientId } = req.query as Record<string, string>

    // HIGH #4: Verify clientId belongs to the requesting agency before using it as a filter
    if (clientId) {
      const clientRecord = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
      if (!clientRecord) {
        return reply.code(403).send({ error: 'clientId does not belong to this agency' })
      }
    }

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
        workflowRun: { select: { id: true, workflowId: true, workflow: { select: { name: true, client: { select: { id: true, name: true } } } } } },
      },
    })

    if (!data) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ data })
  })

  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth

    // MEDIUM #7: Validate request body with Zod instead of type assertion
    const parsed = createFeedbackSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }
    const body = parsed.data

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
        contentTags: body.contentTags as string[],
        specificChanges: body.specificChanges as object[],
        outputDecisions: body.outputDecisions as object,
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

    // Update run reviewStatus to 'pending' if it's still 'none' (agency just reviewed)
    if (body.workflowRunId) {
      const run = await prisma.workflowRun.findFirst({ where: { id: body.workflowRunId, agencyId }, select: { reviewStatus: true } })
      if (run?.reviewStatus === 'none') {
        await prisma.workflowRun.update({ where: { id: body.workflowRunId }, data: { reviewStatus: 'pending' } })
      }
    }

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
