import type { FastifyInstance, FastifyReply } from 'fastify'
import { prisma } from '@contentnode/database'

// LOW #10: Helper to verify a clientId belongs to the requesting agency
async function verifyClientOwnership(clientId: string, agencyId: string, reply: FastifyReply): Promise<boolean> {
  const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
  if (!client) {
    reply.code(403).send({ error: 'clientId does not belong to this agency' })
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function dateRange(days: number): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function dailyBuckets(days: number): { date: string; start: Date; end: Date }[] {
  const buckets: { date: string; start: Date; end: Date }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    buckets.push({ date: start.toISOString().slice(0, 10), start, end })
  }
  return buckets
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function reportRoutes(app: FastifyInstance) {
  // ── GET /overview — stat cards ────────────────────────────────────────────
  app.get('/overview', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start, end } = dateRange(Number(days))
    const clientFilter = clientId ? { workflow: { clientId } } : {}

    const [totalRuns, completedRuns, failedRuns, waitingFeedback, waitingApproval] = await Promise.all([
      prisma.workflowRun.count({ where: { agencyId, createdAt: { gte: start, lte: end }, ...clientFilter } }),
      prisma.workflowRun.count({ where: { agencyId, status: 'completed', createdAt: { gte: start, lte: end }, ...clientFilter } }),
      prisma.workflowRun.count({ where: { agencyId, status: 'failed', createdAt: { gte: start, lte: end }, ...clientFilter } }),
      prisma.workflowRun.count({ where: { agencyId, status: 'waiting_feedback', ...clientFilter } }),
      prisma.workflowRun.count({ where: { agencyId, status: 'waiting_review', ...clientFilter } }),
    ])

    // Avg time to complete (ms)
    const completedWithTimes = await prisma.workflowRun.findMany({
      where: { agencyId, status: 'completed', createdAt: { gte: start, lte: end }, ...clientFilter },
      select: { createdAt: true, updatedAt: true },
      take: 200,
    })
    const avgCompletionMs = completedWithTimes.length > 0
      ? completedWithTimes.reduce((sum, r) => sum + (r.updatedAt.getTime() - r.createdAt.getTime()), 0) / completedWithTimes.length
      : 0

    // Total outputs (completed runs)
    const totalOutputs = completedRuns

    // Feedback submitted in period
    const feedbackCount = await prisma.feedback.count({
      where: {
        agencyId,
        createdAt: { gte: start, lte: end },
        ...(clientId ? { workflowRun: { workflow: { clientId } } } : {}),
      },
    })

    return reply.send({
      data: {
        totalRuns,
        completedRuns,
        failedRuns,
        successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
        waitingFeedback,
        waitingApproval,
        totalOutputs,
        feedbackCount,
        avgCompletionMins: Math.round(avgCompletionMs / 60000),
      },
    })
  })

  // ── GET /runs-over-time — daily run counts by status ──────────────────────
  app.get('/runs-over-time', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const clientFilter = clientId ? { workflow: { clientId } } : {}
    const buckets = dailyBuckets(Number(days))

    const data = await Promise.all(
      buckets.map(async ({ date, start, end }) => {
        const [completed, failed, running] = await Promise.all([
          prisma.workflowRun.count({ where: { agencyId, status: 'completed', createdAt: { gte: start, lte: end }, ...clientFilter } }),
          prisma.workflowRun.count({ where: { agencyId, status: 'failed', createdAt: { gte: start, lte: end }, ...clientFilter } }),
          prisma.workflowRun.count({ where: { agencyId, createdAt: { gte: start, lte: end }, ...clientFilter } }),
        ])
        return { date, completed, failed, total: running }
      })
    )

    return reply.send({ data })
  })

  // ── GET /feedback-sentiment — sentiment breakdown ─────────────────────────
  app.get('/feedback-sentiment', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start, end } = dateRange(Number(days))

    const feedbacks = await prisma.feedback.findMany({
      where: {
        agencyId,
        createdAt: { gte: start, lte: end },
        ...(clientId ? { workflowRun: { workflow: { clientId } } } : {}),
      },
      select: { decision: true },
    })

    const counts: Record<string, number> = {}
    for (const f of feedbacks) {
      const key = f.decision ?? 'no_decision'
      counts[key] = (counts[key] ?? 0) + 1
    }

    const order = ['approved', 'approved_with_changes', 'needs_revision', 'rejected', 'no_decision']
    const data = order
      .filter((k) => counts[k] !== undefined)
      .map((k) => ({ sentiment: k, count: counts[k] }))

    // Add any unexpected keys
    for (const [k, v] of Object.entries(counts)) {
      if (!order.includes(k)) data.push({ sentiment: k, count: v })
    }

    return reply.send({ data })
  })

  // ── GET /tokens-by-model — token usage grouped by model ───────────────────
  app.get('/tokens-by-model', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start } = dateRange(Number(days))

    const records = await prisma.usageRecord.findMany({
      where: { agencyId, metric: 'ai_tokens', periodStart: { gte: start } },
      select: { quantity: true, metadata: true },
    })

    // Filter by clientId if provided
    let filtered = records
    if (clientId) {
      const runs = await prisma.workflowRun.findMany({
        where: { agencyId, workflow: { clientId } },
        select: { id: true },
      })
      const ids = new Set(runs.map((r) => r.id))
      filtered = records.filter((r) => {
        const rid = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
        return rid && ids.has(rid)
      })
    }

    const byModel: Record<string, number> = {}
    for (const r of filtered) {
      const model = ((r.metadata as Record<string, unknown>)['model'] as string) ?? 'unknown'
      byModel[model] = (byModel[model] ?? 0) + r.quantity
    }

    const data = Object.entries(byModel)
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens)

    return reply.send({ data })
  })

  // ── GET /output-types — content output type distribution ─────────────────
  app.get('/output-types', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start, end } = dateRange(Number(days))
    const clientFilter = clientId ? { workflow: { clientId } } : {}

    const runs = await prisma.workflowRun.findMany({
      where: { agencyId, status: 'completed', createdAt: { gte: start, lte: end }, ...clientFilter },
      select: { output: true },
      take: 500,
    })

    const typeCounts: Record<string, number> = {}
    for (const run of runs) {
      const nodeStatuses = (run.output as Record<string, unknown>)?.['nodeStatuses'] as Record<string, Record<string, unknown>> | undefined
      if (!nodeStatuses) continue
      for (const status of Object.values(nodeStatuses)) {
        const out = status.output as Record<string, unknown> | undefined
        const label = out?.label as string | undefined
        if (label) {
          const type = label.split('-')[0] ?? label
          typeCounts[type] = (typeCounts[type] ?? 0) + 1
        }
      }
    }

    // Also check finalOutput format
    const completedWithOutput = runs.filter((r) => {
      const o = r.output as Record<string, unknown>
      return o?.finalOutput
    })

    if (Object.keys(typeCounts).length === 0) {
      typeCounts['content'] = completedWithOutput.length
    }

    const data = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    return reply.send({ data })
  })

  // ── GET /detection-pass-rate — first pass vs retried ─────────────────────
  app.get('/detection-pass-rate', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start, end } = dateRange(Number(days))
    const clientFilter = clientId ? { workflow: { clientId } } : {}

    const runs = await prisma.workflowRun.findMany({
      where: { agencyId, status: 'completed', createdAt: { gte: start, lte: end }, ...clientFilter },
      select: { output: true },
      take: 500,
    })

    let firstPass = 0
    let multiPass = 0
    let noDetection = 0

    for (const run of runs) {
      const detectionState = (run.output as Record<string, unknown>)?.['detectionState'] as Record<string, { retryCount: number }> | undefined
      if (!detectionState || Object.keys(detectionState).length === 0) {
        noDetection++
        continue
      }
      const maxRetries = Math.max(...Object.values(detectionState).map((s) => s.retryCount ?? 0))
      if (maxRetries === 0) firstPass++
      else multiPass++
    }

    return reply.send({
      data: [
        { label: 'First pass', count: firstPass },
        { label: 'Multi-pass', count: multiPass },
        { label: 'No detection', count: noDetection },
      ],
    })
  })

  // ── GET /top-workflows — ranked by runs + tokens ──────────────────────────
  app.get('/top-workflows', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start, end } = dateRange(Number(days))

    const workflows = await prisma.workflow.findMany({
      where: { agencyId, ...(clientId ? { clientId } : {}) },
      select: {
        id: true, name: true,
        client: { select: { name: true } },
        _count: { select: { runs: true } },
        runs: {
          where: { createdAt: { gte: start, lte: end } },
          select: { id: true, status: true },
        },
      },
    })

    // Get token usage per workflow
    const tokenRecords = await prisma.usageRecord.findMany({
      where: { agencyId, metric: 'ai_tokens', periodStart: { gte: start } },
      select: { quantity: true, metadata: true },
    })

    const runIds = workflows.flatMap((wf) => wf.runs.map((r) => r.id))
    const runIdSet = new Set(runIds)
    const tokensByRun: Record<string, number> = {}
    for (const r of tokenRecords) {
      const rid = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      if (rid && runIdSet.has(rid)) {
        tokensByRun[rid] = (tokensByRun[rid] ?? 0) + r.quantity
      }
    }

    const data = workflows
      .map((wf) => {
        const periodRuns = wf.runs.length
        const completed = wf.runs.filter((r) => r.status === 'completed').length
        const failed = wf.runs.filter((r) => r.status === 'failed').length
        const tokens = wf.runs.reduce((sum, r) => sum + (tokensByRun[r.id] ?? 0), 0)
        return {
          id: wf.id,
          name: wf.name,
          client: wf.client?.name ?? '—',
          totalRuns: wf._count.runs,
          periodRuns,
          completed,
          failed,
          successRate: periodRuns > 0 ? Math.round((completed / periodRuns) * 100) : 0,
          tokens,
        }
      })
      .filter((wf) => wf.periodRuns > 0)
      .sort((a, b) => b.periodRuns - a.periodRuns)
      .slice(0, 20)

    return reply.send({ data })
  })

  // ── GET /humanizer-usage — word counts by service ─────────────────────────
  app.get('/humanizer-usage', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, days = '30' } = req.query as Record<string, string>
    if (clientId && !await verifyClientOwnership(clientId, agencyId, reply)) return
    const { start } = dateRange(Number(days))

    const records = await prisma.usageRecord.findMany({
      where: { agencyId, metric: 'humanizer_words', periodStart: { gte: start } },
      select: { quantity: true, metadata: true },
    })

    let filtered = records
    if (clientId) {
      const runs = await prisma.workflowRun.findMany({
        where: { agencyId, workflow: { clientId } },
        select: { id: true },
      })
      const ids = new Set(runs.map((r) => r.id))
      filtered = records.filter((r) => {
        const rid = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
        return rid && ids.has(rid)
      })
    }

    const byService: Record<string, number> = {}
    for (const r of filtered) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      byService[service] = (byService[service] ?? 0) + r.quantity
    }

    const data = Object.entries(byService)
      .map(([service, words]) => ({ service, words }))
      .sort((a, b) => b.words - a.words)

    return reply.send({ data })
  })
}
