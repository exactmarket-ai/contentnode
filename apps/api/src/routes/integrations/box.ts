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
}
