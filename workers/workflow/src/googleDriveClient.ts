/**
 * Thin wrapper around Google Drive REST API v3.
 * Uses native fetch — no googleapis SDK — to match the Box pattern.
 */

import { prisma } from '@contentnode/database'
import { encrypt, safeDecrypt } from './lib/crypto.js'

const DRIVE_API    = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const TOKEN_URL    = 'https://oauth2.googleapis.com/token'

// ── Token management ──────────────────────────────────────────────────────────
async function doRefresh(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.GOOGLE_DRIVE_CLIENT_ID     ?? '',
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    console.error(`[googleDriveClient] token refresh failed: HTTP ${res.status} — ${await res.text().catch(() => '')}`)
    return null
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function getGoogleDriveToken(agencyId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'google_drive' } },
  })
  if (!integration) throw new Error('Google Drive not connected')

  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(integration.accessToken) ?? integration.accessToken
  }

  const storedRefresh = safeDecrypt(integration.refreshToken) ?? integration.refreshToken
  if (!storedRefresh) throw new Error('No Google Drive refresh token — please reconnect in Settings')

  let data = await doRefresh(storedRefresh)

  if (!data) {
    const fresh = await prisma.integration.findUnique({
      where: { agencyId_provider: { agencyId, provider: 'google_drive' } },
    })
    if (fresh?.expiresAt && fresh.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return safeDecrypt(fresh.accessToken) ?? fresh.accessToken
    }
    const freshRefresh = fresh ? (safeDecrypt(fresh.refreshToken) ?? fresh.refreshToken) : null
    if (freshRefresh && freshRefresh !== storedRefresh) {
      data = await doRefresh(freshRefresh)
    }
  }

  if (!data) throw new Error('Google Drive token refresh failed — please reconnect in Settings')

  await prisma.integration.update({
    where: { agencyId_provider: { agencyId, provider: 'google_drive' } },
    data:  { accessToken: encrypt(data.access_token), expiresAt: new Date(Date.now() + data.expires_in * 1000) },
  })

  return data.access_token
}

// ── Folder helpers ────────────────────────────────────────────────────────────
export async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Drive createFolder failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { id: string }
  return data.id
}

/**
 * Returns the Drive folder ID for `name` inside `parentFolderId`, creating it
 * if it doesn't exist. Lists existing folders to detect conflicts (Drive allows
 * duplicate-named folders, so we check before creating).
 */
export async function ensureGoogleDriveSubfolder(
  agencyId:       string,
  parentFolderId: string,
  name:           string,
): Promise<string> {
  const token = await getGoogleDriveToken(agencyId)

  // Check if folder already exists
  const q = `'${parentFolderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const listRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (listRes.ok) {
    const listData = await listRes.json() as { files: Array<{ id: string }> }
    if (listData.files.length > 0) {
      console.log(`[googleDriveClient] subfolder "${name}" already exists → ${listData.files[0].id}`)
      return listData.files[0].id
    }
  }

  const folderId = await createFolder(token, name, parentFolderId)
  console.log(`[googleDriveClient] created subfolder "${name}" → ${folderId}`)
  return folderId
}

// ── File operations ───────────────────────────────────────────────────────────
export async function uploadFile(
  token:    string,
  folderId: string,
  filename: string,
  buffer:   Buffer,
  mimeType: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const metadata = JSON.stringify({ name: filename, parents: [folderId] })
  const boundary = '-------ContentNode314159265'
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n')

  // Build multipart body as Buffer
  const preamble = Buffer.from(body)
  const closing  = Buffer.from(`\r\n--${boundary}--`)
  const multipart = Buffer.concat([preamble, buffer, closing])

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
    },
    body: multipart,
  })
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { id: string; webViewLink: string }
  return { fileId: data.id, webViewLink: data.webViewLink }
}

export async function getFileMetadata(token: string, fileId: string): Promise<{ name: string; modifiedTime: string; webViewLink: string }> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,modifiedTime,webViewLink`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive getFileMetadata failed: ${res.status}`)
  return res.json() as Promise<{ name: string; modifiedTime: string; webViewLink: string }>
}

export async function downloadFileContent(token: string, fileId: string, filename: string): Promise<Buffer> {
  // Uploaded .docx files are not Google Docs — download directly with alt=media
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)

  // Extract text from .docx with mammoth
  if (filename.endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: buf })
    return Buffer.from(result.value, 'utf-8')
  }

  return buf
}

// ── Push channel (webhook) registration ──────────────────────────────────────
export async function registerWatchChannel(
  token:     string,
  fileId:    string,
  channelId: string,
  webhookBase: string,
): Promise<{ resourceId: string; expiration: number }> {
  const expiryMs = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days max

  const res = await fetch(`${DRIVE_API}/files/${fileId}/watch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id:         channelId,
      type:       'web_hook',
      address:    `${webhookBase}/api/v1/webhooks/google-drive`,
      token:      process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN ?? '',
      expiration: expiryMs,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Drive registerWatchChannel failed: ${res.status} ${text}`)
  }
  const data = await res.json() as { resourceId: string; expiration: string }
  return { resourceId: data.resourceId, expiration: parseInt(data.expiration, 10) }
}

export async function stopWatchChannel(
  token:      string,
  channelId:  string,
  resourceId: string,
): Promise<void> {
  await fetch(`${DRIVE_API}/channels/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: channelId, resourceId }),
  }).catch(() => {})
}

// ── File sharing ──────────────────────────────────────────────────────────────
export async function shareFile(token: string, fileId: string, email: string): Promise<void> {
  await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'commenter', emailAddress: email }),
  }).catch((err) => console.error('[googleDriveClient] shareFile failed (non-fatal):', err))
}
