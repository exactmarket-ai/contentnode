/**
 * boxDelivery — uploads a completed run's output to Box and registers a
 * FILE.NEW_VERSION webhook so edits flow back into ContentNode automatically.
 *
 * Mirrors deliverRunToBox() in apps/api/src/routes/integrations/box.ts but
 * runs inside the worker process so it has direct Prisma access.
 */

import { Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType, convertInchesToTwip } from 'docx'
import { prisma } from '@contentnode/database'
import { encrypt, safeDecrypt } from './lib/crypto.js'
import { downloadBuffer } from '@contentnode/storage'

// ── DOCX generation ───────────────────────────────────────────────────────────
function parseInlineMarkdown(text: string): TextRun[] {
  // Split on **bold** markers — handles the most common AI output pattern
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ text: part.slice(2, -2), bold: true })
    }
    return new TextRun({ text: part })
  })
}

export async function textToDocxBuffer(text: string): Promise<Buffer> {
  const lines = text.split('\n')
  const children: Paragraph[] = []

  for (const line of lines) {
    if (line.startsWith('### ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(line.slice(4))] }))
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(line.slice(3))] }))
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(line.slice(2))] }))
    } else if (/^[-*] /.test(line)) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: parseInlineMarkdown(line.slice(2)),
      }))
    } else if (/^\d+\. /.test(line)) {
      children.push(new Paragraph({
        numbering: { reference: 'default-numbering', level: 0 },
        children: parseInlineMarkdown(line.replace(/^\d+\. /, '')),
      }))
    } else {
      children.push(new Paragraph({ children: parseInlineMarkdown(line) }))
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
        }],
      }],
    },
    sections: [{ children }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

const BOX_TOKEN_URL  = 'https://api.box.com/oauth2/token'
const BOX_API_URL    = 'https://api.box.com/2.0'
const BOX_UPLOAD_URL = 'https://upload.box.com/api/2.0/files/content'

// ── Token management ──────────────────────────────────────────────────────────
async function refreshBoxToken(agencyId: string, refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const res = await fetch(BOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.BOX_CLIENT_ID     ?? '',
      client_secret: process.env.BOX_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[boxDelivery] token refresh failed: HTTP ${res.status} — ${body}`)
    return null
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

async function storeBoxTokens(agencyId: string, data: { access_token: string; refresh_token: string; expires_in: number }) {
  await prisma.integration.update({
    where: { agencyId_provider: { agencyId, provider: 'box' } },
    data: {
      accessToken:  encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
    },
  })
}

async function getBoxToken(agencyId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'box' } },
  })
  if (!integration) throw new Error('Box not connected')

  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(integration.accessToken) ?? integration.accessToken
  }
  console.log(`[boxDelivery] access token expired or missing expiresAt (${integration.expiresAt?.toISOString() ?? 'null'}) — refreshing`)

  const storedRefresh = safeDecrypt(integration.refreshToken) ?? integration.refreshToken
  if (!storedRefresh) throw new Error('No Box refresh token — please reconnect Box in Settings')

  let data = await refreshBoxToken(agencyId, storedRefresh)

  if (!data) {
    // 400 from Box often means a concurrent worker already rotated this refresh token.
    // Re-read the DB and try the newer token that the other worker stored.
    const fresh = await prisma.integration.findUnique({
      where: { agencyId_provider: { agencyId, provider: 'box' } },
    })
    const freshRefresh = fresh ? (safeDecrypt(fresh.refreshToken) ?? fresh.refreshToken) : null
    if (freshRefresh && freshRefresh !== storedRefresh) {
      // Another process already refreshed — if their access token is still valid, use it
      if (fresh!.expiresAt && fresh!.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
        return safeDecrypt(fresh!.accessToken) ?? fresh!.accessToken
      }
      data = await refreshBoxToken(agencyId, freshRefresh)
    }
  }

  if (!data) {
    throw new Error('Box token refresh failed — please reconnect Box in Settings')
  }

  await storeBoxTokens(agencyId, data)
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
}): Promise<string> { // returns Box file URL
  const { agencyId, clientId, runId, stakeholderId, folderId, filename, content, mimeType, mondayItemId } = params

  const token = await getBoxToken(agencyId)

  // 1. Upload file — retry with incremented version suffix on 409 name conflict
  const isDocx = (mimeType ?? '').includes('wordprocessingml')
  const buf    = isDocx ? await textToDocxBuffer(content) : Buffer.from(content, 'utf-8')

  const bumpVersion = (name: string) =>
    name.replace(/-v(\d+)(\.[^.]+)$/, (_, n, ext) => `-v${parseInt(n) + 1}${ext}`)

  let uploadFilename = filename
  let fileId: string | undefined
  for (let attempt = 0; attempt < 10; attempt++) {
    const form = new FormData()
    form.append('attributes', JSON.stringify({ name: uploadFilename, parent: { id: folderId } }))
    form.append('file', new Blob([buf], { type: mimeType ?? 'text/plain' }), uploadFilename)
    const uploadRes = await fetch(BOX_UPLOAD_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    })
    if (uploadRes.status === 409) {
      const errBody = await uploadRes.json().catch(() => ({}) as Record<string, unknown>) as Record<string, unknown>
      if (errBody?.code === 'item_name_in_use') {
        uploadFilename = bumpVersion(uploadFilename)
        continue
      }
      throw new Error(`Box upload failed: 409 ${JSON.stringify(errBody)}`)
    }
    if (!uploadRes.ok) {
      throw new Error(`Box upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
    }
    const uploadData = await uploadRes.json() as { entries: Array<{ id: string }> }
    fileId = uploadData.entries[0].id
    break
  }
  if (!fileId) throw new Error('Box upload failed: could not resolve a unique filename after 10 attempts')

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
  return `https://app.box.com/file/${fileId}`
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
}): Promise<string> { // returns Box file URL
  const { agencyId, clientId, runId, stakeholderId, folderId, storageKey, filename, mondayItemId } = params

  const token = await getBoxToken(agencyId)

  // Download image bytes from R2
  const imageBuffer = await downloadBuffer(storageKey)

  // Detect mime type from first bytes
  const sniff = imageBuffer.subarray(0, 4)
  let mimeType = 'image/png'
  if (sniff[0] === 0xff && sniff[1] === 0xd8) mimeType = 'image/jpeg'
  else if (sniff[0] === 0x52 && sniff[1] === 0x49) mimeType = 'image/webp'

  // Upload to Box — retry with incremented version suffix on 409 name conflict
  const bumpVersion = (name: string) =>
    name.replace(/-v(\d+)(\.[^.]+)$/, (_, n, ext) => `-v${parseInt(n) + 1}${ext}`)

  let uploadFilename = filename
  let fileId: string | undefined
  for (let attempt = 0; attempt < 10; attempt++) {
    const form = new FormData()
    form.append('attributes', JSON.stringify({ name: uploadFilename, parent: { id: folderId } }))
    form.append('file', new Blob([imageBuffer], { type: mimeType }), uploadFilename)
    const uploadRes = await fetch(BOX_UPLOAD_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    })
    if (uploadRes.status === 409) {
      const errBody = await uploadRes.json().catch(() => ({}) as Record<string, unknown>) as Record<string, unknown>
      if (errBody?.code === 'item_name_in_use') { uploadFilename = bumpVersion(uploadFilename); continue }
      throw new Error(`Box image upload failed: 409 ${JSON.stringify(errBody)}`)
    }
    if (!uploadRes.ok) throw new Error(`Box image upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
    const uploadData = await uploadRes.json() as { entries: Array<{ id: string }> }
    fileId = uploadData.entries[0].id
    break
  }
  if (!fileId) throw new Error('Box image upload failed: could not resolve a unique filename after 10 attempts')

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
  return `https://app.box.com/file/${fileId}`
}

// ── Subfolder helper ──────────────────────────────────────────────────────────

/**
 * Returns the Box folder ID for `name` inside `parentFolderId`, creating it
 * if it doesn't exist yet. Uses Box's conflict response (409) to detect
 * existing folders without a separate list call.
 */
export async function ensureBoxSubfolder(
  agencyId:       string,
  parentFolderId: string,
  name:           string,
): Promise<string> {
  const token = await getBoxToken(agencyId)

  const res = await fetch(`${BOX_API_URL}/folders`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, parent: { id: parentFolderId } }),
  })

  if (res.ok) {
    const data = await res.json() as { id: string }
    console.log(`[boxDelivery] created subfolder "${name}" → ${data.id}`)
    return data.id
  }

  if (res.status === 409) {
    const body = await res.json() as {
      context_info?: { conflicts?: Array<{ id?: string }> }
    }
    const existingId = body.context_info?.conflicts?.[0]?.id
    if (existingId) {
      console.log(`[boxDelivery] subfolder "${name}" already exists → ${existingId}`)
      return existingId
    }
    const listRes = await fetch(
      `${BOX_API_URL}/folders/${parentFolderId}/items?type=folder&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (listRes.ok) {
      const listData = await listRes.json() as { entries: Array<{ id: string; name: string }> }
      const match = listData.entries.find((e) => e.name === name)
      if (match) return match.id
    }
  }

  throw new Error(`ensureBoxSubfolder failed for "${name}" in ${parentFolderId}: ${res.status}`)
}
