import type { FastifyInstance } from 'fastify'

const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token'
const BOX_API_URL   = 'https://api.box.com/2.0'

function boxConfigured() {
  return !!(process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET && process.env.BOX_ENTERPRISE_ID)
}

async function fetchCCGToken(): Promise<string> {
  if (!boxConfigured()) throw new Error('Box not configured — set BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_ENTERPRISE_ID')

  const res = await fetch(BOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:       'client_credentials',
      client_id:        process.env.BOX_CLIENT_ID!,
      client_secret:    process.env.BOX_CLIENT_SECRET!,
      box_subject_type: 'enterprise',
      box_subject_id:   process.env.BOX_ENTERPRISE_ID!,
    }),
  })

  if (!res.ok) throw new Error(`Box CCG token error: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string }
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

// ── Token getter (exported for webhook handler) ────────────────────────────────
// agencyId param kept for API compatibility — CCG uses service account, not per-agency tokens
export async function getBoxToken(_agencyId: string): Promise<string> {
  return fetchCCGToken()
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

  // ── GET /status ───────────────────────────────────────────────────────────────
  app.get('/status', async (_req, reply) => {
    return reply.send({ data: { connected: boxConfigured() } })
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
    const { agencyId } = req.auth
    const token        = await getBoxToken(agencyId)
    const { id }       = req.params
    const folder       = await boxApi<{ id: string; name: string; item_count: number }>(token, `/folders/${id}`)
    return reply.send({ data: folder })
  })
}
