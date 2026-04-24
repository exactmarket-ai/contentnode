import type { FastifyInstance } from 'fastify'
import { prisma, withAgency, type Prisma } from '@contentnode/database'
import { requireRole } from '../../plugins/auth.js'
import { encrypt, safeDecrypt } from '../../lib/crypto.js'
import { createBoxFolder } from './box.js'
import { getWorkflowRunsQueue } from '../../lib/queues.js'

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

  // Monday webhook bodies are sometimes non-standard JSON (extra whitespace,
  // BOM, or URL-encoded payloads). Register a lenient parser scoped to this
  // plugin so real Monday events aren't rejected before reaching the handler.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string))
    } catch {
      // Try stripping a BOM or leading/trailing noise then re-parse
      try {
        const cleaned = (body as string).replace(/^﻿/, '').trim()
        done(null, JSON.parse(cleaned))
      } catch {
        done(null, {})
      }
    }
  })
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)) } catch { done(null, {}) }
  })

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
    const debugMode = (req.query as Record<string, string>).debug === '1'
    const debugLog: string[] = []
    const dbg = (msg: string) => { if (debugMode) debugLog.push(msg) }

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
    if (!event) return reply.send({ ok: true, debug: debugLog })

    app.log.info(
      { type: event.type, boardId: event.boardId, itemId: event.pulseId, itemName: event.pulseName },
      'Monday webhook received'
    )

    // ── Box folder creation: fires on any column change, fetches item to check Sub Project ──
    const isColumnChange = (
      event.type === 'change_column_value' || event.type === 'update_column_value'
    ) && event.pulseId

    dbg(`event.type=${event.type} isColumnChange=${!!isColumnChange}`)

    if (isColumnChange) {
      // Integration is not a tenant-scoped model so this works without agency context
      const integration = await prisma.integration.findFirst({
        where: { provider: 'monday' },
        select: { agencyId: true },
      })
      dbg(`integration.agencyId=${integration?.agencyId ?? 'null'}`)
      app.log.info({ integration: integration?.agencyId ?? null }, '[monday-webhook] integration lookup')

      // Fall back to getDefaultAgencyId() regardless of API token (just needs any agency in DB)
      const agencyId = integration?.agencyId ?? await getDefaultAgencyId()
      dbg(`agencyId=${agencyId ?? 'null'}`)
      app.log.info({ agencyId }, '[monday-webhook] resolved agencyId')

      if (!agencyId) {
        app.log.error('[monday-webhook] no agencyId — skipping Box folder creation')
        return reply.send({ ok: true, debug: debugLog })
      }

      try {
        const token   = await getMondayToken(agencyId)
        const boardId = String(event.boardId)
        const itemId  = String(event.pulseId)

        dbg(`token=ok boardId=${boardId} itemId=${itemId}`)
        app.log.info({ boardId, itemId }, '[monday-webhook] fetching item column values')

        // Fetch item's column values + board name + board column definitions (title lives on Column, not ColumnValue)
        const itemData = await mondayGraphQL<{
          items: Array<{
            board: { id: string; name: string; columns: Array<{ id: string; title: string }> }
            column_values: Array<{ id: string; text: string }>
          }>
        }>(token, `
          query($itemId: [ID!]) {
            items(ids: $itemId) {
              board { id name columns { id title } }
              column_values { id text }
            }
          }
        `, { itemId: [itemId] })

        const item      = itemData.items?.[0]
        const boardName = item?.board?.name ?? ''
        // Join column values with column definitions so we have { id, title, text }
        const colDefs   = item?.board?.columns ?? []
        const colValues = (item?.column_values ?? []).map(cv => ({
          id:    cv.id,
          title: colDefs.find(c => c.id === cv.id)?.title ?? cv.id,
          text:  cv.text,
        }))

        dbg(`boardName=${boardName} columns=${colValues.map(c => `"${c.title}"=${JSON.stringify(c.text)}`).join(', ')}`)
        app.log.info({ boardName, columnCount: colValues.length, columns: colValues.map(c => `${c.title}=${c.text}`) }, '[monday-webhook] item columns')

        // Only proceed if Sub Project has a value
        const subProjectCol = colValues.find(cv => cv.title.toLowerCase().includes('sub project'))
        const folderName = subProjectCol?.text?.trim()
        dbg(`subProjectCol="${subProjectCol?.title}" folderName="${folderName}"`)
        app.log.info({ subProjectColTitle: subProjectCol?.title, folderName }, '[monday-webhook] sub project check')
        if (!folderName) return reply.send({ ok: true, debug: debugLog })

        // Skip if Box folder URL already set for this item (dedup)
        const existingBoxCol = colValues.find(
          cv => cv.title.toLowerCase().includes('client folder') && cv.title.toLowerCase().includes('box')
        ) ?? colValues.find(cv => cv.title.toLowerCase() === 'box')
        dbg(`existingBoxCol="${existingBoxCol?.title}" text="${existingBoxCol?.text}"`)
        app.log.info({ existingBoxText: existingBoxCol?.text }, '[monday-webhook] dedup check')
        if (existingBoxCol?.text?.trim()) {
          app.log.info({ itemId, folderName }, '[monday-webhook] Box folder already set — skipping')
          return reply.send({ ok: true, debug: debugLog })
        }

        // Match board → ContentNode client by board name, run inside agency context
        const clientName = boardName.replace(/\s*-\s*campaigns?$/i, '').trim()
        dbg(`clientName="${clientName}"`)
        app.log.info({ clientName, agencyId }, '[monday-webhook] looking up client')

        const client = await withAgency(agencyId, async () => {
          if (!clientName) return null
          return prisma.client.findFirst({
            where: { name: { contains: clientName, mode: 'insensitive' } },
            select: { id: true, boxFolderId: true },
          })
        })
        dbg(`client.id=${client?.id} client.boxFolderId=${client?.boxFolderId}`)
        app.log.info({ clientId: client?.id, clientBoxFolderId: client?.boxFolderId }, '[monday-webhook] client lookup result')

        // Store mondayBoardId on client if not already set
        if (client?.id && boardId) {
          await withAgency(agencyId, () =>
            prisma.client.update({ where: { id: client.id }, data: { mondayBoardId: boardId } })
          ).catch((err) => app.log.warn({ err }, '[monday-webhook] mondayBoardId update failed (non-fatal)'))
        }

        const parentId = client?.boxFolderId ?? process.env.BOX_PARENT_FOLDER_ID ?? '0'
        dbg(`parentId=${parentId} — creating folder "${folderName}"`)
        app.log.info({ folderName, parentId }, '[monday-webhook] creating Box folder')
        const { id: folderId, url } = await createBoxFolder(agencyId, folderName, parentId)
        dbg(`CREATED folderId=${folderId} url=${url}`)
        app.log.info({ folderId, url }, '[monday-webhook] Box folder created')

        // Write Box URL back to "Client Folder - Box" column
        const boardData = await mondayGraphQL<{ boards: { columns: { id: string; title: string }[] }[] }>(token, `
          query($id: [ID!]) { boards(ids: $id) { columns { id title } } }
        `, { id: [boardId] })
        const writeCol = boardData.boards?.[0]?.columns?.find(
          c => c.title.toLowerCase().includes('client folder') && c.title.toLowerCase().includes('box')
        ) ?? boardData.boards?.[0]?.columns?.find(c => c.title.toLowerCase() === 'box')

        dbg(`writeCol="${writeCol?.id}" title="${writeCol?.title}"`)
        app.log.info({ writeColId: writeCol?.id, writeColTitle: writeCol?.title }, '[monday-webhook] write-back column')

        if (writeCol) {
          await mondayGraphQL(token, `
            mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
              change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
            }
          `, { boardId, itemId, columnId: writeCol.id, value: JSON.stringify({ url, text: 'Open in Box' }) })
          dbg(`URL written back to Monday column ${writeCol.id}`)
          app.log.info({ itemId, url }, '[monday-webhook] Box URL written back to Monday')
        }

        app.log.info({ folderName, boardName, clientName, parentId, url }, '[monday-webhook] Box project subfolder created successfully')

        // Auto-trigger: find the client's most recently active workflow and enqueue a run
        if (client?.id) {
          try {
            const workflow = await withAgency(agencyId, () =>
              prisma.workflow.findFirst({
                where:   { clientId: client.id, agencyId, status: { not: 'archived' } },
                orderBy: { updatedAt: 'desc' },
                select:  { id: true, defaultAssigneeId: true },
              })
            )

            if (workflow) {
              const run = await withAgency(agencyId, () =>
                prisma.workflowRun.create({
                  data: {
                    workflowId:      workflow.id,
                    agencyId,
                    triggeredBy:     null,
                    status:          'pending',
                    input:           { mondayItemId: itemId, mondayBoardId: boardId, triggerSource: 'monday_webhook' } as Prisma.InputJsonValue,
                    output:          { nodeStatuses: {} } as Prisma.InputJsonValue,
                    clientFolderBox: url,
                    ...(workflow.defaultAssigneeId ? { assigneeId: workflow.defaultAssigneeId } : {}),
                  },
                })
              )

              const queue = getWorkflowRunsQueue()
              await queue.add('run-workflow', { workflowRunId: run.id, agencyId }, { jobId: run.id })

              dbg(`auto-triggered run ${run.id} for workflow ${workflow.id}`)
              app.log.info({ workflowId: workflow.id, runId: run.id, url }, '[monday-webhook] auto-triggered workflow run')
            } else {
              dbg(`no workflow found for clientId=${client.id}`)
              app.log.info({ clientId: client.id }, '[monday-webhook] no active workflow found — skipping auto-trigger')
            }
          } catch (triggerErr) {
            app.log.error({ err: triggerErr }, '[monday-webhook] auto-trigger failed (non-fatal)')
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        dbg(`ERROR: ${errMsg}`)
        app.log.error({ err }, '[monday-webhook] Box folder creation failed')
      }
    }

    return reply.send({ ok: true, debug: debugLog })
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
