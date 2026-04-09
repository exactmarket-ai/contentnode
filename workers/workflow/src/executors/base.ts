// ─────────────────────────────────────────────────────────────────────────────
// Execution context passed to every executor
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientProfileContext {
  brandTone?: string | null
  formality?: string | null
  pov?: string | null
  signaturePhrases: string[]
  avoidPhrases: string[]
  primaryBuyer: Record<string, unknown>
  secondaryBuyer: Record<string, unknown>
  buyerMotivations: string[]
  buyerFears: string[]
  visualStyle?: string | null
  colorTemperature?: string | null
  currentPositioning?: string | null
  campaignThemesApproved: string[]
  manualOverrides: Array<Record<string, unknown>>
}

export interface NodeExecutionContext {
  workflowRunId: string
  agencyId: string
  nodeId: string
  workflowId: string
  clientId?: string | null
  /** Client brand profile — null if not yet populated */
  clientProfile?: ClientProfileContext | null
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
  /** Number of words processed (for humanizer nodes) */
  wordsProcessed?: number
  /** Filenames processed (for file-upload source nodes) */
  sourceFiles?: string[]
  /**
   * If true, this node requires human input before the workflow can continue.
   * The runner will pause the run (status → 'awaiting_assignment') and stop
   * processing downstream nodes. The run resumes once the human completes the
   * required action (e.g. speaker assignment) and the run is re-enqueued.
   */
  paused?: boolean
  /** ID of the TranscriptSession created during transcription (used to resume) */
  pendingSessionId?: string
  /**
   * If true, this node is waiting for external stakeholder feedback.
   * The runner will pause the run (status → 'waiting_feedback').
   */
  waitingFeedback?: boolean
  /** Node ID to store as pendingFeedbackNodeId in run output */
  pendingFeedbackNodeId?: string
  /** If true, this node is waiting for a human to review/edit the content */
  waitingReview?: boolean
  /** The content to display for human review */
  reviewContent?: string
}
