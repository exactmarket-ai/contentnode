import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'
import { encrypt, safeDecrypt } from '../../lib/crypto.js'
import { createBoxFolder } from './box.js'

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

async function getDefaultAgencyId(): Promise<string | null> {
  const agency = await prisma.agency.findFirst({ select: { id: true } })
  return agency?.id ?? null
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
    const connected = !!integration
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

  // ── POST /boards/:boardId/items — create a new item ──────────────────────
  app.post<{ Params: { boardId: string } }>('/boards/:boardId/items', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { boardId } = req.params
    const { name, groupId } = req.body as { name: string; groupId?: string }
    if (!name) return reply.code(400).send({ error: 'name required' })

    const data = await mondayGraphQL<{ create_item: { id: string; name: string } }>(token, `
      mutation($boardId: ID!, $name: String!, $groupId: String) {
        create_item(board_id: $boardId, item_name: $name, group_id: $groupId) {
          id
          name
        }
      }
    `, { boardId, name, groupId: groupId ?? null })

    return reply.send({ data: data.create_item })
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

  // ── GET /webhooks — list active board webhooks ────────────────────────────
  app.get<{ Params: { boardId: string } }>('/boards/:boardId/webhooks', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { boardId } = req.params

    const data = await mondayGraphQL<{ webhooks: { id: string; board_id: string; event: string; config: string }[] }>(token, `
      query($boardId: ID!) {
        webhooks(board_id: $boardId) {
          id
          board_id
          event
          config
        }
      }
    `, { boardId })

    return reply.send({ data: data.webhooks ?? [] })
  })

  // ── POST /boards/:boardId/webhooks — subscribe to board events ────────────
  app.post<{ Params: { boardId: string } }>('/boards/:boardId/webhooks', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { boardId } = req.params
    const { events } = req.body as { events?: string[] }

    const webhookUrl = (() => {
      if (process.env.MONDAY_WEBHOOK_URL) return process.env.MONDAY_WEBHOOK_URL
      const apiBase = (process.env.API_BASE_URL ?? '').replace(/\/$/, '')
      return `${apiBase}/api/v1/integrations/monday/webhook`
    })()

    const eventList = events ?? ['change_column_value']
    const results = []

    for (const event of eventList) {
      const data = await mondayGraphQL<{ create_webhook: { id: string; board_id: string } }>(token, `
        mutation($boardId: ID!, $url: String!) {
          create_webhook(board_id: $boardId, url: $url, event: ${event}) {
            id
            board_id
          }
        }
      `, { boardId, url: webhookUrl })
      results.push(data.create_webhook)
    }

    return reply.send({ data: results })
  })

  // ── DELETE /boards/:boardId/webhooks/:webhookId — unsubscribe ─────────────
  app.delete<{ Params: { boardId: string; webhookId: string } }>('/boards/:boardId/webhooks/:webhookId', async (req, reply) => {
    const { agencyId } = req.auth
    const token = await getMondayToken(agencyId)
    const { webhookId } = req.params

    const data = await mondayGraphQL<{ delete_webhook: { id: string } }>(token, `
      mutation($id: ID!) {
        delete_webhook(id: $id) {
          id
        }
      }
    `, { id: webhookId })

    return reply.send({ data: data.delete_webhook })
  })

  // ── POST /webhook — receive Monday events (no Clerk auth — called by Monday) ─
  app.post('/webhook', async (req, reply) => {
    const body = req.body as Record<string, unknown>

    // Challenge handshake — Monday sends this when you first register the URL
    if (body.challenge) {
      return reply.send({ challenge: body.challenge })
    }

    // Validate signing secret if configured — if not set, accept all (dev/staging)
    const signingSecret = process.env.MONDAY_SIGNING_SECRET
    if (signingSecret) {
      const auth = ((req.headers.authorization as string) ?? '').replace(/^Bearer\s+/i, '').trim()
      if (auth !== signingSecret) {
        return reply.code(401).send({ error: 'Invalid webhook signature' })
      }
    }

    const event = body.event as MondayWebhookEvent | undefined
    if (!event) return reply.send({ ok: true })

    app.log.info(
      { type: event.type, boardId: event.boardId, itemId: event.pulseId, itemName: event.pulseName },
      'Monday webhook received'
    )

    // ── Box folder creation: fires when "Sub Project" column is set/changed ──
    // We intentionally do NOT trigger on create_item because Monday fires that
    // webhook the instant the item name is typed — before Sub Project is filled.
    // Instead we subscribe to change_column_values and react when Sub Project
    // gets a value.  Deduplication: skip if the item already has a Box folder URL.
    const isSubProjectChange = (
      event.type === 'change_column_value' || event.type === 'update_column_value'
    ) && event.pulseId && (
      event.columnTitle?.toLowerCase().includes('sub project') ||
      event.columnId?.toLowerCase().includes('sub_project') ||
      event.columnId?.toLowerCase().includes('sub-project')
    )

    if (isSubProjectChange) {
      // Extract new text value from the column change event
      // Monday sends value as JSON — could be { "value": "text" } or { "text": "text" }
      let folderName = ''
      try {
        const v = event.value as Record<string, unknown> | string | undefined
        if (typeof v === 'string') {
          const parsed = JSON.parse(v) as Record<string, unknown>
          folderName = (parsed.value as string ?? parsed.text as string ?? '').trim()
        } else if (v && typeof v === 'object') {
          folderName = ((v.value as string) ?? (v.text as string) ?? '').trim()
        }
      } catch { /* non-fatal — fall through to item name fetch */ }

      if (!folderName) return reply.send({ ok: true }) // Sub Project was cleared

      const integration = await prisma.integration.findFirst({
        where: { provider: 'monday' },
        select: { agencyId: true },
      })
      const agencyId = integration?.agencyId
        ?? (process.env.MONDAY_API_TOKEN ? await getDefaultAgencyId() : null)

      if (agencyId) {
        try {
          const token   = await getMondayToken(agencyId)
          const boardId = String(event.boardId)
          const itemId  = String(event.pulseId)

          // Fetch board name + existing Box column value for dedup check
          const itemData = await mondayGraphQL<{
            items: Array<{
              board: { id: string; name: string }
              column_values: Array<{ id: string; title: string; text: string }>
            }>
          }>(token, `
            query($itemId: [ID!]) {
              items(ids: $itemId) {
                board { id name }
                column_values { id title text }
              }
            }
          `, { itemId: [itemId] })

          const item      = itemData.items?.[0]
          const boardName = item?.board?.name ?? ''
          const colValues = item?.column_values ?? []

          // Skip if Box folder already set for this item
          const existingBoxCol = colValues.find(
            cv => cv.title.toLowerCase().includes('client folder') && cv.title.toLowerCase().includes('box')
          ) ?? colValues.find(cv => cv.title.toLowerCase() === 'box')
          if (existingBoxCol?.text?.trim()) {
            app.log.info({ itemId, folderName }, 'Box folder already set — skipping')
            return reply.send({ ok: true })
          }

          // Match board → ContentNode client
          const clientName = boardName.replace(/\s*-\s*campaigns?$/i, '').trim()
          const client = clientName
            ? await prisma.client.findFirst({
                where: { agencyId, name: { contains: clientName, mode: 'insensitive' } },
                select: { id: true, boxFolderId: true },
              })
            : null

          // Store mondayBoardId if not already set
          if (client && boardId) {
            await prisma.client.update({
              where: { id: client.id },
              data: { mondayBoardId: boardId },
            }).catch(() => {})
          }

          const parentId = client?.boxFolderId ?? process.env.BOX_PARENT_FOLDER_ID ?? '0'
          const { url } = await createBoxFolder(agencyId, folderName, parentId)

          // Write Box URL back to "Client Folder - Box" column
          const boxCol = existingBoxCol ?? colValues.find(
            cv => cv.title.toLowerCase().includes('client folder') && cv.title.toLowerCase().includes('box')
          ) ?? colValues.find(cv => cv.title.toLowerCase() === 'box')

          // Fetch column list if we didn't get it already
          const boardData = await mondayGraphQL<{ boards: { columns: { id: string; title: string }[] }[] }>(token, `
            query($id: [ID!]) { boards(ids: $id) { columns { id title } } }
          `, { id: [boardId] })
          const writeCol = boardData.boards?.[0]?.columns?.find(
            c => c.title.toLowerCase().includes('client folder') && c.title.toLowerCase().includes('box')
          ) ?? boardData.boards?.[0]?.columns?.find(c => c.title.toLowerCase() === 'box')

          if (writeCol) {
            await mondayGraphQL(token, `
              mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
                change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
              }
            `, { boardId, itemId, columnId: writeCol.id, value: JSON.stringify({ url, text: 'Open in Box' }) })
          }

          app.log.info({ folderName, boardName, clientName, parentId, url }, 'Box project subfolder created from Sub Project column')
        } catch (err) {
          app.log.error({ err }, 'Box folder creation failed')
        }
      }
    }

    return reply.send({ ok: true })
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

interface MondayWebhookEvent {
  type: string
  boardId: number
  groupId?: string
  pulseId?: number
  pulseName?: string
  columnId?: string
  columnType?: string
  columnTitle?: string
  value?: Record<string, unknown>
  previousValue?: Record<string, unknown>
  userId?: number
  triggerTime?: string
}
