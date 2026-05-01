/**
 * brainCollapseProcessor — rolls up box_revision ClientBrainAttachments into a single synthesis.
 *
 * Each Box revision creates a ClientBrainAttachment with source: 'box_revision'.
 * For active clients this accumulates into hundreds of near-duplicate records per year.
 * This processor reads all non-archived box_revision records, synthesizes them into one
 * rolling style profile via Claude, creates a box_revision_synthesis record, and
 * marks the source records as summaryStatus: 'archived' so they are excluded from
 * all future brain injection queries (which filter by summaryStatus: 'ready').
 *
 * Triggered by boxDiffProcessor when the unarchived box_revision count >= 10.
 * Job is keyed per client so duplicate enqueues are deduplicated by BullMQ.
 */

import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { QUEUE_BRAIN_COLLAPSE, type BrainCollapseJobData, getConnection } from './queues.js'
import { Worker, type Job } from 'bullmq'

const MIN_TO_COLLAPSE = 10  // must have at least this many to synthesize

async function collapseBrainAttachments(job: Job<BrainCollapseJobData>) {
  const { agencyId, clientId } = job.data

  await withAgency(agencyId, async () => {
    const attachments = await prisma.clientBrainAttachment.findMany({
      where: {
        agencyId,
        clientId,
        source: 'box_revision',
        summaryStatus: 'ready',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, summary: true, createdAt: true },
    })

    if (attachments.length < MIN_TO_COLLAPSE) {
      console.log(`[brainCollapse] client ${clientId}: only ${attachments.length} records, skipping`)
      return
    }

    const combinedSummaries = attachments
      .filter((a) => a.summary)
      .map((a, i) => {
        const date = a.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        return `## Revision ${i + 1} (${date})\n${a.summary}`
      })
      .join('\n\n---\n\n')

    const { provider: rProv, model: rModel } = await getModelForRole('brain_processing')
    const result = await callModel(
      { provider: rProv as 'anthropic' | 'openai' | 'ollama', model: rModel, api_key_ref: defaultApiKeyRefForProvider(rProv) },
      `You are synthesizing ${attachments.length} Box document revision notes for a client into a single coherent style profile.

INPUT REVISIONS — chronological order, most recent carries more weight:
${combinedSummaries.slice(0, 16000)}

OUTPUT: Write a single, comprehensive style profile capturing everything learned. Use these headers exactly:
## Tone Preferences
## Structural Preferences
## Content to Avoid
## Notable Patterns

Be concrete and specific. Where earlier and later revisions contradict, follow the later one. Omit speculative observations.`.trim(),
    )

    const synthDate = new Date().toISOString().split('T')[0]

    await prisma.clientBrainAttachment.create({
      data: {
        agencyId,
        clientId,
        source: 'box_revision_synthesis',
        filename: `box-revision-synthesis-${synthDate}.md`,
        mimeType: 'text/markdown',
        summaryStatus: 'ready',
        summary: result.text,
        uploadMethod: 'note',
      },
    })

    // Soft-delete source records by setting summaryStatus to 'archived'.
    // All brain injection queries filter summaryStatus: 'ready', so these
    // will automatically be excluded without any other code changes.
    await prisma.clientBrainAttachment.updateMany({
      where: { id: { in: attachments.map((a) => a.id) } },
      data:  { summaryStatus: 'archived' },
    })

    console.log(`[brainCollapse] client ${clientId}: synthesized ${attachments.length} box_revision records into box_revision_synthesis`)
  })
}

export function startBrainCollapseWorker() {
  const worker = new Worker<BrainCollapseJobData>(
    QUEUE_BRAIN_COLLAPSE,
    collapseBrainAttachments,
    { connection: getConnection(), concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[brainCollapse] job ${job?.id} failed:`, err)
  })

  return worker
}
