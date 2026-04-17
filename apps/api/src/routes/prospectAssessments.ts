/**
 * prospectAssessments.ts
 *
 * CRUD + intelligence actions for /api/v1/prospect-assessments
 * Agency-scoped — no client attachment. Owner/admin only.
 *
 * Routes:
 *   GET    /                              — list
 *   POST   /                              — create
 *   GET    /:id                           — get one
 *   PATCH  /:id                           — update
 *   DELETE /:id                           — delete
 *   POST   /:id/run-research              — crawl → findings (+ autoScore=true for quick)
 *   POST   /:id/generate-service-map      — agency brain + scores → service map
 *   POST   /:id/generate-exec-presentation — fill exec deck template with prospect data
 *   POST   /:id/download/service-map      — download service map as .docx
 *   POST   /:id/download/exec-presentation — download exec presentation as .docx
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma }               from '@contentnode/database'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  BorderStyle, AlignmentType,
} from 'docx'
import { fetchPage as sharedFetchPage, truncateWords } from '../lib/scraper.js'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBody = z.object({
  name:     z.string().min(1).max(300),
  url:      z.string().max(500).optional().nullable(),
  industry: z.string().max(200).optional().nullable(),
  source:   z.enum(['manual', 'quick']).optional().default('manual'),
})

const updateBody = z.object({
  name:        z.string().min(1).max(300).optional(),
  url:         z.string().max(500).optional().nullable(),
  industry:    z.string().max(200).optional().nullable(),
  status:      z.enum(['not_started', 'researching', 'scoring', 'complete', 'archived']).optional(),
  scores:      z.record(z.number().min(0).max(5)).optional().nullable(),
  findings:    z.record(z.string()).optional().nullable(),
  notes:       z.string().optional().nullable(),
  totalScore:  z.number().min(0).max(5).optional().nullable(),
})

// ─── Weighted score calculator ────────────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  website_messaging:     0.20,
  social_outbound:       0.10,
  positioning_segment:   0.20,
  analyst_context:       0.15,
  competitive_landscape: 0.15,
  growth_signals:        0.20,
}

function calcTotalScore(scores: Record<string, number>): number {
  let total = 0
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (scores[key] != null) total += scores[key] * weight
  }
  return Math.round(total * 10) / 10
}

// ─── Web scraping utilities ───────────────────────────────────────────────────

const SCRAPE_TIMEOUT_MS  = 10_000
const MAX_PAGE_WORDS     = 1800
const MAX_CRAWL_PAGES    = 6   // fewer pages but fetched in parallel — keeps total crawl time ≤ ~10s
const CRAWL_CONCURRENCY  = 6   // all candidate pages fetched simultaneously

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
      if (new URL(abs).origin === base.origin) links.push(abs)
    } catch { /* skip */ }
  }
  return [...new Set(links)]
}


// Priority URL path fragments — fetch these sub-pages if found on the site
const PRIORITY_PATHS = [
  '/about', '/about-us',
  '/solutions', '/services', '/platform', '/product', '/products',
  '/case-studies', '/customers', '/clients',
  '/blog', '/resources', '/insights',
]

async function crawlProspect(seedUrl: string): Promise<{ pages: Array<{ url: string; text: string }>; usage: Record<string, number> }> {
  const usage: Record<string, number> = {}

  // Step 1: fetch homepage (also used to extract links for sub-page discovery)
  const home = await sharedFetchPage(seedUrl)
  if (!home) return { pages: [], usage }
  usage[home.source] = (usage[home.source] ?? 0) + 1

  // For link extraction we still need raw HTML — do a lightweight raw fetch in parallel
  const rawHomeHtml = await fetch(seedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentNode/1.0; +https://contentnode.ai)' },
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
  }).then((r) => r.text()).catch(() => '')

  const pages: Array<{ url: string; text: string }> = []
  const homeTruncated = truncateWords(home.text, MAX_PAGE_WORDS)
  if (homeTruncated.length > 50) pages.push({ url: seedUrl, text: homeTruncated })

  // Step 2: build candidate list — priority paths first, then other discovered links
  const allLinks     = extractLinks(rawHomeHtml, seedUrl)
  const base         = new URL(seedUrl).origin
  const priorityUrls = PRIORITY_PATHS
    .map((p) => `${base}${p}`)
    .filter((u) => allLinks.some((l) => l.startsWith(u)))

  const candidates = [
    ...priorityUrls,
    ...allLinks.filter((l) => !priorityUrls.includes(l) && l !== seedUrl),
  ].slice(0, CRAWL_CONCURRENCY * 2)

  // Step 3: fetch all candidates in parallel
  const results = await Promise.allSettled(
    candidates.map((url) => sharedFetchPage(url).then((r) => (r ? { url, ...r } : null)))
  )

  for (const r of results) {
    if (pages.length >= MAX_CRAWL_PAGES) break
    if (r.status !== 'fulfilled' || !r.value) continue
    usage[r.value.source] = (usage[r.value.source] ?? 0) + 1
    const t = truncateWords(r.value.text, MAX_PAGE_WORDS)
    if (t.length > 50) pages.push({ url: r.value.url, text: t })
  }

  return { pages, usage }
}

// ─── Research findings generator ─────────────────────────────────────────────

const DIMENSION_RESEARCH_PROMPT = `You are a market research analyst conducting a competitive positioning assessment.

Given the scraped website content below, write research findings for EACH of the 6 assessment dimensions.

Return ONLY a valid JSON object with exactly these keys:
{
  "website_messaging": "...",
  "social_outbound": "...",
  "positioning_segment": "...",
  "analyst_context": "...",
  "competitive_landscape": "...",
  "growth_signals": "..."
}

Each value: 3-5 sentences of specific, evidence-based findings referencing what you actually observed on the site. If the scraped content doesn't contain enough signal for a dimension (e.g. social_outbound or analyst_context), state what's visible and what's missing.

DIMENSION GUIDANCE:
- website_messaging: Homepage headline, value prop clarity, CTA quality, solution pages, case studies, blog quality
- social_outbound: LinkedIn presence signals (mentions, embedded posts), thought leadership cues, executive voice
- positioning_segment: Who they claim to serve vs. actual messaging focus, ICP consistency, pricing signals
- analyst_context: Market category language, analyst/award mentions, industry positioning claims
- competitive_landscape: Competitor mentions, alternative positioning, differentiation claims, G2/review signals
- growth_signals: Untapped use cases, adjacent segments they touch, whitespace in messaging, expansion signals`

async function generateFindings(
  pages: Array<{ url: string; text: string }>,
  prospectName: string,
  prospectUrl: string,
): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const rawContent = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.text}`)
    .join('\n\n')

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 3000,
    system:     DIMENSION_RESEARCH_PROMPT,
    messages:   [{
      role:    'user',
      content: `Prospect: ${prospectName}\nWebsite: ${prospectUrl}\n\nSCRAPED CONTENT:\n\n${rawContent}`,
    }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Extract JSON from response (Claude sometimes wraps in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not parse findings from AI response')

  const findings = JSON.parse(jsonMatch[0]) as Record<string, string>
  return findings
}

// ─── Quick assessment: combined findings + scores in one pass ─────────────────

const QUICK_ASSESS_PROMPT = `You are a senior market research analyst and competitive positioning expert.

Given the scraped website content below, analyse the prospect across all 6 dimensions and produce BOTH findings AND a maturity score (1–5) for each dimension.

Return ONLY a valid JSON object with exactly these keys:
{
  "website_messaging":     { "score": <1-5>, "findings": "..." },
  "social_outbound":       { "score": <1-5>, "findings": "..." },
  "positioning_segment":   { "score": <1-5>, "findings": "..." },
  "analyst_context":       { "score": <1-5>, "findings": "..." },
  "competitive_landscape": { "score": <1-5>, "findings": "..." },
  "growth_signals":        { "score": <1-5>, "findings": "..." }
}

SCORING GUIDE (use integer 1–5):
- 1: Absent, generic, or completely undifferentiated
- 2: Minimal or inconsistent — signals exist but weak
- 3: Present but undifferentiated — clear but not compelling
- 4: Above average — specific, differentiated, mostly consistent
- 5: Best-in-class — sharp, evidence-rich, fully differentiated

DIMENSION GUIDANCE:
- website_messaging: Homepage headline specificity, value prop clarity, CTA quality, solution/use-case pages, case studies with real outcomes, blog thought leadership
- social_outbound: LinkedIn page activity signals (embedded feeds, share widgets), executive voice cues, content POV, ad/event mentions
- positioning_segment: ICP clarity, segment consistency (enterprise/mid-market/SMB), vertical depth, buyer persona alignment, pricing signals
- analyst_context: Market category language, analyst/award mentions, industry category ownership, regulatory or trend awareness
- competitive_landscape: Competitor mentions or differentiation claims, alternative positioning language, win themes, G2/review or testimonial signals
- growth_signals: Untapped use cases, adjacent segments they touch, content whitespace, expansion-ready language, partner/channel signals

FINDINGS: 3-5 sentences per dimension. Be specific — cite actual content, headlines, page structures, or signals you observed. If a dimension has limited signal in the scraped content, state what's visible and note what's missing.`

async function generateFindingsAndScores(
  pages: Array<{ url: string; text: string }>,
  prospectName: string,
  prospectUrl: string,
): Promise<{ findings: Record<string, string>; scores: Record<string, number> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const rawContent = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.text}`)
    .join('\n\n')

  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 4000,
    system:     QUICK_ASSESS_PROMPT,
    messages:   [{
      role:    'user',
      content: `Prospect: ${prospectName}\nWebsite: ${prospectUrl}\n\nSCRAPED CONTENT:\n\n${rawContent}`,
    }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not parse auto-assessment from AI response')

  const raw = JSON.parse(jsonMatch[0]) as Record<string, { score: number; findings: string }>

  const findings: Record<string, string> = {}
  const scores: Record<string, number>   = {}

  for (const [key, val] of Object.entries(raw)) {
    if (val?.findings) findings[key] = val.findings
    if (val?.score != null) {
      const clamped = Math.min(5, Math.max(1, Math.round(Number(val.score))))
      scores[key] = clamped
    }
  }

  return { findings, scores }
}

// ─── Agency context builder (for service map) ─────────────────────────────────

async function buildAgencyContext(agencyId: string): Promise<string> {
  const [agency, attachments] = await Promise.all([
    prisma.agency.findFirst({
      where:  { id: agencyId },
      select: { name: true, brainContext: true },
    }),
    prisma.agencyBrainAttachment.findMany({
      where:   { agencyId, summaryStatus: 'ready' },
      select:  { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take:    6,
    }),
  ])

  const parts: string[] = []

  if (agency?.name)            parts.push(`AGENCY: ${agency.name}`)
  if (agency?.brainContext?.trim()) parts.push(`AGENCY BRAIN:\n${agency.brainContext.trim()}`)

  for (const doc of attachments) {
    if (doc.summary?.trim()) parts.push(`[agency doc] ${doc.filename}:\n${doc.summary.trim()}`)
  }

  return parts.join('\n\n')
}

// ─── Service map generator ────────────────────────────────────────────────────

// Exact Market's full service catalogue mapped to each assessment dimension.
// Source: exact_market_service_mapping_v2.md
const EXACT_MARKET_CATALOGUE = `
EXACT MARKET — SERVICE CATALOGUE & ENGAGEMENT MODELS

Exact Market operates as an end-to-end GTM partner across Strategy, Execution, and Optimization.

DIMENSION → SERVICE MAPPING:

1. Website & Messaging Audit → Narrative, Messaging & Conversion
   Services: GTM Messaging & Positioning Strategy, Product Marketing & Value Proposition Design,
             Website & Conversion Optimisation, Content Strategy & SEO Alignment
   Outputs:  Messaging architecture (ICP-aligned), homepage & product page rewrites,
             conversion journey redesign, SEO/content roadmap

2. Social Media & Outbound Content → Demand & Thought Leadership
   Services: Content Strategy & Thought Leadership, Executive Positioning (LinkedIn),
             Campaign & Demand Generation, Channel & Media Strategy
   Outputs:  Editorial calendar & POV themes, executive content playbooks,
             campaign architecture, channel expansion roadmap

3. Positioning & Segment Analysis → GTM Strategy
   Services: ICP & Segmentation Design, Category & Positioning Strategy,
             Product Marketing, Pricing & Packaging Strategy
   Outputs:  ICP definitions, positioning narrative, segment prioritisation,
             pricing model recommendations

4. Industry Vertical & Analyst Context → Market Intelligence
   Services: Market & Category Analysis, Strategic GTM Advisory,
             Analyst Alignment & Narrative Calibration
   Outputs:  Market landscape report, category positioning refinement,
             strategic narrative aligned to AI, regulation, and category trends

5. Competitive Landscape → Competitive Intelligence & Sales Enablement
   Services: Competitive Intelligence, Differentiation Strategy,
             Sales Enablement & Battlecards
   Outputs:  Competitive landscape map, differentiation framework,
             sales battlecards & objection handling

6. Growth Opportunity Signals → Growth & Expansion Strategy
   Services: Growth Opportunity Mapping, Demand Factory (execution engine),
             Channel & Ecosystem Strategy, GTM Expansion Planning
   Outputs:  Growth opportunity matrix, expansion roadmap (segments, geos, channels),
             content & distribution expansion plan

ENGAGEMENT MODELS:
- Strategy Sprint: 4–6 week engagement → outputs: positioning, ICP, GTM strategy
- GTM Build: 8–12 week program → outputs: messaging, campaigns, sales enablement
- Ongoing Execution (Demand Factory): continuous → outputs: pipeline generation, content engine, optimization
`

const SERVICE_MAP_SYSTEM = `You are a senior strategic advisor at Exact Market, a B2B content and GTM agency. You are generating a service mapping document for an internal capabilities presentation and sales conversation.

IMPORTANT: Always reference Exact Market's specific services by name. Every recommendation must map directly to a named Exact Market service from the catalogue below. Never recommend generic or hypothetical services.

${EXACT_MARKET_CATALOGUE}

The document must be specific, evidence-driven, and immediately actionable. Reference the actual assessment scores and findings. No generic filler. All service recommendations must come from the Exact Market catalogue above.

Format in clean markdown with clear section headers.`

const DIMENSION_LABELS: Record<string, string> = {
  website_messaging:     'Website & Messaging Audit (20%)',
  social_outbound:       'Social Media & Outbound Content (10%)',
  positioning_segment:   'Positioning & Segment Analysis (20%)',
  analyst_context:       'Industry & Analyst Context (15%)',
  competitive_landscape: 'Competitive Landscape (15%)',
  growth_signals:        'Growth Opportunity Signals (20%)',
}

const SERVICE_OPPORTUNITIES: Record<string, string[]> = {
  website_messaging:     ['GTM Messaging & Positioning Strategy', 'Product Marketing & Value Proposition Design', 'Website & Conversion Optimisation', 'Content Strategy & SEO Alignment'],
  social_outbound:       ['Content Strategy & Thought Leadership', 'Executive Positioning (LinkedIn)', 'Campaign & Demand Generation', 'Channel & Media Strategy'],
  positioning_segment:   ['ICP & Segmentation Design', 'Category & Positioning Strategy', 'Product Marketing', 'Pricing & Packaging Strategy'],
  analyst_context:       ['Market & Category Analysis', 'Strategic GTM Advisory', 'Analyst Alignment & Narrative Calibration'],
  competitive_landscape: ['Competitive Intelligence', 'Differentiation Strategy', 'Sales Enablement & Battlecards'],
  growth_signals:        ['Growth Opportunity Mapping', 'Demand Factory', 'Channel & Ecosystem Strategy', 'GTM Expansion Planning'],
}

async function generateServiceMap(
  assessment: {
    name: string
    url: string | null
    industry: string | null
    scores: Record<string, number> | null
    findings: Record<string, string> | null
    totalScore: number | null
    notes: string | null
  },
  agencyContext: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // Build scores block
  const scores = assessment.scores ?? {}
  const scoresBlock = Object.entries(WEIGHTS)
    .map(([key]) => {
      const score = scores[key]
      const label = DIMENSION_LABELS[key]
      const scoreStr = score != null ? `${score}/5` : 'not scored'
      const services = score != null && score < 3.5
        ? ` → opportunities: ${SERVICE_OPPORTUNITIES[key]?.join(', ')}`
        : ''
      return `- ${label}: ${scoreStr}${services}`
    })
    .join('\n')

  // Build findings block
  const findings = assessment.findings ?? {}
  const findingsBlock = Object.entries(DIMENSION_LABELS)
    .map(([key, label]) => findings[key] ? `**${label}:**\n${findings[key]}` : null)
    .filter(Boolean)
    .join('\n\n')

  const totalScore = assessment.totalScore
  const tier = totalScore == null ? 'not yet scored'
    : totalScore >= 4.5 ? 'Category Leader'
    : totalScore >= 3.5 ? 'Strong Performer'
    : totalScore >= 2.5 ? 'Developing / Inconsistent'
    : totalScore >= 1.5 ? 'Weak Positioning'
    : 'At Risk / Undefined'

  const userPrompt = `
PROSPECT: ${assessment.name}
${assessment.url ? `WEBSITE: ${assessment.url}` : ''}
${assessment.industry ? `INDUSTRY: ${assessment.industry}` : ''}
OVERALL SCORE: ${totalScore != null ? `${totalScore}/5 — ${tier}` : 'Not yet scored'}

DIMENSION SCORES:
${scoresBlock}

RESEARCH FINDINGS:
${findingsBlock || 'No findings recorded yet.'}

${assessment.notes ? `ANALYST NOTES:\n${assessment.notes}` : ''}

${agencyContext ? `AGENCY CONTEXT:\n${agencyContext}` : ''}

---
Generate an Exact Market service mapping document with these sections. Every service you name MUST be from Exact Market's catalogue. Do not invent services.

## Executive Summary
2-3 sentences: where this prospect stands, their biggest positioning challenge, and why Exact Market is the right partner.

## Where Exact Market Fits
For each dimension scored below 4.0: one short paragraph naming the specific gap (evidence from the findings), why it matters commercially, and which named Exact Market service(s) directly address it — including what the engagement would produce.

## Recommended Engagement Model
Which Exact Market engagement model fits best (Strategy Sprint / GTM Build / Ongoing Execution — Demand Factory) and why, based on the number, severity, and urgency of the gaps.

## Top 3 Exact Market Service Opportunities
Numbered list. Each entry: Exact Market service name in bold, one-line rationale tied to a specific finding, and the concrete outcome it delivers for this prospect.

## Quick Wins
3-5 bullets — specific things Exact Market can deliver within 30 days that would produce a visible result for this prospect.

## How to Open the Conversation
2-3 sentences framing how to position this assessment in a first capabilities meeting with this specific prospect.
`

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 4000,
    system:     SERVICE_MAP_SYSTEM,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

// ─── Markdown → .docx converter ──────────────────────────────────────────────

const DOCX_BRAND  = '1B1B2F'
const DOCX_ACCENT = '4F46E5'
const DOCX_MID    = '6B7280'
const DOCX_RULE   = 'E5E7EB'

function pt(n: number) { return n * 20 }

function parseInline(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.flatMap((p) =>
    p.startsWith('**') && p.endsWith('**')
      ? [new TextRun({ text: p.slice(2, -2), bold: true, color: DOCX_BRAND, font: 'Calibri' })]
      : p ? [new TextRun({ text: p, color: DOCX_BRAND, font: 'Calibri', size: pt(11) })]
      : [],
  )
}

function mdToParagraphs(markdown: string): Paragraph[] {
  const result: Paragraph[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    // Horizontal rule or em-dash separator
    if (!trimmed || trimmed === '---' || trimmed === '⸻' || trimmed === '—') {
      result.push(new Paragraph({
        spacing: { before: pt(6), after: pt(6) },
        border: trimmed ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: DOCX_RULE } } : undefined,
        children: [],
      }))
      continue
    }

    // Slide heading: "Slide N — Title"
    if (/^Slide \d+\s*[—–-]/.test(trimmed)) {
      result.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: result.length > 0,
        spacing: { before: pt(0), after: pt(10) },
        children: [new TextRun({ text: trimmed, bold: true, size: pt(16), color: DOCX_ACCENT, font: 'Calibri' })],
      }))
      continue
    }

    // ## Section header
    if (trimmed.startsWith('## ')) {
      result.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: pt(14), after: pt(4) },
        children: [new TextRun({ text: trimmed.slice(3), bold: true, size: pt(13), color: DOCX_ACCENT, font: 'Calibri' })],
      }))
      continue
    }

    // ### Sub-header
    if (trimmed.startsWith('### ')) {
      result.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: pt(10), after: pt(2) },
        children: [new TextRun({ text: trimmed.slice(4), bold: true, size: pt(12), color: DOCX_BRAND, font: 'Calibri' })],
      }))
      continue
    }

    // Standalone label line (no bullet, follows an empty line) — bold sub-label
    if (!trimmed.startsWith('-') && !trimmed.startsWith('•') && !trimmed.startsWith('*') && !/^\d+\./.test(trimmed)
        && trimmed.length < 80 && trimmed === trimmed.trimStart() && !/\s{2,}/.test(trimmed)) {
      // Check if this is a standalone label (short, no punctuation at end or ends with colon)
      const isLabel = /^[A-Z]/.test(trimmed) && (trimmed.endsWith(':') || !/[.!?]$/.test(trimmed))
      if (isLabel && trimmed.length < 50) {
        result.push(new Paragraph({
          spacing: { before: pt(8), after: pt(2) },
          children: [new TextRun({ text: trimmed, bold: true, size: pt(11), color: DOCX_BRAND, font: 'Calibri' })],
        }))
        continue
      }
    }

    // Bullet point (-, •, *)
    if (/^[-•*]\s+/.test(trimmed) || /^•\t/.test(trimmed)) {
      const content = trimmed.replace(/^[-•*]\s+/, '').replace(/^•\t/, '')
      result.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { before: pt(2), after: pt(2) },
        indent: { left: pt(24) },
        children: parseInline(content),
      }))
      continue
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numMatch) {
      result.push(new Paragraph({
        spacing: { before: pt(4), after: pt(2) },
        indent: { left: pt(24), hanging: pt(16) },
        children: [
          new TextRun({ text: `${numMatch[1]}.  `, bold: true, color: DOCX_MID, font: 'Calibri', size: pt(11) }),
          ...parseInline(numMatch[2]),
        ],
      }))
      continue
    }

    // Normal paragraph
    result.push(new Paragraph({
      spacing: { before: pt(3), after: pt(3) },
      children: parseInline(trimmed),
    }))
  }
  return result
}

async function buildDocx(title: string, subtitle: string | null, content: string): Promise<Buffer> {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: pt(11), color: DOCX_BRAND },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: pt(72), bottom: pt(72), left: pt(72), right: pt(72) },
        },
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: pt(4) },
          children: [new TextRun({ text: title, bold: true, size: pt(22), color: DOCX_BRAND, font: 'Calibri' })],
        }),
        ...(subtitle ? [new Paragraph({
          spacing: { before: 0, after: pt(16) },
          children: [new TextRun({ text: subtitle, size: pt(11), color: DOCX_MID, font: 'Calibri' })],
        })] : [new Paragraph({ spacing: { before: 0, after: pt(12) }, children: [] })]),
        ...mdToParagraphs(content),
      ],
    }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

// ─── Executive presentation template ─────────────────────────────────────────

const EXEC_PRESENTATION_TEMPLATE = `Exact Market Executive Presentation

Managed Services Opportunity Deck

⸻

Slide 1 — Who is Exact Market

TRUST
18 years in the technology industry
Female-founded in 2007
Proven track record supporting global enterprise and high-growth technology companies

PRECISION
Expert team of strategists, technical marketers, and ecosystem champions
Deep alignment to complex partner ecosystems (SI, MSP, ISV, hyperscalers)
Data-driven execution across the full GTM lifecycle

VALUE
Industry's first and only managed services model for marketing execution
Flexible, scalable delivery aligned to business priorities
Outcome-oriented engagement model

SPEED
Demand Factory of writers, designers, and producers
Burst capacity for rapid execution
Always-on delivery model with enterprise-grade velocity

⸻

Slide 2 — Industry Context

Market Landscape Overview
[Insert Customer Industry 1, 2, 3 context]

Key Market Dynamics
	•	Increasing competition across ecosystem-led growth models
	•	Buyer expectations shifting toward solution-led, outcome-driven messaging
	•	Partner ecosystems becoming primary revenue channels

Analyst Insights (Tier 1)
	•	[Insert Gartner/Forrester/IDC stat 1] and citation URL
	•	[Insert Gartner/Forrester/IDC stat 2] and citation URL
	•	[Insert Gartner/Forrester/IDC stat 3] and citation URL

Why Act Now
	•	Market consolidation accelerating
	•	First movers capturing disproportionate partner and buyer mindshare
	•	Delayed execution leads to lost pipeline, partner disengagement, and reduced competitive positioning

⸻

Slide 3 — The Opportunity

Observed Gap
	•	Misalignment between market demand and current GTM execution
	•	Under-leveraged partner ecosystem potential
	•	Fragmented messaging across priority solutions

Market Opportunity
	•	Capture unmet demand in [specific solution / segment]
	•	Strengthen positioning in high-growth verticals
	•	Accelerate partner-driven pipeline generation

Strategic Focus Areas
	•	Clear solution positioning aligned to buyer outcomes
	•	Scalable content and campaign engine
	•	Ecosystem-led growth activation

How Exact Market Helps
	•	Translate market signals into an actionable GTM strategy
	•	Build and execute high-impact campaigns at speed
	•	Operationalize partner-led demand generation

⸻

Slide 4 — Recommended Initiatives
	1.	Solution-Led Positioning Transformation
	•	Refine messaging aligned to buyer pain points
	•	Create unified narrative across channels
	2.	Ecosystem Activation Strategy
	•	Enable co-sell and partner-led campaigns
	•	Develop joint value propositions
	3.	Always-On Demand Engine
	•	Build scalable campaign infrastructure
	•	Activate continuous pipeline generation
	4.	Content & Asset Modernisation
	•	Develop high-impact thought leadership and sales enablement assets
	•	Align content to buyer journey stages

⸻

Slide 5 — Building the Strategy

Executive Approach
	•	Align business objectives to measurable GTM outcomes
	•	Prioritize high-impact growth levers
	•	Sequence execution for rapid value realization

Core Components
	•	Market and audience segmentation
	•	Solution positioning framework
	•	Campaign architecture design
	•	Partner integration model

Operating Model
	•	Centralized strategy with distributed execution
	•	Continuous optimization loop
	•	Data-led decision making

⸻

Slide 6 — Content Engine Kickstart

Phase 1: Foundation (Weeks 1–4)
	•	Messaging alignment
	•	Priority solution definition
	•	Campaign planning

Phase 2: Activation (Weeks 5–8)
	•	Content production
	•	Campaign launch
	•	Partner enablement rollout

Phase 3: Acceleration (Weeks 9–12)
	•	Performance optimization
	•	Expansion across channels

Beyond
	•	Scaled demand engine
	•	Continuous content production
	•	Integrated partner ecosystem growth

⸻

Slide 7 — The Full Scope of Engagement

Content & Brand Assets
	•	Customer-facing decks and presentations
	•	White papers and thought leadership
	•	Solution-specific content by vertical

Sales & Channel Enablement
	•	Battle cards and competitive positioning
	•	Solution briefs by buyer role
	•	Co-sell materials for partners

Demand & Campaign Execution
	•	Campaign strategy and execution
	•	Email nurture flows and sequences
	•	Webinar and event content strategy

⸻

Slide 8 — GTM Priorities at a Glance

Priority 1: [Insert Priority]
Priority 2: [Insert Priority]
Priority 3: [Insert Priority]

Outcomes Expected
	•	Increased pipeline generation
	•	Stronger partner engagement
	•	Improved market positioning

⸻

Slide 9 — Priority 1 Deep Dive

Focus Area
[Insert detailed priority]

Key Actions
	•	Action 1
	•	Action 2
	•	Action 3

Expected Outcomes
	•	Outcome 1
	•	Outcome 2

⸻

Slide 10 — Priority 2 Deep Dive

Focus Area
[Insert detailed priority]

Key Actions
	•	Action 1
	•	Action 2
	•	Action 3

Expected Outcomes
	•	Outcome 1
	•	Outcome 2

⸻

Slide 11 — Priority 3 Deep Dive

Focus Area
[Insert detailed priority]

Key Actions
	•	Action 1
	•	Action 2
	•	Action 3

Expected Outcomes
	•	Outcome 1
	•	Outcome 2

⸻

Slide 12 — Engagement Timeline

Weeks 1–4
	•	Discovery and alignment
	•	Strategy definition

Weeks 5–8
	•	Content and campaign activation

Weeks 9–12
	•	Optimization and scaling

Ongoing
	•	Continuous execution and improvement

⸻

Slide 13 — Next Steps

Immediate Actions
	•	Align on strategic priorities
	•	Define initial scope and success metrics
	•	Initiate kickstart phase

Why Exact Market
	•	Built to integrate seamlessly with your team
	•	Proven managed services model
	•	Speed, precision, and measurable impact

Outcome
A scalable, high-performance GTM engine designed to accelerate growth and maximize market opportunity`

const EXEC_PRESENTATION_SYSTEM = `You are generating an executive capabilities presentation for an Exact Market sales meeting. You will receive a presentation template and a prospect's assessment data.

TASK: Fill in every [Insert ...] placeholder and generic section with specific, evidence-based content drawn from the assessment findings and service map.

RULES:
- Keep Slide 1 (Who is Exact Market) EXACTLY as written — do not change a single word.
- Replace ALL [Insert ...] placeholders — none should remain in your output.
- Keep the exact slide structure, numbering, and formatting from the template.
- Reference the prospect by name throughout the presentation.
- For Slide 2 (Industry Context): Pull analyst context from the findings. If specific stats aren't available, write directionally accurate market context based on what's known about their industry.
- For Slide 3 (The Opportunity): Use the specific gaps identified by low-scoring dimensions.
- For Slide 4 (Recommended Initiatives): Keep the 4 initiative names but fill their bullets with specific actions for this prospect.
- For Slides 8–11 (GTM Priorities): Use the top 3 service opportunities from the service map as the 3 priorities.
- For Slide 13 (Next Steps): Tailor to the specific engagement recommended.
- Every bullet should be specific and concrete — no generic placeholders.
- Return the COMPLETE presentation document, all 13 slides.`

async function generateExecPresentation(
  assessment: {
    name: string
    url: string | null
    industry: string | null
    scores: Record<string, number> | null
    findings: Record<string, string> | null
    totalScore: number | null
    serviceMap: string | null
    notes: string | null
  },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const scores = assessment.scores ?? {}
  const scoresBlock = Object.entries(WEIGHTS)
    .map(([key]) => `- ${DIMENSION_LABELS[key]}: ${scores[key] != null ? `${scores[key]}/5` : 'not scored'}`)
    .join('\n')

  const findings = assessment.findings ?? {}
  const findingsBlock = Object.entries(DIMENSION_LABELS)
    .map(([key, label]) => findings[key] ? `**${label}:**\n${findings[key]}` : null)
    .filter(Boolean)
    .join('\n\n')

  const tier = assessment.totalScore == null ? 'not yet scored'
    : assessment.totalScore >= 4.5 ? 'Category Leader'
    : assessment.totalScore >= 3.5 ? 'Strong Performer'
    : assessment.totalScore >= 2.5 ? 'Developing / Inconsistent'
    : assessment.totalScore >= 1.5 ? 'Weak Positioning'
    : 'At Risk / Undefined'

  const userPrompt = `PROSPECT: ${assessment.name}
${assessment.url ? `WEBSITE: ${assessment.url}` : ''}
${assessment.industry ? `INDUSTRY: ${assessment.industry}` : ''}
OVERALL SCORE: ${assessment.totalScore != null ? `${assessment.totalScore}/5 — ${tier}` : 'Not scored'}

DIMENSION SCORES:
${scoresBlock}

RESEARCH FINDINGS:
${findingsBlock || 'No findings recorded.'}

${assessment.serviceMap ? `SERVICE MAP (already generated):\n${assessment.serviceMap}` : ''}
${assessment.notes ? `ANALYST NOTES:\n${assessment.notes}` : ''}

---

PRESENTATION TEMPLATE TO FILL IN:
${EXEC_PRESENTATION_TEMPLATE}

---

Fill in all [Insert ...] placeholders and generic text with specific content for ${assessment.name}. Return the complete 13-slide presentation.`

  const anthropic = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 })

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 3000,
    system:     EXEC_PRESENTATION_SYSTEM,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function prospectAssessmentRoutes(app: FastifyInstance) {

  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { status } = req.query as Record<string, string>

    const assessments = await prisma.prospectAssessment.findMany({
      where: { agencyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: assessments })
  })

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const assessment = await prisma.prospectAssessment.create({
      data: {
        agencyId,
        name:     parsed.data.name,
        url:      parsed.data.url ?? null,
        industry: parsed.data.industry ?? null,
        status:   'not_started',
        source:   parsed.data.source ?? 'manual',
      },
    })

    return reply.code(201).send({ data: assessment })
  })

  // ── Get one ─────────────────────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })

    return reply.send({ data: assessment })
  })

  // ── Update ──────────────────────────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const existing = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    const { scores, findings, ...rest } = parsed.data

    let totalScore = parsed.data.totalScore
    if (scores != null) {
      totalScore = calcTotalScore(scores)
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data: {
        ...rest,
        ...(scores    !== undefined ? { scores:   scores    as never } : {}),
        ...(findings  !== undefined ? { findings: findings  as never } : {}),
        ...(totalScore !== undefined ? { totalScore } : {}),
      },
    })

    return reply.send({ data: updated })
  })

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    await prisma.prospectAssessment.delete({ where: { id } })

    return reply.code(204).send()
  })

  // ── Run Research ────────────────────────────────────────────────────────────
  // Crawls the prospect's website and uses Claude to populate all 6 dimension findings.
  // ?autoScore=true  → also assigns scores in the same pass (used by Quick Assessment)
  app.post('/:id/run-research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const { autoScore } = req.query as Record<string, string>

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })
    if (!assessment.url) return reply.code(400).send({ error: 'Assessment has no URL — add a website URL first' })

    // Mark as researching
    await prisma.prospectAssessment.update({ where: { id }, data: { status: 'researching' } })

    let pages: Array<{ url: string; text: string }>
    let scrapeUsage: Record<string, number> = {}
    try {
      const crawlResult = await crawlProspect(assessment.url)
      pages       = crawlResult.pages
      scrapeUsage = crawlResult.usage
    } catch {
      await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
      return reply.code(422).send({ error: 'Failed to fetch content from the prospect URL' })
    }

    if (pages.length === 0) {
      await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
      return reply.code(422).send({ error: 'No readable content found at prospect URL — the site may be JS-only or blocking crawlers' })
    }

    // Record scrape usage (non-fatal)
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    await Promise.all(
      Object.entries(scrapeUsage).map(([source, count]) =>
        prisma.usageRecord.create({
          data: { agencyId, metric: 'scrape_pages', quantity: count, periodStart, periodEnd, metadata: { source, prospectAssessmentId: id } },
        }).catch(() => { /* non-fatal */ })
      )
    )

    if (autoScore === 'true') {
      // Quick Assessment: findings + scores in a single Claude call
      let result: { findings: Record<string, string>; scores: Record<string, number> }
      try {
        result = await generateFindingsAndScores(pages, assessment.name, assessment.url)
      } catch (err) {
        await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
        return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to generate findings and scores' })
      }

      const totalScore = calcTotalScore(result.scores)
      const updated = await prisma.prospectAssessment.update({
        where: { id },
        data:  { findings: result.findings, scores: result.scores, totalScore, status: 'complete' },
      })
      return reply.send({ data: updated, pagesScraped: pages.length })
    }

    let findings: Record<string, string>
    try {
      findings = await generateFindings(pages, assessment.name, assessment.url)
    } catch (err) {
      await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to generate findings' })
    }

    // Merge with any existing findings the user has already written
    const existingFindings = (assessment.findings ?? {}) as Record<string, string>
    const mergedFindings: Record<string, string> = { ...findings }
    for (const [key, val] of Object.entries(existingFindings)) {
      if (val?.trim()) mergedFindings[key] = val // don't overwrite user-written findings
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data:  { findings: mergedFindings, status: 'scoring' },
    })

    return reply.send({ data: updated, pagesScraped: pages.length })
  })

  // ── Generate Service Map ─────────────────────────────────────────────────────
  // Uses assessment scores + findings + agency brain to produce a service mapping doc.
  app.post('/:id/generate-service-map', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })

    const scores = assessment.scores as Record<string, number> | null
    if (!scores || Object.keys(scores).length === 0) {
      return reply.code(400).send({ error: 'Score at least one dimension before generating a service map' })
    }

    const agencyContext = await buildAgencyContext(agencyId)

    let serviceMap: string
    try {
      serviceMap = await generateServiceMap(
        {
          name:       assessment.name,
          url:        assessment.url,
          industry:   assessment.industry,
          scores:     scores,
          findings:   (assessment.findings ?? {}) as Record<string, string>,
          totalScore: assessment.totalScore,
          notes:      assessment.notes,
        },
        agencyContext,
      )
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to generate service map' })
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data:  { serviceMap },
    })

    return reply.send({ data: updated })
  })

  // ── Generate Executive Presentation ──────────────────────────────────────────
  // Uses exec presentation template + assessment data → Claude fills all placeholders
  app.post('/:id/generate-exec-presentation', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })

    let execPresentation: string
    try {
      execPresentation = await generateExecPresentation({
        name:       assessment.name,
        url:        assessment.url,
        industry:   assessment.industry,
        scores:     (assessment.scores ?? {}) as Record<string, number>,
        findings:   (assessment.findings ?? {}) as Record<string, string>,
        totalScore: assessment.totalScore,
        serviceMap: assessment.serviceMap,
        notes:      assessment.notes,
      })
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to generate executive presentation' })
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data:  { execPresentation },
    })

    return reply.send({ data: updated })
  })

  // ── Download Service Map as .docx ─────────────────────────────────────────────
  app.post('/:id/download/service-map', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })
    if (!assessment.serviceMap) return reply.code(400).send({ error: 'No service map generated yet' })

    const title    = `Service Map — ${assessment.name}`
    const subtitle = assessment.url ?? null

    let buffer: Buffer
    try {
      buffer = await buildDocx(title, subtitle, assessment.serviceMap)
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to generate .docx file' })
    }

    const safeName = assessment.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${safeName}_service_map.docx"`)
      .send(buffer)
  })

  // ── Download Executive Presentation as .docx ───────────────────────────────
  app.post('/:id/download/exec-presentation', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })
    if (!assessment.execPresentation) return reply.code(400).send({ error: 'No executive presentation generated yet' })

    const title    = `Exact Market — Executive Presentation`
    const subtitle = assessment.name

    let buffer: Buffer
    try {
      buffer = await buildDocx(title, subtitle, assessment.execPresentation)
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to generate .docx file' })
    }

    const safeName = assessment.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${safeName}_exec_presentation.docx"`)
      .send(buffer)
  })
}
