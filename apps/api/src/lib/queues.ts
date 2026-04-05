import { Queue } from 'bullmq'
import { getRedis } from './redis.js'

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
}

let workflowRunsQueue: Queue<WorkflowRunJobData> | null = null

/**
 * Returns the singleton Queue instance for dispatching workflow run jobs.
 * The API only enqueues — workers do the processing.
 */
export function getWorkflowRunsQueue(): Queue<WorkflowRunJobData> {
  if (!workflowRunsQueue) {
    // BullMQ accepts an ioredis instance directly as the connection
    workflowRunsQueue = new Queue<WorkflowRunJobData>(QUEUE_WORKFLOW_RUNS, {
      connection: getRedis(),
    })
  }
  return workflowRunsQueue
}
