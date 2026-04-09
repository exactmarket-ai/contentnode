import { randomUUID } from 'node:crypto'
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '@contentnode/database'
import { auditService } from '../services/audit.js'
import { getWorkflowRunsQueue } from '../lib/queues.js'
import { sendReviewEmail } from '../lib/email.js'

const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'
const TOKEN_TTL_MINUTES = 60 * 24 * 30 // 30 days

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

// React Flow node shape sent from the frontend
const rfNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.record(z.unknown()).optional(),
})

const rfEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional().nullable(),
  sourceHandle: z.string().optional().nullable(),
})

const createRunBody = z.object({
  // Accept both camelCase (legacy) and snake_case (frontend); null means "create new"
  workflowId: z.string().nullable().optional(),
  workflow_id: z.string().nullable().optional(),
  // Inline graph from frontend canvas
  graph: z.object({
    nodes: z.array(rfNodeSchema),
    edges: z.array(rfEdgeSchema),
  }).optional(),
  model_config: z.record(z.unknown()).optional(),
  connectivity_mode: z.string().optional(),
  input: z.record(z.unknown()).optional().default({}),
})

// Default dev client used when no clientId is provided
const DEV_CLIENT_ID = process.env.DEV_CLIENT_ID ?? 'client_alpha'

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function runRoutes(app: FastifyInstance) {
  // ── POST / — trigger a workflow run ───────────────────────────────────────
  app.post('/', async (req, reply) => {
    req.log.info({ body: req.body }, '[runs] incoming body')
    const parsed = createRunBody.safeParse(req.body)
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, '[runs] validation failed')
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const body = parsed.data
    const { agencyId, userId } = req.auth

    // Resolve workflowId (accept both naming conventions; null/undefined = create new)
    let workflowId = body.workflowId ?? body.workflow_id ?? null
    if (!workflowId) workflowId = null

    // ── Upsert workflow + nodes + edges from inline graph ──────────────────
    if (body.graph) {
      const { nodes: rfNodes, edges: rfEdges } = body.graph
      const connectivityMode = body.connectivity_mode ?? 'online'

      if (workflowId) {
        // Workflow exists — update name/mode, replace nodes/edges
        const existing = await prisma.workflow.findFirst({
          where: { id: workflowId, agencyId },
          select: { id: true, firstRunAt: true, client: { select: { requireOffline: true } } },
        })

        if (!existing) {
          return reply.code(404).send({ error: 'Workflow not found' })
        }

        // Policy check before writing connectivity_mode
        if (existing.client?.requireOffline && connectivityMode !== 'offline') {
          return reply.code(422).send({ error: 'This client requires offline mode.' })
        }

        // Only allow connectivity_mode update before first run
        if (!existing.firstRunAt) {
          await prisma.workflow.update({
            where: { id: workflowId },
            data: { connectivityMode },
          })
        }
      } else {
        // No workflowId — create a new workflow record
        const wf = await prisma.workflow.create({
          data: {
            agencyId,
            clientId: DEV_CLIENT_ID,
            name: 'Untitled Workflow',
            connectivityMode,
            status: 'draft',
          },
        })
        workflowId = wf.id
      }

      // Replace all nodes for this workflow so DB stays in sync with the canvas.
      await prisma.node.deleteMany({ where: { workflowId: workflowId! } })
      if (rfNodes.length > 0) {
        // Resolve default model config from the request body
        const defaultModelCfg = (body.model_config ?? {}) as Record<string, unknown>

        await prisma.node.createMany({
          data: rfNodes.map((n) => {
            const data = (n.data ?? {}) as Record<string, unknown>

            // Config may be nested under data.config (new nodes / loaded with fix) OR
            // spread directly into data (legacy nodes saved before the nested-config format).
            // Prefer data.config when it exists (even with a single key), fall back to
            // the flat data fields for legacy nodes that have no data.config key at all.
            const nestedConfig = (data.config as Record<string, unknown>) ?? null
            const { label: _l, description: _d, icon: _i, config: _c, ...dataFields } = data
            const config = nestedConfig ?? dataFields

            // For logic nodes: resolve provider/model from node override → workflow default.
            // If connectivity_mode is offline, always force ollama regardless of node config.
            const nodeModelCfg = (config.model_config as Record<string, unknown> | null) ?? null
            const resolvedModelCfg = nodeModelCfg ?? defaultModelCfg
            const isOfflineRun = connectivityMode === 'offline'
            const resolvedProvider = (resolvedModelCfg.provider as string | undefined) ?? 'anthropic'
            const modelFields = n.type === 'logic' ? {
              provider: isOfflineRun ? 'ollama' : resolvedProvider,
              model: isOfflineRun
                ? (resolvedProvider === 'ollama' ? (resolvedModelCfg.model as string | undefined) ?? 'gemma3:12b' : 'gemma3:12b')
                : (resolvedModelCfg.model as string | undefined) ?? 'claude-sonnet-4-5',
              temperature: (resolvedModelCfg.temperature as number | undefined) ?? 0.7,
            } : {}

            return {
              id: n.id,
              agencyId,
              workflowId: workflowId!,
              type: n.type,
              label: (data.label as string | undefined) ?? n.type,
              config: { ...modelFields, subtype: data.subtype ?? config.subtype, ...config } as Prisma.InputJsonValue,
              positionX: n.position?.x ?? 0,
              positionY: n.position?.y ?? 0,
            }
          }),
        })
      }

      // Replace edges — filter out any edges that reference nodes not in this graph
      // (can happen when nodes are deleted but edges remain in React Flow state)
      const savedNodeIds = new Set(rfNodes.map((n) => n.id))
      const validEdges = rfEdges.filter((e) => savedNodeIds.has(e.source) && savedNodeIds.has(e.target))
      await prisma.edge.deleteMany({ where: { workflowId: workflowId! } })
      if (validEdges.length > 0) {
        await prisma.edge.createMany({
          data: validEdges.map((e) => ({
            id: e.id,
            agencyId,
            workflowId: workflowId!,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            // sourceHandle carries pass/fail routing label
            label: e.sourceHandle ?? e.label ?? null,
          })),
        })
      }
    }

    if (!workflowId) {
      return reply.code(400).send({ error: 'workflow_id is required when no graph is provided' })
    }

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, agencyId },
      include: { client: { select: { requireOffline: true } } },
    })

    if (!workflow) {
      return reply.code(404).send({ error: 'Workflow not found' })
    }

    if (workflow.status === 'archived') {
      return reply.code(422).send({ error: 'Cannot run an archived workflow' })
    }

    // Policy enforcement: client marked require_offline must never use cloud AI
    if (workflow.client?.requireOffline) {
      const provider = ((body.model_config as Record<string, unknown> | undefined)?.provider as string | undefined) ?? 'anthropic'
      if (provider !== 'ollama') {
        return reply.code(422).send({ error: 'This client requires offline (local) AI models only. Switch to Ollama before running.' })
      }
      if (workflow.connectivityMode !== 'offline') {
        return reply.code(422).send({ error: 'This client requires offline mode. The workflow connectivity mode must be offline.' })
      }
    }

    // Verify the user exists in our DB — Clerk user IDs won't match unless seeded.
    // Fall back to null (anonymous trigger) if the user record isn't found.
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })

    // Create the run record with status 'pending'
    const run = await prisma.workflowRun.create({
      data: {
        workflowId,
        agencyId,
        triggeredBy: userExists ? userId : null,
        status: 'pending',
        input: (body.input ?? {}) as Prisma.InputJsonValue,
        output: { nodeStatuses: {} } as Prisma.InputJsonValue,
      },
    })

    // Enqueue the job — worker picks it up asynchronously
    const queue = getWorkflowRunsQueue()
    await queue.add(
      'run-workflow',
      { workflowRunId: run.id, agencyId },
      { jobId: run.id },
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
      runId: run.id,
      status: run.status,
      workflowId,
    })
  })

  // ── POST /batch — trigger multiple runs from a list of documents ─────────
  app.post('/batch', async (req, reply) => {
    const batchBody = z.object({
      workflowId: z.string(),
      documents: z.array(z.object({
        id: z.string(),
        name: z.string(),
      })).min(1),
    }).safeParse(req.body)

    if (!batchBody.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: batchBody.error.issues })
    }

    const { workflowId, documents } = batchBody.data
    const { agencyId, userId } = req.auth

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, agencyId },
    })

    if (!workflow) {
      return reply.code(404).send({ error: 'Workflow not found' })
    }

    if (workflow.status === 'archived') {
      return reply.code(422).send({ error: 'Cannot run an archived workflow' })
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })

    const batchId = randomUUID()
    const queue = getWorkflowRunsQueue()
    const runs = []

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      const run = await prisma.workflowRun.create({
        data: {
          workflowId,
          agencyId,
          triggeredBy: userExists ? userId : null,
          status: 'pending',
          batchId,
          batchIndex: i,
          input: {
            documentId: doc.id,
            documentName: doc.name,
            sourceDocumentId: doc.id,
            sourceDocumentName: doc.name,
          } as Prisma.InputJsonValue,
          output: { nodeStatuses: {} } as Prisma.InputJsonValue,
        },
      })

      await queue.add(
        'run-workflow',
        { workflowRunId: run.id, agencyId },
        { jobId: run.id },
      )

      await auditService.log(agencyId, {
        actorType: 'user',
        actorId: userId,
        action: 'workflow.run.created',
        resourceType: 'WorkflowRun',
        resourceId: run.id,
        metadata: { workflowId, batchId, batchIndex: i, documentId: doc.id, documentName: doc.name },
      })

      runs.push({
        runId: run.id,
        status: run.status,
        documentId: doc.id,
        documentName: doc.name,
        batchIndex: i,
      })
    }

    return reply.code(202).send({ data: { batchId, workflowId, runs } })
  })

  // ── GET /:id — poll run status ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
      include: {
        workflow: {
          select: {
            id: true, name: true, connectivityMode: true, projectName: true, itemName: true,
            nodes: { select: { id: true, label: true, type: true, config: true } },
            client: { select: { id: true, name: true } },
          },
        },
        feedbacks: {
          include: { stakeholder: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!run) {
      return reply.code(404).send({ error: 'Run not found' })
    }

    const output = run.output as {
      nodeStatuses?: Record<string, unknown>
      finalOutput?: unknown
      pendingTranscriptionSessionId?: string
      pendingReviewNodeId?: string
      pendingReviewContent?: string
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
        reviewStatus: run.reviewStatus,
        reviewerIds: run.reviewerIds,
        nodeStatuses: output.nodeStatuses ?? {},
        finalOutput: output.finalOutput ?? null,
        pendingSessionId: output.pendingTranscriptionSessionId ?? null,
        pendingReviewNodeId: output.pendingReviewNodeId ?? null,
        pendingReviewContent: output.pendingReviewContent ?? null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        feedbacks: run.feedbacks,
      },
    })
  })

  // ── POST /:id/review — submit human review and resume run ─────────────────
  app.post('/:id/review', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { approvedContent: string }

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    if (run.status !== 'waiting_review') {
      return reply.code(400).send({ error: `Run is not waiting for review (status: ${run.status})` })
    }

    const output = run.output as Record<string, unknown>
    const pendingNodeId = output.pendingReviewNodeId as string | undefined
    if (!pendingNodeId) return reply.code(400).send({ error: 'No pending review node' })

    // Inject the approved (possibly edited) content as the node's output
    const nodeStatuses = (output.nodeStatuses ?? {}) as Record<string, Record<string, unknown>>
    nodeStatuses[pendingNodeId] = {
      ...nodeStatuses[pendingNodeId],
      output: body.approvedContent,
      paused: false,
    }

    const updatedOutput = {
      ...output,
      nodeStatuses,
      pendingReviewNodeId: undefined,
      pendingReviewContent: undefined,
      approvedReviewContent: body.approvedContent,
      resumeFromNodeId: pendingNodeId,
    }

    await prisma.workflowRun.update({
      where: { id },
      data: {
        status: 'running',
        output: updatedOutput as unknown as Prisma.InputJsonValue,
      },
    })

    // Re-enqueue the run
    const queue = getWorkflowRunsQueue()
    await queue.add(
      'run-workflow',
      { workflowRunId: id, agencyId },
      { jobId: `${id}-review-resume-${Date.now()}` },
    )

    return reply.send({ data: { status: 'running' } })
  })

  // ── POST /:id/flag — reject run during human review ──────────────────────
  app.post('/:id/flag', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { note?: string }

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    if (run.status !== 'waiting_review') {
      return reply.code(400).send({ error: `Run is not waiting for review (status: ${run.status})` })
    }

    const output = (run.output ?? {}) as Record<string, unknown>
    await prisma.workflowRun.update({
      where: { id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: body.note ? `Flagged by reviewer: ${body.note}` : 'Flagged by reviewer',
        output: {
          ...output,
          pendingReviewNodeId: null,
          pendingReviewContent: null,
          flagNote: body.note ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    return reply.send({ data: { status: 'failed' } })
  })

  // ── GET / — list runs for the agency ─────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const query = req.query as {
      workflowId?: string
      clientId?: string
      status?: string
      limit?: string
      offset?: string
    }

    const statusFilter = query.status && query.status !== 'all' ? query.status : undefined
    // HIGH #6: Clamp pagination values to prevent negative/zero inputs
    const limit = Math.min(Math.max(1, parseInt(query.limit ?? '50', 10)), 100)
    const skip = Math.max(0, parseInt(query.offset ?? '0', 10))

    // Build where clause without complex TypeScript generics
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { agencyId }
    if (query.workflowId) where.workflowId = query.workflowId
    if (statusFilter) where.status = statusFilter
    if (query.clientId) where.workflow = { clientId: query.clientId }

    const runs = await prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
      select: {
        id: true,
        workflowId: true,
        status: true,
        triggeredBy: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        createdAt: true,
        output: true,
        parentRunId: true,
        triggerType: true,
        batchId: true,
        batchIndex: true,
        reviewStatus: true,
        reviewerIds: true,
        workflow: {
          select: {
            id: true,
            name: true,
            projectName: true,
            itemName: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    })

    const total = await prisma.workflowRun.count({ where })

    // Status counts (all runs for this agency, unfiltered)
    const allRuns = await prisma.workflowRun.findMany({
      where: { agencyId },
      select: { status: true },
    })
    const statsByStatus: Record<string, number> = {}
    for (const r of allRuns) {
      statsByStatus[r.status] = (statsByStatus[r.status] ?? 0) + 1
    }

    const data = runs.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = r.output as any
      return {
        id: r.id,
        workflowId: r.workflowId,
        workflowName: r.workflow.name,
        projectName: r.workflow.projectName ?? null,
        itemName: r.workflow.itemName ?? null,
        clientId: r.workflow.client?.id ?? null,
        clientName: r.workflow.client?.name ?? null,
        status: r.status,
        triggeredBy: r.triggeredBy,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
        finalOutput: output?.finalOutput ?? null,
        nodeStatuses: output?.nodeStatuses ?? null,
        parentRunId: r.parentRunId ?? null,
        triggerType: r.triggerType ?? null,
        batchId: r.batchId ?? null,
        batchIndex: r.batchIndex ?? null,
        reviewStatus: r.reviewStatus,
        reviewerIds: r.reviewerIds,
      }
    })

    return reply.send({ data, meta: { total, stats: statsByStatus } })
  })

  // ── POST /:id/rerun-from/:nodeId — clone run, skip already-passed nodes ──
  app.post<{ Params: { id: string; nodeId: string } }>('/:id/rerun-from/:nodeId', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id: sourceRunId, nodeId: startNodeId } = req.params

    // Load source run with its workflow graph
    const sourceRun = await prisma.workflowRun.findFirst({
      where: { id: sourceRunId, agencyId },
      include: {
        workflow: {
          include: { nodes: true, edges: true },
        },
      },
    })

    if (!sourceRun) return reply.code(404).send({ error: 'Run not found' })

    const savedOutput = sourceRun.output as {
      nodeStatuses?: Record<string, { status: string; output?: unknown; tokensUsed?: number; modelUsed?: string; wordsProcessed?: number; startedAt?: string; completedAt?: string }>
    } | null

    if (!savedOutput?.nodeStatuses) {
      return reply.code(422).send({ error: 'Source run has no node output to reuse' })
    }

    // Build forward adjacency to find descendants of startNodeId
    const edges = sourceRun.workflow.edges
    const outgoing = new Map<string, string[]>()
    for (const n of sourceRun.workflow.nodes) outgoing.set(n.id, [])
    for (const e of edges) {
      outgoing.get(e.sourceNodeId)?.push(e.targetNodeId)
    }

    const descendants = new Set<string>()
    const queue = [startNodeId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (descendants.has(cur)) continue
      descendants.add(cur)
      for (const next of outgoing.get(cur) ?? []) queue.push(next)
    }

    // Build new nodeStatuses: keep upstream nodes as passed, reset descendants to idle
    const newNodeStatuses: Record<string, unknown> = {}
    for (const n of sourceRun.workflow.nodes) {
      if (descendants.has(n.id)) {
        newNodeStatuses[n.id] = { status: 'idle' }
      } else {
        // Keep as passed from source run (or idle if somehow not passed)
        const prior = savedOutput.nodeStatuses[n.id]
        newNodeStatuses[n.id] = prior?.status === 'passed' ? prior : { status: 'idle' }
      }
    }

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })

    const newRun = await prisma.workflowRun.create({
      data: {
        workflowId: sourceRun.workflowId,
        agencyId,
        triggeredBy: userExists ? userId : null,
        status: 'pending',
        parentRunId: sourceRunId,
        reentryFromNodeId: startNodeId,
        triggerType: 'rerun',
        input: sourceRun.input as Prisma.InputJsonValue,
        output: { nodeStatuses: newNodeStatuses } as unknown as Prisma.InputJsonValue,
      },
    })

    const queue2 = getWorkflowRunsQueue()
    await queue2.add(
      'run-workflow',
      { workflowRunId: newRun.id, agencyId },
      { jobId: newRun.id },
    )

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'workflow.run.created',
      resourceType: 'WorkflowRun',
      resourceId: newRun.id,
      metadata: { workflowId: sourceRun.workflowId, rerunFromNodeId: startNodeId, sourceRunId },
    })

    return reply.code(202).send({
      runId: newRun.id,
      status: newRun.status,
      workflowId: sourceRun.workflowId,
    })
  })

  // ── PATCH /:id/review-meta — update review status and assigned reviewers ──
  app.patch<{ Params: { id: string } }>('/:id/review-meta', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const body = z.object({
      reviewStatus: z.enum(['none', 'pending', 'sent_to_client', 'client_responded', 'closed']).optional(),
      reviewerIds: z.array(z.string()).optional(),
    }).safeParse(req.body)

    if (!body.success) return reply.code(400).send({ error: 'Invalid body', details: body.error.issues })

    const run = await prisma.workflowRun.findFirst({ where: { id, agencyId } })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    const updated = await prisma.workflowRun.update({
      where: { id },
      data: {
        ...(body.data.reviewStatus !== undefined ? { reviewStatus: body.data.reviewStatus } : {}),
        ...(body.data.reviewerIds !== undefined ? { reviewerIds: body.data.reviewerIds as Prisma.InputJsonValue } : {}),
      },
    })

    return reply.send({ data: { reviewStatus: updated.reviewStatus, reviewerIds: updated.reviewerIds } })
  })

  // ── POST /:id/send-review ─────────────────────────────────────────────────
  // Sends a portal link to one or more contacts (existing stakeholders or ad-hoc
  // emails).  Every link is backed by a DeliverableAccess record so recipients
  // appear in the Access tab and can be individually revoked at any time.
  // Ad-hoc emails auto-create a stakeholder under the run's client.
  app.post<{ Params: { id: string } }>('/:id/send-review', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id } = req.params
    const body = z.object({
      stakeholderIds: z.array(z.string()).default([]),
      newContacts: z.array(z.object({
        name:  z.string().min(1).max(100),
        email: z.string().email(),
      })).default([]),
    }).refine((d) => d.stakeholderIds.length + d.newContacts.length > 0, {
      message: 'Provide at least one stakeholderId or newContact',
    }).safeParse(req.body)

    if (!body.success) return reply.code(400).send({ error: 'Invalid body', details: body.error.issues })

    const run = await prisma.workflowRun.findFirst({
      where: { id, agencyId },
      select: {
        id: true, reviewerIds: true,
        workflow: { select: { name: true, clientId: true, client: { select: { name: true } } } },
      },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    const workflowName = run.workflow?.name ?? 'content review'
    const clientName   = run.workflow?.client?.name ?? ''
    const clientId     = run.workflow?.clientId ?? null

    const TOKEN_TTL_DAYS = 30
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
    const links: { stakeholderId: string; name: string; email: string; portalUrl: string; isNew: boolean }[] = []

    // Collect all stakeholders to process (existing IDs + auto-created ad-hoc)
    const allStakeholders: { id: string; name: string; email: string; isNew: boolean }[] = []

    for (const sid of body.data.stakeholderIds) {
      const s = await prisma.stakeholder.findFirst({ where: { id: sid, agencyId } })
      if (s) allStakeholders.push({ id: s.id, name: s.name, email: s.email, isNew: false })
    }

    // Fetch agency settings once to compute expiry for temp contacts
    const agencySettings = await prisma.agencySettings.findUnique({ where: { agencyId } })
    const tempExpiryDays = agencySettings?.tempContactExpiryDays ?? null
    const tempExpiresAt = tempExpiryDays
      ? new Date(Date.now() + tempExpiryDays * 24 * 60 * 60 * 1000)
      : null

    for (const contact of body.data.newContacts) {
      if (!clientId) {
        req.log.warn({ email: contact.email }, '[send-review] workflow has no client — cannot create stakeholder')
        continue
      }
      // Upsert: match on email within this client
      let s = await prisma.stakeholder.findFirst({
        where: { agencyId, clientId, email: contact.email.toLowerCase() },
      })
      if (!s) {
        s = await prisma.stakeholder.create({
          data: {
            agencyId,
            clientId,
            name: contact.name,
            email: contact.email.toLowerCase(),
            source: 'deliverable_share',
            ...(tempExpiresAt ? { expiresAt: tempExpiresAt } : {}),
          },
        })
      }
      allStakeholders.push({ id: s.id, name: s.name, email: s.email, isNew: true })
    }

    // Create a DeliverableAccess grant for each stakeholder and send the portal link
    for (const s of allStakeholders) {
      const token = crypto.randomBytes(32).toString('hex')

      // Upsert the access grant — refreshes token if one already exists
      await prisma.deliverableAccess.upsert({
        where: { runId_stakeholderId: { runId: id, stakeholderId: s.id } },
        update: { token, expiresAt, revokedAt: null, grantedBy: userId },
        create: { agencyId, runId: id, stakeholderId: s.id, token, expiresAt, grantedBy: userId },
      })

      const portalUrl = `${PORTAL_BASE_URL}/portal?token=${token}`
      links.push({ stakeholderId: s.id, name: s.name, email: s.email, portalUrl, isNew: s.isNew })

      await sendReviewEmail({ to: { name: s.name, email: s.email }, clientName, workflowName, portalUrl })
    }

    const allIds = links.map((l) => l.stakeholderId)
    const merged = Array.from(new Set([...((run.reviewerIds as string[]) ?? []), ...allIds]))

    await prisma.workflowRun.update({
      where: { id },
      data: { reviewStatus: 'sent_to_client', reviewerIds: merged as Prisma.InputJsonValue },
    })

    return reply.send({ data: { links, reviewStatus: 'sent_to_client' } })
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
