import { type Job } from 'bullmq'
import {
  createWorker,
  createQueue,
  QUEUE_WORKFLOW_RUNS,
  QUEUE_NODE_EXECUTION,
  QUEUE_TRANSCRIPTION,
  QUEUE_ASSET_GENERATION,
  QUEUE_PATTERN_DETECTION,
  QUEUE_EDIT_ANALYSIS,
  QUEUE_SCHEDULE_CHECKER,
  QUEUE_FRAMEWORK_RESEARCH,
  QUEUE_ATTACHMENT_PROCESS,
  QUEUE_BRAND_ATTACHMENT_PROCESS,
  QUEUE_CAMPAIGN_BRAIN_PROCESS,
  QUEUE_CLIENT_BRAIN_PROCESS,
  QUEUE_PROMPT_SUGGEST,
  type WorkflowRunJobData,
  type NodeExecutionJobData,
  type TranscriptionJobData,
  type AssetGenerationJobData,
  type PatternDetectionJobData,
  type EditAnalysisJobData,
  type FrameworkResearchJobData,
  type AttachmentProcessJobData,
  type BrandAttachmentProcessJobData,
  type CampaignBrainProcessJobData,
  type ClientBrainProcessJobData,
} from './queues.js'
import { WorkflowRunner } from './runner.js'
import { detectPatterns, detectEditPatterns } from './patternDetector.js'
import { runScheduleChecker } from './scheduleChecker.js'
import { runFileCleanup } from './fileCleanup.js'
import { runFrameworkResearch, processAttachment } from './frameworkResearch.js'
import { processBrandAttachment } from './brandExtraction.js'
import { processCampaignBrainAttachment } from './campaignBrainExtraction.js'
import { processClientBrainAttachment } from './clientBrainExtraction.js'
import { generatePromptSuggestions, type PromptSuggestJobData } from './promptSuggester.js'
import { withAgency } from '@contentnode/database'

// ── Env diagnostics (printed once at startup) ─────────────────────────────────
console.log('[worker] env check:',
  'ELEVENLABS_API_KEY:', process.env.ELEVENLABS_API_KEY ? `set (${process.env.ELEVENLABS_API_KEY.slice(0, 8)}...)` : 'NOT SET',
  '| TTS_BASE_URL:', process.env.TTS_BASE_URL ?? 'NOT SET',
  '| MUSIC_BASE_URL:', process.env.MUSIC_BASE_URL ?? 'NOT SET',
)

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

// ── edit-analysis ────────────────────────────────────────────────────────────
const editAnalysisWorker = createWorker<EditAnalysisJobData>(
  QUEUE_EDIT_ANALYSIS,
  async (job: Job<EditAnalysisJobData>) => {
    const { runId, clientId, agencyId } = job.data
    console.log(`[edit-analysis] analyzing edits for run ${runId}, client ${clientId}`)
    await detectEditPatterns(agencyId, clientId, runId)
    console.log(`[edit-analysis] done for client ${clientId}`)
  },
  3
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

// ── brand-attachment-process ──────────────────────────────────────────────────
const brandAttachmentProcessWorker = createWorker<BrandAttachmentProcessJobData>(
  QUEUE_BRAND_ATTACHMENT_PROCESS,
  async (job: Job<BrandAttachmentProcessJobData>) => {
    console.log(`[brand-attachment-process] job started for attachment=${job.data.attachmentId}`)
    try {
      await processBrandAttachment(job.data)
    } catch (err) {
      console.error('[brand-attachment-process] job failed:', err)
      throw err
    }
  },
  5
)

// ── campaign-brain-process ────────────────────────────────────────────────────
const campaignBrainProcessWorker = createWorker<CampaignBrainProcessJobData>(
  QUEUE_CAMPAIGN_BRAIN_PROCESS,
  async (job: Job<CampaignBrainProcessJobData>) => {
    console.log(`[campaign-brain-process] job started for attachment=${job.data.attachmentId} campaign=${job.data.campaignId}`)
    try {
      await processCampaignBrainAttachment(job)
    } catch (err) {
      console.error('[campaign-brain-process] job failed:', err)
      throw err
    }
  },
  5
)

// ── client-brain-process ──────────────────────────────────────────────────────
const clientBrainProcessWorker = createWorker<ClientBrainProcessJobData>(
  QUEUE_CLIENT_BRAIN_PROCESS,
  async (job: Job<ClientBrainProcessJobData>) => {
    console.log(`[client-brain-process] job started for attachment=${job.data.attachmentId} client=${job.data.clientId}`)
    try {
      await processClientBrainAttachment(job)
    } catch (err) {
      console.error('[client-brain-process] job failed:', err)
      throw err
    }
  },
  5
)

// ── prompt-suggestion ─────────────────────────────────────────────────────────
const promptSuggestWorker = createWorker<PromptSuggestJobData>(
  QUEUE_PROMPT_SUGGEST,
  async (job: Job<PromptSuggestJobData>) => {
    console.log(`[prompt-suggestion] generating for client=${job.data.clientId}`)
    try {
      await withAgency(job.data.agencyId, () => generatePromptSuggestions(job.data.clientId, job.data.agencyId))
    } catch (err) {
      console.error('[prompt-suggestion] job failed:', err)
      throw err
    }
  },
  3
)

// ── file-cleanup — runs once per day ─────────────────────────────────────────
const QUEUE_FILE_CLEANUP = 'file-cleanup'
const fileCleanupQueue = createQueue(QUEUE_FILE_CLEANUP)
await fileCleanupQueue.add(
  'daily',
  {},
  {
    jobId: 'file-cleanup-singleton',
    repeat: { every: 24 * 60 * 60_000 }, // every 24 hours
    removeOnComplete: { count: 5 },
    removeOnFail: { count: 5 },
  }
)
const fileCleanupWorker = createWorker(
  QUEUE_FILE_CLEANUP,
  async () => { await runFileCleanup() },
  1
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
    editAnalysisWorker.close(),
    scheduleCheckerWorker.close(),
    frameworkResearchWorker.close(),
    attachmentProcessWorker.close(),
    brandAttachmentProcessWorker.close(),
    fileCleanupWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

console.log('[worker] all queues registered and listening')
