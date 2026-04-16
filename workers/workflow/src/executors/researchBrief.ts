import { prisma } from '@contentnode/database'
import { callModel, type ModelConfig } from '@contentnode/ai'

export interface ResearchBriefConfig {
  prompt: string
  recencyDays?: number        // 7 | 14 | 30 | 90 — default 7
  synthesisFormat?: string    // custom output template; falls back to DEFAULT_FORMAT
  apiKeyRef?: string          // env var name; defaults to TAVILY_API_KEY
}

interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
  published_date?: string
}

interface TavilyResponse {
  results?: TavilyResult[]
  answer?: string
}

const DEFAULT_FORMAT = `Summarize your findings in this format:

1. Top news item (1-2 sentences, include source and date)
2. Emerging risk (specific compliance gap, legal exposure, or timeline pressure)
3. Emerging trend (behavior shift among relevant organizations)
4. Analyst perspective (key claim from a research firm, with source)
5. One strategic question this raises
6. Sources — list every source cited above with the article title, publication name, URL, and publish date.`

const SYNTHESIS_MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.3,
  max_tokens: 2048,
}

function monthBucket(): { periodStart: Date; periodEnd: Date } {
  const now = new Date()
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  }
}

export async function runResearchBrief(
  config: ResearchBriefConfig,
  agencyId: string,
  clientId: string | null,
  scheduledTaskId: string,
): Promise<string> {
  const { prompt, recencyDays = 7, synthesisFormat, apiKeyRef = 'TAVILY_API_KEY' } = config

  if (!prompt?.trim()) throw new Error('Research Brief: prompt is required')

  // ── 1. Resolve Tavily API key ──────────────────────────────────────────────
  const tavilyKey = process.env[apiKeyRef]
  if (!tavilyKey) throw new Error(`Research Brief: env var ${apiKeyRef} is not set`)

  // ── 2. Call Tavily Search API ──────────────────────────────────────────────
  const tavilyRes = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: prompt,
      search_depth: 'advanced',
      max_results: 10,
      days: recencyDays,
      include_answer: false,
    }),
  })

  if (!tavilyRes.ok) {
    const body = await tavilyRes.text()
    throw new Error(`Tavily API error ${tavilyRes.status}: ${body}`)
  }

  const tavilyData: TavilyResponse = await tavilyRes.json()
  const results = tavilyData.results ?? []

  // ── 3. Track Tavily search usage per client ────────────────────────────────
  const { periodStart, periodEnd } = monthBucket()
  await prisma.usageRecord.create({
    data: {
      agencyId,
      clientId: clientId ?? undefined,
      scheduledTaskId,
      metric: 'research_brief_searches',
      quantity: 1,
      periodStart,
      periodEnd,
      metadata: {
        searchCount: 1,
        resultsReturned: results.length,
        recencyDays,
        query: prompt.slice(0, 200),
      },
    },
  }).catch(() => {}) // non-blocking

  if (results.length === 0) {
    return `No results found for the given query in the last ${recencyDays} days.\n\nQuery: ${prompt}`
  }

  // ── 4. Build context string for Claude ────────────────────────────────────
  const context = results
    .map((r, i) =>
      `[Source ${i + 1}]\nTitle: ${r.title}\nURL: ${r.url}\nPublished: ${r.published_date ?? 'date unknown'}\n\n${r.content.slice(0, 1500)}`,
    )
    .join('\n\n---\n\n')

  const outputFormat = synthesisFormat?.trim() || DEFAULT_FORMAT

  const systemPrompt = `You are an expert research analyst. You have been given web search results for the following research query:\n\n"${prompt}"\n\nUsing ONLY the sources provided, produce a structured research brief. Do not invent facts. Cite sources by their URL.\n\n${outputFormat}`

  // ── 5. Synthesize with Claude ──────────────────────────────────────────────
  const raw = await callModel(SYNTHESIS_MODEL, `${systemPrompt}\n\n---\n\nSEARCH RESULTS:\n\n${context}`)
  const brief = (typeof raw === 'string' ? raw : (raw as { text?: string }).text ?? JSON.stringify(raw)).trim()

  // ── 6. Track Claude token usage per client ────────────────────────────────
  const tokenEstimate = Math.ceil((systemPrompt.length + context.length + brief.length) / 4)
  await prisma.usageRecord.create({
    data: {
      agencyId,
      clientId: clientId ?? undefined,
      scheduledTaskId,
      metric: 'ai_tokens',
      quantity: tokenEstimate,
      periodStart,
      periodEnd,
      metadata: {
        provider: 'anthropic',
        model: SYNTHESIS_MODEL.model,
        source: 'research_brief',
      },
    },
  }).catch(() => {})

  return brief
}
