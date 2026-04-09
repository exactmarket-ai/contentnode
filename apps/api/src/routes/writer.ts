import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma, withAgency } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Writer Portal routes
// All /writer/* routes skip Clerk auth and use magic link tokens instead.
// Agency-side management routes (assign, list) use Clerk JWT via req.auth.
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the primary AI-generated content from a run's output JSON */
function extractRunPrimaryContent(output: unknown): string {
  const out = output as Record<string, unknown> | null | undefined
  if (!out) return ''

  // Prefer finalOutput set by the runner
  if (typeof out.finalOutput === 'string' && out.finalOutput.trim().length > 50) {
    return out.finalOutput.trim()
  }

  // Fall back: scan nodeStatuses for the last long text output
  const nodeStatuses = out.nodeStatuses as Record<string, Record<string, unknown>> | undefined
  const texts: string[] = []
  if (nodeStatuses) {
    for (const ns of Object.values(nodeStatuses)) {
      if (ns.status !== 'passed') continue
      const nodeOut = ns.output as Record<string, unknown> | string | undefined
      if (!nodeOut) continue
      if (typeof nodeOut === 'string' && nodeOut.trim().length > 50) {
        texts.push(nodeOut.trim())
      } else if (typeof nodeOut === 'object') {
        const content = (nodeOut as Record<string, unknown>).content
        if (typeof content === 'string' && content.trim().length > 50) {
          texts.push(content.trim())
        }
      }
    }
  }
  return texts[texts.length - 1] ?? ''
}

async function resolveWriterToken(token: string) {
  const assignment = await prisma.writerAssignment.findUnique({
    where: { magicLinkToken: token },
    include: {
      workflowRun: {
        include: { workflow: { select: { id: true, name: true, clientId: true } } },
      },
    },
  })
  if (!assignment) throw { statusCode: 401, message: 'Invalid or expired writer token' }
  if (!assignment.magicLinkExpiresAt || assignment.magicLinkExpiresAt < new Date()) {
    throw { statusCode: 401, message: 'Writer link has expired' }
  }
  return assignment
}

export async function writerRoutes(app: FastifyInstance) {

  // ── POST /api/v1/runs/:runId/assign-writer ─────────────────────────────────
  // Agency creates a writer assignment and gets back a magic link
  app.post<{ Params: { runId: string } }>('/assign', async (req, reply) => {
    const { agencyId } = req.auth
    const { writerEmail, writerName } = req.body as { writerEmail: string; writerName?: string }

    if (!writerEmail?.trim()) return reply.code(400).send({ error: 'writerEmail is required' })

    const run = await prisma.workflowRun.findFirst({
      where: { id: req.params.runId, agencyId },
      select: { id: true, status: true },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Remove any existing assignment for this run + email
    await prisma.writerAssignment.deleteMany({
      where: { workflowRunId: req.params.runId, writerEmail: writerEmail.trim(), agencyId },
    })

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    const assignment = await prisma.writerAssignment.create({
      data: {
        agencyId,
        workflowRunId: req.params.runId,
        writerEmail: writerEmail.trim(),
        writerName: writerName?.trim() ?? null,
        magicLinkToken: token,
        magicLinkExpiresAt: expiresAt,
      },
    })

    const baseUrl = process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'
    const link = `${baseUrl}/writer?token=${token}`

    return reply.code(201).send({ data: { assignment, link } })
  })

  // ── GET /api/v1/runs/:runId/writer-assignments ─────────────────────────────
  // Agency lists all writer assignments for a run
  app.get<{ Params: { runId: string } }>('/assignments', async (req, reply) => {
    const { agencyId } = req.auth
    const assignments = await prisma.writerAssignment.findMany({
      where: { workflowRunId: req.params.runId, agencyId },
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: assignments })
  })

  // ── GET /writer/verify?token= ──────────────────────────────────────────────
  // Writer verifies their token and gets assignment metadata
  app.get('/verify', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.code(400).send({ error: 'token is required' })
    try {
      const assignment = await resolveWriterToken(token)
      return reply.send({
        data: {
          assignmentId: assignment.id,
          writerName: assignment.writerName,
          writerEmail: assignment.writerEmail,
          status: assignment.status,
          workflowName: assignment.workflowRun.workflow?.name ?? 'Untitled',
          runId: assignment.workflowRunId,
        },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'Unknown error' })
    }
  })

  // ── GET /writer/draft?token= ───────────────────────────────────────────────
  // Writer fetches the AI-generated draft content to edit
  app.get('/draft', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.code(400).send({ error: 'token is required' })
    try {
      const assignment = await resolveWriterToken(token)
      const run = assignment.workflowRun
      const output = run.output as Record<string, unknown>
      const nodeStatuses = output?.nodeStatuses as Record<string, Record<string, unknown>> | undefined
      const detectionState = output?.detectionState as Record<string, { retryCount: number; lastScore: number }> | undefined

      // Collect all text outputs from the run — prefer file-export/display node outputs
      const outputs: { nodeId: string; content: string; label?: string }[] = []

      // Track humanizer and detection info for writer context
      let humanizerPasses = 0
      let bestDetectionScore: number | null = null
      let finalDetectionScore: number | null = null
      const detectionServices: string[] = []

      if (nodeStatuses) {
        for (const [_nodeId, ns] of Object.entries(nodeStatuses)) {
          if (ns.status !== 'passed') continue
          const out = ns.output as Record<string, unknown> | string | undefined

          // Count humanizer passes
          if (ns.wordsProcessed !== undefined) humanizerPasses++

          // Track detection scores
          if (out && typeof out === 'object') {
            const o = out as Record<string, unknown>
            if (o.overall_score !== undefined) {
              const score = o.overall_score as number
              finalDetectionScore = score
              if (bestDetectionScore === null || score < bestDetectionScore) bestDetectionScore = score
              if (o.service && typeof o.service === 'string' && !detectionServices.includes(o.service)) {
                detectionServices.push(o.service)
              }
            }
          }

          if (!out) continue
          if (typeof out === 'string' && out.trim().length > 50) {
            outputs.push({ nodeId: _nodeId, content: out })
          } else if (typeof out === 'object' && typeof (out as Record<string, unknown>).content === 'string') {
            const o = out as Record<string, unknown>
            const content = o.content as string
            if (content.trim().length > 50) {
              outputs.push({ nodeId: _nodeId, content, label: o.label as string | undefined })
            }
          }
        }
      }

      // Pull retry counts from detectionState if available
      if (detectionState) {
        for (const state of Object.values(detectionState)) {
          if (state.retryCount > humanizerPasses) humanizerPasses = state.retryCount
          if (bestDetectionScore === null || state.lastScore < bestDetectionScore) bestDetectionScore = state.lastScore
        }
      }

      // Build humanizer struggle summary for the writer
      let humanizerStruggle: {
        passes: number
        bestScore: number | null
        finalScore: number | null
        struggled: boolean
        message: string | null
      } | null = null

      if (humanizerPasses > 0 || finalDetectionScore !== null) {
        const struggled = (finalDetectionScore !== null && finalDetectionScore > 30) ||
                          humanizerPasses > 1

        let message: string | null = null
        if (humanizerPasses > 2 && finalDetectionScore !== null && finalDetectionScore > 50) {
          message = `The AI humanizer ran ${humanizerPasses} times but still scored ${finalDetectionScore}% AI-generated. This content needs substantial rewriting — restructure sentences and replace phrasing entirely.`
        } else if (finalDetectionScore !== null && finalDetectionScore > 30) {
          message = `After ${humanizerPasses} humanizer ${humanizerPasses === 1 ? 'pass' : 'passes'}, the content scored ${finalDetectionScore}% AI-generated. Focus on varying sentence structure and adding your own voice.`
        } else if (humanizerPasses > 1) {
          message = `The humanizer ran ${humanizerPasses} passes to reduce AI patterns. Review carefully for any remaining robotic phrasing.`
        } else if (finalDetectionScore !== null && finalDetectionScore <= 30) {
          message = `The humanizer brought the AI score down to ${finalDetectionScore}%. Light editing should be enough — focus on adding your voice and checking for any robotic phrasing.`
        } else if (humanizerPasses === 1) {
          message = `Content was processed through the humanizer once. Review for natural flow and add your own voice where needed.`
        }

        humanizerStruggle = { passes: humanizerPasses, bestScore: bestDetectionScore, finalScore: finalDetectionScore, struggled, message }
      }

      // Prefer the final output if available
      const finalOutput = output?.finalOutput
      let primaryContent = ''
      if (typeof finalOutput === 'string' && finalOutput.trim().length > 50) {
        primaryContent = finalOutput
      } else if (outputs.length > 0) {
        primaryContent = outputs[outputs.length - 1].content
      }

      return reply.send({
        data: {
          assignmentId: assignment.id,
          status: assignment.status,
          workflowName: assignment.workflowRun.workflow?.name ?? 'Untitled',
          primaryContent,
          allOutputs: outputs,
          submittedContent: assignment.submittedContent ?? null,
          humanizerStruggle,
        },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'Unknown error' })
    }
  })

  // ── POST /writer/submit?token= ─────────────────────────────────────────────
  // Writer submits their polished version
  app.post('/submit', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.code(400).send({ error: 'token is required' })
    const { content } = req.body as { content: string }
    if (!content?.trim()) return reply.code(400).send({ error: 'content is required' })

    try {
      const assignment = await resolveWriterToken(token)

      // Update assignment
      await prisma.writerAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'submitted',
          submittedContent: content.trim(),
          submittedAt: new Date(),
        },
      })

      // Create HumanizerExample for cnHumanizer training
      // Pull the original AI content as contentBefore so this example is usable in few-shot prompts
      const contentBefore = extractRunPrimaryContent(assignment.workflowRun.output)
      const trimmedAfter = content.trim()
      const wordCountAfter = trimmedAfter.split(/\s+/).filter(Boolean).length
      const wordCountBefore = contentBefore ? contentBefore.split(/\s+/).filter(Boolean).length : null
      await withAgency(assignment.agencyId, () =>
        prisma.humanizerExample.create({
          data: {
            agencyId: assignment.agencyId,
            contentBefore: contentBefore || null,
            contentAfter: trimmedAfter,
            wordCountBefore,
            wordCountAfter,
            service: 'writer',
            source: 'writer',
            workflowRunId: assignment.workflowRunId,
            approved: true,
          },
        })
      )

      return reply.send({ data: { status: 'submitted' } })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'Unknown error' })
    }
  })
}
