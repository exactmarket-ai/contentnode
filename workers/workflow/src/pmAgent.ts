/**
 * pmAgent — ContentNode's AI project manager
 *
 * Fires after every WorkflowRun completes. Reasons over objective signals
 * (topic collisions, trigger type, retry counts) to make routing decisions
 * and detect behavioral patterns.
 *
 * Phase 1: run archiving, auto-delivery for non-manual triggers, same-topic re-run detection
 * Phase 2: PM inbox notifications
 * Phase 3: workload awareness + assignment learning
 *
 * Claude's role: ROUTING ONLY — never "evaluate content quality" directly.
 * It reasons over signals, not subjective judgments.
 */

import { prisma, withAgency } from '@contentnode/database'
import { createQueue, QUEUE_PM_AGENT, type PMAgentJobData, getConnection } from './queues.js'
import { Worker, type Job } from 'bullmq'

// Module-level singleton queue
const pmAgentQueue = createQueue<PMAgentJobData>(QUEUE_PM_AGENT)

export function enqueuePMAgentJob(data: PMAgentJobData) {
  return pmAgentQueue.add('evaluate', data, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
  })
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Trigger types that auto-deliver without human "mark as sent"
const AUTO_DELIVER_TRIGGERS = new Set(['scheduled', 'monday_webhook', 'campaign', 'api', 'program'])

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPriorRunsWithSameTopic(
  agencyId: string,
  workflowId: string,
  topic: string,
  excludeRunId: string,
): Promise<{ id: string; triggerType: string | null; triggeredBy: string | null; createdAt: Date; isArchived: boolean; deliveredAt: Date | null }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.workflowRun as any).findMany({
    where: {
      agencyId,
      workflowId,
      topic,
      id:     { not: excludeRunId },
      status: { in: ['completed', 'failed'] },
    },
    select: { id: true, triggerType: true, triggeredBy: true, createdAt: true, isArchived: true, deliveredAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

async function archivePriorRuns(agencyId: string, workflowId: string, keepRunId: string) {
  await prisma.workflowRun.updateMany({
    where: {
      agencyId,
      workflowId,
      id:          { not: keepRunId },
      deliveredAt: null,           // never archive already-delivered runs
      isArchived:  false,
    },
    data: { isArchived: true },
  })
  console.log(`[pmAgent] archived prior runs for workflow ${workflowId}, keeping ${keepRunId}`)
}

async function markDelivered(agencyId: string, runId: string) {
  await prisma.workflowRun.update({
    where: { id: runId },
    data:  { deliveredAt: new Date() },
  })
  console.log(`[pmAgent] auto-delivered run ${runId}`)
}

// ── Memory helpers ────────────────────────────────────────────────────────────

async function getMemory(agencyId: string, category: string, key: string) {
  return prisma.pMAgentMemory.findUnique({
    where: { agencyId_category_key: { agencyId, category, key } },
  })
}

async function upsertMemory(
  agencyId: string,
  category: string,
  key: string,
  value: object,
  opts?: { confidence?: number; workflowId?: string; userId?: string },
) {
  const existing = await getMemory(agencyId, category, key)
  if (existing) {
    await prisma.pMAgentMemory.update({
      where: { agencyId_category_key: { agencyId, category, key } },
      data:  {
        value:         value as never,
        observedCount: { increment: 1 },
        confidence:    Math.min((existing.confidence ?? 0.5) + 0.05, 0.99),
      },
    })
  } else {
    await prisma.pMAgentMemory.create({
      data: {
        agencyId,
        category,
        key,
        value:      value as never,
        confidence: opts?.confidence ?? 0.5,
        workflowId: opts?.workflowId,
        userId:     opts?.userId,
      },
    })
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function pendingNotificationExists(agencyId: string, patternKey: string, workflowId?: string) {
  const count = await prisma.pMAgentNotification.count({
    where: { agencyId, patternKey, status: 'pending', ...(workflowId ? { workflowId } : {}) },
  })
  return count > 0
}

async function createNotification(agencyId: string, opts: {
  patternKey:    string
  title:         string
  body:          string
  context?:      object
  actions?:      { label: string; value: string; alwaysApply?: boolean }[]
  workflowRunId?: string
  workflowId?:   string
}) {
  // Don't create duplicate pending notifications for same pattern + workflow
  if (await pendingNotificationExists(agencyId, opts.patternKey, opts.workflowId)) return

  await prisma.pMAgentNotification.create({
    data: {
      agencyId,
      patternKey:    opts.patternKey,
      title:         opts.title,
      body:          opts.body,
      context:       (opts.context ?? {}) as never,
      actions:       (opts.actions ?? []) as never,
      workflowRunId: opts.workflowRunId,
      workflowId:    opts.workflowId,
    },
  })
  console.log(`[pmAgent] notification created: ${opts.patternKey} for agency ${agencyId}`)
}

// ── Pattern detectors ─────────────────────────────────────────────────────────

async function detectSameTopicRerun(
  agencyId: string,
  workflowId: string,
  workflowRunId: string,
  topic: string | null,
  triggeredBy: string | null,
) {
  // No topic = no collision possible
  if (!topic?.trim()) return

  const priorRuns = await getPriorRunsWithSameTopic(agencyId, workflowId, topic, workflowRunId)
  // Filter to manual (non-auto-delivered) prior runs only
  const manualPrior = priorRuns.filter((r) => !AUTO_DELIVER_TRIGGERS.has(r.triggerType ?? ''))

  if (manualPrior.length === 0) return

  const memoryKey = `same_topic_rerun_workflow_${workflowId}`

  // Check if the user already said "always archive on re-run"
  const existing = await getMemory(agencyId, 'behavior_observation', memoryKey)
  if (existing?.userAnswer === 'always_archive') {
    await archivePriorRuns(agencyId, workflowId, workflowRunId)
    return
  }

  const runIds    = manualPrior.map((r) => r.id)
  const prevCount = manualPrior.length

  await createNotification(agencyId, {
    patternKey: 'same_topic_rerun',
    title:      `Re-run detected for "${topic}"`,
    body:       prevCount === 1
      ? `There's already a completed run for "${topic}". Should I archive the earlier one and keep Reviews clean?`
      : `There are ${prevCount} earlier runs for "${topic}". Should I archive them and keep only this latest one?`,
    context: { workflowId, topic, runIds, priorCount: prevCount },
    actions: [
      { label: 'Archive earlier runs',           value: 'archive',        alwaysApply: false },
      { label: 'Always archive on re-run',       value: 'always_archive', alwaysApply: true  },
      { label: 'Keep all runs',                  value: 'keep',           alwaysApply: false },
    ],
    workflowRunId,
    workflowId,
  })

  // Optionally collect why the re-run was needed — stored separately so we can
  // learn from it even if the user never answers the archiving question.
  // This creates a second notification card for the "why" question.
  await createWhyRerunQuestion(agencyId, {
    workflowId,
    workflowRunId,
    topic,
    triggeredBy,
    memoryKey,
  })

  await upsertMemory(agencyId, 'behavior_observation', memoryKey, {
    workflowId,
    lastObservedAt: new Date().toISOString(),
    lastTopic:      topic,
    rerunCount:     prevCount,
  }, { workflowId, userId: triggeredBy ?? undefined })
}

async function createWhyRerunQuestion(
  agencyId: string,
  opts: {
    workflowId:    string
    workflowRunId: string
    topic:         string
    triggeredBy:   string | null
    memoryKey:     string
  },
) {
  // Avoid duplicate "why" questions for the same workflow
  if (await pendingNotificationExists(agencyId, 'same_topic_rerun_why', opts.workflowId)) return

  await prisma.pMAgentNotification.create({
    data: {
      agencyId,
      patternKey: 'same_topic_rerun_why',
      title:      `Why did you re-run "${opts.topic}"? (optional)`,
      body:       'Your answer helps me learn when re-runs are quality issues vs. intentional variations, so I can route them smarter over time.',
      context:    { workflowId: opts.workflowId, topic: opts.topic, memoryKey: whyKey } as never,
      actions:    [
        { label: 'Output needed improvement',  value: 'quality_issue',  alwaysApply: false },
        { label: 'Adjusted the prompt',        value: 'prompt_change',  alwaysApply: false },
        { label: 'Wanted a variation',         value: 'variation',      alwaysApply: false },
        { label: 'Testing / experimenting',    value: 'testing',        alwaysApply: false },
        { label: 'Skip — don\'t ask again',    value: 'skip',           alwaysApply: true  },
      ] as never,
      workflowRunId: opts.workflowRunId,
      workflowId:    opts.workflowId,
    },
  })
  console.log(`[pmAgent] why-rerun question created for workflow ${opts.workflowId} topic "${opts.topic}"`)
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processPMAgentJob(job: Job<PMAgentJobData>) {
  const { agencyId, workflowRunId, workflowId, triggerType, triggeredBy, topic } = job.data

  const isAutoTrigger = AUTO_DELIVER_TRIGGERS.has(triggerType ?? '')

  await withAgency(agencyId, async () => {
    if (isAutoTrigger) {
      // Auto-triggered runs deliver immediately and archive same-topic older ones
      await markDelivered(agencyId, workflowRunId)
      await archivePriorRuns(agencyId, workflowId, workflowRunId)
    } else {
      // Manual run — detect same-topic re-runs, surface notification + optional why question
      await detectSameTopicRerun(agencyId, workflowId, workflowRunId, topic ?? null, triggeredBy)
    }
  })

  console.log(`[pmAgent] processed run ${workflowRunId} (trigger: ${triggerType ?? 'manual'})`)
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startPMAgentWorker() {
  const worker = new Worker<PMAgentJobData>(
    QUEUE_PM_AGENT,
    processPMAgentJob,
    { connection: getConnection(), concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[pmAgent] job ${job?.id} failed:`, err)
  })

  return worker
}
