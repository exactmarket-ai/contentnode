import { Queue } from 'bullmq'
import { getRedis } from './redis.js'

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_PATTERN_DETECTION = 'pattern-detection'
export const QUEUE_EDIT_ANALYSIS = 'edit-analysis'
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

/**
 * Returns the singleton Queue instance for dispatching workflow run jobs.
 * The API only enqueues — workers do the processing.
 */
export function getWorkflowRunsQueue(): Queue<WorkflowRunJobData> {
  if (!workflowRunsQueue) {
    workflowRunsQueue = new Queue<WorkflowRunJobData>(QUEUE_WORKFLOW_RUNS, {
      connection: getRedis(),
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
      connection: getRedis(),
    })
  }
  return patternDetectionQueue
}

export function getEditAnalysisQueue(): Queue<EditAnalysisJobData> {
  if (!editAnalysisQueue) {
    editAnalysisQueue = new Queue<EditAnalysisJobData>(QUEUE_EDIT_ANALYSIS, {
      connection: getRedis(),
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
      connection: getRedis(),
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
      connection: getRedis(),
    })
  }
  return attachmentProcessQueue
}

export function getBrandAttachmentProcessQueue(): Queue<BrandAttachmentProcessJobData> {
  if (!brandAttachmentProcessQueue) {
    brandAttachmentProcessQueue = new Queue<BrandAttachmentProcessJobData>(QUEUE_BRAND_ATTACHMENT_PROCESS, {
      connection: getRedis(),
    })
  }
  return brandAttachmentProcessQueue
}

export function getCampaignBrainProcessQueue(): Queue<CampaignBrainProcessJobData> {
  if (!campaignBrainProcessQueue) {
    campaignBrainProcessQueue = new Queue<CampaignBrainProcessJobData>(QUEUE_CAMPAIGN_BRAIN_PROCESS, { connection: getRedis() })
  }
  return campaignBrainProcessQueue
}

export function getClientBrainProcessQueue(): Queue<ClientBrainProcessJobData> {
  if (!clientBrainProcessQueue) {
    clientBrainProcessQueue = new Queue<ClientBrainProcessJobData>(QUEUE_CLIENT_BRAIN_PROCESS, { connection: getRedis() })
  }
  return clientBrainProcessQueue
}

export function getAgencyBrainProcessQueue(): Queue<AgencyBrainProcessJobData> {
  if (!agencyBrainProcessQueue) {
    agencyBrainProcessQueue = new Queue<AgencyBrainProcessJobData>(QUEUE_AGENCY_BRAIN_PROCESS, { connection: getRedis() })
  }
  return agencyBrainProcessQueue
}

export function getVerticalBrainProcessQueue(): Queue<VerticalBrainProcessJobData> {
  if (!verticalBrainProcessQueue) {
    verticalBrainProcessQueue = new Queue<VerticalBrainProcessJobData>(QUEUE_VERTICAL_BRAIN_PROCESS, { connection: getRedis() })
  }
  return verticalBrainProcessQueue
}

export function getClientVerticalBrainProcessQueue(): Queue<ClientVerticalBrainProcessJobData> {
  if (!clientVerticalBrainProcessQueue) {
    clientVerticalBrainProcessQueue = new Queue<ClientVerticalBrainProcessJobData>(QUEUE_CLIENT_VERTICAL_BRAIN_PROCESS, { connection: getRedis() })
  }
  return clientVerticalBrainProcessQueue
}

let promptSuggestQueue: Queue<PromptSuggestJobData> | null = null
export function getPromptSuggestQueue(): Queue<PromptSuggestJobData> {
  if (!promptSuggestQueue) {
    promptSuggestQueue = new Queue<PromptSuggestJobData>(QUEUE_PROMPT_SUGGEST, { connection: getRedis() })
  }
  return promptSuggestQueue
}

let scheduledResearchQueue: Queue<ScheduledResearchJobData> | null = null
export function getScheduledResearchQueue(): Queue<ScheduledResearchJobData> {
  if (!scheduledResearchQueue) {
    scheduledResearchQueue = new Queue<ScheduledResearchJobData>(QUEUE_SCHEDULED_RESEARCH, { connection: getRedis() })
  }
  return scheduledResearchQueue
}
