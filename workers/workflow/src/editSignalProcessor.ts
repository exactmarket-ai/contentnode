/**
 * editSignalProcessor — handles content library approval edit signals
 *
 * When a piece is approved in the Content Library with edits vs. the original,
 * this processor:
 * 1. Summarizes what changed via a cheap Claude call (max_tokens: 150)
 * 2. Writes the summary back to the content_pack_run_item
 * 3. Routes to the correct brain (thought leader / vertical / client) based on targetType
 * 4. Writes a HumanizerSignal row for the cnHumanizer intelligence layer
 * 5. Checks if 5+ new signals exist for any scope and enqueues a synthesis job
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

// ── Diff summarization ────────────────────────────────────────────────────────

async function summariseDiff(original: string, approved: string, fastProvider: string, fastModel: string): Promise<string> {
  const prompt = `A human editor revised this AI-generated content before approving it.
Analyze what changed and what it reveals about human vs AI writing patterns.

ORIGINAL (AI-generated):
${original.slice(0, 800)}

APPROVED (human-edited):
${approved.slice(0, 800)}

In 3-5 bullet points, describe:
- What structural or formatting changes were made
- What phrases, transitions, or sentences were removed or replaced
- What was added that the AI did not generate
- What the opening change reveals (if any)
- What this suggests about how this human prefers content to read

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

// ── Brain routing ─────────────────────────────────────────────────────────────

async function routeToBrain(
  agencyId: string,
  clientId: string,
  targetType: string,
  targetId: string | null,
  editSignalSummary: string,
  promptName: string,
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

async function maybeEnqueueSynthesis(agencyId: string, clientId: string, contentType: string): Promise<void> {
  const scopes: Array<{ scope: 'agency' | 'client' | 'content_type'; scopeId: string | null }> = [
    { scope: 'agency', scopeId: null },
    { scope: 'client', scopeId: clientId },
    { scope: 'content_type', scopeId: contentType },
  ]

  for (const { scope, scopeId } of scopes) {
    const where: Record<string, unknown> = {
      agencyId,
      source: 'content_library_approval',
    }
    if (scope === 'client')       where['clientId'] = clientId
    if (scope === 'content_type') where['contentType'] = contentType

    const count = await prisma.humanizerSignal.count({ where: where as Parameters<typeof prisma.humanizerSignal.count>[0]['where'] })

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
  const { agencyId, clientId, itemId, promptName, targetType, targetId, content, originalContent } = job.data

  // Check content actually differs
  if (content.trim() === originalContent.trim()) {
    console.log(`[editSignal] item ${itemId} has no edit diff — skipping`)
    return
  }

  const { provider: fastProv, model: fastModel } = await getModelForRole('generation_fast')

  // 1. Summarize the diff
  let editSignalSummary = ''
  try {
    editSignalSummary = await summariseDiff(originalContent, content, fastProv, fastModel)
  } catch (err) {
    console.error(`[editSignal] diff summarization failed for item ${itemId}:`, err)
    editSignalSummary = '[Diff analysis unavailable]'
  }

  await withAgency(agencyId, async () => {
    // 2. Write summary back to item
    await prisma.$executeRaw`
      UPDATE content_pack_run_items
      SET edit_signal_summary = ${editSignalSummary}
      WHERE id = ${itemId}
    `

    // 3. Route to correct brain (fire-and-forget inside transaction boundary)
    await routeToBrain(agencyId, clientId, targetType, targetId, editSignalSummary, promptName).catch((err) => {
      console.error(`[editSignal] brain routing failed for item ${itemId}:`, err)
    })

    // 4. Write HumanizerSignal row
    const assignmentType = targetType === 'member' ? 'leadership_member' : targetType
    await prisma.humanizerSignal.create({
      data: {
        agencyId,
        clientId,
        source:         'content_library_approval',
        attributedTo:   'employee',
        originalText:   originalContent.slice(0, 300),
        editedText:     content.slice(0, 300),
        diffSummary:    editSignalSummary,
        contentType:    promptName,
        assignmentType,
      },
    })

    // 5. Maybe trigger synthesis
    await maybeEnqueueSynthesis(agencyId, clientId, promptName).catch((err) => {
      console.error(`[editSignal] synthesis trigger check failed:`, err)
    })
  })

  console.log(`[editSignal] processed item ${itemId} — targetType=${targetType}`)
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
