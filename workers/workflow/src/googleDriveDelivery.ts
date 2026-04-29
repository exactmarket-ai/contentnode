/**
 * googleDriveDelivery — uploads completed run output to Google Drive,
 * registers a push channel for edit notifications, and writes the URL back
 * to Monday.com. Mirrors boxDelivery.ts exactly.
 */

import { prisma } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { randomUUID } from 'node:crypto'
import {
  getGoogleDriveToken,
  uploadFile,
  shareFile,
  registerWatchChannel,
  ensureGoogleDriveSubfolder,
} from './googleDriveClient.js'
import { textToDocxBuffer } from './boxDelivery.js'

export async function deliverRunToGoogleDrive(params: {
  agencyId:      string
  clientId:      string
  runId:         string
  stakeholderId: string | null
  folderId:      string
  filename:      string
  content:       string
  mimeType?:     string
  mondayItemId:  string | null
  stakeholderEmail?: string | null
}): Promise<string> {
  const {
    agencyId, clientId, runId, stakeholderId, folderId,
    filename, content, mimeType, mondayItemId, stakeholderEmail,
  } = params

  const token = await getGoogleDriveToken(agencyId)

  const isDocx = (mimeType ?? '').includes('wordprocessingml')
  const buf    = isDocx ? await textToDocxBuffer(content) : Buffer.from(content, 'utf-8')
  const effectiveMime = mimeType ?? 'text/plain'

  const { fileId, webViewLink } = await uploadFile(token, folderId, filename, buf, effectiveMime)

  // Share with stakeholder email if known
  if (stakeholderEmail) {
    await shareFile(token, fileId, stakeholderEmail)
  }

  // Register push channel for edit notifications
  const webhookBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  const channelId   = randomUUID()
  let driveWebhookChannelId: string | null  = null
  let driveWebhookResourceId: string | null = null
  let channelExpiry: Date | null            = null

  try {
    const ch = await registerWatchChannel(token, fileId, channelId, webhookBase)
    driveWebhookChannelId  = channelId
    driveWebhookResourceId = ch.resourceId
    channelExpiry          = new Date(ch.expiration)
  } catch (err) {
    console.error('[googleDriveDelivery] push channel registration failed (non-fatal):', err)
  }

  await prisma.googleDriveFileTracking.create({
    data: {
      agencyId,
      clientId,
      runId,
      stakeholderId:         stakeholderId ?? null,
      driveFileId:           fileId,
      driveWebhookChannelId,
      driveWebhookResourceId,
      channelExpiry,
      driveFolderId:         folderId,
      filename,
      mondayItemId:          mondayItemId ?? null,
    },
  })

  console.log(`[googleDriveDelivery] delivered run ${runId} → Drive file ${fileId}`)
  return webViewLink
}

export async function deliverImageToGoogleDrive(params: {
  agencyId:      string
  clientId:      string
  runId:         string
  stakeholderId: string | null
  folderId:      string
  storageKey:    string
  filename:      string
  mondayItemId:  string | null
  stakeholderEmail?: string | null
}): Promise<string> {
  const {
    agencyId, clientId, runId, stakeholderId, folderId,
    storageKey, filename, mondayItemId, stakeholderEmail,
  } = params

  const token       = await getGoogleDriveToken(agencyId)
  const imageBuffer = await downloadBuffer(storageKey)

  const sniff = imageBuffer.subarray(0, 4)
  let mimeType = 'image/png'
  if (sniff[0] === 0xff && sniff[1] === 0xd8) mimeType = 'image/jpeg'
  else if (sniff[0] === 0x52 && sniff[1] === 0x49) mimeType = 'image/webp'

  const { fileId, webViewLink } = await uploadFile(token, folderId, filename, imageBuffer, mimeType)

  if (stakeholderEmail) await shareFile(token, fileId, stakeholderEmail)

  const webhookBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  const channelId   = randomUUID()
  let driveWebhookChannelId: string | null  = null
  let driveWebhookResourceId: string | null = null
  let channelExpiry: Date | null            = null

  try {
    const ch = await registerWatchChannel(token, fileId, channelId, webhookBase)
    driveWebhookChannelId  = channelId
    driveWebhookResourceId = ch.resourceId
    channelExpiry          = new Date(ch.expiration)
  } catch (err) {
    console.error('[googleDriveDelivery] image push channel registration failed (non-fatal):', err)
  }

  await prisma.googleDriveFileTracking.create({
    data: {
      agencyId,
      clientId,
      runId,
      stakeholderId:         stakeholderId ?? null,
      driveFileId:           fileId,
      driveWebhookChannelId,
      driveWebhookResourceId,
      channelExpiry,
      driveFolderId:         folderId,
      filename,
      mondayItemId:          mondayItemId ?? null,
    },
  })

  console.log(`[googleDriveDelivery] delivered image ${storageKey} → Drive file ${fileId}`)
  return webViewLink
}

export { ensureGoogleDriveSubfolder }
