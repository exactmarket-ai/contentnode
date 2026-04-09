import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Quality Routes — /api/v1/quality
//
// Aggregated quality learning data from ContentQualityRecord.
// Used to surface trends, service comparisons, and recommendations.
// ─────────────────────────────────────────────────────────────────────────────

function last30Days() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 29)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

export async function qualityRoutes(app: FastifyInstance) {
  // ── GET /summary — overview of quality metrics ───────────────────────────
  app.get('/summary', async (req, reply) => {
    const { agencyId } = req.auth
    const { start } = last30Days()

    const records = await prisma.contentQualityRecord.findMany({
      where: { agencyId, createdAt: { gte: start } },
      orderBy: { createdAt: 'asc' },
    })

    // Total runs tracked
    const totalTracked = records.length

    // Average final detection score (last score after all retries)
    const detectionRecords = records.flatMap((r) => {
      const scores = r.detectionScores as unknown as DetectionScoreEntry[]
      return scores.map((s) => s.scoreAfter).filter((s): s is number => s !== null)
    })
    const avgDetectionScore = detectionRecords.length > 0
      ? detectionRecords.reduce((a, b) => a + b, 0) / detectionRecords.length
      : null

    // Pass rate (detection score ≤ threshold)
    const passEntries = (records.flatMap((r) => r.detectionScores as unknown as DetectionScoreEntry[]))
      .filter((s) => s.scoreAfter !== null)
    const passRate = passEntries.length > 0
      ? passEntries.filter((s) => s.passed).length / passEntries.length
      : null

    // Average stakeholder rating
    const ratingRecords = records.filter((r) => r.stakeholderRating !== null)
    const avgRating = ratingRecords.length > 0
      ? ratingRecords.reduce((s, r) => s + (r.stakeholderRating as number), 0) / ratingRecords.length
      : null

    // Average retries to pass
    const retryEntries = (records.flatMap((r) => r.detectionScores as unknown as DetectionScoreEntry[]))
    const avgRetries = retryEntries.length > 0
      ? retryEntries.reduce((s, e) => s + e.retryCount, 0) / retryEntries.length
      : null

    return reply.send({
      data: {
        totalTracked,
        avgDetectionScore,
        passRate,
        avgRetries,
        avgStakeholderRating: avgRating,
      },
    })
  })

  // ── GET /trends — daily detection score over last 30 days ────────────────
  app.get('/trends', async (req, reply) => {
    const { agencyId } = req.auth
    const { start } = last30Days()

    const records = await prisma.contentQualityRecord.findMany({
      where: { agencyId, createdAt: { gte: start } },
      select: { createdAt: true, detectionScores: true, stakeholderRating: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by date
    const byDate = new Map<string, { scores: number[]; ratings: number[] }>()
    for (const r of records) {
      const date = r.createdAt.toISOString().slice(0, 10)
      if (!byDate.has(date)) byDate.set(date, { scores: [], ratings: [] })
      const bucket = byDate.get(date)!

      const scores = r.detectionScores as unknown as DetectionScoreEntry[]
      for (const s of scores) {
        if (s.scoreAfter !== null) bucket.scores.push(s.scoreAfter)
      }
      if (r.stakeholderRating !== null) bucket.ratings.push(r.stakeholderRating as number)
    }

    // Fill all 30 days (0 if no data)
    const today = new Date()
    const trend: { date: string; avgDetectionScore: number | null; avgRating: number | null; runCount: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const date = d.toISOString().slice(0, 10)
      const bucket = byDate.get(date)
      trend.push({
        date,
        avgDetectionScore: bucket && bucket.scores.length > 0
          ? bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length
          : null,
        avgRating: bucket && bucket.ratings.length > 0
          ? bucket.ratings.reduce((a, b) => a + b, 0) / bucket.ratings.length
          : null,
        runCount: bucket ? bucket.scores.length : 0,
      })
    }

    return reply.send({ data: trend })
  })

  // ── GET /services — humanizer service comparison ─────────────────────────
  app.get('/services', async (req, reply) => {
    const { agencyId } = req.auth
    const { start } = last30Days()

    const records = await prisma.contentQualityRecord.findMany({
      where: { agencyId, createdAt: { gte: start } },
      select: { humanizerRuns: true, detectionScores: true, stakeholderRating: true },
    })

    // Build per-service stats
    // For detection score, we pair runs: if a humanizer ran before a detection node
    // we use the detection score as the "result" of that humanizer service.
    const serviceStats = new Map<string, {
      runs: number
      totalWords: number
      detectionScores: number[]
      ratings: number[]
    }>()

    for (const r of records) {
      const humanizers = r.humanizerRuns as unknown as HumanizerRunEntry[]
      const detections = r.detectionScores as unknown as DetectionScoreEntry[]
      const rating = r.stakeholderRating as number | null

      // Get the best (lowest) detection score in this run
      const bestScore = detections.length > 0
        ? Math.min(...detections.map((d) => d.scoreAfter ?? 100))
        : null

      for (const h of humanizers) {
        const svc = h.service ?? 'unknown'
        if (!serviceStats.has(svc)) {
          serviceStats.set(svc, { runs: 0, totalWords: 0, detectionScores: [], ratings: [] })
        }
        const stat = serviceStats.get(svc)!
        stat.runs++
        stat.totalWords += h.wordsProcessed
        if (bestScore !== null) stat.detectionScores.push(bestScore)
        if (rating !== null) stat.ratings.push(rating)
      }
    }

    const services = Array.from(serviceStats.entries()).map(([service, stat]) => ({
      service,
      runs: stat.runs,
      totalWordsProcessed: stat.totalWords,
      avgDetectionScore: stat.detectionScores.length > 0
        ? stat.detectionScores.reduce((a, b) => a + b, 0) / stat.detectionScores.length
        : null,
      avgStakeholderRating: stat.ratings.length > 0
        ? stat.ratings.reduce((a, b) => a + b, 0) / stat.ratings.length
        : null,
    })).sort((a, b) => (a.avgDetectionScore ?? 100) - (b.avgDetectionScore ?? 100))

    return reply.send({ data: services })
  })

  // ── GET /models — AI model comparison ───────────────────────────────────
  app.get('/models', async (req, reply) => {
    const { agencyId } = req.auth
    const { start } = last30Days()

    const records = await prisma.contentQualityRecord.findMany({
      where: { agencyId, createdAt: { gte: start } },
      select: { aiGenerations: true, stakeholderRating: true },
    })

    const modelStats = new Map<string, {
      runs: number
      totalTokens: number
      ratings: number[]
    }>()

    for (const r of records) {
      const gens = r.aiGenerations as unknown as AiGenerationEntry[]
      const rating = r.stakeholderRating as number | null

      for (const g of gens) {
        const model = g.model ?? 'unknown'
        if (!modelStats.has(model)) {
          modelStats.set(model, { runs: 0, totalTokens: 0, ratings: [] })
        }
        const stat = modelStats.get(model)!
        stat.runs++
        stat.totalTokens += g.tokensUsed
        if (rating !== null) stat.ratings.push(rating)
      }
    }

    const models = Array.from(modelStats.entries()).map(([model, stat]) => ({
      model,
      runs: stat.runs,
      totalTokens: stat.totalTokens,
      avgTokensPerRun: stat.runs > 0 ? Math.round(stat.totalTokens / stat.runs) : 0,
      avgStakeholderRating: stat.ratings.length > 0
        ? stat.ratings.reduce((a, b) => a + b, 0) / stat.ratings.length
        : null,
    })).sort((a, b) => (b.avgStakeholderRating ?? 0) - (a.avgStakeholderRating ?? 0))

    return reply.send({ data: models })
  })

  // ── GET /recommendations — auto-generated config recommendations ─────────
  app.get('/recommendations', async (req, reply) => {
    const { agencyId } = req.auth
    const { start } = last30Days()

    const records = await prisma.contentQualityRecord.findMany({
      where: { agencyId, createdAt: { gte: start } },
      select: { humanizerRuns: true, detectionScores: true, stakeholderRating: true, workflowId: true },
    })

    const recommendations: Array<{
      type: string
      severity: 'info' | 'warning' | 'critical'
      title: string
      body: string
    }> = []

    // ── Recommendation 1: switch humanizer service ─────────────────────────
    const svcScores = new Map<string, number[]>()
    for (const r of records) {
      const humanizers = r.humanizerRuns as unknown as HumanizerRunEntry[]
      const detections = r.detectionScores as unknown as DetectionScoreEntry[]
      const bestScore = detections.length > 0
        ? Math.min(...detections.map((d) => d.scoreAfter ?? 100))
        : null
      if (bestScore === null) continue
      for (const h of humanizers) {
        const svc = h.service ?? 'unknown'
        if (!svcScores.has(svc)) svcScores.set(svc, [])
        svcScores.get(svc)!.push(bestScore)
      }
    }

    const svcAvgs = Array.from(svcScores.entries())
      .filter(([, scores]) => scores.length >= 3)
      .map(([svc, scores]) => ({
        svc,
        avg: scores.reduce((a, b) => a + b, 0) / scores.length,
        count: scores.length,
      }))
      .sort((a, b) => a.avg - b.avg)

    if (svcAvgs.length >= 2) {
      const best = svcAvgs[0]
      const worst = svcAvgs[svcAvgs.length - 1]
      if (worst.avg - best.avg > 15) {
        recommendations.push({
          type: 'humanizer_service',
          severity: worst.avg > 50 ? 'critical' : 'warning',
          title: `Switch from ${worst.svc} to ${best.svc}`,
          body: `${best.svc} achieves ${best.avg.toFixed(0)}% avg detection score vs ${worst.avg.toFixed(0)}% for ${worst.svc} (${worst.count} runs). Switching could significantly reduce AI detection risk.`,
        })
      }
    }

    // ── Recommendation 2: high retry count ────────────────────────────────
    const allRetries = records.flatMap((r) =>
      (r.detectionScores as unknown as DetectionScoreEntry[]).map((s) => s.retryCount)
    )
    if (allRetries.length >= 5) {
      const avgRetries = allRetries.reduce((a, b) => a + b, 0) / allRetries.length
      if (avgRetries > 2) {
        recommendations.push({
          type: 'high_retries',
          severity: 'warning',
          title: 'High retry count in detection loop',
          body: `Workflows average ${avgRetries.toFixed(1)} humanization retries before passing. Consider increasing the detection threshold or switching to a stronger humanizer to reduce retries.`,
        })
      }
    }

    // ── Recommendation 3: low stakeholder ratings ─────────────────────────
    const allRatings = records
      .map((r) => r.stakeholderRating as number | null)
      .filter((r): r is number => r !== null)

    if (allRatings.length >= 5) {
      const avgRating = allRatings.reduce((a, b) => a + b, 0) / allRatings.length
      if (avgRating < 3) {
        recommendations.push({
          type: 'low_stakeholder_rating',
          severity: 'critical',
          title: 'Low average stakeholder satisfaction',
          body: `Average stakeholder rating is ${avgRating.toFixed(1)}/5 over the last 30 days. Review the AI Generate node prompts and Content Output settings — consider running the workflow with different task types or adding more specific instructions.`,
        })
      } else if (avgRating < 3.5) {
        recommendations.push({
          type: 'low_stakeholder_rating',
          severity: 'warning',
          title: 'Below-average stakeholder satisfaction',
          body: `Average stakeholder rating is ${avgRating.toFixed(1)}/5. Review recent feedback for recurring patterns and check if Insights have been applied to the workflow.`,
        })
      }
    }

    // ── Recommendation 4: consistently failing detection ──────────────────
    const failEntries = records.flatMap((r) => r.detectionScores as unknown as DetectionScoreEntry[])
      .filter((s) => s.scoreAfter !== null)
    if (failEntries.length >= 5) {
      const failRate = failEntries.filter((s) => !s.passed).length / failEntries.length
      if (failRate > 0.3) {
        recommendations.push({
          type: 'high_fail_rate',
          severity: failRate > 0.6 ? 'critical' : 'warning',
          title: `${Math.round(failRate * 100)}% of runs fail the detection threshold`,
          body: `More than ${Math.round(failRate * 100)}% of detection checks are not passing. Consider: lowering the detection threshold, increasing max retries, or switching to Undetectable.ai as the primary humanizer.`,
        })
      }
    }

    // ── All clear ─────────────────────────────────────────────────────────
    if (recommendations.length === 0 && records.length > 0) {
      recommendations.push({
        type: 'all_clear',
        severity: 'info',
        title: 'Quality metrics look healthy',
        body: 'Detection scores, retry counts, and stakeholder ratings are within normal ranges. Keep running workflows to build up more learning data.',
      })
    }

    return reply.send({ data: recommendations })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Local type aliases (mirror qualityExtractor.ts shapes)
// ─────────────────────────────────────────────────────────────────────────────

interface DetectionScoreEntry {
  nodeId: string
  scoreBefore: number | null
  scoreAfter: number | null
  retryCount: number
  service: string | null
  threshold: number
  passed: boolean
}

interface AiGenerationEntry {
  nodeId: string
  model: string | null
  provider: string | null
  taskType: string | null
  tokensUsed: number
}

interface HumanizerRunEntry {
  nodeId: string
  service: string | null
  mode: string | null
  wordsProcessed: number
}
