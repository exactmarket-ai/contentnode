/**
 * POST /api/v1/webhooks/box-file
 *
 * Receives Box FILE.NEW_VERSION events for files ContentNode has delivered.
 * Verifies the Box webhook signature, looks up the tracking record by boxFileId,
 * downloads the new version, stores it, and enqueues the diff-processing job.
 *
 * Public route — no Clerk auth. Verified by Box HMAC signature instead.
 */

import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { prisma } from '@contentnode/database'
import { getBoxToken } from '../integrations/box.js'
import { getBoxDiffQueue } from '../../lib/queues.js'

const BOX_API_URL = 'https://api.box.com/2.0'

// Infer document type from ContentNode filename convention: {client}-{project}-{topic}-{title}-{date}-v{n}.ext
function inferDocType(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (/\bblog\b/.test(lower))                                    return 'blog'
  if (/\b(email|newsletter|nurture)\b/.test(lower))             return 'email'
  if (/\b(linkedin|twitter|instagram|social|tiktok)\b/.test(lower)) return 'social'
  if (/\b(ad[-_]?copy|adcopy|advertisement|ppc|banner)\b/.test(lower)) return 'ad_copy'
  if (/\b(landing[-_]?page|lp[-_])\b/.test(lower))             return 'landing_page'
  if (/\b(executive|brief|whitepaper|white[-_]?paper|report)\b/.test(lower)) return 'executive_brief'
  if (/\b(video[-_]?script|vsl|script)\b/.test(lower))         return 'video_script'
  return null
}

// Box sends two HMAC-SHA256 signatures (primary + secondary key rotation).
// We accept if either matches.
function verifyBoxSignature(
  rawBody:    string,
  deliveryTimestamp: string,
  primary:    string | undefined,
  secondary:  string | undefined,
): boolean {
  const secret1 = process.env.BOX_WEBHOOK_PRIMARY_KEY
  const secret2 = process.env.BOX_WEBHOOK_SECONDARY_KEY
  if (!secret1 && !secret2) return true // dev/staging: accept all if no keys configured

  const msg = rawBody + deliveryTimestamp

  const check = (secret: string, sig: string | undefined) => {
    if (!sig) return false
    const expected = crypto.createHmac('sha256', secret).update(msg).digest('base64')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  }

  return (!!secret1 && check(secret1, primary)) || (!!secret2 && check(secret2, secondary))
}

interface BoxWebhookPayload {
  trigger:    string       // 'FILE.NEW_VERSION'
  source?: {
    id:          string   // Box file ID
    type:        string   // 'file'
    name?:       string
    sequence_id?: string
  }
  created_by?: {
    id:    string
    type:  string
    name?: string
    login?: string        // editor's email — used for attribution
  }
  webhook?: { id: string }
}

export async function boxFileWebhookRoutes(app: FastifyInstance) {
  app.post(
    '/',
    {
      config: { rawBody: true },  // needed for signature verification
      // No preHandler — this is a public webhook endpoint
    },
    async (req, reply) => {
      // ── Signature verification ──────────────────────────────────────────────
      const rawBody          = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body)
      const deliveryTimestamp = (req.headers['box-delivery-timestamp'] as string) ?? ''
      const primary          = req.headers['box-signature-primary']   as string | undefined
      const secondary        = req.headers['box-signature-secondary']  as string | undefined

      if (!verifyBoxSignature(rawBody, deliveryTimestamp, primary, secondary)) {
        req.log.warn('Box webhook signature verification failed')
        return reply.code(401).send({ error: 'Invalid signature' })
      }

      const payload = req.body as BoxWebhookPayload

      // Only handle FILE.NEW_VERSION
      if (payload.trigger !== 'FILE.NEW_VERSION' || payload.source?.type !== 'file') {
        return reply.send({ ok: true })
      }

      const boxFileId   = payload.source.id
      const editorEmail = payload.created_by?.login ?? null

      req.log.info({ boxFileId, editorEmail }, 'Box FILE.NEW_VERSION received')

      // ── Look up tracking record ─────────────────────────────────────────────
      const tracking = await prisma.boxFileTracking.findUnique({
        where: { boxFileId },
        include: { run: { select: { agencyId: true, output: true } } },
      })

      if (!tracking) {
        // Not a file ContentNode delivered — ignore silently
        return reply.send({ ok: true })
      }

      const { agencyId, clientId, runId, stakeholderId, mondayItemId, filename } = tracking

      // ── Determine attribution ───────────────────────────────────────────────
      // Three outcomes:
      //   'stakeholder'      — editor email matches a known stakeholder in ContentNode
      //   'unknown_external' — editor email present but not in system yet (e.g. Tommy)
      //   'employee'         — no editor email from Box (agency staff upload, or Box didn't report one)
      //
      // Crucially: never inherit the original delivery stakeholder when a *different*
      // person edited the file. That would silently pollute Sarah's profile with Tommy's edits.
      let resolvedStakeholderId: string | null = null
      let attributedTo = 'employee'

      if (editorEmail) {
        const matchedStakeholder = await prisma.stakeholder.findFirst({
          where: { agencyId, email: editorEmail },
          select: { id: true },
        })
        if (matchedStakeholder) {
          resolvedStakeholderId = matchedStakeholder.id
          attributedTo = 'stakeholder'
        } else {
          // Editor is a real person (has an email) but not in the system yet.
          // Store editorEmail so it can be retroactively linked when they're added.
          attributedTo = 'unknown_external'
        }
      } else {
        // No email from Box — fall back to the delivery stakeholder (mediated upload).
        resolvedStakeholderId = stakeholderId
      }

      // ── Download new version ────────────────────────────────────────────────
      let editedText: string
      try {
        const token = await getBoxToken(agencyId)
        const fileRes = await fetch(`${BOX_API_URL}/files/${boxFileId}/content`, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'follow',
        })
        if (!fileRes.ok) throw new Error(`Box download failed: ${fileRes.status}`)

        // Extract text — mammoth for .docx, plain text for everything else
        if (filename.endsWith('.docx')) {
          const { default: mammoth } = await import('mammoth')
          const arrayBuffer = await fileRes.arrayBuffer()
          const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) })
          editedText = result.value
        } else {
          editedText = await fileRes.text()
        }
      } catch (err) {
        req.log.error({ err, boxFileId }, 'Failed to download Box file for diff')
        return reply.send({ ok: true }) // non-fatal — ack to Box so it doesn't retry
      }

      // ── Retrieve original text from run output ──────────────────────────────
      const runOutput = (tracking.run?.output ?? {}) as Record<string, unknown>
      // Try common output keys where generated text is stored
      const originalText =
        (runOutput.humanizedContent as string) ??
        (runOutput.generatedContent as string) ??
        (runOutput.outputText as string) ??
        ''

      // ── Create HumanizerSignal record ───────────────────────────────────────
      const docType = inferDocType(filename)
      await prisma.humanizerSignal.create({
        data: {
          agencyId,
          clientId,
          stakeholderId:  resolvedStakeholderId,
          runId,
          originalText:   originalText || '[original not available]',
          editedText,
          source:         attributedTo === 'stakeholder' ? 'box_direct' : 'box_mediated',
          attributedTo,
          editorEmail:    editorEmail ?? null,
          boxFileId,
          documentType:   docType,
        } as Parameters<typeof prisma.humanizerSignal.create>[0]['data'],
      })

      // ── Update BoxFileTracking ──────────────────────────────────────────────
      await prisma.boxFileTracking.update({
        where: { boxFileId },
        data:  { revisionCount: { increment: 1 }, lastVersionAt: new Date() },
      })

      // ── Enqueue diff-processing job ─────────────────────────────────────────
      try {
        await getBoxDiffQueue().add('process-diff', {
          agencyId,
          clientId,
          runId,
          stakeholderId: resolvedStakeholderId,
          boxFileId,
          mondayItemId,
          originalText: originalText || '[original not available]',
          editedText,
          attributedTo,
          editorEmail:  editorEmail ?? null,
          filename,
          documentType: docType,
        })
      } catch (err) {
        req.log.error({ err }, 'Failed to enqueue box diff job — signal saved, diff will not run')
      }

      req.log.info({ boxFileId, runId, attributedTo }, 'Box revision processed and queued for diff')
      return reply.send({ ok: true })
    },
  )
}
