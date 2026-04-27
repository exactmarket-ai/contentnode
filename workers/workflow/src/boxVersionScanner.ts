/**
 * boxVersionScanner — processes Box version scans triggered by Monday status changes
 * or the 2-hour passive safety-net sweep.
 *
 * For each scan job it:
 *   1. Lists files in the Box delivery folder
 *   2. Scores each file to identify the editorial winner
 *   3. Downloads the winner and diffs it against the original delivered text
 *   4. For client_final phase: also diffs winner vs internal_review baseline
 *   5. Creates HumanizerSignal records and updates stakeholder preference profiles
 *   6. Archives non-winner files to an _archive subfolder
 *   7. Updates WorkflowRun.deliveredBoxFolderId / deliveredContentHash
 *   8. Emits SOC 2 audit log entries
 *
 * Queue: QUEUE_BOX_VERSION_SCAN
 */

import crypto from 'node:crypto'
import { prisma, withAgency, auditService } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { Worker, type Job } from 'bullmq'
import { QUEUE_BOX_VERSION_SCAN, type BoxVersionScanJobData, getConnection } from './queues.js'
import { getBoxToken } from './boxDelivery.js'
import { DIFF_EXTRACTION_PROMPT } from './boxDiffProcessor.js'

const BOX_API_URL = 'https://api.box.com/2.0'

// ── Box file scoring ──────────────────────────────────────────────────────────

interface BoxFileItem {
  id:           string
  name:         string
  modifiedAt:   Date
  sequenceId:   string  // Box file version counter — higher = newer
}

// Levenshtein distance — used for fuzzy "final" detection
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// Returns true if any word in the filename is within edit distance 2 of "final"
// but is not an exact match (that's handled separately for the +3 tier)
function fuzzyFinal(lower: string): boolean {
  const words = lower.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  return words.some(w => w !== 'final' && levenshtein(w, 'final') <= 2)
}

// Extract the highest explicit version number from a filename.
// Handles: v1 v2 v3, _1 _2 _3, -1 -2 -3, date patterns (0425, 04-25, 04_25)
function extractVersionScore(lower: string): number {
  // Named version: v3 → version number 3
  const namedMatch = lower.match(/[v_-](\d{1,2})\b/)
  if (namedMatch) return parseInt(namedMatch[1], 10)

  // Date-style version: 0425, 04-25, 04_25 (MMDD) — treat as ordinal via month*31+day
  const dateMatch = lower.match(/\b(\d{2})[-_]?(\d{2})\b/)
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10)
    const day   = parseInt(dateMatch[2], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return month * 31 + day  // ordinal for tiebreaking; capped below
    }
  }
  return 0
}

interface ScoreBreakdown {
  total:         number
  exactFinal:    boolean
  fuzzyFinal:    boolean
  versionPoints: number
  versionNumber: number
  draftPenalty:  boolean
  isOriginal:    boolean
}

/**
 * Score a Box file for "winner" selection.
 * Returns score = -Infinity for the original ContentNode-delivered file.
 * Returns a breakdown object for audit logging.
 */
function scoreBoxFile(
  file: BoxFileItem,
  originalFileId: string | null,
): { score: number; breakdown: ScoreBreakdown } {
  if (originalFileId && file.id === originalFileId) {
    return { score: -Infinity, breakdown: { total: -Infinity, exactFinal: false, fuzzyFinal: false, versionPoints: 0, versionNumber: 0, draftPenalty: false, isOriginal: true } }
  }

  const lower = file.name.toLowerCase()
  let score = 0

  const exactFinalMatch  = /\bfinal\b/.test(lower)
  const fuzzyFinalMatch  = !exactFinalMatch && fuzzyFinal(lower)
  const versionNum       = extractVersionScore(lower)
  // Cap version contribution at +4 to keep scoring sensible; each version level adds 0.5
  const versionPoints    = versionNum > 0 ? Math.min(2 + versionNum * 0.5, 4) : 0
  const draftPenalty     = /\bdraft\b/.test(lower)

  if (exactFinalMatch) score += 3
  if (fuzzyFinalMatch) score += 2
  if (versionNum > 0)  score += versionPoints
  if (draftPenalty)    score -= 2

  const breakdown: ScoreBreakdown = { total: score, exactFinal: exactFinalMatch, fuzzyFinal: fuzzyFinalMatch, versionPoints, versionNumber: versionNum, draftPenalty, isOriginal: false }
  return { score, breakdown }
}

// ── Box API helpers ───────────────────────────────────────────────────────────

async function listFolderFiles(token: string, folderId: string): Promise<BoxFileItem[]> {
  const res = await fetch(
    `${BOX_API_URL}/folders/${folderId}/items?fields=id,name,modified_at,sequence_id&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Box folder list failed: ${res.status} ${await res.text()}`)

  const body = await res.json() as { entries: Array<{ type: string; id: string; name: string; modified_at: string; sequence_id: string }> }
  return body.entries
    .filter(e => e.type === 'file')
    .map(e => ({
      id:         e.id,
      name:       e.name,
      modifiedAt: new Date(e.modified_at),
      sequenceId: e.sequence_id ?? '0',
    }))
}

async function downloadFileText(token: string, fileId: string, filename: string): Promise<string> {
  const fileRes = await fetch(`${BOX_API_URL}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  })
  if (!fileRes.ok) throw new Error(`Box download failed: ${fileRes.status}`)

  if (filename.toLowerCase().endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth')
    const fileBuffer = Buffer.from(new Uint8Array(await fileRes.arrayBuffer()))
    const result = await mammoth.extractRawText({ buffer: fileBuffer })
    return result.value
  }

  return fileRes.text()
}

async function ensureArchiveFolder(token: string, parentFolderId: string): Promise<string> {
  // Look for an existing _archive subfolder first
  const res = await fetch(
    `${BOX_API_URL}/folders/${parentFolderId}/items?fields=id,name,type&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (res.ok) {
    const body = await res.json() as { entries: Array<{ type: string; id: string; name: string }> }
    const existing = body.entries.find(e => e.type === 'folder' && e.name === '_archive')
    if (existing) return existing.id
  }

  const create = await fetch(`${BOX_API_URL}/folders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '_archive', parent: { id: parentFolderId } }),
  })
  if (!create.ok) throw new Error(`Failed to create _archive folder: ${create.status}`)
  const created = await create.json() as { id: string }
  return created.id
}

async function moveFileToFolder(token: string, fileId: string, targetFolderId: string): Promise<void> {
  const res = await fetch(`${BOX_API_URL}/files/${fileId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { id: targetFolderId } }),
  })
  if (!res.ok) {
    console.warn(`[boxVersionScanner] failed to move file ${fileId} to archive: ${res.status}`)
  }
}

// ── Signal extraction (reuses boxDiffProcessor's Claude prompt) ───────────────

interface DiffResult {
  summary:              string
  toneSignals:          string[]
  structureSignals:     string[]
  rejectPatterns:       string[]
  hasFactualCorrections: boolean
  confidence:           number
}

async function extractDiffSignals(originalText: string, editedText: string): Promise<DiffResult> {
  const fallback: DiffResult = {
    summary: '', toneSignals: [], structureSignals: [],
    rejectPatterns: [], hasFactualCorrections: false, confidence: 0,
  }

  if (!originalText || !editedText || originalText === editedText) {
    console.log(`[boxVersionScanner] extractDiffSignals short-circuit: originalEmpty=${!originalText} editedEmpty=${!editedText} identical=${originalText === editedText}`)
    return fallback
  }

  const prompt = DIFF_EXTRACTION_PROMPT(originalText, editedText)
  console.log(`[boxVersionScanner] diff prompt length=${prompt.length}, original=${originalText.length}chars, edited=${editedText.length}chars`)

  try {
    const raw = await callModel(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY' },
      prompt,
    )
    console.log(`[boxVersionScanner] Claude raw response: ${raw.text.slice(0, 500).replace(/\n/g, ' ')}`)
    const jsonMatch = raw.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.log(`[boxVersionScanner] no JSON found in Claude response`)
      return fallback
    }
    const parsed = JSON.parse(jsonMatch[0]) as DiffResult
    console.log(`[boxVersionScanner] parsed diff: summary="${parsed.summary?.slice(0, 100)}" toneSignals=${parsed.toneSignals.length} structureSignals=${parsed.structureSignals.length} confidence=${parsed.confidence}`)
    return parsed
  } catch (err) {
    console.error(`[boxVersionScanner] extractDiffSignals error:`, err)
    return fallback
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processBoxVersionScan(job: Job<BoxVersionScanJobData>) {
  const { agencyId, clientId, runId, boxFolderId, mondayItemId, phase } = job.data

  await withAgency(agencyId, async () => {
    const scanStartedAt = new Date()

    // 1. Find most recent BoxFileTracking for this client — this is the authoritative
    //    source for both the delivery folder and the run whose text we diff against.
    //    The runId in the job data may point to an older run if the webhook fired late.
    const latestTracking = await prisma.boxFileTracking.findFirst({
      where:   { agencyId, clientId },
      orderBy: { createdAt: 'desc' },
      select:  { boxFolderId: true, runId: true },
    })
    const effectiveRunId    = latestTracking?.runId    ?? runId
    const effectiveFolderId = latestTracking?.boxFolderId ?? boxFolderId

    console.log(`[boxVersionScanner] job runId=${runId} boxFolderId=${boxFolderId} → effective runId=${effectiveRunId} folderId=${effectiveFolderId}`)

    // 2. Load WorkflowRun for original text
    const run = await prisma.workflowRun.findUnique({
      where:  { id: effectiveRunId },
      select: { output: true, deliveryBoxFileId: true, deliveredContentHash: true },
    })
    if (!run) {
      console.warn(`[boxVersionScanner] run ${effectiveRunId} not found — skipping`)
      return
    }

    const runOutput = (run.output ?? {}) as Record<string, unknown>

    // Walk output structure: finalOutput.content → nodeStatuses[*].output.{content,outputText,...} → legacy keys
    const finalOut = runOutput.finalOutput as Record<string, unknown> | undefined
    const nodeStatuses = (runOutput.nodeStatuses ?? {}) as Record<string, { output?: Record<string, unknown> }>
    const originalText: string = (
      (typeof finalOut?.content === 'string' && finalOut.content ? finalOut.content : null) ??
      Object.values(nodeStatuses)
        .map(ns => ns?.output?.content ?? ns?.output?.outputText ?? ns?.output?.humanizedContent ?? ns?.output?.text)
        .find((t): t is string => typeof t === 'string' && t.length > 0) ??
      (runOutput.humanizedContent as string | undefined) ??
      (runOutput.generatedContent as string | undefined) ??
      (runOutput.outputText       as string | undefined) ??
      ''
    )
    const originalFileId  = run.deliveryBoxFileId ?? null

    console.log(`[boxVersionScanner] originalText: ${originalText.length} chars, keys=${Object.keys(runOutput).join(',')}, snippet="${originalText.slice(0, 120).replace(/\n/g, ' ')}"`)


    // 2. Get a fresh Box token immediately before the first API call — refresh happens
    //    here if the token is expired, not reactively after a failed listing attempt.
    const token = await getBoxToken(agencyId)

    // 3. List all files in the delivery folder
    let files: BoxFileItem[]
    try {
      files = await listFolderFiles(token, effectiveFolderId)
    } catch (err) {
      console.error('[boxVersionScanner] failed to list Box folder:', err)
      return
    }

    if (files.length === 0) {
      console.log(`[boxVersionScanner] no files in folder ${effectiveFolderId} — skipping`)
      return
    }

    // 3. Score and rank files — sort by score desc, then by modifiedAt desc (recency) as tiebreaker
    const scored = files
      .map(f => { const { score, breakdown } = scoreBoxFile(f, originalFileId); return { file: f, score, breakdown } })
      .filter(f => f.score !== -Infinity)
      .sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : b.file.modifiedAt.getTime() - a.file.modifiedAt.getTime(),
      )

    if (scored.length === 0) {
      console.log(`[boxVersionScanner] all files scored -Infinity (only original) in folder ${effectiveFolderId}`)
      return
    }

    const winner    = scored[0].file
    const winnerBD  = scored[0].breakdown
    const losers    = scored.slice(1).map(s => s.file)
    const topScore  = scored[0].score

    console.log(
      `[boxVersionScanner] folder ${effectiveFolderId}: winner="${winner.name}" score=${topScore} ` +
      `breakdown=${JSON.stringify(winnerBD)} phase=${phase} losers=${losers.length}`,
    )

    // 4. Download winner text
    let winnerText: string
    try {
      winnerText = await downloadFileText(token, winner.id, winner.name)
    } catch (err) {
      console.error('[boxVersionScanner] failed to download winner file:', err)
      return
    }

    console.log(`[boxVersionScanner] winnerText: ${winnerText.length} chars, snippet="${winnerText.slice(0, 120).replace(/\n/g, ' ')}"`)

    // 5. Diff winner vs original delivered content (always — both phases)
    const primaryDiff = await extractDiffSignals(originalText, winnerText)
    const winnerHash  = crypto.createHash('sha256').update(winnerText).digest('hex')

    // Skip if content hash unchanged since last scan (no new edits)
    if (run.deliveredContentHash && run.deliveredContentHash === winnerHash) {
      console.log(`[boxVersionScanner] winner text unchanged since last scan — no new signals`)
      return
    }

    // 6. Resolve stakeholder from BoxFileTracking
    const tracking = await prisma.boxFileTracking.findFirst({
      where:   { boxFolderId: effectiveFolderId, agencyId },
      orderBy: { createdAt: 'desc' },
      select:  { stakeholderId: true, filename: true },
    })
    const stakeholderId = tracking?.stakeholderId ?? null
    const filename      = tracking?.filename ?? winner.name

    // 7. Create HumanizerSignal for primary diff (vs original)
    const primarySource = phase === 'client_final' ? 'client_final' : 'internal_review'

    if (primaryDiff.summary || primaryDiff.toneSignals.length > 0) {
      await prisma.humanizerSignal.create({
        data: {
          agencyId,
          clientId,
          stakeholderId,
          runId:         effectiveRunId,
          originalText:  originalText || '[original not available]',
          editedText:    winnerText,
          diffSummary:   primaryDiff.summary || null,
          source:        primarySource,
          attributedTo:  stakeholderId ? 'stakeholder' : 'unknown_external',
          editorEmail:   null,
          boxFileId:     winner.id,
          documentType:  inferDocType(filename),
        } as Parameters<typeof prisma.humanizerSignal.create>[0]['data'],
      })
    }

    // 8. For client_final: also diff winner vs internal_review baseline
    if (phase === 'client_final') {
      const internalReviewSignal = await prisma.humanizerSignal.findFirst({
        where:   { agencyId, runId: effectiveRunId, source: 'internal_review' },
        orderBy: { createdAt: 'desc' },
        select:  { editedText: true },
      })

      if (internalReviewSignal?.editedText) {
        const clientDelta = await extractDiffSignals(internalReviewSignal.editedText, winnerText)

        if (clientDelta.summary || clientDelta.toneSignals.length > 0) {
          await prisma.humanizerSignal.create({
            data: {
              agencyId,
              clientId,
              stakeholderId,
              runId:         effectiveRunId,
              originalText:  internalReviewSignal.editedText,
              editedText:    winnerText,
              diffSummary:   clientDelta.summary || null,
              source:        'client_delta',       // client's changes on top of internal review
              attributedTo:  stakeholderId ? 'stakeholder' : 'unknown_external',
              editorEmail:   null,
              boxFileId:     winner.id,
              documentType:  inferDocType(filename),
            } as Parameters<typeof prisma.humanizerSignal.create>[0]['data'],
          })
        }
      }
    }

    // 9. Update WorkflowRun with folder + content hash (Part 1 fields in use)
    await prisma.workflowRun.update({
      where: { id: effectiveRunId },
      data: {
        deliveredBoxFolderId: effectiveFolderId,
        deliveredContentHash: winnerHash,
      },
    })

    // 10. Archive non-winners
    if (losers.length > 0) {
      try {
        const archiveFolderId = await ensureArchiveFolder(token, effectiveFolderId)
        await Promise.all(losers.map(f => moveFileToFolder(token, f.id, archiveFolderId)))
        console.log(`[boxVersionScanner] archived ${losers.length} non-winner file(s)`)
      } catch (err) {
        console.warn('[boxVersionScanner] archive step failed (non-fatal):', err)
      }
    }

    // 11. SOC 2 audit log
    await auditService.log(agencyId, {
      actorType:    'system',
      action:       'box_version_scan_completed',
      resourceType: 'workflow_run',
      resourceId:   effectiveRunId,
      metadata: {
        phase,
        winnerId:             winner.id,
        winnerName:           winner.name,
        winnerScore:          topScore,
        winnerScoreBreakdown: winnerBD,
        totalFiles:           files.length,
        archivedFiles:        losers.length,
        toneSignalCount:      primaryDiff.toneSignals.length,
        structureSignalCount: primaryDiff.structureSignals.length,
        hasFactualCorrections: primaryDiff.hasFactualCorrections,
        mondayItemId,
        scannedAt:            scanStartedAt.toISOString(),
      },
    })

    console.log(
      `[boxVersionScanner] run ${effectiveRunId}: ${phase} scan complete — ` +
      `${primaryDiff.toneSignals.length + primaryDiff.structureSignals.length} signals extracted`,
    )
  })
}

// ── Document type inference (mirrors boxFile.ts) ──────────────────────────────

function inferDocType(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (/\bblog\b/.test(lower))                                         return 'blog'
  if (/\b(email|newsletter|nurture)\b/.test(lower))                   return 'email'
  if (/\b(linkedin|twitter|instagram|social|tiktok)\b/.test(lower))  return 'social'
  if (/\b(ad[-_]?copy|adcopy|advertisement|ppc|banner)\b/.test(lower)) return 'ad_copy'
  if (/\b(landing[-_]?page|lp[-_])\b/.test(lower))                   return 'landing_page'
  if (/\b(executive|brief|whitepaper|white[-_]?paper|report)\b/.test(lower)) return 'executive_brief'
  if (/\b(video[-_]?script|vsl|script)\b/.test(lower))               return 'video_script'
  return null
}

// ── Worker registration ───────────────────────────────────────────────────────

export function startBoxVersionScanWorker() {
  const worker = new Worker<BoxVersionScanJobData>(
    QUEUE_BOX_VERSION_SCAN,
    processBoxVersionScan,
    { connection: getConnection(), concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[boxVersionScanner] job ${job?.id} failed:`, err)
  })

  return worker
}
