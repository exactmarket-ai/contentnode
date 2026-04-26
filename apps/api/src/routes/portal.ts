import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { verifyToken } from '@clerk/backend'
import { prisma, withAgency, auditService, agencyStorage } from '@contentnode/database'
import { getWorkflowRunsQueue, getPatternDetectionQueue, getBrandAttachmentProcessQueue } from '../lib/queues.js'

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? ''
const DEV_MODE = !CLERK_SECRET_KEY || CLERK_SECRET_KEY === 'sk_test_...'

// ─────────────────────────────────────────────────────────────────────────────
// Client Portal Routes — /portal/*
//
// Authenticated via magic link token, NOT Clerk. The agency auth preHandler
// explicitly skips /portal/* routes (see plugins/auth.ts).
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_TTL_DAYS = 30

/** Resolve a DeliverableAccess token.
 *  Returns { access, stakeholder, run } or null.
 *  Also seeds agencyStorage for subsequent Prisma queries. */
async function resolveAccessToken(token: string) {
  if (!token) return null
  const access = await prisma.deliverableAccess.findUnique({
    where: { token },
    include: {
      stakeholder: { include: { client: true } },
      run: { include: { workflow: { select: { id: true, name: true, clientId: true } } } },
    },
  })
  if (!access) return null
  if (access.revokedAt) return null
  if (access.expiresAt && access.expiresAt < new Date()) return null
  agencyStorage.enterWith({ agencyId: access.agencyId })
  return access
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
  // CRITICAL #1: This endpoint requires a valid Clerk JWT even though it lives under
  // /portal/* (which skips the global preHandler). We verify it manually here.
  app.post<{ Body: { stakeholderId: string; runId: string } }>('/auth/send-link', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    // ── Manual Clerk JWT check ─────────────────────────────────────────────
    let agencyId: string
    let grantedBy: string | undefined
    if (DEV_MODE) {
      agencyId  = process.env.DEFAULT_AGENCY_ID ?? 'dev-agency'
      grantedBy = 'dev-user'
    } else {
      const authHeader = req.headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing or malformed Authorization header' })
      }
      const jwtToken = authHeader.slice(7)
      let payload: Awaited<ReturnType<typeof verifyToken>>
      try {
        payload = await verifyToken(jwtToken, { secretKey: CLERK_SECRET_KEY })
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired token' })
      }
      const claims = payload as Record<string, unknown>
      const meta = ((payload as Record<string, unknown>)['publicMetadata'] ?? {}) as Record<string, unknown>
      const resolvedAgencyId = (claims['agency_id'] ?? meta['agency_id'] ?? process.env.DEFAULT_AGENCY_ID) as string | undefined
      if (!resolvedAgencyId) {
        return reply.code(403).send({ error: 'Token is missing agency_id claim' })
      }
      agencyId  = resolvedAgencyId
      grantedBy = payload.sub
    }

    const { stakeholderId, runId } = req.body ?? {}
    if (!stakeholderId || !runId) {
      return reply.code(400).send({ error: 'stakeholderId and runId are required' })
    }

    const [stakeholder, run] = await Promise.all([
      prisma.stakeholder.findFirst({ where: { id: stakeholderId, agencyId } }),
      prisma.workflowRun.findFirst({ where: { id: runId, agencyId } }),
    ])
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    const token     = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

    // Upsert: revive a previously revoked grant or create a new one
    const access = await prisma.deliverableAccess.upsert({
      where: { runId_stakeholderId: { runId, stakeholderId } },
      update: { token, expiresAt, revokedAt: null, grantedBy: grantedBy ?? null },
      create: { agencyId, runId, stakeholderId, token, expiresAt, grantedBy: grantedBy ?? null },
    })

    const portalUrl = `${process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'}/portal?token=${access.token}`

    return reply.send({
      data: {
        token: access.token,
        portalUrl,
        expiresAt,
        stakeholder: { id: stakeholder.id, name: stakeholder.name, email: stakeholder.email },
      },
    })
  })

  // ── GET /portal/auth/verify ─────────────────────────────────────────────
  app.get('/auth/verify', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const token  = extractToken(req as Parameters<typeof extractToken>[0])
    const access = await resolveAccessToken(token)

    if (!access) return reply.code(401).send({ error: 'Invalid, expired, or revoked access link' })

    const { stakeholder } = access
    return reply.send({
      data: {
        stakeholder: {
          id:       stakeholder.id,
          name:     stakeholder.name,
          email:    stakeholder.email,
          role:     stakeholder.role,
          clientId: stakeholder.clientId,
          client: {
            id:   stakeholder.client.id,
            name: stakeholder.client.name,
            slug: stakeholder.client.slug,
          },
        },
        // Include the specific run this token grants access to
        runId: access.runId,
      },
    })
  })

  // ── GET /portal/deliverables ────────────────────────────────────────────
  // Returns only the specific run this token grants access to.
  app.get('/deliverables', async (req, reply) => {
    const token  = extractToken(req as Parameters<typeof extractToken>[0])
    const access = await resolveAccessToken(token)
    if (!access) return reply.code(401).send({ error: 'Invalid, expired, or revoked access link' })

    const run    = access.run
    const output = run.output as Record<string, unknown>

    return reply.send({
      data: [{
        id:           run.id,
        workflowId:   run.workflowId,
        workflowName: access.run.workflow.name,
        status:       run.status,
        finalOutput:  (output.finalOutput as unknown) ?? null,
        createdAt:    run.createdAt,
        completedAt:  run.completedAt,
      }],
    })
  })

  // ── GET /portal/deliverables/:id ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/deliverables/:id', async (req, reply) => {
    const token  = extractToken(req as Parameters<typeof extractToken>[0])
    const access = await resolveAccessToken(token)
    if (!access) return reply.code(401).send({ error: 'Invalid, expired, or revoked access link' })

    const stakeholder = access.stakeholder
    const { id } = req.params

    // Token must grant access to this specific run
    if (access.runId !== id) return reply.code(403).send({ error: 'Access not granted for this deliverable' })

    const run = await withAgency(stakeholder.agencyId, () =>
      prisma.workflowRun.findFirst({
        where: {
          id,
          workflow: { clientId: stakeholder.clientId },
        },
        include: {
          workflow: { select: { id: true, name: true, nodes: { select: { id: true, label: true, type: true } } } },
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
        workflowNodes: (run as unknown as { workflow: { nodes: unknown[] } }).workflow.nodes ?? [],
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
    const token  = extractToken(req as Parameters<typeof extractToken>[0])
    const access = await resolveAccessToken(token)
    if (!access) return reply.code(401).send({ error: 'Invalid, expired, or revoked access link' })

    const stakeholder = access.stakeholder
    if (access.runId !== req.params.id) return reply.code(403).send({ error: 'Access not granted for this deliverable' })

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

    // Update run reviewStatus to client_responded (non-blocking)
    withAgency(stakeholder.agencyId, () =>
      prisma.workflowRun.update({
        where: { id: runId },
        data: { reviewStatus: 'client_responded' },
      })
    ).catch(() => { /* non-critical */ })

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

    // Update quality record with stakeholder rating (non-blocking)
    if (feedback.starRating !== null || feedback.decision) {
      prisma.contentQualityRecord.findUnique({ where: { runId } })
        .then((qr) => {
          if (!qr) return
          const count = qr.feedbackCount
          const prevRating = qr.stakeholderRating as number | null
          const newRating = feedback.starRating !== null
            ? prevRating !== null
              ? (prevRating * count + feedback.starRating) / (count + 1)
              : feedback.starRating
            : prevRating
          return prisma.contentQualityRecord.update({
            where: { runId },
            data: {
              stakeholderRating: newRating,
              feedbackDecision: feedback.decision ?? qr.feedbackDecision,
              feedbackCount: { increment: 1 },
            },
          })
        })
        .catch(() => { /* non-critical */ })
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

    // ── Auto-ingest feedback into brand brain (non-blocking) ──────────────
    // Every piece of feedback makes the brain smarter — corrections, tone
    // guidance, and approved examples all feed back as brain entries.
    if (clientId) {
      ;(async () => {
        try {
          const agencyId = stakeholder.agencyId
          const date = new Date().toISOString().slice(0, 10)

          // Build a structured text entry from the feedback
          const lines: string[] = [
            `Stakeholder Feedback — ${date}`,
            `Decision: ${decision}`,
          ]
          if (starRating) lines.push(`Rating: ${starRating}/5`)
          if (toneFeedback) lines.push(`Tone: ${toneFeedback.replace(/_/g, ' ')}`)
          if (contentTags?.length) lines.push(`Tags: ${contentTags.join(', ')}`)
          if (comment) lines.push(`\nComment: ${comment}`)
          if (specificChanges?.length) {
            lines.push('\nRequested changes:')
            for (const c of specificChanges) {
              lines.push(`• Original: "${c.text}"`)
              lines.push(`  Instruction: "${c.instruction}"`)
            }
          }

          const feedbackText = lines.join('\n')
          const hasContent = comment || (specificChanges?.length ?? 0) > 0 || toneFeedback

          if (hasContent) {
            const fbAttachment = await prisma.clientBrandAttachment.create({
              data: {
                agencyId, clientId,
                verticalId: null, // feedback goes into General brain — applies across verticals
                filename: `feedback-${date}-${feedback.id.slice(-6)}.txt`,
                storageKey: `synthetic/feedback/${agencyId}/${clientId}/${feedback.id}`,
                mimeType: 'text/plain',
                sizeBytes: Buffer.byteLength(feedbackText, 'utf8'),
                extractionStatus: 'ready',
                extractedText: feedbackText,
                summaryStatus: 'pending',
              },
            })
            await getBrandAttachmentProcessQueue().add('process', {
              agencyId, attachmentId: fbAttachment.id, clientId, verticalId: null,
            }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
          }

          // If approved, add the run output as a reference example
          if ((decision === 'approved' || decision === 'approved_with_changes') && run.output) {
            const output = run.output as Record<string, unknown>
            const nodeStatuses = output.nodeStatuses as Record<string, { output?: unknown }> | undefined
            const outputTexts = nodeStatuses
              ? Object.values(nodeStatuses)
                  .map((n) => (typeof n?.output === 'string' ? n.output : null))
                  .filter(Boolean)
              : []
            const approvedText = outputTexts[outputTexts.length - 1] // last output node
            if (approvedText) {
              const approvedEntry = [
                `Approved Content Example — ${date}`,
                `Decision: ${decision}${starRating ? ` (${starRating}/5 stars)` : ''}`,
                '',
                approvedText,
              ].join('\n')

              const approvedAttachment = await prisma.clientBrandAttachment.create({
                data: {
                  agencyId, clientId,
                  verticalId: null,
                  filename: `approved-example-${date}-${runId.slice(-6)}.txt`,
                  storageKey: `synthetic/approved/${agencyId}/${clientId}/${runId}`,
                  mimeType: 'text/plain',
                  sizeBytes: Buffer.byteLength(approvedEntry, 'utf8'),
                  extractionStatus: 'ready',
                  extractedText: approvedEntry,
                  summaryStatus: 'pending',
                },
              })
              await getBrandAttachmentProcessQueue().add('process', {
                agencyId, attachmentId: approvedAttachment.id, clientId, verticalId: null,
              }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
            }
          }
        } catch (err) {
          console.error('[portal] brain ingestion failed:', err)
        }
      })()
    }

    return reply.code(201).send({ data: { feedbackId: feedback.id } })
  })

  // ── GET /portal/feedback ────────────────────────────────────────────────
  app.get('/feedback', async (req, reply) => {
    const token  = extractToken(req as Parameters<typeof extractToken>[0])
    const access = await resolveAccessToken(token)
    if (!access) return reply.code(401).send({ error: 'Invalid, expired, or revoked access link' })

    const stakeholder = access.stakeholder

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
