/**
 * scraper.ts — unified page fetcher for the workflow worker (Railway worker)
 *
 * Priority:
 *  1. Firecrawl  — if FIRECRAWL_API_KEY is set (best quality, handles JS)
 *  2. Jina Reader — free, handles JS, no key required
 *  3. Raw fetch   — plain HTML + regex strip (fallback)
 *
 * Returns { text, source } so callers can log usage.
 */

export type ScrapeSource = 'firecrawl' | 'jina' | 'raw'

export interface ScrapeResult {
  text: string
  source: ScrapeSource
}

const TIMEOUT_MS    = 20_000
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY

// Block requests to private/internal IP ranges (SSRF protection)
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|0:0:0:0:0:0:0:1)$/i
const PRIVATE_CIDR = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|fc[0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i

function assertPublicUrl(raw: string): void {
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error(`Invalid URL: ${raw}`) }
  const h = parsed.hostname
  if (PRIVATE_HOST.test(h) || PRIVATE_CIDR.test(h)) {
    throw new Error(`SSRF blocked: private/internal URL not permitted (${h})`)
  }
}
const JINA_KEY      = process.env.JINA_API_KEY   // optional — raises Jina rate limit
const USER_AGENT    = 'Mozilla/5.0 (compatible; ContentNode/1.0; +https://contentnode.ai)'

// ── HTML → plain text ─────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Firecrawl ─────────────────────────────────────────────────────────────────

async function fetchViaFirecrawl(url: string): Promise<string | null> {
  if (!FIRECRAWL_KEY) return null
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json() as { success?: boolean; data?: { markdown?: string } }
    return data?.data?.markdown ?? null
  } catch {
    return null
  }
}

// ── Jina Reader ───────────────────────────────────────────────────────────────

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    }
    if (JINA_KEY) headers['Authorization'] = `Bearer ${JINA_KEY}`

    const res = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json() as { code?: number; data?: { content?: string } }
    return data?.data?.content ?? null
  } catch {
    return null
  }
}

// ── Raw fetch ─────────────────────────────────────────────────────────────────

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = await res.text()
    return stripHtml(html)
  } catch {
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchPage(url: string): Promise<ScrapeResult | null> {
  assertPublicUrl(url) // throws for private/internal IPs
  // 1. Firecrawl
  const fc = await fetchViaFirecrawl(url)
  if (fc && fc.length > 100) return { text: fc, source: 'firecrawl' }

  // 2. Jina
  const jina = await fetchViaJina(url)
  if (jina && jina.length > 100) return { text: jina, source: 'jina' }

  // 3. Raw
  const raw = await fetchRaw(url)
  if (raw && raw.length > 50) return { text: raw, source: 'raw' }

  return null
}

/** Truncate to a word limit */
export function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ') + '…'
}
