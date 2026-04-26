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

/**
 * Score a Box file for "winner" selection.
 * Returns -Infinity for the original ContentNode-delivered file so it is
 * never selected as the editorial winner.
 */
function scoreBoxFile(file: BoxFileItem, originalFileId: string | null): number {
  if (originalFileId && file.id === originalFileId) return -Infinity

  let score = 0
  const lower = file.name.toLowerCase()

  // Exact-word "final" — strongest intent signal
  if (/\bfinal\b/.test(lower)) score += 3

  // Fuzzy final synonyms
  if (/\b(fnl|approved|complete|sign[-_]?off|signed[-_]?off)\b/.test(lower)) score += 2

  // Explicit version suffix — v2, v3, etc. (higher version = slightly preferred)
  const vMatch = lower.match(/\bv(\d+)\b/)
  if (vMatch) score += 2 + Math.min(parseInt(vMatch[1], 10), 9) * 0.1

  // Penalty signals
  if (/\bdraft\b/.test(lower))                          score -= 2
  if (/\bwip\b|\bwork[-_]in[-_]progress\b/.test(lower)) score -= 1

  return score
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
    const buf = Buffer.from(await fileRes.arrayBuffer())
    const result = await mammoth.extractRawText({ buffer: buf })
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

  if (!originalText || !editedText || originalText === editedText) return fallback

  try {
    const raw = await callModel(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY' },
      DIFF_EXTRACTION_PROMPT(originalText, editedText),
    )
    const jsonMatch = raw.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback
    return JSON.parse(jsonMatch[0]) as DiffResult
  } catch {
    return fallback
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

async function processBoxVersionScan(job: Job<BoxVersionScanJobData>) {
  const { agencyId, clientId, runId, boxFolderId, mondayItemId, phase } = job.data

  await withAgency(agencyId, async () => {
    const token = await getBoxToken(agencyId)
    const scanStartedAt = new Date()

    // 1. Load WorkflowRun — need output for original text and deliveryBoxFileId
    const run = await prisma.workflowRun.findUnique({
      where:  { id: runId },
      select: { output: true, deliveryBoxFileId: true, deliveredContentHash: true },
    })
    if (!run) {
      console.warn(`[boxVersionScanner] run ${runId} not found — skipping`)
      return
    }

    const runOutput       = (run.output ?? {}) as Record<string, unknown>
    const originalText    = (
      (runOutput.humanizedContent as string) ??
      (runOutput.generatedContent as string) ??
      (runOutput.outputText       as string) ??
      ''
    )
    const originalFileId  = run.deliveryBoxFileId ?? null

    // 2. List all files in the delivery folder
    let files: BoxFileItem[]
    try {
      files = await listFolderFiles(token, boxFolderId)
    } catch (err) {
      console.error('[boxVersionScanner] failed to list Box folder:', err)
      return
    }

    if (files.length === 0) {
      console.log(`[boxVersionScanner] no files in folder ${boxFolderId} — skipping`)
      return
    }

    // 3. Score and rank files — sort by score desc, then by sequenceId desc (recency) as tiebreaker
    const scored = files
      .map(f => ({ file: f, score: scoreBoxFile(f, originalFileId) }))
      .filter(f => f.score !== -Infinity)
      .sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : parseInt(b.file.sequenceId, 10) - parseInt(a.file.sequenceId, 10),
      )

    if (scored.length === 0) {
      console.log(`[boxVersionScanner] all files scored -Infinity (only original) in folder ${boxFolderId}`)
      return
    }

    const winner   = scored[0].file
    const losers   = scored.slice(1).map(s => s.file)
    const topScore = scored[0].score

    console.log(
      `[boxVersionScanner] folder ${boxFolderId}: winner="${winner.name}" score=${topScore} ` +
      `phase=${phase} losers=${losers.length}`,
    )

    // 4. Download winner text
    let winnerText: string
    try {
      winnerText = await downloadFileText(token, winner.id, winner.name)
    } catch (err) {
      console.error('[boxVersionScanner] failed to download winner file:', err)
      return
    }

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
      where:   { boxFolderId, agencyId },
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
          runId,
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
        where:   { agencyId, runId, source: 'internal_review' },
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
              runId,
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
      where: { id: runId },
      data: {
        deliveredBoxFolderId: boxFolderId,
        deliveredContentHash: winnerHash,
      },
    })

    // 10. Archive non-winners
    if (losers.length > 0) {
      try {
        const archiveFolderId = await ensureArchiveFolder(token, boxFolderId)
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
      resourceId:   runId,
      metadata: {
        phase,
        winnerId:          winner.id,
        winnerName:        winner.name,
        winnerScore:       topScore,
        totalFiles:        files.length,
        archivedFiles:     losers.length,
        toneSignalCount:   primaryDiff.toneSignals.length,
        structureSignalCount: primaryDiff.structureSignals.length,
        hasFactualCorrections: primaryDiff.hasFactualCorrections,
        mondayItemId,
        scannedAt:         scanStartedAt.toISOString(),
      },
    })

    console.log(
      `[boxVersionScanner] run ${runId}: ${phase} scan complete — ` +
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
