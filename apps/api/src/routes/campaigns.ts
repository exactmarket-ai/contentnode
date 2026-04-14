import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { auditService } from '@contentnode/database'
import { uploadStream, deleteObject } from '@contentnode/storage'
import { getWorkflowRunsQueue, getCampaignBrainProcessQueue } from '../lib/queues.js'

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
  context: z.string().optional(),
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

    // Attach latest run per workflow — scoped to this campaign only so
    // historical failures from other campaigns don't bleed into the display.
    const workflowIds = campaign.workflows.map((cw) => cw.workflowId)
    const latestRuns = workflowIds.length > 0
      ? await prisma.workflowRun.findMany({
          where: { workflowId: { in: workflowIds }, agencyId, campaignId: campaign.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, workflowId: true, status: true,
            startedAt: true, completedAt: true, campaignId: true,
            errorMessage: true, output: true,
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

    // Extract first image asset path from run output (for thumbnail in campaign card)
    function firstImagePath(run: { output: unknown } | null): string | null {
      if (!run?.output) return null
      const out = run.output as Record<string, unknown>
      const nodeStatuses = out.nodeStatuses as Record<string, { output?: unknown }> | undefined
      if (!nodeStatuses) return null
      for (const ns of Object.values(nodeStatuses)) {
        const nodeOut = ns?.output as Record<string, unknown> | undefined
        if (!nodeOut) continue
        const assets = nodeOut.assets as Array<{ localPath?: string; storageKey?: string }> | undefined
        if (assets?.length) {
          return assets[0].localPath ?? assets[0].storageKey ?? null
        }
      }
      return null
    }

    const runByWorkflow = Object.fromEntries(latestRuns.map((r) => [r.workflowId, r]))

    return reply.send({
      data: {
        ...campaign,
        workflows: campaign.workflows.map((cw) => {
          const run = runByWorkflow[cw.workflowId] ?? null
          const { output: _output, ...runWithoutOutput } = run ?? {}
          return {
            ...cw,
            latestRun: run ? { ...runWithoutOutput, firstImagePath: firstImagePath(run) } : null,
          }
        }),
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

    const { name, goal, status, brief, context, startDate, endDate } = parsed.data
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(brief !== undefined ? {
          brief,
          briefEditedBy: req.auth.userId,
          briefEditedAt: new Date(),
        } : {}),
        ...(context !== undefined ? { context } : {}),
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

    // Only store triggeredBy if the userId maps to a real User row (Clerk-only users have no DB record)
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })

    // Create and enqueue all runs in campaign order (parallel execution)
    for (const cw of runnable) {
      const run = await prisma.workflowRun.create({
        data: {
          workflowId: cw.workflowId,
          agencyId,
          triggeredBy: userExists ? userId : null,
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
    // Campaign-specific brain context takes precedence — listed last so it's freshest in the LLM's context window
    if (campaign.context) contextParts.push(`Campaign-Specific Context (use this to sharpen and focus the brief):\n${campaign.context}`)

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

    // Save brief to campaign — always snapshot the AI-generated original
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { brief: result.text, briefOriginal: result.text },
    })

    return reply.send({ data: { brief: updated.brief } })
  })

  // ── Preflight field suggestions via client brain ─────────────────────────────
  app.post<{ Params: { id: string }; Body: { subtypes: string[] } }>(
    '/:id/preflight-suggest',
    async (req, reply) => {
      const { agencyId } = req.auth
      const subtypes: string[] = (req.body as { subtypes?: string[] }).subtypes ?? []

      const campaign = await prisma.campaign.findFirst({
        where: { id: req.params.id, agencyId },
        select: { clientId: true, client: { select: { name: true } } },
      })
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

      const [gtmFramework, dgBase] = await Promise.all([
        prisma.clientFramework.findFirst({
          where: { clientId: campaign.clientId, agencyId },
          select: { data: true },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.clientDemandGenBase.findUnique({
          where: { clientId: campaign.clientId },
          select: { data: true },
        }),
      ])

      const gtm = (gtmFramework?.data ?? {}) as Record<string, unknown>
      const contextParts: string[] = [`CLIENT: ${campaign.client.name}`]
      const extractSection = (key: string, label: string) => {
        const val = gtm[key.toLowerCase()] ?? gtm[key]
        if (val) contextParts.push(`${label}:\n${JSON.stringify(val, null, 2).slice(0, 800)}`)
      }
      extractSection('s01', 'Company Overview')
      extractSection('s02', 'ICP / Target Audience')
      extractSection('s08', 'Positioning & Messaging')
      extractSection('s12', 'Competitive Landscape')
      if (dgBase?.data) {
        const b1 = (dgBase.data as Record<string, unknown>)['b1'] ?? (dgBase.data as Record<string, unknown>)['B1']
        if (b1) contextParts.push(`Demand Gen Strategy:\n${JSON.stringify(b1, null, 2).slice(0, 600)}`)
      }
      const context = contextParts.join('\n\n')

      const SUBTYPE_DESCRIPTIONS: Record<string, string> = {
        'review-miner':    `"review-miner": { "companyName": "<company display name>", "companySlug": "<trustpilot-slug-lowercase-hyphens>" }`,
        'deep-web-scrape': `"deep-web-scrape": { "seedUrls": "<url1>\\n<url2>\\n<url3>" }  — use actual competitor/industry domains from the context`,
        'audience-signal': `"audience-signal": { "searchTerms": "<term1>\\n<term2>\\n<term3>\\n<term4>" }  — phrased as buyer pain points or questions they'd type into Reddit`,
        'seo-intent':      `"seo-intent": { "topic": "<broad topic>", "seedKeywords": "<kw1>\\n<kw2>\\n<kw3>\\n<kw4>\\n<kw5>" }  — keywords with buyer intent`,
      }

      const requested = subtypes.filter((s) => SUBTYPE_DESCRIPTIONS[s])
      if (requested.length === 0) return reply.send({ suggestions: {} })

      const prompt = `You are configuring intelligence research workflow nodes for a marketing agency client. Based on the client context below, suggest specific values for the workflow fields listed.

CLIENT CONTEXT:
${context}

Return ONLY a valid JSON object (no markdown, no explanation) with suggestions for these node types:
${requested.map((s) => `- ${SUBTYPE_DESCRIPTIONS[s]}`).join('\n')}

Rules:
- companySlug: lowercase letters and hyphens only (Trustpilot URL slug format)
- seedUrls: 2–4 real competitor or industry website URLs, one per line, inferred from the competitive landscape
- searchTerms: 4–6 Reddit-style search phrases, one per line — buyer pain points or questions they'd actually type
- seedKeywords: 5–8 keyword phrases with commercial buyer intent, one per line
- Only include the node types listed above
- If a value cannot be determined from context, make a reasonable inference from the industry and ICP`

      const result = await callModel(
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', api_key_ref: 'ANTHROPIC_API_KEY', temperature: 0.3 },
        prompt,
      )

      let suggestions: Record<string, Record<string, string>> = {}
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) suggestions = JSON.parse(jsonMatch[0])
      } catch { /* return empty on parse failure */ }

      return reply.send({ suggestions })
    }
  )

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

  // ── Campaign Brain: list attachments ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const attachments = await prisma.campaignBrainAttachment.findMany({
      where: { campaignId: req.params.id, agencyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        sourceUrl: true, extractionStatus: true, summaryStatus: true,
        summary: true, campaignScopedOnly: true, createdAt: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // ── Campaign Brain: upload file ──────────────────────────────────────────────
  const ALLOWED_BRAIN_EXTS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.html', '.htm', '.xlsx', '.xls'])

  app.post<{ Params: { id: string } }>('/:id/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const ext = extname(filename).toLowerCase()
    if (!ALLOWED_BRAIN_EXTS.has(ext)) {
      return reply.code(400).send({ error: `File type not supported. Allowed: ${[...ALLOWED_BRAIN_EXTS].join(', ')}` })
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = `campaign-brain/${agencyId}/${campaign.id}/${randomUUID()}-${safeName}`

    try {
      await uploadStream(storageKey, file, mimetype)
    } catch (err) {
      app.log.error(err, 'Failed to store campaign brain attachment')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    const attachment = await prisma.campaignBrainAttachment.create({
      data: { agencyId, campaignId: campaign.id, filename, storageKey, mimeType: mimetype, sizeBytes, uploadedByUserId: storedUploaderId },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, extractionStatus: true, summaryStatus: true, summary: true, campaignScopedOnly: true, createdAt: true },
    })

    await getCampaignBrainProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      campaignId: campaign.id,
    }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })

    return reply.code(201).send({ data: attachment })
  })

  // ── Campaign Brain: add URL source ──────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/brain/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const { url } = req.body as { url?: string }
    if (!url?.startsWith('http')) return reply.code(400).send({ error: 'Valid URL required' })

    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, agencyId } })
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    const attachment = await prisma.campaignBrainAttachment.create({
      data: {
        agencyId,
        campaignId: campaign.id,
        filename: url,
        sourceUrl: url,
        mimeType: 'text/html',
        uploadedByUserId: storedUploaderId,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, extractionStatus: true, summaryStatus: true, summary: true, campaignScopedOnly: true, createdAt: true, sourceUrl: true },
    })

    await getCampaignBrainProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      campaignId: campaign.id,
      url,
    }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })

    return reply.code(201).send({ data: attachment })
  })

  // ── Campaign Brain: update summary and/or campaignScopedOnly ────────────────
  app.patch<{ Params: { id: string; aid: string } }>('/:id/brain/attachments/:aid', async (req, reply) => {
    const { agencyId } = req.auth
    const { summary, campaignScopedOnly } = req.body as { summary?: string; campaignScopedOnly?: boolean }
    const updated = await prisma.campaignBrainAttachment.updateMany({
      where: { id: req.params.aid, campaignId: req.params.id, agencyId },
      data: {
        ...(summary !== undefined ? { summary } : {}),
        ...(campaignScopedOnly !== undefined ? { campaignScopedOnly } : {}),
      },
    })
    if (updated.count === 0) return reply.code(404).send({ error: 'Attachment not found' })
    return reply.send({ data: { updated: true } })
  })

  // ── Campaign Brain: delete attachment ───────────────────────────────────────
  app.delete<{ Params: { id: string; aid: string } }>('/:id/brain/attachments/:aid', async (req, reply) => {
    const { agencyId } = req.auth
    const attachment = await prisma.campaignBrainAttachment.findFirst({
      where: { id: req.params.aid, campaignId: req.params.id, agencyId },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })

    if (attachment.storageKey) {
      try { await deleteObject(attachment.storageKey) } catch {}
    }
    await prisma.campaignBrainAttachment.delete({ where: { id: attachment.id } })
    return reply.send({ data: { deleted: true } })
  })

  // ── Campaign Brain: get raw extracted text ───────────────────────────────────
  app.get<{ Params: { id: string; aid: string } }>('/:id/brain/attachments/:aid/text', async (req, reply) => {
    const { agencyId } = req.auth
    const attachment = await prisma.campaignBrainAttachment.findFirst({
      where: { id: req.params.aid, campaignId: req.params.id, agencyId },
      select: { extractedText: true, filename: true },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    return reply.send({ data: { text: attachment.extractedText ?? '', filename: attachment.filename } })
  })
}
