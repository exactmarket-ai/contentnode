import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

/**
 * InsightNodeExecutor — pass-through executor that applies the insight's
 * suggested_config_change as an additional modifier to the connected downstream
 * node's effective config. The insight itself passes the input through unchanged;
 * the config mutation is applied when the downstream executor reads its config
 * (patched by the runner before execution — see runner.ts applyInsightOverrides).
 *
 * For now: passes input through and marks the insight as 'applied' if not already.
 */
export class InsightNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const insightId = config.insight_id as string | undefined

    if (insightId) {
      // Mark as applied on first execution
      const insight = await prisma.insight.findUnique({
        where: { id: insightId },
        select: { status: true },
      })

      if (insight && insight.status === 'pending') {
        await prisma.insight.update({
          where: { id: insightId },
          data: {
            status: 'applied',
            appliedAt: new Date(),
            connectedNodeId: config.connected_node_id as string | undefined,
          },
        })
      }
    }

    // Pass input through — the config modifier is applied downstream
    return { output: input }
  }
}
