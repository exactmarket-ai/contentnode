import { prisma, withAgency, auditService, type Prisma } from '@contentnode/database'
import { SourceNodeExecutor } from './executors/source.js'
import { LogicNodeExecutor } from './executors/logic.js'
import { OutputNodeExecutor } from './executors/output.js'
import { DetectionNodeExecutor } from './executors/detection.js'
import { HumanizerNodeExecutor } from './executors/humanizer.js'
import { ConditionalBranchNodeExecutor } from './executors/conditional_branch.js'
import type { NodeExecutor, NodeExecutionContext } from './executors/base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Per-node status stored inside WorkflowRun.output
// ─────────────────────────────────────────────────────────────────────────────

export type NodeRunStatus = 'idle' | 'running' | 'passed' | 'failed'

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
}

export interface RunOutput {
  nodeStatuses: Record<string, NodeStatus>
  finalOutput?: unknown
  /** Retry tracking per detection node */
  detectionState?: Record<string, { retryCount: number; lastScore: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Node executor registry — routes by "type" or "type:subtype"
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_REGISTRY: Record<string, new () => NodeExecutor> = {
  source:                      SourceNodeExecutor,
  logic:                       LogicNodeExecutor,
  'logic:humanizer':           HumanizerNodeExecutor,
  'logic:detection':           DetectionNodeExecutor,
  'logic:conditional-branch':  ConditionalBranchNodeExecutor,
  output:                      OutputNodeExecutor,
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
  branchNodeId: string
  humanizerNodeId: string
}

/**
 * Finds (detection → conditional-branch → humanizer → detection) cycles.
 * Returns one entry per detected loop.
 */
function findDetectionLoops(nodes: GraphNode[], edges: GraphEdge[]): DetectionLoop[] {
  const loops: DetectionLoop[] = []

  const detectionNodes = nodes.filter((n) => {
    const cfg = (n.config ?? {}) as Record<string, unknown>
    return n.type === 'logic' && cfg.subtype === 'detection'
  })

  for (const detNode of detectionNodes) {
    // Downstream from detection → should reach a conditional-branch
    const detOutEdges = edges.filter((e) => e.sourceNodeId === detNode.id)

    for (const detEdge of detOutEdges) {
      const branchNode = nodes.find((n) => n.id === detEdge.targetNodeId)
      if (!branchNode) continue
      const branchCfg = (branchNode.config ?? {}) as Record<string, unknown>
      if (branchCfg.subtype !== 'conditional-branch') continue

      // From branch → find a humanizer
      const branchOutEdges = edges.filter((e) => e.sourceNodeId === branchNode.id)

      for (const branchEdge of branchOutEdges) {
        const humNode = nodes.find((n) => n.id === branchEdge.targetNodeId)
        if (!humNode) continue
        const humCfg = (humNode.config ?? {}) as Record<string, unknown>
        if (humCfg.subtype !== 'humanizer') continue

        // From humanizer → back to detection = confirmed loop
        const loopBack = edges.find(
          (e) => e.sourceNodeId === humNode.id && e.targetNodeId === detNode.id,
        )
        if (loopBack) {
          loops.push({
            detectionNodeId: detNode.id,
            branchNodeId: branchNode.id,
            humanizerNodeId: humNode.id,
          })
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
): GraphNode[][] {
  // Filter out nodes and edges involving loop-managed nodes
  const executableNodes = nodes.filter((n) => !skipNodeIds.has(n.id))
  const executableEdges = edges.filter(
    (e) => !skipNodeIds.has(e.sourceNodeId) && !skipNodeIds.has(e.targetNodeId),
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

    // ── Initialise per-node status map ───────────────────────────────────────
    const runOutput: RunOutput = {
      nodeStatuses: Object.fromEntries(
        workflow.nodes.map((n) => [n.id, { status: 'idle' as NodeRunStatus }]),
      ),
    }

    // ── Mark run as running ──────────────────────────────────────────────────
    await prisma.workflowRun.update({
      where: { id: this.workflowRunId },
      data: {
        status: 'running',
        startedAt: new Date(),
        output: runOutput as unknown as Prisma.InputJsonValue,
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
    // Nodes owned by a loop are executed inline by the loop handler
    const loopManagedNodeIds = new Set<string>([
      ...detectionLoops.map((l) => l.branchNodeId),
      ...detectionLoops.map((l) => l.humanizerNodeId),
    ])

    // Map from detection node ID → its loop definition
    const loopByDetectionNode = new Map<string, DetectionLoop>()
    for (const loop of detectionLoops) {
      loopByDetectionNode.set(loop.detectionNodeId, loop)
    }

    // ── Build execution plan (loop-managed nodes excluded) ───────────────────
    const waves = buildExecutionWaves(workflow.nodes, workflow.edges, loopManagedNodeIds)
    const nodeOutputs = new Map<string, unknown>()
    // Store the routePath result from routing nodes (conditional-branch)
    const nodeRoutePaths = new Map<string, string>()

    // ── Execute wave by wave, parallel within each wave ──────────────────────
    let failed = false
    let lastOutputNodeResult: unknown

    for (const wave of waves) {
      if (failed) break

      await Promise.all(
        wave.map(async (node) => {
          if (failed) return

          const config = (node.config ?? {}) as Record<string, unknown>
          const ctx: NodeExecutionContext = {
            workflowRunId: this.workflowRunId,
            agencyId: this.agencyId,
            nodeId: node.id,
            workflowId: workflow.id,
          }

          // Collect inputs from upstream nodes, respecting routing decisions
          const upstreamEdges = workflow.edges.filter((e) => e.targetNodeId === node.id)
          const upstreamOutputs = upstreamEdges
            .filter((e) => {
              const routePath = nodeRoutePaths.get(e.sourceNodeId)
              if (!routePath) return true            // no routing constraint
              const edgeLabel = e.label ?? null
              if (!edgeLabel) return true            // unlabelled edge = always active
              return edgeLabel === routePath         // only activate matching path
            })
            .map((e) => nodeOutputs.get(e.sourceNodeId))

          const input =
            upstreamOutputs.length === 0
              ? null
              : upstreamOutputs.length === 1
              ? upstreamOutputs[0]
              : upstreamOutputs

          // Mark running
          runOutput.nodeStatuses[node.id] = {
            status: 'running',
            startedAt: new Date().toISOString(),
          }
          await this.persistOutput(runOutput)

          try {
            const executor = getExecutor(node.type, config)
            const result = await executor.execute(input, config, ctx)

            nodeOutputs.set(node.id, result.output)
            if (result.routePath) nodeRoutePaths.set(node.id, result.routePath)

            // ── Detection loop execution ─────────────────────────────────────
            const loop = loopByDetectionNode.get(node.id)
            if (loop) {
              await this.runDetectionLoop(
                loop,
                workflow.nodes,
                config,
                ctx,
                nodeOutputs,
                runOutput,
              )
            }

            // Record token usage
            if (result.tokensUsed !== undefined) {
              await this.recordTokenUsage(result.tokensUsed, result.modelUsed ?? node.type)
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
            const errorMessage = err instanceof Error ? err.message : String(err)

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
          }
        }),
      )
    }

    // ── Finalise run ─────────────────────────────────────────────────────────
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
      },
    })

    await auditService.log(this.agencyId, {
      actorType: 'system',
      action: `workflow.run.${finalStatus}`,
      resourceType: 'WorkflowRun',
      resourceId: this.workflowRunId,
      metadata: { workflowId: workflow.id },
    })
  }

  // ─── Detection loop execution ──────────────────────────────────────────────

  private async runDetectionLoop(
    loop: DetectionLoop,
    allNodes: GraphNode[],
    detCfg: Record<string, unknown>,
    detCtx: NodeExecutionContext,
    nodeOutputs: Map<string, unknown>,
    runOutput: RunOutput,
  ): Promise<void> {
    const detOutput = nodeOutputs.get(loop.detectionNodeId) as Record<string, unknown>
    const score = (detOutput?.overall_score as number) ?? 0
    const threshold = (detCfg.threshold as number) ?? 20
    const maxRetries = (detCfg.max_retries as number) ?? 3

    if (score <= threshold) {
      // Already passing — mark loop-managed nodes as passed without extra work
      this.markLoopManagedNodes(loop, 'pass', detOutput, nodeOutputs, runOutput)
      return
    }

    const humNode = allNodes.find((n) => n.id === loop.humanizerNodeId)!
    const branchNode = allNodes.find((n) => n.id === loop.branchNodeId)!
    const humCfg = (humNode.config ?? {}) as Record<string, unknown>
    const humCtx: NodeExecutionContext = { ...detCtx, nodeId: humNode.id }
    const humExec = new HumanizerNodeExecutor()
    const detExec = new DetectionNodeExecutor()

    let currentDetOutput = detOutput
    let retryCount = 0
    let lastScore = score
    let noImprovementCount = 0

    while (retryCount < maxRetries) {
      retryCount++

      // Mark humanizer as running
      runOutput.nodeStatuses[humNode.id] = {
        status: 'running',
        startedAt: new Date().toISOString(),
      }
      await this.persistOutput(runOutput)

      // Run humanizer
      const humResult = await humExec.execute(currentDetOutput, humCfg, humCtx)
      const humanizedText = humResult.output as string

      runOutput.nodeStatuses[humNode.id] = {
        status: 'passed',
        output: humanizedText,
        startedAt: runOutput.nodeStatuses[humNode.id].startedAt,
        completedAt: new Date().toISOString(),
        tokensUsed: humResult.tokensUsed,
        modelUsed: humResult.modelUsed,
      }
      nodeOutputs.set(humNode.id, humanizedText)

      if (humResult.tokensUsed) {
        await this.recordTokenUsage(humResult.tokensUsed, humResult.modelUsed ?? 'humanizer')
      }

      // Mark detection as running again
      runOutput.nodeStatuses[loop.detectionNodeId] = {
        ...runOutput.nodeStatuses[loop.detectionNodeId],
        status: 'running',
      }
      await this.persistOutput(runOutput)

      // Re-run detection on humanized content
      const redetResult = await detExec.execute(humanizedText, detCfg, detCtx)
      currentDetOutput = redetResult.output as Record<string, unknown>
      const newScore = (currentDetOutput.overall_score as number) ?? 0

      nodeOutputs.set(loop.detectionNodeId, currentDetOutput)

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
          this.markBranchNode(loop.branchNodeId, 'fail', currentDetOutput, nodeOutputs, runOutput)
          return
        }
      } else {
        noImprovementCount = 0
      }
      lastScore = newScore

      // Update detection status
      runOutput.nodeStatuses[loop.detectionNodeId] = {
        ...runOutput.nodeStatuses[loop.detectionNodeId],
        status: 'passed',
        output: currentDetOutput,
        completedAt: new Date().toISOString(),
      }

      if (newScore <= threshold) break
    }

    // Persist retry state
    if (!runOutput.detectionState) runOutput.detectionState = {}
    runOutput.detectionState[loop.detectionNodeId] = { retryCount, lastScore }

    const passed = ((currentDetOutput.overall_score as number) ?? 0) <= threshold
    this.markBranchNode(
      loop.branchNodeId,
      passed ? 'pass' : 'fail',
      currentDetOutput,
      nodeOutputs,
      runOutput,
    )

    await this.persistOutput(runOutput)
  }

  private markLoopManagedNodes(
    loop: DetectionLoop,
    route: 'pass' | 'fail',
    detOutput: unknown,
    nodeOutputs: Map<string, unknown>,
    runOutput: RunOutput,
  ): void {
    const branchOutput = { route, evaluated_value: (detOutput as Record<string, unknown>)?.overall_score ?? 0, input: detOutput }
    nodeOutputs.set(loop.branchNodeId, branchOutput)
    nodeOutputs.set(loop.humanizerNodeId, detOutput) // no humanizer needed
    runOutput.nodeStatuses[loop.branchNodeId] = { status: 'passed', output: branchOutput }
    runOutput.nodeStatuses[loop.humanizerNodeId] = { status: 'passed', output: 'skipped (score below threshold)' }
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

  private async recordTokenUsage(tokensUsed: number, model: string): Promise<void> {
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
