import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma, auditService } from '@contentnode/database'
import { randomUUID } from 'node:crypto'
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
  defaultAssigneeId: z.string().nullable().optional(),
  isLocked: z.boolean().optional(),
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
        defaultAssignee: { select: { id: true, name: true, avatarStorageKey: true } },
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

    // Policy enforcement: requireOffline clients must only use offline workflows
    if (client.requireOffline && connectivityMode !== 'offline') {
      return reply.code(422).send({ error: 'This client requires offline mode. Set connectivity mode to offline.' })
    }
    const { defaultModelConfig } = parsed.data
    if (client.requireOffline && defaultModelConfig?.provider && defaultModelConfig.provider !== 'ollama') {
      return reply.code(422).send({ error: 'This client requires local AI models only. Use Ollama as the provider.' })
    }

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
        ...(parsed.data.defaultAssigneeId !== undefined ? { defaultAssigneeId: parsed.data.defaultAssigneeId } : {}),
        ...(parsed.data.isLocked !== undefined ? { isLocked: parsed.data.isLocked } : {}),
      },
      include: {
        client: { select: { id: true, name: true, slug: true } },
        defaultAssignee: { select: { id: true, name: true, avatarStorageKey: true } },
        _count: { select: { runs: true } },
      },
    })

    return reply.send({ data: workflow })
  })

  // ── PATCH /:id/nodes/:nodeId/config — update a single node's config fields ─
  app.patch<{ Params: { id: string; nodeId: string } }>('/:id/nodes/:nodeId/config', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: workflowId, nodeId } = req.params
    const updates = (req.body ?? {}) as Record<string, unknown>

    const node = await prisma.node.findFirst({
      where: { id: nodeId, workflowId, workflow: { agencyId } },
      select: { id: true, config: true },
    })
    if (!node) return reply.code(404).send({ error: 'Node not found' })

    const merged = { ...(node.config as Record<string, unknown> ?? {}), ...updates }
    await prisma.node.update({ where: { id: nodeId }, data: { config: merged } })
    return reply.send({ data: { id: nodeId, config: merged } })
  })

  // ── PUT /:id/graph — save nodes + edges from canvas ──────────────────────
  app.put<{ Params: { id: string } }>('/:id/graph', async (req, reply) => {
    const { agencyId } = req.auth
    const workflowId = req.params.id

    const body = req.body as {
      nodes?: Array<{
        id?: string
        type: string
        position: { x: number; y: number }
        data: Record<string, unknown>
        parentNode?: string
        style?: { width?: number; height?: number }
        zIndex?: number
      }>
      edges?: Array<{ id?: string; source: string; target: string; sourceHandle?: string; label?: string }>
      name?: string
      defaultModelConfig?: Record<string, unknown>
    }

    try {
      const existing = await prisma.workflow.findFirst({
        where: { id: workflowId, agencyId },
        include: { client: { select: { requireOffline: true } } },
      })
      if (!existing) return reply.code(404).send({ error: 'Workflow not found' })

      const rfNodes = body.nodes ?? []
      const rfEdges = body.edges ?? []
      const defaultModelCfg = body.defaultModelConfig ?? {}
      const isOfflineSave = existing.connectivityMode === 'offline' || existing.client?.requireOffline === true

      // Update name if provided
      if (body.name) {
        await prisma.workflow.update({ where: { id: workflowId }, data: { name: body.name } })
      }

      // Replace all nodes for this workflow
      await prisma.node.deleteMany({ where: { workflowId } })
      if (rfNodes.length > 0) {
        await prisma.node.createMany({
          data: rfNodes.map((n) => {
            const data = (n.data ?? {}) as Record<string, unknown>
            const nestedConfig = (data.config as Record<string, unknown>) ?? null
            const { label: _l, description: _d, icon: _i, config: _c, ...dataFields } = data
            const config = (nestedConfig && Object.keys(nestedConfig).length > 1)
              ? nestedConfig
              : dataFields
            const nodeModelCfg = (config.model_config as Record<string, unknown> | null) ?? null
            const resolvedModelCfg = nodeModelCfg ?? defaultModelCfg
            const resolvedProvider = (resolvedModelCfg.provider as string | undefined) ?? 'anthropic'
            // Only inject AI model fields on subtypes that actually call an LLM.
            // Non-AI logic nodes (video-transcription, video-frame-extractor, transform, etc.)
            // use their own `provider` field to mean something different (e.g. transcription service),
            // so overwriting it with the workflow's LLM provider would break them.
            const nodeSubtype = (config.subtype as string | undefined) ?? (data.subtype as string | undefined) ?? ''
            const AI_LOGIC_SUBTYPES = new Set([
              'ai-generate', 'humanizer', 'detection', 'image-generation',
              'video-generation', 'translation', 'human-review', 'conditional-branch', 'insight',
            ])
            const modelFields = n.type === 'logic' && AI_LOGIC_SUBTYPES.has(nodeSubtype) ? {
              provider: isOfflineSave ? 'ollama' : resolvedProvider,
              model: isOfflineSave
                ? (resolvedProvider === 'ollama' ? (resolvedModelCfg.model as string | undefined) ?? 'gemma3:12b' : 'gemma3:12b')
                : (resolvedModelCfg.model as string | undefined) ?? 'claude-sonnet-4-6',
              temperature: (resolvedModelCfg.temperature as number | undefined) ?? 0.7,
            } : {}
            // Strip file arrays — files are stored in client_workflow_files, not the template
            // Keep stored_assets — needed so locked nodes can skip re-generation on next run
            const { uploaded_files: _uf, audio_files: _af, ...configWithoutFiles } = config as Record<string, unknown>
            // Persist group layout properties so they survive save/load
            const groupFields = n.type === 'group' ? {
              _groupWidth: n.style?.width,
              _groupHeight: n.style?.height,
            } : {}
            const parentFields = n.parentNode ? { _parentNode: n.parentNode } : {}

            // JSON.parse/stringify strips undefined values which Prisma's Json column rejects
            const safeConfig = JSON.parse(JSON.stringify(
              { subtype: data.subtype ?? config.subtype, ...configWithoutFiles, ...modelFields, ...groupFields, ...parentFields }
            )) as Prisma.InputJsonValue
            return {
              id: n.id ?? randomUUID(),
              agencyId,
              workflowId,
              type: n.type,
              label: (data.label as string | undefined) ?? n.type,
              config: safeConfig,
              positionX: n.position?.x ?? 0,
              positionY: n.position?.y ?? 0,
            }
          }),
        })
      }

      // Replace all edges for this workflow
      const savedNodeIds = new Set(rfNodes.map((n) => n.id))
      const validEdges = rfEdges.filter((e) => savedNodeIds.has(e.source) && savedNodeIds.has(e.target))
      await prisma.edge.deleteMany({ where: { workflowId } })
      if (validEdges.length > 0) {
        await prisma.edge.createMany({
          data: validEdges.map((e) => ({
            id: e.id ?? randomUUID(),
            agencyId,
            workflowId,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            label: e.sourceHandle ?? e.label ?? null,
          })),
        })
      }

      return reply.send({ data: { workflowId, nodeCount: rfNodes.length, edgeCount: validEdges.length } })
    } catch (err) {
      req.log.error({ err, workflowId }, '[graph save] failed')
      return reply.code(500).send({ error: 'Failed to save workflow graph', detail: err instanceof Error ? err.message : String(err) })
    }
  })

  // ── GET /:id/files — get client-scoped file bindings for this workflow ───────
  // Pass ?clientId= to scope to a specific client; omit (or empty) for template-level files.
  app.get<{ Params: { id: string }; Querystring: { clientId?: string } }>('/:id/files', async (req, reply) => {
    const { agencyId } = req.auth
    const wf = await prisma.workflow.findFirst({ where: { id: req.params.id, agencyId } })
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const clientId = (req.query as Record<string, string>).clientId ?? wf.clientId ?? ''
    const bindings = await prisma.clientWorkflowFiles.findMany({
      where: { workflowId: req.params.id, clientId },
    })
    const result: Record<string, unknown> = {}
    for (const b of bindings) result[b.nodeId] = b.files
    return reply.send({ data: result })
  })

  // ── PUT /:id/files/:nodeId — upsert client-scoped file bindings for one node ─
  app.put<{ Params: { id: string; nodeId: string } }>('/:id/files/:nodeId', async (req, reply) => {
    const { agencyId } = req.auth
    const wf = await prisma.workflow.findFirst({ where: { id: req.params.id, agencyId } })
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const body = req.body as Record<string, unknown>
    const files = body.files as Prisma.InputJsonValue
    const clientId = (body.clientId as string | undefined) ?? wf.clientId ?? ''
    await prisma.clientWorkflowFiles.upsert({
      where: { clientId_workflowId_nodeId: { clientId, workflowId: req.params.id, nodeId: req.params.nodeId } },
      create: { agencyId, clientId, workflowId: req.params.id, nodeId: req.params.nodeId, files },
      update: { files },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /:id/promote-template — promote or demote as org template ────────
  app.post<{ Params: { id: string } }>('/:id/promote-template', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const body = z.object({
      isTemplate:          z.boolean(),
      templateCategory:    z.string().max(50).optional(),
      templateDescription: z.string().max(300).optional(),
    }).parse(req.body)

    const wf = await prisma.workflow.findFirst({ where: { id: req.params.id, agencyId } })
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' })

    const updated = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        isTemplate:          body.isTemplate,
        templateCategory:    body.isTemplate ? (body.templateCategory ?? wf.templateCategory ?? 'general') : null,
        templateDescription: body.isTemplate ? (body.templateDescription ?? wf.templateDescription ?? wf.description) : null,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: body.isTemplate ? 'workflow.promoted_template' : 'workflow.demoted_template',
      resourceType: 'workflow', resourceId: wf.id,
      metadata: { name: wf.name, category: body.templateCategory },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ data: updated })
  })

  // ── GET /templates — list org-level workflow templates ─────────────────────
  app.get('/templates', async (req, reply) => {
    const { agencyId } = req.auth

    const templates = await prisma.workflow.findMany({
      where: { agencyId, isTemplate: true },
      include: {
        nodes: { select: { id: true } },
        edges: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return reply.send({ data: templates })
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
