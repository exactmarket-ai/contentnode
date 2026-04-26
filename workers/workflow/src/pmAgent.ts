/**
 * pmAgent — ContentNode's AI project manager
 *
 * Fires after every WorkflowRun completes. Reasons over objective signals
 * (detection scores, retry counts, run frequency, trigger type) to make
 * routing decisions and detect behavioral patterns.
 *
 * Phase 1: run archiving, auto-delivery for non-manual triggers, rapid-run detection
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

// Runs of same workflow within this window = rapid-run pattern (testing)
const RAPID_RUN_WINDOW_MS  = 60 * 60 * 1000  // 1 hour
const RAPID_RUN_THRESHOLD  = 5               // 5+ runs = flag for investigation

// Trigger types that auto-deliver without human "mark as sent"
const AUTO_DELIVER_TRIGGERS = new Set(['scheduled', 'monday_webhook', 'campaign', 'api', 'program'])

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getRecentRunsForWorkflow(
  agencyId: string,
  workflowId: string,
  windowMs: number,
): Promise<{ id: string; triggerType: string | null; triggeredBy: string | null; createdAt: Date; isArchived: boolean }[]> {
  const since = new Date(Date.now() - windowMs)
  return prisma.workflowRun.findMany({
    where: { agencyId, workflowId, createdAt: { gte: since }, status: { in: ['completed', 'failed'] } },
    select: { id: true, triggerType: true, triggeredBy: true, createdAt: true, isArchived: true },
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

async function detectRapidRuns(
  agencyId: string,
  workflowId: string,
  workflowRunId: string,
  triggeredBy: string | null,
) {
  const recentRuns = await getRecentRunsForWorkflow(agencyId, workflowId, RAPID_RUN_WINDOW_MS)
  const manualRuns = recentRuns.filter((r) => !AUTO_DELIVER_TRIGGERS.has(r.triggerType ?? '') && !r.isArchived)

  if (manualRuns.length < RAPID_RUN_THRESHOLD) return

  // Check if we already have a memory entry saying "always archive rapid runs"
  const existing = await getMemory(agencyId, 'behavior_observation', `rapid_runs_workflow_${workflowId}`)
  if (existing?.userAnswer === 'always_archive') {
    // User already told us — archive silently
    await archivePriorRuns(agencyId, workflowId, workflowRunId)
    return
  }

  // Surface a notification asking what to do
  const runIds = manualRuns.map((r) => r.id)
  await createNotification(agencyId, {
    patternKey:    'rapid_manual_runs',
    title:         `${manualRuns.length} runs in the last hour — were you testing?`,
    body:          `I noticed you ran this workflow ${manualRuns.length} times in the past hour. Should I archive the earlier runs and keep your Reviews clean?`,
    context:       { workflowId, runIds, runCount: manualRuns.length },
    actions: [
      { label: 'Archive earlier runs',        value: 'archive',        alwaysApply: false },
      { label: 'Always archive when testing', value: 'always_archive', alwaysApply: true  },
      { label: 'Keep all runs',               value: 'keep',           alwaysApply: false },
    ],
    workflowRunId,
    workflowId,
  })

  // Record the observation in memory regardless of answer
  await upsertMemory(agencyId, 'behavior_observation', `rapid_runs_workflow_${workflowId}`, {
    workflowId,
    lastObservedAt: new Date().toISOString(),
    runCount:       manualRuns.length,
  }, { workflowId, userId: triggeredBy ?? undefined })
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processPMAgentJob(job: Job<PMAgentJobData>) {
  const { agencyId, workflowRunId, workflowId, triggerType, triggeredBy } = job.data

  const isAutoTrigger = AUTO_DELIVER_TRIGGERS.has(triggerType ?? '')

  await withAgency(agencyId, async () => {
    if (isAutoTrigger) {
      // Auto-triggered runs deliver immediately and archive older ones
      await markDelivered(agencyId, workflowRunId)
      await archivePriorRuns(agencyId, workflowId, workflowRunId)
    } else {
      // Manual run — detect rapid-run pattern, surface notification if needed
      await detectRapidRuns(agencyId, workflowId, workflowRunId, triggeredBy)
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
