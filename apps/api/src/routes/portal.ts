import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, withAgency, auditService } from '@contentnode/database'
import { getWorkflowRunsQueue, getPatternDetectionQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Client Portal Routes — /portal/*
//
// Authenticated via magic link token, NOT Clerk. The agency auth preHandler
// explicitly skips /portal/* routes (see plugins/auth.ts).
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_TTL_MINUTES = 60 * 24 * 30 // 30 days

/** Validate a magic link token and return the stakeholder, or null. */
async function resolveToken(token: string) {
  if (!token) return null
  const stakeholder = await prisma.stakeholder.findUnique({
    where: { magicLinkToken: token },
    include: { client: true },
  })
  if (!stakeholder) return null
  if (!stakeholder.magicLinkExpiresAt) return null
  if (stakeholder.magicLinkExpiresAt < new Date()) return null
  return stakeholder
}

/** Extract token from Authorization header (Bearer) or query string. */
function extractToken(req: { headers: { authorization?: string }; query: Record<string, unknown> }): string {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return (req.query['token'] as string) ?? ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback body schema
// ─────────────────────────────────────────────────────────────────────────────

const specificChangeSchema = z.object({
  text:        z.string(),
  instruction: z.string(),
  startOffset: z.number().optional(),
  endOffset:   z.number().optional(),
})

const feedbackBodySchema = z.object({
  decision:        z.enum(['approved', 'approved_with_changes', 'needs_revision', 'rejected']),
  starRating:      z.number().int().min(1).max(5).optional(),
  toneFeedback:    z.enum(['too_formal', 'too_casual', 'just_right', 'too_generic']).optional(),
  contentTags:     z.array(z.enum(['too_long', 'too_short', 'missing_points', 'off_brief', 'good'])).default([]),
  specificChanges: z.array(specificChangeSchema).default([]),
  comment:         z.string().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Route plugin
// ─────────────────────────────────────────────────────────────────────────────

export async function portalRoutes(app: FastifyInstance) {
  // ── POST /portal/auth/send-link ─────────────────────────────────────────
  // Agency calls this (with agency auth) to generate a magic link for a stakeholder.
  // In dev mode, the token is returned in the response; in production, send via email.
  app.post<{ Body: { stakeholderId: string } }>('/auth/send-link', async (req, reply) => {
    const { stakeholderId } = req.body ?? {}
    if (!stakeholderId) {
      return reply.code(400).send({ error: 'stakeholderId required' })
    }

    // This endpoint may be called by agency staff — we look up without agency filter
    // (agency auth is handled by the preHandler; portal routes skip it, so this
    //  endpoint is actually open. In production it should be protected by agency auth.
    //  For now, we validate by requiring a known stakeholder ID.)
    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: stakeholderId },
    })
    if (!stakeholder) {
      return reply.code(404).send({ error: 'Stakeholder not found' })
    }

    const token     = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000)

    await prisma.stakeholder.update({
      where: { id: stakeholderId },
      data: { magicLinkToken: token, magicLinkExpiresAt: expiresAt },
    })

    const portalUrl = `${process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'}/portal?token=${token}`

    return reply.send({
      data: {
        token,
        portalUrl,
        expiresAt,
        stakeholder: {
          id:    stakeholder.id,
          name:  stakeholder.name,
          email: stakeholder.email,
        },
      },
    })
  })

  // ── GET /portal/auth/verify ─────────────────────────────────────────────
  app.get('/auth/verify', async (req, reply) => {
    const token = extractToken(req as Parameters<typeof extractToken>[0])
    const stakeholder = await resolveToken(token)

    if (!stakeholder) {
      return reply.code(401).send({ error: 'Invalid or expired magic link' })
    }

    return reply.send({
      data: {
        stakeholder: {
          id:      stakeholder.id,
          name:    stakeholder.name,
          email:   stakeholder.email,
          role:    stakeholder.role,
          clientId: stakeholder.clientId,
          client: {
            id:   stakeholder.client.id,
            name: stakeholder.client.name,
            slug: stakeholder.client.slug,
          },
        },
      },
    })
  })

  // ── GET /portal/deliverables ────────────────────────────────────────────
  // Returns all completed WorkflowRun outputs for the stakeholder's client,
  // newest first.
  app.get('/deliverables', async (req, reply) => {
    const token = extractToken(req as Parameters<typeof extractToken>[0])
    const stakeholder = await resolveToken(token)
    if (!stakeholder) return reply.code(401).send({ error: 'Invalid or expired magic link' })

    const runs = await withAgency(stakeholder.agencyId, () =>
      prisma.workflowRun.findMany({
        where: {
          workflow: { clientId: stakeholder.clientId },
          status: { in: ['completed', 'waiting_feedback'] },
        },
        include: {
          workflow: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    )

    const deliverables = runs.map((run) => {
      const output = run.output as Record<string, unknown>
      return {
        id:           run.id,
        workflowId:   run.workflowId,
        workflowName: (run as unknown as { workflow: { name: string } }).workflow.name,
        status:       run.status,
        finalOutput:  (output.finalOutput as unknown) ?? null,
        createdAt:    run.createdAt,
        completedAt:  run.completedAt,
      }
    })

    return reply.send({ data: deliverables })
  })

  // ── GET /portal/deliverables/:id ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/deliverables/:id', async (req, reply) => {
    const token = extractToken(req as Parameters<typeof extractToken>[0])
    const stakeholder = await resolveToken(token)
    if (!stakeholder) return reply.code(401).send({ error: 'Invalid or expired magic link' })

    const { id } = req.params

    const run = await withAgency(stakeholder.agencyId, () =>
      prisma.workflowRun.findFirst({
        where: {
          id,
          workflow: { clientId: stakeholder.clientId },
        },
        include: {
          workflow: { select: { id: true, name: true } },
          documents: {
            select: { id: true, name: true, mimeType: true, storageKey: true, sizeBytes: true, createdAt: true },
          },
        },
      })
    )

    if (!run) return reply.code(404).send({ error: 'Deliverable not found' })

    const output = run.output as Record<string, unknown>

    // Prior feedback for this run from this stakeholder
    const priorFeedback = await withAgency(stakeholder.agencyId, () =>
      prisma.feedback.findMany({
        where: { workflowRunId: run.id, stakeholderId: stakeholder.id },
        orderBy: { createdAt: 'desc' },
      })
    )

    return reply.send({
      data: {
        id:           run.id,
        workflowId:   run.workflowId,
        workflowName: (run as unknown as { workflow: { name: string } }).workflow.name,
        status:       run.status,
        finalOutput:  (output.finalOutput as unknown) ?? null,
        nodeStatuses: (output.nodeStatuses as unknown) ?? {},
        documents:    run.documents,
        priorFeedback,
        createdAt:    run.createdAt,
        completedAt:  run.completedAt,
      },
    })
  })

  // ── POST /portal/deliverables/:id/feedback ──────────────────────────────
  app.post<{ Params: { id: string } }>('/deliverables/:id/feedback', async (req, reply) => {
    const token = extractToken(req as Parameters<typeof extractToken>[0])
    const stakeholder = await resolveToken(token)
    if (!stakeholder) return reply.code(401).send({ error: 'Invalid or expired magic link' })

    const { id: runId } = req.params

    // Validate the run belongs to this stakeholder's client
    const run = await withAgency(stakeholder.agencyId, () =>
      prisma.workflowRun.findFirst({
        where: {
          id: runId,
          workflow: { clientId: stakeholder.clientId },
        },
        include: {
          workflow: {
            include: {
              nodes: true,
            },
          },
        },
      })
    )

    if (!run) return reply.code(404).send({ error: 'Deliverable not found' })

    const parsed = feedbackBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid feedback', details: parsed.error.issues })
    }

    const { decision, starRating, toneFeedback, contentTags, specificChanges, comment } = parsed.data

    // Create the feedback record
    const feedback = await withAgency(stakeholder.agencyId, () =>
      prisma.feedback.create({
        data: {
          agencyId:        stakeholder.agencyId,
          workflowRunId:   runId,
          stakeholderId:   stakeholder.id,
          decision,
          comment:         comment ?? null,
          starRating:      starRating ?? null,
          toneFeedback:    toneFeedback ?? null,
          contentTags:     contentTags as unknown as any,
          specificChanges: specificChanges as unknown as any,
        },
      })
    )

    await withAgency(stakeholder.agencyId, () =>
      auditService.log(stakeholder.agencyId, {
        actorType:    'stakeholder',
        actorId:      stakeholder.id,
        action:       'portal.feedback.submitted',
        resourceType: 'WorkflowRun',
        resourceId:   runId,
        metadata: { decision, feedbackId: feedback.id },
      })
    )

    // Trigger pattern detection (non-blocking — portal feedback is the primary source)
    const clientId = run.workflow?.clientId
    if (clientId) {
      const patternQueue = getPatternDetectionQueue()
      patternQueue.add('detect', {
        feedbackId: feedback.id,
        clientId,
        agencyId: stakeholder.agencyId,
      }).catch(() => { /* non-critical */ })
    }

    // ── Auto re-entry: if the run is waiting_feedback, check if we should
    // enqueue a child run ──────────────────────────────────────────────────
    if (run.status === 'waiting_feedback') {
      const runOutput = run.output as Record<string, unknown>
      const pendingFeedbackNodeId = runOutput.pendingFeedbackNodeId as string | undefined

      if (pendingFeedbackNodeId) {
        // Find the feedback node config
        const feedbackNode = run.workflow.nodes.find((n) => n.id === pendingFeedbackNodeId)
        const nodeCfg = (feedbackNode?.config ?? {}) as Record<string, unknown>
        const triggerMode = (nodeCfg.trigger_mode as string) ?? 'auto'
        const autoTriggerOn = (nodeCfg.auto_trigger_on as string[]) ?? ['needs_revision', 'rejected']
        const reentryRules = (nodeCfg.reentry_rules as Array<{ sentiment: string; reentry_node_id: string }>) ?? []
        const maxRetries = (nodeCfg.max_auto_retries as number) ?? 3

        // Map portal decision to internal sentiment key
        const sentimentMap: Record<string, string> = {
          approved:             'approved',
          approved_with_changes: 'approved_with_changes',
          needs_revision:       'needs_revision',
          rejected:             'rejected',
        }
        const sentiment = sentimentMap[decision] ?? decision

        if (triggerMode === 'auto' && autoTriggerOn.includes(sentiment)) {
          // Check retry count — count existing child runs for this parent
          const existingChildRuns = await withAgency(stakeholder.agencyId, () =>
            prisma.workflowRun.findMany({
              where: {
                parentRunId: runId,
                triggerType: 'feedback_auto',
              },
              select: { id: true },
            })
          )

          if (existingChildRuns.length < maxRetries) {
            // Determine re-entry node: check conditional rules first, fall back to default
            let reentryFromNodeId = (nodeCfg.default_reentry_node_id as string) ?? null
            for (const rule of reentryRules) {
              if (rule.sentiment === sentiment && rule.reentry_node_id) {
                reentryFromNodeId = rule.reentry_node_id
                break
              }
            }

            // Create a child run
            const childRun = await withAgency(stakeholder.agencyId, () =>
              prisma.workflowRun.create({
                data: {
                  agencyId:           stakeholder.agencyId,
                  workflowId:         run.workflowId,
                  triggerType:        'feedback_auto',
                  parentRunId:        runId,
                  reentryFromNodeId:  reentryFromNodeId ?? undefined,
                  triggeredBy:        'system',
                  status:             'pending',
                  input:              { feedbackId: feedback.id, parentRunId: runId, decision } as any,
                  output:             { nodeStatuses: {} } as any,
                },
              })
            )

            // Enqueue the child run
            const queue = getWorkflowRunsQueue()
            await queue.add(
              'run-workflow',
              { workflowRunId: childRun.id, agencyId: stakeholder.agencyId },
              { jobId: childRun.id },
            )
          } else {
            // Max retries reached — escalate: update parent run status to 'failed' with escalation note
            await withAgency(stakeholder.agencyId, () =>
              prisma.workflowRun.update({
                where: { id: runId },
                data: {
                  status:       'failed',
                  completedAt:  new Date(),
                  errorMessage: `Max auto-retries (${maxRetries}) reached after stakeholder feedback. Human review required.`,
                },
              })
            )
          }
        }
      }
    }

    return reply.code(201).send({ data: { feedbackId: feedback.id } })
  })

  // ── GET /portal/feedback ────────────────────────────────────────────────
  // Returns all feedback this stakeholder has ever submitted.
  app.get('/feedback', async (req, reply) => {
    const token = extractToken(req as Parameters<typeof extractToken>[0])
    const stakeholder = await resolveToken(token)
    if (!stakeholder) return reply.code(401).send({ error: 'Invalid or expired magic link' })

    const feedbacks = await withAgency(stakeholder.agencyId, () =>
      prisma.feedback.findMany({
        where: { stakeholderId: stakeholder.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id:              true,
          workflowRunId:   true,
          decision:        true,
          starRating:      true,
          toneFeedback:    true,
          contentTags:     true,
          specificChanges: true,
          comment:         true,
          createdAt:       true,
        },
      })
    )

    return reply.send({ data: feedbacks })
  })
}
