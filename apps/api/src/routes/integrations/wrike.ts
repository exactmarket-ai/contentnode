import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'

const WRIKE_AUTH_URL  = 'https://login.wrike.com/oauth2/authorize/v4'
const WRIKE_TOKEN_URL = 'https://login.wrike.com/oauth2/token'

function wrikeClientId()     { return process.env.WRIKE_CLIENT_ID     ?? '' }
function wrikeClientSecret() { return process.env.WRIKE_CLIENT_SECRET  ?? '' }
function redirectUri(req: { hostname: string; protocol: string }) {
  const apiBase = process.env.API_BASE_URL ?? `${req.protocol}://${req.hostname}`
  return `${apiBase}/api/v1/integrations/wrike/callback`
}

async function refreshWrikeToken(agencyId: string): Promise<{ accessToken: string; host: string }> {
  const integration = await prisma.integration.findUnique({ where: { agencyId_provider: { agencyId, provider: 'wrike' } } })
  if (!integration) throw new Error('Wrike not connected')

  const meta = (integration.metadata ?? {}) as Record<string, string>

  // Return cached token if still valid (with 5 min buffer)
  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { accessToken: integration.accessToken, host: meta.host ?? 'www.wrike.com' }
  }

  if (!integration.refreshToken) throw new Error('No refresh token — please reconnect Wrike')

  const res = await fetch(WRIKE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     wrikeClientId(),
      client_secret: wrikeClientSecret(),
      refresh_token: integration.refreshToken,
    }),
  })

  if (!res.ok) throw new Error(`Wrike token refresh failed: ${res.status}`)
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; host: string }

  await prisma.integration.update({
    where: { agencyId_provider: { agencyId, provider: 'wrike' } },
    data: {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      metadata:     { ...meta, host: data.host ?? meta.host },
    },
  })

  return { accessToken: data.access_token, host: data.host ?? meta.host ?? 'www.wrike.com' }
}

export async function wrikeIntegrationRoutes(app: FastifyInstance) {

  // ── GET /connect — return OAuth redirect URL ─────────────────────────────
  app.get('/connect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const state = Buffer.from(JSON.stringify({ agencyId })).toString('base64url')
    const url = new URL(WRIKE_AUTH_URL)
    url.searchParams.set('client_id',     wrikeClientId())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri',  redirectUri(req as { hostname: string; protocol: string }))
    url.searchParams.set('scope',         'Default')
    url.searchParams.set('state',         state)
    return reply.send({ data: { url: url.toString() } })
  })

  // ── GET /callback — exchange code, store tokens ──────────────────────────
  // Public endpoint — Wrike hits this after auth
  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>

    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173'

    if (error || !code || !state) {
      return reply.redirect(`${frontendBase}/settings?wrike=error&reason=${error ?? 'missing_code'}`)
    }

    let agencyId: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      agencyId = decoded.agencyId
    } catch {
      return reply.redirect(`${frontendBase}/settings?wrike=error&reason=invalid_state`)
    }

    const res = await fetch(WRIKE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     wrikeClientId(),
        client_secret: wrikeClientSecret(),
        redirect_uri:  redirectUri(req as { hostname: string; protocol: string }),
        code,
      }),
    })

    if (!res.ok) {
      return reply.redirect(`${frontendBase}/settings?wrike=error&reason=token_exchange`)
    }

    const data = await res.json() as {
      access_token: string; refresh_token: string; expires_in: number; host: string
    }

    await prisma.integration.upsert({
      where:  { agencyId_provider: { agencyId, provider: 'wrike' } },
      create: {
        agencyId,
        provider:     'wrike',
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
        metadata:     { host: data.host ?? 'www.wrike.com' },
      },
      update: {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresAt:    new Date(Date.now() + data.expires_in * 1000),
        metadata:     { host: data.host ?? 'www.wrike.com' },
      },
    })

    return reply.redirect(`${frontendBase}/settings?wrike=connected`)
  })

  // ── GET /status — is Wrike connected? ────────────────────────────────────
  app.get('/status', async (req, reply) => {
    const { agencyId } = req.auth
    const integration = await prisma.integration.findUnique({
      where: { agencyId_provider: { agencyId, provider: 'wrike' } },
      select: { id: true, createdAt: true, metadata: true },
    })
    return reply.send({ data: { connected: !!integration, connectedAt: integration?.createdAt ?? null } })
  })

  // ── DELETE /disconnect — remove tokens ───────────────────────────────────
  app.delete('/disconnect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.integration.deleteMany({ where: { agencyId, provider: 'wrike' } })
    return reply.send({ data: { ok: true } })
  })

  // ── GET /tasks — fetch completed tasks for last N days ───────────────────
  app.get('/tasks', async (req, reply) => {
    const { agencyId } = req.auth
    const { days = '14' } = req.query as Record<string, string>

    const { accessToken, host } = await refreshWrikeToken(agencyId)

    const end   = new Date()
    const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000)

    const completedDate = JSON.stringify({
      start: start.toISOString().split('.')[0] + 'Z',
      end:   end.toISOString().split('.')[0] + 'Z',
    })

    const url = new URL(`https://${host}/api/v4/tasks`)
    url.searchParams.set('status',        'Completed')
    url.searchParams.set('completedDate', completedDate)
    url.searchParams.set('fields',        JSON.stringify(['description', 'briefDescription', 'parentIds', 'responsibleIds', 'completedDate', 'customFields']))
    url.searchParams.set('pageSize',      '100')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const err = await res.text()
      return reply.code(502).send({ error: `Wrike API error: ${res.status} ${err}` })
    }

    const data = await res.json() as { data: unknown[] }
    return reply.send({ data: data.data })
  })
}

export { refreshWrikeToken }
