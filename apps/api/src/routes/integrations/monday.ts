import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'
import { encrypt, safeDecrypt } from '../../lib/crypto.js'

const MONDAY_AUTH_URL  = 'https://auth.monday.com/oauth2/authorize'
const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token'
const MONDAY_API_URL   = 'https://api.monday.com/v2'

function mondayClientId()     { return process.env.MONDAY_CLIENT_ID     ?? '' }
function mondayClientSecret() { return process.env.MONDAY_CLIENT_SECRET  ?? '' }
function mondayApiToken()     { return process.env.MONDAY_API_TOKEN      ?? '' }

function redirectUri() {
  if (process.env.MONDAY_REDIRECT_URI) return process.env.MONDAY_REDIRECT_URI
  const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
  return `${apiBase}/api/v1/integrations/monday/callback`
}

async function getMondayToken(agencyId: string): Promise<string> {
  // If agency has an OAuth token stored, use that
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'monday' } },
  })
  if (integration) {
    const token = safeDecrypt(integration.accessToken)
    if (token) return token
  }
  // Fall back to global API token (for Exact Market's own account)
  const apiToken = mondayApiToken()
  if (apiToken) return apiToken
  throw new Error('Monday not connected')
}

async function mondayGraphQL<T = unknown>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Monday API error: ${res.status} ${await res.text()}`)
  const body = await res.json() as { data?: T; errors?: unknown[] }
  if (body.errors?.length) throw new Error(`Monday GraphQL error: ${JSON.stringify(body.errors)}`)
  return body.data as T
}

export async function mondayIntegrationRoutes(app: FastifyInstance) {

  // ── GET /connect — return OAuth redirect URL ─────────────────────────────
  app.get('/connect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const state = Buffer.from(JSON.stringify({ agencyId })).toString('base64url')
    const url = new URL(MONDAY_AUTH_URL)
    url.searchParams.set('client_id',     mondayClientId())
    url.searchParams.set('redirect_uri',  redirectUri())
    url.searchParams.set('state',         state)
    return reply.send({ data: { url: url.toString() } })
  })

  // ── GET /callback — exchange code, store token ───────────────────────────
  app.get('/callback', async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>
    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173'

    if (error || !code || !state) {
      return reply.redirect(`${frontendBase}/settings?monday=error&reason=${error ?? 'missing_code'}`)
    }

    let agencyId: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
      agencyId = decoded.agencyId
      if (!agencyId) throw new Error()
    } catch {
      return reply.redirect(`${frontendBase}/settings?monday=error&reason=invalid_state`)
    }

    const agencyExists = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } })
    if (!agencyExists) {
      return reply.redirect(`${frontendBase}/settings?monday=error&reason=wrong_environment`)
    }

    const res = await fetch(MONDAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     mondayClientId(),
        client_secret: mondayClientSecret(),
        redirect_uri:  redirectUri(),
        code,
      }),
    })

    if (!res.ok) {
      return reply.redirect(`${frontendBase}/settings?monday=error&reason=token_exchange`)
    }

    const data = await res.json() as { access_token: string; token_type: string; scope: string }

    await prisma.integration.upsert({
      where:  { agencyId_provider: { agencyId, provider: 'monday' } },
      create: {
        agencyId,
        provider:    'monday',
        accessToken: encrypt(data.access_token),
        metadata:    { scope: data.scope },
      },
      update: {
        accessToken: encrypt(data.access_token),
        metadata:    { scope: data.scope },
      },
    })

    return reply.redirect(`${frontendBase}/settings?monday=connected`)
  })

  // ── GET /status ───────────────────────────────────────────────────────────
  app.get('/status', async (req, reply) => {
    const { agencyId } = req.auth
    // Connected if OAuth token stored OR global API token configured
    const integration = await prisma.integration.findUnique({
      where: { agencyId_provider: { agencyId, provider: 'monday' } },
      select: { id: true, createdAt: true },
    })
    const connected = !!integration || !!mondayApiToken()
    return reply.send({ data: { connected, connectedAt: integration?.createdAt ?? null } })
  })

  // ── DELETE /disconnect ────────────────────────────────────────────────────
  app.delete('/disconnect', { preHandler: requireRole('owner', 'super_admin', 'org_admin', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.integration.deleteMany({ where: { agencyId, provider: 'monday' } })
    return reply.send({ data: { ok: true } })
  })

  // ── GET /boards — list all boards in the workspace ────────────────────────
  app.get('/boards', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)

    const data = await mondayGraphQL<{ boards: MondayBoard[] }>(token, `
      query {
        boards(limit: 100, order_by: created_at) {
          id
          name
          description
          state
          board_kind
          workspace {
            id
            name
          }
          columns {
            id
            title
            type
          }
        }
      }
    `)

    return reply.send({ data: data.boards ?? [] })
  })

  // ── GET /boards/:id — fetch a single board with all items ─────────────────
  app.get<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { id } = req.params

    const data = await mondayGraphQL<{ boards: MondayBoard[] }>(token, `
      query($id: [ID!]) {
        boards(ids: $id) {
          id
          name
          columns {
            id
            title
            type
          }
          groups {
            id
            title
            color
          }
          items_page(limit: 500) {
            cursor
            items {
              id
              name
              state
              group {
                id
                title
              }
              column_values {
                id
                text
                value
                ... on StatusValue { label index }
                ... on DateValue { date }
                ... on NumbersValue { number }
                ... on TextValue { text }
                ... on PeopleValue { persons_and_teams { id kind } }
                ... on LinkValue { url url_text }
              }
              subitems {
                id
                name
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      }
    `, { id: [id] })

    return reply.send({ data: data.boards?.[0] ?? null })
  })

  // ── GET /boards/:id/items — paginated items with cursor ───────────────────
  app.get<{ Params: { id: string } }>('/boards/:id/items', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { id } = req.params
    const { cursor } = req.query as { cursor?: string }

    const data = await mondayGraphQL<{ boards: { items_page: { cursor: string; items: MondayItem[] } }[] }>(token, `
      query($id: [ID!], $cursor: String) {
        boards(ids: $id) {
          items_page(limit: 500, cursor: $cursor) {
            cursor
            items {
              id
              name
              state
              group { id title }
              column_values {
                id
                text
                value
                ... on StatusValue { label index }
                ... on DateValue { date }
                ... on NumbersValue { number }
                ... on TextValue { text }
                ... on LinkValue { url url_text }
              }
            }
          }
        }
      }
    `, { id: [id], cursor: cursor ?? null })

    const page = data.boards?.[0]?.items_page
    return reply.send({ data: { items: page?.items ?? [], cursor: page?.cursor ?? null } })
  })

  // ── PATCH /boards/:boardId/items/:itemId — update a column value ──────────
  app.patch<{ Params: { boardId: string; itemId: string } }>('/boards/:boardId/items/:itemId', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { boardId, itemId } = req.params
    const { columnId, value } = req.body as { columnId: string; value: string }

    const data = await mondayGraphQL<{ change_column_value: { id: string } }>(token, `
      mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
          id
        }
      }
    `, { boardId, itemId, columnId, value })

    return reply.send({ data: data.change_column_value })
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface MondayBoard {
  id: string
  name: string
  description?: string
  state?: string
  board_kind?: string
  workspace?: { id: string; name: string }
  columns?: { id: string; title: string; type: string }[]
  groups?: { id: string; title: string; color: string }[]
  items_page?: { cursor: string; items: MondayItem[] }
}

interface MondayItem {
  id: string
  name: string
  state?: string
  group?: { id: string; title: string }
  column_values?: { id: string; text?: string; value?: string; label?: string; date?: string; number?: number; url?: string; url_text?: string }[]
  subitems?: MondayItem[]
}
