import { prisma, withAgency, auditService, type Prisma } from '@contentnode/database'
import { SourceNodeExecutor } from './executors/source.js'
import { LogicNodeExecutor } from './executors/logic.js'
import { OutputNodeExecutor } from './executors/output.js'
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
}

export interface RunOutput {
  nodeStatuses: Record<string, NodeStatus>
  finalOutput?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Node executor registry
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_REGISTRY: Record<string, new () => NodeExecutor> = {
  source: SourceNodeExecutor,
  logic: LogicNodeExecutor,
  output: OutputNodeExecutor,
}

function getExecutor(nodeType: string): NodeExecutor {
  const Ctor = EXECUTOR_REGISTRY[nodeType]
  if (!Ctor) throw new Error(`No executor registered for node type "${nodeType}"`)
  return new Ctor()
}

// ─────────────────────────────────────────────────────────────────────────────
// Topological sort — returns nodes grouped into parallel execution waves
// ─────────────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  type: string
  config: Prisma.JsonValue
}

interface GraphEdge {
  sourceNodeId: string
  targetNodeId: string
}

function buildExecutionWaves(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
  const inDegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    outgoing.set(n.id, [])
  }

  for (const e of edges) {
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1)
    outgoing.get(e.sourceNodeId)!.push(e.targetNodeId)
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
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
    private readonly agencyId: string
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

    if (!run) {
      throw new Error(`WorkflowRun "${this.workflowRunId}" not found`)
    }

    const { workflow } = run

    // ── Initialise per-node status map ───────────────────────────────────────
    const runOutput: RunOutput = {
      nodeStatuses: Object.fromEntries(
        workflow.nodes.map((n) => [n.id, { status: 'idle' as NodeRunStatus }])
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

    // ── Build execution plan ─────────────────────────────────────────────────
    const waves = buildExecutionWaves(workflow.nodes, workflow.edges)
    const nodeOutputs = new Map<string, unknown>()

    // ── Execute wave by wave, parallel within each wave ──────────────────────
    let failed = false
    let lastOutputNodeResult: unknown

    for (const wave of waves) {
      if (failed) break

      await Promise.all(
        wave.map(async (node) => {
          if (failed) return

          const ctx: NodeExecutionContext = {
            workflowRunId: this.workflowRunId,
            agencyId: this.agencyId,
            nodeId: node.id,
            workflowId: workflow.id,
          }

          // Collect inputs from all upstream nodes
          const upstreamEdges = workflow.edges.filter((e) => e.targetNodeId === node.id)
          const upstreamOutputs = upstreamEdges.map((e) => nodeOutputs.get(e.sourceNodeId))
          const input =
            upstreamOutputs.length === 0
              ? null
              : upstreamOutputs.length === 1
              ? upstreamOutputs[0]
              : upstreamOutputs

          // Update status to running
          runOutput.nodeStatuses[node.id] = {
            status: 'running',
            startedAt: new Date().toISOString(),
          }
          await this.persistOutput(runOutput)

          try {
            const executor = getExecutor(node.type)
            const config = (node.config ?? {}) as Record<string, unknown>
            const result = await executor.execute(input, config, ctx)

            nodeOutputs.set(node.id, result.output)

            // Record token usage for AI nodes
            if (result.tokensUsed !== undefined) {
              await this.recordTokenUsage(result.tokensUsed, result.modelUsed ?? node.type)
            }

            runOutput.nodeStatuses[node.id] = {
              status: 'passed',
              output: result.output,
              startedAt: runOutput.nodeStatuses[node.id].startedAt,
              completedAt: new Date().toISOString(),
              tokensUsed: result.tokensUsed,
              modelUsed: result.modelUsed,
            }
            await this.persistOutput(runOutput)

            // Track last output node result for the run's final output
            if (node.type === 'output') {
              lastOutputNodeResult = result.output
            }

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
        })
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
        ...(failed
          ? { errorMessage: this.firstFailedNodeError(runOutput) }
          : {}),
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
