/**
 * boxDiffProcessor — processes Box FILE.NEW_VERSION diffs
 *
 * For each before/after edit pair:
 * 1. Runs Claude to extract STYLISTIC signals from the diff (factual corrections excluded)
 * 2. Updates HumanizerSignal with the diffSummary
 * 3. Creates a BrainAttachment on the client tagged to the stakeholder
 * 4. Applies lazy confidence decay to stale signals, then merges new signals
 *    into the StakeholderPreferenceProfile using weighted scoring
 * 5. Generates Insights from the profile once enough signal accumulates
 * 6. Triggers principle inference when revisionCount hits a multiple of 5
 * 7. Computes pgvector embedding on HumanizerSignal for few-shot retrieval
 * 8. Triggers brain collapse when box_revision attachment count >= threshold
 * 9. Updates Monday item with "Revised ✓" status + comment
 */

import { prisma, withAgency } from '@contentnode/database'
import { callModel, embedText } from '@contentnode/ai'
import { QUEUE_BOX_DIFF, QUEUE_BRAIN_COLLAPSE, QUEUE_PRINCIPLE_INFERENCE, type BoxDiffJobData, type BrainCollapseJobData, type PrincipleInferenceJobData, getConnection } from './queues.js'
import { Worker, Queue, type Job } from 'bullmq'

const brainCollapseQueue      = new Queue<BrainCollapseJobData>(QUEUE_BRAIN_COLLAPSE,      { connection: getConnection() })
const principleInferenceQueue = new Queue<PrincipleInferenceJobData>(QUEUE_PRINCIPLE_INFERENCE, { connection: getConnection() })

// ── WeightedSignal type ────────────────────────────────────────────────────────
// Stored as JSON in the three signal arrays on StakeholderPreferenceProfile.

interface WeightedSignal {
  signal:       string
  confidence:   number  // 0.0–1.0; signals below MIN_INJECT_CONFIDENCE are skipped at generation time
  observedCount: number // how many diffs confirmed this signal
  firstSeenAt:  string  // ISO timestamp
  lastSeenAt:   string  // ISO timestamp — used for decay calculation
  docTypes:     string[] // document types this signal was observed on; empty = observed universally
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INITIAL_CONFIDENCE   = 0.55  // new unconfirmed signal starts here
const CONFIRM_BOOST        = 0.08  // each re-observation raises confidence by this
const MAX_CONFIDENCE       = 0.95
const DECAY_HALF_LIFE_DAYS = 60    // confidence halves every 60 days of inactivity
const DECAY_FLOOR          = 0.05  // signals below this are pruned
const DECAY_RUN_INTERVAL_DAYS = 7  // only run decay once per 7 days per profile
const MAX_SIGNALS_PER_CAT  = 50    // hard cap per category

const BRAIN_COLLAPSE_THRESHOLD = 10  // min box_revision attachments before triggering synthesis

export const DIFF_EXTRACTION_PROMPT = (original: string, edited: string) => `
You are analyzing the difference between an AI-generated piece of content and a human-edited version to extract the editor's STYLISTIC preferences.

First, mentally classify each edit as one of:
- STYLISTIC: word choice, tone, sentence rhythm, phrasing, removing or adding language patterns, structural reorganisation for clarity
- FACTUAL: correcting numbers, names, dates, product details, company claims, legal/compliance language, or any change that fixes incorrect information

Only report signals from STYLISTIC edits. Ignore FACTUAL corrections entirely — they reveal nothing about the editor's writing preferences, and including them produces false signals (e.g. a corrected revenue figure mis-classified as "prefers specific numbers over approximations").

AI-GENERATED ORIGINAL:
---
${original.slice(0, 4000)}
---

HUMAN-EDITED VERSION:
---
${edited.slice(0, 4000)}
---

Return ONLY a JSON object with this exact structure:
{
  "summary": "2-3 sentence plain-English description of the stylistic changes only (do not mention factual corrections)",
  "toneSignals": ["tone-related stylistic patterns only"],
  "structureSignals": ["structural stylistic preferences only"],
  "rejectPatterns": ["language patterns removed for stylistic reasons — not factual corrections"],
  "hasFactualCorrections": false,
  "confidence": 0.7
}

Rules:
- If the edits are primarily factual corrections with little stylistic signal, return confidence: 0 and empty arrays (but still set hasFactualCorrections: true).
- If the texts are too similar to extract meaningful signals, return confidence: 0 and empty arrays.
- hasFactualCorrections is always a boolean — never omit it.
`.trim()

// ── Signal helpers ────────────────────────────────────────────────────────────

function normalise(s: string) {
  return s.toLowerCase().trim()
}

function findMatch(existing: WeightedSignal[], incoming: string): WeightedSignal | undefined {
  const norm = normalise(incoming)
  return existing.find((e) => normalise(e.signal) === norm)
}

function applyDecay(signals: WeightedSignal[], now: Date): WeightedSignal[] {
  return signals
    .map((s) => {
      const daysSince = (now.getTime() - new Date(s.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince < 30) return s  // no decay for recently-seen signals
      const decayed = s.confidence * Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS)
      return { ...s, confidence: Math.round(decayed * 1000) / 1000 }
    })
    .filter((s) => s.confidence >= DECAY_FLOOR)
}

function mergeSignals(
  existing: WeightedSignal[],
  incoming: string[],
  baseConfidence: number,
  now: Date,
  docType: string | null,
): WeightedSignal[] {
  const nowIso = now.toISOString()
  const result = [...existing]

  for (const raw of incoming) {
    if (!raw?.trim()) continue
    const match = findMatch(result, raw)
    if (match) {
      // Existing signal confirmed — boost confidence and accumulate docType
      match.observedCount += 1
      match.confidence = Math.min(match.confidence + CONFIRM_BOOST, MAX_CONFIDENCE)
      match.lastSeenAt  = nowIso
      if (docType && !match.docTypes.includes(docType)) match.docTypes.push(docType)
    } else {
      // New signal — start at discounted confidence (unconfirmed)
      result.push({
        signal:        raw.trim(),
        confidence:    Math.min(baseConfidence * INITIAL_CONFIDENCE, MAX_CONFIDENCE),
        observedCount: 1,
        firstSeenAt:   nowIso,
        lastSeenAt:    nowIso,
        docTypes:      docType ? [docType] : [],
      })
    }
  }

  // Sort by confidence desc, cap at max
  return result
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SIGNALS_PER_CAT)
}

function shouldRunDecay(lastDecayAt: Date | null, now: Date): boolean {
  if (!lastDecayAt) return true
  const daysSince = (now.getTime() - lastDecayAt.getTime()) / (1000 * 60 * 60 * 24)
  return daysSince >= DECAY_RUN_INTERVAL_DAYS
}

// ── Monday GraphQL helper ─────────────────────────────────────────────────────

async function updateMondayRevised(agencyId: string, mondayItemId: string) {
  const { prisma: db } = await import('@contentnode/database')
  const integration = await db.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'monday' } },
  })
  if (!integration) return

  const { safeDecrypt } = await import('./lib/crypto.js').catch(() => ({ safeDecrypt: (v: string) => v }))
  const token = safeDecrypt(integration.accessToken) ?? integration.accessToken

  const comment = `Document revised in Box on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — content profile updated automatically`

  await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { create_update(item_id: ${mondayItemId}, body: "${comment.replace(/"/g, '\\"')}") { id } }`,
    }),
  }).catch(() => {})
}

// ── Insight generation ────────────────────────────────────────────────────────
// Called after each profile upsert once revisionCount >= 3.
// Only generates insights from signals with sufficient confidence.

const MIN_INSIGHT_CONFIDENCE = 0.5

async function generateInsightsFromProfile(
  agencyId: string,
  clientId: string,
  stakeholderId: string,
  revisionCount: number,
  toneSignals: WeightedSignal[],
  structureSignals: WeightedSignal[],
  rejectPatterns: WeightedSignal[],
): Promise<void> {
  if (revisionCount < 3) return

  const stakeholder = await prisma.stakeholder.findUnique({
    where: { id: stakeholderId },
    select: { name: true },
  })
  const name       = stakeholder?.name ?? 'This stakeholder'
  const confidence = Math.min(0.4 + revisionCount * 0.1, 0.95)

  const candidates: Array<{ type: string; title: string; body: string; key: string }> = []

  for (const s of rejectPatterns.filter((x) => x.confidence >= MIN_INSIGHT_CONFIDENCE)) {
    candidates.push({
      type:  'forbidden_term',
      title: `${name} removes: ${s.signal}`,
      body:  `Detected across ${s.observedCount} Box revision${s.observedCount !== 1 ? 's' : ''} (confidence ${Math.round(s.confidence * 100)}%). Avoid this pattern when writing for ${name}.`,
      key:   s.signal.slice(0, 40).toLowerCase(),
    })
  }
  for (const s of toneSignals.filter((x) => x.confidence >= MIN_INSIGHT_CONFIDENCE)) {
    candidates.push({
      type:  'tone',
      title: `${name} tone: ${s.signal}`,
      body:  `Observed in ${s.observedCount} Box revision${s.observedCount !== 1 ? 's' : ''} (confidence ${Math.round(s.confidence * 100)}%). Apply this tone preference when writing for ${name}.`,
      key:   s.signal.slice(0, 40).toLowerCase(),
    })
  }
  for (const s of structureSignals.filter((x) => x.confidence >= MIN_INSIGHT_CONFIDENCE)) {
    candidates.push({
      type:  'structure',
      title: `${name} structure: ${s.signal}`,
      body:  `Observed in ${s.observedCount} Box revision${s.observedCount !== 1 ? 's' : ''} (confidence ${Math.round(s.confidence * 100)}%). Apply this structure preference when writing for ${name}.`,
      key:   s.signal.slice(0, 40).toLowerCase(),
    })
  }

  for (const candidate of candidates) {
    const existing = await prisma.insight.findFirst({
      where: {
        agencyId,
        clientId,
        type:   candidate.type,
        status: { in: ['pending', 'applied'] },
        title:  { contains: candidate.key, mode: 'insensitive' },
      },
      select: { id: true },
    })

    if (existing) {
      await prisma.insight.update({
        where: { id: existing.id },
        data:  { instanceCount: revisionCount, confidence, updatedAt: new Date() },
      })
    } else {
      await prisma.insight.create({
        data: {
          agencyId,
          clientId,
          type:          candidate.type,
          title:         candidate.title,
          body:          candidate.body,
          confidence,
          status:        'pending',
          instanceCount: revisionCount,
          stakeholderIds: [stakeholderId],
          isCollective:  false,
          evidenceQuotes: [],
          suggestedNodeType: 'logic:humanizer',
          suggestedConfigChange: { signal: candidate.key, stakeholderId },
        },
      })
    }
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processBoxDiff(job: Job<BoxDiffJobData>) {
  const {
    agencyId, clientId, runId, stakeholderId,
    boxFileId, mondayItemId,
    originalText, editedText,
    attributedTo, editorEmail,
    documentType,
  } = job.data

  // 1. Extract style signals via Claude
  let diffResult: {
    summary: string
    toneSignals: string[]
    structureSignals: string[]
    rejectPatterns: string[]
    hasFactualCorrections: boolean
    confidence: number
  } = { summary: '', toneSignals: [], structureSignals: [], rejectPatterns: [], hasFactualCorrections: false, confidence: 0 }

  try {
    const raw = await callModel(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY' },
      DIFF_EXTRACTION_PROMPT(originalText, editedText),
    )
    const jsonMatch = raw.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) diffResult = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[boxDiff] Claude style extraction failed:', err)
  }

  await withAgency(agencyId, async () => {
    // 2. Update HumanizerSignal with extracted summary
    if (diffResult.summary) {
      await prisma.humanizerSignal.updateMany({
        where: { agencyId, boxFileId, diffSummary: null },
        data:  { diffSummary: diffResult.summary },
      })
    }

    // 3. Store as BrainAttachment (confidence filter: skip low-signal diffs)
    if (diffResult.confidence > 0.2) {
      const brainContent = [
        `## Style signals from Box revision${stakeholderId ? ` (stakeholder ${stakeholderId})` : ''}`,
        stakeholderId ? `Attributed to: ${attributedTo}${editorEmail ? ` <${editorEmail}>` : ''}` : '',
        '',
        diffResult.summary,
        '',
        diffResult.toneSignals.length      ? `**Tone:** ${diffResult.toneSignals.join('; ')}` : '',
        diffResult.structureSignals.length ? `**Structure:** ${diffResult.structureSignals.join('; ')}` : '',
        diffResult.rejectPatterns.length   ? `**Removes:** ${diffResult.rejectPatterns.join('; ')}` : '',
      ].filter(Boolean).join('\n')

      await prisma.clientBrainAttachment.create({
        data: {
          agencyId,
          clientId,
          source:        'box_revision',
          filename:      `box-revision-${boxFileId}.md`,
          mimeType:      'text/markdown',
          summaryStatus: 'ready',
          summary:       brainContent,
          uploadMethod:  'note',
        },
      })
    }

    // 4. Update or create StakeholderPreferenceProfile with weighted signals
    if (stakeholderId && diffResult.confidence > 0.2) {
      const now      = new Date()
      const existing = await prisma.stakeholderPreferenceProfile.findUnique({
        where: { stakeholderId },
      })

      if (existing) {
        // Lazy decay: apply only if due
        let tone      = existing.toneSignals      as unknown as WeightedSignal[]
        let structure = existing.structureSignals as unknown as WeightedSignal[]
        let reject    = existing.rejectPatterns   as unknown as WeightedSignal[]

        if (shouldRunDecay(existing.lastDecayAt, now)) {
          tone      = applyDecay(tone, now)
          structure = applyDecay(structure, now)
          reject    = applyDecay(reject, now)
        }

        const merged = {
          toneSignals:      mergeSignals(tone,      diffResult.toneSignals,      diffResult.confidence, now, documentType ?? null),
          structureSignals: mergeSignals(structure,  diffResult.structureSignals, diffResult.confidence, now, documentType ?? null),
          rejectPatterns:   mergeSignals(reject,     diffResult.rejectPatterns,   diffResult.confidence, now, documentType ?? null),
        }

        await prisma.stakeholderPreferenceProfile.update({
          where: { stakeholderId },
          data:  {
            toneSignals:      merged.toneSignals      as never,
            structureSignals: merged.structureSignals as never,
            rejectPatterns:   merged.rejectPatterns   as never,
            revisionCount:    { increment: 1 },
            lastSignalAt:     now,
            ...(shouldRunDecay(existing.lastDecayAt, now) ? { lastDecayAt: now } : {}),
          },
        })

        const newCount = (existing.revisionCount ?? 0) + 1
        await generateInsightsFromProfile(
          agencyId, clientId, stakeholderId, newCount,
          merged.toneSignals, merged.structureSignals, merged.rejectPatterns,
        )

        // Trigger principle inference every 5 revisions.
        // jobId deduplicates concurrent enqueues for the same stakeholder.
        if (newCount >= 5 && newCount % 5 === 0) {
          await principleInferenceQueue.add(
            'infer',
            { agencyId, stakeholderId },
            {
              jobId:             `principle-${stakeholderId}-r${newCount}`,
              removeOnComplete:  { count: 5 },
              removeOnFail:      { count: 10 },
            },
          )
        }
      } else {
        const nowIso = now.toISOString()
        const toWeighted = (signals: string[]): WeightedSignal[] =>
          signals.filter(Boolean).map((s) => ({
            signal:        s.trim(),
            confidence:    diffResult.confidence * INITIAL_CONFIDENCE,
            observedCount: 1,
            firstSeenAt:   nowIso,
            lastSeenAt:    nowIso,
            docTypes:      documentType ? [documentType] : [],
          }))

        await prisma.stakeholderPreferenceProfile.create({
          data: {
            stakeholderId,
            agencyId,
            toneSignals:      toWeighted(diffResult.toneSignals)      as never,
            structureSignals: toWeighted(diffResult.structureSignals) as never,
            rejectPatterns:   toWeighted(diffResult.rejectPatterns)   as never,
            revisionCount:    1,
            lastSignalAt:     now,
            lastDecayAt:      now,
          },
        })
      }
    }
  })

  // 5. Update Monday item — outside withAgency (no tenant data)
  if (mondayItemId) {
    await updateMondayRevised(agencyId, mondayItemId)
  }

  // 6. Compute embedding on the HumanizerSignal for few-shot retrieval
  if (originalText && originalText !== '[original not available]') {
    try {
      const embedding = await embedText(originalText.slice(0, 3000))
      const vec = `[${embedding.join(',')}]`
      await withAgency(agencyId, () =>
        prisma.$executeRaw`
          UPDATE "humanizer_signals"
          SET "embedding" = ${vec}::vector
          WHERE "box_file_id" = ${boxFileId}
            AND "agency_id" = ${agencyId}
            AND "embedding" IS NULL
        `
      )
    } catch (err) {
      // Non-fatal — embeddings are best-effort; few-shot retrieval falls back to recency
      console.warn('[boxDiff] embedding computation skipped:', (err as Error).message)
    }
  }

  // 7. Trigger brain collapse if box_revision attachment count crosses threshold
  try {
    const count = await withAgency(agencyId, () =>
      prisma.clientBrainAttachment.count({
        where: { agencyId, clientId, source: 'box_revision', summaryStatus: 'ready' },
      })
    )
    if (count >= BRAIN_COLLAPSE_THRESHOLD) {
      await brainCollapseQueue.add(
        `collapse-${clientId}`,
        { agencyId, clientId },
        { jobId: `brain-collapse-${clientId}`, removeOnComplete: { count: 5 } },
      )
    }
  } catch (err) {
    console.warn('[boxDiff] brain collapse trigger failed:', (err as Error).message)
  }

  console.log(`[boxDiff] processed ${boxFileId} — confidence ${diffResult.confidence}`)
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startBoxDiffWorker() {
  const worker = new Worker<BoxDiffJobData>(
    QUEUE_BOX_DIFF,
    processBoxDiff,
    { connection: getConnection(), concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[boxDiff] job ${job?.id} failed:`, err)
  })

  return worker
}
