/**
 * boxDelivery — uploads a completed run's output to Box and registers a
 * FILE.NEW_VERSION webhook so edits flow back into ContentNode automatically.
 *
 * Mirrors deliverRunToBox() in apps/api/src/routes/integrations/box.ts but
 * runs inside the worker process so it has direct Prisma access.
 */

import { prisma } from '@contentnode/database'
import { encrypt, safeDecrypt } from './lib/crypto.js'
import { downloadBuffer } from '@contentnode/storage'

const BOX_TOKEN_URL  = 'https://api.box.com/oauth2/token'
const BOX_API_URL    = 'https://api.box.com/2.0'
const BOX_UPLOAD_URL = 'https://upload.box.com/api/2.0/files/content'

// ── Token management ──────────────────────────────────────────────────────────
async function getBoxToken(agencyId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'box' } },
  })
  if (!integration) throw new Error('Box not connected')

  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(integration.accessToken) ?? integration.accessToken
  }

  const storedRefresh = safeDecrypt(integration.refreshToken) ?? integration.refreshToken
  if (!storedRefresh) throw new Error('No Box refresh token — please reconnect')

  const res = await fetch(BOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.BOX_CLIENT_ID     ?? '',
      client_secret: process.env.BOX_CLIENT_SECRET ?? '',
      refresh_token: storedRefresh,
    }),
  })
  if (!res.ok) throw new Error(`Box token refresh failed: ${res.status}`)

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }

  await prisma.integration.update({
    where: { agencyId_provider: { agencyId, provider: 'box' } },
    data: {
      accessToken:  encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
    },
  })

  return data.access_token
}

// ── Main delivery function ────────────────────────────────────────────────────
export async function deliverRunToBox(params: {
  agencyId:      string
  clientId:      string
  runId:         string
  stakeholderId: string | null
  folderId:      string
  filename:      string
  content:       string
  mimeType?:     string   // defaults to text/plain
  mondayItemId:  string | null
}): Promise<void> {
  const { agencyId, clientId, runId, stakeholderId, folderId, filename, content, mimeType, mondayItemId } = params

  const token = await getBoxToken(agencyId)

  // 1. Upload file
  const buf  = Buffer.from(content, 'utf-8')
  const form = new FormData()
  form.append('attributes', JSON.stringify({ name: filename, parent: { id: folderId } }))
  form.append('file', new Blob([buf], { type: mimeType ?? 'text/plain' }), filename)

  const uploadRes = await fetch(BOX_UPLOAD_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  })
  if (!uploadRes.ok) {
    throw new Error(`Box upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }
  const uploadData = await uploadRes.json() as { entries: Array<{ id: string }> }
  const fileId = uploadData.entries[0].id

  // 2. Write metadata template (best-effort — lets the webhook route the edit back)
  await fetch(`${BOX_API_URL}/files/${fileId}/metadata/global/properties`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentNodeSource: 'true',
      agencyId,
      clientId,
      runId,
      stakeholderId: stakeholderId ?? '',
      deliveredAt:   new Date().toISOString(),
    }),
  }).catch(() => {})

  // 3. Register FILE.NEW_VERSION webhook on the file
  const webhookBase  = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  let boxWebhookId: string | null = null
  try {
    const whRes = await fetch(`${BOX_API_URL}/webhooks`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target:   { id: fileId, type: 'file' },
        triggers: ['FILE.NEW_VERSION'],
        address:  `${webhookBase}/api/v1/webhooks/box-file`,
      }),
    })
    if (whRes.ok) {
      const whData = await whRes.json() as { id: string }
      boxWebhookId = whData.id
    }
  } catch (err) {
    console.error('[boxDelivery] webhook registration failed (non-fatal):', err)
  }

  // 4. Store tracking record so the webhook receiver can route edits back
  await prisma.boxFileTracking.create({
    data: {
      agencyId,
      clientId,
      runId,
      stakeholderId: stakeholderId ?? null,
      boxFileId:    fileId,
      boxWebhookId,
      boxFolderId:  folderId,
      filename,
      mondayItemId: mondayItemId ?? null,
    },
  })

  console.log(`[boxDelivery] delivered run ${runId} → Box file ${fileId} in folder ${folderId}`)
}

// ── Image asset delivery ──────────────────────────────────────────────────────
export async function deliverImageToBox(params: {
  agencyId:      string
  clientId:      string
  runId:         string
  stakeholderId: string | null
  folderId:      string
  storageKey:    string   // R2 storage key
  filename:      string   // e.g. "NexusTek Blog Image-2025-04-24.png"
  mondayItemId:  string | null
}): Promise<void> {
  const { agencyId, clientId, runId, stakeholderId, folderId, storageKey, filename, mondayItemId } = params

  const token = await getBoxToken(agencyId)

  // Download image bytes from R2
  const imageBuffer = await downloadBuffer(storageKey)

  // Detect mime type from first bytes
  const sniff = imageBuffer.subarray(0, 4)
  let mimeType = 'image/png'
  if (sniff[0] === 0xff && sniff[1] === 0xd8) mimeType = 'image/jpeg'
  else if (sniff[0] === 0x52 && sniff[1] === 0x49) mimeType = 'image/webp'

  // Upload to Box
  const form = new FormData()
  form.append('attributes', JSON.stringify({ name: filename, parent: { id: folderId } }))
  form.append('file', new Blob([imageBuffer], { type: mimeType }), filename)

  const uploadRes = await fetch(BOX_UPLOAD_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  })
  if (!uploadRes.ok) {
    throw new Error(`Box image upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  }
  const uploadData = await uploadRes.json() as { entries: Array<{ id: string }> }
  const fileId = uploadData.entries[0].id

  // Register FILE.NEW_VERSION webhook
  const webhookBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  try {
    await fetch(`${BOX_API_URL}/webhooks`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target:   { id: fileId, type: 'file' },
        triggers: ['FILE.NEW_VERSION'],
        address:  `${webhookBase}/api/v1/webhooks/box-file`,
      }),
    })
  } catch {}

  await prisma.boxFileTracking.create({
    data: {
      agencyId,
      clientId,
      runId,
      stakeholderId: stakeholderId ?? null,
      boxFileId:     fileId,
      boxFolderId:   folderId,
      filename,
      mondayItemId:  mondayItemId ?? null,
    },
  })

  console.log(`[boxDelivery] delivered image ${storageKey} → Box file ${fileId}`)
}
