import { createHash } from 'node:crypto'
import { prisma, withAgency, auditService, usageEventService, costEstimator, type Prisma } from '@contentnode/database'
import { SourceNodeExecutor } from './executors/source.js'
import { LogicNodeExecutor } from './executors/logic.js'
import { OutputNodeExecutor } from './executors/output.js'
import { DetectionNodeExecutor } from './executors/detection.js'
import { HumanizerNodeExecutor } from './executors/humanizer.js'
import { ConditionalBranchNodeExecutor } from './executors/conditional_branch.js'
import { TranscriptionNodeExecutor } from './executors/transcription.js'
import { FeedbackNodeExecutor } from './executors/feedback.js'
import { InsightNodeExecutor } from './executors/insight.js'
import { HumanReviewNodeExecutor } from './executors/human_review.js'
import { EmailNodeExecutor } from './executors/email.js'
import { WebhookNodeExecutor } from './executors/webhook.js'
import { TranslationNodeExecutor } from './executors/translation.js'
import { QualityReviewNodeExecutor } from './executors/qualityReview.js'
import { InstructionTranslatorExecutor } from './executors/instructionTranslator.js'
import { ImagePromptBuilderExecutor } from './executors/imagePromptBuilder.js'
import { ImageGenerationExecutor } from './executors/imageGeneration.js'
import { VideoPromptBuilderExecutor } from './executors/videoPromptBuilder.js'
import { VideoGenerationExecutor } from './executors/videoGeneration.js'
import { VideoFrameExtractorExecutor } from './executors/videoFrameExtractor.js'
import { VideoUploadExecutor } from './executors/videoUpload.js'
import { VideoTranscriptionExecutor } from './executors/videoTranscription.js'
import { VideoIntelligenceExecutor } from './executors/videoIntelligence.js'
import { ImageResizeExecutor } from './executors/imageResize.js'
import { MediaDownloadExecutor } from './executors/mediaDownload.js'
import { WorkflowOutputExecutor } from './executors/workflowOutput.js'
import { GtmFrameworkExecutor } from './executors/gtmFramework.js'
import { BrandContextExecutor } from './executors/brandContext.js'
import { ClientBrainExecutor } from './executors/clientBrain.js'
import { HtmlPageExecutor } from './executors/htmlPage.js'
import { VoiceOutputNodeExecutor } from './executors/voiceOutput.js'
import { MusicGenerationNodeExecutor } from './executors/musicGeneration.js'
import { AudioMixNodeExecutor } from './executors/audioMix.js'
import { AudioInputNodeExecutor } from './executors/audioInput.js'
import { CharacterAnimationNodeExecutor } from './executors/characterAnimation.js'
import { VideoCompositionExecutor } from './executors/videoComposition.js'
import { VideoTrimmerExecutor } from './executors/videoTrimmer.js'
import { VideoResizeExecutor } from './executors/videoResize.js'
import { AudioReplaceExecutor } from './executors/audioReplace.js'
import { DeepWebScrapeExecutor } from './executors/deepWebScrape.js'
import { ReviewMinerExecutor } from './executors/reviewMiner.js'
import { SeoIntentExecutor } from './executors/seoIntent.js'
import { AudienceSignalExecutor } from './executors/audienceSignal.js'
import { WrikeSourceExecutor } from './executors/wrikeSource.js'
import type { NodeExecutor, NodeExecutionContext } from './executors/base.js'
import { trackInsightOutcomes } from './patternDetector.js'
import { extractAndSaveQuality } from './qualityExtractor.js'
import { deliverRunToBox, deliverImageToBox } from './boxDelivery.js'

// ─────────────────────────────────────────────────────────────────────────────
// Per-node status stored inside WorkflowRun.output
// ─────────────────────────────────────────────────────────────────────────────

export type NodeRunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'

export interface NodeStatus {
  status: NodeRunStatus
  output?: unknown
  error?: string
  startedAt?: string
  completedAt?: string
  tokensUsed?: number
  modelUsed?: string
  /** Set when detection score does not improve after repeated passes */
  warning?: string
  /** Set when this node is awaiting human input (e.g. speaker assignment) */
  paused?: boolean
  /** Words processed by this node (humanizer nodes) */
  wordsProcessed?: number
  /** Filenames processed by this node (source/file-upload nodes) */
  sourceFiles?: string[]
}

export interface RunOutput {
  nodeStatuses: Record<string, NodeStatus>
  finalOutput?: unknown
  /** Retry tracking per detection node — scoreHistory[0] is initial score, each retry appends */
  detectionState?: Record<string, { retryCount: number; lastScore: number; scoreHistory: number[] }>
  /** ID of a TranscriptSession awaiting speaker assignment before the run can proceed */
  pendingTranscriptionSessionId?: string
  /** ID of the feedback node whose portal access is being set up */
  pendingFeedbackNodeId?: string
  /** Node ID of a Human Review node awaiting human approval */
  pendingReviewNodeId?: string
  /** Content surfaced for human review/editing */
  pendingReviewContent?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Node executor registry — routes by "type" or "type:subtype"
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_REGISTRY: Record<string, new () => NodeExecutor> = {
  source:                          SourceNodeExecutor,
  'source:transcription':          TranscriptionNodeExecutor,
  'source:video-frame-extractor':  VideoFrameExtractorExecutor, // legacy compat
  'source:video-upload':           VideoUploadExecutor,
  'source:instruction-translator': InstructionTranslatorExecutor,
  'source:workflow-output':        WorkflowOutputExecutor,
  logic:                       LogicNodeExecutor,
  'logic:humanizer':           HumanizerNodeExecutor,
  'logic:humanizer-pro':       HumanizerNodeExecutor,
  'logic:detection':           DetectionNodeExecutor,
  'logic:conditional-branch':  ConditionalBranchNodeExecutor,
  output:                      OutputNodeExecutor,
  'output:client-feedback':    FeedbackNodeExecutor,
  'output:email':              EmailNodeExecutor,
  'output:webhook':            WebhookNodeExecutor,
  'output:html-page':          HtmlPageExecutor,
  insight:                     InsightNodeExecutor,
  gtm_framework:               GtmFrameworkExecutor,
  brand_context:               BrandContextExecutor,
  client_brain:                ClientBrainExecutor,
  'logic:human-review':        HumanReviewNodeExecutor,
  'logic:translate':           TranslationNodeExecutor,
  'logic:quality-review':      QualityReviewNodeExecutor,
  'logic:image-prompt-builder': ImagePromptBuilderExecutor,
  'output:image-generation':   ImageGenerationExecutor,
  'logic:video-prompt-builder':    VideoPromptBuilderExecutor,
  'logic:video-frame-extractor':   VideoFrameExtractorExecutor,
  'logic:video-transcription':     VideoTranscriptionExecutor,
  'logic:video-intelligence':      VideoIntelligenceExecutor,
  'logic:image-resize':            ImageResizeExecutor,
  'output:video-generation':       VideoGenerationExecutor,
  'output:media-download':         MediaDownloadExecutor,
  'voice_output':                  VoiceOutputNodeExecutor,
  'music_generation':              MusicGenerationNodeExecutor,
  'audio_mix':                     AudioMixNodeExecutor,
  'audio_input':                   AudioInputNodeExecutor,
  'character_animation':           CharacterAnimationNodeExecutor,
  'video_composition':             VideoCompositionExecutor,
  'logic:video-trimmer':           VideoTrimmerExecutor,
  'logic:video-resize':            VideoResizeExecutor,
  'audio_replace':                 AudioReplaceExecutor,
  // Phase 3 — Intelligence Tools
  'deep_web_scrape':               DeepWebScrapeExecutor,
  'review_miner':                  ReviewMinerExecutor,
  'seo_intent':                    SeoIntentExecutor,
  'audience_signal':               AudienceSignalExecutor,
  // Integrations
  'wrike_source':                  WrikeSourceExecutor,
}

async function loadTranscriptText(sessionId: string): Promise<string | null> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { sessionId },
    orderBy: { startMs: 'asc' },
    select: { speakerName: true, speaker: true, text: true },
  })
  if (segments.length === 0) return null
  return segments
    .map((s) => `${s.speakerName ?? `Speaker ${s.speaker}`}: ${s.text}`)
    .join('\n\n')
}

function getExecutor(nodeType: string, config: Record<string, unknown>): NodeExecutor {
  const subtype = config.subtype as string | undefined
  const fullKey = subtype ? `${nodeType}:${subtype}` : null
  const Ctor = (fullKey ? EXECUTOR_REGISTRY[fullKey] : null) ?? EXECUTOR_REGISTRY[nodeType]
  if (!Ctor) throw new Error(`No executor registered for node type "${fullKey ?? nodeType}"`)
  return new Ctor()
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph types
// ─────────────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  type: string
  config: Prisma.JsonValue
}

interface GraphEdge {
  sourceNodeId: string
  targetNodeId: string
  label?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection loop detection
// ─────────────────────────────────────────────────────────────────────────────

interface DetectionLoop {
  detectionNodeId: string
  branchNodeId: string | null  // null = detection node itself acts as branch via pass/fail edges
  humanizerNodeId: string
  /** Node the humanizer's back-edge points to — detectionNodeId OR any ancestor */
  loopBackNodeId: string
  /** Ordered node IDs to re-execute each iteration: [loopBackNodeId, …, detectionNodeId] */
  loopPathNodeIds: string[]
}

/**
 * Finds detection loops. Supports two patterns:
 *   1. Detection → ConditionalBranch → Humanizer → (Detection OR any ancestor)
 *   2. Detection -fail-> Humanizer → (Detection OR any ancestor)   [no branch node]
 * The back-edge from humanizer may point to any ancestor of the detection node,
 * not just the detection node itself (e.g. Humanizer → AI Generate → Detection).
 */
function findDetectionLoops(nodes: GraphNode[], edges: GraphEdge[]): DetectionLoop[] {
  const loops: DetectionLoop[] = []

  // Build adjacency maps
  const backward = new Map<string, string[]>()
  const forward  = new Map<string, string[]>()
  for (const n of nodes) { backward.set(n.id, []); forward.set(n.id, []) }
  for (const e of edges) {
    backward.get(e.targetNodeId)?.push(e.sourceNodeId)
    forward.get(e.sourceNodeId)?.push(e.targetNodeId)
  }

  /** All ancestor IDs of nodeId (BFS via reverse edges). */
  function getAncestors(nodeId: string): Set<string> {
    const visited = new Set<string>()
    const queue = [nodeId]
    while (queue.length) {
      const cur = queue.shift()!
      for (const anc of backward.get(cur) ?? []) {
        if (!visited.has(anc)) { visited.add(anc); queue.push(anc) }
      }
    }
    return visited
  }

  /** BFS shortest forward path [fromId, …, toId]. */
  function findForwardPath(fromId: string, toId: string): string[] {
    if (fromId === toId) return [fromId]
    const queue: string[][] = [[fromId]]
    const visited = new Set<string>([fromId])
    while (queue.length) {
      const path = queue.shift()!
      for (const next of forward.get(path[path.length - 1]) ?? []) {
        const newPath = [...path, next]
        if (next === toId) return newPath
        if (!visited.has(next)) { visited.add(next); queue.push(newPath) }
      }
    }
    return [fromId, toId] // fallback: just the two endpoints
  }

  const detectionNodes = nodes.filter((n) => {
    const cfg = (n.config ?? {}) as Record<string, unknown>
    return n.type === 'logic' && cfg.subtype === 'detection'
  })

  for (const detNode of detectionNodes) {
    const detOutEdges = edges.filter((e) => e.sourceNodeId === detNode.id)
    const ancestors = getAncestors(detNode.id)

    /** Try to find a humanizer back-edge and register the loop. Returns true on success. */
    const tryRegister = (humNode: GraphNode, branchNodeId: string | null): boolean => {
      const humOutEdges = edges.filter((e) => e.sourceNodeId === humNode.id)
      for (const humEdge of humOutEdges) {
        const target = humEdge.targetNodeId
        if (target === detNode.id || ancestors.has(target)) {
          loops.push({
            detectionNodeId: detNode.id,
            branchNodeId,
            humanizerNodeId: humNode.id,
            loopBackNodeId: target,
            loopPathNodeIds: findForwardPath(target, detNode.id),
          })
          return true
        }
      }
      return false
    }

    // Pattern 1: Detection → ConditionalBranch → Humanizer → (detection or ancestor)
    for (const detEdge of detOutEdges) {
      const branchNode = nodes.find((n) => n.id === detEdge.targetNodeId)
      if (!branchNode) continue
      const branchCfg = (branchNode.config ?? {}) as Record<string, unknown>
      if (branchCfg.subtype !== 'conditional-branch') continue

      const branchOutEdges = edges.filter((e) => e.sourceNodeId === branchNode.id)
      for (const branchEdge of branchOutEdges) {
        const humNode = nodes.find((n) => n.id === branchEdge.targetNodeId)
        if (!humNode) continue
        const humCfg = (humNode.config ?? {}) as Record<string, unknown>
        const isRewriter = humCfg.subtype === 'humanizer' || humCfg.subtype === 'humanizer-pro' || humCfg.subtype === 'ai-generate'
        if (!isRewriter) continue
        tryRegister(humNode, branchNode.id)
      }
    }

    // Pattern 2: Detection -fail-> (Humanizer or AI Gen) → (detection or ancestor)
    if (!loops.some((l) => l.detectionNodeId === detNode.id)) {
      const failEdge = detOutEdges.find((e) => e.label === 'fail')
      if (failEdge) {
        const humNode = nodes.find((n) => n.id === failEdge.targetNodeId)
        if (humNode) {
          const humCfg = (humNode.config ?? {}) as Record<string, unknown>
          const isRewriter = humCfg.subtype === 'humanizer' || humCfg.subtype === 'humanizer-pro' || humCfg.subtype === 'ai-generate'
          if (isRewriter) tryRegister(humNode, null)
        }
      }
    }
  }

  return loops
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological sort — returns nodes grouped into parallel execution waves
// Skips loop-managed nodes; they are handled inside the detection loop logic.
// ─────────────────────────────────────────────────────────────────────────────

function buildExecutionWaves(
  nodes: GraphNode[],
  edges: GraphEdge[],
  skipNodeIds: Set<string>,
  skipEdgeKeys: Set<string> = new Set(),
): GraphNode[][] {
  // Filter out nodes and edges involving loop-managed nodes, plus explicit back-edges
  // Group frame nodes are purely visual — they have no executor and are never run
  const executableNodes = nodes.filter((n) => !skipNodeIds.has(n.id) && n.type !== 'group')
  const executableEdges = edges.filter(
    (e) =>
      !skipNodeIds.has(e.sourceNodeId) &&
      !skipNodeIds.has(e.targetNodeId) &&
      !skipEdgeKeys.has(`${e.sourceNodeId}:${e.targetNodeId}:${e.label ?? ''}`),
  )

  const inDegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const n of executableNodes) {
    inDegree.set(n.id, 0)
    outgoing.set(n.id, [])
  }

  for (const e of executableEdges) {
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1)
    outgoing.get(e.sourceNodeId)?.push(e.targetNodeId)
  }

  const nodeById = new Map(executableNodes.map((n) => [n.id, n]))
  const waves: GraphNode[][] = []

  while (inDegree.size > 0) {
    const wave = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => nodeById.get(id)!)

    if (wave.length === 0) {
      throw new Error('Workflow graph contains a cycle — cannot execute')
    }

    waves.push(wave)

    for (const node of wave) {
      inDegree.delete(node.id)
      for (const successor of outgoing.get(node.id) ?? []) {
        const current = inDegree.get(successor) ?? 0
        inDegree.set(successor, current - 1)
      }
    }
  }

  return waves
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowRunner
// ─────────────────────────────────────────────────────────────────────────────

export class WorkflowRunner {
  constructor(
    private readonly workflowRunId: string,
    private readonly agencyId: string,
    private readonly stopAtNodeId?: string,
  ) {}

  async run(): Promise<void> {
    return withAgency(this.agencyId, async () => {
      await this.execute()
    }) as Promise<void>
  }

  private async execute(): Promise<void> {
    // ── Load run + workflow ──────────────────────────────────────────────────
    const run = await prisma.workflowRun.findUnique({
      where: { id: this.workflowRunId },
      include: {
        workflow: {
          include: { nodes: true, edges: true },
        },
      },
    })

    if (!run) throw new Error(`WorkflowRun "${this.workflowRunId}" not found`)

    const { workflow } = run

    // ── Extract caller context stored at run-creation time ───────────────────
    // runs.ts stores triggeredByClerkId and resolvedPermissions in run.input
    // so the worker can use them for UsageEvent recording without a DB round-trip.
    const runInput = (run.input ?? {}) as Record<string, unknown>
    const callerClerkId    = (runInput['triggeredByClerkId'] as string | undefined) ?? run.triggeredBy ?? undefined
    const callerPermissions = runInput['resolvedPermissions'] ?? null

    // Look up the user's role for UsageEvent context
    let callerRole: string | undefined
    if (callerClerkId) {
      const u = await prisma.user.findFirst({
        where: { agencyId: this.agencyId, clerkUserId: callerClerkId },
        select: { role: true },
      })
      callerRole = u?.role
    }

    // ── Load client profile (brand voice context) ────────────────────────────
    const clientId = workflow.clientId ?? ''
    const clientProfile = clientId
      ? await prisma.clientProfile.findFirst({ where: { clientId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
      : null

    // ── Merge client-scoped file bindings into node configs ──────────────────
    const clientFiles = await prisma.clientWorkflowFiles.findMany({
      where: { workflowId: workflow.id, clientId },
    })
    const filesByNode = Object.fromEntries(
      clientFiles.map((f) => [f.nodeId, f.files as Record<string, unknown>])
    )
    // Patch workflow.nodes in-memory so executors see the client files
    for (const node of workflow.nodes) {
      const files = filesByNode[node.id]
      if (files) {
        node.config = { ...(node.config as Record<string, unknown>), ...files } as typeof node.config
      }
    }

    // ── Prune graph for "Run to here" (stopAtNodeId) ─────────────────────────
    // BFS backwards from the target node to find all ancestors, then discard
    // everything else. The existing execution engine then naturally stops after
    // executing the target node since it has no successors in the pruned graph.
    if (this.stopAtNodeId) {
      const targetId = this.stopAtNodeId
      const incoming = new Map<string, string[]>()
      for (const n of workflow.nodes) incoming.set(n.id, [])
      for (const e of workflow.edges) {
        incoming.get(e.targetNodeId)?.push(e.sourceNodeId)
      }

      const ancestorIds = new Set<string>()
      const bfsQueue = [targetId]
      while (bfsQueue.length > 0) {
        const cur = bfsQueue.shift()!
        if (ancestorIds.has(cur)) continue
        ancestorIds.add(cur)
        for (const src of incoming.get(cur) ?? []) bfsQueue.push(src)
      }

      workflow.nodes = workflow.nodes.filter((n) => ancestorIds.has(n.id))
      workflow.edges = workflow.edges.filter(
        (e) => ancestorIds.has(e.sourceNodeId) && ancestorIds.has(e.targetNodeId),
      )
      console.log(`[runner] run-to-here: pruned to ${workflow.nodes.length} nodes (target: ${targetId})`)
    }

    // ── Compute content hash from source node inputs ─────────────────────────
    // SHA-256 of all source node content (text, file names, URLs) sorted by node ID.
    // Same content + same workflow = same hash, so we can group runs in the Runs tab.
    const contentHash = (() => {
      const sourceNodes = workflow.nodes.filter((n) => n.type === 'source')
      if (sourceNodes.length === 0) return null
      const parts = sourceNodes
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => {
          const cfg = (n.config as Record<string, unknown>) ?? {}
          const text = (cfg.text as string) ?? ''
          const url = (cfg.url as string) ?? ''
          const files = ((cfg.uploaded_files as Array<{ name: string }>) ?? []).map((f) => f.name).join(',')
          const audio = ((cfg.audio_files as Array<{ name: string }>) ?? []).map((f) => f.name).join(',')
          return `${n.id}:${text}|${url}|${files}|${audio}`
        })
        .join('||')
      return createHash('sha256').update(parts).digest('hex').slice(0, 16)
    })()

    // ── Resume or fresh start ────────────────────────────────────────────────
    // A run is a "resume" if it was paused (awaiting human input) and is now being
    // re-enqueued to continue. This can happen with the DB status still set to
    // 'awaiting_assignment'/'waiting_review'/'waiting_feedback', OR it may already
    // be 'running' (some pause handlers pre-update status before re-enqueueing to
    // prevent the frontend from re-showing the pause UI). We detect the latter case
    // by checking whether any nodes already have a 'passed' status in the saved output.
    const savedOutput = run.output as unknown as RunOutput | null
    const hasPassedNodes = savedOutput?.nodeStatuses != null
      && Object.values(savedOutput.nodeStatuses).some((s) => s.status === 'passed' || s.status === 'skipped')
    const isResume = (
      run.status === 'awaiting_assignment' ||
      run.status === 'waiting_feedback' ||
      run.status === 'waiting_review' ||
      hasPassedNodes
    )

    let runOutput: RunOutput
    if (isResume && savedOutput) {
      runOutput = savedOutput
      // Ensure any newly-added nodes that are not in the saved output get idle status
      for (const n of workflow.nodes) {
        if (!runOutput.nodeStatuses[n.id]) {
          runOutput.nodeStatuses[n.id] = { status: 'idle' }
        }
      }
    } else {
      // Fresh start
      runOutput = {
        // Group frame nodes are purely visual — exclude from run statuses
        nodeStatuses: Object.fromEntries(
          workflow.nodes.filter((n) => n.type !== 'group').map((n) => [n.id, { status: 'idle' as NodeRunStatus }]),
        ),
      }
    }

    // ── Mark run as running ──────────────────────────────────────────────────
    await prisma.workflowRun.update({
      where: { id: this.workflowRunId },
      data: {
        status: 'running',
        startedAt: isResume ? run.startedAt : new Date(),
        output: runOutput as unknown as Prisma.InputJsonValue,
        ...(contentHash && !run.contentHash ? { contentHash } : {}),
      },
    })

    // Lock connectivity_mode after first run
    if (!workflow.firstRunAt) {
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: { firstRunAt: new Date() },
      })
    }

    await auditService.log(this.agencyId, {
      actorType: 'system',
      action: 'workflow.run.started',
      resourceType: 'WorkflowRun',
      resourceId: this.workflowRunId,
      metadata: { workflowId: workflow.id },
    })

    // ── Detect detection loops ───────────────────────────────────────────────
    const detectionLoops = findDetectionLoops(workflow.nodes, workflow.edges)
    // Full loops: branch + humanizer are managed inline (excluded from waves)
    // Simplified loops: only the back-edge is excluded; humanizer runs in waves normally
    const loopManagedNodeIds = new Set<string>([
      ...detectionLoops.filter((l) => l.branchNodeId !== null).map((l) => l.branchNodeId!),
      ...detectionLoops.filter((l) => l.branchNodeId !== null).map((l) => l.humanizerNodeId),
    ])

    // Back-edges for simplified loops excluded from topo sort:
    // (a) The Detection -fail-> Humanizer forward edge (so Humanizer doesn't depend on Detection)
    // (b) The Humanizer → loopBackNodeId back-edge when loopBack is upstream (not Detection itself)
    const skipEdgeKeys = new Set<string>([
      ...detectionLoops
        .filter((l) => l.branchNodeId === null)
        .map((l) => `${l.detectionNodeId}:${l.humanizerNodeId}:fail`),
      ...detectionLoops
        .filter((l) => l.branchNodeId === null && l.loopBackNodeId !== l.detectionNodeId)
        .map((l) => `${l.humanizerNodeId}:${l.loopBackNodeId}:`),
    ])

    // Map from detection node ID → its loop definition
    const loopByDetectionNode = new Map<string, DetectionLoop>()
    for (const loop of detectionLoops) {
      loopByDetectionNode.set(loop.detectionNodeId, loop)
    }

    // ── Build execution plan (loop-managed nodes excluded) ───────────────────
    const waves = buildExecutionWaves(workflow.nodes, workflow.edges, loopManagedNodeIds, skipEdgeKeys)
    const nodeOutputs = new Map<string, unknown>()
    // Store the routePath result from routing nodes (conditional-branch)
    const nodeRoutePaths = new Map<string, string>()

    // For a resumed run, pre-populate nodeOutputs from previously passed/skipped nodes
    if (isResume) {
      for (const [nodeId, nodeStatus] of Object.entries(runOutput.nodeStatuses)) {
        if ((nodeStatus.status === 'passed' || nodeStatus.status === 'skipped') && nodeStatus.output !== undefined) {
          const saved = nodeStatus.output as Record<string, unknown>
          // Transcription nodes save session metadata — swap in the real transcript text
          if (saved?.sessionId && saved?.status === 'awaiting_assignment') {
            const transcriptText = await loadTranscriptText(saved.sessionId as string)
            nodeOutputs.set(nodeId, transcriptText ?? nodeStatus.output)
          } else {
            nodeOutputs.set(nodeId, nodeStatus.output)
          }
        }
      }
    }

    // ── Execute wave by wave, parallel within each wave ──────────────────────
    let failed = false
    let paused = false  // true = run is awaiting human input, not failed
    let lastOutputNodeResult: unknown

    for (const wave of waves) {
      if (failed || paused) break

      await Promise.all(
        wave.map(async (node) => {
          if (failed || paused) return

          // ── Skip nodes already passed/skipped in a resumed run ─────────
          if (runOutput.nodeStatuses[node.id]?.status === 'passed' || runOutput.nodeStatuses[node.id]?.status === 'skipped') {
            if (node.type === 'output') {
              lastOutputNodeResult = nodeOutputs.get(node.id)
            }
            return
          }

          const config = (node.config ?? {}) as Record<string, unknown>

          // ── Skip locked generation nodes that have stored assets ────────
          const nodeSubtype = config.subtype as string | undefined
          const isMediaNode = nodeSubtype === 'image-generation' || nodeSubtype === 'video-generation'
          const isAudioNode = nodeSubtype === 'voice-output' || nodeSubtype === 'music-generation'
          if ((isMediaNode || isAudioNode) && config.locked === true) {
            if (isAudioNode) {
              const storedOutput = config.stored_output as Record<string, unknown> | undefined
              if (storedOutput?.localPath) {
                console.log(`[runner] skipping locked audio node ${node.id} (${nodeSubtype}) — using cached output`)
                nodeOutputs.set(node.id, storedOutput)
                runOutput.nodeStatuses[node.id] = {
                  status: 'skipped',
                  output: storedOutput,
                  completedAt: new Date().toISOString(),
                }
                await this.persistOutput(runOutput)
                lastOutputNodeResult = storedOutput
                return
              }
            } else {
              const storedAssets = config.stored_assets as Array<{ localPath: string }> | undefined
              if (Array.isArray(storedAssets) && storedAssets.length > 0) {
                console.log(`[runner] skipping locked generation node ${node.id} (${nodeSubtype}) — using ${storedAssets.length} cached asset(s)`)
                const cachedOutput = { assets: storedAssets }
                nodeOutputs.set(node.id, cachedOutput)
                runOutput.nodeStatuses[node.id] = {
                  status: 'skipped',
                  output: cachedOutput,
                  completedAt: new Date().toISOString(),
                }
                await this.persistOutput(runOutput)
                if (node.type === 'output') lastOutputNodeResult = cachedOutput
                return
              }
            }
          }
          const ctx: NodeExecutionContext = {
            workflowRunId: this.workflowRunId,
            agencyId: this.agencyId,
            nodeId: node.id,
            nodeLabel: node.label ?? undefined,
            workflowId: workflow.id,
            clientId: workflow.clientId ?? null,
            verticalId: (workflow as Record<string, unknown>).verticalId as string | null ?? null,
            userId: callerClerkId ?? null,
            userRole: callerRole ?? null,
            resolvedPermissions: callerPermissions,
            clientProfile: clientProfile ? {
              brandTone: clientProfile.brandTone,
              formality: clientProfile.formality,
              pov: clientProfile.pov,
              signaturePhrases: (clientProfile.signaturePhrases as string[]) ?? [],
              avoidPhrases: (clientProfile.avoidPhrases as string[]) ?? [],
              primaryBuyer: (clientProfile.primaryBuyer as Record<string, unknown>) ?? {},
              secondaryBuyer: (clientProfile.secondaryBuyer as Record<string, unknown>) ?? {},
              buyerMotivations: (clientProfile.buyerMotivations as string[]) ?? [],
              buyerFears: (clientProfile.buyerFears as string[]) ?? [],
              visualStyle: clientProfile.visualStyle,
              colorTemperature: clientProfile.colorTemperature,
              currentPositioning: clientProfile.currentPositioning,
              campaignThemesApproved: (clientProfile.campaignThemesApproved as string[]) ?? [],
              manualOverrides: (clientProfile.manualOverrides as Array<Record<string, unknown>>) ?? [],
            } : null,
          }

          // Collect inputs from upstream nodes, respecting routing decisions
          const upstreamEdges = workflow.edges.filter((e) => e.targetNodeId === node.id)
          const activeUpstreamEdges = upstreamEdges.filter((e) => {
            const routePath = nodeRoutePaths.get(e.sourceNodeId)
            if (!routePath) return true
            const edgeLabel = e.label ?? null
            if (!edgeLabel) return true
            return edgeLabel === routePath
          })

          // Media generation nodes receive a structured inputs collection instead of flat strings
          const MULTI_INPUT_SUBTYPES = new Set(['image-prompt-builder', 'video-prompt-builder', 'image-generation', 'video-generation', 'audio-mix', 'video-composition'])

          let input: unknown
          if (activeUpstreamEdges.length === 0) {
            input = null
          } else if (MULTI_INPUT_SUBTYPES.has(nodeSubtype ?? '')) {
            const structuredInputs = activeUpstreamEdges.map((e) => {
              const output = nodeOutputs.get(e.sourceNodeId)
              const sourceNode = workflow.nodes.find((n) => n.id === e.sourceNodeId)
              const nodeType = ((sourceNode?.config ?? {}) as Record<string, unknown>).subtype as string ?? sourceNode?.type ?? 'unknown'
              return {
                nodeId: e.sourceNodeId,
                nodeLabel: sourceNode?.label ?? 'Source',
                nodeType,
                content: output,
              }
            })
            // Append reference files uploaded directly onto the node
            const refFiles = (config as Record<string, unknown>).reference_files as Array<{ localPath: string; type: string; filename?: string }> | undefined
            for (const f of refFiles ?? []) {
              structuredInputs.push({
                nodeId: 'uploaded',
                nodeLabel: f.filename ?? 'Reference file',
                nodeType: 'uploaded-reference',
                content: { type: f.type, localPath: f.localPath },
              })
            }
            input = { inputs: structuredInputs }
          } else {
            const upstreamOutputs = activeUpstreamEdges.map((e) => {
              const output = nodeOutputs.get(e.sourceNodeId)
              const sourceNode = workflow.nodes.find((n) => n.id === e.sourceNodeId)
              const label = sourceNode?.label?.trim()
              if (label && typeof output === 'string' && sourceNode?.type === 'source') {
                return `## ${label}\n\n${output}`
              }
              return output
            })
            input = upstreamOutputs.length === 1 ? upstreamOutputs[0] : upstreamOutputs
          }

          // Mark running
          runOutput.nodeStatuses[node.id] = {
            status: 'running',
            startedAt: new Date().toISOString(),
          }
          await this.persistOutput(runOutput)

          try {
            const executor = getExecutor(node.type, config)
            const result = await executor.execute(input, config, ctx)

            // ── Pause: node requires human input before workflow continues ───
            if (result.paused) {
              paused = true
              nodeOutputs.set(node.id, result.output)
              runOutput.nodeStatuses[node.id] = {
                status: 'passed',
                output: result.output,
                paused: true,
                startedAt: runOutput.nodeStatuses[node.id]?.startedAt,
                completedAt: new Date().toISOString(),
              }
              if (result.pendingSessionId) {
                runOutput.pendingTranscriptionSessionId = result.pendingSessionId
              }
              await this.persistOutput(runOutput)

              await prisma.workflowRun.update({
                where: { id: this.workflowRunId },
                data: {
                  status: 'awaiting_assignment',
                  output: runOutput as unknown as Prisma.InputJsonValue,
                },
              })

              await auditService.log(this.agencyId, {
                actorType: 'system',
                action: 'workflow.run.awaiting_assignment',
                resourceType: 'WorkflowRun',
                resourceId: this.workflowRunId,
                metadata: {
                  nodeId: node.id,
                  sessionId: result.pendingSessionId,
                },
              })
              return
            }

            // ── Waiting review: human review node awaiting approval ──────────
            if (result.waitingReview) {
              paused = true
              nodeOutputs.set(node.id, result.output)
              runOutput.nodeStatuses[node.id] = {
                status: 'passed',
                output: result.output,
                paused: true,
                startedAt: runOutput.nodeStatuses[node.id]?.startedAt,
                completedAt: new Date().toISOString(),
              }
              runOutput.pendingReviewNodeId = node.id
              runOutput.pendingReviewContent = result.reviewContent
              // Clear any stale transcription session ID so the frontend doesn't
              // re-show the speaker assignment panel when polling waiting_review status
              runOutput.pendingTranscriptionSessionId = undefined
              await this.persistOutput(runOutput)

              await prisma.workflowRun.update({
                where: { id: this.workflowRunId },
                data: {
                  status: 'waiting_review',
                  output: runOutput as unknown as Prisma.InputJsonValue,
                },
              })

              console.log(`[runner] run ${this.workflowRunId} paused at human review node ${node.id}`)
              return
            }

            // ── Waiting feedback: node needs stakeholder portal input ────────
            if (result.waitingFeedback) {
              paused = true
              nodeOutputs.set(node.id, result.output)
              runOutput.nodeStatuses[node.id] = {
                status: 'passed',
                output: result.output,
                paused: true,
                startedAt: runOutput.nodeStatuses[node.id]?.startedAt,
                completedAt: new Date().toISOString(),
              }
              if (result.pendingFeedbackNodeId) {
                runOutput.pendingFeedbackNodeId = result.pendingFeedbackNodeId
              }
              await this.persistOutput(runOutput)

              await prisma.workflowRun.update({
                where: { id: this.workflowRunId },
                data: {
                  status: 'waiting_feedback',
                  output: runOutput as unknown as Prisma.InputJsonValue,
                },
              })

              await auditService.log(this.agencyId, {
                actorType: 'system',
                action: 'workflow.run.waiting_feedback',
                resourceType: 'WorkflowRun',
                resourceId: this.workflowRunId,
                metadata: { nodeId: node.id },
              })
              return
            }

            nodeOutputs.set(node.id, result.output)
            if (result.routePath) nodeRoutePaths.set(node.id, result.routePath)

            // ── Detection loop execution ─────────────────────────────────────
            const loop = loopByDetectionNode.get(node.id)
            if (loop) {
              const loopRoute = await this.runDetectionLoop(
                loop,
                workflow.nodes,
                config,
                ctx,
                nodeOutputs,
                runOutput,
              )
              // For simplified loops (no branch node), the detection node itself
              // acts as the branch — set its routePath so pass/fail edges are filtered
              if (!loop.branchNodeId) {
                nodeRoutePaths.set(node.id, loopRoute)
              }
            }

            // Record token usage (monthly-bucket tracking with accurate input/output split)
            if (result.tokensUsed !== undefined) {
              await this.recordTokenUsage(
                result.tokensUsed,
                result.modelUsed ?? node.type,
                callerClerkId,
                result.inputTokens,
                result.outputTokens,
              )
            }

            // Fire granular UsageEvent for all LLM nodes (logic + intelligence node types)
            if (result.tokensUsed !== undefined) {
              const nodeConfig  = config as Record<string, unknown>
              const llmProvider = (nodeConfig.provider as string | undefined) ?? 'anthropic'
              const llmModel    = result.modelUsed ?? (nodeConfig.model as string | undefined) ?? 'unknown'
              const isOnline    = llmProvider !== 'ollama'
              const startedAt   = runOutput.nodeStatuses[node.id]?.startedAt
              const durationMs  = startedAt ? Date.now() - new Date(startedAt).getTime() : 0
              const inTok       = result.inputTokens  ?? Math.round(result.tokensUsed * 0.8)
              const outTok      = result.outputTokens ?? Math.round(result.tokensUsed * 0.2)
              const costUsd     = costEstimator.estimateLlmCost(llmProvider, llmModel, inTok, outTok, isOnline)
              usageEventService.record({
                agencyId:          this.agencyId,
                userId:            ctx.userId ?? undefined,
                userRole:          ctx.userRole ?? undefined,
                clientId:          workflow.clientId ?? undefined,
                toolType:          'llm',
                toolSubtype:       'text_generation',
                provider:          llmProvider,
                model:             llmModel,
                isOnline,
                workflowId:        workflow.id,
                workflowRunId:     this.workflowRunId,
                nodeId:            node.id,
                nodeType:          node.type,
                inputTokens:       inTok,
                outputTokens:      outTok,
                estimatedCostUsd:  costUsd ?? undefined,
                durationMs,
                status:            'success',
                permissionsAtTime: ctx.resolvedPermissions,
              }).catch(() => {})
            }

            // Record media provider usage (voice, character animation, music, video composition)
            if (result.mediaUsage) {
              const mu = result.mediaUsage
              const startedAt  = runOutput.nodeStatuses[node.id]?.startedAt
              const durationMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0
              const toolType   = (mu.subtype === 'voice_generation' || mu.subtype === 'music_generation')
                ? ('audio' as const) : ('video' as const)

              // Estimate cost based on subtype
              let costUsd: number | null = null
              if (mu.subtype === 'voice_generation' && mu.charCount) {
                costUsd = costEstimator.estimateCharCost(mu.provider, mu.model ?? 'default', mu.charCount, mu.isOnline)
              } else if (mu.subtype === 'music_generation' && mu.durationSecs) {
                const service = mu.model?.startsWith('sfx') ? 'sfx' : 'music'
                costUsd = costEstimator.estimateAudioCost(mu.provider, service, mu.model ?? 'default', mu.durationSecs, mu.isOnline)
              } else if (mu.durationSecs) {
                costUsd = costEstimator.estimateVideoCost(mu.provider, mu.model ?? 'default', mu.durationSecs, mu.isOnline)
              }

              // Monthly bucket UsageRecord (existing aggregate path)
              const metricKey = mu.subtype === 'voice_generation'       ? 'voice_generation_chars'
                              : mu.subtype === 'character_animation'    ? 'character_animation_secs'
                              : mu.subtype === 'music_generation'       ? 'music_generation_secs'
                              : 'video_composition_secs'
              const quantity  = mu.subtype === 'voice_generation' ? (mu.charCount ?? 0) : (mu.durationSecs ?? 0)
              if (quantity > 0) {
                const now = new Date()
                prisma.usageRecord.create({
                  data: {
                    agencyId:    this.agencyId,
                    clientId:    workflow.clientId ?? undefined,
                    metric:      metricKey,
                    quantity,
                    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
                    periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
                    metadata: {
                      provider:      mu.provider,
                      model:         mu.model ?? 'default',
                      workflowRunId: this.workflowRunId,
                      ...(ctx.userId ? { userId: ctx.userId } : {}),
                      ...(mu.subtype === 'voice_generation' ? { charCount: mu.charCount, durationSecs: mu.durationSecs } : { durationSecs: mu.durationSecs }),
                      ...(costUsd !== null ? { estimatedCostUsd: costUsd } : {}),
                    },
                  },
                }).catch(() => {})
              }

              // Granular UsageEvent
              usageEventService.record({
                agencyId:          this.agencyId,
                userId:            ctx.userId ?? undefined,
                userRole:          ctx.userRole ?? undefined,
                clientId:          workflow.clientId ?? undefined,
                toolType,
                toolSubtype:       mu.subtype,
                provider:          mu.provider,
                model:             mu.model ?? 'default',
                isOnline:          mu.isOnline,
                workflowId:        workflow.id,
                workflowRunId:     this.workflowRunId,
                nodeId:            node.id,
                nodeType:          node.type,
                ...(mu.charCount    ? { inputCharacters: mu.charCount }         : {}),
                ...(mu.durationSecs ? { outputDurationSecs: mu.durationSecs }    : {}),
                estimatedCostUsd:  costUsd ?? undefined,
                durationMs,
                status:            'success',
                permissionsAtTime: ctx.resolvedPermissions,
              }).catch(() => {})
            }

            // After potential loop, use updated output
            const finalOutput = nodeOutputs.get(node.id)

            runOutput.nodeStatuses[node.id] = {
              ...runOutput.nodeStatuses[node.id],
              status: 'passed',
              output: finalOutput,
              completedAt: new Date().toISOString(),
              tokensUsed: result.tokensUsed,
              modelUsed: result.modelUsed,
              wordsProcessed: result.wordsProcessed,
              sourceFiles: result.sourceFiles,
            }
            await this.persistOutput(runOutput)

            if (node.type === 'output') lastOutputNodeResult = finalOutput

            await auditService.log(this.agencyId, {
              actorType: 'system',
              action: 'workflow.node.completed',
              resourceType: 'Node',
              resourceId: node.id,
              metadata: {
                workflowRunId: this.workflowRunId,
                nodeType: node.type,
                tokensUsed: result.tokensUsed,
              },
            })
          } catch (err) {
            failed = true
            const errorMessage = err instanceof Error
              ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message)
              : String(err)
            console.error(`[runner] node ${node.id} (${node.type}:${((node.config as Record<string,unknown>)?.subtype as string) ?? ''}) failed:`, errorMessage, err instanceof Error ? err.stack : '')

            runOutput.nodeStatuses[node.id] = {
              status: 'failed',
              error: errorMessage,
              startedAt: runOutput.nodeStatuses[node.id].startedAt,
              completedAt: new Date().toISOString(),
            }
            await this.persistOutput(runOutput)

            await auditService.log(this.agencyId, {
              actorType: 'system',
              action: 'workflow.node.failed',
              resourceType: 'Node',
              resourceId: node.id,
              metadata: {
                workflowRunId: this.workflowRunId,
                nodeType: node.type,
                error: errorMessage,
              },
            })

            // Fire error UsageEvent for any node that fails
            const failedNodeConfig = config as Record<string, unknown>
            const failedSubtype    = (failedNodeConfig.subtype as string | undefined) ?? node.type
            const failedProvider   = (failedNodeConfig.provider as string | undefined) ?? 'unknown'
            const failedModel      = (failedNodeConfig.model    as string | undefined) ?? 'unknown'
            const startedAt        = runOutput.nodeStatuses[node.id]?.startedAt
            usageEventService.record({
              agencyId:          this.agencyId,
              userId:            ctx.userId ?? undefined,
              userRole:          ctx.userRole ?? undefined,
              clientId:          workflow.clientId ?? undefined,
              toolType:          node.type === 'output' ? (failedSubtype.includes('video') ? 'video' : failedSubtype.includes('image') ? 'graphics' : 'content') : 'llm',
              toolSubtype:       failedSubtype,
              provider:          failedProvider,
              model:             failedModel,
              isOnline:          failedProvider !== 'ollama' && failedProvider !== 'comfyui' && failedProvider !== 'automatic1111' && failedProvider !== 'cogvideox' && failedProvider !== 'wan21',
              workflowId:        workflow.id,
              workflowRunId:     this.workflowRunId,
              nodeId:            node.id,
              nodeType:          node.type,
              durationMs:        startedAt ? Date.now() - new Date(startedAt).getTime() : 0,
              status:            'error',
              errorMessage,
              permissionsAtTime: ctx.resolvedPermissions,
            }).catch(() => {})
          }
        }),
      )
    }

    // ── Finalise run ─────────────────────────────────────────────────────────
    // If the run is paused (awaiting human input) the status was already updated
    // inside the wave loop — do not overwrite it here.
    if (paused) return

    const finalStatus = failed ? 'failed' : 'completed'

    if (!failed && lastOutputNodeResult !== undefined) {
      runOutput.finalOutput = lastOutputNodeResult
    }

    await prisma.workflowRun.update({
      where: { id: this.workflowRunId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        output: runOutput as unknown as Prisma.InputJsonValue,
        ...(failed ? { errorMessage: this.firstFailedNodeError(runOutput) } : {}),
        // Auto-advance to 'pending' (agency review queue) on successful completion
        ...(finalStatus === 'completed' ? { reviewStatus: 'pending' } : {}),
      },
    })

    await auditService.log(this.agencyId, {
      actorType: 'system',
      action: `workflow.run.${finalStatus}`,
      resourceType: 'WorkflowRun',
      resourceId: this.workflowRunId,
      metadata: { workflowId: workflow.id },
    })

    // Track insight outcomes after a completed run (non-blocking)
    if (finalStatus === 'completed' && workflow.clientId) {
      trackInsightOutcomes(this.agencyId, workflow.clientId, this.workflowRunId).catch((err) => {
        console.error('[runner] insight outcome tracking failed:', err)
      })
    }

    // Extract quality signals for learning (non-blocking)
    if (finalStatus === 'completed') {
      extractAndSaveQuality(this.agencyId, this.workflowRunId).catch((err) => {
        console.error('[runner] quality extraction failed:', err)
      })
    }

    // Deliver output to Box if folder is configured on the run (non-blocking)
    if (finalStatus === 'completed' && run.clientFolderBox && workflow.clientId) {
      const folderIdMatch = run.clientFolderBox.match(/\/folder\/(\d+)/)
      const folderId = folderIdMatch?.[1]
      if (folderId) {
        const reviewerIds = (run.reviewerIds as string[]) ?? []
        const dateStr     = new Date().toISOString().slice(0, 10)

        // Collect deliverables from all output nodes
        const outputNodes = workflow.nodes.filter((n) => n.type === 'output')
        const deliverables: Array<{ filename: string; content: string; mimeType?: string }> = []

        for (const node of outputNodes) {
          const nodeOutput = runOutput.nodeStatuses[node.id]?.output as Record<string, unknown> | undefined
          if (!nodeOutput) continue

          const cfg     = (node.config ?? {}) as Record<string, unknown>
          const subtype = cfg.subtype as string | undefined
          const label   = (cfg.label as string | undefined) ?? (cfg.output_type as string | undefined) ?? subtype ?? node.id

          // Image/video/audio nodes deliver via separate image-aware path
          const isMedia = subtype === 'image-generation' || subtype === 'video-generation'
            || subtype === 'voice-output' || subtype === 'music-generation'
          if (isMedia) {
            if (subtype === 'image-generation') {
              const assets = (nodeOutput.assets as Array<{ storageKey?: string; localPath?: string }>) ?? []
              for (let i = 0; i < assets.length; i++) {
                const asset = assets[i]
                const sk = asset.storageKey
                if (!sk) continue
                const safeName = label.replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'image'
                const imgFilename = assets.length > 1
                  ? `${safeName}-${i + 1}-${dateStr}.png`
                  : `${safeName}-${dateStr}.png`
                deliverImageToBox({
                  agencyId:      this.agencyId,
                  clientId:      workflow.clientId!,
                  runId:         this.workflowRunId,
                  stakeholderId: reviewerIds[0] ?? null,
                  folderId,
                  storageKey:    sk,
                  filename:      imgFilename,
                  mondayItemId:  null,
                }).catch((err) => {
                  console.error(`[runner] Box image delivery failed for ${imgFilename}:`, err)
                })
              }
            }
            continue
          }

          const rawContent = nodeOutput.content ?? nodeOutput.outputText ?? nodeOutput.humanizedContent ?? nodeOutput.text
          if (!rawContent || typeof rawContent !== 'string') continue

          const safeName = label.replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'output'
          const fmt = (cfg.format as string | undefined) ?? 'docx'
          const ext = fmt === 'txt' ? 'txt' : 'docx'
          const mimeType = ext === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'text/plain'
          deliverables.push({ filename: `${safeName}-${dateStr}.${ext}`, content: rawContent, mimeType })
        }

        // Fall back to finalOutput if no output nodes yielded content
        if (deliverables.length === 0) {
          const finalOut = runOutput.finalOutput as { content?: unknown } | undefined
          const text = typeof finalOut?.content === 'string' ? finalOut.content : JSON.stringify(finalOut?.content ?? '')
          const safeName = workflow.name.replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'output'
          deliverables.push({
            filename: `${safeName}-${dateStr}.docx`,
            content:  text,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          })
        }

        for (const { filename, content, mimeType } of deliverables) {
          deliverRunToBox({
            agencyId:      this.agencyId,
            clientId:      workflow.clientId,
            runId:         this.workflowRunId,
            stakeholderId: reviewerIds[0] ?? null,
            folderId,
            filename,
            content,
            mimeType,
            mondayItemId:  null,
          }).catch((err) => {
            console.error(`[runner] Box delivery failed for ${filename}:`, err)
          })
        }
      }
    }
  }

  // ─── Detection loop execution ──────────────────────────────────────────────

  private async runDetectionLoop(
    loop: DetectionLoop,
    allNodes: GraphNode[],
    detCfg: Record<string, unknown>,
    detCtx: NodeExecutionContext,
    nodeOutputs: Map<string, unknown>,
    runOutput: RunOutput,
  ): Promise<'pass' | 'fail'> {
    const detOutput = nodeOutputs.get(loop.detectionNodeId) as Record<string, unknown>
    const score = (detOutput?.overall_score as number) ?? 0
    const threshold = (detCfg.threshold as number) ?? 20
    const maxRetries = (detCfg.max_retries as number) ?? 3

    if (score <= threshold) {
      // Already passing — mark loop-managed nodes as passed without extra work
      this.markLoopManagedNodes(loop, 'pass', detOutput, nodeOutputs, runOutput)
      return 'pass'
    }

    const humNode = allNodes.find((n) => n.id === loop.humanizerNodeId)!
    const humCfg = (humNode.config ?? {}) as Record<string, unknown>
    const humCtx: NodeExecutionContext = { ...detCtx, nodeId: humNode.id }
    // Use generic executor so both humanizer and ai-generate nodes work as rewriters
    const humExec = getExecutor(humNode.type, humCfg)
    const detExec = new DetectionNodeExecutor()

    let currentDetOutput = detOutput
    let retryCount = 0
    let lastScore = score
    let noImprovementCount = 0
    // Score history: initial score from first wave detection run, then one entry per retry
    const scoreHistory: number[] = [score]

    // Persist initial score so frontend can show it immediately
    if (!runOutput.detectionState) runOutput.detectionState = {}
    runOutput.detectionState[loop.detectionNodeId] = { retryCount: 0, lastScore: score, scoreHistory }
    await this.persistOutput(runOutput)

    while (retryCount < maxRetries) {
      retryCount++

      // Run rewriter node (humanizer or AI Gen).
      // Don't persist 'running' status here — doing so can cause re-runs
      // if the workflow pauses between the 'running' write and the subsequent 'passed' write.
      const humResult = await humExec.execute(currentDetOutput, humCfg, humCtx)
      const humanizedText = humResult.output as string

      const humWordCount = typeof humanizedText === 'string'
        ? humanizedText.split(/\s+/).filter(Boolean).length : undefined
      runOutput.nodeStatuses[humNode.id] = {
        status: 'passed',
        output: humanizedText,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        tokensUsed: humResult.tokensUsed,
        modelUsed: humResult.modelUsed,
        wordsProcessed: humWordCount,
      }
      nodeOutputs.set(humNode.id, humanizedText)
      await this.persistOutput(runOutput)  // save rewriter 'passed' before detection re-runs

      if (humResult.tokensUsed) {
        await this.recordTokenUsage(humResult.tokensUsed, humResult.modelUsed ?? 'rewriter', undefined, humResult.inputTokens, humResult.outputTokens)
      }

      // If back-edge goes to an upstream node (e.g. Humanizer → AI Generate → Detection),
      // re-execute each intermediate node in the path using the humanized text as input.
      let redetInput: unknown = humanizedText
      const intermediateNodeIds = loop.loopPathNodeIds.slice(0, -1) // all except detection itself
      for (const pathNodeId of intermediateNodeIds) {
        const pathNode = allNodes.find((n) => n.id === pathNodeId)
        if (!pathNode) continue
        const pathCfg = (pathNode.config ?? {}) as Record<string, unknown>
        const pathCtx: NodeExecutionContext = { ...detCtx, nodeId: pathNodeId }
        const pathExec = getExecutor(pathNode.type, pathCfg)
        const pathResult = await pathExec.execute(redetInput, pathCfg, pathCtx)
        redetInput = pathResult.output
        nodeOutputs.set(pathNodeId, redetInput)
        runOutput.nodeStatuses[pathNodeId] = {
          status: 'passed',
          output: redetInput,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          tokensUsed: pathResult.tokensUsed,
          modelUsed: pathResult.modelUsed,
        }
        await this.persistOutput(runOutput)
      }

      // Mark detection as running again
      runOutput.nodeStatuses[loop.detectionNodeId] = {
        ...runOutput.nodeStatuses[loop.detectionNodeId],
        status: 'running',
      }
      await this.persistOutput(runOutput)

      // Re-run detection on humanized content (or on the output of intermediate nodes)
      const redetResult = await detExec.execute(redetInput, detCfg, detCtx)
      currentDetOutput = redetResult.output as Record<string, unknown>
      const newScore = (currentDetOutput.overall_score as number) ?? 0

      nodeOutputs.set(loop.detectionNodeId, currentDetOutput)

      // Append score to history and persist immediately for live UI updates
      scoreHistory.push(newScore)
      runOutput.detectionState![loop.detectionNodeId] = { retryCount, lastScore: newScore, scoreHistory }

      // Check for no improvement (false positive warning)
      if (newScore >= lastScore) {
        noImprovementCount++
        if (noImprovementCount >= 3) {
          const warning = `Detection score not improving after ${retryCount} rewrite passes (score: ${newScore}). Possible false positive.`
          runOutput.nodeStatuses[loop.detectionNodeId] = {
            ...runOutput.nodeStatuses[loop.detectionNodeId],
            status: 'passed',
            output: currentDetOutput,
            completedAt: new Date().toISOString(),
            warning,
          }
          await this.persistOutput(runOutput)
          if (loop.branchNodeId) {
            this.markBranchNode(loop.branchNodeId, 'fail', currentDetOutput, nodeOutputs, runOutput)
          }
          return 'fail'
        }
      } else {
        noImprovementCount = 0
      }
      lastScore = newScore

      // Update detection status and persist so frontend gets live score updates
      runOutput.nodeStatuses[loop.detectionNodeId] = {
        ...runOutput.nodeStatuses[loop.detectionNodeId],
        status: 'passed',
        output: currentDetOutput,
        completedAt: new Date().toISOString(),
      }
      await this.persistOutput(runOutput)

      if (newScore <= threshold) break
    }

    // Final state already persisted in the loop; just ensure retryCount is current

    const passed = ((currentDetOutput.overall_score as number) ?? 0) <= threshold
    const route = passed ? 'pass' : 'fail'
    if (loop.branchNodeId) {
      this.markBranchNode(loop.branchNodeId, route, currentDetOutput, nodeOutputs, runOutput)
    }

    await this.persistOutput(runOutput)
    return route
  }

  private markLoopManagedNodes(
    loop: DetectionLoop,
    route: 'pass' | 'fail',
    detOutput: unknown,
    nodeOutputs: Map<string, unknown>,
    runOutput: RunOutput,
  ): void {
    if (loop.branchNodeId) {
      // Full loop: branch + humanizer are both managed inline
      const branchOutput = { route, evaluated_value: (detOutput as Record<string, unknown>)?.overall_score ?? 0, input: detOutput }
      nodeOutputs.set(loop.branchNodeId, branchOutput)
      runOutput.nodeStatuses[loop.branchNodeId] = { status: 'passed', output: branchOutput }
      nodeOutputs.set(loop.humanizerNodeId, detOutput)
      runOutput.nodeStatuses[loop.humanizerNodeId] = { status: 'passed', output: 'skipped (score below threshold)' }
    }
    // Simplified loop: humanizer already ran in waves — nothing to mark here
  }

  private markBranchNode(
    branchNodeId: string,
    route: 'pass' | 'fail',
    detOutput: unknown,
    nodeOutputs: Map<string, unknown>,
    runOutput: RunOutput,
  ): void {
    const branchOutput = { route, evaluated_value: (detOutput as Record<string, unknown>)?.overall_score ?? 0, input: detOutput }
    nodeOutputs.set(branchNodeId, branchOutput)
    runOutput.nodeStatuses[branchNodeId] = { status: 'passed', output: branchOutput }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async persistOutput(output: RunOutput): Promise<void> {
    await prisma.workflowRun.update({
      where: { id: this.workflowRunId },
      data: { output: output as unknown as Prisma.InputJsonValue },
    })
  }

  private async recordTokenUsage(
    tokensUsed: number,
    model: string,
    userId?: string | null,
    inputTokens?: number,
    outputTokens?: number,
  ): Promise<void> {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    await prisma.usageRecord.create({
      data: {
        agencyId: this.agencyId,
        metric: 'ai_tokens',
        quantity: tokensUsed,
        periodStart,
        periodEnd,
        metadata: {
          workflowRunId: this.workflowRunId,
          model,
          ...(inputTokens  !== undefined ? { inputTokens }  : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(userId ? { userId } : {}),
        } as Prisma.InputJsonValue,
      },
    })
  }

  private firstFailedNodeError(output: RunOutput): string {
    for (const status of Object.values(output.nodeStatuses)) {
      if (status.status === 'failed' && status.error) return status.error
    }
    return 'Workflow execution failed'
  }
}
