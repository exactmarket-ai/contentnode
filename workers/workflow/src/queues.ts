import { Queue, Worker, type ConnectionOptions } from 'bullmq'

// ─────────────────────────────────────────────────────────────────────────────
// Queue names — single source of truth
// Set QUEUE_ENV_PREFIX (e.g. "staging") to isolate environments that share Redis.
// ─────────────────────────────────────────────────────────────────────────────

const _p = process.env.QUEUE_ENV_PREFIX ? `${process.env.QUEUE_ENV_PREFIX}:` : ''

export const QUEUE_WORKFLOW_RUNS                  = `${_p}workflow-runs`
export const QUEUE_NODE_EXECUTION                 = `${_p}node-execution`
export const QUEUE_TRANSCRIPTION                  = `${_p}transcription`
export const QUEUE_ASSET_GENERATION               = `${_p}asset-generation`
export const QUEUE_PATTERN_DETECTION              = `${_p}pattern-detection`
export const QUEUE_EDIT_ANALYSIS                  = `${_p}edit-analysis`
export const QUEUE_SCHEDULE_CHECKER               = `${_p}schedule-checker`
export const QUEUE_FRAMEWORK_RESEARCH             = `${_p}framework-research`
export const QUEUE_ATTACHMENT_PROCESS             = `${_p}attachment-process`
export const QUEUE_BRAND_ATTACHMENT_PROCESS       = `${_p}brand-attachment-process`
export const QUEUE_CAMPAIGN_BRAIN_PROCESS         = `${_p}campaign-brain-process`
export const QUEUE_CLIENT_BRAIN_PROCESS           = `${_p}client-brain-process`
export const QUEUE_AGENCY_BRAIN_PROCESS           = `${_p}agency-brain-process`
export const QUEUE_VERTICAL_BRAIN_PROCESS         = `${_p}vertical-brain-process`
export const QUEUE_CLIENT_VERTICAL_BRAIN_PROCESS  = `${_p}client-vertical-brain-process`
export const QUEUE_PROMPT_SUGGEST                 = `${_p}prompt-suggestion`
export const QUEUE_SCHEDULED_RESEARCH             = `${_p}scheduled-research`
export const QUEUE_RESEARCH_CHECKER               = `${_p}research-checker`
export const QUEUE_BOX_DIFF                       = `${_p}box-diff`

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

export interface BoxDiffJobData {
  agencyId:       string
  clientId:       string
  runId:          string | null
  stakeholderId:  string | null
  boxFileId:      string
  mondayItemId:   string | null
  originalText:   string
  editedText:     string
  attributedTo:   string   // 'stakeholder' | 'employee' | 'unknown_external'
  editorEmail:    string | null
  filename:       string
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection helper
// ─────────────────────────────────────────────────────────────────────────────

export function getConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const parsed = new URL(url)
  const isTls = url.startsWith('rediss://')
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || (isTls ? '6380' : '6379'), 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(isTls ? { tls: {} } : {}),
    // Ensure ioredis retries indefinitely rather than giving up silently
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
