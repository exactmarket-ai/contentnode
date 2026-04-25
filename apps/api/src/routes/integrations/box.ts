import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'
import { encrypt, safeDecrypt } from '../../lib/crypto.js'

const BOX_AUTH_URL  = 'https://account.box.com/api/oauth2/authorize'
const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token'
const BOX_API_URL   = 'https://api.box.com/2.0'

function boxClientId()     { return process.env.BOX_CLIENT_ID     ?? '' }
function boxClientSecret() { return process.env.BOX_CLIENT_SECRET  ?? '' }

function redirectUri() {
  if (process.env.BOX_REDIRECT_URI) return process.env.BOX_REDIRECT_URI
  const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  return `${apiBase}/api/v1/integrations/box/callback`
}

// ── Token management (Box tokens expire every 60 min) ──────────────────────────
export async function getBoxToken(agencyId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'box' } },
  })
  if (!integration) throw new Error('Box not connected')

  // Return cached token if still valid (5 min buffer)
  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return safeDecrypt(integration.accessToken) ?? integration.accessToken
  }

  const storedRefresh = safeDecrypt(integration.refreshToken) ?? integration.refreshToken
  if (!storedRefresh) throw new Error('No refresh token — please reconnect Box')

  const res = await fetch(BOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     boxClientId(),
      client_secret: boxClientSecret(),
      refresh_token: storedRefresh,
    }),
  })

  if (!res.ok) throw new Error(`Box token refresh failed: ${res.status}`)
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }

  await prisma.integration.update({
    where:  { agencyId_provider: { agencyId, provider: 'box' } },
    data: {
      accessToken:  encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
    },
  })

  return data.access_token
}

// ── Box API helper ─────────────────────────────────────────────────────────────
async function boxApi<T = unknown>(token: string, path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BOX_API_URL}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Box API error: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

// ── Folder creation (exported for use in webhook handler) ──────────────────────
export async function createBoxFolder(agencyId: string, name: string, parentId = '0'): Promise<{ id: string; url: string }> {
  const token  = await getBoxToken(agencyId)
  const folder = await boxApi<{ id: string; name: string }>(token, '/folders', {
    method: 'POST',
    body:   JSON.stringify({ name, parent: { id: parentId } }),
  })
  return { id: folder.id, url: `https://app.box.com/folder/${folder.id}` }
}

// ── File upload + metadata + webhook registration ──────────────────────────────
// Called after a run completes to deliver the output file to Box and register
// a FILE.NEW_VERSION webhook so edits feed back into ContentNode automatically.
export async function deliverRunToBox(params: {
  agencyId:      string
  clientId:      string
  runId:         string
  stakeholderId: string | null
  folderId:      string
  filename:      string
  content:       Buffer | string   // file content (.docx bytes or UTF-8 text)
  mimeType:      string
  mondayItemId?: string
}): Promise<{ fileId: string; fileUrl: string }> {
  const { agencyId, clientId, runId, stakeholderId, folderId, filename, content, mimeType, mondayItemId } = params
  const token = await getBoxToken(agencyId)

  // 1. Upload file
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  const form = new FormData()
  form.append('attributes', JSON.stringify({ name: filename, parent: { id: folderId } }))
  form.append('file', new Blob([buf], { type: mimeType }), filename)

  const uploadRes = await fetch('https://upload.box.com/api/2.0/files/content', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  })
  if (!uploadRes.ok) throw new Error(`Box upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  const uploadData = await uploadRes.json() as { entries: Array<{ id: string }> }
  const fileId = uploadData.entries[0].id
  const fileUrl = `https://app.box.com/file/${fileId}`

  // 2. Write metadata template so any future version can be routed back here
  //    Uses the "global" scope with the "properties" template (no custom template required).
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
  }).catch(() => { /* metadata write is best-effort — don't fail the upload */ })

  // 3. Register FILE.NEW_VERSION webhook on the specific file
  const webhookBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  let boxWebhookId: string | null = null
  try {
    const wh = await boxApi<{ id: string }>(token, '/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        target:  { id: fileId, type: 'file' },
        triggers: ['FILE.NEW_VERSION'],
        address:  `${webhookBase}/api/v1/webhooks/box-file`,
      }),
    })
    boxWebhookId = wh.id
  } catch (err) {
    // Webhook registration failure is non-fatal — file is still delivered
    console.error('[box] webhook registration failed:', err)
  }

  // 4. Store tracking record
  await prisma.boxFileTracking.create({
    data: {
      agencyId,
      clientId,
      runId,
      stakeholderId: stakeholderId ?? null,
      boxFileId:  fileId,
      boxWebhookId,
      boxFolderId: folderId,
      filename,
      mondayItemId: mondayItemId ?? null,
    },
  })

  return { fileId, fileUrl }
}

// ── Delete Box webhook when a run is archived ──────────────────────────────────
export async function deregisterBoxWebhook(agencyId: string, boxWebhookId: string): Promise<void> {
  const token = await getBoxToken(agencyId)
  await fetch(`${BOX_API_URL}/webhooks/${boxWebhookId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
}

export async function boxIntegrationRoutes(app: FastifyInstance) {

  // ── GET /connect ─────────────────────────────────────────────────────────────
  app.get('/connect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const state = Buffer.from(JSON.stringify({ agencyId })).toString('base64url')
    const url   = new URL(BOX_AUTH_URL)
    url.searchParams.set('client_id',     boxClientId())
    url.searchParams.set('redirect_uri',  redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state',         state)
    return reply.send({ data: { url: url.toString() } })
  })

  // ── GET /callback ─────────────────────────────────────────────────────────────
  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>
    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173'

    if (error || !code || !state) {
      return reply.redirect(`${frontendBase}/settings?box=error&reason=${error ?? 'missing_code'}`)
    }

    let agencyId: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      agencyId = decoded.agencyId
      if (!agencyId) throw new Error()
    } catch {
      return reply.redirect(`${frontendBase}/settings?box=error&reason=invalid_state`)
    }

    const agencyExists = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } })
    if (!agencyExists) {
      return reply.redirect(`${frontendBase}/settings?box=error&reason=wrong_environment`)
    }

    const res = await fetch(BOX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     boxClientId(),
        client_secret: boxClientSecret(),
        redirect_uri:  redirectUri(),
        code,
      }),
    })

    if (!res.ok) {
      return reply.redirect(`${frontendBase}/settings?box=error&reason=token_exchange`)
    }

    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }

    await prisma.integration.upsert({
      where:  { agencyId_provider: { agencyId, provider: 'box' } },
      create: {
        agencyId,
        provider:     'box',
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

    return reply.redirect(`${frontendBase}/settings?box=connected`)
  })

  // ── GET /status ───────────────────────────────────────────────────────────────
  app.get('/status', async (req, reply) => {
    const { agencyId }  = req.auth
    const integration   = await prisma.integration.findUnique({
      where:  { agencyId_provider: { agencyId, provider: 'box' } },
      select: { id: true, createdAt: true },
    })
    return reply.send({ data: { connected: !!integration, connectedAt: integration?.createdAt ?? null } })
  })

  // ── DELETE /disconnect ────────────────────────────────────────────────────────
  app.delete('/disconnect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.integration.deleteMany({ where: { agencyId, provider: 'box' } })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /folders — create a Box folder ──────────────────────────────────────
  app.post('/folders', async (req, reply) => {
    const { agencyId } = req.auth
    const { name, parentId } = req.body as { name: string; parentId?: string }
    if (!name) return reply.code(400).send({ error: 'name required' })
    const result = await createBoxFolder(agencyId, name, parentId ?? '0')
    return reply.send({ data: result })
  })

  // ── GET /folders/:id — get folder info ────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/folders/:id', async (req, reply) => {
    const { agencyId }   = req.auth
    const token          = await getBoxToken(agencyId)
    const { id }         = req.params
    const folder         = await boxApi<{ id: string; name: string; item_count: number }>(token, `/folders/${id}`)
    return reply.send({ data: folder })
  })

  // ── GET /root-subfolders — list subfolders of the configured parent folder ────
  app.get('/root-subfolders', async (req, reply) => {
    const { agencyId } = req.auth
    const token        = await getBoxToken(agencyId)
    const rootId       = process.env.BOX_PARENT_FOLDER_ID ?? '0'

    const result = await boxApi<{
      item_collection: { entries: { type: string; id: string; name: string }[] }
    }>(token, `/folders/${rootId}/items?fields=id,name,type&limit=200`)

    const folders = (result.item_collection?.entries ?? [])
      .filter((e) => e.type === 'folder')
      .map((e) => ({ id: e.id, name: e.name }))

    return reply.send({ data: folders })
  })

  // ── GET /folders/:id/subfolders — list immediate subfolders ──────────────────
  app.get<{ Params: { id: string } }>('/folders/:id/subfolders', async (req, reply) => {
    const { agencyId } = req.auth
    const token        = await getBoxToken(agencyId)
    const { id }       = req.params

    const result = await boxApi<{
      item_collection: { entries: { type: string; id: string; name: string }[] }
    }>(token, `/folders/${id}/items?fields=id,name,type&limit=200`)

    const folders = (result.item_collection?.entries ?? [])
      .filter((e) => e.type === 'folder')
      .map((e) => ({ id: e.id, name: e.name }))

    return reply.send({ data: folders })
  })

  // ── GET /folder-for-item?mondayItemId=XXX ─────────────────────────────────
  // Returns the most recent Box project folder used for a given Monday item.
  // Used by the Project Routing modal to auto-populate the folder field.
  app.get('/folder-for-item', async (req, reply) => {
    const { agencyId } = req.auth
    const { mondayItemId } = req.query as { mondayItemId?: string }
    if (!mondayItemId) return reply.send({ folderId: null })

    const tracking = await prisma.boxFileTracking.findFirst({
      where:   { agencyId, mondayItemId },
      orderBy: { createdAt: 'desc' },
      select:  { boxFolderId: true },
    })

    return reply.send({ folderId: tracking?.boxFolderId ?? null })
  })
}
