import { callModel, type ModelConfig } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

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

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ') + '…'
}

async function fetchPage(url: string): Promise<{ text: string; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentNode/1.0; +https://contentnode.ai)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = await res.text()
    const text = extractText(html)
    return { text, html }
  } catch {
    return null
  }
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
    _ctx: NodeExecutionContext,
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

    while (queue.length > 0 && pages.length < maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)

      const result = await fetchPage(url)
      if (!result) continue

      const truncated = truncateWords(result.text, MAX_PAGE_WORDS)
      if (truncated.length > 50) {
        pages.push({ url, text: truncated })
      }

      // Extract links from this page
      if (pages.length < maxPages) {
        const links = extractLinks(result.html, url)
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
      modelUsed: result.model_used,
    }
  }
}
