import { Queue } from 'bullmq'
import { getRedis } from './redis.js'

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_PATTERN_DETECTION = 'pattern-detection'

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
}

export interface PatternDetectionJobData {
  feedbackId: string
  clientId: string
  agencyId: string
}

let workflowRunsQueue: Queue<WorkflowRunJobData> | null = null
let patternDetectionQueue: Queue<PatternDetectionJobData> | null = null

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
