import { Queue } from 'bullmq'
import { getRedis } from './redis.js'

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_PATTERN_DETECTION = 'pattern-detection'
export const QUEUE_FRAMEWORK_RESEARCH = 'framework-research'
export const QUEUE_ATTACHMENT_PROCESS = 'attachment-process'
export const QUEUE_BRAND_ATTACHMENT_PROCESS = 'brand-attachment-process'

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
}

export interface PatternDetectionJobData {
  feedbackId: string
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
}

let workflowRunsQueue: Queue<WorkflowRunJobData> | null = null
let patternDetectionQueue: Queue<PatternDetectionJobData> | null = null
let frameworkResearchQueue: Queue<FrameworkResearchJobData> | null = null
let attachmentProcessQueue: Queue<AttachmentProcessJobData> | null = null
let brandAttachmentProcessQueue: Queue<BrandAttachmentProcessJobData> | null = null

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
