import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'
import { encrypt, safeDecrypt } from '../../lib/crypto.js'

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

function clientId()     { return process.env.GOOGLE_DRIVE_CLIENT_ID     ?? '' }
function clientSecret() { return process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '' }

function redirectUri() {
  if (process.env.GOOGLE_DRIVE_REDIRECT_URI) return process.env.GOOGLE_DRIVE_REDIRECT_URI
  const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  return `${apiBase}/api/v1/integrations/google-drive/callback`
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function doRefresh(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
} | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) return null
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function getGoogleDriveToken(agencyId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'google_drive' } },
  })
  if (!integration) throw new Error('Google Drive not connected')

  // Return cached token if still valid (5 min buffer)
  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(integration.accessToken) ?? integration.accessToken
  }

  const storedRefresh = safeDecrypt(integration.refreshToken) ?? integration.refreshToken
  if (!storedRefresh) throw new Error('No Google Drive refresh token — please reconnect in Settings')

  let data = await doRefresh(storedRefresh)

  if (!data) {
    // Another process may have refreshed; re-read and try
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
    data: {
      accessToken: encrypt(data.access_token),
      expiresAt:   new Date(Date.now() + data.expires_in * 1000),
    },
  })

  return data.access_token
}

// ── Routes ────────────────────────────────────────────────────────────────────
export async function googleDriveIntegrationRoutes(app: FastifyInstance) {

  // GET /connect — returns the Google OAuth consent URL
  app.get('/connect', { preHandler: requireRole('owner', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const state = Buffer.from(JSON.stringify({ agencyId })).toString('base64url')
    const url   = new URL(GOOGLE_AUTH_URL)
    url.searchParams.set('client_id',     clientId())
    url.searchParams.set('redirect_uri',  redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ].join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt',       'consent')
    url.searchParams.set('state',        state)
    return reply.send({ data: { url: url.toString() } })
  })

  // GET /callback — exchanges code for tokens, stores encrypted
  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>
    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173'

    if (error || !code || !state) {
      return reply.redirect(`${frontendBase}/settings?gdrive=error&reason=${error ?? 'missing_code'}`)
    }

    let agencyId: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      agencyId = decoded.agencyId
      if (!agencyId) throw new Error()
    } catch {
      return reply.redirect(`${frontendBase}/settings?gdrive=error&reason=invalid_state`)
    }

    const agencyExists = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } })
    if (!agencyExists) {
      return reply.redirect(`${frontendBase}/settings?gdrive=error&reason=wrong_environment`)
    }

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     clientId(),
        client_secret: clientSecret(),
        redirect_uri:  redirectUri(),
        code,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[gdrive oauth] token exchange failed:', errText)
      return reply.redirect(`${frontendBase}/settings?gdrive=error&reason=token_exchange`)
    }

    const data = await res.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!data.refresh_token) {
      // This happens if the user previously granted access without prompt=consent.
      // Since we always send prompt=consent this should not occur, but guard anyway.
      return reply.redirect(`${frontendBase}/settings?gdrive=error&reason=no_refresh_token`)
    }

    await prisma.integration.upsert({
      where:  { agencyId_provider: { agencyId, provider: 'google_drive' } },
      create: {
        agencyId,
        provider:     'google_drive',
        accessToken:  encrypt(data.access_token),
        refreshToken: encrypt(data.refresh_token),
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      },
      update: {
        accessToken:  encrypt(data.access_token),
        refreshToken: encrypt(data.refresh_token),
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      },
    })

    return reply.redirect(`${frontendBase}/settings?gdrive=connected`)
  })

  // GET /status
  app.get('/status', async (req, reply) => {
    const { agencyId } = req.auth
    const integration  = await prisma.integration.findUnique({
      where:  { agencyId_provider: { agencyId, provider: 'google_drive' } },
      select: { id: true, createdAt: true },
    })
    return reply.send({ data: { connected: !!integration, connectedAt: integration?.createdAt ?? null } })
  })

  // DELETE /disconnect — revoke + delete
  app.delete('/disconnect', { preHandler: requireRole('owner', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const integration  = await prisma.integration.findUnique({
      where:  { agencyId_provider: { agencyId, provider: 'google_drive' } },
      select: { accessToken: true },
    })
    if (integration) {
      const token = safeDecrypt(integration.accessToken) ?? integration.accessToken
      // Revoke best-effort
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
      await prisma.integration.deleteMany({ where: { agencyId, provider: 'google_drive' } })
    }
    return reply.send({ data: { ok: true } })
  })

  // POST /folders — create a Drive folder
  app.post('/folders', async (req, reply) => {
    const { agencyId } = req.auth
    const { name, parentId } = req.body as { name: string; parentId?: string }
    if (!name) return reply.code(400).send({ error: 'name required' })
    const token = await getGoogleDriveToken(agencyId)
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    })
    if (!res.ok) throw new Error(`Drive folder creation failed: ${res.status} ${await res.text()}`)
    const folder = await res.json() as { id: string }
    return reply.send({ data: { id: folder.id, url: `https://drive.google.com/drive/folders/${folder.id}` } })
  })

  // GET /root-subfolders — list subfolders of a given parent (or My Drive root)
  app.get('/root-subfolders', async (req, reply) => {
    const { agencyId } = req.auth
    const { parentId } = req.query as { parentId?: string }
    const token = await getGoogleDriveToken(agencyId)

    const q = parentId
      ? `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
      : `'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`)
    const data = await res.json() as { files: Array<{ id: string; name: string }> }
    return reply.send({ data: data.files ?? [] })
  })
}
