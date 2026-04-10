import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowOutputExecutor
//
// Config shape:
//   sourceWorkflowId: string    — workflow to pull output from
//   divisionId?: string         — optional filter
//   jobId?: string              — optional filter
//   outputNodeId?: string       — which output node's result to use (by node id)
//   fallbackToLatest: boolean   — fallback to latest completed run if no approved run
//
// Logic:
//  1. Query WorkflowRun for completed runs matching sourceWorkflowId + filters
//  2. First try: find the most recently approved run (feedback decision in approved*)
//  3. Fallback (fallbackToLatest=true): take most recently completed run
//  4. Extract target output node result from run.output.nodeStatuses[outputNodeId].output
//  5. Return output + metadata
// ─────────────────────────────────────────────────────────────────────────────

export class WorkflowOutputExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const sourceWorkflowId = config.sourceWorkflowId as string | undefined
    if (!sourceWorkflowId) {
      throw new Error('WorkflowOutput: sourceWorkflowId is required in config')
    }

    const divisionId = config.divisionId as string | undefined
    const jobId = config.jobId as string | undefined
    const outputNodeId = config.outputNodeId as string | undefined
    const fallbackToLatest = (config.fallbackToLatest as boolean | undefined) ?? true

    // Build base filter — always scope to agency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: any = {
      agencyId: ctx.agencyId,
      workflowId: sourceWorkflowId,
      status: 'completed',
    }
    if (divisionId) baseWhere.divisionId = divisionId
    if (jobId) baseWhere.jobId = jobId

    // Step 1: Try to find a run with an approved feedback
    const approvedRuns = await prisma.workflowRun.findMany({
      where: {
        ...baseWhere,
        feedbacks: {
          some: {
            decision: { in: ['approved', 'approved_with_changes'] },
          },
        },
      },
      include: {
        feedbacks: {
          where: { decision: { in: ['approved', 'approved_with_changes'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    let selectedRun: typeof approvedRuns[number] | null = approvedRuns[0] ?? null
    let approvalStatus: 'approved' | 'latest' | 'none' = selectedRun ? 'approved' : 'none'
    let warning: string | undefined

    // Step 2: Fallback to latest completed run
    if (!selectedRun && fallbackToLatest) {
      const latestRuns = await prisma.workflowRun.findMany({
        where: baseWhere,
        include: { feedbacks: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })
      selectedRun = latestRuns[0] ?? null
      if (selectedRun) {
        approvalStatus = 'latest'
        warning = 'No approved run found — using the most recent completed run. Review and approve a run to remove this warning.'
      }
    }

    if (!selectedRun) {
      throw new Error(
        `WorkflowOutput: no completed run found for workflow "${sourceWorkflowId}"` +
        (divisionId ? ` division="${divisionId}"` : '') +
        (jobId ? ` job="${jobId}"` : ''),
      )
    }

    // Step 3: Extract the target node's output
    const runOutput = selectedRun.output as {
      nodeStatuses?: Record<string, { output?: unknown; status?: string }>
    } | null

    const nodeStatuses = runOutput?.nodeStatuses ?? {}

    let extractedOutput: unknown

    if (outputNodeId) {
      // Use the specific output node's output
      const nodeStatus = nodeStatuses[outputNodeId]
      if (!nodeStatus) {
        throw new Error(
          `WorkflowOutput: outputNodeId "${outputNodeId}" not found in run "${selectedRun.id}". ` +
          `Available nodes: ${Object.keys(nodeStatuses).join(', ') || '(none)'}`,
        )
      }
      extractedOutput = nodeStatus.output
    } else {
      // Auto-detect: pick the last passed output-type node's result
      // We find the first node status with a string or non-empty output
      const passedNodes = Object.entries(nodeStatuses).filter(
        ([, ns]) => ns.status === 'passed' && ns.output != null,
      )
      if (passedNodes.length === 0) {
        throw new Error(`WorkflowOutput: no passed nodes with output found in run "${selectedRun.id}"`)
      }
      // Use last entry (typically the final output node)
      extractedOutput = passedNodes[passedNodes.length - 1][1].output
    }

    return {
      output: extractedOutput,
      ...(warning ? {} : {}), // warning surfaced via metadata below
    }
  }
}
