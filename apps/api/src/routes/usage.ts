import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Usage Routes — /api/v1/usage
//
// Returns token consumption and activity metrics for the current billing period.
// Billing period = current calendar month.
// ─────────────────────────────────────────────────────────────────────────────

function currentPeriod() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

function last30DayBuckets(): { date: string; start: Date; end: Date }[] {
  const buckets: { date: string; start: Date; end: Date }[] = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    buckets.push({
      date: start.toISOString().slice(0, 10),
      start,
      end,
    })
  }
  return buckets
}

export async function usageRoutes(app: FastifyInstance) {
  // ── GET / — usage summary ─────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { start: periodStart, end: periodEnd } = currentPeriod()

    // ── Token consumption ────────────────────────────────────────────────────
    const tokenRecords = await prisma.usageRecord.findMany({
      where: {
        agencyId,
        metric: 'ai_tokens',
        periodStart: { gte: periodStart },
      },
    })

    const totalTokens = tokenRecords.reduce((sum, r) => sum + r.quantity, 0)

    // ── Breakdown by workflow run ────────────────────────────────────────────
    // Token records have workflowRunId in metadata; join to get clientId / workflowId
    const runIds = [
      ...new Set(
        tokenRecords
          .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
          .filter(Boolean) as string[]
      ),
    ]

    const runs = runIds.length
      ? await prisma.workflowRun.findMany({
          where: { id: { in: runIds }, agencyId },
          select: {
            id: true,
            workflowId: true,
            workflow: {
              select: {
                id: true,
                name: true,
                clientId: true,
                client: { select: { id: true, name: true } },
              },
            },
          },
        })
      : []

    const runMap = Object.fromEntries(runs.map((r) => [r.id, r]))

    // Group tokens by client
    const tokensByClient: Record<string, { clientId: string; clientName: string; tokens: number }> = {}
    const tokensByWorkflow: Record<string, { workflowId: string; workflowName: string; clientName: string; tokens: number }> = {}

    for (const record of tokenRecords) {
      const runId = (record.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      const run = runId ? runMap[runId] : undefined
      const wf = (run as unknown as { workflow: { id: string; name: string; clientId: string; client: { id: string; name: string } } } | undefined)?.workflow

      if (wf) {
        const clientId = wf.clientId
        const clientName = wf.client.name
        if (!tokensByClient[clientId]) {
          tokensByClient[clientId] = { clientId, clientName, tokens: 0 }
        }
        tokensByClient[clientId].tokens += record.quantity

        const wfId = wf.id
        if (!tokensByWorkflow[wfId]) {
          tokensByWorkflow[wfId] = { workflowId: wfId, workflowName: wf.name, clientName, tokens: 0 }
        }
        tokensByWorkflow[wfId].tokens += record.quantity
      }
    }

    // ── Workflow run count this period ───────────────────────────────────────
    const runCount = await prisma.workflowRun.count({
      where: {
        agencyId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    })

    // ── Transcription sessions / minutes this period ─────────────────────────
    const transcriptSessions = await prisma.transcriptSession.findMany({
      where: {
        agencyId,
        createdAt: { gte: periodStart, lte: periodEnd },
        status: 'ready',
      },
      select: { durationSecs: true },
    })

    const transcriptionMinutes = Math.ceil(
      transcriptSessions.reduce((sum, s) => sum + (s.durationSecs ?? 0), 0) / 60
    )

    // ── Detection runs (workflow runs that have detection node outputs) ───────
    // Proxy: count workflow runs with 'detection' in their node statuses output
    const detectionRuns = await prisma.workflowRun.count({
      where: {
        agencyId,
        createdAt: { gte: periodStart, lte: periodEnd },
        output: { path: ['nodeStatuses'], not: {} },
      },
    })

    // ── Daily usage over last 30 days ────────────────────────────────────────
    const buckets = last30DayBuckets()
    const dailyUsage = await Promise.all(
      buckets.map(async (bucket) => {
        const dayRecords = await prisma.usageRecord.findMany({
          where: {
            agencyId,
            metric: 'ai_tokens',
            periodStart: { gte: bucket.start, lte: bucket.end },
          },
          select: { quantity: true },
        })
        const tokens = dayRecords.reduce((s, r) => s + r.quantity, 0)
        return { date: bucket.date, tokens }
      })
    )

    return reply.send({
      data: {
        period: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString(),
        },
        totals: {
          tokens: totalTokens,
          runs: runCount,
          transcriptionMinutes,
          detectionApiCalls: detectionRuns,
        },
        byClient: Object.values(tokensByClient).sort((a, b) => b.tokens - a.tokens),
        byWorkflow: Object.values(tokensByWorkflow).sort((a, b) => b.tokens - a.tokens),
        dailyUsage,
      },
    })
  })
}
