import { type Job } from 'bullmq'
import {
  createWorker,
  QUEUE_WORKFLOW_RUNS,
  QUEUE_NODE_EXECUTION,
  QUEUE_TRANSCRIPTION,
  QUEUE_ASSET_GENERATION,
  QUEUE_PATTERN_DETECTION,
  type WorkflowRunJobData,
  type NodeExecutionJobData,
  type TranscriptionJobData,
  type AssetGenerationJobData,
  type PatternDetectionJobData,
} from './queues.js'
import { WorkflowRunner } from './runner.js'
import { detectPatterns } from './patternDetector.js'

// ── workflow-runs ─────────────────────────────────────────────────────────────
const workflowRunsWorker = createWorker<WorkflowRunJobData>(
  QUEUE_WORKFLOW_RUNS,
  async (job: Job<WorkflowRunJobData>) => {
    const { workflowRunId, agencyId } = job.data
    console.log(`[workflow-runs] starting run ${workflowRunId}`)
    const runner = new WorkflowRunner(workflowRunId, agencyId)
    await runner.run()
    console.log(`[workflow-runs] finished run ${workflowRunId}`)
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

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  console.log('[worker] shutting down gracefully...')
  await Promise.all([
    workflowRunsWorker.close(),
    nodeExecutionWorker.close(),
    transcriptionWorker.close(),
    assetGenerationWorker.close(),
    patternDetectionWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

console.log('[worker] all queues registered and listening')
