// ─────────────────────────────────────────────────────────────────────────────
// Execution context passed to every executor
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeExecutionContext {
  workflowRunId: string
  agencyId: string
  nodeId: string
  workflowId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Abstract base class for all node executors
// ─────────────────────────────────────────────────────────────────────────────

export abstract class NodeExecutor {
  /**
   * Execute this node.
   *
   * @param input  Output(s) from upstream nodes. Single value if one upstream,
   *               array of values if multiple upstreams.
   * @param config The node's config JSON from the database.
   * @param ctx    Run-scoped context (ids, agency isolation).
   * @returns      Output to be passed to downstream nodes.
   */
  abstract execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult>
}

export interface NodeExecutionResult {
  output: unknown
  /** Token usage to record (only set for AI nodes) */
  tokensUsed?: number
  modelUsed?: string
  /** Routing decision for conditional nodes ('pass' | 'fail') */
  routePath?: string
  /**
   * If true, this node requires human input before the workflow can continue.
   * The runner will pause the run (status → 'awaiting_assignment') and stop
   * processing downstream nodes. The run resumes once the human completes the
   * required action (e.g. speaker assignment) and the run is re-enqueued.
   */
  paused?: boolean
  /** ID of the TranscriptSession created during transcription (used to resume) */
  pendingSessionId?: string
}
