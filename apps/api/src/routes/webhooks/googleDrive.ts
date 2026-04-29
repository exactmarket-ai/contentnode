/**
 * POST /api/v1/webhooks/google-drive
 *
 * Receives Google Drive push-channel notifications for files ContentNode delivered.
 * Verifies the X-Goog-Channel-Token header, looks up the tracking record by channel ID,
 * downloads the latest file version, and enqueues a diff-processing job.
 *
 * Public route — no Clerk auth. Verified by static webhook token instead.
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { getGoogleDriveToken } from '../integrations/googleDrive.js'
import { getBoxDiffQueue } from '../../lib/queues.js'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'

function inferDocType(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (/\bblog\b/.test(lower))                                       return 'blog'
  if (/\b(email|newsletter|nurture)\b/.test(lower))                return 'email'
  if (/\b(linkedin|twitter|instagram|social|tiktok)\b/.test(lower)) return 'social'
  if (/\b(ad[-_]?copy|adcopy|advertisement|ppc|banner)\b/.test(lower)) return 'ad_copy'
  if (/\b(landing[-_]?page|lp[-_])\b/.test(lower))                return 'landing_page'
  if (/\b(executive|brief|whitepaper|white[-_]?paper|report)\b/.test(lower)) return 'executive_brief'
  if (/\b(video[-_]?script|vsl|script)\b/.test(lower))            return 'video_script'
  return null
}

export async function googleDriveWebhookRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    // ── Verify channel token ──────────────────────────────────────────────────
    const channelToken = req.headers['x-goog-channel-token'] as string | undefined
    const expectedToken = process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN
    if (expectedToken && channelToken !== expectedToken) {
      req.log.warn('Google Drive webhook: invalid channel token')
      return reply.code(401).send({ error: 'Invalid token' })
    }

    const resourceState = req.headers['x-goog-resource-state'] as string | undefined
    // 'sync' is the verification ping on channel registration — acknowledge and return
    if (resourceState === 'sync') {
      return reply.send({ ok: true })
    }

    // Only process 'change' events
    if (resourceState !== 'change') {
      return reply.send({ ok: true })
    }

    const channelId = req.headers['x-goog-channel-id'] as string | undefined
    if (!channelId) {
      return reply.send({ ok: true })
    }

    req.log.info({ channelId, resourceState }, 'Google Drive push notification received')

    // ── Look up tracking record by channel ID ─────────────────────────────────
    const tracking = await prisma.googleDriveFileTracking.findFirst({
      where:   { driveWebhookChannelId: channelId },
      include: { run: { select: { agencyId: true, output: true } } },
    })

    if (!tracking) {
      return reply.send({ ok: true })
    }

    const { agencyId, clientId, runId, stakeholderId, mondayItemId, filename, driveFileId } = tracking

    // ── Download latest file content ──────────────────────────────────────────
    let editedText: string
    try {
      const token   = await getGoogleDriveToken(agencyId)
      const fileRes = await fetch(`${DRIVE_API}/files/${driveFileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      })
      if (!fileRes.ok) throw new Error(`Drive download failed: ${fileRes.status}`)

      if (filename.endsWith('.docx')) {
        const { default: mammoth } = await import('mammoth')
        const arrayBuffer = await fileRes.arrayBuffer()
        const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) })
        editedText = result.value
      } else {
        editedText = await fileRes.text()
      }
    } catch (err) {
      req.log.error({ err, driveFileId }, 'Failed to download Drive file for diff')
      return reply.send({ ok: true })
    }

    // ── Get original text from run output ─────────────────────────────────────
    const runOutput = (tracking.run?.output ?? {}) as Record<string, unknown>
    const originalText =
      (runOutput.humanizedContent as string) ??
      (runOutput.generatedContent as string) ??
      (runOutput.outputText as string) ??
      ''

    // ── Create HumanizerSignal ────────────────────────────────────────────────
    const docType = inferDocType(filename)
    await prisma.humanizerSignal.create({
      data: {
        agencyId,
        clientId,
        stakeholderId,
        runId,
        originalText:   originalText || '[original not available]',
        editedText,
        source:         'gdrive_direct',
        attributedTo:   stakeholderId ? 'stakeholder' : 'employee',
        editorEmail:    null,
        boxFileId:      null,
        documentType:   docType,
      } as Parameters<typeof prisma.humanizerSignal.create>[0]['data'],
    })

    // ── Update tracking record ────────────────────────────────────────────────
    await prisma.googleDriveFileTracking.update({
      where: { driveFileId },
      data:  { revisionCount: { increment: 1 }, lastVersionAt: new Date() },
    })

    // ── Enqueue diff job (reuses box diff processor — storage-agnostic) ───────
    try {
      await getBoxDiffQueue().add('process-diff', {
        agencyId,
        clientId,
        runId,
        stakeholderId,
        boxFileId:    null,
        driveFileId,
        mondayItemId,
        originalText: originalText || '[original not available]',
        editedText,
        attributedTo:  stakeholderId ? 'stakeholder' : 'employee',
        editorEmail:   null,
        filename,
        documentType: docType,
      })
    } catch (err) {
      req.log.error({ err }, 'Failed to enqueue drive diff job — signal saved, diff will not run')
    }

    req.log.info({ driveFileId, runId }, 'Drive revision processed and queued for diff')
    return reply.send({ ok: true })
  })
}
