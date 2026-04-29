/**
 * Google Drive push-channel renewal.
 *
 * Drive channels expire in ≤7 days. This job runs every 6 hours and renews
 * channels that will expire within the next 24 hours.
 */

import { prisma } from '@contentnode/database'
import { randomUUID } from 'node:crypto'
import { getGoogleDriveToken, registerWatchChannel, stopWatchChannel } from './googleDriveClient.js'

export async function renewExpiringChannels(): Promise<void> {
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000) // within 24 h

  const expiring = await prisma.googleDriveFileTracking.findMany({
    where: {
      driveWebhookChannelId: { not: null },
      OR: [
        { channelExpiry: { lt: cutoff } },
        { channelExpiry: null },
      ],
    },
    select: {
      id:                    true,
      agencyId:              true,
      driveFileId:           true,
      driveWebhookChannelId: true,
      driveWebhookResourceId: true,
    },
    take: 100,
  })

  if (expiring.length === 0) return

  console.log(`[gdrive-renewal] renewing ${expiring.length} expiring channels`)

  const webhookBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')

  for (const record of expiring) {
    try {
      const token     = await getGoogleDriveToken(record.agencyId)
      const newChannelId = randomUUID()
      const ch = await registerWatchChannel(token, record.driveFileId, newChannelId, webhookBase)

      await prisma.googleDriveFileTracking.update({
        where: { id: record.id },
        data: {
          driveWebhookChannelId:  newChannelId,
          driveWebhookResourceId: ch.resourceId,
          channelExpiry:          new Date(ch.expiration),
        },
      })

      // Stop old channel best-effort
      if (record.driveWebhookChannelId && record.driveWebhookResourceId) {
        await stopWatchChannel(token, record.driveWebhookChannelId, record.driveWebhookResourceId)
      }

      console.log(`[gdrive-renewal] renewed channel for file ${record.driveFileId}`)
    } catch (err) {
      console.error(`[gdrive-renewal] failed to renew channel for file ${record.driveFileId}:`, err)
    }
  }
}
