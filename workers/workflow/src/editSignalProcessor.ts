/**
 * editSignalProcessor — handles content library edit signals (save and approval)
 *
 * On every save or approval that differs from the previous version:
 * 1. Summarizes what changed via a cheap Claude call (max_tokens: 150)
 * 2. Writes the summary back to the content_pack_run_item
 * 3. If userId is provided, checks whether the user is a linked leadership member —
 *    if so, writes a ThoughtLeaderBrainAttachment attributed to that user
 * 4. Writes a HumanizerSignal row attributed to the user (always)
 * 5. Routes to the correct brain (thought leader / vertical / client) for the
 *    content assignment target (unchanged routing logic)
 * 6. Checks if 5+ new signals exist for any scope and enqueues a synthesis job
 *    (including user-scoped synthesis after 5 signals from the same user)
 */

import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import {
  QUEUE_CONTENT_LIBRARY_EDIT_SIGNAL,
  QUEUE_HUMANIZER_SYNTHESIS,
  type ContentLibraryEditSignalJobData,
  type HumanizerSynthesisJobData,
  getConnection,
} from './queues.js'
import { Queue, Worker, type Job } from 'bullmq'
import {
  synthesiseThoughtLeaderContext,
  synthesiseClientContext,
  synthesiseVerticalContext,
} from './clientBrainExtraction.js'

// ── Synthesis trigger threshold ───────────────────────────────────────────────
const SYNTHESIS_TRIGGER_COUNT = 5

const humanizerSynthesisQueue = new Queue<HumanizerSynthesisJobData>(
  QUEUE_HUMANIZER_SYNTHESIS,
  { connection: getConnection() },
)

// ── User context lookup ───────────────────────────────────────────────────────

async function getUserContext(userId: string | null): Promise<{ name: string; role: string } | null> {
  if (!userId) return null
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string | null; role: string }>>`
      SELECT name, role FROM users WHERE id = ${userId} LIMIT 1
    `
    if (!rows[0]) return null
    return { name: rows[0].name ?? 'Editor', role: rows[0].role }
  } catch {
    return null
  }
}

// ── Diff summarization ────────────────────────────────────────────────────────

async function summariseDiff(
  previousContent: string,
  newContent: string,
  fastProvider: string,
  fastModel: string,
  userContext: { name: string; role: string } | null,
  signalType: 'save' | 'approval',
): Promise<string> {
  const editorLine = userContext
    ? `Editor: ${userContext.name} (${userContext.role})`
    : 'Editor: unknown'

  const prompt = `A human editor revised this content.
${editorLine}
Signal type: ${signalType}

BEFORE:
${previousContent.slice(0, 800)}

AFTER:
${newContent.slice(0, 800)}

In 3-5 bullet points, describe:
- What structural or formatting changes were made
- What phrases, transitions, or sentences were removed or replaced
- What was added that was not in the original
- What the opening change reveals (if any)
- What this suggests about how this editor prefers content to read

Be specific. Use exact phrases from the text as examples.
Return bullet points only. No preamble.`

  const result = await callModel(
    {
      provider: fastProvider as 'anthropic' | 'openai' | 'ollama',
      model: fastModel,
      api_key_ref: defaultApiKeyRefForProvider(fastProvider),
      max_tokens: 150,
      temperature: 0.1,
    },
    prompt,
  )
  return result.text.trim()
}

// ── Leadership member lookup by userId ────────────────────────────────────────

async function findLinkedLeadershipMember(
  userId: string | null,
  clientId: string,
  agencyId: string,
): Promise<string | null> {
  if (!userId) return null
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM leadership_members
      WHERE user_id = ${userId} AND client_id = ${clientId} AND agency_id = ${agencyId}
      LIMIT 1
    `
    return rows[0]?.id ?? null
  } catch {
    return null
  }
}

// ── Brain routing ─────────────────────────────────────────────────────────────

async function routeToBrain(
  agencyId: string,
  clientId: string,
  targetType: string,
  targetId: string | null,
  editSignalSummary: string,
  promptName: string,
  userId: string | null,
): Promise<void> {
  if (targetType === 'member' && targetId) {
    // Leadership member → ThoughtLeaderBrainAttachment
    const member = await prisma.leadershipMember.findFirst({
      where: { id: targetId, agencyId },
      select: { clientId: true },
    })
    if (!member) return

    await prisma.thoughtLeaderBrainAttachment.create({
      data: {
        agencyId,
        clientId,
        leadershipMemberId: targetId,
        source: 'edit_signal',
        content: `EDIT SIGNAL — ${promptName}\n\n${editSignalSummary}`,
        metadata: { contentType: promptName, source: 'content_library_approval' },
        userId: userId ?? undefined,
      },
    })

    await synthesiseThoughtLeaderContext(agencyId, clientId, targetId)
    console.log(`[editSignal] thought leader brain updated for member ${targetId}`)

  } else if (targetType === 'vertical' && targetId) {
    // Vertical → VerticalBrainAttachment
    await prisma.verticalBrainAttachment.create({
      data: {
        agencyId,
        verticalId: targetId,
        filename: `edit-signal-${Date.now()}.md`,
        mimeType: 'text/markdown',
        summaryStatus: 'ready',
        summary: `EDIT SIGNAL — ${promptName}\n\n${editSignalSummary}`,
        uploadMethod: 'note',
      },
    })

    await synthesiseVerticalContext(agencyId, targetId)
    console.log(`[editSignal] vertical brain updated for vertical ${targetId}`)

  } else if (targetType === 'company') {
    // Company → ClientBrainAttachment
    await prisma.clientBrainAttachment.create({
      data: {
        agencyId,
        clientId,
        source: 'edit_signal',
        filename: `edit-signal-${Date.now()}.md`,
        mimeType: 'text/markdown',
        summaryStatus: 'ready',
        summary: `EDIT SIGNAL — ${promptName}\n\n${editSignalSummary}`,
        uploadMethod: 'note',
      },
    })

    await synthesiseClientContext(agencyId, clientId)
    console.log(`[editSignal] client brain updated for client ${clientId}`)
  }
}

// ── Synthesis trigger check ───────────────────────────────────────────────────

async function maybeEnqueueSynthesis(
  agencyId: string,
  clientId: string,
  contentType: string,
  userId: string | null,
): Promise<void> {
  type ScopeEntry = { scope: 'agency' | 'client' | 'content_type' | 'user'; scopeId: string | null }
  const scopes: ScopeEntry[] = [
    { scope: 'agency',       scopeId: null },
    { scope: 'client',       scopeId: clientId },
    { scope: 'content_type', scopeId: contentType },
  ]
  if (userId) {
    scopes.push({ scope: 'user', scopeId: userId })
  }

  for (const { scope, scopeId } of scopes) {
    const where: Record<string, unknown> = { agencyId }
    if (scope === 'client')       where['clientId'] = clientId
    if (scope === 'content_type') where['contentType'] = contentType
    // For user scope, count signals attributed to this user
    if (scope === 'user' && userId) {
      const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) AS cnt FROM humanizer_signals WHERE agency_id = ${agencyId} AND user_id = ${userId}
      `
      const count = Number(rows[0]?.cnt ?? 0)
      if (count > 0 && count % SYNTHESIS_TRIGGER_COUNT === 0) {
        await humanizerSynthesisQueue.add(
          `humanizer-user-${userId}`,
          { agencyId, scope: 'user', scopeId: userId },
          {
            jobId: `humanizer-synth-${agencyId}-user-${userId}`,
            removeOnComplete: { count: 5 },
            removeOnFail:     { count: 10 },
          },
        )
        console.log(`[editSignal] queued humanizer synthesis for scope=user scopeId=${userId}`)
      }
      continue
    }

    // Standard scope count
    const count = await prisma.humanizerSignal.count({
      where: where as Parameters<typeof prisma.humanizerSignal.count>[0]['where'],
    })

    if (count > 0 && count % SYNTHESIS_TRIGGER_COUNT === 0) {
      await humanizerSynthesisQueue.add(
        `humanizer-${scope}-${scopeId ?? agencyId}`,
        { agencyId, scope, scopeId: scopeId ?? null },
        {
          jobId:            `humanizer-synth-${agencyId}-${scope}-${scopeId ?? 'agency'}`,
          removeOnComplete: { count: 5 },
          removeOnFail:     { count: 10 },
        },
      )
      console.log(`[editSignal] queued humanizer synthesis for scope=${scope} scopeId=${scopeId ?? 'agency'}`)
    }
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processEditSignal(job: Job<ContentLibraryEditSignalJobData>): Promise<void> {
  const {
    agencyId, clientId, itemId, promptName,
    targetType, targetId, content, originalContent,
    signalType = 'approval',
    userId = null,
    previousContent = null,
  } = job.data

  // Determine before/after for this signal type
  const beforeContent = signalType === 'save'
    ? (previousContent ?? originalContent)
    : originalContent

  // Check content actually differs
  if (content.trim() === beforeContent.trim()) {
    console.log(`[editSignal] item ${itemId} has no edit diff — skipping`)
    return
  }

  const { provider: fastProv, model: fastModel } = await getModelForRole('generation_fast')

  // 1. Look up user context for the diff prompt
  const userCtx = await getUserContext(userId).catch((): null => null)

  // 2. Summarize the diff
  let editSignalSummary = ''
  try {
    editSignalSummary = await summariseDiff(beforeContent, content, fastProv, fastModel, userCtx, signalType)
  } catch (err) {
    console.error(`[editSignal] diff summarization failed for item ${itemId}:`, err)
    editSignalSummary = '[Diff analysis unavailable]'
  }

  await withAgency(agencyId, async () => {
    // 3. Write summary back to item
    await prisma.$executeRaw`
      UPDATE content_pack_run_items
      SET edit_signal_summary = ${editSignalSummary}
      WHERE id = ${itemId}
    `

    // 4. Check if editing user is a linked leadership member for this client.
    //    If so, write a thought leader brain attachment attributed to them.
    const linkedMemberId = await findLinkedLeadershipMember(userId, clientId, agencyId)
    if (linkedMemberId) {
      try {
        await prisma.thoughtLeaderBrainAttachment.create({
          data: {
            agencyId,
            clientId,
            leadershipMemberId: linkedMemberId,
            source: 'edit_signal',
            content: `EDIT SIGNAL (${signalType}) — ${promptName}\n\nEditor: ${userCtx?.name ?? 'unknown'}\n\n${editSignalSummary}`,
            metadata: { contentType: promptName, source: `content_library_${signalType}`, userId },
            userId: userId ?? undefined,
          },
        })
        await synthesiseThoughtLeaderContext(agencyId, clientId, linkedMemberId)
        console.log(`[editSignal] thought leader brain updated for linked user ${userId} → member ${linkedMemberId}`)
      } catch (err) {
        console.error(`[editSignal] linked leadership brain write failed:`, err)
      }
    }

    // 5. Route to the content assignment's brain (unchanged routing by targetType)
    //    Skip if we just wrote via linked member and targetType matches — avoid double-write
    const targetIsLinkedMember = targetType === 'member' && targetId === linkedMemberId
    if (!targetIsLinkedMember) {
      await routeToBrain(agencyId, clientId, targetType, targetId, editSignalSummary, promptName, userId).catch((err) => {
        console.error(`[editSignal] brain routing failed for item ${itemId}:`, err)
      })
    }

    // 6. Write HumanizerSignal row
    const assignmentType = targetType === 'member' ? 'leadership_member' : targetType
    const source = signalType === 'save' ? 'content_library_save' : 'content_library_approval'
    await prisma.humanizerSignal.create({
      data: {
        agencyId,
        clientId,
        source,
        attributedTo:   'employee',
        originalText:   beforeContent.slice(0, 300),
        editedText:     content.slice(0, 300),
        diffSummary:    editSignalSummary,
        contentType:    promptName,
        assignmentType,
        userId:         userId ?? undefined,
      },
    })

    // 7. Maybe trigger synthesis (including user scope)
    await maybeEnqueueSynthesis(agencyId, clientId, promptName, userId).catch((err) => {
      console.error(`[editSignal] synthesis trigger check failed:`, err)
    })
  })

  console.log(`[editSignal] processed item ${itemId} signalType=${signalType} targetType=${targetType} userId=${userId ?? 'anon'}`)
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startEditSignalWorker() {
  const worker = new Worker<ContentLibraryEditSignalJobData>(
    QUEUE_CONTENT_LIBRARY_EDIT_SIGNAL,
    processEditSignal,
    { connection: getConnection(), concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[editSignal] job ${job?.id} failed:`, err)
  })

  return worker
}
