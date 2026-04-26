/**
 * boxDiffProcessor — processes Box FILE.NEW_VERSION diffs
 *
 * For each before/after edit pair:
 * 1. Runs Claude to extract style signals from the diff
 * 2. Updates HumanizerSignal with the diffSummary
 * 3. Creates a BrainAttachment on the client tagged to the stakeholder
 * 4. Updates or creates the StakeholderPreferenceProfile
 * 5. Generates Insights from the profile once enough signal accumulates
 * 6. Updates Monday item with "Revised ✓" status + comment
 */

import { prisma, withAgency } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { QUEUE_BOX_DIFF, type BoxDiffJobData, getConnection } from './queues.js'
import { Worker, type Job } from 'bullmq'

const DIFF_EXTRACTION_PROMPT = (original: string, edited: string) => `
You are analyzing the difference between an AI-generated piece of content and a human-edited version to extract the editor's style preferences.

AI-GENERATED ORIGINAL:
---
${original.slice(0, 4000)}
---

HUMAN-EDITED VERSION:
---
${edited.slice(0, 4000)}
---

Analyze the changes and extract the editor's style signals. Return ONLY a JSON object with this exact structure:
{
  "summary": "2-3 sentence plain-English description of what this person changed and why",
  "toneSignals": ["list of tone-related patterns, e.g. 'prefers direct over passive voice'"],
  "structureSignals": ["list of structural preferences, e.g. 'breaks long paragraphs into shorter ones'"],
  "rejectPatterns": ["things they consistently removed, e.g. 'removes superlatives', 'removes pricing language'"],
  "confidence": 0.7
}

If the texts are too similar to extract meaningful signals, return confidence: 0 and empty arrays.
`.trim()

// ── Monday GraphQL helper (light — no auth plugin here) ───────────────────────
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
  }).catch(() => {}) // non-fatal
}

// ── Insight generation from preference profile ────────────────────────────────
// Called after each profile upsert once revisionCount >= 3.
// Creates or updates Insight records that surface in the canvas sidebar and
// the Insights tab on ClientDetailPage.
async function generateInsightsFromProfile(
  agencyId: string,
  clientId: string,
  stakeholderId: string,
  revisionCount: number,
  toneSignals: string[],
  structureSignals: string[],
  rejectPatterns: string[],
): Promise<void> {
  if (revisionCount < 3) return
  if (!toneSignals.length && !structureSignals.length && !rejectPatterns.length) return

  const stakeholder = await prisma.stakeholder.findUnique({
    where: { id: stakeholderId },
    select: { name: true },
  })
  const name = stakeholder?.name ?? 'This stakeholder'
  const confidence = Math.min(0.4 + revisionCount * 0.1, 0.95)

  const candidates: Array<{ type: string; title: string; body: string; key: string }> = []

  for (const pattern of rejectPatterns) {
    candidates.push({
      type: 'forbidden_term',
      title: `${name} removes: ${pattern}`,
      body: `Detected across ${revisionCount} Box revisions. Avoid this pattern when writing for ${name} — they remove it every time.`,
      key: pattern.slice(0, 40).toLowerCase(),
    })
  }
  for (const signal of toneSignals) {
    candidates.push({
      type: 'tone',
      title: `${name} tone: ${signal}`,
      body: `Observed in ${revisionCount} Box revisions. Apply this tone preference when writing for ${name}.`,
      key: signal.slice(0, 40).toLowerCase(),
    })
  }
  for (const signal of structureSignals) {
    candidates.push({
      type: 'structure',
      title: `${name} structure: ${signal}`,
      body: `Observed in ${revisionCount} Box revisions. Apply this structure preference when writing for ${name}.`,
      key: signal.slice(0, 40).toLowerCase(),
    })
  }

  for (const candidate of candidates) {
    const existing = await prisma.insight.findFirst({
      where: {
        agencyId,
        clientId,
        type: candidate.type,
        status: { in: ['pending', 'applied'] },
        title: { contains: candidate.key, mode: 'insensitive' },
      },
      select: { id: true },
    })

    if (existing) {
      await prisma.insight.update({
        where: { id: existing.id },
        data: { instanceCount: revisionCount, confidence, updatedAt: new Date() },
      })
    } else {
      await prisma.insight.create({
        data: {
          agencyId,
          clientId,
          type: candidate.type,
          title: candidate.title,
          body: candidate.body,
          confidence,
          status: 'pending',
          instanceCount: revisionCount,
          stakeholderIds: [stakeholderId],
          isCollective: false,
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
  } = job.data

  // 1. Extract style signals via Claude
  let diffResult: {
    summary: string
    toneSignals: string[]
    structureSignals: string[]
    rejectPatterns: string[]
    confidence: number
  } = { summary: '', toneSignals: [], structureSignals: [], rejectPatterns: [], confidence: 0 }

  try {
    const raw = await callModel(
      {
        provider:    'anthropic',
        model:       'claude-sonnet-4-6',
        api_key_ref: 'ANTHROPIC_API_KEY',
      },
      DIFF_EXTRACTION_PROMPT(originalText, editedText),
    )
    const jsonMatch = raw.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) diffResult = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error('[boxDiff] Claude style extraction failed:', err)
    // Continue — we still store the signal, just without the summary
  }

  await withAgency(agencyId, async () => {
    // 2. Update HumanizerSignal with extracted summary
    if (diffResult.summary) {
      await prisma.humanizerSignal.updateMany({
        where: { agencyId, boxFileId, diffSummary: null },
        data:  { diffSummary: diffResult.summary },
      })
    }

    // 3. Store as BrainAttachment on the client so it informs future runs
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

    // 4. Update or create StakeholderPreferenceProfile
    if (stakeholderId && diffResult.confidence > 0.2) {
      const existing = await prisma.stakeholderPreferenceProfile.findUnique({
        where: { stakeholderId },
      })

      if (existing) {
        // Merge new signals into existing arrays (append, deduplicate)
        const merge = (arr: string[], incoming: string[]) =>
          Array.from(new Set([...arr, ...incoming])).slice(0, 50)

        const merged = {
          toneSignals:      merge(existing.toneSignals      as string[], diffResult.toneSignals),
          structureSignals: merge(existing.structureSignals as string[], diffResult.structureSignals),
          rejectPatterns:   merge(existing.rejectPatterns   as string[], diffResult.rejectPatterns),
        }
        await prisma.stakeholderPreferenceProfile.update({
          where: { stakeholderId },
          data: {
            ...merged,
            revisionCount: { increment: 1 },
            lastSignalAt:  new Date(),
          },
        })
        const newRevisionCount = (existing.revisionCount ?? 0) + 1
        await generateInsightsFromProfile(agencyId, clientId, stakeholderId, newRevisionCount, merged.toneSignals, merged.structureSignals, merged.rejectPatterns)
      } else {
        await prisma.stakeholderPreferenceProfile.create({
          data: {
            stakeholderId,
            agencyId,
            toneSignals:      diffResult.toneSignals,
            structureSignals: diffResult.structureSignals,
            rejectPatterns:   diffResult.rejectPatterns,
            revisionCount:    1,
            lastSignalAt:     new Date(),
          },
        })
      }
    }
  })

  // 5. Update Monday item — outside withAgency (no tenant data accessed)
  if (mondayItemId) {
    await updateMondayRevised(agencyId, mondayItemId)
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
