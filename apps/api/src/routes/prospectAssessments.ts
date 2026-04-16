/**
 * prospectAssessments.ts
 *
 * CRUD + intelligence actions for /api/v1/prospect-assessments
 * Agency-scoped — no client attachment. Owner/admin only.
 *
 * Routes:
 *   GET    /                      — list
 *   POST   /                      — create
 *   GET    /:id                   — get one
 *   PATCH  /:id                   — update (scores, findings, status, notes)
 *   DELETE /:id                   — delete
 *   POST   /:id/run-research      — crawl prospect site → auto-populate findings
 *   POST   /:id/generate-service-map — use agency brain + scores → generate proposal map
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma }               from '@contentnode/database'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBody = z.object({
  name:     z.string().min(1).max(300),
  url:      z.string().max(500).optional().nullable(),
  industry: z.string().max(200).optional().nullable(),
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

const SCRAPE_TIMEOUT_MS = 12_000
const MAX_PAGE_WORDS    = 1800
const MAX_CRAWL_PAGES   = 8

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

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ') + '…'
}

async function fetchPage(url: string): Promise<{ text: string; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentNode/1.0; +https://contentnode.ai)' },
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = await res.text()
    return { text: extractText(html), html }
  } catch {
    return null
  }
}

// Priority URL path fragments — fetch these sub-pages if found on the site
const PRIORITY_PATHS = [
  '/about', '/about-us',
  '/solutions', '/services', '/platform', '/product', '/products',
  '/case-studies', '/customers', '/clients',
  '/blog', '/resources', '/insights',
]

async function crawlProspect(seedUrl: string): Promise<Array<{ url: string; text: string }>> {
  const pages: Array<{ url: string; text: string }> = []
  const visited = new Set<string>()

  // Always fetch homepage first
  const home = await fetchPage(seedUrl)
  if (!home) return []
  visited.add(seedUrl)

  const truncated = truncateWords(home.text, MAX_PAGE_WORDS)
  if (truncated.length > 50) pages.push({ url: seedUrl, text: truncated })

  // Extract all links from homepage
  const allLinks = extractLinks(home.html, seedUrl)

  // Prioritise key sections
  const base = new URL(seedUrl).origin
  const priorityUrls = PRIORITY_PATHS
    .map((p) => `${base}${p}`)
    .filter((u) => allLinks.some((l) => l.startsWith(u)))

  const queue = [
    ...priorityUrls,
    ...allLinks.filter((l) => !priorityUrls.includes(l)),
  ]

  for (const url of queue) {
    if (pages.length >= MAX_CRAWL_PAGES) break
    if (visited.has(url)) continue
    visited.add(url)

    const result = await fetchPage(url)
    if (!result) continue

    const t = truncateWords(result.text, MAX_PAGE_WORDS)
    if (t.length > 50) pages.push({ url, text: t })
  }

  return pages
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

const SERVICE_MAP_SYSTEM = `You are a senior strategic advisor at a B2B content and GTM agency. Given a completed prospect assessment and agency context, generate a professional service mapping document that the agency team will use to shape a capabilities presentation and proposal.

The document must be specific, evidence-driven, and immediately actionable. Reference actual findings and scores. No generic filler.

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
  website_messaging:     ['GTM Messaging & Positioning Strategy', 'Website & Conversion Optimisation', 'Content Strategy & SEO Alignment'],
  social_outbound:       ['Content Strategy & Thought Leadership', 'Executive Positioning Programme', 'Campaign & Demand Generation'],
  positioning_segment:   ['ICP & Segmentation Design', 'Category & Positioning Strategy', 'Pricing & Packaging Strategy'],
  analyst_context:       ['Market & Category Analysis', 'Strategic GTM Advisory', 'Analyst Alignment & Narrative Calibration'],
  competitive_landscape: ['Competitive Intelligence', 'Differentiation Strategy', 'Sales Enablement & Battlecards'],
  growth_signals:        ['Growth Opportunity Mapping', 'Demand Factory', 'Channel & Ecosystem Strategy'],
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
Generate a service mapping document with these sections:

## Executive Summary
2-3 sentences: where this prospect stands, their biggest positioning challenge, and the opportunity for our agency.

## Dimension Assessment
For each dimension scored below 4.0, one short paragraph: what the specific gap is (from the findings), why it matters commercially, and which 1-2 services directly address it.

## Recommended Engagement Model
Which model fits best (Strategy Sprint / GTM Build / Ongoing Demand Factory) and why, based on the size and urgency of the gaps.

## Top 3 Service Opportunities
Numbered list. Each: service name, one-line rationale tied to a specific finding, expected outcome for the prospect.

## Quick Wins
3-5 bullet points — things the prospect could visibly improve within 30 days with the right support.

## Suggested Next Steps
2-3 sentences on how to frame the capabilities conversation with this prospect.
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

    const { scores, ...rest } = parsed.data

    let totalScore = parsed.data.totalScore
    if (scores != null) {
      totalScore = calcTotalScore(scores)
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data: {
        ...rest,
        ...(scores !== undefined ? { scores } : {}),
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
  app.post('/:id/run-research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })
    if (!assessment.url) return reply.code(400).send({ error: 'Assessment has no URL — add a website URL first' })

    // Mark as researching
    await prisma.prospectAssessment.update({ where: { id }, data: { status: 'researching' } })

    let pages: Array<{ url: string; text: string }>
    try {
      pages = await crawlProspect(assessment.url)
    } catch {
      await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
      return reply.code(422).send({ error: 'Failed to fetch content from the prospect URL' })
    }

    if (pages.length === 0) {
      await prisma.prospectAssessment.update({ where: { id }, data: { status: 'not_started' } })
      return reply.code(422).send({ error: 'No readable content found at prospect URL — the site may be JS-only or blocking crawlers' })
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
}
