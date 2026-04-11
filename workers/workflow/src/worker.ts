import { type Job } from 'bullmq'
import {
  createWorker,
  createQueue,
  QUEUE_WORKFLOW_RUNS,
  QUEUE_NODE_EXECUTION,
  QUEUE_TRANSCRIPTION,
  QUEUE_ASSET_GENERATION,
  QUEUE_PATTERN_DETECTION,
  QUEUE_SCHEDULE_CHECKER,
  QUEUE_FRAMEWORK_RESEARCH,
  QUEUE_ATTACHMENT_PROCESS,
  type WorkflowRunJobData,
  type NodeExecutionJobData,
  type TranscriptionJobData,
  type AssetGenerationJobData,
  type PatternDetectionJobData,
  type FrameworkResearchJobData,
  type AttachmentProcessJobData,
} from './queues.js'
import { WorkflowRunner } from './runner.js'
import { detectPatterns } from './patternDetector.js'
import { runScheduleChecker } from './scheduleChecker.js'
import { runFrameworkResearch, processAttachment } from './frameworkResearch.js'

// ── workflow-runs ─────────────────────────────────────────────────────────────
const workflowRunsWorker = createWorker<WorkflowRunJobData>(
  QUEUE_WORKFLOW_RUNS,
  async (job: Job<WorkflowRunJobData>) => {
    const { workflowRunId, agencyId, stopAtNodeId } = job.data
    console.log(`[workflow-runs] starting run ${workflowRunId}${stopAtNodeId ? ` (stop at ${stopAtNodeId})` : ''}`)
    const runner = new WorkflowRunner(workflowRunId, agencyId, stopAtNodeId)
    try {
      await runner.run()
      console.log(`[workflow-runs] finished run ${workflowRunId}`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[workflow-runs] run ${workflowRunId} crashed:`, errorMessage)
      // Mark run as failed so the frontend doesn't stay stuck at "running"
      try {
        const { prisma, withAgency } = await import('@contentnode/database')
        await withAgency(agencyId, async () => {
          await prisma.workflowRun.update({
            where: { id: workflowRunId },
            data: { status: 'failed', completedAt: new Date(), errorMessage },
          })
        })
      } catch (dbErr) {
        console.error(`[workflow-runs] failed to mark run ${workflowRunId} as failed:`, dbErr)
      }
      throw err // re-throw so BullMQ marks the job as failed
    }
  },
  3 // max 3 concurrent workflow runs
)

// ── node-execution ────────────────────────────────────────────────────────────
// Individual node jobs can be dispatched here for external orchestration.
// The WorkflowRunner handles parallelism internally via Promise.all, but this
// queue exists for future distributed node execution scenarios.
const nodeExecutionWorker = createWorker<NodeExecutionJobData>(
  QUEUE_NODE_EXECUTION,
  async (job: Job<NodeExecutionJobData>) => {
    console.log(`[node-execution] node ${job.data.nodeId} in run ${job.data.workflowRunId}`)
    // Future: allow external systems to enqueue individual node execution
  },
  10
)

// ── transcription ─────────────────────────────────────────────────────────────
const transcriptionWorker = createWorker<TranscriptionJobData>(
  QUEUE_TRANSCRIPTION,
  async (job: Job<TranscriptionJobData>) => {
    console.log(`[transcription] session ${job.data.sessionId}`)
    // Future: call Whisper / Deepgram to transcribe audio at storageKey
  },
  5
)

// ── pattern-detection ─────────────────────────────────────────────────────────
const patternDetectionWorker = createWorker<PatternDetectionJobData>(
  QUEUE_PATTERN_DETECTION,
  async (job: Job<PatternDetectionJobData>) => {
    const { feedbackId, clientId, agencyId } = job.data
    console.log(`[pattern-detection] analyzing feedback ${feedbackId} for client ${clientId}`)
    await detectPatterns(feedbackId, clientId, agencyId)
    console.log(`[pattern-detection] done for client ${clientId}`)
  },
  5
)

// ── asset-generation ──────────────────────────────────────────────────────────
const assetGenerationWorker = createWorker<AssetGenerationJobData>(
  QUEUE_ASSET_GENERATION,
  async (job: Job<AssetGenerationJobData>) => {
    console.log(`[asset-generation] ${job.data.assetType} for run ${job.data.workflowRunId}`)
    // Future: call image/audio/video generation APIs
  },
  3
)

// ── schedule-checker — fires every 60s ───────────────────────────────────────
const scheduleCheckerQueue = createQueue(QUEUE_SCHEDULE_CHECKER)
await scheduleCheckerQueue.add(
  'tick',
  {},
  {
    jobId: 'schedule-checker-singleton',
    repeat: { every: 60_000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
  }
)
const scheduleCheckerWorker = createWorker(
  QUEUE_SCHEDULE_CHECKER,
  async () => { await runScheduleChecker() },
  1
)

// ── framework-research ────────────────────────────────────────────────────────
const frameworkResearchWorker = createWorker<FrameworkResearchJobData>(
  QUEUE_FRAMEWORK_RESEARCH,
  async (job: Job<FrameworkResearchJobData>) => {
    console.log(`[framework-research] job started for client=${job.data.clientId}`)
    try {
      await runFrameworkResearch(job.data)
    } catch (err) {
      console.error('[framework-research] job failed:', err)
      // Mark as failed in DB so UI can show error state
      try {
        const { prisma, withAgency } = await import('@contentnode/database')
        await withAgency(job.data.agencyId, async () => {
          await prisma.clientFrameworkResearch.updateMany({
            where: { clientId: job.data.clientId, verticalId: job.data.verticalId },
            data: { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) },
          })
        })
      } catch { /* ignore */ }
      throw err
    }
  },
  2
)

// ── attachment-process ────────────────────────────────────────────────────────
const attachmentProcessWorker = createWorker<AttachmentProcessJobData>(
  QUEUE_ATTACHMENT_PROCESS,
  async (job: Job<AttachmentProcessJobData>) => {
    console.log(`[attachment-process] job started for attachment=${job.data.attachmentId}`)
    try {
      await processAttachment(job.data)
    } catch (err) {
      console.error('[attachment-process] job failed:', err)
      throw err
    }
  },
  5
)

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  console.log('[worker] shutting down gracefully...')
  await Promise.all([
    workflowRunsWorker.close(),
    nodeExecutionWorker.close(),
    transcriptionWorker.close(),
    assetGenerationWorker.close(),
    patternDetectionWorker.close(),
    scheduleCheckerWorker.close(),
    frameworkResearchWorker.close(),
    attachmentProcessWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

console.log('[worker] all queues registered and listening')
