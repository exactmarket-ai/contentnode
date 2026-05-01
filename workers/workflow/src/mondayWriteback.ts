/**
 * mondayWriteback — writes file URLs and status values back to Monday.com
 * after Box delivery completes. Called from the runner's Box delivery block.
 */

import { prisma } from '@contentnode/database'
import { safeDecrypt } from './lib/crypto.js'

const MONDAY_API_URL = 'https://api.monday.com/v2'

export async function getMondayToken(agencyId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'monday' } },
  })
  if (!integration) return process.env.MONDAY_API_TOKEN ?? null
  const token = safeDecrypt(integration.accessToken) ?? integration.accessToken
  return token || (process.env.MONDAY_API_TOKEN ?? null)
}

export async function mondayGql<T = unknown>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Monday API ${res.status}: ${await res.text()}`)
  const body = await res.json() as { data?: T; errors?: unknown[] }
  if (body.errors?.length) throw new Error(`Monday GraphQL: ${JSON.stringify(body.errors)}`)
  return body.data as T
}

// ── Column cache (per-invocation, cleared per job) ────────────────────────────
const boardColumnCache = new Map<string, Array<{ id: string; title: string; type: string }>>()

async function getBoardColumns(
  token: string,
  boardId: string,
): Promise<Array<{ id: string; title: string; type: string }>> {
  if (boardColumnCache.has(boardId)) return boardColumnCache.get(boardId)!
  const data = await mondayGql<{ boards: { columns: { id: string; title: string; type: string }[] }[] }>(
    token,
    `query($id: [ID!]) { boards(ids: $id) { columns { id title type } } }`,
    { id: [boardId] },
  )
  const cols = data.boards?.[0]?.columns ?? []
  boardColumnCache.set(boardId, cols)
  return cols
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function writeFileUrlToMonday(params: {
  agencyId:    string
  boardId:     string
  itemId:      string
  columnTitle: string   // matched case-insensitively
  url:         string
  urlText?:    string
}): Promise<void> {
  const { agencyId, boardId, itemId, columnTitle, url, urlText } = params
  const token = await getMondayToken(agencyId)
  if (!token) {
    console.warn('[mondayWriteback] no Monday token — skipping URL writeback')
    return
  }

  const cols = await getBoardColumns(token, boardId)
  const col = cols.find((c) => c.title.toLowerCase() === columnTitle.toLowerCase())
  if (!col) {
    console.warn(`[mondayWriteback] column "${columnTitle}" not found on board ${boardId}`)
    return
  }

  // Link columns expect { url, text }; text columns accept a plain string
  const value = col.type === 'link'
    ? JSON.stringify({ url, text: urlText ?? 'Open in Box' })
    : JSON.stringify(url)

  await mondayGql(token, `
    mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `, { boardId, itemId, columnId: col.id, value })

  console.log(`[mondayWriteback] wrote URL to column "${col.title}" on item ${itemId}`)
}

export async function setMondayStatus(params: {
  agencyId:    string
  boardId:     string
  itemId:      string
  columnTitle: string   // matched case-insensitively
  label:       string   // status label text (e.g. "Ready for Review")
}): Promise<void> {
  const { agencyId, boardId, itemId, columnTitle, label } = params
  const token = await getMondayToken(agencyId)
  if (!token) return

  const cols = await getBoardColumns(token, boardId)
  const col = cols.find((c) => c.title.toLowerCase() === columnTitle.toLowerCase())
  if (!col) {
    console.warn(`[mondayWriteback] status column "${columnTitle}" not found on board ${boardId}`)
    return
  }

  await mondayGql(token, `
    mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `, { boardId, itemId, columnId: col.id, value: JSON.stringify({ label }) })

  console.log(`[mondayWriteback] set status "${label}" on column "${col.title}" for item ${itemId}`)
}

/** Clear per-job cache so stale column data doesn't bleed between runs */
export function clearMondayCache(): void {
  boardColumnCache.clear()
}
