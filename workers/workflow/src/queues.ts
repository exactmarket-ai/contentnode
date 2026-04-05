import { Queue, Worker, type ConnectionOptions } from 'bullmq'

// ─────────────────────────────────────────────────────────────────────────────
// Queue names — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

export const QUEUE_WORKFLOW_RUNS = 'workflow-runs'
export const QUEUE_NODE_EXECUTION = 'node-execution'
export const QUEUE_TRANSCRIPTION = 'transcription'
export const QUEUE_ASSET_GENERATION = 'asset-generation'

// ─────────────────────────────────────────────────────────────────────────────
// Job data types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowRunJobData {
  workflowRunId: string
  agencyId: string
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
  })
}
