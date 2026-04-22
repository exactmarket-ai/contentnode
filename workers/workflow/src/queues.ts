import { Queue, Worker, type ConnectionOptions } from 'bullmq'

// ─────────────────────────────────────────────────────────────────────────────
// Queue names — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_NODE_EXECUTION = 'node-execution'
export const QUEUE_TRANSCRIPTION = 'transcription'
export const QUEUE_ASSET_GENERATION = 'asset-generation'
export const QUEUE_PATTERN_DETECTION = 'pattern-detection'
export const QUEUE_EDIT_ANALYSIS = 'edit-analysis'
export const QUEUE_SCHEDULE_CHECKER = 'schedule-checker'
export const QUEUE_FRAMEWORK_RESEARCH = 'framework-research'
export const QUEUE_ATTACHMENT_PROCESS = 'attachment-process'
export const QUEUE_BRAND_ATTACHMENT_PROCESS = 'brand-attachment-process'
export const QUEUE_CAMPAIGN_BRAIN_PROCESS = 'campaign-brain-process'
export const QUEUE_CLIENT_BRAIN_PROCESS = 'client-brain-process'
export const QUEUE_AGENCY_BRAIN_PROCESS = 'agency-brain-process'
export const QUEUE_VERTICAL_BRAIN_PROCESS = 'vertical-brain-process'
export const QUEUE_CLIENT_VERTICAL_BRAIN_PROCESS = 'client-vertical-brain-process'
export const QUEUE_PROMPT_SUGGEST = 'prompt-suggestion'
export const QUEUE_SCHEDULED_RESEARCH = 'scheduled-research'
export const QUEUE_RESEARCH_CHECKER = 'research-checker'

// ─────────────────────────────────────────────────────────────────────────────
// Job data types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
  /** When set, only ancestors of this node (+ the node itself) are executed */
  stopAtNodeId?: string
}

export interface NodeExecutionJobData {
  workflowRunId: string
  nodeId: string
  agencyId: string
  input: unknown
}

export interface TranscriptionJobData {
  sessionId: string
  agencyId: string
  storageKey: string
}

export interface AssetGenerationJobData {
  agencyId: string
  workflowRunId: string
  nodeId: string
  assetType: 'image' | 'audio' | 'video'
  prompt: string
}

export interface PatternDetectionJobData {
  feedbackId: string
  clientId: string
  agencyId: string
}

export interface EditAnalysisJobData {
  runId: string
  clientId: string
  agencyId: string
}

export interface FrameworkResearchJobData {
  agencyId: string
  clientId: string
  verticalId: string
  websiteUrl?: string
}

export interface AttachmentProcessJobData {
  agencyId: string
  attachmentId: string
  clientName: string
  verticalName: string
}

export interface BrandAttachmentProcessJobData {
  agencyId: string
  attachmentId: string
  clientId: string
  verticalId: string | null
  url?: string // if set, scrape this URL instead of downloading from storage
}

export interface CampaignBrainProcessJobData {
  agencyId: string
  attachmentId: string
  campaignId: string
  url?: string // set when processing a URL source
}

export interface ClientBrainProcessJobData {
  agencyId: string
  attachmentId: string
  clientId: string
  url?: string
}

export interface AgencyBrainProcessJobData {
  agencyId: string
  attachmentId: string
  url?: string
}

export interface VerticalBrainProcessJobData {
  agencyId: string
  attachmentId: string
  verticalId: string
  url?: string
}

export interface ClientVerticalBrainProcessJobData {
  agencyId: string
  attachmentId: string
  clientId: string
  verticalId: string
  url?: string
}

export interface ScheduledResearchJobData {
  taskId: string
  agencyId: string
  programId?: string
  clientId?: string
  manual?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection helper
// ─────────────────────────────────────────────────────────────────────────────

export function getConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  // Parse redis://[user:pass@]host:port into ConnectionOptions
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue factory — call from API to enqueue, call from worker to process
// ─────────────────────────────────────────────────────────────────────────────

export function createQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: getConnection() })
}

export function createWorker<T>(
  name: string,
  processor: ConstructorParameters<typeof Worker<T>>[1],
  concurrency = 5
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: getConnection(),
    concurrency,
    lockDuration: 60000,       // 60s lock per job (default 30s)
    stalledInterval: 5000,     // check for stalled jobs every 5s (default 30s)
    maxStalledCount: 1,        // re-queue stalled jobs once, then fail them
  })
}
