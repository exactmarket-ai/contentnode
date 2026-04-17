import { callModel, type ModelConfig } from '@contentnode/ai'
import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import { fetchPage as sharedFetchPage, stripHtml } from '../lib/scraper.js'

const TIMEOUT_MS = 15_000
const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.2,
  max_tokens: 4096,
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform scrapers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<{ text: string; source: string } | null> {
  const result = await sharedFetchPage(url)
  return result ? { text: result.text, source: result.source } : null
}

/** Extract review text blocks from Trustpilot HTML (server-rendered) */
function parseTrustpilotReviews(html: string, max: number): string[] {
  const reviews: string[] = []
  // Look for data-service-review patterns
  const reviewPattern = /<p[^>]+data-service-review[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = reviewPattern.exec(html)) !== null && reviews.length < max) {
    const text = stripHtml(m[1]).trim()
    if (text.length > 30) reviews.push(text)
  }
  // Fallback: grab text from review card sections
  if (reviews.length === 0) {
    const cardPattern = /<section[^>]+class="[^"]*review[^"]*"[^>]*>([\s\S]*?)<\/section>/gi
    while ((m = cardPattern.exec(html)) !== null && reviews.length < max) {
      const text = stripHtml(m[1]).trim()
      if (text.length > 50) reviews.push(text.slice(0, 500))
    }
  }
  return reviews
}

/** Attempt to scrape a review platform page */
async function scrapeReviewPage(
  platform: string,
  slug: string,
  isCompetitor: boolean,
  maxReviews: number,
): Promise<{ platform: string; company: string; reviews: string[]; url: string }> {
  const label = isCompetitor ? `${slug} (competitor)` : slug

  let url = ''
  let reviews: string[] = []

  let scrapeSource: string = 'raw'

  if (platform === 'trustpilot') {
    url = `https://www.trustpilot.com/review/${slug}`
    const result = await fetchHtml(url)
    if (result) {
      scrapeSource = result.source
      reviews = parseTrustpilotReviews(result.text, maxReviews)
      if (reviews.length === 0) {
        const paras = result.text.split('\n').filter((l) => l.length > 60 && l.length < 600)
        reviews = paras.slice(0, maxReviews)
      }
    }
  } else if (platform === 'g2') {
    url = `https://www.g2.com/products/${slug}/reviews`
    const result = await fetchHtml(url)
    if (result) {
      scrapeSource = result.source
      const paras = result.text.split('\n').filter((l) => l.length > 80 && l.length < 800)
      reviews = paras.slice(0, maxReviews)
    }
  } else if (platform === 'capterra') {
    url = `https://www.capterra.com/reviews/${slug}`
    const result = await fetchHtml(url)
    if (result) {
      scrapeSource = result.source
      const paras = result.text.split('\n').filter((l) => l.length > 80 && l.length < 800)
      reviews = paras.slice(0, maxReviews)
    }
  } else if (platform === 'custom_url') {
    url = slug
    const result = await fetchHtml(url)
    if (result) {
      scrapeSource = result.source
      const paras = result.text.split('\n').filter((l) => l.length > 60 && l.length < 800)
      reviews = paras.slice(0, maxReviews)
    }
  }

  return { platform, company: label, reviews, url, scrapeSource }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis prompts
// ─────────────────────────────────────────────────────────────────────────────

const SYNTHESIS_PROMPTS: Record<string, string> = {
  themes: `You are a market research analyst. Analyze the following review data and extract:
1. **Top 5 positive themes** — what customers love most
2. **Top 5 pain points** — recurring complaints or gaps
3. **Contradictions** — areas where customers disagree or expectations vary
4. **Buyer language** — exact phrases and vocabulary customers use (for messaging)
5. **Competitor gaps** — where competitors fall short vs. the target company
Format as a structured intelligence brief with clear headings.`,

  battlecard: `You are a competitive intelligence analyst. Using this review data, build a competitive battlecard:
**[Company] vs Competitors**
For each section: direct quotes where possible, then strategic insight.
1. **Our Strengths** (from target company reviews)
2. **Competitor Weaknesses** (from competitor reviews)
3. **Objection Handlers** (common objections + how to counter)
4. **Proof Points** (specific metrics or outcomes mentioned in reviews)
5. **Messaging Opportunities** (gaps in competitor messaging we can own)`,

  objections: `You are a sales enablement strategist. Extract and organize sales objections from these reviews:
For each objection:
- The objection (exact customer language where possible)
- How frequently it appears
- Suggested counter-response based on what delighted customers say
Group by: Price/ROI objections, Feature/capability objections, Implementation/support objections, Trust/credibility objections.`,

  testimonials: `You are a copywriter. Extract the best testimonial material from these reviews:
1. **Hero quotes** — powerful, specific, outcome-focused statements (5-10)
2. **Social proof stats** — any specific numbers, percentages, time saved mentioned
3. **Use-case spotlights** — specific problems solved with enough detail to be compelling
4. **Trust signals** — mentions of reliability, support quality, team responsiveness
Format for direct use in marketing copy. Include the source platform for each.`,

  all: `You are a market intelligence analyst. Provide a comprehensive review analysis including:
1. **Summary** — overall sentiment and volume context
2. **Key themes** — top praise and pain points
3. **Competitive landscape** — how the target compares to competitors in reviews
4. **Buyer language** — exact vocabulary and phrases to use in messaging
5. **Objection map** — common objections and counter-narratives
6. **Testimonial highlights** — best quotes for marketing use
7. **Strategic recommendations** — 3-5 actionable insights from this review data`,
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class ReviewMinerExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const companyName = (config.companyName as string | undefined)?.trim() ?? ''
    const companySlug = (config.companySlug as string | undefined)?.trim() || companyName
    const platforms = (config.platforms as string[]) ?? ['trustpilot']
    const competitors = ((config.competitors as string | undefined) ?? '')
      .split('\n').map((s) => s.trim()).filter(Boolean)
    const maxReviews = Math.min(50, Math.max(5, (config.maxReviewsPerSource as number) ?? 20))
    const synthesisType = (config.synthesisType as string) ?? 'themes'

    if (!companySlug) throw new Error('Review Miner: company name is required')

    // ── Scrape all sources in parallel ───────────────────────────────────────
    const scrapeJobs: Array<Promise<{ platform: string; company: string; reviews: string[]; url: string; scrapeSource: string }>> = []

    for (const platform of platforms) {
      scrapeJobs.push(scrapeReviewPage(platform, companySlug, false, maxReviews))
    }
    for (const comp of competitors) {
      for (const platform of platforms) {
        scrapeJobs.push(scrapeReviewPage(platform, comp, true, maxReviews))
      }
    }

    const results = await Promise.all(scrapeJobs)

    // ── Record scrape usage ───────────────────────────────────────────────────
    const usageBySrc: Record<string, number> = {}
    for (const r of results) {
      usageBySrc[r.scrapeSource] = (usageBySrc[r.scrapeSource] ?? 0) + 1
    }
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    await Promise.all(
      Object.entries(usageBySrc).map(([source, count]) =>
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

    // ── Format raw data ──────────────────────────────────────────────────────
    const sections: string[] = []
    let totalReviews = 0

    for (const r of results) {
      if (r.reviews.length === 0) {
        sections.push(`## ${r.platform.toUpperCase()} — ${r.company}\nSource: ${r.url}\n(No reviews extracted — site may require JS rendering or block automated access)`)
      } else {
        totalReviews += r.reviews.length
        const reviewText = r.reviews.map((rev, i) => `${i + 1}. ${rev}`).join('\n')
        sections.push(`## ${r.platform.toUpperCase()} — ${r.company}\nSource: ${r.url}\n${reviewText}`)
      }
    }

    // Non-fatal: review sites often require JS rendering — return a notice so
    // downstream synthesis nodes can still run using web scrape + client brain data.
    const rawData = totalReviews === 0
      ? `# Review Mining: ${companyName}\n\nNo reviews could be extracted from the configured platform(s). Review sites (Trustpilot, G2, Capterra) typically require JavaScript rendering which is not supported by this node.\n\nRecommendation: open the Review Miner node, switch the platform to "custom_url", and paste a direct URL to a publicly-accessible review page — or add a Text Input node and paste reviews manually.\n\n${sections.join('\n\n')}`
      : `# Review Mining: ${companyName}\nPlatforms: ${platforms.join(', ')}\n\n${sections.join('\n\n')}`

    // ── Synthesize ───────────────────────────────────────────────────────────
    const systemPrompt = SYNTHESIS_PROMPTS[synthesisType] ?? SYNTHESIS_PROMPTS.themes
    const result = await callModel({ ...MODEL }, `${systemPrompt}\n\n${rawData}`)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed: result.model_used,
    }
  }
}
