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
export const QUEUE_CLIENT_GTM_UPLOAD              = `${_p}client-gtm-upload`
export const QUEUE_PILOT_SESSION_SUMMARY          = `${_p}pilot-session-summary`
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
export const QUEUE_PM_AGENT                       = `${_p}pm-agent`
export const QUEUE_BRAIN_COLLAPSE                 = `${_p}brain-collapse`
export const QUEUE_PRINCIPLE_INFERENCE            = `${_p}principle-inference`
export const QUEUE_BOX_VERSION_SCAN               = `${_p}box-version-scan`
export const QUEUE_KIT_GENERATION                 = `${_p}kit-generation`
export const QUEUE_STORYBOARD_GENERATION          = `${_p}storyboard-generation`
export const QUEUE_STORYBOARD_SCENE               = `${_p}storyboard-scene`
export const QUEUE_STORYBOARD_ASSEMBLE            = `${_p}storyboard-assemble`
export const QUEUE_BRIEF_EXTRACT                  = `${_p}brief-extract`
export const QUEUE_NEWSROOM_RESEARCH              = 'newsroom-research'
export const QUEUE_CONTENT_PACK_GENERATION        = `${_p}content-pack-generation`
export const QUEUE_PROMPT_PROPAGATION             = `${_p}prompt-propagation`
export const QUEUE_THOUGHT_LEADER_SOCIAL_SYNC     = `${_p}thought-leader-social-sync`
export const QUEUE_CONTENT_LIBRARY_EDIT_SIGNAL    = `${_p}content-library-edit-signal`
export const QUEUE_HUMANIZER_SYNTHESIS            = `${_p}humanizer-synthesis`
export const QUEUE_INSIGHT_SYNTHESIS              = `${_p}insight-synthesis`

export interface ContentPackGenJobData {
  agencyId:         string
  clientId:         string
  runId:            string
  itemId:           string
  promptTemplateId: string
  promptName:       string
  topicId:          string
  topicTitle:       string
  topicSummary:     string
  targetType:       'member' | 'vertical' | 'company'
  targetId:         string | null
  targetName:       string | null
}

export interface NewsroomResearchJobData {
  agencyId:      string
  clientId:      string
  verticalId:    string | null
  userId:        string | null
  jobId:         string
  recencyWindow: string
}

export interface KitGenerationJobData {
  sessionId: string
  agencyId: string
  assetIndex: number  // 0-7
}

export interface StoryboardJobData {
  sessionId: string
  agencyId: string
  framesPerScene: 1 | 2 | 3 | 4
}

export interface StoryboardSceneJobData {
  sessionId: string
  agencyId: string
  sceneNumber: number
  framesPerScene: 1 | 2 | 3 | 4
}

export interface StoryboardAssembleJobData {
  sessionId: string
  agencyId: string
}

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
  companyBrief?: string
  researchMode?: 'established' | 'new_vertical'
  mergeWithExisting?: boolean
}

export interface ClientGtmUploadJobData {
  agencyId: string
  clientId: string
  verticalId: string
  uploadId: string
}

export interface PilotSessionSummaryJobData {
  agencyId: string
  clientId: string
  verticalId: string
  sessionId: string
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
  boxFileId:      string | null   // null for Google Drive sourced diffs
  driveFileId?:   string | null   // set for Google Drive sourced diffs
  mondayItemId:   string | null
  originalText:   string
  editedText:     string
  attributedTo:   string   // 'stakeholder' | 'employee' | 'unknown_external'
  editorEmail:    string | null
  filename:       string
  documentType:   string | null  // inferred from filename: blog | email | social | ad_copy | landing_page | executive_brief | video_script
}

export interface BrainCollapseJobData {
  agencyId: string
  clientId: string
}

export interface PrincipleInferenceJobData {
  agencyId:      string
  stakeholderId: string
}

export interface BoxVersionScanJobData {
  agencyId:     string
  clientId:     string
  runId:        string
  boxFolderId:  string
  mondayItemId: string | null
  phase:        'client_review' | 'client_final'
}

export interface PMAgentJobData {
  agencyId:      string
  workflowRunId: string
  workflowId:    string
  triggerType:   string | null  // manual | scheduled | monday_webhook | campaign | etc.
  triggeredBy:   string | null  // userId who triggered (for manual runs)
  topic:         string | null  // Start Run Topic — used to detect same-topic re-runs
  completedAt:   string         // ISO timestamp
}

export interface BriefExtractJobData {
  agencyId:  string
  clientId:  string
  briefId:   string
}

export interface PromptPropagationJobData {
  agencyId:   string
  templateId: string
}

export interface ThoughtLeaderSocialSyncJobData {
  agencyId:            string
  leadershipMemberId:  string
  synthesizeOnly?:     boolean  // when true, skip the social fetch and only run synthesis
}

export interface ContentLibraryEditSignalJobData {
  agencyId:        string
  clientId:        string
  itemId:          string
  promptName:      string
  targetType:      string   // 'member' | 'vertical' | 'company'
  targetId:        string | null
  content:         string
  originalContent: string
  signalType:      'save' | 'approval'
  userId:          string | null  // internal DB User.id (not Clerk sub)
  previousContent: string | null  // content before this save (for save signals)
}

export interface HumanizerSynthesisJobData {
  agencyId:  string
  scope:     'agency' | 'client' | 'content_type' | 'user'
  scopeId:   string | null
}

export interface InsightSynthesisJobData {
  insightId: string
  agencyId:  string
  clientId:  string
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
  concurrency = 5,
  overrides?: { lockDuration?: number }
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: getConnection(),
    concurrency,
    lockDuration: overrides?.lockDuration ?? 60000,
    stalledInterval: 5000,     // check for stalled jobs every 5s (default 30s)
    maxStalledCount: 1,        // re-queue stalled jobs once, then fail them
  })
}
