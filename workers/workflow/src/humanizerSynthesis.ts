/**
 * humanizerSynthesis — synthesises HumanizerSignal rows into a compiled style profile.
 *
 * Called after every 5 new HumanizerSignal rows for a given scope.
 * Produces a HumanizerProfile record whose `profile` text is injected into
 * content generation prompts as a style layer.
 */

import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import {
  QUEUE_HUMANIZER_SYNTHESIS,
  type HumanizerSynthesisJobData,
  getConnection,
} from './queues.js'
import { Worker, type Job } from 'bullmq'

// ── Synthesis prompt ──────────────────────────────────────────────────────────

function buildSynthesisPrompt(
  signals: Array<{ diffSummary: string | null; originalText: string; editedText: string; contentType: string | null }>,
  scope: string,
  scopeLabel: string,
): string {
  const allSummaries = signals
    .filter((s) => s.diffSummary)
    .map((s) => `[${s.contentType ?? 'unknown'}] ${s.diffSummary}`)
    .join('\n---\n')

  const pairs = signals
    .slice(0, 5)
    .map((s, i) => `PAIR ${i + 1} [${s.contentType ?? 'unknown'}]:\nOriginal: ${s.originalText.slice(0, 300)}\nApproved: ${s.editedText.slice(0, 300)}`)
    .join('\n\n')

  const distinctContentTypes = [...new Set(
    signals.map((s) => s.contentType).filter(Boolean) as string[]
  )]
  const contentTypeList = distinctContentTypes.length > 0
    ? distinctContentTypes.join(', ')
    : 'unknown'

  return `You are building a style intelligence profile for a content generation system.
This profile will be injected into content generation prompts to make AI-generated
content read more like genuine human writing from the start.

The profile is based on real human editorial decisions — what editors
consistently changed when reviewing AI-generated content.

EDIT SIGNALS (${signals.length} total):
${allSummaries}

SAMPLE BEFORE/AFTER PAIRS:
${pairs}

Synthesize these signals into actionable writing instructions.
Group your output by content type. Content types present in these signals:
${contentTypeList}

For EACH content type present, produce a labeled section:

[CONTENT TYPE NAME]
1. Opening: How should this content type open? What do editors change about AI openings?
2. Sentence rhythm: What length and complexity do editors prefer for this type?
3. Remove these transitions: List specific phrases editors consistently delete.
4. Structure: Prose vs formatting — what do editors add or remove?
5. Voice: What do editors inject that AI does not generate?
6. Never do: The most common AI patterns editors remove. Exact phrases and habits.

After all per-type sections, add:

[ALL CONTENT TYPES]
Patterns observed across every content type regardless of format.

Use "Do" and "Do not" framing throughout. Be specific — use exact phrases
from the signals as examples. Under 600 words total.
Return instructions only. No preamble.`
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processHumanizerSynthesis(job: Job<HumanizerSynthesisJobData>): Promise<void> {
  const { agencyId, scope, scopeId } = job.data

  await withAgency(agencyId, async () => {
    let signals: Array<{ diffSummary: string | null; originalText: string; editedText: string; contentType: string | null }>
    let scopeLabel: string

    if (scope === 'user' && scopeId) {
      // User-scoped synthesis: fetch signals attributed to this specific user
      const rows = await prisma.$queryRaw<Array<{
        diff_summary: string | null
        original_text: string
        edited_text: string
        content_type: string | null
      }>>`
        SELECT diff_summary, original_text, edited_text, content_type
        FROM humanizer_signals
        WHERE agency_id = ${agencyId} AND user_id = ${scopeId}
        ORDER BY created_at ASC
      `
      signals = rows.map((r) => ({
        diffSummary:  r.diff_summary,
        originalText: r.original_text,
        editedText:   r.edited_text,
        contentType:  r.content_type,
      }))

      // Get user name for the scope label
      const userRows = await prisma.$queryRaw<Array<{ name: string | null }>>`
        SELECT name FROM users WHERE id = ${scopeId} LIMIT 1
      `
      const userName = userRows[0]?.name ?? scopeId
      scopeLabel = `user "${userName}" (${signals.length} signals)`
    } else {
      // Fetch all signals for standard scopes
      const where: Record<string, unknown> = { agencyId }
      if (scope === 'client' && scopeId)       where['clientId'] = scopeId
      if (scope === 'content_type' && scopeId) where['contentType'] = scopeId

      signals = await prisma.humanizerSignal.findMany({
        where: where as Parameters<typeof prisma.humanizerSignal.findMany>[0]['where'],
        orderBy: { createdAt: 'asc' },
        select: { diffSummary: true, originalText: true, editedText: true, contentType: true },
      })

      scopeLabel = scope === 'agency'
        ? `agency-wide (${signals.length} signals)`
        : scope === 'client'
          ? `client ${scopeId}`
          : `content type "${scopeId}"`
    }

    if (signals.length === 0) return

    const { provider: rProv, model: rModel } = await getModelForRole('brain_processing')
    const result = await callModel(
      {
        provider: rProv as 'anthropic' | 'openai' | 'ollama',
        model: rModel,
        api_key_ref: defaultApiKeyRefForProvider(rProv),
        max_tokens: 600,
        temperature: 0.2,
      },
      buildSynthesisPrompt(signals, scope, scopeLabel),
    )

    await prisma.humanizerProfile.upsert({
      where: {
        agencyId_scope_scopeId: {
          agencyId,
          scope,
          scopeId: scopeId ?? null,
        },
      },
      create: {
        agencyId,
        scope,
        scopeId:       scopeId ?? null,
        profile:       result.text.trim(),
        signalCount:   signals.length,
        lastSynthesisAt: new Date(),
      },
      update: {
        profile:        result.text.trim(),
        signalCount:    signals.length,
        lastSynthesisAt: new Date(),
        updatedAt:      new Date(),
      },
    })

    console.log(`[humanizerSynth] profile written for scope=${scope} scopeId=${scopeId ?? 'agency'} signals=${signals.length}`)
  })
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startHumanizerSynthesisWorker() {
  const worker = new Worker<HumanizerSynthesisJobData>(
    QUEUE_HUMANIZER_SYNTHESIS,
    processHumanizerSynthesis,
    { connection: getConnection(), concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[humanizerSynth] job ${job?.id} failed:`, err)
  })

  return worker
}

// ── Exported helper — load compiled profile for injection ────────────────────

export async function loadHumanizerProfiles(
  agencyId: string,
  clientId: string,
  contentType: string,
  reviewerUserId?: string | null,
): Promise<string | null> {
  const orClauses: Array<{ scope: string; scopeId: string | null }> = [
    { scope: 'agency',       scopeId: null },
    { scope: 'client',       scopeId: clientId },
    { scope: 'content_type', scopeId: contentType },
  ]
  if (reviewerUserId) {
    orClauses.push({ scope: 'user', scopeId: reviewerUserId })
  }

  const profiles = await prisma.humanizerProfile.findMany({
    where: {
      agencyId,
      OR: orClauses as never,
    },
    select: { scope: true, profile: true },
    orderBy: { scope: 'asc' }, // agency first, then client, content_type, user
  })

  // Separate reviewer/user profile from the base layers
  const baseParts: string[] = []
  let reviewerPart: string | null = null

  for (const p of profiles) {
    if (!p.profile?.trim()) continue
    if (p.scope === 'user') {
      reviewerPart = p.profile
    } else {
      baseParts.push(p.profile)
    }
  }

  if (baseParts.length === 0 && !reviewerPart) return null

  // Base layers first, then reviewer style hint as the lowest-priority layer
  const parts = [...baseParts]
  if (reviewerPart) {
    parts.push(`REVIEWER STYLE PROFILE (apply if it helps match this reviewer's preferences):\n${reviewerPart}`)
  }

  return parts.join('\n\n')
}
