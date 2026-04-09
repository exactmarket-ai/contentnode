import { prisma, type Prisma } from '@contentnode/database'
import type { RunOutput, NodeStatus } from './runner.js'

// ─────────────────────────────────────────────────────────────────────────────
// Quality Extractor
//
// Called after each completed workflow run. Reads the RunOutput JSON and node
// configs to extract quality signals, then writes a ContentQualityRecord.
// Non-blocking — errors are caught and logged but never propagate to the runner.
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

export async function extractAndSaveQuality(
  agencyId: string,
  workflowRunId: string,
): Promise<void> {
  try {
    // Load the run with workflow/client info and node configs
    const run = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      select: {
        id: true,
        agencyId: true,
        workflowId: true,
        output: true,
        workflow: {
          select: {
            clientId: true,
            nodes: {
              select: { id: true, type: true, config: true },
            },
          },
        },
      },
    })
    if (!run) return

    const runOutput = run.output as unknown as RunOutput
    const nodeStatuses = runOutput?.nodeStatuses ?? {}
    const detectionState = runOutput?.detectionState ?? {}

    // Build a map of node configs by ID for quick lookup
    const nodeConfigMap = new Map<string, Record<string, unknown>>()
    for (const n of run.workflow.nodes) {
      nodeConfigMap.set(n.id, (n.config ?? {}) as Record<string, unknown>)
    }

    // ── Detection scores ─────────────────────────────────────────────────────
    const detectionScores: DetectionScoreEntry[] = []
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      const cfg = nodeConfigMap.get(nodeId)
      if (!cfg || cfg.subtype !== 'detection') continue

      const output = status.output as Record<string, unknown> | undefined
      const dState = detectionState[nodeId]

      detectionScores.push({
        nodeId,
        scoreBefore: null, // We only have the final score; pre-humanization score not separately captured
        scoreAfter: typeof output?.overall_score === 'number' ? output.overall_score : null,
        retryCount: dState?.retryCount ?? 0,
        service: (cfg.service as string) ?? null,
        threshold: (cfg.threshold as number) ?? 20,
        passed: status.status === 'passed',
      })
    }

    // ── AI generations (logic nodes) ─────────────────────────────────────────
    const aiGenerations: AiGenerationEntry[] = []
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      const cfg = nodeConfigMap.get(nodeId)
      if (!cfg) continue

      // Logic nodes that are NOT humanizer/detection/conditional-branch are AI generation
      const subtype = cfg.subtype as string | undefined
      if (
        subtype === 'humanizer' ||
        subtype === 'humanizer-pro' ||
        subtype === 'detection' ||
        subtype === 'conditional-branch' ||
        subtype === 'human-review'
      ) continue

      if (!status.modelUsed && !status.tokensUsed) continue

      const modelUsed = status.modelUsed ?? (cfg.model as string) ?? null
      const provider = modelUsed?.includes('claude') ? 'anthropic'
        : modelUsed?.includes('gpt') ? 'openai'
        : (cfg.provider as string) ?? null

      aiGenerations.push({
        nodeId,
        model: modelUsed,
        provider,
        taskType: (cfg.task_type as string) ?? null,
        tokensUsed: status.tokensUsed ?? 0,
      })
    }

    // ── Humanizer runs ───────────────────────────────────────────────────────
    const humanizerRuns: HumanizerRunEntry[] = []
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      const cfg = nodeConfigMap.get(nodeId)
      if (!cfg) continue
      if (cfg.subtype !== 'humanizer' && cfg.subtype !== 'humanizer-pro') continue

      humanizerRuns.push({
        nodeId,
        service: (cfg.service as string) ?? null,
        mode: (cfg.mode as string) ?? null,
        wordsProcessed: status.wordsProcessed ?? 0,
      })
    }

    // ── Content type + word count (from content-output node) ─────────────────
    let contentType: string | null = null
    let wordCount: number | null = null

    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      const cfg = nodeConfigMap.get(nodeId)
      if (!cfg || cfg.subtype !== 'content-output') continue

      contentType = (cfg.output_type as string) ?? null

      const outputText = typeof status.output === 'string'
        ? status.output
        : typeof (status.output as Record<string, unknown>)?.content === 'string'
          ? (status.output as Record<string, unknown>).content as string
          : null

      if (outputText) {
        wordCount = outputText.split(/\s+/).filter(Boolean).length
      }
      break
    }

    // ── Skip if there's nothing interesting to save ───────────────────────────
    if (
      detectionScores.length === 0 &&
      aiGenerations.length === 0 &&
      humanizerRuns.length === 0
    ) {
      return
    }

    // ── Upsert quality record ─────────────────────────────────────────────────
    await prisma.contentQualityRecord.upsert({
      where: { runId: workflowRunId },
      create: {
        agencyId,
        workflowId: run.workflowId,
        clientId: run.workflow.clientId ?? null,
        runId: workflowRunId,
        contentType,
        wordCount,
        detectionScores: detectionScores as unknown as Prisma.InputJsonValue,
        aiGenerations: aiGenerations as unknown as Prisma.InputJsonValue,
        humanizerRuns: humanizerRuns as unknown as Prisma.InputJsonValue,
      },
      update: {
        contentType,
        wordCount,
        detectionScores: detectionScores as unknown as Prisma.InputJsonValue,
        aiGenerations: aiGenerations as unknown as Prisma.InputJsonValue,
        humanizerRuns: humanizerRuns as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    console.error('[qualityExtractor] failed to save quality record:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update quality record when feedback is submitted for a run
// ─────────────────────────────────────────────────────────────────────────────
export async function updateQualityWithFeedback(
  workflowRunId: string,
  starRating: number | null,
  decision: string | null,
): Promise<void> {
  try {
    const existing = await prisma.contentQualityRecord.findUnique({
      where: { runId: workflowRunId },
    })
    if (!existing) return

    // Average in the new rating
    const currentCount = existing.feedbackCount
    const currentRating = existing.stakeholderRating ?? null

    let newRating = starRating !== null
      ? currentRating !== null
        ? (currentRating * currentCount + starRating) / (currentCount + 1)
        : starRating
      : currentRating

    await prisma.contentQualityRecord.update({
      where: { runId: workflowRunId },
      data: {
        stakeholderRating: newRating,
        feedbackDecision: decision ?? existing.feedbackDecision,
        feedbackCount: { increment: 1 },
      },
    })
  } catch (err) {
    console.error('[qualityExtractor] failed to update quality with feedback:', err)
  }
}
