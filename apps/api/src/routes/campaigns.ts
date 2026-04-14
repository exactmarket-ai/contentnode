import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { auditService } from '@contentnode/database'
import { getWorkflowRunsQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const createCampaignBody = z.object({
  name: z.string().min(1).max(200),
  clientId: z.string().min(1),
  goal: z.enum(['lead_gen', 'nurture', 'awareness', 'retention', 'custom']).default('lead_gen'),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
})

const updateCampaignBody = z.object({
  name: z.string().min(1).max(200).optional(),
  goal: z.enum(['lead_gen', 'nurture', 'awareness', 'retention', 'custom']).optional(),
  status: z.enum(['planning', 'active', 'archived']).optional(),
  brief: z.string().optional(),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
})

const addWorkflowBody = z.object({
  workflowId: z.string().min(1),
  order: z.number().int().min(0).optional(),
  role: z.enum(['lead_magnet', 'email_nurture', 'landing_page', 'outreach', 'ad_copy', 'blog', 'social', 'research', 'custom']).optional(),
})

const updateWorkflowBody = z.object({
  order: z.number().int().min(0).optional(),
  role: z.enum(['lead_magnet', 'email_nurture', 'landing_page', 'outreach', 'ad_copy', 'blog', 'social', 'research', 'custom']).optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Route plugin
// ─────────────────────────────────────────────────────────────────────────────

export async function campaignRoutes(app: FastifyInstance) {
  // ── List campaigns ──────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, status } = req.query as Record<string, string>

    const campaigns = await prisma.campaign.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        workflows: {
          include: {
            workflow: {
              select: {
                id: true, name: true, status: true, connectivityMode: true,
                _count: { select: { runs: true } },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return reply.send({ data: campaigns, meta: { total: campaigns.length } })
  })

  // ── Get single campaign with latest run per workflow ────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        client: { select: { id: true, name: true } },
        workflows: {
          include: {
            workflow: {
              select: {
                id: true, name: true, status: true, connectivityMode: true, description: true,
                _count: { select: { runs: true } },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { runs: true } },
      },
    })

    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    // Attach latest run per workflow
    const workflowIds = campaign.workflows.map((cw) => cw.workflowId)
    const latestRuns = workflowIds.length > 0
      ? await prisma.workflowRun.findMany({
          where: { workflowId: { in: workflowIds }, agencyId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, workflowId: true, status: true,
            startedAt: true, completedAt: true, campaignId: true,
          },
        }).then((runs) => {
          // Keep only the most recent run per workflow
          const seen = new Set<string>()
          return runs.filter((r) => {
            if (seen.has(r.workflowId)) return false
            seen.add(r.workflowId)
            return true
          })
        })
      : []

    const runByWorkflow = Object.fromEntries(latestRuns.map((r) => [r.workflowId, r]))

    return reply.send({
      data: {
        ...campaign,
        workflows: campaign.workflows.map((cw) => ({
          ...cw,
          latestRun: runByWorkflow[cw.workflowId] ?? null,
        })),
      },
    })
  })

  // ── Create campaign ─────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const parsed = createCampaignBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { name, clientId, goal, startDate, endDate } = parsed.data

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const campaign = await prisma.campaign.create({
      data: {
        agencyId,
        clientId,
        name,
        goal,
        status: 'planning',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'campaign.created',
      resourceType: 'Campaign',
      resourceId: campaign.id,
      metadata: { name, clientId, goal },
    })

    return reply.code(201).send({ data: campaign })
  })

  // ── Update campaign ─────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateCampaignBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Campaign not found' })

    const { name, goal, status, brief, startDate, endDate } = parsed.data
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(brief !== undefined ? { brief } : {}),
        ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
        ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      },
    })

    return reply.send({ data: campaign })
  })

  // ── Delete campaign ─────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Campaign not found' })

    await prisma.campaign.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Add workflow to campaign ────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/workflows', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = addWorkflowBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const workflow = await prisma.workflow.findFirst({ where: { id: parsed.data.workflowId, agencyId } })
    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' })

    // Default order = max existing + 1
    let order = parsed.data.order
    if (order === undefined) {
      const maxOrder = await prisma.campaignWorkflow.aggregate({
        where: { campaignId: req.params.id },
        _max: { order: true },
      })
      order = (maxOrder._max.order ?? -1) + 1
    }

    const cw = await prisma.campaignWorkflow.create({
      data: {
        campaignId: req.params.id,
        workflowId: parsed.data.workflowId,
        order,
        role: parsed.data.role ?? 'custom',
      },
      include: {
        workflow: { select: { id: true, name: true, status: true } },
      },
    })

    return reply.code(201).send({ data: cw })
  })

  // ── Update workflow in campaign (order / role) ──────────────────────────────
  app.patch<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateWorkflowBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cw = await prisma.campaignWorkflow.findFirst({
      where: { campaignId: req.params.id, workflowId: req.params.workflowId },
    })
    if (!cw) return reply.code(404).send({ error: 'Workflow not in campaign' })

    const updated = await prisma.campaignWorkflow.update({
      where: { id: cw.id },
      data: {
        ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {}),
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
      },
    })

    return reply.send({ data: updated })
  })

  // ── Remove workflow from campaign ───────────────────────────────────────────
  app.delete<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId', async (req, reply) => {
    const { agencyId } = req.auth

    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cw = await prisma.campaignWorkflow.findFirst({
      where: { campaignId: req.params.id, workflowId: req.params.workflowId },
    })
    if (!cw) return reply.code(404).send({ error: 'Workflow not in campaign' })

    await prisma.campaignWorkflow.delete({ where: { id: cw.id } })
    return reply.code(204).send()
  })

  // ── Run all workflows in campaign ───────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const { agencyId, userId } = req.auth

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        workflows: {
          include: { workflow: { select: { id: true, name: true, status: true } } },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })
    if (campaign.workflows.length === 0) return reply.code(422).send({ error: 'Campaign has no workflows' })

    const runnable = campaign.workflows.filter((cw) => cw.workflow.status !== 'archived')
    if (runnable.length === 0) return reply.code(422).send({ error: 'All workflows in this campaign are archived' })

    const queue = getWorkflowRunsQueue()
    const createdRuns: Array<{ workflowId: string; workflowName: string; runId: string; role: string | null }> = []

    // Create and enqueue all runs in campaign order (parallel execution)
    for (const cw of runnable) {
      const run = await prisma.workflowRun.create({
        data: {
          workflowId: cw.workflowId,
          agencyId,
          triggeredBy: userId,
          campaignId: campaign.id,
          status: 'pending',
          input: {} as never,
          output: { nodeStatuses: {} } as never,
        },
      })

      await queue.add('run-workflow', { workflowRunId: run.id, agencyId }, { jobId: run.id })
      createdRuns.push({ workflowId: cw.workflowId, workflowName: cw.workflow.name, runId: run.id, role: cw.role })
    }

    // Mark campaign as active
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'active' },
    })

    return reply.code(202).send({ data: { campaignId: campaign.id, runs: createdRuns } })
  })

  // ── Generate campaign brief with Claude ─────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/brief', async (req, reply) => {
    const { agencyId } = req.auth

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        client: { select: { id: true, name: true } },
        workflows: {
          include: { workflow: { select: { id: true, name: true, description: true } } },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    // Fetch client intelligence context (DG base + first vertical)
    const [dgBase, dgVert, gtmFramework] = await Promise.all([
      prisma.clientDemandGenBase.findUnique({
        where: { clientId: campaign.clientId },
        select: { data: true },
      }),
      prisma.clientDemandGen.findFirst({
        where: { clientId: campaign.clientId },
        select: { data: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.clientFramework.findFirst({
        where: { clientId: campaign.clientId, agencyId },
        select: { data: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    const GOAL_LABELS: Record<string, string> = {
      lead_gen: 'Lead Generation',
      nurture: 'Lead Nurture',
      awareness: 'Brand Awareness',
      retention: 'Customer Retention',
      custom: 'Custom',
    }

    const workflowList = campaign.workflows
      .map((cw, i) => `${i + 1}. ${cw.workflow.name}${cw.role ? ` (${cw.role.replace(/_/g, ' ')})` : ''}${cw.workflow.description ? ' — ' + cw.workflow.description : ''}`)
      .join('\n')

    const contextParts: string[] = []
    if (dgBase?.data) contextParts.push(`Company Revenue & Goals:\n${JSON.stringify(dgBase.data, null, 2)}`)
    if (dgVert?.data) contextParts.push(`Demand Gen Vertical Data:\n${JSON.stringify(dgVert.data, null, 2)}`)
    if (gtmFramework?.data) {
      const d = gtmFramework.data as Record<string, unknown>
      const messaging = d.s08 ?? d['08']
      const icp = d.s02 ?? d['02']
      if (messaging) contextParts.push(`Messaging Framework:\n${JSON.stringify(messaging, null, 2)}`)
      if (icp) contextParts.push(`ICP Definition:\n${JSON.stringify(icp, null, 2)}`)
    }

    const prompt = `You are a senior demand generation strategist writing a Campaign Brief for a marketing agency.

Client: ${campaign.client.name}
Campaign: ${campaign.name}
Goal: ${GOAL_LABELS[campaign.goal] ?? campaign.goal}
${campaign.startDate ? `Timeline: ${campaign.startDate.toLocaleDateString()} – ${campaign.endDate?.toLocaleDateString() ?? 'TBD'}` : ''}

Workflows in this campaign:
${workflowList}

${contextParts.length > 0 ? `Client Intelligence:\n${contextParts.join('\n\n')}` : ''}

Write a concise Campaign Brief covering:

## Campaign Brief: ${campaign.name}

### Objective
What this campaign is designed to achieve for the client. Be specific about the business outcome.

### Target Audience
Who this campaign reaches — specific roles, segments, and pain points from the client data.

### Key Messages
3–5 core messages this campaign communicates. Use the client's own language.

### Campaign Structure
How the workflows connect as a system — what each piece does and how they work together.

### Success Metrics
What good looks like for this campaign. Specific KPIs tied to the goal.

### Timeline & Milestones
Key dates and when each deliverable should be live.

### Creative Direction
Tone, format guidance, and brand considerations for all assets in this campaign.

Keep the brief actionable and under 600 words. Write for a marketing director reviewing this with their team.`

    const result = await callModel(
      { provider: 'anthropic', model: 'claude-sonnet-4-5', api_key_ref: 'ANTHROPIC_API_KEY', temperature: 0.4 },
      prompt,
    )

    // Save brief to campaign
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { brief: result.text },
    })

    return reply.send({ data: { brief: updated.brief } })
  })

  // ── Output bundle — latest completed run output per workflow ────────────────
  app.get<{ Params: { id: string } }>('/:id/bundle', async (req, reply) => {
    const { agencyId } = req.auth

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        client: { select: { id: true, name: true } },
        workflows: {
          include: { workflow: { select: { id: true, name: true } } },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const workflowIds = campaign.workflows.map((cw) => cw.workflowId)

    const runs = await prisma.workflowRun.findMany({
      where: {
        workflowId: { in: workflowIds },
        agencyId,
        status: 'completed',
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true, workflowId: true, output: true, completedAt: true },
    })

    // Latest completed run per workflow
    const seen = new Set<string>()
    const latestByWorkflow = runs.filter((r) => {
      if (seen.has(r.workflowId)) return false
      seen.add(r.workflowId)
      return true
    })
    const runMap = Object.fromEntries(latestByWorkflow.map((r) => [r.workflowId, r]))

    // Extract primary output text from each run's node statuses
    function extractPrimaryOutput(output: unknown): string | null {
      if (!output || typeof output !== 'object') return null
      const o = output as Record<string, unknown>
      const nodeStatuses = o.nodeStatuses as Record<string, { output?: unknown; status?: string }> | undefined
      if (!nodeStatuses) return null
      // Find last output node (by status = passed and having an output)
      const outputs = Object.values(nodeStatuses)
        .filter((n) => n.status === 'passed' && n.output && typeof n.output === 'string' && n.output.trim().length > 0)
        .map((n) => n.output as string)
      return outputs[outputs.length - 1] ?? null
    }

    const bundle = campaign.workflows.map((cw) => {
      const run = runMap[cw.workflowId]
      return {
        workflow: { id: cw.workflowId, name: cw.workflow.name, role: cw.role, order: cw.order },
        runId: run?.id ?? null,
        completedAt: run?.completedAt ?? null,
        output: run ? extractPrimaryOutput(run.output) : null,
        hasOutput: !!run,
      }
    })

    return reply.send({
      data: {
        campaignId: campaign.id,
        campaignName: campaign.name,
        clientName: campaign.client.name,
        goal: campaign.goal,
        assets: bundle,
        completedCount: bundle.filter((b) => b.hasOutput).length,
        totalCount: bundle.length,
      },
    })
  })
}
