import { callModel, type ModelConfig } from '@contentnode/ai'
import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import { fetchPage as sharedFetchPage, truncateWords } from '../lib/scraper.js'

const MAX_PAGE_WORDS = 2000
const TIMEOUT_MS = 15_000
const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.2,
  max_tokens: 4096,
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML utilities
// ─────────────────────────────────────────────────────────────────────────────

function extractLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const links: string[] = []
  const hrefRe = /href=["']([^"'#?][^"']*?)["']/gi
  let m: RegExpExecArray | null
  while ((m = hrefRe.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href
      // Stay on same origin by default
      if (new URL(abs).origin === base.origin) {
        links.push(abs)
      }
    } catch {
      // skip malformed
    }
  }
  return [...new Set(links)]
}


// ─────────────────────────────────────────────────────────────────────────────
// Synthesis target prompts
// ─────────────────────────────────────────────────────────────────────────────

const SYNTHESIS_PROMPTS: Record<string, string> = {
  summary: `You are a research analyst. Synthesize the following multi-page web crawl into a concise, well-structured summary that captures the key ideas, themes, and facts. Use markdown headings. Be thorough but eliminate redundancy.`,
  dg_s7: `You are a demand generation strategist. Extract and synthesize "External Intelligence" from the following web crawl. Focus on:
- Market trends and signals relevant to this space
- Competitor positioning and gaps
- Industry pain points and buyer language
- Content themes that appear across multiple sources
- Quantitative data points (stats, percentages, market sizes)
Format as a demand gen intelligence brief under the heading "S7: External Intelligence".`,
  gtm_12: `You are a competitive intelligence analyst. Extract "Competitive Differentiation" insights from the following web crawl. Focus on:
- How competitors position themselves
- Messaging themes and value propositions used in this space
- Gaps and white space opportunities
- Pricing signals and market positioning
Format as a GTM competitive analysis under "§12: Competitive Differentiation".`,
  raw: `Concatenate and lightly clean the following content from multiple web pages. Preserve structure and key details. Remove navigation menus, repeated headers/footers, and cookie notices.`,
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class DeepWebScrapeExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const seedUrls = ((config.seedUrls as string | undefined) ?? '')
      .split('\n').map((u) => u.trim()).filter(Boolean)
    const maxPages = Math.min(20, Math.max(1, (config.maxPages as number) ?? 10))
    const linkPattern = (config.linkPattern as string | undefined) ?? ''
    const stayOnDomain = (config.stayOnDomain as boolean) ?? true
    const synthesisTarget = (config.synthesisTarget as string) ?? 'summary'
    const synthesisInstructions = (config.synthesisInstructions as string | undefined) ?? ''

    if (seedUrls.length === 0) throw new Error('Deep Web Scrape: at least one seed URL is required')

    const linkFilter = linkPattern ? new RegExp(linkPattern, 'i') : null

    // ── BFS crawl ────────────────────────────────────────────────────────────
    const visited = new Set<string>()
    const queue: string[] = [...seedUrls.slice(0, 3)]
    const pages: Array<{ url: string; text: string }> = []
    const scrapeUsage: Record<string, number> = {}

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)

      const result = await sharedFetchPage(url)
      if (!result) continue

      // Track usage per page scraped
      scrapeUsage[result.source] = (scrapeUsage[result.source] ?? 0) + 1

      const truncated = truncateWords(result.text, MAX_PAGE_WORDS)
      if (truncated.length > 50) {
        pages.push({ url, text: truncated })
      }

      // Extract links from this page (need raw HTML for link extraction — raw fetch for links only)
      if (pages.length < maxPages) {
        const rawForLinks = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentNode/1.0)' }, signal: AbortSignal.timeout(TIMEOUT_MS) }).then(r => r.text()).catch(() => '')
        const links = extractLinks(rawForLinks, url)
        for (const link of links) {
          if (visited.has(link)) continue
          if (linkFilter && !linkFilter.test(link)) continue
          if (!stayOnDomain) {
            queue.push(link)
          } else {
            // stayOnDomain is enforced in extractLinks — but double-check here
            queue.push(link)
          }
        }
      }
    }

    if (pages.length === 0) throw new Error('Deep Web Scrape: no readable content found at provided URL(s)')

    // ── Record scrape usage ───────────────────────────────────────────────────
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    await Promise.all(
      Object.entries(scrapeUsage).map(([source, count]) =>
        withAgency(ctx.agencyId, () =>
          prisma.usageRecord.create({
            data: {
              agencyId: ctx.agencyId,
              metric: 'scrape_pages',
              quantity: count,
              periodStart,
              periodEnd,
              metadata: { source, workflowRunId: ctx.runId } as Record<string, unknown>,
            },
          })
        ).catch(() => { /* non-fatal */ })
      )
    )

    // ── Assemble raw content ─────────────────────────────────────────────────
    const rawContent = pages
      .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.text}`)
      .join('\n\n')

    // ── Synthesize with Claude ───────────────────────────────────────────────
    const systemPrompt = SYNTHESIS_PROMPTS[synthesisTarget] ?? SYNTHESIS_PROMPTS.summary
    const userPrompt = synthesisInstructions
      ? `${synthesisInstructions}\n\n${rawContent}`
      : rawContent

    const result = await callModel({ ...MODEL }, `${systemPrompt}\n\n${userPrompt}`)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed: result.model_used,
    }
  }
}
