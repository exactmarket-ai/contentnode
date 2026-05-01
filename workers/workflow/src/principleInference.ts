/**
 * principleInference — infers underlying editorial principles from surface-level
 * HumanizerSignal edit pairs.
 *
 * The distinction from surface signals:
 *   Signal:    "removes superlatives"
 *   Principle: "distrusts enthusiasm; demands specificity over claims"
 *
 * A principle explains WHY a cluster of surface signals exists, and generalises
 * to content types the system has never seen this stakeholder edit.
 *
 * Trigger: after each boxDiff that pushes a stakeholder's revisionCount to a
 * multiple of 5, with a 48-hour dedup guard via BullMQ jobId.
 *
 * Output: StakeholderPrinciple records, upserted by principle text similarity.
 */

import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { QUEUE_PRINCIPLE_INFERENCE, type PrincipleInferenceJobData, getConnection } from './queues.js'
import { Worker, type Job } from 'bullmq'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeightedSignal {
  signal:     string
  confidence: number
}

interface InferredPrinciple {
  principle:        string
  explanation:      string
  supportingSignals: string[]
  confidence:       number
  generalizesTo:    string[]
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const PRINCIPLE_INFERENCE_PROMPT = (signalList: string, summaryList: string) => `
You are a content strategist analyzing how a specific stakeholder consistently edits AI-generated content.

You have been given:
1. Surface-level style signals extracted from their edits (with confidence weights)
2. Plain-English summaries of what they changed in each revision, most recent first

Your job is NOT to summarise these signals. Your job is to infer the underlying PRINCIPLES that explain WHY this person makes these edits consistently.

A principle is a generalised belief or value that:
- Explains a cluster of related surface signals as expressions of the same underlying preference
- Would predict how this person would edit content types they have never reviewed
- Is stated as a belief or value — not as a rule
  WRONG: "removes superlatives"  (that is a signal)
  RIGHT: "distrusts enthusiasm; believes unearned confidence erodes credibility"  (that is a principle)

SURFACE SIGNALS:
${signalList}

EDIT SUMMARIES (most recent first):
${summaryList}

Return ONLY a JSON object with this exact structure:
{
  "principles": [
    {
      "principle": "Short declarative statement of the underlying belief or value",
      "explanation": "Which specific signals and patterns led to this inference — be concrete about the grouping",
      "supportingSignals": ["exact signal strings from the list above that cluster under this principle"],
      "confidence": 0.75,
      "generalizesTo": ["content types where this principle would apply even without direct observation — e.g. 'executive_brief', 'email', 'video_script'"]
    }
  ]
}

Rules:
- Return 1–5 principles. Fewer sharp principles beat many vague ones.
- Only infer a principle if at least two surface signals cluster together under it.
- Confidence reflects how clearly the signals point to one underlying belief:
    0.85–0.95: multiple signals converge with no contradictions
    0.65–0.84: clear pattern with minor ambiguity
    0.40–0.64: plausible inference from limited evidence
- If you cannot infer any principle with confidence >= 0.40, return an empty principles array.
- Do not invent signals not present in the list. Only group what is there.
`.trim()

// ── Processor ─────────────────────────────────────────────────────────────────

async function inferPrinciples(job: Job<PrincipleInferenceJobData>) {
  const { agencyId, stakeholderId } = job.data

  await withAgency(agencyId, async () => {
    // 1. Load the profile — abort if not enough revisions
    const profile = await prisma.stakeholderPreferenceProfile.findUnique({
      where:  { stakeholderId },
      select: { toneSignals: true, structureSignals: true, rejectPatterns: true, revisionCount: true },
    })
    if (!profile || (profile.revisionCount ?? 0) < 5) return

    // 2. Load diff summaries from HumanizerSignal — raw source of truth
    const signals = await prisma.humanizerSignal.findMany({
      where:   { agencyId, stakeholderId, diffSummary: { not: null } },
      orderBy: { createdAt: 'desc' },
      take:    25,
      select:  { diffSummary: true, documentType: true, createdAt: true },
    })
    if (signals.length < 3) {
      console.log(`[principleInference] stakeholder ${stakeholderId}: fewer than 3 summaries, skipping`)
      return
    }

    // 3. Build input lists
    const allSignals: string[] = [
      ...(profile.toneSignals      as unknown as WeightedSignal[]).map((s) => s.signal),
      ...(profile.structureSignals as unknown as WeightedSignal[]).map((s) => s.signal),
      ...(profile.rejectPatterns   as unknown as WeightedSignal[]).map((s) => s.signal),
    ].filter(Boolean)

    if (allSignals.length < 2) {
      console.log(`[principleInference] stakeholder ${stakeholderId}: fewer than 2 surface signals, skipping`)
      return
    }

    const signalList = allSignals.map((s) => `- ${s}`).join('\n')

    const summaryList = signals
      .map((s, i) => {
        const date = s.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const typeTag = s.documentType ? `, ${s.documentType}` : ''
        return `${i + 1}. [${date}${typeTag}] ${s.diffSummary}`
      })
      .join('\n')

    // 4. Call model via registry — never Haiku for brain/signal tasks (CLAUDE.md rule)
    const { provider: rProv, model: rModel } = await getModelForRole('brain_processing')
    const result = await callModel(
      { provider: rProv as 'anthropic' | 'openai' | 'ollama', model: rModel, api_key_ref: defaultApiKeyRefForProvider(rProv) },
      PRINCIPLE_INFERENCE_PROMPT(signalList, summaryList),
    )

    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[principleInference] Claude returned no parseable JSON')
      return
    }

    let parsed: { principles: InferredPrinciple[] }
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      console.warn('[principleInference] JSON parse failed')
      return
    }

    if (!Array.isArray(parsed.principles) || parsed.principles.length === 0) {
      console.log(`[principleInference] stakeholder ${stakeholderId}: no principles inferred at threshold`)
      return
    }

    // 5. Upsert principles — match by first 60 chars of principle text (case-insensitive)
    const now = new Date()
    let upserted = 0

    for (const p of parsed.principles) {
      if ((p.confidence ?? 0) < 0.4) continue
      if (!p.principle?.trim()) continue

      const key = p.principle.trim().slice(0, 60).toLowerCase()

      const existing = await prisma.stakeholderPrinciple.findFirst({
        where: {
          agencyId,
          stakeholderId,
          status:    'active',
          principle: { contains: key, mode: 'insensitive' },
        },
        select: { id: true },
      })

      if (existing) {
        await prisma.stakeholderPrinciple.update({
          where: { id: existing.id },
          data: {
            explanation:       p.explanation,
            confidence:        p.confidence,
            observedCount:     profile.revisionCount,
            supportingSignals: p.supportingSignals as never,
            contentTypes:      p.generalizesTo     as never,
            lastInferredAt:    now,
          },
        })
      } else {
        await prisma.stakeholderPrinciple.create({
          data: {
            agencyId,
            stakeholderId,
            principle:         p.principle.trim(),
            explanation:       p.explanation,
            confidence:        p.confidence,
            observedCount:     profile.revisionCount,
            supportingSignals: p.supportingSignals as never,
            contentTypes:      p.generalizesTo     as never,
            status:            'active',
            lastInferredAt:    now,
          },
        })
      }
      upserted++
    }

    // 6. Stamp the profile so the trigger knows when we last ran
    await prisma.stakeholderPreferenceProfile.update({
      where: { stakeholderId },
      data:  { lastPrincipleInferredAt: now },
    })

    console.log(`[principleInference] stakeholder ${stakeholderId}: upserted ${upserted} principles from ${signals.length} revisions`)
  })
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startPrincipleInferenceWorker() {
  const worker = new Worker<PrincipleInferenceJobData>(
    QUEUE_PRINCIPLE_INFERENCE,
    inferPrinciples,
    { connection: getConnection(), concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[principleInference] job ${job?.id} failed:`, err)
  })

  return worker
}
