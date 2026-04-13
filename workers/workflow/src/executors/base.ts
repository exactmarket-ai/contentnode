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
  /** Clerk user ID of the user who triggered this run (from WorkflowRun.input) */
  userId?: string | null
  /** Role of the triggering user */
  userRole?: string | null
  /** Resolved permission snapshot stored at run-creation time (for UsageEvent audit trail) */
  resolvedPermissions?: unknown
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

// ─────────────────────────────────────────────────────────────────────────────
// Generated asset reference — stored in node output after file is saved locally
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratedAsset {
  type: 'image' | 'video' | 'audio'
  /** Storage key used by @contentnode/storage (e.g. "generated/abc123.jpg") */
  storageKey: string
  /** Public serving path (e.g. "/files/generated/abc123.jpg") */
  localPath: string
  /** Provider that generated the asset (e.g. "dalle3", "runway", "comfyui") */
  provider: string
  generatedAt: string  // ISO timestamp
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
  /** Generated image/video/audio assets saved to local storage */
  generatedAssets?: GeneratedAsset[]
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
  /**
   * Media billing metadata — set by voice/music/character-animation/video-composition executors.
   * The runner reads this and fires a UsageEvent + UsageRecord for each media API call.
   */
  mediaUsage?: {
    /** Normalized provider: 'elevenlabs' | 'openai' | 'did' | 'heygen' | 'shotstack' | 'local' */
    provider:    string
    /** 'voice_generation' | 'character_animation' | 'music_generation' | 'video_composition' */
    subtype:     string
    /** Output duration in seconds (video/audio). For TTS, use charCount instead. */
    durationSecs?: number
    /** Input characters billed (TTS providers bill per-char) */
    charCount?:    number
    /** Model identifier used (voice model, animation model, etc.) */
    model?:        string
    /** false for local/self-hosted providers (estimatedCostUsd = 0) */
    isOnline:      boolean
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared async polling helper — used by any executor that calls an async API
// ─────────────────────────────────────────────────────────────────────────────

export interface AsyncPollOptions<T> {
  /** Called repeatedly until it returns a non-null result or timeout is reached */
  poll: () => Promise<T | null>
  /** How long to wait between polls (ms). Default: 3000 */
  intervalMs?: number
  /** How long to poll before giving up (ms). Default: 300000 (5 min) */
  timeoutMs?: number
  /** Human-readable label for timeout error messages */
  label?: string
}

/**
 * Polls `options.poll` until it returns a non-null value or the timeout is reached.
 * Waits `intervalMs` between each attempt.
 *
 * Usage:
 *   const result = await asyncPoll({
 *     poll: async () => {
 *       const status = await checkJobStatus(jobId)
 *       return status.done ? status.result : null
 *     },
 *     intervalMs: 5000,
 *     timeoutMs: 120_000,
 *     label: 'image generation',
 *   })
 */
export async function asyncPoll<T>(options: AsyncPollOptions<T>): Promise<T> {
  const { poll, intervalMs = 3000, timeoutMs = 300_000, label = 'async operation' } = options
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const result = await poll()
    if (result !== null) return result
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs / 1000}s`)
}
