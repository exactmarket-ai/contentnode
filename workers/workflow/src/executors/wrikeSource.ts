import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const WRIKE_TOKEN_URL = 'https://login.wrike.com/oauth2/token'

interface WrikeTask {
  id: string
  title: string
  description?: string
  briefDescription?: string
  completedDate?: string
  status: string
  customFields?: { id: string; value: string }[]
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function getWrikeToken(agencyId: string): Promise<{ accessToken: string; host: string }> {
  const integration = await prisma.integration.findUnique({
    where: { agencyId_provider: { agencyId, provider: 'wrike' } },
  })
  if (!integration) throw new Error('Wrike is not connected. Go to Settings → Integrations to connect.')

  const meta = (integration.metadata ?? {}) as Record<string, string>
  const host = meta.host ?? 'www.wrike.com'

  if (integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { accessToken: integration.accessToken, host }
  }

  if (!integration.refreshToken) throw new Error('Wrike refresh token missing — please reconnect in Settings.')

  const res = await fetchWithTimeout(WRIKE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.WRIKE_CLIENT_ID     ?? '',
      client_secret: process.env.WRIKE_CLIENT_SECRET ?? '',
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
      metadata:     { ...meta, host: data.host ?? host },
    },
  })

  return { accessToken: data.access_token, host: data.host ?? host }
}

export class WrikeSourceExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const { agencyId } = ctx
    const daysBack  = Number(config.days_back ?? 14)
    const synthesis = (config.synthesis ?? 'summary') as string
    const modelConfig = ctx.defaultModelConfig

    console.log(`[wrike] fetching token for agency ${agencyId}`)
    const { accessToken, host } = await getWrikeToken(agencyId)
    console.log(`[wrike] token ok, host=${host}, fetching completed tasks updated in last ${daysBack} days`)

    const end   = new Date()
    const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000)

    const updatedDate = JSON.stringify({
      start: start.toISOString().split('.')[0] + 'Z',
      end:   end.toISOString().split('.')[0] + 'Z',
    })

    const url = new URL(`https://${host}/api/v4/tasks`)
    url.searchParams.set('status',      'Completed')
    url.searchParams.set('updatedDate', updatedDate)
    url.searchParams.set('fields',      JSON.stringify(['description', 'briefDescription', 'parentIds']))
    url.searchParams.set('pageSize',    '100')

    const res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`Wrike API error: ${res.status} ${await res.text()}`)

    const data = await res.json() as { data: WrikeTask[] }
    const tasks = data.data ?? []
    console.log(`[wrike] got ${tasks.length} tasks, synthesis=${synthesis}`)

    if (tasks.length === 0) {
      return { output: `No completed Wrike tasks found in the last ${daysBack} days.` }
    }

    if (synthesis === 'raw') {
      return { output: JSON.stringify(tasks, null, 2) }
    }

    const taskList = tasks
      .map((t) => `- ${t.title}${t.briefDescription ? `: ${t.briefDescription}` : ''}`)
      .join('\n')

    const systemPrompt = synthesis === 'structured'
      ? 'You are a project analyst. Convert this list of completed Wrike tasks into a structured report with categories, key achievements, and metrics where possible.'
      : 'You are a communications specialist. Summarize these completed Wrike tasks into a concise narrative suitable for an internal campaign or announcement. Highlight wins and team impact.'

    console.log(`[wrike] calling Claude to synthesize ${tasks.length} tasks`)
    const result = await callModel(modelConfig, {
      system: systemPrompt,
      prompt: `Completed tasks from the last ${daysBack} days:\n\n${taskList}`,
    })
    console.log(`[wrike] synthesis complete`)

    return {
      output: result.content,
      metadata: { taskCount: tasks.length, daysBack, synthesis },
    }
  }
}
