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
  signals: Array<{ diffSummary: string | null; originalText: string; editedText: string }>,
  scope: string,
  scopeLabel: string,
): string {
  const summaries = signals
    .filter((s) => s.diffSummary)
    .map((s) => s.diffSummary as string)
    .join('\n---\n')

  const pairs = signals
    .slice(0, 5)
    .map((s, i) => `PAIR ${i + 1}:\nOriginal: ${s.originalText.slice(0, 300)}\nApproved: ${s.editedText.slice(0, 300)}`)
    .join('\n\n')

  return `You are building a style intelligence profile for a content generation system.
This profile will be injected into content generation prompts to make AI-generated
content read more like genuine human writing from the start.

The profile is based on real human editorial decisions — what human editors
consistently changed when reviewing AI-generated content.

SCOPE: ${scope} — ${scopeLabel}

EDIT SIGNALS (${signals.length} total):
${summaries}

SAMPLE ORIGINALS AND APPROVALS:
${pairs}

Synthesize these signals into a set of specific, actionable writing instructions.
Cover:

1. OPENING PATTERNS
   How should content open? What do humans consistently change about AI openings?
   Give specific rules e.g. "Never start with a question" or "First sentence must
   be a direct statement, not a setup."

2. SENTENCE STRUCTURE
   What sentence rhythm do humans prefer? What do they change about AI sentence
   length or complexity?

3. TRANSITIONS AND CONNECTIVE TISSUE
   Which transition phrases do humans remove? What do they use instead?
   List specific words and phrases to avoid.

4. STRUCTURAL PREFERENCES
   Do humans prefer prose or structure? When do they remove headers or bullets?
   When do they add them?

5. VOICE MARKERS
   What do humans inject that AI doesn't generate? First-person observations?
   Specific stories? Direct opinions? Contrarian statements?

6. WHAT TO AVOID
   The most common AI writing patterns that humans consistently remove or replace.
   Be specific — list exact phrases, sentence starters, and structural habits.

Write this as a set of direct instructions for a content generator, not an analysis.
Use "Do" and "Do not" framing. Be specific. Under 400 words.
Return the instructions only. No preamble, no headers.`
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processHumanizerSynthesis(job: Job<HumanizerSynthesisJobData>): Promise<void> {
  const { agencyId, scope, scopeId } = job.data

  await withAgency(agencyId, async () => {
    let signals: Array<{ diffSummary: string | null; originalText: string; editedText: string }>
    let scopeLabel: string

    if (scope === 'user' && scopeId) {
      // User-scoped synthesis: fetch signals attributed to this specific user
      const rows = await prisma.$queryRaw<Array<{
        diff_summary: string | null
        original_text: string
        edited_text: string
      }>>`
        SELECT diff_summary, original_text, edited_text
        FROM humanizer_signals
        WHERE agency_id = ${agencyId} AND user_id = ${scopeId}
        ORDER BY created_at ASC
      `
      signals = rows.map((r) => ({
        diffSummary:  r.diff_summary,
        originalText: r.original_text,
        editedText:   r.edited_text,
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
        select: { diffSummary: true, originalText: true, editedText: true },
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
