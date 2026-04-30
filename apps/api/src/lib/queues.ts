import { Queue, type ConnectionOptions } from 'bullmq'

// BullMQ needs its own connection (not the shared ioredis instance) so it
// can manage subscriber connections and retry behavior independently.
function getBullMQConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  }
}

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_PATTERN_DETECTION = 'pattern-detection'
export const QUEUE_EDIT_ANALYSIS = 'edit-analysis'
export const QUEUE_FRAMEWORK_RESEARCH = 'framework-research'
export const QUEUE_CLIENT_GTM_UPLOAD = 'client-gtm-upload'
export const QUEUE_PILOT_SESSION_SUMMARY = 'pilot-session-summary'
export const QUEUE_ATTACHMENT_PROCESS = 'attachment-process'
export const QUEUE_BRAND_ATTACHMENT_PROCESS = 'brand-attachment-process'
export const QUEUE_CAMPAIGN_BRAIN_PROCESS = 'campaign-brain-process'
export const QUEUE_CLIENT_BRAIN_PROCESS = 'client-brain-process'
export const QUEUE_AGENCY_BRAIN_PROCESS = 'agency-brain-process'
export const QUEUE_VERTICAL_BRAIN_PROCESS = 'vertical-brain-process'
export const QUEUE_CLIENT_VERTICAL_BRAIN_PROCESS = 'client-vertical-brain-process'
export const QUEUE_PROMPT_SUGGEST = 'prompt-suggestion'
export const QUEUE_SCHEDULED_RESEARCH = 'scheduled-research'
export const QUEUE_BOX_DIFF          = 'box-diff'
export const QUEUE_BOX_VERSION_SCAN  = 'box-version-scan'

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
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

export interface PromptSuggestJobData {
  agencyId: string
  clientId: string
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
  driveFileId?:   string | null
  mondayItemId:   string | null
  originalText:   string
  editedText:     string
  attributedTo:   string   // 'stakeholder' | 'employee' | 'unknown_external'
  editorEmail:    string | null
  filename:       string
  documentType?:  string | null
}

export interface BoxVersionScanJobData {
  agencyId:     string
  clientId:     string
  runId:        string
  boxFolderId:  string
  mondayItemId: string | null
  phase:        'client_review' | 'client_final'  // which Monday status triggered this scan
}

let workflowRunsQueue: Queue<WorkflowRunJobData> | null = null
let patternDetectionQueue: Queue<PatternDetectionJobData> | null = null
let editAnalysisQueue: Queue<EditAnalysisJobData> | null = null
let frameworkResearchQueue: Queue<FrameworkResearchJobData> | null = null
let attachmentProcessQueue: Queue<AttachmentProcessJobData> | null = null
let brandAttachmentProcessQueue: Queue<BrandAttachmentProcessJobData> | null = null
let campaignBrainProcessQueue: Queue<CampaignBrainProcessJobData> | null = null
let clientBrainProcessQueue: Queue<ClientBrainProcessJobData> | null = null
let agencyBrainProcessQueue: Queue<AgencyBrainProcessJobData> | null = null
let verticalBrainProcessQueue: Queue<VerticalBrainProcessJobData> | null = null
let clientVerticalBrainProcessQueue: Queue<ClientVerticalBrainProcessJobData> | null = null
let boxDiffQueue: Queue<BoxDiffJobData> | null = null
let clientGtmUploadQueue: Queue<ClientGtmUploadJobData> | null = null

/**
 * Returns the singleton Queue instance for dispatching workflow run jobs.
 * The API only enqueues — workers do the processing.
 */
export function getWorkflowRunsQueue(): Queue<WorkflowRunJobData> {
  if (!workflowRunsQueue) {
    workflowRunsQueue = new Queue<WorkflowRunJobData>(QUEUE_WORKFLOW_RUNS, {
      connection: getBullMQConnection(),
    })
  }
  return workflowRunsQueue
}

/**
 * Returns the singleton Queue instance for dispatching pattern detection jobs.
 */
export function getPatternDetectionQueue(): Queue<PatternDetectionJobData> {
  if (!patternDetectionQueue) {
    patternDetectionQueue = new Queue<PatternDetectionJobData>(QUEUE_PATTERN_DETECTION, {
      connection: getBullMQConnection(),
    })
  }
  return patternDetectionQueue
}

export function getEditAnalysisQueue(): Queue<EditAnalysisJobData> {
  if (!editAnalysisQueue) {
    editAnalysisQueue = new Queue<EditAnalysisJobData>(QUEUE_EDIT_ANALYSIS, {
      connection: getBullMQConnection(),
    })
  }
  return editAnalysisQueue
}

/**
 * Returns the singleton Queue instance for dispatching framework research jobs.
 */
export function getFrameworkResearchQueue(): Queue<FrameworkResearchJobData> {
  if (!frameworkResearchQueue) {
    frameworkResearchQueue = new Queue<FrameworkResearchJobData>(QUEUE_FRAMEWORK_RESEARCH, {
      connection: getBullMQConnection(),
    })
  }
  return frameworkResearchQueue
}

/**
 * Returns the singleton Queue instance for dispatching per-attachment processing jobs.
 */
export function getAttachmentProcessQueue(): Queue<AttachmentProcessJobData> {
  if (!attachmentProcessQueue) {
    attachmentProcessQueue = new Queue<AttachmentProcessJobData>(QUEUE_ATTACHMENT_PROCESS, {
      connection: getBullMQConnection(),
    })
  }
  return attachmentProcessQueue
}

export function getBrandAttachmentProcessQueue(): Queue<BrandAttachmentProcessJobData> {
  if (!brandAttachmentProcessQueue) {
    brandAttachmentProcessQueue = new Queue<BrandAttachmentProcessJobData>(QUEUE_BRAND_ATTACHMENT_PROCESS, {
      connection: getBullMQConnection(),
    })
  }
  return brandAttachmentProcessQueue
}

export function getCampaignBrainProcessQueue(): Queue<CampaignBrainProcessJobData> {
  if (!campaignBrainProcessQueue) {
    campaignBrainProcessQueue = new Queue<CampaignBrainProcessJobData>(QUEUE_CAMPAIGN_BRAIN_PROCESS, { connection: getBullMQConnection() })
  }
  return campaignBrainProcessQueue
}

export function getClientBrainProcessQueue(): Queue<ClientBrainProcessJobData> {
  if (!clientBrainProcessQueue) {
    clientBrainProcessQueue = new Queue<ClientBrainProcessJobData>(QUEUE_CLIENT_BRAIN_PROCESS, { connection: getBullMQConnection() })
  }
  return clientBrainProcessQueue
}

export function getAgencyBrainProcessQueue(): Queue<AgencyBrainProcessJobData> {
  if (!agencyBrainProcessQueue) {
    agencyBrainProcessQueue = new Queue<AgencyBrainProcessJobData>(QUEUE_AGENCY_BRAIN_PROCESS, { connection: getBullMQConnection() })
  }
  return agencyBrainProcessQueue
}

export function getVerticalBrainProcessQueue(): Queue<VerticalBrainProcessJobData> {
  if (!verticalBrainProcessQueue) {
    verticalBrainProcessQueue = new Queue<VerticalBrainProcessJobData>(QUEUE_VERTICAL_BRAIN_PROCESS, { connection: getBullMQConnection() })
  }
  return verticalBrainProcessQueue
}

export function getClientVerticalBrainProcessQueue(): Queue<ClientVerticalBrainProcessJobData> {
  if (!clientVerticalBrainProcessQueue) {
    clientVerticalBrainProcessQueue = new Queue<ClientVerticalBrainProcessJobData>(QUEUE_CLIENT_VERTICAL_BRAIN_PROCESS, { connection: getBullMQConnection() })
  }
  return clientVerticalBrainProcessQueue
}

let promptSuggestQueue: Queue<PromptSuggestJobData> | null = null
export function getPromptSuggestQueue(): Queue<PromptSuggestJobData> {
  if (!promptSuggestQueue) {
    promptSuggestQueue = new Queue<PromptSuggestJobData>(QUEUE_PROMPT_SUGGEST, { connection: getBullMQConnection() })
  }
  return promptSuggestQueue
}

let scheduledResearchQueue: Queue<ScheduledResearchJobData> | null = null
export function getScheduledResearchQueue(): Queue<ScheduledResearchJobData> {
  if (!scheduledResearchQueue) {
    scheduledResearchQueue = new Queue<ScheduledResearchJobData>(QUEUE_SCHEDULED_RESEARCH, { connection: getBullMQConnection() })
  }
  return scheduledResearchQueue
}

export function getBoxDiffQueue(): Queue<BoxDiffJobData> {
  if (!boxDiffQueue) {
    boxDiffQueue = new Queue<BoxDiffJobData>(QUEUE_BOX_DIFF, { connection: getBullMQConnection() })
  }
  return boxDiffQueue
}

let boxVersionScanQueue: Queue<BoxVersionScanJobData> | null = null
export function getBoxVersionScanQueue(): Queue<BoxVersionScanJobData> {
  if (!boxVersionScanQueue) {
    boxVersionScanQueue = new Queue<BoxVersionScanJobData>(QUEUE_BOX_VERSION_SCAN, { connection: getBullMQConnection() })
  }
  return boxVersionScanQueue
}

export const QUEUE_KIT_GENERATION = 'kit-generation'

export interface KitGenerationJobData {
  sessionId: string
  agencyId: string
  assetIndex: number
}

let kitGenerationQueue: Queue<KitGenerationJobData> | null = null
export function getKitGenerationQueue(): Queue<KitGenerationJobData> {
  if (!kitGenerationQueue) {
    kitGenerationQueue = new Queue<KitGenerationJobData>(QUEUE_KIT_GENERATION, { connection: getBullMQConnection() })
  }
  return kitGenerationQueue
}

export const QUEUE_STORYBOARD_GENERATION = 'storyboard-generation'

export interface StoryboardJobData {
  sessionId: string
  agencyId: string
  framesPerScene: 1 | 2 | 3 | 4
}

let storyboardQueue: Queue<StoryboardJobData> | null = null
export function getStoryboardQueue(): Queue<StoryboardJobData> {
  if (!storyboardQueue) {
    storyboardQueue = new Queue<StoryboardJobData>(QUEUE_STORYBOARD_GENERATION, { connection: getBullMQConnection() })
  }
  return storyboardQueue
}

export function getClientGtmUploadQueue(): Queue<ClientGtmUploadJobData> {
  if (!clientGtmUploadQueue) {
    clientGtmUploadQueue = new Queue<ClientGtmUploadJobData>(QUEUE_CLIENT_GTM_UPLOAD, { connection: getBullMQConnection() })
  }
  return clientGtmUploadQueue
}

let pilotSessionSummaryQueue: Queue<PilotSessionSummaryJobData> | null = null
export function getPilotSessionSummaryQueue(): Queue<PilotSessionSummaryJobData> {
  if (!pilotSessionSummaryQueue) {
    pilotSessionSummaryQueue = new Queue<PilotSessionSummaryJobData>(QUEUE_PILOT_SESSION_SUMMARY, { connection: getBullMQConnection() })
  }
  return pilotSessionSummaryQueue
}

export const QUEUE_BRIEF_EXTRACT = 'brief-extract'

export interface BriefExtractJobData {
  agencyId: string
  clientId: string
  briefId:  string
}

let briefExtractQueue: Queue<BriefExtractJobData> | null = null
export function getBriefExtractQueue(): Queue<BriefExtractJobData> {
  if (!briefExtractQueue) {
    briefExtractQueue = new Queue<BriefExtractJobData>(QUEUE_BRIEF_EXTRACT, { connection: getBullMQConnection() })
  }
  return briefExtractQueue
}
