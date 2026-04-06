import crypto from 'node:crypto'
import { prisma, auditService } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// ClientFeedback node executor
//
// Pauses the workflow run and sets up stakeholder portal access.
// The run resumes (via a child run) when the portal receives feedback that
// matches the configured auto_trigger_on sentiments.
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedbackNodeOutput {
  source_type: string           // portal | manual | transcription
  trigger_mode: string          // auto | manual
  pending_stakeholders: Array<{
    stakeholder_id: string
    email: string
    name: string
    portal_token: string
  }>
  workflow_run_id: string
  node_id: string
}

const TOKEN_TTL_DAYS = 30

export class FeedbackNodeExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const sourceType   = (config.source_type   as string) ?? 'portal'
    const triggerMode  = (config.trigger_mode  as string) ?? 'auto'
    const stakeholderIds = (config.stakeholder_ids as string[]) ?? []

    // ── Look up stakeholders and refresh their magic link tokens ─────────────
    const pendingStakeholders: FeedbackNodeOutput['pending_stakeholders'] = []

    for (const sid of stakeholderIds) {
      // findUnique won't have agency injected but we're running in withAgency context
      const stakeholder = await prisma.stakeholder.findFirst({
        where: { id: sid },
      })
      if (!stakeholder) continue

      const token     = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

      await prisma.stakeholder.update({
        where: { id: sid },
        data: {
          magicLinkToken:     token,
          magicLinkExpiresAt: expiresAt,
        },
      })

      pendingStakeholders.push({
        stakeholder_id: stakeholder.id,
        email:          stakeholder.email,
        name:           stakeholder.name,
        portal_token:   token,
      })
    }

    const output: FeedbackNodeOutput = {
      source_type:           sourceType,
      trigger_mode:          triggerMode,
      pending_stakeholders:  pendingStakeholders,
      workflow_run_id:       ctx.workflowRunId,
      node_id:               ctx.nodeId,
    }

    await auditService.log(ctx.agencyId, {
      actorType:    'system',
      action:       'workflow.feedback.waiting',
      resourceType: 'WorkflowRun',
      resourceId:   ctx.workflowRunId,
      metadata: {
        nodeId:          ctx.nodeId,
        sourceType,
        triggerMode,
        stakeholderCount: pendingStakeholders.length,
      },
    })

    return {
      output,
      waitingFeedback:    true,
      pendingFeedbackNodeId: ctx.nodeId,
    }
  }
}
