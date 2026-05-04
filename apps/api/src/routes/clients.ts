import crypto from 'node:crypto'
import { extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, withAgency, auditService, usageEventService, getModelForRole } from '@contentnode/database'
import { uploadStream, downloadBuffer, deleteObject, isS3Mode } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'
import { getFrameworkResearchQueue, getAttachmentProcessQueue, getBrandAttachmentProcessQueue, getClientBrainProcessQueue, getClientVerticalBrainProcessQueue } from '../lib/queues.js'
import { requireRole } from '../plugins/auth.js'
import { clientScopeWhere, isUnrestricted, hasClientAccess } from '../lib/clientScope.js'
import { markStaleIfBrainChanged } from './templateLibrary.js'
import { seedDefaultTasksForClient } from '../lib/defaultScheduledTasks.js'
import { seedImagePromptsForClient } from './imagePrompts.js'
import { getClerkUserNames } from '../lib/clerk.js'
import { GTM_VARIABLES } from './docTemplates.js'

// Lazy mammoth for reimport
type MammothMod = { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }> }
let _mammothClient: MammothMod | null = null
async function getMammothForReimport(): Promise<MammothMod> {
  if (!_mammothClient) {
    const mod = await import('mammoth') as any
    _mammothClient = mod.default ?? mod
  }
  return _mammothClient!
}

const LOGO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createClientBody = z.object({
  name: z.string().min(1).max(100),
  industry: z.string().optional(),
  timezone: z.string().optional(),
})

const updateClientBody = createClientBody.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
  industry: z.string().nullable().optional(),
  requireOffline: z.boolean().optional(),
  isOrgClient: z.boolean().optional(),
  boxFolderId: z.string().nullable().optional(),
  googleDriveFolderId: z.string().nullable().optional(),
  mondayBoardId: z.string().nullable().optional(),
})

const createStakeholderBody = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.string().optional(),
  seniority: z.enum(['owner', 'senior', 'member', 'junior']).default('member'),
})

const updateStakeholderBody = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().optional(),
  seniority: z.enum(['owner', 'senior', 'member', 'junior']).optional(),
  archived: z.boolean().optional(),
  clientId: z.string().optional(), // move to different client
})

const TOKEN_TTL_MS = 60 * 24 * 30 * 60 * 1000 // 30 days

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared company research helper — used by both company-profile autofill
// and GTM assessment scrape so they always run identical enrichment logic.
// ─────────────────────────────────────────────────────────────────────────────

interface CompanyResearchResult {
  legalName: string; doingBusinessAs: string; founded: string
  headquarters: string; employees: string; revenueRange: string
  fundingStage: string; investors: string; productServiceSummary: string
  messagingStatement: string; valueProp: string
  keyMessage1: string; keyMessage2: string; keyMessage3: string
  toneOfVoice: string; currentTagline: string
  websiteStrengths: string; contentTypes: string
  brandAttributes: string; toneAdjectives: string; brandPersonality: string
  industriesServed: string; geographies: string; goToMarketMotion: string
  // fields used only by company profile
  about: string; industry: string; globalReach: string
  companyCategory: string; businessType: string
  coreValues: string[]; keyAchievements: string[]
  leadershipMessage: string
  leadershipTeam: Array<{ name: string; title: string; location: string; linkedin: string }>
  whatTheyDo: string; keyOfferings: string[]; partners: string[]
  milestones: string[]; visionForFuture: string
  generalInquiries: string; phone: string; headquartersAddress: string
  socialProfiles: Record<string, string>   // platform → URL
  competitorNames: string                  // comma-separated list from search
  // metadata
  _sources: Array<{ url: string; label: string }>
}

async function researchCompanyFromUrl(
  url: string,
  clientName: string,
  apiKey: string,
  usageCtx?: { agencyId: string; clientId: string; userId?: string },
  modelOverrides?: { brainModel?: string; fastModel?: string },
): Promise<CompanyResearchResult> {
  // ── HTML helpers ───────────────────────────────────────────────────────────
  const stripHtml = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<h[1-3][^>]*>/gi, '\n## ').replace(/<\/h[1-3]>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
      .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  const fetchPage = async (pageUrl: string): Promise<string> => {
    try {
      const res = await fetch(pageUrl, { headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' }, signal: AbortSignal.timeout(12000) })
      if (!res.ok) return ''
      return stripHtml(await res.text())
    } catch { return '' }
  }

  // ── Crawl homepage + discover high-value sub-pages ─────────────────────────
  const base = (() => { try { const u = new URL(url); return `${u.protocol}//${u.host}` } catch { return '' } })()

  const homepageHtml = await (async () => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' }, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return ''
      return await res.text()
    } catch { return '' }
  })()

  if (!homepageHtml) throw new Error(`Could not fetch ${url} — check the URL and try again`)

  const internalLinks = Array.from(homepageHtml.matchAll(/href=["']([^"']+)["']/gi))
    .map((m) => {
      const href = m[1]
      if (href.startsWith('http')) return href
      if (href.startsWith('/') && base) return `${base}${href}`
      return null
    })
    .filter((h): h is string => !!h && h.startsWith(base))
    .map((h) => h.split('#')[0].replace(/\/$/, '').toLowerCase())

  const pageScore = (u: string) => {
    const p = u.replace(base, '').toLowerCase()
    if (/\/(partner|ecosystem|alliance|integration|reseller|technology-partner)/.test(p)) return 10
    if (/\/(about|about-us|company|who-we-are|our-story|mission|history|story|since|founded)/.test(p)) return 9
    if (/\/(team|leadership|management|executives|founders|people|our-team)/.test(p)) return 8
    if (/\/(customer|client|case-stud|success-stor|trusted-by|who-we-serve)/.test(p)) return 7
    if (/\/(product|solution|platform|service|offering|feature)/.test(p)) return 6
    if (/\/(press|news|milestone|award|achievement)/.test(p)) return 5
    if (/\/(contact|contact-us|office|location|reach-us|get-in-touch)/.test(p)) return 5
    return 0
  }

  const subPages = [...new Set(internalLinks)]
    .filter((u) => u !== url.replace(/\/$/, '').toLowerCase() && u !== base)
    .sort((a, b) => pageScore(b) - pageScore(a))
    .filter((u) => pageScore(u) > 0)
    .slice(0, 5)

  const copyrightYears = Array.from(homepageHtml.matchAll(/©\s*(\d{4})\s*[-–]\s*(\d{4})|©\s*(\d{4})/g))
    .flatMap((m) => [m[1], m[2], m[3]].filter(Boolean).map(Number))
  const earliestCopyright = copyrightYears.length > 0 ? Math.min(...copyrightYears) : null

  const subTexts = await Promise.all(subPages.map((u) => fetchPage(u).then((t) => ({ url: u, text: t.slice(0, 4000) }))))

  // ── Extract social media profiles from homepage HTML ──────────────────────
  const socialProfileMap: Record<string, string> = {}
  const socialPatterns: Array<[string, RegExp]> = [
    ['LinkedIn',    /https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s"'<>?#)]+/i],
    ['Twitter/X',   /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>?#)/]+/i],
    ['Facebook',    /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>?#)/]+/i],
    ['Instagram',   /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>?#)/]+/i],
    ['YouTube',     /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)?[^\s"'<>?#)/]+/i],
    ['TikTok',      /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>?#)/]+/i],
  ]
  for (const [platform, regex] of socialPatterns) {
    const match = homepageHtml.match(regex)
    if (match) socialProfileMap[platform] = match[0].replace(/[)'"]+$/, '')
  }

  // Track sources for references section
  const _sources: Array<{ url: string; label: string }> = [
    { url, label: new URL(url).hostname.replace(/^www\./, '') },
    ...subTexts.filter((s) => s.text.length > 100).map((s) => ({
      url: s.url,
      label: s.url.replace(base, '') || '/',
    })),
  ]
  // Add social profiles to sources
  for (const [platform, profileUrl] of Object.entries(socialProfileMap)) {
    _sources.push({ url: profileUrl, label: platform })
  }

  const researchedCompanyName = (() => {
    const titleMatch = homepageHtml.match(/<title[^>]*>([^<]{2,80})<\/title>/i)
    if (titleMatch) {
      const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim()
      const name = title.split(/\s*[-–—|·•:]\s*/)[0].trim()
      if (name.length >= 2) return name
    }
    try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0] } catch { return clientName }
  })()

  const homepageText = stripHtml(homepageHtml).slice(0, 6000)
  let combinedContent = `=== Homepage (${url}) ===\n${homepageText}\n\n`
  for (const { url: subUrl, text } of subTexts) {
    if (text.length > 100) {
      const pageName = subUrl.replace(base, '') || '/'
      combinedContent += `=== Page: ${pageName} ===\n${text}\n\n`
    }
  }

  const sourcesSummary = `company website (${subPages.length + 1} pages)`

  // ── Claude extraction from website ─────────────────────────────────────────
  const prompt = `You are a senior business analyst building a thorough company backgrounder from multiple intelligence sources.

Company name: ${clientName}
Main URL: ${url}
Sources: ${sourcesSummary}${earliestCopyright ? `\nEarliest copyright year found in page footer: ${earliestCopyright} (use as a founding year hint if no explicit date is found)` : ''}

---
RESEARCH CONTENT (multiple sources):
${combinedContent}
---

INSTRUCTIONS:
- Read ALL sources. Use the MOST RELEVANT source/page for each field.
- "legalName" → the full registered legal name (e.g. "Dizzion, Inc." not just "Dizzion"). Look at footer, About page, legal/privacy pages, press releases.
- "doingBusinessAs" → trade name or brand name if different from legal name; otherwise same as legalName
- "founded" → look for "Founded in", "Since", "Established in", "In [year] we", then fall back to earliest copyright year hint
- "employees" → look for headcount numbers on website pages, About page, or press releases
- "revenueRange" → look for revenue figures in press releases, About page, investor relations. Express as range if possible (e.g. "$50M–$100M"). Leave empty if not found on site.
- "fundingStage" → look for funding mentions (Series A/B/C, bootstrapped, PE-backed, public/NYSE/NASDAQ, acquired). Check About, press, or investor pages.
- "leadershipTeam" → use content from pages labeled /team, /leadership, /management, /executives, or /founders
- "partners" → use content from pages labeled /partners, /ecosystem, /integrations, /alliances. Also look for: "Powered by", "Built on", "Works with", "Certified by", partner logos.
- "whatTheyDo", "keyOfferings", "industriesServed" → use product/solution/services pages
- "generalInquiries", "phone", "headquartersAddress" → use pages labeled /contact, /contact-us, or /about
- Be thorough — extract more rather than less. Do NOT skip a field just because it wasn't on the homepage.

Return ONLY valid JSON with no markdown, no explanation:

{
  "legalName": "full registered legal company name",
  "doingBusinessAs": "brand/trade name if different from legal name, otherwise same",
  "about": "2-4 sentence company overview based on all pages",
  "founded": "year or date founded",
  "headquarters": "city, state/country",
  "industry": "primary industry",
  "globalReach": "description of geographic presence and market reach",
  "companyCategory": "e.g. Enterprise Software, SaaS, Professional Services",
  "businessType": "e.g. B2B, B2C, B2G, Mixed",
  "employees": "headcount or range",
  "revenueRange": "revenue range if mentioned on site (e.g. $50M-$100M), empty string if not found",
  "fundingStage": "e.g. Series B, PE-backed, Bootstrapped, Public — empty string if not found",
  "coreValues": ["value 1", "value 2"],
  "keyAchievements": ["achievement 1", "achievement 2"],
  "leadershipMessage": "direct quote or summary from CEO/leadership if found",
  "leadershipTeam": [{ "name": "Full Name", "title": "Job Title", "location": "", "linkedin": "" }],
  "whatTheyDo": "detailed paragraph describing their core business, model, and differentiation",
  "keyOfferings": ["product/service 1", "product/service 2"],
  "industriesServed": ["industry 1", "industry 2"],
  "partners": ["Partner A", "Technology X"],
  "milestones": ["milestone 1", "milestone 2"],
  "visionForFuture": "their stated vision, mission, or strategic direction",
  "website": "${url}",
  "generalInquiries": "email for general contact if found",
  "phone": "main phone number if found",
  "headquartersAddress": "full street address if found",
  "messagingStatement": "one-sentence summary of who they help and how",
  "valueProp": "primary reason buyers choose them",
  "keyMessage1": "first core talking point",
  "keyMessage2": "second core talking point",
  "keyMessage3": "third core talking point",
  "toneOfVoice": "e.g. Confident, technical, empathetic",
  "currentTagline": "tagline if present on site",
  "brandAttributes": "3-5 adjectives describing the brand",
  "toneAdjectives": "adjectives describing tone",
  "brandPersonality": "if this brand were a person, how would they speak",
  "contentTypes": "types of content found on site (blog, case studies, webinars, etc.)",
  "websiteStrengths": "what the site does well",
  "geographies": "geographic markets served",
  "goToMarketMotion": "product-led / sales-led / partner-led / community-led"
}

Use empty string "" or empty array [] for any field not found. Never invent information.`

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelOverrides?.brainModel ?? 'claude-sonnet-4-6', max_tokens: 5000, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extracted: Record<string, any> = {}
  if (aiRes.ok) {
    const aiBody = await aiRes.json() as { content: Array<{ text: string }> }
    const text = aiBody.content?.[0]?.text ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) { try { extracted = JSON.parse(m[0]) } catch { /* continue to enrichment */ } }
  }

  // ── External enrichment via Brave Search API + DDG Instant Answer ────────
  // DDG HTML search is blocked by CAPTCHA from all server/cloud IPs.
  // Solution: Brave Search API returns real JSON snippets without bot-blocking.
  // Key insight: use the website DOMAIN as the search anchor (e.g. "thrivenextgen.com")
  // rather than the extracted page-title name — the domain is consistent across
  // all data sources (LinkedIn, ZoomInfo, Glassdoor, Craft.co, Pitchbook) even when
  // the company trades under different names on different platforms.
  const braveKey = process.env.BRAVE_SEARCH_API_KEY ?? ''
  // The website domain (e.g. "thrivenextgen.com") is our universal company identifier
  const websiteDomain = base ? new URL(url).hostname.replace(/^www\./, '') : ''
  // Short search name: prefer clientName (user-typed) over extracted page title
  const searchName = clientName.trim() || researchedCompanyName

  const enrich: {
    founded?: string; headquarters?: string; employees?: string
    phone?: string; generalInquiries?: string; headquartersAddress?: string
    fundingStage?: string; revenueRange?: string; investors?: string
  } = {}
  const enrichSources: Array<{ url: string; label: string }> = []

  // Helper: Brave Search API → returns combined title + description text from top results
  let _braveCallCount = 0
  const _braveStartMs = Date.now()
  const braveSearch = async (query: string, count = 5): Promise<string> => {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&text_decorations=0&result_filter=web`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': braveKey,
        },
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!res.ok) return ''
    _braveCallCount++
    const data = await res.json() as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[] }> }
    }
    return (data.web?.results ?? [])
      .map((r) => [r.title, r.url, r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' | '))
      .join('\n')
      .slice(0, 4000)
  }

  // Helper: call Claude Haiku to extract a JSON object from search snippets
  const haikuExtract = async (prompt: string, maxTokens = 200): Promise<Record<string, string>> => {
    const hRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelOverrides?.fastModel ?? 'claude-haiku-4-5-20251001', max_tokens: maxTokens, temperature: 0,
        messages: [{ role: 'user', content: prompt }] }),
    })
    if (!hRes.ok) return {}
    const body = await hRes.json() as { content: Array<{ text: string }> }
    const m = (body.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/)
    if (!m) return {}
    try { return JSON.parse(m[0]) as Record<string, string> } catch { return {} }
  }

  await Promise.allSettled([

    // ── Layer A: DDG Instant Answer JSON API (Wikipedia infobox) ─────────
    // This is an actual JSON API — no bot-blocking — works from any server.
    // Only returns data for companies with a Wikipedia page.
    (async () => {
      type DDGItem = { label?: string; value?: unknown }
      type DDGResponse = { AbstractText?: string; Infobox?: { content?: DDGItem[] } }
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(researchedCompanyName)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': 'ContentNode-ResearchBot/1.0' }, signal: AbortSignal.timeout(8000) }
      )
      if (!ddgRes.ok) return
      const d = await ddgRes.json() as DDGResponse
      const facts: Record<string, string> = {}
      for (const item of (d.Infobox?.content ?? [])) {
        if (typeof item.label === 'string' && typeof item.value === 'string' && item.value.trim())
          facts[item.label.toLowerCase()] = item.value.trim()
      }
      if (facts['founded']) enrich.founded = facts['founded']

      // Leadership from DDG "Key people" infobox
      const keyPeople = facts['key people'] ?? facts['founders'] ?? ''
      if (keyPeople) {
        const ddgMembers: Array<{ name: string; title: string; location: string; linkedin: string }> = []
        for (const entry of keyPeople.split(/,(?![^(]*\))/)) {
          const m2 = entry.trim().match(/^(.+?)\s*\(([^)]+)\)$/)
          if (m2) ddgMembers.push({ name: m2[1].trim(), title: m2[2].trim(), location: '', linkedin: '' })
          else if (entry.trim()) ddgMembers.push({ name: entry.trim(), title: '', location: '', linkedin: '' })
        }
        if (ddgMembers.length > 0) {
          const claudeTeam = Array.isArray(extracted.leadershipTeam) ? extracted.leadershipTeam : []
          const existingNames = new Set(claudeTeam.map((m: { name?: string }) => (m.name ?? '').toLowerCase()))
          for (const m2 of ddgMembers) {
            if (!existingNames.has(m2.name.toLowerCase())) claudeTeam.push(m2)
          }
          extracted.leadershipTeam = claudeTeam
        }
      }

      const empKey = Object.keys(facts).find((k) => k.includes('employee'))
      if (empKey) enrich.employees = facts[empKey]
      if (!enrich.employees && d.AbstractText) {
        const empMatch = d.AbstractText.match(/(\d[\d,]+)\s+employees/i) ?? d.AbstractText.match(/workforce of\s+([\d,]+)/i)
        if (empMatch) enrich.employees = empMatch[1]
      }
      const hqMatch = d.AbstractText?.match(/headquartered in ([^.]+)/i)
      if (hqMatch) {
        enrich.headquarters = hqMatch[1]
          .replace(/,?\s*(U\.?S\.?A?\.?|United States|United Kingdom|England)\.?$/i, '')
          .trim()
      }
      if (enrich.founded || enrich.headquarters || enrich.employees)
        enrichSources.push({ url: `https://duckduckgo.com/?q=${encodeURIComponent(researchedCompanyName)}`, label: 'Wikipedia / DuckDuckGo Instant Answer' })
    })(),

    // ── Layers B–F: Brave Search API (requires BRAVE_SEARCH_API_KEY) ──────
    // Brave returns real JSON snippets without CAPTCHA. Free tier: 2,000 req/month.
    // All queries use the website domain as anchor (e.g. "thrivenextgen.com") rather
    // than the page-title name, because ZoomInfo, LinkedIn, Glassdoor, Craft.co, and
    // Pitchbook all reference the company's website URL in their public profiles.
    ...(braveKey ? [

      // ── Layer B: Company facts — employees, founded, revenue, funding ─────
      // Domain-anchored so it finds the company across LinkedIn, Glassdoor,
      // ZoomInfo, Craft.co, and Pitchbook even when names differ per platform.
      (async () => {
        const text = await braveSearch(`"${websiteDomain}" employees founded revenue funding`)
        if (!text) return
        const p = await haikuExtract(
          `Search result snippets about the company at ${websiteDomain}.\nExtract only (empty string if not clearly stated — do NOT guess):\n- "founded": year founded, e.g. "2000"\n- "employees": headcount or range, e.g. "1,820" or "1,001–5,000"\n- "revenueRange": annual revenue, e.g. "$100M–$500M" or "$189.7M"\n- "fundingStage": e.g. "PE Growth", "Privately Held", "Series B", "Bootstrapped"\n- "investors": top investors/backers comma-separated\n- "headquarters": city and state/country\n- "headquartersAddress": full street address if shown\nReturn ONLY JSON: {"founded":"","employees":"","revenueRange":"","fundingStage":"","investors":"","headquarters":"","headquartersAddress":""}\n\n${text}`,
          300,
        )
        if (p.founded?.trim()            && !enrich.founded)            enrich.founded            = p.founded.trim()
        if (p.employees?.trim()          && !enrich.employees)          enrich.employees          = p.employees.trim()
        if (p.revenueRange?.trim()       && !enrich.revenueRange)       enrich.revenueRange       = p.revenueRange.trim()
        if (p.fundingStage?.trim()       && !enrich.fundingStage)       enrich.fundingStage       = p.fundingStage.trim()
        if (p.investors?.trim()          && !enrich.investors)          enrich.investors          = p.investors.trim()
        if (p.headquarters?.trim()       && !enrich.headquarters)       enrich.headquarters       = p.headquarters.trim()
        if (p.headquartersAddress?.trim() && !enrich.headquartersAddress) enrich.headquartersAddress = p.headquartersAddress.trim()
        if (Object.values(p).some((v) => v?.trim()))
          enrichSources.push({ url: `https://www.zoominfo.com/pic/${searchName.toLowerCase().replace(/\s+/g, '-')}`, label: 'ZoomInfo / Glassdoor / Craft.co' })
      })(),

      // ── Layer C: Pitchbook — deal type, financing rounds, investors ───────
      (async () => {
        const text = await braveSearch(`pitchbook "${websiteDomain}" OR "${searchName}" funding investors deal`)
        if (!text) return
        const p = await haikuExtract(
          `Pitchbook search snippets for the company at ${websiteDomain} (also known as "${searchName}").\nExtract only (empty string if not clearly stated):\n- "fundingStage": deal type, e.g. "PE Growth", "Series B", "Bootstrapped", "Public"\n- "investors": top investors/PE backers comma-separated\n- "founded": year founded\n- "employees": employee count\nReturn ONLY JSON: {"fundingStage":"","investors":"","founded":"","employees":""}\n\n${text}`,
          200,
        )
        if (p.fundingStage?.trim() && !enrich.fundingStage) enrich.fundingStage = p.fundingStage.trim()
        if (p.investors?.trim()    && !enrich.investors)    enrich.investors    = p.investors.trim()
        if (p.founded?.trim()      && !enrich.founded)      enrich.founded      = p.founded.trim()
        if (p.employees?.trim()    && !enrich.employees)    enrich.employees    = p.employees.trim()
        if (Object.values(p).some((v) => v?.trim()))
          enrichSources.push({ url: `https://pitchbook.com/search?q=${encodeURIComponent(searchName)}`, label: 'Pitchbook' })
      })(),

      // ── Layer D: Crunchbase — funding rounds, investors ───────────────────
      (async () => {
        const text = await braveSearch(`crunchbase "${websiteDomain}" OR "${searchName}" funding investors`)
        if (!text) return
        const p = await haikuExtract(
          `Crunchbase snippets for the company at ${websiteDomain}.\nExtract only:\n- "fundingStage": funding stage\n- "investors": investors comma-separated\n- "founded": year\nReturn ONLY JSON: {"fundingStage":"","investors":"","founded":""}\n\n${text}`,
          150,
        )
        if (p.fundingStage?.trim() && !enrich.fundingStage) enrich.fundingStage = p.fundingStage.trim()
        if (p.investors?.trim()    && !enrich.investors)    enrich.investors    = p.investors.trim()
        if (p.founded?.trim()      && !enrich.founded)      enrich.founded      = p.founded.trim()
        if (Object.values(p).some((v) => v?.trim()))
          enrichSources.push({ url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(searchName)}`, label: 'Crunchbase' })
      })(),

      // ── Layer E: LinkedIn — employee range, HQ, industry, type ──────────
      (async () => {
        const linkedinUrl = Object.values(socialProfileMap).find((u) => u.includes('linkedin')) ?? ''
        const text = await braveSearch(`linkedin "${websiteDomain}" OR "${searchName}" employees headquarters industry founded`)
        if (!text) return
        const p = await haikuExtract(
          `LinkedIn company page snippets for ${websiteDomain}.\nExtract only:\n- "employees": LinkedIn range, e.g. "1,001–5,000 employees"\n- "headquarters": city/state\n- "industry": e.g. "IT Services and IT Consulting"\n- "founded": year\n- "fundingStage": company type, e.g. "Privately Held", "Public Company"\nReturn ONLY JSON: {"employees":"","headquarters":"","industry":"","founded":"","fundingStage":""}\n\n${text}`,
          200,
        )
        if (p.employees?.trim()    && !enrich.employees)    enrich.employees    = p.employees.trim()
        if (p.headquarters?.trim() && !enrich.headquarters) enrich.headquarters = p.headquarters.trim()
        if (p.founded?.trim()      && !enrich.founded)      enrich.founded      = p.founded.trim()
        if (p.fundingStage?.trim() && !enrich.fundingStage) enrich.fundingStage = p.fundingStage.trim()
        if (p.industry?.trim() && !(extracted.industry as string | undefined)?.trim())
          extracted.industry = p.industry.trim()
        if (Object.values(p).some((v) => v?.trim()))
          enrichSources.push({ url: linkedinUrl || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(searchName)}`, label: 'LinkedIn' })
      })(),

      // ── Layer F: Competitors — for S2 competitive landscape ───────────────
      (async () => {
        const text = await braveSearch(`"${searchName}" competitors alternatives similar companies`)
        if (!text) return
        const p = await haikuExtract(
          `Search snippets about competitors of "${searchName}".\nExtract a list of up to 6 direct competitor company names mentioned (empty string if none found).\n- "competitors": comma-separated list of competitor names\nReturn ONLY JSON: {"competitors":""}\n\n${text}`,
          150,
        )
        if (p.competitors?.trim()) {
          extracted.competitorNames = p.competitors.trim()
          enrichSources.push({ url: `https://www.google.com/search?q=${encodeURIComponent(searchName + ' competitors')}`, label: 'Competitor Research' })
        }
      })(),

    ] : []),  // ← Layers B–F skipped entirely when BRAVE_SEARCH_API_KEY not set

  ])

  // Record Brave Search API usage (non-blocking — never throws)
  if (_braveCallCount > 0 && usageCtx) {
    void usageEventService.record({
      agencyId:       usageCtx.agencyId,
      clientId:       usageCtx.clientId,
      userId:         usageCtx.userId,
      toolType:       'content',
      toolSubtype:    'web_search',
      provider:       'brave',
      model:          'brave-search-api',
      isOnline:       true,
      inputMediaCount: _braveCallCount,
      durationMs:     Date.now() - _braveStartMs,
      status:         'success',
    })
  }

  // Apply enriched data (website extraction takes precedence; enrich fills gaps)
  if (enrich.fundingStage && !extracted.fundingStage) extracted.fundingStage = enrich.fundingStage
  if (enrich.revenueRange  && !extracted.revenueRange)  extracted.revenueRange  = enrich.revenueRange
  if (enrich.investors && !extracted.investors) extracted.investors = enrich.investors

  // Enriched sources override Claude's website extraction for factual fields
  if (enrich.founded)             extracted.founded             = enrich.founded
  if (enrich.headquarters)        extracted.headquarters        = enrich.headquarters
  if (enrich.employees)           extracted.employees           = enrich.employees
  if (enrich.phone)               extracted.phone               = enrich.phone
  if (enrich.generalInquiries)    extracted.generalInquiries    = enrich.generalInquiries
  if (enrich.headquartersAddress) extracted.headquartersAddress = enrich.headquartersAddress

  // Append enrichment sources (deduplicated)
  for (const src of enrichSources) {
    if (!_sources.some((s) => s.label === src.label)) _sources.push(src)
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

  return {
    legalName:             str(extracted.legalName) || researchedCompanyName,
    doingBusinessAs:       str(extracted.doingBusinessAs),
    founded:               str(extracted.founded),
    headquarters:          str(extracted.headquarters),
    employees:             str(extracted.employees),
    revenueRange:          str(extracted.revenueRange),
    fundingStage:          str(extracted.fundingStage),
    investors:             str(extracted.investors) || str(enrich.investors),
    productServiceSummary: str(extracted.whatTheyDo) || str(extracted.about),
    messagingStatement:    str(extracted.messagingStatement),
    valueProp:             str(extracted.valueProp) || str(extracted.visionForFuture),
    keyMessage1:           str(extracted.keyMessage1),
    keyMessage2:           str(extracted.keyMessage2),
    keyMessage3:           str(extracted.keyMessage3),
    toneOfVoice:           str(extracted.toneOfVoice),
    currentTagline:        str(extracted.currentTagline),
    websiteStrengths:      str(extracted.websiteStrengths),
    contentTypes:          str(extracted.contentTypes),
    brandAttributes:       str(extracted.brandAttributes),
    toneAdjectives:        str(extracted.toneAdjectives),
    brandPersonality:      str(extracted.brandPersonality),
    industriesServed:      arr(extracted.industriesServed).join(', '),
    geographies:           str(extracted.geographies) || str(extracted.globalReach),
    goToMarketMotion:      str(extracted.goToMarketMotion) || str(extracted.businessType),
    // Company profile fields
    about:                 str(extracted.about),
    industry:              str(extracted.industry),
    globalReach:           str(extracted.globalReach),
    companyCategory:       str(extracted.companyCategory),
    businessType:          str(extracted.businessType),
    coreValues:            arr(extracted.coreValues),
    keyAchievements:       arr(extracted.keyAchievements),
    leadershipMessage:     str(extracted.leadershipMessage),
    leadershipTeam:        Array.isArray(extracted.leadershipTeam) ? extracted.leadershipTeam : [],
    whatTheyDo:            str(extracted.whatTheyDo),
    keyOfferings:          arr(extracted.keyOfferings),
    partners:              arr(extracted.partners),
    milestones:            arr(extracted.milestones),
    visionForFuture:       str(extracted.visionForFuture),
    generalInquiries:      str(extracted.generalInquiries),
    phone:                 str(extracted.phone),
    headquartersAddress:   str(extracted.headquartersAddress),
    socialProfiles:        socialProfileMap,
    competitorNames:       str(extracted.competitorNames),
    _sources,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Agency template seeding for new clients ───────────────────────────────────
async function seedAgencyTemplatesForClient(agencyId: string, clientId: string): Promise<void> {
  const agencyTemplates = await prisma.promptTemplate.findMany({
    where: { agencyId, clientId: null, agencyLevel: true, visibleToClients: true, deletedAt: null },
  })
  if (!agencyTemplates.length) return
  await prisma.promptTemplate.createMany({
    data: agencyTemplates.map((t) => ({
      agencyId,
      clientId,
      name:            t.name,
      body:            t.body,
      category:        t.category,
      description:     t.description,
      source:          'agency',
      agencyTemplateId: t.id,
      agencyLevel:     false,
      visibleToClients: true,
      isHidden:        false,
      createdBy:       'system',
    })),
    skipDuplicates: true,
  })
}

// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function clientRoutes(app: FastifyInstance) {
  // ── Client-scope access guard — runs for every /:id sub-route ────────────
  // owner / org_admin / admin always pass through.
  // All other roles must have a row in team_member_clients for the client.
  // Unauthenticated requests (e.g. logo served as <img src>) are skipped.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.auth) return
    const params = req.params as Record<string, string> | null
    const clientId = params?.id
    if (!clientId) return
    if (isUnrestricted(req.auth.role)) return
    const ok = await hasClientAccess(req, clientId)
    if (!ok) return reply.code(404).send({ error: 'Client not found' })
  })

  // ── GET / — list clients with summary stats ───────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeWhere: any = await clientScopeWhere(req)
    const clients = await prisma.client.findMany({
      where: scopeWhere,
      include: {
        _count: { select: { stakeholders: true, workflows: true } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    })

    // Aggregate feedback counts and last activity per client
    const clientIds = clients.map((c) => c.id)

    // Get last run per client
    const lastRuns = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        workflow: { clientId: { in: clientIds } },
      },
      select: { createdAt: true, workflow: { select: { clientId: true } } },
      orderBy: { createdAt: 'desc' },
      distinct: ['workflowId'],
    })

    const lastRunByClient: Record<string, Date> = {}
    for (const run of lastRuns) {
      const cid = (run as unknown as { workflow: { clientId: string } }).workflow.clientId
      if (!lastRunByClient[cid] || run.createdAt > lastRunByClient[cid]) {
        lastRunByClient[cid] = run.createdAt
      }
    }

    // Per-client feedback count
    const perClientFeedback: Record<string, number> = {}
    for (const cid of clientIds) {
      const count = await prisma.feedback.count({
        where: {
          agencyId,
          workflowRun: { workflow: { clientId: cid } },
        },
      })
      perClientFeedback[cid] = count
    }

    const data = clients.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      industry: c.industry,
      logoUrl: c.logoStorageKey ? `/api/v1/clients/${c.id}/logo` : null,
      status: c.status,
      archivedAt: c.archivedAt,
      createdAt: c.createdAt,
      stakeholderCount: c._count.stakeholders,
      workflowCount: c._count.workflows,
      feedbackCount: perClientFeedback[c.id] ?? 0,
      lastActivity: lastRunByClient[c.id] ?? null,
    }))

    return reply.send({ data, meta: { total: data.length } })
  })

  // ── POST / — create client ────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const parsed = createClientBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { agencyId, userId } = req.auth
    const { name, industry } = parsed.data

    // Ensure unique slug within agency
    const baseSlug = slugify(name)
    let slug = baseSlug
    let i = 1
    while (await prisma.client.findFirst({ where: { agencyId, slug } })) {
      slug = `${baseSlug}-${i++}`
    }

    const client = await prisma.client.create({
      data: { agencyId, name, slug, industry: industry ?? null },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'client.created',
      resourceType: 'Client',
      resourceId: client.id,
      metadata: { name },
    })

    // Seed default (disabled) scheduled task templates for the new client
    seedDefaultTasksForClient(agencyId, client.id).catch(() => {})
    // Copy global agency image prompts to the new client as their starting set
    seedImagePromptsForClient(agencyId, client.id).catch(() => {})
    // Copy all visible agency-level prompt templates to the new client
    seedAgencyTemplatesForClient(agencyId, client.id).catch(() => {})

    return reply.code(201).send({ data: client })
  })

  // ── GET /:id — client detail with relations ───────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        stakeholders: {
          include: { _count: { select: { feedbacks: true } } },
          orderBy: [{ seniority: 'asc' }, { createdAt: 'asc' }],
        },
        workflows: {
          select: {
            id: true,
            name: true,
            status: true,
            connectivityMode: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { runs: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        insights: {
          where: { status: { in: ['pending', 'applied'] } },
          select: {
            id: true, type: true, title: true, body: true,
            confidence: true, status: true, isCollective: true,
            instanceCount: true, createdAt: true,
          },
          orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
          take: 20,
        },
        _count: { select: { stakeholders: true, workflows: true } },
      },
    })

    if (!client) return reply.code(404).send({ error: 'Client not found' })
    return reply.send({
      data: {
        ...client,
        logoUrl: client.logoStorageKey ? `/api/v1/clients/${client.id}/logo` : null,
      },
    })
  })

  // ── PATCH /:id — update client ────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = updateClientBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    // requireOffline is an admin-only policy setting.
    // Fall back to DB role if the Clerk JWT doesn't include the role claim (defaults to 'editor').
    if (parsed.data.requireOffline !== undefined) {
      let effectiveRole = req.auth.role ?? 'editor'
      if (!['owner', 'admin'].includes(effectiveRole)) {
        const dbUser = await prisma.user.findFirst({
          where: { clerkUserId: req.auth.userId, agencyId },
          select: { role: true },
        })
        if (dbUser?.role) effectiveRole = dbUser.role
      }
      if (!['owner', 'admin'].includes(effectiveRole)) {
        return reply.code(403).send({ error: 'Only admins can change the AI policy for a client.' })
      }
    }

    const isArchiving = parsed.data.status === 'archived'
    const isUnarchiving = parsed.data.status === 'active'
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.industry !== undefined ? { industry: parsed.data.industry } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(isArchiving ? { archivedAt: new Date() } : {}),
        ...(isUnarchiving ? { archivedAt: null } : {}),
        ...(parsed.data.requireOffline !== undefined ? { requireOffline: parsed.data.requireOffline } : {}),
        ...(parsed.data.isOrgClient !== undefined ? { isOrgClient: parsed.data.isOrgClient } : {}),
        ...(parsed.data.boxFolderId !== undefined ? { boxFolderId: parsed.data.boxFolderId } : {}),
        ...(parsed.data.googleDriveFolderId !== undefined ? { googleDriveFolderId: parsed.data.googleDriveFolderId } : {}),
        ...(parsed.data.mondayBoardId !== undefined ? { mondayBoardId: parsed.data.mondayBoardId } : {}),
      },
    })

    return reply.send({ data: client })
  })

  // ── POST /:id/logo — upload client logo ──────────────────────────────────
  // Logos are stored as base64 data URLs in the DB column so they survive
  // container restarts on Railway without needing S3/R2 configured.
  app.post<{ Params: { id: string } }>('/:id/logo', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } }) // 5 MB max
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file } = data
    const ext = extname(filename).toLowerCase()
    if (!LOGO_MIME[ext]) {
      file.resume()
      return reply.code(400).send({ error: `Unsupported logo format. Use: ${Object.keys(LOGO_MIME).join(', ')}` })
    }

    // Read into memory and encode as a data URL — persists in the DB across restarts
    const chunks: Buffer[] = []
    for await (const chunk of file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const fileBuffer = Buffer.concat(chunks)
    const contentType = LOGO_MIME[ext] ?? 'application/octet-stream'
    const dataUrl = `data:${contentType};base64,${fileBuffer.toString('base64')}`

    // Clean up old file-based logo if it was previously stored on disk/S3
    if (existing.logoStorageKey && !existing.logoStorageKey.startsWith('data:')) {
      try { await deleteObject(existing.logoStorageKey) } catch {}
    }

    await prisma.client.update({
      where: { id: req.params.id },
      data: { logoStorageKey: dataUrl },
    })

    return reply.send({ data: { logoUrl: `/api/v1/clients/${req.params.id}/logo` } })
  })

  // ── GET /:id/logo — serve client logo (no auth required) ─────────────────
  app.get<{ Params: { id: string } }>('/:id/logo', async (req, reply) => {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id },
      select: { logoStorageKey: true },
    })
    if (!client?.logoStorageKey) return reply.code(404).send({ error: 'No logo' })

    reply.header('Cache-Control', 'public, max-age=86400')
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin')

    // Data URL stored directly in DB (current approach — no S3 needed)
    if (client.logoStorageKey.startsWith('data:')) {
      const [header, base64] = client.logoStorageKey.split(',')
      const contentType = header.replace('data:', '').replace(';base64', '')
      return reply.header('Content-Type', contentType).send(Buffer.from(base64, 'base64'))
    }

    // Legacy: file stored on disk or S3
    const ext = extname(client.logoStorageKey).toLowerCase()
    const contentType = LOGO_MIME[ext] ?? 'application/octet-stream'
    reply.header('Content-Type', contentType)
    try {
      const buffer = await downloadBuffer(client.logoStorageKey)
      return reply.send(buffer)
    } catch {
      return reply.code(404).send({ error: 'Logo file not found' })
    }
  })

  // ── DELETE /:id — delete client ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Client not found' })

    await prisma.client.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Stakeholder sub-routes  /clients/:id/stakeholders
  // ─────────────────────────────────────────────────────────────────────────

  // ── GET /:id/team — agency team members who have access to this client ──────
  app.get<{ Params: { id: string } }>('/:id/team', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id

    const rows = await prisma.teamMemberClient.findMany({
      where: { clientId, agencyId },
      select: { teamMember: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { teamMember: { name: 'asc' } },
    })

    return reply.send({ data: rows.map(r => r.teamMember) })
  })

  // ── GET /:id/stakeholders ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/stakeholders', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const now = new Date()
    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { _count: { select: { feedbacks: true } } },
      orderBy: [{ seniority: 'asc' }, { createdAt: 'asc' }],
    })

    // Auto-archive expired temp contacts (lazy cleanup on list) + revoke all portal access
    const expired = stakeholders.filter(
      (s) => s.source === 'deliverable_share' && s.expiresAt && s.expiresAt < now && !s.archivedAt,
    )
    if (expired.length > 0) {
      const expiredIds = expired.map((s) => s.id)
      await prisma.stakeholder.updateMany({
        where: { id: { in: expiredIds } },
        data: { archivedAt: now, magicLinkToken: null, magicLinkExpiresAt: null },
      })
      // Revoke all active DeliverableAccess grants for expired contacts
      prisma.deliverableAccess.updateMany({
        where: { stakeholderId: { in: expiredIds }, agencyId, revokedAt: null },
        data: { revokedAt: now },
      }).catch(() => {})
      for (const s of expired) s.archivedAt = now
    }

    return reply.send({ data: stakeholders })
  })

  // ── POST /:id/stakeholders ────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/stakeholders', async (req, reply) => {
    const { agencyId } = req.auth

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const parsed = createStakeholderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const { name, email, role, seniority } = parsed.data

    const existing = await prisma.stakeholder.findFirst({
      where: { clientId: req.params.id, email },
    })
    if (existing) {
      return reply.code(409).send({ error: 'A stakeholder with this email already exists for this client' })
    }

    const stakeholder = await prisma.stakeholder.create({
      data: {
        agencyId,
        clientId: req.params.id,
        name,
        email,
        role: role ?? null,
        seniority,
      },
    })

    // Retroactively link any HumanizerSignals that came from this email address
    // before the person was in the system (attributedTo = 'unknown_external').
    if (email) {
      const backfilled = await prisma.humanizerSignal.updateMany({
        where: { agencyId, editorEmail: email, stakeholderId: null, attributedTo: 'unknown_external' },
        data:  { stakeholderId: stakeholder.id, attributedTo: 'stakeholder' },
      })
      if (backfilled.count > 0) {
        req.log.info(
          { stakeholderId: stakeholder.id, email, count: backfilled.count },
          'Retroactively linked HumanizerSignals to new stakeholder',
        )
      }
    }

    return reply.code(201).send({ data: stakeholder })
  })

  // ── PATCH /:id/stakeholders/:sid ──────────────────────────────────────────
  app.patch<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = updateStakeholderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    // Validate target client belongs to same agency when moving
    if (parsed.data.clientId) {
      const targetClient = await prisma.client.findFirst({ where: { id: parsed.data.clientId, agencyId } })
      if (!targetClient) return reply.code(400).send({ error: 'Target client not found' })

      // Check for email collision at target client
      const collision = await prisma.stakeholder.findFirst({
        where: { clientId: parsed.data.clientId, email: stakeholder.email },
      })
      if (collision) {
        return reply.code(409).send({
          error: `${targetClient.name} already has a contact with email ${stakeholder.email}. Use "Copy" to add a second profile, or remove the existing contact there first.`,
        })
      }
    }

    const { archived, clientId: targetClientId, name, role, seniority } = parsed.data

    // Build update payload explicitly to avoid Prisma type inference issues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (role !== undefined) updateData.role = role
    if (seniority !== undefined) updateData.seniority = seniority
    const isArchiving = archived === true && !stakeholder.archivedAt
    if (archived === true) updateData.archivedAt = new Date()
    if (archived === false) updateData.archivedAt = null
    if (targetClientId !== undefined) updateData.clientId = targetClientId

    // Revoke portal access when archiving — null out magic link + revoke all DeliverableAccess
    if (isArchiving) {
      updateData.magicLinkToken = null
      updateData.magicLinkExpiresAt = null
    }

    let updated
    try {
      updated = await prisma.stakeholder.update({
        where: { id: req.params.sid },
        data: updateData,
      })
    } catch (err: unknown) {
      req.log.error({ err }, 'stakeholder update failed')
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: msg })
    }

    // Revoke all active DeliverableAccess grants for this stakeholder (fire-and-forget)
    if (isArchiving) {
      prisma.deliverableAccess.updateMany({
        where: { stakeholderId: req.params.sid, agencyId, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {})
    }

    return reply.send({ data: updated })
  })

  // ── DELETE /:id/stakeholders/:sid ─────────────────────────────────────────
  app.delete<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    // Null out stakeholderId on related records before deleting (no cascade defined)
    try {
      await prisma.feedback.updateMany({ where: { stakeholderId: req.params.sid }, data: { stakeholderId: null } })
      await prisma.stakeholder.deleteMany({ where: { id: req.params.sid } })
    } catch (err) {
      req.log.error(err, 'Failed to delete stakeholder')
      return reply.code(500).send({ error: 'Failed to delete contact' })
    }
    return reply.code(204).send()
  })

  // ── POST /:id/stakeholders/:sid/copy-to — copy stakeholder to another client
  app.post<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/copy-to', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = z.object({ targetClientId: z.string() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'targetClientId required' })

    const source = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!source) return reply.code(404).send({ error: 'Stakeholder not found' })

    const targetClient = await prisma.client.findFirst({ where: { id: parsed.data.targetClientId, agencyId } })
    if (!targetClient) return reply.code(400).send({ error: 'Target client not found' })

    // Check for email collision at target client
    const collision = await prisma.stakeholder.findFirst({
      where: { clientId: parsed.data.targetClientId, email: source.email },
    })
    if (collision) return reply.code(409).send({ error: `A contact with email ${source.email} already exists at ${targetClient.name}` })

    const copy = await prisma.stakeholder.create({
      data: {
        agencyId,
        clientId: parsed.data.targetClientId,
        name: source.name,
        email: source.email,
        role: source.role,
        seniority: source.seniority,
      },
    })

    return reply.code(201).send({ data: copy })
  })

  // ── POST /:id/stakeholders/:sid/send-invite ───────────────────────────────
  app.post<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/send-invite', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

    await prisma.stakeholder.update({
      where: { id: req.params.sid },
      data: { magicLinkToken: token, magicLinkExpiresAt: expiresAt },
    })

    const portalUrl = `${process.env.PORTAL_BASE_URL ?? 'http://localhost:5173'}/portal?token=${token}`

    return reply.send({
      data: {
        token,
        portalUrl,
        expiresAt,
        stakeholder: { id: stakeholder.id, name: stakeholder.name, email: stakeholder.email },
      },
    })
  })

  // ── GET /:id/unknown-editors — Box editors not yet in the system ──────────
  app.get<{ Params: { id: string } }>('/:id/unknown-editors', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const rows = await prisma.humanizerSignal.groupBy({
      by: ['editorEmail'],
      where: {
        agencyId,
        clientId: req.params.id,
        attributedTo: 'unknown_external',
        stakeholderId: null,
        editorEmail: { not: null },
      },
      _count: { id: true },
      _max:   { createdAt: true },
    })

    const data = rows.map((r) => ({
      email:    r.editorEmail!,
      editCount: r._count.id,
      lastSeenAt: r._max.createdAt,
    }))

    return reply.send({ data })
  })

  // ── GET /:id/stakeholders/:sid/feedback ───────────────────────────────────
  app.get<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/feedback', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const feedbacks = await prisma.feedback.findMany({
      where: { stakeholderId: req.params.sid, agencyId },
      include: {
        workflowRun: {
          select: {
            id: true, status: true, createdAt: true,
            workflow: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return reply.send({ data: feedbacks })
  })

  // ── GET /:id/usage — token + activity breakdown for this client ──────────
  app.get<{ Params: { id: string } }>('/:id/usage', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // All workflow runs for this client
    const runs = await prisma.workflowRun.findMany({
      where: { agencyId, workflow: { clientId } },
      select: { id: true, output: true },
    })
    const runIds = runs.map((r) => r.id)
    const runIdSet = new Set(runIds)

    // Fetch all usage records attributed to this client's workflow runs in one shot
    const runRecords = runIds.length
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: { in: ['ai_tokens', 'humanizer_words', 'image_generations', 'video_generations', 'translation_chars', 'detection_call', 'video_intelligence_call', 'assemblyai_seconds', 'voice_generation_chars', 'character_animation_secs', 'music_generation_secs', 'video_composition_secs'] } },
          select: { metric: true, quantity: true, metadata: true },
        })
      : []

    const clientRunRecords = runRecords.filter((r) => {
      const runId = (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      return runId && runIdSet.has(runId)
    })

    // ── Reference rates for cost estimation ────────────────────────────────────
    // These are approximate public list prices. Actual costs depend on plan/volume.
    const RATES = {
      // Anthropic tokens: input / output per million tokens
      tokens: {
        'claude-opus-4-6':         { in: 15.00,  out: 75.00 },
        'claude-sonnet-4-6':       { in: 3.00,   out: 15.00 },
        'claude-sonnet-4-5':       { in: 3.00,   out: 15.00 },
        'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
        'claude-haiku-4-5':        { in: 0.80,   out: 4.00 },
        'gpt-4o':                  { in: 5.00,   out: 15.00 },
        'gpt-4o-mini':             { in: 0.15,   out: 0.60 },
      } as Record<string, { in: number; out: number }>,
      // Image gen: estimated USD per image
      imagePerImage: {
        dalle3: 0.04, openai: 0.04,
        falai: 0.03, fal: 0.03,
        ideogram: 0.08, ideogramai: 0.08,
        leonardo: 0.01, leonardoai: 0.01,
        imagineart: 0.02,
        comfyui: 0, automatic1111: 0, local: 0,
      } as Record<string, number>,
      // Video gen: USD per second of generated video
      videoPerSec: {
        runway: 0.05, kling: 0.075, luma: 0.03, pika: 0.05, lumalabs: 0.03,
        veo2: 0, local: 0,
      } as Record<string, number>,
      // Humanizer: USD per 1000 words
      humPer1kWords: {
        undetectable: 0.50, bypassgpt: 0.30, stealthgpt: 0.40,
        claude: 0, cnhumanizer: 0, humanizeai: 0, local: 0,
      } as Record<string, number>,
      // Detection: USD per call
      detectionPerCall: {
        gptzero: 0.01, originality: 0.01, sapling: 0.01, copyleaks: 0.01,
        local: 0,
      } as Record<string, number>,
      // Translation: USD per 1000 chars
      translationPer1kChars: {
        deepl: 0.025, google: 0.020,
      } as Record<string, number>,
      // AssemblyAI: USD per minute
      assemblyaiPerMin: 0.0065,
    }

    const rate = <T extends Record<string, number>>(map: T, key: string) =>
      map[key.toLowerCase()] ?? map['default'] ?? 0

    // ── AI tokens by model — track input/output separately for accurate cost ────
    const tokensByModel: Record<string, { input: number; output: number; combined: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'ai_tokens')) {
      const meta  = r.metadata as Record<string, unknown>
      const model = (meta['model'] as string) ?? 'unknown'
      if (!tokensByModel[model]) tokensByModel[model] = { input: 0, output: 0, combined: 0 }
      tokensByModel[model].combined += r.quantity
      // Use actual split when available (new records); fall back to 80/20 for old records
      if (meta['inputTokens'] !== undefined && meta['outputTokens'] !== undefined) {
        tokensByModel[model].input  += meta['inputTokens']  as number
        tokensByModel[model].output += meta['outputTokens'] as number
      } else {
        tokensByModel[model].input  += Math.round(r.quantity * 0.8)
        tokensByModel[model].output += Math.round(r.quantity * 0.2)
      }
    }

    // ── Humanizer by service ────────────────────────────────────────────────────
    const humByService: Record<string, number> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'humanizer_words')) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      humByService[service] = (humByService[service] ?? 0) + r.quantity
    }

    // ── Image generation by provider ───────────────────────────────────────────
    const imageByProvider: Record<string, { count: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'image_generations')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? (meta['service'] as string) ?? 'unknown'
      const perImage = rate(RATES.imagePerImage, provider)
      imageByProvider[provider] = imageByProvider[provider] ?? { count: 0, costUsd: 0 }
      imageByProvider[provider].count   += r.quantity
      imageByProvider[provider].costUsd += r.quantity * perImage
    }

    // ── Video generation by provider ────────────────────────────────────────────
    const videoGenByProvider: Record<string, { count: number; secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'video_generations')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? (meta['service'] as string) ?? 'unknown'
      const secs = (meta['durationSecs'] as number) ?? 0
      const perSec = rate(RATES.videoPerSec, provider)
      videoGenByProvider[provider] = videoGenByProvider[provider] ?? { count: 0, secs: 0, costUsd: 0 }
      videoGenByProvider[provider].count   += r.quantity
      videoGenByProvider[provider].secs    += secs
      videoGenByProvider[provider].costUsd += secs * perSec
    }

    // ── Detection by service ────────────────────────────────────────────────────
    const detectionByService: Record<string, { calls: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'detection_call')) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      const perCall = rate(RATES.detectionPerCall, service)
      detectionByService[service] = detectionByService[service] ?? { calls: 0, costUsd: 0 }
      detectionByService[service].calls   += 1
      detectionByService[service].costUsd += perCall
    }

    // ── Translation by provider ─────────────────────────────────────────────────
    const translationByProvider: Record<string, { chars: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'translation_chars')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      const per1k = rate(RATES.translationPer1kChars, provider)
      translationByProvider[provider] = translationByProvider[provider] ?? { chars: 0, costUsd: 0 }
      translationByProvider[provider].chars   += r.quantity
      translationByProvider[provider].costUsd += (r.quantity / 1000) * per1k
    }

    // ── Video intelligence calls (Google Gemini) ────────────────────────────────
    const videoIntelligenceCalls = clientRunRecords.filter((r) => r.metric === 'video_intelligence_call').length

    // AssemblyAI from workflow runs (video transcription node)
    const workflowAssemblyaiSecs = clientRunRecords
      .filter((r) => r.metric === 'assemblyai_seconds')
      .reduce((s, r) => s + r.quantity, 0)

    // Transcription — real-time sessions (Transcription tab)
    const transcriptSessions = await prisma.transcriptSession.findMany({
      where: { agencyId, clientId, status: 'ready' },
      select: { durationSecs: true },
    })
    const transcriptionMinutes = Math.round(
      transcriptSessions.reduce((sum, s) => sum + (s.durationSecs ?? 0), 0) / 60
    )

    // AssemblyAI transcription from Brand / GTM file uploads
    // Query brand + framework attachments for this client, then match UsageRecords
    const [brandAttIds, fwAttIds] = await Promise.all([
      prisma.clientBrandAttachment.findMany({
        where: { agencyId, clientId },
        select: { id: true },
      }).then((rows) => rows.map((r) => r.id)),
      prisma.clientFrameworkAttachment.findMany({
        where: { agencyId, clientId },
        select: { id: true },
      }).then((rows) => rows.map((r) => r.id)),
    ])
    const allAttIds = new Set([...brandAttIds, ...fwAttIds])

    const fileAssemblyaiRecords = allAttIds.size
      ? await prisma.usageRecord.findMany({
          where: { agencyId, metric: 'assemblyai_seconds' },
          select: { quantity: true, metadata: true },
        })
      : []
    const fileAssemblyaiSecs = fileAssemblyaiRecords
      .filter((r) => {
        const attId = (r.metadata as Record<string, unknown>)['attachmentId'] as string | undefined
        return attId && allAttIds.has(attId)
      })
      .reduce((s, r) => s + r.quantity, 0)
    const assemblyaiMinutes = Math.round((workflowAssemblyaiSecs + fileAssemblyaiSecs) / 60)
    const assemblyaiCostUsd = assemblyaiMinutes * RATES.assemblyaiPerMin

    // Brand / GTM files processed for this client
    const [brandFilesReady, fwFilesReady] = await Promise.all([
      prisma.clientBrandAttachment.count({ where: { agencyId, clientId, extractionStatus: 'ready' } }),
      prisma.clientFrameworkAttachment.count({ where: { agencyId, clientId, summaryStatus: 'ready' } }),
    ])

    const totalTokens = Object.values(tokensByModel).reduce((s, v) => s + v.combined, 0)
    const totalHumWords = Object.values(humByService).reduce((s, n) => s + n, 0)

    // AI token cost — uses actual input/output split stored in UsageRecord metadata
    const totalTokensCostUsd = Object.entries(tokensByModel).reduce((sum, [model, counts]) => {
      const r = RATES.tokens[model] ?? RATES.tokens['claude-sonnet-4-5'] ?? { in: 3.00, out: 15.00 }
      return sum + (counts.input / 1_000_000) * r.in + (counts.output / 1_000_000) * r.out
    }, 0)

    // Humanizer cost
    const humBySvcArray = Object.entries(humByService).map(([service, words]) => ({
      service, words,
      costUsd: (words / 1000) * rate(RATES.humPer1kWords, service),
    })).sort((a, b) => b.words - a.words)
    const totalHumCostUsd = humBySvcArray.reduce((s, v) => s + v.costUsd, 0)

    // Detection cost
    const detectionArray = Object.entries(detectionByService).map(([service, d]) => ({ service, ...d })).sort((a, b) => b.calls - a.calls)
    const totalDetectionCalls = detectionArray.reduce((s, v) => s + v.calls, 0)
    const totalDetectionCostUsd = detectionArray.reduce((s, v) => s + v.costUsd, 0)

    // Translation cost
    const translationArray = Object.entries(translationByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.chars - a.chars)
    const totalTranslationChars = translationArray.reduce((s, v) => s + v.chars, 0)
    const totalTranslationCostUsd = translationArray.reduce((s, v) => s + v.costUsd, 0)

    // Image generation totals
    const imageArray = Object.entries(imageByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.count - a.count)
    const totalImagesGenerated = imageArray.reduce((s, v) => s + v.count, 0)
    const totalImageCostUsd = imageArray.reduce((s, v) => s + v.costUsd, 0)

    // Video generation totals
    const videoGenArray = Object.entries(videoGenByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.count - a.count)
    const totalVideosGenerated = videoGenArray.reduce((s, v) => s + v.count, 0)
    const totalVideoGenSecs = videoGenArray.reduce((s, v) => s + v.secs, 0)
    const totalVideoGenCostUsd = videoGenArray.reduce((s, v) => s + v.costUsd, 0)

    // ── Media billing: voice / animation / music / composition ────────────────
    const voiceByProvider: Record<string, { chars: number; secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'voice_generation_chars')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      voiceByProvider[provider] = voiceByProvider[provider] ?? { chars: 0, secs: 0, costUsd: 0 }
      voiceByProvider[provider].chars   += r.quantity
      voiceByProvider[provider].secs    += (meta['durationSecs'] as number) ?? 0
      voiceByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const charAnimByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'character_animation_secs')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      charAnimByProvider[provider] = charAnimByProvider[provider] ?? { secs: 0, costUsd: 0 }
      charAnimByProvider[provider].secs    += r.quantity
      charAnimByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const musicByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of clientRunRecords.filter((r) => r.metric === 'music_generation_secs')) {
      const meta = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      musicByProvider[provider] = musicByProvider[provider] ?? { secs: 0, costUsd: 0 }
      musicByProvider[provider].secs    += r.quantity
      musicByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    const videoCompRecords = clientRunRecords.filter((r) => r.metric === 'video_composition_secs')
    const totalVideoCompSecs = videoCompRecords.reduce((s, r) => s + r.quantity, 0)
    const totalVideoCompCostUsd = videoCompRecords.reduce((s, r) => s + (((r.metadata as Record<string, unknown>)['estimatedCostUsd'] as number) ?? 0), 0)

    const totalVoiceChars   = Object.values(voiceByProvider).reduce((s, v) => s + v.chars, 0)
    const totalVoiceSecs    = Object.values(voiceByProvider).reduce((s, v) => s + v.secs, 0)
    const totalVoiceCostUsd = Object.values(voiceByProvider).reduce((s, v) => s + v.costUsd, 0)
    const totalCharAnimSecs    = Object.values(charAnimByProvider).reduce((s, v) => s + v.secs, 0)
    const totalCharAnimCostUsd = Object.values(charAnimByProvider).reduce((s, v) => s + v.costUsd, 0)
    const totalMusicSecs    = Object.values(musicByProvider).reduce((s, v) => s + v.secs, 0)
    const totalMusicCostUsd = Object.values(musicByProvider).reduce((s, v) => s + v.costUsd, 0)

    // ── Brave Search API usage (direct UsageEvent query — not tied to runs) ──
    const braveEvents = await prisma.usageEvent.findMany({
      where: { agencyId, clientId, provider: 'brave' },
      select: { inputMediaCount: true },
    })
    const braveSearchQueries = braveEvents.reduce((s, e) => s + (e.inputMediaCount ?? 1), 0)

    // Grand total estimated cost across ALL services
    const grandTotalCostUsd =
      totalTokensCostUsd + totalHumCostUsd + totalDetectionCostUsd +
      totalTranslationCostUsd + totalImageCostUsd + totalVideoGenCostUsd +
      totalVoiceCostUsd + totalCharAnimCostUsd + totalMusicCostUsd +
      totalVideoCompCostUsd + assemblyaiCostUsd

    return reply.send({
      data: {
        totalRuns: runIds.length,
        brandFilesReady,
        fwFilesReady,

        // ── AI text generation ─────────────────────────────────────────────
        totalTokens,
        totalTokensCostUsd,
        tokensByModel: Object.entries(tokensByModel).map(([model, counts]) => ({ model, tokens: counts.combined, inputTokens: counts.input, outputTokens: counts.output })).sort((a, b) => b.tokens - a.tokens),

        // ── Humanizer ─────────────────────────────────────────────────────
        totalHumWords,
        totalHumCostUsd,
        humWordsByService: humBySvcArray,

        // ── Image generation ───────────────────────────────────────────────
        totalImagesGenerated,
        totalImageCostUsd,
        imageGeneration: { byProvider: imageArray },

        // ── Video generation ───────────────────────────────────────────────
        totalVideosGenerated,
        totalVideoGenSecs,
        totalVideoGenCostUsd,
        videoGeneration: { byProvider: videoGenArray },

        // ── Voice TTS ──────────────────────────────────────────────────────
        voiceGeneration: {
          totalChars: totalVoiceChars,
          totalSecs: totalVoiceSecs,
          totalCostUsd: totalVoiceCostUsd,
          byProvider: Object.entries(voiceByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.chars - a.chars),
        },

        // ── Character animation ────────────────────────────────────────────
        characterAnimation: {
          totalSecs: totalCharAnimSecs,
          totalCostUsd: totalCharAnimCostUsd,
          byProvider: Object.entries(charAnimByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },

        // ── Music generation ───────────────────────────────────────────────
        musicGeneration: {
          totalSecs: totalMusicSecs,
          totalCostUsd: totalMusicCostUsd,
          byProvider: Object.entries(musicByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },

        // ── Video composition ──────────────────────────────────────────────
        videoComposition: { totalSecs: totalVideoCompSecs, totalCostUsd: totalVideoCompCostUsd },

        // ── AI detection ───────────────────────────────────────────────────
        detectionCalls: totalDetectionCalls,
        totalDetectionCostUsd,
        detectionByService: detectionArray,

        // ── Translation ────────────────────────────────────────────────────
        totalTranslationChars,
        totalTranslationCostUsd,
        translationByProvider: translationArray,

        // ── Transcription ──────────────────────────────────────────────────
        transcriptionMinutes,
        assemblyaiMinutes,
        assemblyaiCostUsd,

        // ── Video intelligence (Google Gemini) ─────────────────────────────
        videoIntelligenceCalls,

        // ── Brave Search API (GTM / company profile enrichment) ────────────
        braveSearchQueries,

        // ── Grand total ────────────────────────────────────────────────────
        grandTotalCostUsd,
      },
    })
  })

  // ── Manual Usage Entries ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/manual-usage', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const entries = await prisma.manualUsageEntry.findMany({
      where: { agencyId, clientId },
      orderBy: { date: 'desc' },
    })
    return reply.send({ data: entries })
  })

  app.post<{ Params: { id: string }; Body: { date: string; service: string; description?: string; quantity: number; unit: string } }>(
    '/:id/manual-usage',
    async (req, reply) => {
      const { agencyId, userId } = req.auth
      const clientId = req.params.id
      const { date, service, description, quantity, unit } = req.body

      if (!date || !service || quantity == null || !unit) {
        return reply.code(400).send({ error: 'date, service, quantity, and unit are required' })
      }

      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      const entry = await prisma.manualUsageEntry.create({
        data: {
          agencyId,
          clientId,
          date: new Date(date),
          service: service.trim(),
          description: description?.trim() || null,
          quantity: Number(quantity),
          unit,
          createdBy: userId ?? null,
        },
      })
      return reply.code(201).send({ data: entry })
    }
  )

  app.delete<{ Params: { id: string; entryId: string } }>('/:id/manual-usage/:entryId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, entryId } = req.params

    const entry = await prisma.manualUsageEntry.findFirst({ where: { id: entryId, agencyId, clientId } })
    if (!entry) return reply.code(404).send({ error: 'Entry not found' })

    await prisma.manualUsageEntry.delete({ where: { id: entryId } })
    return reply.code(204).send()
  })

  // ── GET /:id/stakeholder-stats ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/stakeholder-stats', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId, agencyId, archivedAt: null },
      select: { id: true, name: true, email: true, role: true, seniority: true },
    })

    const stats = await Promise.all(
      stakeholders.map(async (s) => {
        const feedbacks = await prisma.feedback.findMany({
          where: { stakeholderId: s.id, agencyId },
          select: { decision: true, starRating: true, toneFeedback: true, contentTags: true, specificChanges: true, createdAt: true },
        })

        // Decision breakdown
        const decisions: Record<string, number> = {}
        for (const f of feedbacks) {
          const k = f.decision ?? 'no_decision'
          decisions[k] = (decisions[k] ?? 0) + 1
        }

        // Tone preferences
        const tones: Record<string, number> = {}
        for (const f of feedbacks) {
          if (f.toneFeedback) tones[f.toneFeedback] = (tones[f.toneFeedback] ?? 0) + 1
        }

        // Content tags
        const tags: Record<string, number> = {}
        for (const f of feedbacks) {
          const arr = f.contentTags as string[]
          if (Array.isArray(arr)) {
            for (const t of arr) tags[t] = (tags[t] ?? 0) + 1
          }
        }

        // Corrections count
        const totalCorrections = feedbacks.reduce((sum, f) => {
          const arr = f.specificChanges as unknown[]
          return sum + (Array.isArray(arr) ? arr.length : 0)
        }, 0)

        // Avg star rating
        const rated = feedbacks.filter((f) => f.starRating != null)
        const avgRating = rated.length > 0
          ? Math.round((rated.reduce((sum, f) => sum + (f.starRating ?? 0), 0) / rated.length) * 10) / 10
          : null

        // Last active
        const lastFeedback = feedbacks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

        return {
          id: s.id,
          name: s.name,
          email: s.email,
          role: s.role,
          seniority: s.seniority,
          totalFeedback: feedbacks.length,
          totalCorrections,
          avgRating,
          decisions,
          tones,
          tags,
          lastActive: lastFeedback?.createdAt ?? null,
        }
      })
    )

    return reply.send({ data: stats.sort((a, b) => b.totalFeedback - a.totalFeedback) })
  })

  // ── GET /:id/stakeholders/:sid/insights ───────────────────────────────────
  app.get<{ Params: { id: string; sid: string } }>('/:id/stakeholders/:sid/insights', async (req, reply) => {
    const { agencyId } = req.auth

    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: req.params.sid, clientId: req.params.id, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const allInsights = await prisma.insight.findMany({
      where: { clientId: req.params.id, agencyId },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    })

    // Filter to insights that mention this stakeholder
    const insights = allInsights.filter((insight) => {
      const ids = insight.stakeholderIds as string[]
      return Array.isArray(ids) && ids.includes(req.params.sid)
    })

    return reply.send({ data: insights })
  })

  // ── GET /:id/run-intelligence — enriched run history for Content Intelligence tab
  app.get<{ Params: { id: string } }>('/:id/run-intelligence', async (req, reply) => {
    const { agencyId } = req.auth
    const { limit = '50', offset = '0', search = '' } = req.query as Record<string, string>

    const runs = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        workflow: { clientId: req.params.id },
        status: { in: ['completed', 'failed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
      skip: parseInt(offset),
      include: {
        workflow: { select: { id: true, name: true } },
        feedbacks: {
          select: { id: true, decision: true, starRating: true, toneFeedback: true, comment: true, createdAt: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    }) as unknown as Array<{
      id: string; status: string; createdAt: Date; completedAt: Date | null; output: unknown;
      contentHash: string | null;
      workflow: { id: string; name: string } | null;
      feedbacks: Array<{ decision: string; starRating: number | null; comment: string | null }>;
    }>

    // Check which runs have writer examples
    const runIds = runs.map((r) => r.id)
    const writerExamples = runIds.length
      ? await prisma.humanizerExample.findMany({
          where: { agencyId, workflowRunId: { in: runIds }, source: 'writer' },
          select: { workflowRunId: true, id: true },
        })
      : []
    const writerExampleByRun = Object.fromEntries(writerExamples.map((e) => [e.workflowRunId, e.id]))

    // Load node configs for all workflows referenced in these runs
    const wfIds = [...new Set(runs.map((r) => r.workflow?.id).filter(Boolean) as string[])]
    const workflowNodes = wfIds.length
      ? await prisma.node.findMany({
          where: { workflowId: { in: wfIds }, agencyId },
          select: { id: true, workflowId: true, type: true, config: true },
        })
      : []
    const nodeConfigByRunWorkflow: Record<string, Record<string, { type: string; config: Record<string, unknown> }>> = {}
    for (const n of workflowNodes) {
      if (!nodeConfigByRunWorkflow[n.workflowId]) nodeConfigByRunWorkflow[n.workflowId] = {}
      nodeConfigByRunWorkflow[n.workflowId][n.id] = { type: n.type, config: (n.config ?? {}) as Record<string, unknown> }
    }

    const enriched = runs.map((run) => {
      const nodeStatuses = (run.output as Record<string, unknown>)?.nodeStatuses as Record<string, Record<string, unknown>> | undefined
      const nodeConfigs = run.workflow ? (nodeConfigByRunWorkflow[run.workflow.id] ?? {}) : {}

      const llms: { model: string; provider: string; tokens?: number }[] = []
      const humanizers: { service: string; wordsBefore?: number; wordsAfter?: number }[] = []
      const detections: { service: string; scoreBefore?: number; scoreAfter?: number }[] = []
      const translations: { provider: string; targetLanguage: string; chars?: number }[] = []
      let finalWordCount: number | null = null
      const sourceParts: string[] = []

      if (nodeStatuses) {
        for (const [nodeId, ns] of Object.entries(nodeStatuses)) {
          const out = ns.output as Record<string, unknown> | string | undefined
          const nodeDef = nodeConfigs[nodeId]
          const subtype = nodeDef?.config?.subtype as string | undefined
          const nodeType = nodeDef?.type

          // Source label — collect identifiers from ALL source nodes
          if (nodeType === 'source') {
            const cfg = nodeDef?.config as Record<string, unknown> | undefined
            if (subtype === 'file-upload' || subtype === 'document-source') {
              // Filenames are stored in nodeStatus.sourceFiles (set by source executor at runtime)
              const storedFiles = ns.sourceFiles as string[] | undefined
              if (storedFiles && storedFiles.length > 0) {
                sourceParts.push(...storedFiles)
              }
            } else if (subtype === 'url' || subtype === 'web-scrape') {
              const url = (cfg?.url as string) ?? (typeof out === 'string' ? out : '')
              if (url) sourceParts.push(url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] + (url.includes('/') ? '/…' : ''))
            } else if (subtype === 'text-input' || subtype === 'text') {
              const text = (cfg?.content as string) ?? (typeof out === 'string' ? out : '')
              if (text) sourceParts.push('"' + text.trim().slice(0, 40) + (text.length > 40 ? '…' : '') + '"')
            } else if (subtype === 'audio-transcription') {
              const audioFiles = (cfg?.audioFiles as string[] | undefined) ?? []
              if (audioFiles.length > 0) sourceParts.push(...audioFiles.map((f: string) => f.split('/').pop() ?? f))
              else sourceParts.push('Audio')
            }
          }

          // AI Generate — has modelUsed and tokensUsed in nodeStatus
          if (ns.modelUsed && ns.tokensUsed !== undefined) {
            const model = ns.modelUsed as string
            const provider = model.startsWith('claude') ? 'anthropic' : model.startsWith('gpt') || model.startsWith('o') ? 'openai' : 'unknown'
            llms.push({ model, provider, tokens: ns.tokensUsed as number })
          }

          // Humanizer — detect by subtype (wordsProcessed may be missing for loop passes pre-fix)
          if (subtype && (subtype === 'humanizer-pro' || subtype === 'humanizer') && ns.status === 'passed') {
            const service = (nodeDef?.config?.humanizer_service as string) ?? 'auto'
            const humanizedText = typeof out === 'string' ? out : ''
            humanizers.push({
              service,
              wordsBefore: ns.wordsProcessed as number | undefined,
              wordsAfter: humanizedText ? humanizedText.split(/\s+/).filter(Boolean).length : undefined,
            })
          }

          // Detection — output has overall_score
          if (out && typeof out === 'object' && (out as Record<string, unknown>).overall_score !== undefined) {
            const o = out as Record<string, unknown>
            detections.push({
              service: (nodeDef?.config?.service as string) ?? 'unknown',
              scoreAfter: o.overall_score as number,
            })
          }

          // Translation — output has targetLanguage + provider
          if (out && typeof out === 'object') {
            const o = out as Record<string, unknown>
            if (o.targetLanguage && o.provider && o.charCount !== undefined) {
              translations.push({
                provider: o.provider as string,
                targetLanguage: o.targetLanguage as string,
                chars: o.charCount as number,
              })
            }
          }

          // Final word count from output nodes
          if (nodeType === 'output' && out && typeof out === 'object') {
            const o = out as Record<string, unknown>
            if (typeof o.content === 'string') {
              const wc = o.content.split(/\s+/).filter(Boolean).length
              if (wc > (finalWordCount ?? 0)) finalWordCount = wc
            }
          }
        }
      }

      // Filter by search
      const wfName = run.workflow?.name ?? ''
      if (search && !wfName.toLowerCase().includes(search.toLowerCase())) return null

      return {
        id: run.id,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        contentHash: run.contentHash ?? null,
        sourceLabel: sourceParts.length > 0 ? sourceParts.join(' + ') : null,
        workflow: run.workflow,
        llms,
        humanizers,
        detections,
        translations,
        finalWordCount,
        feedback: run.feedbacks[0] ?? null,
        writerExampleId: writerExampleByRun[run.id] ?? null,
      }
    }).filter(Boolean)

    const total = await prisma.workflowRun.count({
      where: { agencyId, workflow: { clientId: req.params.id }, status: { in: ['completed', 'failed'] } },
    })

    return reply.send({ data: enriched, meta: { total } })
  })

  // ── GET /:id/profiles — list all brand profiles ──────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profiles = await prisma.clientProfile.findMany({
      where: { clientId, agencyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, label: true, status: true, crawledFrom: true, updatedAt: true, createdAt: true },
    })
    return reply.send({ data: profiles })
  })

  // ── POST /:id/profiles — create new brand profile ────────────────────────────
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/:id/profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientProfile.create({
      data: { agencyId, clientId, label: req.body?.label ?? null },
    })
    return reply.code(201).send({ data: profile })
  })

  // ── GET /:id/profiles/:profileId ─────────────────────────────────────────────
  app.get<{ Params: { id: string; profileId: string } }>('/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const profile = await prisma.clientProfile.findFirst({
      where: { id: req.params.profileId, clientId: req.params.id, agencyId },
    })
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    return reply.send({ data: profile })
  })

  // ── GET /:id/profile — compat: get first active profile ──────────────────────
  app.get<{ Params: { id: string } }>('/:id/profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientProfile.findFirst({
      where: { clientId, agencyId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    }) ?? await prisma.clientProfile.create({ data: { agencyId, clientId } })
    return reply.send({ data: profile })
  })

  // ── PUT /:id/profile — upsert client profile ─────────────────────────────────
  const profileBody = z.object({
    brandTone:                   z.string().optional(),
    formality:                   z.enum(['formal', 'semi-formal', 'casual']).optional(),
    pov:                         z.enum(['first_person', 'second_person', 'third_person']).optional(),
    signaturePhrases:            z.array(z.string()).optional(),
    avoidPhrases:                z.array(z.string()).optional(),
    primaryBuyer:                z.record(z.unknown()).optional(),
    secondaryBuyer:              z.record(z.unknown()).optional(),
    buyerMotivations:            z.array(z.string()).optional(),
    buyerFears:                  z.array(z.string()).optional(),
    visualStyle:                 z.string().optional(),
    colorTemperature:            z.enum(['warm', 'cool', 'neutral']).optional(),
    photographyVsIllustration:   z.enum(['photography', 'illustration', 'mixed']).optional(),
    approvedVisualThemes:        z.array(z.string()).optional(),
    avoidVisual:                 z.array(z.string()).optional(),
    currentPositioning:          z.string().optional(),
    campaignThemesApproved:      z.array(z.string()).optional(),
    manualOverrides:             z.array(z.record(z.unknown())).optional(),
    confidenceMap:               z.record(z.string()).optional(),
    crawledFrom:                 z.string().optional(),
    sources:                     z.array(z.object({ url: z.string(), label: z.string(), addedAt: z.string().optional() })).optional(),
  })

  // ── PUT /:id/profiles/:profileId — update specific brand profile ─────────────
  app.put<{ Params: { id: string; profileId: string }; Body: z.infer<typeof profileBody> & { label?: string } }>(
    '/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params

    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })

    const parsed = profileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const data = parsed.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSafe = (v: unknown) => (v as any) ?? undefined

    const profileData = {
      label:                      (req.body as { label?: string }).label ?? existing.label,
      brandTone:                  data.brandTone,
      formality:                  data.formality,
      pov:                        data.pov,
      signaturePhrases:           jsonSafe(data.signaturePhrases),
      avoidPhrases:               jsonSafe(data.avoidPhrases),
      primaryBuyer:               jsonSafe(data.primaryBuyer),
      secondaryBuyer:             jsonSafe(data.secondaryBuyer),
      buyerMotivations:           jsonSafe(data.buyerMotivations),
      buyerFears:                 jsonSafe(data.buyerFears),
      visualStyle:                data.visualStyle,
      colorTemperature:           data.colorTemperature,
      photographyVsIllustration:  data.photographyVsIllustration,
      approvedVisualThemes:       jsonSafe(data.approvedVisualThemes),
      avoidVisual:                jsonSafe(data.avoidVisual),
      currentPositioning:         data.currentPositioning,
      campaignThemesApproved:     jsonSafe(data.campaignThemesApproved),
      manualOverrides:            jsonSafe(data.manualOverrides),
      confidenceMap:              jsonSafe(data.confidenceMap),
      crawledFrom:                data.crawledFrom,
      sources:                    jsonSafe(data.sources),
    }

    const profile = await prisma.clientProfile.update({ where: { id: profileId }, data: profileData })
    return reply.send({ data: profile })
  })

  // ── PATCH /:id/profiles/:profileId — archive/unarchive brand profile ──────────
  app.patch<{ Params: { id: string; profileId: string }; Body: { status?: string; label?: string } }>(
    '/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })
    const profile = await prisma.clientProfile.update({
      where: { id: profileId },
      data: { status: req.body?.status ?? existing.status, label: req.body?.label ?? existing.label },
    })
    return reply.send({ data: profile })
  })

  // ── DELETE /:id/profiles/:profileId — delete brand profile ───────────────────
  app.delete<{ Params: { id: string; profileId: string } }>('/:id/profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Profile not found' })
    await prisma.clientProfile.delete({ where: { id: profileId } })
    return reply.code(204).send()
  })

  // ── PUT /:id/profile — compat: update first active brand profile ──────────────
  app.put<{ Params: { id: string }; Body: z.infer<typeof profileBody> }>('/:id/profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const parsed = profileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    const data = parsed.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSafe = (v: unknown) => (v as any) ?? undefined
    const profileData = {
      brandTone: data.brandTone, formality: data.formality, pov: data.pov,
      signaturePhrases: jsonSafe(data.signaturePhrases), avoidPhrases: jsonSafe(data.avoidPhrases),
      primaryBuyer: jsonSafe(data.primaryBuyer), secondaryBuyer: jsonSafe(data.secondaryBuyer),
      buyerMotivations: jsonSafe(data.buyerMotivations), buyerFears: jsonSafe(data.buyerFears),
      visualStyle: data.visualStyle, colorTemperature: data.colorTemperature,
      photographyVsIllustration: data.photographyVsIllustration,
      approvedVisualThemes: jsonSafe(data.approvedVisualThemes), avoidVisual: jsonSafe(data.avoidVisual),
      currentPositioning: data.currentPositioning, campaignThemesApproved: jsonSafe(data.campaignThemesApproved),
      manualOverrides: jsonSafe(data.manualOverrides), confidenceMap: jsonSafe(data.confidenceMap),
      crawledFrom: data.crawledFrom, sources: jsonSafe(data.sources),
    }
    let profile = await prisma.clientProfile.findFirst({ where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    if (profile) {
      profile = await prisma.clientProfile.update({ where: { id: profile.id }, data: profileData })
    } else {
      profile = await prisma.clientProfile.create({ data: { agencyId, clientId, ...profileData } })
    }
    return reply.send({ data: profile })
  })

  // ── POST /:id/profiles/:profileId/autofill — autofill specific brand profile ──
  app.post<{ Params: { id: string; profileId: string }; Body: { url: string } }>('/:id/profiles/:profileId/autofill', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const profileId = req.params.profileId
    const { url } = req.body ?? {}

    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ error: 'url is required' })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const { model: brainModel } = await getModelForRole('brain_processing')

    // ── 1. Fetch website content ────────────────────────────────────────────
    let rawHtml = ''
    try {
      const siteRes = await fetch(url, {
        headers: { 'User-Agent': 'ContentNode-ProfileBot/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      rawHtml = await siteRes.text()
    } catch (err) {
      return reply.code(422).send({ error: `Could not fetch ${url} — check the URL and try again` })
    }

    // ── 2. Strip HTML to readable text ──────────────────────────────────────
    const textContent = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 12000)

    if (textContent.length < 100) {
      return reply.code(422).send({ error: 'Could not extract readable content from that URL' })
    }

    // ── 3. Ask Claude to extract all profile fields ─────────────────────────
    const prompt = `You are a brand strategist building a detailed client profile from a company's website content.

Client name: ${client.name}
Industry: ${client.industry ?? 'unknown'}
Website URL: ${url}

Website content (extracted text):
${textContent}

Analyze this content and extract a complete brand profile. Return ONLY valid JSON matching this exact shape — no markdown, no explanation:

{
  "brandTone": "concise description of the brand's voice and tone",
  "formality": "formal" | "semi-formal" | "casual",
  "pov": "first_person" | "second_person" | "third_person",
  "signaturePhrases": ["phrase1", "phrase2"],
  "avoidPhrases": ["phrase or pattern to avoid"],
  "primaryBuyer": {
    "title": "job title or persona name",
    "age_range": "e.g. 30-50",
    "pain_points": ["pain 1", "pain 2"],
    "goals": ["goal 1", "goal 2"]
  },
  "secondaryBuyer": {
    "title": "",
    "age_range": "",
    "pain_points": [],
    "goals": []
  },
  "buyerMotivations": ["motivation 1", "motivation 2"],
  "buyerFears": ["fear 1", "fear 2"],
  "visualStyle": "description of visual aesthetic",
  "colorTemperature": "warm" | "cool" | "neutral",
  "photographyVsIllustration": "photography" | "illustration" | "mixed",
  "approvedVisualThemes": ["theme 1", "theme 2"],
  "avoidVisual": ["visual element to avoid"],
  "currentPositioning": "1-2 sentence description of how they position themselves",
  "campaignThemesApproved": ["recurring theme 1", "recurring theme 2"],
  "confidenceMap": {
    "brandTone": "crawled",
    "formality": "crawled",
    "pov": "crawled",
    "signaturePhrases": "crawled",
    "avoidPhrases": "inferred",
    "primaryBuyer": "inferred",
    "secondaryBuyer": "inferred",
    "buyerMotivations": "inferred",
    "buyerFears": "inferred",
    "visualStyle": "crawled",
    "colorTemperature": "inferred",
    "photographyVsIllustration": "crawled",
    "currentPositioning": "crawled",
    "campaignThemesApproved": "crawled"
  }
}

Rules:
- Only use "crawled" confidence for things explicitly stated on the site
- Use "inferred" for things you derived from context
- signaturePhrases: actual phrases or taglines used repeatedly on the site (2-6 items)
- avoidPhrases: language inconsistent with their brand (2-4 items based on what's clearly absent)
- Be specific and actionable — vague answers like "professional" are unhelpful
- If you cannot determine something, use an empty string or empty array`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: brainModel,
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      return reply.code(502).send({ error: 'AI service unavailable' })
    }

    const aiBody = await aiRes.json() as { content: Array<{ text: string }> }
    const text = aiBody.content?.[0]?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return reply.code(422).send({ error: 'AI could not extract profile data — try a different URL' })

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(match[0])
    } catch {
      return reply.code(422).send({ error: 'AI returned malformed data — try again' })
    }

    // ── 4. Update the specific profile record with extracted data ────────────
    const existingProfile = await prisma.clientProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existingProfile) return reply.code(404).send({ error: 'Profile not found' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any

    const brandData = {
      brandTone:                 extracted.brandTone as string ?? null,
      formality:                 extracted.formality as string ?? null,
      pov:                       extracted.pov as string ?? null,
      signaturePhrases:          js(extracted.signaturePhrases ?? []),
      avoidPhrases:              js(extracted.avoidPhrases ?? []),
      primaryBuyer:              js(extracted.primaryBuyer ?? {}),
      secondaryBuyer:            js(extracted.secondaryBuyer ?? {}),
      buyerMotivations:          js(extracted.buyerMotivations ?? []),
      buyerFears:                js(extracted.buyerFears ?? []),
      visualStyle:               extracted.visualStyle as string ?? null,
      colorTemperature:          extracted.colorTemperature as string ?? null,
      photographyVsIllustration: extracted.photographyVsIllustration as string ?? null,
      approvedVisualThemes:      js(extracted.approvedVisualThemes ?? []),
      avoidVisual:               js(extracted.avoidVisual ?? []),
      currentPositioning:        extracted.currentPositioning as string ?? null,
      campaignThemesApproved:    js(extracted.campaignThemesApproved ?? []),
      confidenceMap:             js(extracted.confidenceMap ?? {}),
      crawledFrom:               url,
      lastCrawledAt:             new Date(),
      crawledSnapshot:           js(extracted),
      label:                     existingProfile.label ?? new URL(url).hostname,
    }
    const profile = await prisma.clientProfile.update({ where: { id: profileId }, data: brandData })

    return reply.send({ data: profile })
  })

  // ── GET /:id/company-profile ──────────────────────────────────────────────────
  // ── GET /:id/company-profiles — list all company profiles ────────────────────
  app.get<{ Params: { id: string } }>('/:id/company-profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profiles = await prisma.companyProfile.findMany({
      where: { clientId, agencyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, label: true, status: true, crawledFrom: true, about: true, industry: true, updatedAt: true, createdAt: true },
    })
    return reply.send({ data: profiles })
  })

  // ── POST /:id/company-profiles — create new company profile ──────────────────
  app.post<{ Params: { id: string }; Body: { label?: string } }>('/:id/company-profiles', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.companyProfile.create({
      data: { agencyId, clientId, label: req.body?.label ?? null },
    })
    return reply.code(201).send({ data: profile })
  })

  // ── GET /:id/company-profiles/:profileId — get specific company profile ───────
  app.get<{ Params: { id: string; profileId: string } }>('/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const profile = await prisma.companyProfile.findFirst({
      where: { id: req.params.profileId, clientId: req.params.id, agencyId },
    })
    if (!profile) return reply.code(404).send({ error: 'Company profile not found' })
    return reply.send({ data: profile })
  })

  // ── GET /:id/company-profile — compat: get/create first active company profile ─
  app.get<{ Params: { id: string } }>('/:id/company-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.companyProfile.findFirst({
      where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' },
    }) ?? await prisma.companyProfile.create({ data: { agencyId, clientId } })
    return reply.send({ data: profile })
  })

  // ── Schema for company profile body ──────────────────────────────────────────
  const companyProfileBody = z.object({
    label:               z.string().optional(),
    about:               z.string().optional(),
    founded:             z.string().optional(),
    headquarters:        z.string().optional(),
    industry:            z.string().optional(),
    globalReach:         z.string().optional(),
    companyCategory:     z.string().optional(),
    businessType:        z.string().optional(),
    employees:           z.string().optional(),
    coreValues:          z.array(z.string()).optional(),
    keyAchievements:     z.array(z.string()).optional(),
    leadershipMessage:   z.string().optional(),
    leadershipTeam:      z.array(z.record(z.unknown())).optional(),
    whatTheyDo:          z.string().optional(),
    keyOfferings:        z.array(z.string()).optional(),
    industriesServed:    z.array(z.string()).optional(),
    partners:            z.array(z.string()).optional(),
    milestones:          z.array(z.string()).optional(),
    visionForFuture:     z.string().optional(),
    website:             z.string().optional(),
    generalInquiries:    z.string().optional(),
    phone:               z.string().optional(),
    headquartersAddress: z.string().optional(),
    crawledFrom:         z.string().optional(),
    sources:             z.array(z.object({ url: z.string(), label: z.string(), addedAt: z.string().optional() })).optional(),
  })

  // ── PUT /:id/company-profiles/:profileId — update specific company profile ────
  app.put<{ Params: { id: string; profileId: string }; Body: z.infer<typeof companyProfileBody> }>(
    '/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    const parsed = companyProfileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any
    const d = parsed.data
    const data = {
      label: d.label ?? existing.label,
      about: d.about, founded: d.founded, headquarters: d.headquarters,
      industry: d.industry, globalReach: d.globalReach, companyCategory: d.companyCategory,
      businessType: d.businessType, employees: d.employees,
      coreValues: js(d.coreValues), keyAchievements: js(d.keyAchievements),
      leadershipMessage: d.leadershipMessage, leadershipTeam: js(d.leadershipTeam),
      whatTheyDo: d.whatTheyDo, keyOfferings: js(d.keyOfferings),
      industriesServed: js(d.industriesServed), partners: js(d.partners),
      milestones: js(d.milestones), visionForFuture: d.visionForFuture,
      website: d.website, generalInquiries: d.generalInquiries,
      phone: d.phone, headquartersAddress: d.headquartersAddress,
      crawledFrom: d.crawledFrom, sources: js(d.sources),
    }
    const profile = await prisma.companyProfile.update({ where: { id: profileId }, data })
    return reply.send({ data: profile })
  })

  // ── PATCH /:id/company-profiles/:profileId — archive/label ───────────────────
  app.patch<{ Params: { id: string; profileId: string }; Body: { status?: string; label?: string } }>(
    '/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    const profile = await prisma.companyProfile.update({
      where: { id: profileId },
      data: { status: req.body?.status ?? existing.status, label: req.body?.label ?? existing.label },
    })
    return reply.send({ data: profile })
  })

  // ── DELETE /:id/company-profiles/:profileId ───────────────────────────────────
  app.delete<{ Params: { id: string; profileId: string } }>('/:id/company-profiles/:profileId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, profileId } = req.params
    const existing = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Company profile not found' })
    await prisma.companyProfile.delete({ where: { id: profileId } })
    return reply.code(204).send()
  })

  // ── PUT /:id/company-profile — compat: update first active company profile ────
  app.put<{ Params: { id: string }; Body: z.infer<typeof companyProfileBody> }>('/:id/company-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const parsed = companyProfileBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any
    const d = parsed.data
    const data = {
      about: d.about, founded: d.founded, headquarters: d.headquarters,
      industry: d.industry, globalReach: d.globalReach, companyCategory: d.companyCategory,
      businessType: d.businessType, employees: d.employees,
      coreValues: js(d.coreValues), keyAchievements: js(d.keyAchievements),
      leadershipMessage: d.leadershipMessage, leadershipTeam: js(d.leadershipTeam),
      whatTheyDo: d.whatTheyDo, keyOfferings: js(d.keyOfferings),
      industriesServed: js(d.industriesServed), partners: js(d.partners),
      milestones: js(d.milestones), visionForFuture: d.visionForFuture,
      website: d.website, generalInquiries: d.generalInquiries,
      phone: d.phone, headquartersAddress: d.headquartersAddress,
      crawledFrom: d.crawledFrom, sources: js(d.sources),
    }
    let profile = await prisma.companyProfile.findFirst({ where: { clientId, agencyId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
    if (profile) {
      profile = await prisma.companyProfile.update({ where: { id: profile.id }, data })
    } else {
      profile = await prisma.companyProfile.create({ data: { agencyId, clientId, ...data } })
    }
    return reply.send({ data: profile })
  })

  // ── POST /:id/company-profiles/:profileId/autofill — autofill company profile ─
  app.post<{ Params: { id: string; profileId: string }; Body: { url: string } }>('/:id/company-profiles/:profileId/autofill', async (req, reply) => {
    try {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const profileId = req.params.profileId
    const { url } = req.body ?? {}
    if (!url || typeof url !== 'string') return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const [{ model: brainModel }, { model: fastModel }] = await Promise.all([
      getModelForRole('brain_processing'),
      getModelForRole('generation_fast'),
    ])

    // ── Use shared research helper (same logic as GTM Assessment scrape) ──────
    const r = await researchCompanyFromUrl(url, client.name, apiKey, { agencyId, clientId, userId: req.auth.userId }, { brainModel, fastModel })

    const existingCompanyProfile = await prisma.companyProfile.findFirst({ where: { id: profileId, clientId, agencyId } })
    if (!existingCompanyProfile) return reply.code(404).send({ error: 'Company profile not found' })

    const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const js = (v: unknown) => v as any

    const companyData = {
      label:             existingCompanyProfile.label ?? hostname,
      about:             r.about,              founded:           r.founded,
      headquarters:      r.headquarters,       industry:          r.industry,
      globalReach:       r.globalReach,        companyCategory:   r.companyCategory,
      businessType:      r.businessType,       employees:         r.employees,
      coreValues:        js(r.coreValues),     keyAchievements:   js(r.keyAchievements),
      leadershipMessage: r.leadershipMessage,  leadershipTeam:    js(r.leadershipTeam),
      whatTheyDo:        r.whatTheyDo,         keyOfferings:      js(r.keyOfferings),
      industriesServed:  js(r.industriesServed.split(', ').filter(Boolean)),
      partners:          js(r.partners),       milestones:        js(r.milestones),
      visionForFuture:   r.visionForFuture,    website:           url,
      generalInquiries:  r.generalInquiries,   phone:             r.phone,
      headquartersAddress: r.headquartersAddress,
      crawledFrom: url, lastCrawledAt: new Date(), crawledSnapshot: js(r),
    }
    const profile = await prisma.companyProfile.update({ where: { id: profileId }, data: companyData })
    return reply.send({ data: profile })
    } catch (err) {
      req.log.error({ err, profileId: req.params.profileId, clientId: req.params.id }, '[autofill] unhandled error')
      return reply.code(500).send({ error: (err instanceof Error ? err.message : String(err)) })
    }
  })

  // ── GET /:id/framework — return GTM framework data for a client
  // ── GET /:id/verticals — list verticals assigned to a client
  app.get<{ Params: { id: string } }>('/:id/verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const assignments = await prisma.clientVertical.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { vertical: { select: { id: true, name: true, dimensionType: true, color: true, parentVerticalId: true, mondayBoardId: true, boxFolderId: true } } },
      orderBy: { vertical: { name: 'asc' } },
    })
    return reply.send({ data: assignments.map((a) => a.vertical) })
  })

  // ── POST /:id/verticals — assign a vertical to a client
  app.post<{ Params: { id: string } }>('/:id/verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = z.object({ verticalId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'verticalId is required' })
    const { verticalId } = parsed.data

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.clientVertical.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId } },
      create: { agencyId, clientId: req.params.id, verticalId },
      update: {},
    })
    return reply.code(201).send({ data: vertical })
  })

  // ── DELETE /:id/verticals/:verticalId — unassign a vertical from a client
  app.delete<{ Params: { id: string; verticalId: string } }>('/:id/verticals/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    await prisma.clientVertical.deleteMany({
      where: { clientId: req.params.id, verticalId: req.params.verticalId, agencyId },
    })
    return reply.code(204).send()
  })

  // ── GET /:id/framework/:verticalId — return GTM framework for client+vertical
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const fw = await prisma.clientFramework.findUnique({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
    })
    return reply.send({ data: fw?.data ?? null, sectionStatus: (fw?.sectionStatus as Record<string, string> | null) ?? {} })
  })

  // ── GET /:id/demand-gen/base — return company-wide demand gen data for a client
  app.get<{ Params: { id: string } }>('/:id/demand-gen/base', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const record = await prisma.clientDemandGenBase.findUnique({ where: { clientId: req.params.id } })
    return reply.send({ data: record?.data ?? null })
  })

  // ── PUT /:id/demand-gen/base — upsert company-wide demand gen data for a client
  app.put<{ Params: { id: string } }>('/:id/demand-gen/base', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Invalid body' })
    if (JSON.stringify(body).length > 5 * 1024 * 1024) return reply.code(400).send({ error: 'Body too large' })
    const record = await prisma.clientDemandGenBase.upsert({
      where: { clientId: req.params.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: record.data })
  })

  // ── POST /:id/demand-gen/ai-fill — AI assistant: fill a section using brain context
  app.post<{ Params: { id: string }; Body: { section: string; current: unknown; verticalId?: string; verticalName?: string } }>(
    '/:id/demand-gen/ai-fill',
    async (req, reply) => {
      const { agencyId } = req.auth
      const clientId = req.params.id
      const aiBody = z.object({
        section:      z.string().min(1).max(100),
        current:      z.unknown().optional(),
        verticalId:   z.string().optional(),
        verticalName: z.string().max(200).optional(),
      }).safeParse(req.body)
      if (!aiBody.success) return reply.code(400).send({ error: 'section is required' })
      const { section, current, verticalId, verticalName } = aiBody.data

      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: {
          name: true, industry: true, brainContext: true,
          brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
          brandBuilders: { take: 1, orderBy: { createdAt: 'desc' }, select: { dataJson: true } },
        },
      })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      const [brainDocs, gtm, dgBase, { model: researchModel }] = await Promise.all([
        prisma.clientBrainAttachment.findMany({
          where: { clientId, agencyId, summaryStatus: 'ready' },
          select: { filename: true, summary: true, source: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.clientGTMAssessment.findUnique({ where: { clientId } }),
        prisma.clientDemandGenBase.findUnique({ where: { clientId } }),
        getModelForRole('research_synthesis'),
      ])

      const brandProfile = client.brandProfiles[0]
      const brandBuilder = client.brandBuilders[0]
      const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson ?? brandBuilder?.dataJson

      const ctx: string[] = [`CLIENT: ${client.name}`]
      if (client.industry) ctx.push(`INDUSTRY: ${client.industry}`)
      if (verticalName) ctx.push(`VERTICAL: ${verticalName}`)
      if (brandData) {
        const b = brandData as Record<string, unknown>
        if (b.positioning ?? b.value_proposition) ctx.push(`POSITIONING: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
        if (b.target_audience ?? b.audience) ctx.push(`TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
      }
      if (client.brainContext?.trim()) ctx.push(`\nCLIENT BRAIN:\n${client.brainContext.trim()}`)
      if (brainDocs.length > 0) {
        ctx.push('\nKNOWLEDGE BASE:')
        for (const doc of brainDocs) {
          if (doc.summary?.trim()) ctx.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
        }
      }
      if (gtm?.data) ctx.push(`\nGTM ASSESSMENT:\n${JSON.stringify(gtm.data).slice(0, 2000)}`)
      if (dgBase?.data) ctx.push(`\nEXISTING DEMAND GEN (company level):\n${JSON.stringify(dgBase.data).slice(0, 1500)}`)

      // Also pull vertical brain if verticalId provided
      if (verticalId) {
        const [vertical, verticalAttachments] = await Promise.all([
          prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { brainContext: true } }),
          prisma.verticalBrainAttachment.findMany({ where: { verticalId, agencyId, summaryStatus: 'ready' }, select: { filename: true, summary: true }, orderBy: { createdAt: 'desc' }, take: 4 }),
        ])
        if (vertical?.brainContext?.trim()) ctx.push(`\nVERTICAL BRAIN:\n${vertical.brainContext.trim()}`)
        for (const doc of verticalAttachments) {
          if (doc.summary?.trim()) ctx.push(`[vertical] ${doc.filename}:\n${doc.summary.trim()}`)
        }
      }

      const sectionLabels: Record<string, string> = {
        b1: 'Revenue & Growth Goals (funding stage, runway, growth targets)',
        b2: 'Sales Process & CRM (methodology, CRM, cycle, stages, follow-up)',
        b3: 'Marketing Budget & Resources (budget, team, agencies, tech stack)',
        s1: 'Current Marketing Reality (active channels, existing assets)',
        s2: 'Offer Clarity (offers with outcome/guarantee, proof points)',
        s3: 'ICP + Buying Psychology (personas: triggers, failed solutions, objections, values)',
        s4: 'Revenue Goals + Constraints (campaign targets, lead volumes, budgets, close rates)',
        s5: 'Sales Process Alignment (demand gen view: method, CRM, pipeline handoffs)',
        s6: 'Hidden Gold (customer stories, FAQs)',
        s7: 'External Intelligence (market findings from reviews, Reddit, competitors)',
      }

      const result = await callModel(
        {
          provider: 'anthropic',
          model: researchModel,
          api_key_ref: 'ANTHROPIC_API_KEY',
          max_tokens: 1800,
          temperature: 0.4,
        },
        `You are a demand generation strategist filling out a client intake form.

${ctx.join('\n')}

TASK: Fill the "${section.toUpperCase()}" section — ${sectionLabels[section] ?? section}.

CURRENT DATA (to be filled — empty fields need values, filled fields should be preserved):
${JSON.stringify(current, null, 2)}

Return ONLY a valid JSON object in EXACTLY the same structure as the current data above.
Rules:
- Preserve any fields that already have non-empty values — do not overwrite existing content.
- Fill empty string fields with specific, realistic values derived from the client context.
- For arrays with one empty item: replace with 1–3 filled items (do not exceed 3).
- Do NOT include "id" fields in your response — they will be added automatically.
- Apply demand gen industry standards appropriate for this client's industry and stage.
- Be specific. Use real-sounding data from context. No generic placeholders like "Company Name".
- If you cannot infer a value from context, leave it as an empty string.

Return ONLY the JSON. No explanation, no markdown fences.`,
      )

      let suggestion: unknown = current
      try {
        const text = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
        suggestion = JSON.parse(text)
      } catch { /* return current as fallback */ }

      return reply.send({ data: { suggestion } })
    }
  )

  // ── GET /:id/demand-gen/:verticalId — return demand gen data for a client+vertical
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/demand-gen/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const record = await prisma.clientDemandGen.findUnique({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
    })
    return reply.send({ data: record?.data ?? null })
  })

  // ── PUT /:id/demand-gen/:verticalId — upsert demand gen data for a client+vertical
  app.put<{ Params: { id: string; verticalId: string } }>('/:id/demand-gen/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })

    const record = await prisma.clientDemandGen.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, verticalId: req.params.verticalId, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: record.data })
  })

  // ── GET /:id/gtm-assessment — return GTM assessment data for a client
  app.get<{ Params: { id: string } }>('/:id/gtm-assessment', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const record = await prisma.clientGTMAssessment.findUnique({ where: { clientId: req.params.id } })
    return reply.send({ data: record?.data ?? null })
  })

  // ── PUT /:id/gtm-assessment — upsert GTM assessment data for a client
  app.put<{ Params: { id: string } }>('/:id/gtm-assessment', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })
    const record = await prisma.clientGTMAssessment.upsert({
      where: { clientId: req.params.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })
    return reply.send({ data: record.data })
  })

  // ── POST /:id/gtm-assessment/draft — AI-draft a single field using form data + client brain
  app.post<{ Params: { id: string } }>('/:id/gtm-assessment/draft', async (req, reply) => {
    const { agencyId } = req.auth
    const { sectionNum, sectionTitle, fieldLabel, currentValue, formData } =
      (req.body ?? {}) as {
        sectionNum?: string; sectionTitle?: string
        fieldLabel?: string; currentValue?: string
        formData?: Record<string, unknown>
      }

    if (!sectionNum || !fieldLabel) return reply.code(400).send({ error: 'sectionNum and fieldLabel are required' })

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Flatten form data into readable key: value lines (skip empty strings, ids, arrays-of-objects)
    function flattenFormData(obj: Record<string, unknown>, prefix = ''): string[] {
      const lines: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'id') continue
        const key = prefix ? `${prefix} > ${k}` : k
        if (typeof v === 'string' && v.trim()) {
          lines.push(`${key}: ${v.trim()}`)
        } else if (Array.isArray(v)) {
          v.forEach((item, i) => {
            if (item && typeof item === 'object') {
              lines.push(...flattenFormData(item as Record<string, unknown>, `${key}[${i + 1}]`))
            }
          })
        } else if (v && typeof v === 'object') {
          lines.push(...flattenFormData(v as Record<string, unknown>, key))
        }
      }
      return lines
    }

    const formLines = formData ? flattenFormData(formData) : []

    // Pull ready brain attachments for context
    const brainDocs = await prisma.clientBrainAttachment.findMany({
      where: {
        clientId: req.params.id,
        agencyId,
        summaryStatus: 'ready',
        source: { in: ['client', 'gtm_framework', 'demand_gen', 'branding'] },
      },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'asc' },
      take: 12,
    })

    // Need at least something to work with — form data alone is enough
    if (formLines.length === 0 && brainDocs.length === 0) {
      return reply.code(422).send({ error: 'Fill in at least a few fields or upload files to the Client Brain first.' })
    }

    const brainBlock = brainDocs
      .filter((d) => d.summary?.trim())
      .map((d) => `--- ${d.filename} ---\n${d.summary}`)
      .join('\n\n')

    const { model: brainModel } = await getModelForRole('brain_processing')

    const result = await callModel(
      {
        provider: 'anthropic',
        model: brainModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens: 500,
        temperature: 0.3,
      },
      `You are filling in a Company Assessment for a prospective client.

CLIENT: ${client.name}
SECTION: ${sectionNum} — ${sectionTitle ?? ''}
FIELD TO FILL: ${fieldLabel}

${formLines.length > 0 ? `ASSESSMENT DATA ALREADY FILLED IN (use this as primary context):
${formLines.join('\n')}

` : ''}${brainBlock ? `ADDITIONAL CONTEXT (from uploaded documents):
${brainBlock}

` : ''}${currentValue ? `CURRENT VALUE (may be partial):\n${currentValue}\n\n` : ''}Fill in "${fieldLabel}" using the context above. Rules:
- Be concise and data-based. Prefer short phrases, numbers, and bullets over prose.
- For list fields: return one item per line, no bullets or numbers, max 5 items.
- For single-value fields: one short phrase or sentence, max 15 words.
- No preamble, no label, no explanation. Return ONLY the value.`,
    )

    return reply.send({ data: { draft: result.text.trim() } })
  })

  // ── POST /:id/gtm-assessment/scrape — scrape a website and extract assessment data
  // Uses researchCompanyFromUrl() — same 3-layer pipeline as company-profiles autofill
  app.post<{ Params: { id: string } }>('/:id/gtm-assessment/scrape', async (req, reply) => {
    try {
    const { agencyId } = req.auth
    const { url } = (req.body ?? {}) as { url?: string }
    if (!url?.trim()) return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(500).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const [{ model: brainModel }, { model: fastModel }] = await Promise.all([
      getModelForRole('brain_processing'),
      getModelForRole('generation_fast'),
    ])

    const clientId = req.params.id
    const r = await researchCompanyFromUrl(url, client.name, apiKey, { agencyId, clientId, userId: req.auth.userId }, { brainModel, fastModel })

    const uid = () => Math.random().toString(36).slice(2)
    const partial = {
      meta: {
        scrapedAt: new Date().toISOString(),
        references: r._sources,
      },
      s1: {
        legalName:             r.legalName,
        doingBusinessAs:       r.doingBusinessAs,
        founded:               r.founded,
        hq:                    r.headquarters,
        employeeCount:         r.employees,
        revenueRange:          r.revenueRange,
        fundingStage:          r.fundingStage,
        investors:             r.investors,
        industry:              r.industry,
        companyCategory:       r.companyCategory,
        businessType:          r.businessType,
        globalReach:           r.globalReach,
        about:                 r.about,
        whatTheyDo:            r.whatTheyDo,
        productServiceSummary: r.productServiceSummary,
        visionForFuture:       r.visionForFuture,
        leadershipMessage:     r.leadershipMessage,
        keyOfferings:          r.keyOfferings.join('\n'),
        industriesServedList:  r.industriesServed,
        coreValues:            r.coreValues.join('\n'),
        keyAchievements:       r.keyAchievements.join('\n'),
        partners:              r.partners.join('\n'),
        milestones:            r.milestones.join('\n'),
        generalInquiries:      r.generalInquiries,
        phone:                 r.phone,
        headquartersAddress:   r.headquartersAddress,
        ...(r.leadershipTeam.length > 0 ? {
          keyExecutives: r.leadershipTeam.map((m) => ({
            id: uid(), name: m.name, title: m.title, linkedIn: m.linkedin,
          })),
        } : {}),
      },
      // S2 — seed competitor names from search if found
      ...(r.competitorNames ? {
        s2: {
          competitors: r.competitorNames.split(',').slice(0, 6).map((name) => ({
            id: uid(), name: name.trim(), website: '', strengths: '', weaknesses: '', howClientDiffers: '',
          })).filter((c) => c.name),
        },
      } : {}),
      s3: {
        messagingStatement: r.messagingStatement,
        valueProp:          r.valueProp,
        keyMessage1:        r.keyMessage1,
        keyMessage2:        r.keyMessage2,
        keyMessage3:        r.keyMessage3,
        toneOfVoice:        r.toneOfVoice,
        currentTagline:     r.currentTagline,
      },
      s4: {
        goToMarketMotion: r.goToMarketMotion,
      },
      s5: {
        websiteStrengths: r.websiteStrengths,
        contentTypes:     r.contentTypes,
        // Social profiles found in website footer/header links
        ...(Object.keys(r.socialProfiles).length > 0 ? {
          social: Object.entries(r.socialProfiles).map(([platform, profileUrl]) => ({
            id: uid(), platform, handle: profileUrl, activityLevel: '',
          })),
        } : {}),
      },
      s6: {
        geographies: r.geographies,
      },
      s7: {
        brandAttributes:  r.brandAttributes,
        toneAdjectives:   r.toneAdjectives,
        brandPersonality: r.brandPersonality,
      },
    }

    return reply.send({
      data: partial,
      meta: {
        braveEnabled: !!process.env.BRAVE_SEARCH_API_KEY,
        socialProfilesFound: Object.keys(r.socialProfiles).length,
      },
    })
    } catch (err) {
      req.log.error({ err }, '[gtm-assessment/scrape] unhandled error')
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ── POST /:id/gtm-assessment/save-to-brain — format and save assessment as a brain document
  app.post<{ Params: { id: string } }>('/:id/gtm-assessment/save-to-brain', async (req, reply) => {
    const { agencyId } = req.auth
    const body = (req.body ?? {}) as Record<string, unknown>

    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Flatten the assessment into a readable text document
    function flattenSection(obj: Record<string, unknown>, sectionTitle: string): string {
      const lines: string[] = [`\n## ${sectionTitle}\n`]
      const scan = (o: Record<string, unknown>, prefix = '') => {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'id') continue
          const label = prefix ? `${prefix} > ${k}` : k
          if (typeof v === 'string' && v.trim()) lines.push(`**${label}:** ${v.trim()}`)
          else if (Array.isArray(v)) v.forEach((item, i) => { if (item && typeof item === 'object') scan(item as Record<string, unknown>, `${k} ${i + 1}`) })
          else if (v && typeof v === 'object') scan(v as Record<string, unknown>, label)
        }
      }
      scan(obj)
      return lines.join('\n')
    }

    const sectionMap: Record<string, string> = {
      s1: 'Company Snapshot', s2: 'Competitive Landscape', s3: 'Current GTM Positioning',
      s4: 'Channel & Partner Strategy', s5: 'Content & Digital Presence',
      s6: 'Target Segments & Verticals', s7: 'Brand & Visual Identity', s8: 'Goals & Success Metrics',
    }

    const sections = Object.entries(sectionMap)
      .map(([key, title]) => body[key] ? flattenSection(body[key] as Record<string, unknown>, title) : '')
      .filter(Boolean)
      .join('\n')

    const content = `# Company Assessment — ${client.name}\n\nGenerated: ${new Date().toLocaleDateString()}\n${sections}`

    // Store as a text brain attachment (source: client)
    const encoder = new TextEncoder()
    const bytes = encoder.encode(content)
    const filename = `Company Assessment — ${client.name}.md`

    // Use the existing brain attachment upsert pattern — write as a synthetic text file
    const existing = await prisma.clientBrainAttachment.findFirst({
      where: { clientId: req.params.id, agencyId, filename, source: 'client' },
    })

    if (existing) {
      await prisma.clientBrainAttachment.update({
        where: { id: existing.id },
        data: {
          summary: content,
          summaryStatus: 'ready',
          extractionStatus: 'done',
          sizeBytes: bytes.length,
        },
      })
    } else {
      await prisma.clientBrainAttachment.create({
        data: {
          agencyId,
          clientId: req.params.id,
          filename,
          storageKey: null,
          mimeType: 'text/markdown',
          sizeBytes: bytes.length,
          extractionStatus: 'done',
          summaryStatus: 'ready',
          summary: content,
          source: 'client',
          uploadMethod: 'assessment',
        },
      })
    }

    return reply.send({ data: { ok: true, filename } })
  })

  // ── GET /:id/gtm-assessment/report — generate brand-styled HTML report with creative direction
  app.get<{ Params: { id: string } }>('/:id/gtm-assessment/report', async (req, reply) => {
    try {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const assessment = await prisma.clientGTMAssessment.findUnique({ where: { clientId: req.params.id } })
    if (!assessment) return reply.code(404).send({ error: 'No assessment found for this client' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = assessment.data as any
    const s1 = d?.s1 ?? {}; const s2 = d?.s2 ?? {}; const s3 = d?.s3 ?? {}
    const s4 = d?.s4 ?? {}; const s5 = d?.s5 ?? {}; const s6 = d?.s6 ?? {}
    const s7 = d?.s7 ?? {}; const s8 = d?.s8 ?? {}
    const refs: Array<{ url: string; label: string }> = Array.isArray(d?.meta?.references) ? d.meta.references : []
    const scrapedAt: string | undefined = d?.meta?.scrapedAt

    // ── Parse brand colors from s7.primaryColors ──────────────────────────────
    const rawColors = (s7.primaryColors ?? '') as string
    const colorMatches = [...rawColors.matchAll(/#[0-9A-Fa-f]{3,6}/g)].map((m) => m[0])
    const primaryColor   = colorMatches[0] ?? '#1A2E5E'
    const accentColor    = colorMatches[1] ?? '#4F8EF7'
    const bgColor        = '#F8F9FB'
    const textColor      = '#1C1C2E'

    // ── Generate Creative Direction appendix via Claude ───────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY
    const { model: primaryModel } = await getModelForRole('generation_primary')
    let creativeDirection = ''
    if (apiKey) {
      const snap = [
        s1.legalName && `Company: ${s1.legalName}`,
        s1.founded && `Founded: ${s1.founded}`,
        s3.messagingStatement && `Positioning: ${s3.messagingStatement}`,
        s3.valueProp && `Value Prop: ${s3.valueProp}`,
        s7.brandAttributes && `Brand Attributes: ${s7.brandAttributes}`,
        s7.toneAdjectives && `Tone: ${s7.toneAdjectives}`,
        s7.brandPersonality && `Brand Personality: ${s7.brandPersonality}`,
        s7.primaryColors && `Brand Colors: ${s7.primaryColors}`,
        s7.fontNotes && `Fonts: ${s7.fontNotes}`,
        s8.goals90Day && `90-Day Goal: ${s8.goals90Day}`,
        s8.goals12Month && `12-Month Goal: ${s8.goals12Month}`,
      ].filter(Boolean).join('\n')

      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: primaryModel, max_tokens: 2500, temperature: 0.3,
            messages: [{ role: 'user', content: `You are a senior creative director producing a presentation design brief for an agency's internal team.

Based on this Company Assessment data, generate slide-by-slide creative direction for a 12-15 slide executive presentation. The presentation should follow a professional GTM strategy deck structure and visually reflect the brand's identity.

ASSESSMENT SUMMARY:
${snap}

Write detailed creative direction for EACH slide. For every slide include:
1. Slide title and purpose (1 line)
2. Layout recommendation (e.g. "full-bleed left panel with headline right", "2-column split", "data-card grid")
3. Visual direction: imagery style, iconography, color usage from brand palette
4. Copy guidance: tone, length, key messages to feature
5. Design notes: spacing, emphasis, call-to-action if any

Use the brand attributes and personality to inform the visual and tonal direction throughout. Be specific and actionable — your team should be able to open PowerPoint/Figma and start designing immediately from these notes.

Output as clean HTML using <h3> for slide titles, <ul> for bullet points. Do not use markdown. Do not wrap in code blocks. Start directly with <h3>Slide 1: ...</h3>.` }],
          }),
        })
        if (aiRes.ok) {
          const body = await aiRes.json() as { content: Array<{ text: string }> }
          creativeDirection = body.content?.[0]?.text ?? ''
        }
      } catch { /* continue without creative direction */ }
    }

    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const val = (v: unknown) => v && String(v).trim() ? esc(v) : '<span style="color:#aaa">—</span>'
    const row = (label: string, value: unknown) => value && String(value).trim()
      ? `<tr><td style="font-weight:600;padding:6px 12px 6px 0;vertical-align:top;white-space:nowrap;color:#555;width:38%;font-size:13px">${esc(label)}</td><td style="padding:6px 0;font-size:13px">${val(value)}</td></tr>`
      : ''
    const section = (num: string, title: string, content: string) => `
<div class="section" style="page-break-before:always">
  <div class="section-header" style="background:${primaryColor};color:#fff;padding:18px 32px;margin:-32px -32px 24px -32px;display:flex;align-items:center;gap:12px">
    <span style="font-size:11px;font-weight:700;opacity:.65;letter-spacing:.12em;text-transform:uppercase">Section ${num}</span>
    <span style="font-size:20px;font-weight:700">${esc(title)}</span>
  </div>
  <div style="padding:0 4px">${content}</div>
</div>`

    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Company Assessment — ${esc(s1.legalName || client.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: ${s7.fontNotes && s7.fontNotes.toLowerCase().includes('mont') ? 'Montserrat, ' : ''}${s7.fontNotes && s7.fontNotes.toLowerCase().includes('inter') ? 'Inter, ' : ''}system-ui, -apple-system, sans-serif; color: ${textColor}; background: ${bgColor}; font-size: 14px; line-height: 1.6 }
  .page { max-width: 900px; margin: 0 auto; background: #fff; min-height: 100vh }
  .cover { background: ${primaryColor}; color: #fff; padding: 80px 60px 60px; min-height: 360px; display: flex; flex-direction: column; justify-content: flex-end }
  .cover-tag { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; opacity: .65; margin-bottom: 12px }
  .cover-title { font-size: 38px; font-weight: 800; line-height: 1.15; margin-bottom: 8px }
  .cover-sub { font-size: 16px; opacity: .75; margin-bottom: 40px }
  .cover-meta { display: flex; gap: 40px }
  .cover-meta-item { display: flex; flex-direction: column; gap: 2px }
  .cover-meta-label { font-size: 10px; font-weight: 700; opacity: .55; letter-spacing: .1em; text-transform: uppercase }
  .cover-meta-value { font-size: 13px; font-weight: 600 }
  .toc { padding: 40px 60px; border-bottom: 1px solid #eee }
  .toc h2 { font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #888; margin-bottom: 16px }
  .toc-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px dotted #e8e8e8; font-size: 13px }
  .toc-num { font-size: 11px; font-weight: 700; color: ${primaryColor}; width: 24px }
  .section { padding: 32px 32px 40px; border-bottom: 1px solid #eee }
  table { width: 100%; border-collapse: collapse }
  .key-msg { background: ${bgColor}; border-left: 3px solid ${accentColor}; padding: 10px 14px; margin: 6px 0; border-radius: 0 6px 6px 0; font-size: 13px }
  .competitor-card { border: 1px solid #e8e8e8; border-radius: 8px; padding: 14px 16px; margin: 10px 0 }
  .competitor-name { font-weight: 700; font-size: 14px; color: ${primaryColor}; margin-bottom: 8px }
  .badge { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; background: ${accentColor}22; color: ${primaryColor}; margin-right: 6px }
  .kpi-row td { padding: 8px 12px; font-size: 13px }
  .kpi-row:nth-child(odd) td { background: ${bgColor} }
  .goal-box { background: ${primaryColor}0D; border: 1px solid ${primaryColor}22; border-radius: 8px; padding: 14px 16px; margin: 8px 0 }
  .goal-label { font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: ${primaryColor}; margin-bottom: 6px }
  .creative-dir { background: #f0f4ff; border-radius: 10px; padding: 24px 28px; margin-top: 8px }
  .creative-dir h3 { font-size: 14px; font-weight: 700; color: ${primaryColor}; margin: 20px 0 6px; padding-top: 16px; border-top: 1px solid #d0d8f0 }
  .creative-dir h3:first-child { border-top: none; padding-top: 0; margin-top: 0 }
  .creative-dir ul { padding-left: 20px; margin: 4px 0 }
  .creative-dir li { margin: 3px 0; font-size: 13px; color: #333 }
  .print-btn { position: fixed; top: 20px; right: 20px; background: ${primaryColor}; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 12px ${primaryColor}44; z-index: 999 }
  @media print { .print-btn { display: none } body { background: #fff } .page { box-shadow: none } .section { page-break-inside: avoid } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">⬇ Save as PDF</button>
<div class="page">

  <!-- Cover -->
  <div class="cover">
    <div class="cover-tag">Company Assessment</div>
    <div class="cover-title">${esc(s1.legalName || s1.doingBusinessAs || client.name)}</div>
    ${s3.messagingStatement ? `<div class="cover-sub">${esc(s3.messagingStatement)}</div>` : ''}
    <div class="cover-meta">
      <div class="cover-meta-item"><span class="cover-meta-label">Prepared</span><span class="cover-meta-value">${date}</span></div>
      ${s1.hq ? `<div class="cover-meta-item"><span class="cover-meta-label">Headquarters</span><span class="cover-meta-value">${esc(s1.hq)}</span></div>` : ''}
      ${s1.employeeCount ? `<div class="cover-meta-item"><span class="cover-meta-label">Team Size</span><span class="cover-meta-value">${esc(s1.employeeCount)}</span></div>` : ''}
      ${s1.fundingStage ? `<div class="cover-meta-item"><span class="cover-meta-label">Stage</span><span class="cover-meta-value">${esc(s1.fundingStage)}</span></div>` : ''}
    </div>
  </div>

  <!-- Table of Contents -->
  <div class="toc">
    <h2>Contents</h2>
    ${['Company Snapshot','Competitive Landscape','GTM Positioning','Channel & Partner Strategy','Content & Digital Presence','Target Segments & Verticals','Brand & Visual Identity','Goals & Success Metrics','Creative Direction',...(refs.length > 0 ? ['References'] : [])].map((t, i) => `<div class="toc-item"><span class="toc-num">${String(i + 1).padStart(2, '0')}</span><span>${t}</span></div>`).join('')}
  </div>

  ${section('01', 'Company Snapshot', `
    <table>
      ${row('Legal Name', s1.legalName)}
      ${row('DBA', s1.doingBusinessAs)}
      ${row('Founded', s1.founded)}
      ${row('Headquarters', s1.hq)}
      ${row('Employees', s1.employeeCount)}
      ${row('Revenue Range', s1.revenueRange)}
      ${row('Funding Stage', s1.fundingStage)}
    </table>
    ${s1.productServiceSummary ? `<p style="margin-top:16px;font-size:14px;line-height:1.7;color:#333">${esc(s1.productServiceSummary)}</p>` : ''}
    ${Array.isArray(s1.keyExecutives) && s1.keyExecutives.filter((e: { name?: string }) => e.name).length > 0 ? `
      <p style="margin-top:20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Key Executives</p>
      <table>${s1.keyExecutives.filter((e: { name?: string }) => e.name).map((e: { name?: string; title?: string }) => `<tr><td style="padding:4px 12px 4px 0;font-weight:600;font-size:13px">${esc(e.name)}</td><td style="padding:4px 0;font-size:13px;color:#555">${esc(e.title)}</td></tr>`).join('')}</table>
    ` : ''}
  `)}

  ${section('02', 'Competitive Landscape', `
    ${s2.competitivePosition ? `<p style="font-size:14px;line-height:1.7;margin-bottom:16px">${esc(s2.competitivePosition)}</p>` : ''}
    ${Array.isArray(s2.competitors) && s2.competitors.filter((c: { name?: string }) => c.name).length > 0 ? s2.competitors.filter((c: { name?: string }) => c.name).map((c: { name?: string; website?: string; strengths?: string; weaknesses?: string; howClientDiffers?: string }) => `
      <div class="competitor-card">
        <div class="competitor-name">${esc(c.name)}${c.website ? ` <span style="font-size:11px;font-weight:400;color:#999">${esc(c.website)}</span>` : ''}</div>
        ${c.strengths ? `<div style="font-size:13px;margin-bottom:4px"><strong>Strengths:</strong> ${esc(c.strengths)}</div>` : ''}
        ${c.weaknesses ? `<div style="font-size:13px;margin-bottom:4px"><strong>Weaknesses:</strong> ${esc(c.weaknesses)}</div>` : ''}
        ${c.howClientDiffers ? `<div style="font-size:13px;color:${primaryColor};font-weight:600;margin-top:6px">How client differs: ${esc(c.howClientDiffers)}</div>` : ''}
      </div>
    `).join('') : ''}
    ${row('Win/Loss Patterns', s2.winLossPatterns)}
    ${s2.landmines ? `<p style="margin-top:12px;background:#fff8f0;border-left:3px solid #f97316;padding:10px 14px;font-size:13px"><strong>Landmines:</strong> ${esc(s2.landmines)}</p>` : ''}
  `)}

  ${section('03', 'Current GTM Positioning', `
    ${s3.messagingStatement ? `<div style="font-size:17px;font-weight:700;color:${primaryColor};line-height:1.4;margin-bottom:16px">"${esc(s3.messagingStatement)}"</div>` : ''}
    <table>
      ${row('ICP', s3.icp)}
      ${row('Value Proposition', s3.valueProp)}
      ${row('Tone of Voice', s3.toneOfVoice)}
      ${row('Current Tagline', s3.currentTagline)}
      ${row('Biggest Positioning Gap', s3.biggestPositioningGap)}
    </table>
    ${(s3.keyMessage1 || s3.keyMessage2 || s3.keyMessage3) ? `
      <p style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px">Key Messages</p>
      ${s3.keyMessage1 ? `<div class="key-msg">${esc(s3.keyMessage1)}</div>` : ''}
      ${s3.keyMessage2 ? `<div class="key-msg">${esc(s3.keyMessage2)}</div>` : ''}
      ${s3.keyMessage3 ? `<div class="key-msg">${esc(s3.keyMessage3)}</div>` : ''}
    ` : ''}
  `)}

  ${section('04', 'Channel & Partner Strategy', `
    <table>
      ${row('GTM Motion', s4.goToMarketMotion)}
      ${row('Partner Types', s4.partnerTypes)}
      ${row('Partner Programs', s4.partnerPrograms)}
      ${row('Channel Gaps', s4.channelGaps)}
    </table>
    ${Array.isArray(s4.channels) && s4.channels.filter((c: { name?: string }) => c.name).length > 0 ? `
      <p style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Channels</p>
      <table style="border:1px solid #eee;border-radius:6px;overflow:hidden">
        <thead><tr style="background:${bgColor}"><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Channel</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Type</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Status</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Notes</th></tr></thead>
        <tbody>${s4.channels.filter((c: { name?: string }) => c.name).map((c: { name?: string; type?: string; status?: string; notes?: string }) => `<tr style="border-top:1px solid #eee"><td style="padding:8px 12px;font-size:13px;font-weight:600">${esc(c.name)}</td><td style="padding:8px 12px;font-size:13px">${esc(c.type)}</td><td style="padding:8px 12px;font-size:13px">${c.status ? `<span class="badge">${esc(c.status)}</span>` : ''}</td><td style="padding:8px 12px;font-size:13px;color:#555">${esc(c.notes)}</td></tr>`).join('')}</tbody>
      </table>
    ` : ''}
  `)}

  ${section('05', 'Content & Digital Presence', `
    <table>
      ${row('Website', s5.websiteUrl || s1.websiteUrl)}
      ${row('Website Strengths', s5.websiteStrengths)}
      ${row('Website Weaknesses', s5.websiteWeaknesses)}
      ${row('Content Types', s5.contentTypes)}
      ${row('SEO Maturity', s5.seoMaturity)}
      ${row('Content Gaps', s5.contentGaps)}
    </table>
    ${Array.isArray(s5.social) && s5.social.filter((s: { platform?: string }) => s.platform).length > 0 ? `
      <p style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Social Presence</p>
      <table>${s5.social.filter((s: { platform?: string }) => s.platform).map((s: { platform?: string; handle?: string; activityLevel?: string }) => `<tr><td style="padding:5px 12px 5px 0;font-weight:600;font-size:13px;width:30%">${esc(s.platform)}</td><td style="padding:5px 12px 5px 0;font-size:13px;color:#555">${esc(s.handle)}</td><td style="padding:5px 0;font-size:13px">${s.activityLevel ? `<span class="badge">${esc(s.activityLevel)}</span>` : ''}</td></tr>`).join('')}</table>
    ` : ''}
  `)}

  ${section('06', 'Target Segments & Verticals', `
    <table>
      ${row('Geographies', s6.geographies)}
      ${row('Customer Size Range', s6.customerSizeRange)}
      ${row('Top Use Cases', s6.topUseCases)}
      ${row('Underserved Segments', s6.underservedSegments)}
    </table>
    ${Array.isArray(s6.primaryVerticals) && s6.primaryVerticals.filter((v: { name?: string }) => v.name).length > 0 ? `
      <p style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Primary Verticals</p>
      ${s6.primaryVerticals.filter((v: { name?: string }) => v.name).map((v: { name?: string; whyGoodFit?: string; currentPenetration?: string; expansionPotential?: string }) => `
        <div class="competitor-card">
          <div class="competitor-name">${esc(v.name)}</div>
          ${v.whyGoodFit ? `<div style="font-size:13px;margin-bottom:4px"><strong>Why a good fit:</strong> ${esc(v.whyGoodFit)}</div>` : ''}
          ${v.currentPenetration ? `<div style="font-size:13px;margin-bottom:4px"><strong>Current penetration:</strong> ${esc(v.currentPenetration)}</div>` : ''}
          ${v.expansionPotential ? `<div style="font-size:13px"><strong>Expansion potential:</strong> ${esc(v.expansionPotential)}</div>` : ''}
        </div>
      `).join('')}
    ` : ''}
  `)}

  ${section('07', 'Brand & Visual Identity', `
    <table>
      ${row('Brand Attributes', s7.brandAttributes)}
      ${row('Tone Adjectives', s7.toneAdjectives)}
      ${row('Brand Personality', s7.brandPersonality)}
      ${row('Brand Guidelines', s7.existingGuidelines)}
      ${row('Font Notes', s7.fontNotes)}
      ${row('Brand Strengths', s7.brandStrengths)}
      ${row('Brand Weaknesses', s7.brandWeaknesses)}
    </table>
    ${rawColors ? `
      <p style="margin-top:16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Brand Colors</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${colorMatches.map((c) => `<div style="display:flex;align-items:center;gap:6px"><div style="width:28px;height:28px;border-radius:6px;background:${c};border:1px solid #ddd"></div><span style="font-size:12px;font-family:monospace;color:#555">${c}</span></div>`).join('')}
      </div>
      <p style="margin-top:8px;font-size:13px;color:#555">${esc(rawColors)}</p>
    ` : ''}
  `)}

  ${section('08', 'Goals & Success Metrics', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${s8.goals90Day ? `<div class="goal-box"><div class="goal-label">90-Day Goals</div><p style="font-size:13px">${esc(s8.goals90Day)}</p></div>` : ''}
      ${s8.goals12Month ? `<div class="goal-box"><div class="goal-label">12-Month Goals</div><p style="font-size:13px">${esc(s8.goals12Month)}</p></div>` : ''}
    </div>
    ${Array.isArray(s8.kpis) && s8.kpis.filter((k: { metric?: string }) => k.metric).length > 0 ? `
      <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px">Key Performance Indicators</p>
      <table style="border:1px solid #eee;border-radius:6px;overflow:hidden">
        <thead><tr style="background:${bgColor}"><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Metric</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Current Baseline</th><th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:700;color:#666">Target</th></tr></thead>
        <tbody>${s8.kpis.filter((k: { metric?: string }) => k.metric).map((k: { metric?: string; currentBaseline?: string; target?: string }) => `<tr class="kpi-row"><td style="padding:8px 12px;font-size:13px;font-weight:600">${esc(k.metric)}</td><td style="padding:8px 12px;font-size:13px;color:#555">${esc(k.currentBaseline)}</td><td style="padding:8px 12px;font-size:13px;color:${primaryColor};font-weight:600">${esc(k.target)}</td></tr>`).join('')}</tbody>
      </table>
    ` : ''}
    <table style="margin-top:12px">
      ${row('How They Define Success', s8.successDefinition)}
      ${row('Known Blockers', s8.knownBlockers)}
      ${row('Existing Wins to Build On', s8.existingWins)}
      ${row('Budget Range', s8.budgetRange)}
    </table>
  `)}

  ${creativeDirection ? `
  <div class="section" style="page-break-before:always">
    <div class="section-header" style="background:${accentColor};color:#fff;padding:18px 32px;margin:-32px -32px 24px -32px;display:flex;align-items:center;gap:12px">
      <span style="font-size:11px;font-weight:700;opacity:.65;letter-spacing:.12em;text-transform:uppercase">Appendix A</span>
      <span style="font-size:20px;font-weight:700">Creative Direction</span>
    </div>
    <p style="font-size:13px;color:#666;margin-bottom:16px">Slide-by-slide design and copy brief for your internal team. Use this to build the executive presentation from this Company Assessment.</p>
    <div class="creative-dir">${creativeDirection}</div>
  </div>
  ` : ''}

  ${refs.length > 0 ? `
  <div class="section" style="page-break-before:always">
    <div class="section-header" style="background:#64748b;color:#fff;padding:18px 32px;margin:-32px -32px 24px -32px;display:flex;align-items:center;gap:12px">
      <span style="font-size:11px;font-weight:700;opacity:.65;letter-spacing:.12em;text-transform:uppercase">${creativeDirection ? 'Appendix B' : 'Appendix A'}</span>
      <span style="font-size:20px;font-weight:700">References</span>
    </div>
    ${scrapedAt ? `<p style="font-size:12px;color:#888;margin-bottom:16px">Sources crawled and enriched during the Scrape & Fill run on ${new Date(scrapedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.</p>` : '<p style="font-size:12px;color:#888;margin-bottom:16px">Sources crawled and enriched during the last Scrape &amp; Fill run.</p>'}
    <ol style="padding-left:20px;margin:0;space-y:8px">
      ${refs.map((r) => `<li style="margin-bottom:10px;font-size:13px"><span style="font-weight:600;color:#333">${esc(r.label)}</span><br><a href="${esc(r.url)}" style="color:#3b82f6;font-size:12px;word-break:break-all">${esc(r.url)}</a></li>`).join('')}
    </ol>
  </div>
  ` : ''}

</div>
</body>
</html>`

    return reply.type('text/html').send(html)
    } catch (err) {
      req.log.error({ err }, '[gtm-assessment/report] unhandled error')
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ── PUT /:id/framework/:verticalId — upsert GTM framework for client+vertical
  app.put<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' })

    const fw = await prisma.clientFramework.upsert({
      where: { clientId_verticalId: { clientId: req.params.id, verticalId: req.params.verticalId } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { agencyId, clientId: req.params.id, verticalId: req.params.verticalId, data: body as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { data: body as any },
    })

    // Sync framework into brain as a text attachment so program runner + AI tools can use it
    try {
      const verticalRecord = await prisma.vertical.findFirst({ where: { id: req.params.verticalId, agencyId }, select: { name: true } })
      const clientRecord   = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { name: true } })
      const vName = verticalRecord?.name ?? req.params.verticalId
      const cName = clientRecord?.name ?? req.params.id
      const lines: string[] = [`GTM Framework — ${cName} / ${vName}`]
      const flatten = (obj: unknown, prefix = ''): void => {
        if (!obj || typeof obj !== 'object') return
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (Array.isArray(v)) { v.forEach((item, i) => flatten(item, `${prefix}${k}[${i}].`)) }
          else if (v && typeof v === 'object') { flatten(v, `${prefix}${k}.`) }
          else if (typeof v === 'string' && v.trim()) { lines.push(`${prefix}${k}: ${v.trim()}`) }
        }
      }
      flatten(body)
      const content = lines.join('\n')
      const filename = `GTM Framework — ${vName}.md`
      const existing = await prisma.clientBrainAttachment.findFirst({
        where: { clientId: req.params.id, agencyId, filename, source: 'gtm_framework' },
      })
      if (existing) {
        await prisma.clientBrainAttachment.update({
          where: { id: existing.id },
          data: { extractedText: content, summary: content, summaryStatus: 'ready', extractionStatus: 'done', sizeBytes: content.length },
        })
      } else {
        await prisma.clientBrainAttachment.create({
          data: {
            agencyId, clientId: req.params.id, filename,
            storageKey: null, mimeType: 'text/markdown', sizeBytes: content.length,
            extractionStatus: 'done', summaryStatus: 'ready',
            extractedText: content, summary: content,
            source: 'gtm_framework', uploadMethod: 'framework',
          },
        })
      }
    } catch (err) {
      console.error('[framework/save] brain sync failed (non-fatal):', err)
    }

    return reply.send({ data: fw.data })
  })

  // ── POST /:id/framework/:verticalId/reimport — analyse edited DOCX, return field diff preview
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/reimport', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk as Buffer)
    const buffer = Buffer.concat(chunks)

    let docText: string
    try {
      const mammoth = await getMammothForReimport()
      const result = await mammoth.convertToHtml({ buffer })
      docText = result.value
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
    } catch {
      return reply.code(422).send({ error: 'Failed to read .docx file — ensure it is a valid Word document' })
    }

    if (docText.length < 50) {
      return reply.code(422).send({ error: 'Document appears to be empty' })
    }

    const fw = await prisma.clientFramework.findUnique({
      where: { clientId_verticalId: { clientId, verticalId } },
    })
    const currentData = (fw?.data as Record<string, unknown>) ?? {}

    const variableList = GTM_VARIABLES.map((v) => `- ${v.id}: ${v.label} — ${v.description}`).join('\n')

    const prompt = `You are analyzing an edited GTM Framework document to extract updated field values and detect writing style preferences.

Return ONLY a JSON object in this exact format:
{
  "fields": {
    "variable_id": "extracted content text"
  },
  "styleSignals": [
    { "type": "spelling|punctuation|formality|structure", "rule": "concise rule", "example": "exact word or phrase from document", "confidence": "high|medium|low" }
  ]
}

Rules:
- Only include field IDs that have clear corresponding content in the document
- Field values are the actual content, not descriptions of it — copy the relevant text
- Detect up to 6 style signals: spelling variants (-ize vs -ise, -or vs -our), Oxford comma usage, sentence length preference, formality level, list formatting, capitalization style
- Style signals must cite an actual example from the document
- No markdown, no extra text outside the JSON

GTM Variable IDs:
${variableList}

Document text:
${docText.slice(0, 12000)}`

    let fields: Record<string, string> = {}
    let styleSignals: Array<{ type: string; rule: string; example: string; confidence: string }> = []

    const { model: generationPrimaryModel } = await getModelForRole('generation_primary')

    try {
      const result = await callModel(
        { provider: 'anthropic', model: generationPrimaryModel, temperature: 0.1, api_key_ref: 'ANTHROPIC_API_KEY' },
        prompt,
      )
      const cleaned = result.text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { fields?: Record<string, string>; styleSignals?: unknown[] }
      if (parsed.fields && typeof parsed.fields === 'object') fields = parsed.fields as Record<string, string>
      if (Array.isArray(parsed.styleSignals)) styleSignals = parsed.styleSignals as typeof styleSignals
    } catch (err) {
      req.log.error({ err }, '[framework/reimport] Claude analysis failed')
      return reply.code(500).send({ error: 'AI analysis failed' })
    }

    const updatedFields: Array<{ id: string; label: string; oldValue: string; newValue: string }> = []
    for (const [id, newValue] of Object.entries(fields)) {
      const trimmed = (typeof newValue === 'string' ? newValue : '').trim()
      if (!trimmed) continue
      const oldValue = typeof currentData[id] === 'string' ? (currentData[id] as string) : ''
      if (trimmed !== oldValue) {
        const meta = GTM_VARIABLES.find((v) => v.id === id)
        updatedFields.push({ id, label: meta?.label ?? id, oldValue, newValue: trimmed })
      }
    }

    return reply.send({ data: { updatedFields, styleSignals, totalUpdated: updatedFields.length } })
  })

  // ── GET /:id/framework-revisions — list all framework revisions for reviews tab
  app.get<{ Params: { id: string } }>('/:id/framework-revisions', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const revisions = await prisma.frameworkRevision.findMany({
      where: { clientId: req.params.id, agencyId },
      include: { vertical: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return reply.send({ data: revisions })
  })

  // ── POST /:id/framework/:verticalId/revisions — create revision snapshot (called on download)
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/revisions', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const fw = await prisma.clientFramework.findUnique({
      where: { clientId_verticalId: { clientId, verticalId } },
    })

    const body = (req.body ?? {}) as { revisionType?: string; notes?: string; assigneeId?: string }

    const revision = await prisma.frameworkRevision.create({
      data: {
        agencyId,
        clientId,
        verticalId,
        reviewStatus: 'draft',
        revisionType: body.revisionType ?? 'internal',
        assigneeId:   body.assigneeId ?? null,
        dataSnapshot: fw?.data ?? {},
        notes:        body.notes ?? null,
        exportedAt:   new Date(),
      },
    })
    return reply.code(201).send({ data: revision })
  })

  // ── PATCH /:id/framework/:verticalId/revisions/:revisionId — update review status / type / notes
  app.patch<{ Params: { id: string; verticalId: string; revisionId: string } }>(
    '/:id/framework/:verticalId/revisions/:revisionId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, revisionId } = req.params

      const revision = await prisma.frameworkRevision.findFirst({
        where: { id: revisionId, clientId, verticalId, agencyId },
      })
      if (!revision) return reply.code(404).send({ error: 'Revision not found' })

      const body = (req.body ?? {}) as {
        reviewStatus?: string
        revisionType?: string
        assigneeId?: string
        notes?: string
        clientSnapshot?: unknown
      }

      const updated = await prisma.frameworkRevision.update({
        where: { id: revisionId },
        data: {
          ...(body.reviewStatus   !== undefined && { reviewStatus:   body.reviewStatus }),
          ...(body.revisionType   !== undefined && { revisionType:   body.revisionType }),
          ...(body.assigneeId     !== undefined && { assigneeId:     body.assigneeId }),
          ...(body.notes          !== undefined && { notes:          body.notes }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(body.clientSnapshot !== undefined && { clientSnapshot: body.clientSnapshot as any }),
        },
      })
      return reply.send({ data: updated })
    },
  )

  // ── GET /:id/framework/:verticalId/attachments — list framework attachments
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const attachments = await prisma.clientFrameworkAttachment.findMany({
      where: { clientId, verticalId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, summaryStatus: true, summary: true },
    })
    // Attach the Brand read for each file so the GTM room can show both lenses
    const storageKeys = attachments.map((a) => a.storageKey)
    const brandMirrors = storageKeys.length
      ? await prisma.clientBrandAttachment.findMany({
          where: { clientId, agencyId, storageKey: { in: storageKeys } },
          select: { id: true, storageKey: true, summary: true, summaryStatus: true },
        })
      : []
    const brandMap = new Map(brandMirrors.map((m) => [m.storageKey, m]))
    const data = attachments.map((a) => ({
      ...a,
      brandSummary: brandMap.get(a.storageKey)?.summary ?? null,
      brandSummaryStatus: brandMap.get(a.storageKey)?.summaryStatus ?? null,
      brandAttachmentId: brandMap.get(a.storageKey)?.id ?? null,
    }))
    return reply.send({ data })
  })

  // ── POST /:id/framework/:verticalId/attachments — upload framework attachment
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = `framework-attachments/${agencyId}/${clientId}/${verticalId}/${crypto.randomUUID()}-${safeName}`

    try {
      await uploadStream(storageKey, file, mimetype)
    } catch (err) {
      app.log.error(err, 'Failed to store framework attachment')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    const attachment = await prisma.clientFrameworkAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: mimetype, sizeBytes },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, summaryStatus: true, summary: true },
    })

    // Enqueue GTM framework processing (text extraction + Claude summarisation)
    await getAttachmentProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      clientName: client.name,
      verticalName: vertical.name,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    // Cross-post to Branding brain — same storageKey, no re-upload
    const brandVertical = await prisma.clientBrandVertical.findFirst({
      where: { clientId, agencyId, sourceVerticalId: verticalId },
    })
    if (brandVertical) {
      const brandAttachment = await prisma.clientBrandAttachment.create({
        data: { agencyId, clientId, verticalId: brandVertical.id, filename, storageKey, mimeType: mimetype, sizeBytes },
      })
      await getBrandAttachmentProcessQueue().add('process', {
        agencyId,
        attachmentId: brandAttachment.id,
        clientId,
        verticalId: brandVertical.id,
      }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
    }

    return reply.code(201).send({ data: attachment })
  })

  // ── PATCH /:id/framework/:verticalId/attachments/:attachmentId — update summary
  app.patch<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params
      const { summary } = (req.body ?? {}) as { summary?: string }

      const att = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
      })
      if (!att) return reply.code(404).send({ error: 'Attachment not found' })

      const updated = await prisma.clientFrameworkAttachment.update({
        where: { id: attachmentId },
        data: { summary: summary ?? null },
        select: { id: true, summary: true, summaryStatus: true },
      })
      return reply.send({ data: updated })
    },
  )

  // ── GET /:id/framework/:verticalId/attachments/:attachmentId/text — raw extracted text
  app.get<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId/text',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params

      const att = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
        select: { extractedText: true, filename: true },
      })
      if (!att) return reply.code(404).send({ error: 'Attachment not found' })

      return reply.send({ data: { text: att.extractedText ?? null, filename: att.filename } })
    },
  )

  // ── DELETE /:id/framework/:verticalId/attachments/:attachmentId — delete attachment
  app.delete<{ Params: { id: string; verticalId: string; attachmentId: string } }>(
    '/:id/framework/:verticalId/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId, verticalId, attachmentId } = req.params

      const attachment = await prisma.clientFrameworkAttachment.findFirst({
        where: { id: attachmentId, clientId, verticalId, agencyId },
      })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })

      // Delete mirrored brand attachment (same storageKey, shared brain)
      const mirrorBrand = await prisma.clientBrandAttachment.findFirst({
        where: { clientId, agencyId, storageKey: attachment.storageKey },
      })
      if (mirrorBrand) {
        await prisma.clientBrandAttachment.delete({ where: { id: mirrorBrand.id } })
      }

      await prisma.clientFrameworkAttachment.delete({ where: { id: attachmentId } })
      try { await deleteObject(attachment.storageKey) } catch { /* file may already be gone */ }
      return reply.code(204).send()
    },
  )

  // ── GET /:id/framework/:verticalId/research — get research status + sources
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const research = await prisma.clientFrameworkResearch.findUnique({
      where: { clientId_verticalId: { clientId, verticalId } },
      select: { id: true, status: true, sources: true, websiteUrl: true, companyBrief: true, researchedAt: true, errorMessage: true, updatedAt: true },
    })
    return reply.send({ data: research ?? null })
  })

  // ── POST /:id/framework/:verticalId/research — trigger research job
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { websiteUrl, companyBrief, researchMode, mergeWithExisting } = (req.body ?? {}) as {
      websiteUrl?: string
      companyBrief?: string
      researchMode?: 'established' | 'new_vertical'
      mergeWithExisting?: boolean
    }

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.clientFrameworkResearch.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, status: 'pending', sources: [], websiteUrl: websiteUrl ?? null, companyBrief: companyBrief ?? null },
      update: { status: 'pending', errorMessage: null, ...(websiteUrl ? { websiteUrl } : {}), ...(companyBrief ? { companyBrief } : {}) },
    })

    await getFrameworkResearchQueue().add('research', { agencyId, clientId, verticalId, websiteUrl, companyBrief, researchMode, mergeWithExisting }, {
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    })

    return reply.code(202).send({ data: { status: 'pending' } })
  })

  // ── PATCH /:id/framework/:verticalId/research/brief — save company brief
  app.patch<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research/brief', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { companyBrief } = (req.body ?? {}) as { companyBrief: string }
    if (typeof companyBrief !== 'string') return reply.code(400).send({ error: 'companyBrief required' })

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    await prisma.clientFrameworkResearch.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, status: 'not_started', sources: [], companyBrief },
      update: { companyBrief },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── GET /:id/framework/:verticalId/research/runs — versioned research run history
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/research/runs', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const runs = await prisma.clientFrameworkResearchRun.findMany({
      where: { agencyId, clientId, verticalId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, status: true, researchMode: true, sectionResults: true, sources: true, researchedAt: true, createdAt: true, errorMessage: true, mergedFromIds: true },
    })
    return reply.send({ data: runs })
  })

  // ── POST /:id/framework/:verticalId/upload-client-gtm — upload client-supplied GTM DOCX
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/upload-client-gtm', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const ext = data.filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext !== 'docx') return reply.code(400).send({ error: 'Only .docx files are accepted for GTM upload' })

    const { Readable } = await import('node:stream')
    const { randomUUID } = await import('node:crypto')
    const buffer = await data.toBuffer()
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const storageKey = `client-gtm-uploads/${agencyId}/${clientId}/${verticalId}/${randomUUID()}.docx`
    await uploadStream(storageKey, Readable.from(buffer), mimeType)

    const record = await prisma.clientFrameworkUploadedGtm.create({
      data: { agencyId, clientId, verticalId, storageKey, filename: data.filename, status: 'processing' },
    })

    const { getClientGtmUploadQueue } = await import('../lib/queues.js')
    await getClientGtmUploadQueue().add('process', { agencyId, clientId, verticalId, uploadId: record.id }, {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    })

    return reply.code(202).send({ data: { id: record.id, status: 'processing' } })
  })

  // ── GET /:id/framework/:verticalId/uploaded-client-gtm — latest uploaded GTM status
  app.get<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/uploaded-client-gtm', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const upload = await prisma.clientFrameworkUploadedGtm.findFirst({
      where: { agencyId, clientId, verticalId },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true, filename: true, status: true, conflictLog: true, extractedSections: true, uploadedAt: true, processedAt: true, errorMessage: true },
    })
    return reply.send({ data: upload ?? null })
  })

  // ── DELETE /:id/framework/:verticalId/uploaded-client-gtm — delete latest uploaded GTM
  app.delete<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/uploaded-client-gtm', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const upload = await prisma.clientFrameworkUploadedGtm.findFirst({
      where: { agencyId, clientId, verticalId },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true, storageKey: true },
    })
    if (!upload) return reply.code(404).send({ error: 'No uploaded GTM found' })

    await prisma.clientFrameworkUploadedGtm.delete({ where: { id: upload.id } })
    try { await deleteObject(upload.storageKey) } catch { /* file may already be gone */ }

    return reply.send({ data: { ok: true } })
  })

  // ── POST /:id/framework/:verticalId/fill-from-client-gtm — fill sections from uploaded GTM
  // Body: { replace?: boolean } — when true, overwrites all sections (not just empty ones)
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/fill-from-client-gtm', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { replace = false } = (req.body ?? {}) as { replace?: boolean }

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    // Load latest ready upload
    const upload = await prisma.clientFrameworkUploadedGtm.findFirst({
      where: { agencyId, clientId, verticalId, status: 'ready' },
      orderBy: { uploadedAt: 'desc' },
      select: { extractedSections: true },
    })
    if (!upload?.extractedSections) return reply.code(422).send({ error: 'No processed client GTM found. Upload and wait for processing to complete.' })

    const extracted = upload.extractedSections as Record<string, string | null>

    // Load current framework
    const fw = await prisma.clientFramework.findFirst({
      where: { agencyId, clientId, verticalId },
      select: { data: true, sectionStatus: true },
    })
    const currentData = (fw?.data ?? {}) as Record<string, unknown>
    const currentSectionStatus = (fw?.sectionStatus ?? {}) as Record<string, string>

    // Determine which section numbers are empty (no string fields filled)
    const SKIP_KEYS = new Set(['_open', 'stage'])
    function isSectionEmpty(sec: unknown): boolean {
      let filled = 0
      let total = 0
      function count(val: unknown, key?: string) {
        if (key && SKIP_KEYS.has(key)) return
        if (typeof val === 'string') { total++; if (val.trim()) filled++ }
        else if (Array.isArray(val)) val.forEach((item) => count(item))
        else if (val && typeof val === 'object') Object.entries(val as Record<string, unknown>).forEach(([k, v]) => count(v, k))
      }
      count(sec)
      return total === 0 || filled === 0
    }

    // Collect sections that have extracted content — in replace mode, include all; otherwise only empty ones
    const SECTION_NUMS = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18']
    const sectionsToFill: Record<string, string> = {}
    for (const num of SECTION_NUMS) {
      const text = extracted[num]
      if (!text || !text.trim()) continue
      if (!replace) {
        const sKey = `s${num}`
        const current = currentData[sKey]
        const alreadyFilled = current && !isSectionEmpty(current)
        if (alreadyFilled) continue
      }
      sectionsToFill[num] = text
    }

    if (Object.keys(sectionsToFill).length === 0) {
      return reply.send({ data: { filledCount: 0, sections: [] } })
    }

    // Map flat text → structured FrameworkData via Claude
    const sectionsJson = JSON.stringify(sectionsToFill, null, 2)
    const { model: brainModel } = await getModelForRole('brain_processing')
    const mappingResult = await callModel(
      {
        provider: 'anthropic',
        model: brainModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens: 6000,
        temperature: 0.1,
      },
      `You are mapping content from a client-provided GTM document into a structured framework JSON format.

For each section below (keyed by number), parse the extracted text and return a structured JSON object.
Output ONLY valid JSON — no markdown, no code fences, no explanation.
Only include section keys that are present in the input.

SECTION TEXT INPUT:
${sectionsJson}

TARGET JSON STRUCTURE — use exactly these field names, create multiple array items where content warrants it:
{
  "s01": { "positioningStatement": "", "taglineOptions": "", "howToUse": "", "whatIsNot": "" },
  "s02": { "industry": "", "companySize": "", "geography": "", "itPosture": "", "complianceStatus": "", "contractProfile": "", "buyerTable": [{"segment":"","primaryBuyer":"","corePain":"","entryPoint":""}], "secondaryTargets": "" },
  "s03": { "marketPressureNarrative": "", "statsTable": [{"stat":"","context":"","source":"","year":""}], "additionalContext": "" },
  "s04": { "challenges": [{"name":"","whyExists":"","consequence":"","solution":"","pillarsText":""}] },
  "s05": { "pillars": [{"pillar":"","valueProp":"","keyServices":"","relevantTo":""}], "serviceStack": [{"service":"","regulatoryDomain":"","whatItDelivers":"","priority":""}] },
  "s06": { "differentiators": [{"label":"","position":""}] },
  "s07": { "segments": [{"name":"","primaryBuyerTitles":"","whatIsDifferent":"","keyPressures":"","leadHook":"","complianceNotes":""}] },
  "s08": { "problems": "", "solution": "", "outcomes": "", "valuePropTable": [{"pillar":"","meaning":"","proofPoint":"","citation":""}] },
  "s09": { "proofPoints": [{"text":"","source":""}], "caseStudies": [{"clientProfile":"","url":"","situation":"","engagement":"","outcomes":"","thirtySecond":"","headlineStat":""}] },
  "s10": { "objections": [{"objection":"","response":"","followUp":""}] },
  "s11": { "toneTarget": "", "vocabularyLevel": "", "sentenceStyle": "", "whatToAvoid": "", "goodExamples": [{"text":""}], "badExamples": [{"bad":"","whyWrong":""}] },
  "s12": { "competitors": [{"type":"","positioning":"","counter":"","whenComesUp":""}] },
  "s13": { "quotes": [{"quoteText":"","attribution":"","context":"","bestUsedIn":"","approved":""}] },
  "s14": { "campaigns": [{"theme":"","targetAudience":"","primaryAssets":"","keyMessage":""}] },
  "s15": { "faqs": [{"question":"","answer":"","bestAddressedIn":""}] },
  "s16": { "funnelStages": [{"stage":"Top of Funnel","assets":"","primaryCTA":"","buyerState":""},{"stage":"Mid Funnel","assets":"","primaryCTA":"","buyerState":""},{"stage":"Bottom Funnel","assets":"","primaryCTA":"","buyerState":""}], "ctaSequencing": "" },
  "s17": { "regulations": [{"requirement":"","capability":"","servicePillar":"","salesNote":""}], "regulatorySalesNote": "" },
  "s18": { "ctas": [{"ctaName":"","description":"","targetAudienceTrigger":"","assets":""}] }
}

Rules:
- Map ALL content from the input text — do not skip or summarize
- Split list-like content into multiple array items (one per item)
- If a field has no relevant content in the source text, leave it as an empty string
- Preserve exact wording where possible — do not paraphrase`,
    )

    let mapped: Record<string, unknown> = {}
    try {
      mapped = JSON.parse(mappingResult.text.trim()) as Record<string, unknown>
    } catch {
      return reply.code(500).send({ error: 'Failed to parse Claude mapping response' })
    }

    // Merge mapped sections into current data (only empty sections)
    const filledSectionNums: string[] = []
    // Default shapes — ensures arrays are never undefined when Claude omits them
    const SECTION_DEFAULTS: Record<string, Record<string, unknown>> = {
      s01: { positioningStatement: '', taglineOptions: '', howToUse: '', whatIsNot: '', platformName: '', platformBenefit: '' },
      s02: { industry: '', companySize: '', geography: '', itPosture: '', complianceStatus: '', contractProfile: '', buyerTable: [{ segment: '', primaryBuyer: '', corePain: '', entryPoint: '' }], secondaryTargets: '' },
      s03: { marketPressureNarrative: '', statsTable: [{ stat: '', context: '', source: '', year: '' }], additionalContext: '' },
      s04: { challenges: [{ name: '', whyExists: '', consequence: '', solution: '', pillarsText: '', _open: true }] },
      s05: { pillars: [{ pillar: '', valueProp: '', keyServices: '', relevantTo: '', _open: true }], serviceStack: [{ service: '', regulatoryDomain: '', whatItDelivers: '', priority: '', _open: true }] },
      s06: { differentiators: [{ label: '', position: '', _open: true }] },
      s07: { segments: [{ name: '', primaryBuyerTitles: '', whatIsDifferent: '', keyPressures: '', leadHook: '', complianceNotes: '', _open: true }] },
      s08: { problems: '', solution: '', outcomes: '', valuePropTable: [{ pillar: '', meaning: '', proofPoint: '', citation: '' }, { pillar: '', meaning: '', proofPoint: '', citation: '' }, { pillar: '', meaning: '', proofPoint: '', citation: '' }, { pillar: '', meaning: '', proofPoint: '', citation: '' }] },
      s09: { proofPoints: [{ text: '', source: '' }, { text: '', source: '' }, { text: '', source: '' }], caseStudies: [{ clientProfile: '', url: '', situation: '', engagement: '', outcomes: '', thirtySecond: '', headlineStat: '', _open: true }] },
      s10: { objections: [{ objection: '', response: '', followUp: '' }] },
      s11: { toneTarget: '', vocabularyLevel: '', sentenceStyle: '', whatToAvoid: '', goodExamples: [{ text: '' }, { text: '' }, { text: '' }], badExamples: [{ bad: '', whyWrong: '' }] },
      s12: { competitors: [{ type: '', positioning: '', counter: '', whenComesUp: '' }] },
      s13: { quotes: [{ quoteText: '', attribution: '', context: '', bestUsedIn: '', approved: '', _open: true }] },
      s14: { campaigns: [{ theme: '', targetAudience: '', primaryAssets: '', keyMessage: '' }] },
      s15: { faqs: [{ question: '', answer: '', bestAddressedIn: '' }] },
      s16: { funnelStages: [{ stage: 'Top of Funnel', assets: '', primaryCTA: '', buyerState: '' }, { stage: 'Mid Funnel', assets: '', primaryCTA: '', buyerState: '' }, { stage: 'Bottom Funnel', assets: '', primaryCTA: '', buyerState: '' }], ctaSequencing: '' },
      s17: { regulations: [{ requirement: '', capability: '', servicePillar: '', salesNote: '' }], regulatorySalesNote: '' },
      s18: { ctas: [{ ctaName: '', description: '', targetAudienceTrigger: '', assets: '' }], campaignThemes: [{ campaignName: '', description: '' }], contact: { verticalOwner: '', marketingContact: '', salesLead: '', documentVersion: '', lastUpdated: '', nextReviewDate: '' } },
    }

    const newData = { ...currentData }
    const newSectionStatus = { ...currentSectionStatus }

    for (const num of Object.keys(sectionsToFill)) {
      const sKey = `s${num}`
      if (mapped[sKey]) {
        // Merge defaults first, then overlay Claude's result — guarantees all array fields exist
        newData[sKey] = { ...(SECTION_DEFAULTS[sKey] ?? {}), ...(mapped[sKey] as Record<string, unknown>) }
        newSectionStatus[num] = 'ai-draft'
        filledSectionNums.push(num)
      }
    }

    // Save
    await prisma.clientFramework.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      create: { agencyId, clientId, verticalId, data: newData as object, sectionStatus: newSectionStatus as object },
      update: { data: newData as object, sectionStatus: newSectionStatus as object },
    })

    return reply.send({ data: { filledCount: filledSectionNums.length, sections: filledSectionNums } })
  })

  // ── PATCH /:id/framework/:verticalId/section-status — update per-section status
  app.patch<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/section-status', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { sectionNum, status } = (req.body ?? {}) as { sectionNum?: string; status?: string }

    if (!sectionNum || !status) return reply.code(400).send({ error: 'sectionNum and status are required' })
    const validStatuses = ['complete', 'in-progress', 'ai-draft', 'not-started', 'pending']
    if (!validStatuses.includes(status)) return reply.code(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })

    const fw = await prisma.clientFramework.findFirst({
      where: { clientId, verticalId, agencyId },
      select: { id: true, sectionStatus: true },
    })

    const current = ((fw?.sectionStatus ?? {}) as Record<string, string>)
    current[sectionNum] = status

    if (fw) {
      await prisma.clientFramework.update({
        where: { id: fw.id },
        data: { sectionStatus: current },
      })
    } else {
      // Framework record doesn't exist yet — create it so the status write succeeds
      await prisma.clientFramework.create({
        data: { agencyId, clientId, verticalId, data: {}, sectionStatus: current },
      })
    }
    return reply.send({ data: { sectionNum, status } })
  })

  // ── POST /:id/framework/:verticalId/draft-section — batch draft all fields for a section
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/draft-section', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { sectionNum, sectionTitle, sectionResearch } =
      (req.body ?? {}) as { sectionNum?: string; sectionTitle?: string; sectionResearch?: unknown }

    if (!sectionNum) return reply.code(400).send({ error: 'sectionNum is required' })

    const SECTION_FIELDS: Record<string, Array<{ key: string; label: string; type: 'string' | 'array'; arraySchema?: string }>> = {
      '01': [
        { key: 'platformName',          label: 'Platform / product name for this vertical',              type: 'string' },
        { key: 'platformBenefit',       label: 'Core platform benefit (one sentence)',                   type: 'string' },
        { key: 'positioningStatement',  label: 'Positioning statement (2-3 sentences)',                  type: 'string' },
        { key: 'taglineOptions',        label: 'Tagline options (2-3 variations, separated by newlines)', type: 'string' },
        { key: 'howToUse',             label: 'How this framework section should be used by the team',   type: 'string' },
        { key: 'whatIsNot',            label: 'What this vertical / solution is NOT (3-5 items)',        type: 'string' },
      ],
      '02': [
        { key: 'industry',            label: 'Target industry description',                              type: 'string' },
        { key: 'companySize',         label: 'Target company size (employees, revenue, or both)',        type: 'string' },
        { key: 'geography',           label: 'Target geography',                                         type: 'string' },
        { key: 'itPosture',           label: 'IT posture / infrastructure profile',                      type: 'string' },
        { key: 'complianceStatus',    label: 'Compliance / regulatory status typical of these buyers',   type: 'string' },
        { key: 'contractProfile',     label: 'Typical contract / procurement profile',                   type: 'string' },
        { key: 'secondaryTargets',    label: 'Secondary target audiences',                               type: 'string' },
        { key: 'buyerTable',         label: 'Buyer segments', type: 'array',
          arraySchema: '{"segment":"","primaryBuyer":"","corePain":"","entryPoint":""}' },
      ],
      '03': [
        { key: 'marketPressureNarrative', label: 'Market pressure narrative (2-4 paragraphs with data and context)', type: 'string' },
        { key: 'additionalContext',       label: 'Additional market context',                                          type: 'string' },
        { key: 'statsTable', label: 'Key statistics', type: 'array',
          arraySchema: '{"stat":"","context":"","source":"","year":""}' },
      ],
      '04': [
        { key: 'challenges', label: 'Core IT challenges', type: 'array',
          arraySchema: '{"name":"","whyExists":"","consequence":"","solution":"","pillarsText":""}' },
      ],
      '05': [
        { key: 'pillars', label: 'Value pillars', type: 'array',
          arraySchema: '{"pillar":"","valueProp":"","keyServices":"","relevantTo":""}' },
        { key: 'serviceStack', label: 'Service stack', type: 'array',
          arraySchema: '{"service":"","regulatoryDomain":"","whatItDelivers":"","priority":""}' },
      ],
      '06': [
        { key: 'differentiators', label: 'Differentiators', type: 'array',
          arraySchema: '{"label":"","position":""}' },
      ],
      '07': [
        { key: 'segments', label: 'Buyer segments', type: 'array',
          arraySchema: '{"name":"","primaryBuyerTitles":"","whatIsDifferent":"","keyPressures":"","leadHook":"","complianceNotes":""}' },
      ],
      '08': [
        { key: 'problems',  label: 'Core problems / pains this vertical faces (1-2 paragraphs)',  type: 'string' },
        { key: 'solution',  label: 'How the solution addresses these problems (1-2 paragraphs)',   type: 'string' },
        { key: 'outcomes',  label: 'Key outcomes clients achieve (1-2 paragraphs)',                type: 'string' },
        { key: 'valuePropTable', label: 'Value propositions by pillar', type: 'array',
          arraySchema: '{"pillar":"","meaning":"","proofPoint":"","citation":""}' },
      ],
      '09': [
        { key: 'proofPoints', label: 'Proof points (specific stats or results)', type: 'array',
          arraySchema: '{"text":"","source":""}' },
        { key: 'caseStudies', label: 'Case studies', type: 'array',
          arraySchema: '{"clientProfile":"","url":"","situation":"","engagement":"","outcomes":"","thirtySecond":"","headlineStat":""}' },
      ],
      '10': [
        { key: 'objections', label: 'Objections and responses', type: 'array',
          arraySchema: '{"objection":"","response":"","followUp":""}' },
      ],
      '11': [
        { key: 'toneTarget',       label: 'Tone target description',          type: 'string' },
        { key: 'vocabularyLevel',  label: 'Vocabulary level and style',       type: 'string' },
        { key: 'sentenceStyle',    label: 'Sentence structure and style',     type: 'string' },
        { key: 'whatToAvoid',      label: 'Phrases and styles to avoid',      type: 'string' },
        { key: 'goodExamples', label: 'On-voice example sentences (sounds like this)', type: 'array',
          arraySchema: '{"text":""}' },
        { key: 'badExamples',  label: 'Off-voice examples with correction notes',     type: 'array',
          arraySchema: '{"bad":"","whyWrong":""}' },
      ],
      '12': [
        { key: 'competitors', label: 'Competitors and differentiation', type: 'array',
          arraySchema: '{"type":"","positioning":"","counter":"","whenComesUp":""}' },
      ],
      '13': [
        { key: 'quotes', label: 'Customer quotes / testimonials', type: 'array',
          arraySchema: '{"quoteText":"","attribution":"","context":"","bestUsedIn":"","approved":""}' },
      ],
      '14': [
        { key: 'campaigns', label: 'Campaign themes', type: 'array',
          arraySchema: '{"theme":"","targetAudience":"","primaryAssets":"","keyMessage":""}' },
      ],
      '15': [
        { key: 'faqs', label: 'Frequently asked questions', type: 'array',
          arraySchema: '{"question":"","answer":"","bestAddressedIn":""}' },
      ],
      '16': [
        { key: 'ctaSequencing', label: 'CTA sequencing notes (how assets lead buyers through the funnel)', type: 'string' },
        { key: 'funnelStages', label: 'Funnel stages', type: 'array',
          arraySchema: '{"stage":"","assets":"","primaryCTA":"","buyerState":""}' },
      ],
      '17': [
        { key: 'regulatorySalesNote', label: 'Regulatory sales note (how compliance creates urgency)', type: 'string' },
        { key: 'regulations', label: 'Regulatory requirements', type: 'array',
          arraySchema: '{"requirement":"","capability":"","servicePillar":"","salesNote":""}' },
      ],
      '18': [
        { key: 'ctas', label: 'CTAs', type: 'array',
          arraySchema: '{"ctaName":"","description":"","targetAudienceTrigger":"","assets":""}' },
        { key: 'campaignThemes', label: 'Campaign theme suggestions', type: 'array',
          arraySchema: '{"campaignName":"","description":""}' },
      ],
    }

    const fields = SECTION_FIELDS[sectionNum]
    if (!fields || fields.length === 0) {
      return reply.code(422).send({ error: `No field definitions for section ${sectionNum}` })
    }

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const [attachments, clientBrain] = await Promise.all([
      prisma.clientFrameworkAttachment.findMany({
        where: { clientId, verticalId, agencyId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        orderBy: { createdAt: 'asc' },
        take: 8,
      }),
      prisma.clientBrainAttachment.findMany({
        where: { clientId, agencyId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ])

    const contextParts: string[] = []
    if (clientBrain.length > 0) {
      contextParts.push('CLIENT BRAIN:')
      clientBrain.forEach((b) => { if (b.summary?.trim()) contextParts.push(`[${b.filename}]\n${b.summary.trim()}`) })
    }
    if (attachments.length > 0) {
      contextParts.push('RESEARCH ATTACHMENTS:')
      attachments.forEach((a) => { if (a.summary?.trim()) contextParts.push(`[${a.filename}]\n${a.summary.trim()}`) })
    }
    if (sectionResearch) {
      const researchStr = typeof sectionResearch === 'string'
        ? sectionResearch
        : JSON.stringify(sectionResearch, null, 2)
      contextParts.push(`SECTION ${sectionNum} RESEARCH FINDINGS:\n${researchStr}`)
    }

    if (contextParts.length === 0) {
      return reply.code(422).send({ error: 'No context available to draft from. Upload brain documents or run research first.' })
    }

    const fieldsList = fields.map((f) =>
      f.type === 'array'
        ? `"${f.key}": [${f.arraySchema}]  // ${f.label} — draft 3-5 items`
        : `"${f.key}": "..."  // ${f.label}`
    ).join(',\n  ')

    const { model: primaryModel } = await getModelForRole('generation_primary')

    const result = await callModel(
      { provider: 'anthropic', model: primaryModel, api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 3000, temperature: 0.2 },
      `You are auto-drafting GTM Framework Section ${sectionNum} (${sectionTitle ?? ''}) for a client.

CLIENT: ${client.name}
VERTICAL: ${vertical.name}

${contextParts.join('\n\n')}

---

Draft all fields below using the context above. Be specific — use exact language, stats, and details from the research. Write in professional GTM document voice. For array fields, draft 3-5 concrete items. Do not use placeholder text.

Return ONLY a valid JSON object. No preamble. No explanation. No markdown fences. No trailing commas.

{
  ${fieldsList}
}`
    )

    let fieldUpdates: Array<{ s: string; f: string; v: unknown }> = []
    try {
      const cleaned = result.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      fieldUpdates = Object.entries(parsed)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([f, v]) => ({ s: sectionNum, f, v }))
    } catch (err) {
      req.log.error({ err, raw: result.text.slice(0, 500) }, '[draft-section] JSON parse failed')
      return reply.code(500).send({ error: 'Draft generation failed — could not parse AI response' })
    }

    return reply.send({ data: { fieldUpdates } })
  })

  // ── POST /:id/framework/:verticalId/draft — draft a single field using stored research
  app.post<{ Params: { id: string; verticalId: string } }>('/:id/framework/:verticalId/draft', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { sectionNum, sectionTitle, fieldKey, fieldLabel, currentValue } =
      (req.body ?? {}) as {
        sectionNum?: string; sectionTitle?: string
        fieldKey?: string; fieldLabel?: string; currentValue?: string
      }

    if (!sectionNum || !fieldLabel) return reply.code(400).send({ error: 'sectionNum and fieldLabel are required' })

    const [client, vertical, research] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } }),
      prisma.clientFrameworkResearch.findUnique({
        where: { clientId_verticalId: { clientId, verticalId } },
        select: { status: true, sources: true },
      }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    // Build context block from live attachment summaries (permanent brain) + cached website scrape
    const readyAttachments = await prisma.clientFrameworkAttachment.findMany({
      where: { clientId, verticalId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, mimeType: true, summary: true },
      orderBy: { createdAt: 'asc' },
    })

    const websiteSources = research
      ? (research.sources as Array<{ type: string; filename: string; summary: string }>)
          .filter((s) => s.type === 'website')
      : []

    if (readyAttachments.length === 0 && websiteSources.length === 0) {
      return reply.code(422).send({ error: 'No research context available. Upload files or scrape a website first.' })
    }

    const contextBlock = [
      ...readyAttachments
        .filter((a) => a.summary && a.summary.trim())
        .map((a) => `--- ${a.filename} ---\n${a.summary}`),
      ...websiteSources.map((s) => `--- Website: ${s.filename} ---\n${s.summary}`),
    ].join('\n\n')

    const { model: brainModel } = await getModelForRole('brain_processing')

    const result = await callModel(
      {
        provider: 'anthropic',
        model: brainModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens: 600,
        temperature: 0.3,
      },
      `You are filling in a GTM (go-to-market) framework for a client.

CLIENT: ${client.name}
VERTICAL: ${vertical.name}
SECTION: ${sectionNum} — ${sectionTitle ?? ''}
FIELD: ${fieldLabel}

RESEARCH CONTEXT (extracted from attached documents, audio recordings, and website):
${contextBlock}

${currentValue ? `CURRENT VALUE (may be partial or placeholder):\n${currentValue}\n\n` : ''}Write a draft value for this field. Be specific — use language, stats, and details drawn directly from the research context where possible. Write in the voice that fits a professional GTM document. Return ONLY the field value with no preamble, labels, or explanation.`,
    )

    return reply.send({ data: { draft: result.text.trim() } })
  })

  // ── POST /:id/writer-examples — upload writer-polished version for a run
  app.post<{ Params: { id: string } }>('/:id/writer-examples', async (req, reply) => {
    const { agencyId } = req.auth
    const { workflowRunId, contentAfter } = req.body as { workflowRunId: string; contentAfter: string }

    if (!workflowRunId || !contentAfter?.trim()) {
      return reply.code(400).send({ error: 'workflowRunId and contentAfter are required' })
    }

    // Verify run belongs to this client + agency
    const run = await prisma.workflowRun.findFirst({
      where: { id: workflowRunId, agencyId, workflow: { clientId: req.params.id } },
    })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    // Remove any existing writer example for this run
    await prisma.humanizerExample.deleteMany({
      where: { agencyId, workflowRunId, source: 'writer' },
    })

    const wordCount = contentAfter.trim().split(/\s+/).filter(Boolean).length
    const example = await prisma.humanizerExample.create({
      data: {
        agencyId,
        contentAfter: contentAfter.trim(),
        wordCountAfter: wordCount,
        service: 'writer',
        source: 'writer',
        workflowRunId,
        approved: true,
      },
    })

    return reply.code(201).send({ data: example })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // BRAND — verticals, profiles, builder, attachments
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /:id/brand-verticals ───────────────────────────────────────────────
  // Auto-syncs from the client's assigned Structure verticals so the branding
  // sidebar always mirrors what's in the Structure tab.
  app.get<{ Params: { id: string } }>('/:id/brand-verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Fetch Structure verticals assigned to this client
    const structureVerticals = await prisma.clientVertical.findMany({
      where: { clientId, agencyId },
      include: { vertical: { select: { id: true, name: true } } },
    })

    // Fetch existing brand verticals (may have been created manually or via prior sync)
    const existing = await prisma.clientBrandVertical.findMany({
      where: { clientId, agencyId },
    })

    // Create brand vertical records for any Structure verticals not yet synced
    for (const cv of structureVerticals) {
      const alreadySynced = existing.some((b) => b.sourceVerticalId === cv.vertical.id)
      if (!alreadySynced) {
        // Check for an unlinked brand vertical with the same name (created before sourceVerticalId migration)
        const unlinked = existing.find((b) => !b.sourceVerticalId && b.name === cv.vertical.name)
        if (unlinked) {
          await prisma.clientBrandVertical.update({
            where: { id: unlinked.id },
            data: { sourceVerticalId: cv.vertical.id },
          })
        } else {
          await prisma.clientBrandVertical.create({
            data: {
              agencyId,
              clientId,
              name: cv.vertical.name,
              sourceVerticalId: cv.vertical.id,
            },
          })
        }
      } else {
        // Keep name in sync if it changed in Structure
        const linked = existing.find((b) => b.sourceVerticalId === cv.vertical.id)
        if (linked && linked.name !== cv.vertical.name) {
          await prisma.clientBrandVertical.update({
            where: { id: linked.id },
            data: { name: cv.vertical.name },
          })
        }
      }
    }

    // Return fresh list
    const verticals = await prisma.clientBrandVertical.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    })
    return reply.send({ data: verticals })
  })

  // ── POST /:id/brand-verticals ──────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/brand-verticals', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const { name } = (req.body ?? {}) as { name?: string }
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' })
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const vertical = await prisma.clientBrandVertical.create({
      data: { agencyId, clientId, name: name.trim() },
      select: { id: true, name: true, createdAt: true },
    })
    return reply.code(201).send({ data: vertical })
  })

  // ── DELETE /:id/brand-verticals/:verticalId ────────────────────────────────
  app.delete<{ Params: { id: string; verticalId: string } }>('/:id/brand-verticals/:verticalId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const vertical = await prisma.clientBrandVertical.findFirst({
      where: { id: verticalId, clientId, agencyId },
    })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })
    await prisma.clientBrandVertical.delete({ where: { id: verticalId } })
    return reply.code(204).send()
  })

  // ── GET /:id/brand-profile ─────────────────────────────────────────────────
  // ?verticalId= omitted or empty → General brand
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    return reply.send({ data: profile ?? null })
  })

  // ── PATCH /:id/brand-profile ───────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { editedJson, websiteUrl } = (req.body ?? {}) as { editedJson?: Record<string, unknown>; websiteUrl?: string }
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const existing = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    const updateData: Record<string, unknown> = {}
    if (editedJson !== undefined) updateData.editedJson = editedJson ?? null
    if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl?.trim() || null
    let profile
    if (existing) {
      profile = await prisma.clientBrandProfile.update({ where: { id: existing.id }, data: updateData })
    } else {
      profile = await prisma.clientBrandProfile.create({
        data: { agencyId, clientId, verticalId, extractionStatus: 'idle', ...updateData },
      })
    }
    // Mark AI templates stale if the Brain changed (fire-and-forget)
    markStaleIfBrainChanged(clientId, agencyId).catch(() => {})
    return reply.send({ data: profile })
  })

  // ── POST /:id/brand-profile/scrape ────────────────────────────────────────
  // Enqueue a brand-scrape job that fetches the website URL and re-runs extraction
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/scrape', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Get or create profile to confirm websiteUrl is set
    const profile = await prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
      select: { id: true, websiteUrl: true },
    })
    if (!profile?.websiteUrl) {
      return reply.code(422).send({ error: 'No website URL saved on the brand profile. Save a URL first.' })
    }

    await prisma.clientBrandProfile.update({
      where: { id: profile.id },
      data: { extractionStatus: 'extracting', errorMessage: null },
    })

    // Enqueue via brand-attachment queue — the processor will detect website source
    await getBrandAttachmentProcessQueue().add('scrape', {
      agencyId,
      attachmentId: '', // empty signals website-scrape mode
      clientId,
      verticalId,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    return reply.send({ data: { status: 'extracting' } })
  })

  // ── GET /:id/brand-profile/attachments ────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const attachments = await prisma.clientBrandAttachment.findMany({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, storageKey: true, extractionStatus: true, errorMessage: true, extractedText: true, summary: true, summaryStatus: true },
    })
    // Attach the GTM read for each file so the Branding room can show both lenses
    const storageKeys = attachments.map((a) => a.storageKey).filter(Boolean)
    const gtmMirrors = storageKeys.length
      ? await prisma.clientFrameworkAttachment.findMany({
          where: { clientId, agencyId, storageKey: { in: storageKeys } },
          select: { id: true, storageKey: true, verticalId: true, summary: true, summaryStatus: true },
        })
      : []
    const gtmMap = new Map(gtmMirrors.map((m) => [m.storageKey, m]))
    // Trim extractedText to a preview — full text is served via /:attachmentId/text
    const data = attachments.map((a) => ({
      ...a,
      extractedText: a.extractedText ? a.extractedText.slice(0, 2000) : null,
      gtmSummary: gtmMap.get(a.storageKey)?.summary ?? null,
      gtmSummaryStatus: gtmMap.get(a.storageKey)?.summaryStatus ?? null,
      gtmAttachmentId: gtmMap.get(a.storageKey)?.id ?? null,
      gtmVerticalId: gtmMap.get(a.storageKey)?.verticalId ?? null,
    }))
    return reply.send({ data })
  })

  // ── POST /:id/brand-profile/attachments ───────────────────────────────────
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId } })
      if (!vert) return reply.code(404).send({ error: 'Vertical not found' })
    }

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data

    const allowedExts = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md', '.csv', '.json', '.html', '.htm', '.mp4', '.mov', '.mp3', '.m4a', '.wav', '.webm', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
    const fileExt = extname(filename).toLowerCase()
    if (!allowedExts.has(fileExt)) {
      file.resume()
      return reply.code(400).send({ error: `Unsupported file type "${fileExt}". Accepted: PDF, DOCX, XLSX, PPT, PPTX, TXT, MD, CSV, JSON, HTML, PNG, JPG, GIF, WEBP, SVG, MP4, MOV, MP3, WAV` })
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = `brand-attachments/${agencyId}/${clientId}/${verticalId ?? 'general'}/${crypto.randomUUID()}-${safeName}`

    try {
      await uploadStream(storageKey, file, mimetype)
    } catch (err) {
      app.log.error(err, 'Failed to store brand attachment')
      return reply.code(500).send({ error: 'Failed to store file' })
    }

    const sizeBytes = (file as unknown as { bytesRead?: number }).bytesRead ?? 0

    const brandUploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    const brandUploaderId = brandUploader?.id ?? req.auth.userId

    const attachment = await prisma.clientBrandAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: mimetype, sizeBytes, uploadedByUserId: brandUploaderId },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, extractionStatus: true, errorMessage: true },
    })

    await getBrandAttachmentProcessQueue().add('process', {
      agencyId,
      attachmentId: attachment.id,
      clientId,
      verticalId,
    }, {
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    })

    // Cross-post to GTM Framework brain — same storageKey, no re-upload
    if (verticalId) {
      const brandVert = await prisma.clientBrandVertical.findFirst({
        where: { id: verticalId, clientId, agencyId },
        select: { sourceVerticalId: true },
      })
      if (brandVert?.sourceVerticalId) {
        const [clientRecord, verticalRecord] = await Promise.all([
          prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
          prisma.vertical.findFirst({ where: { id: brandVert.sourceVerticalId, agencyId }, select: { name: true } }),
        ])
        if (clientRecord && verticalRecord) {
          const fwAttachment = await prisma.clientFrameworkAttachment.create({
            data: { agencyId, clientId, verticalId: brandVert.sourceVerticalId, filename, storageKey, mimeType: mimetype, sizeBytes },
          })
          await getAttachmentProcessQueue().add('process', {
            agencyId,
            attachmentId: fwAttachment.id,
            clientName: clientRecord.name,
            verticalName: verticalRecord.name,
          }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })
        }
      }
    }

    return reply.code(201).send({ data: attachment })
  })

  // ── DELETE /:id/brand-profile/attachments/:attachmentId ───────────────────
  app.delete<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })

    // Delete mirrored GTM framework attachment (same storageKey, shared brain)
    const mirrorFw = await prisma.clientFrameworkAttachment.findFirst({
      where: { clientId, agencyId, storageKey: attachment.storageKey },
    })
    if (mirrorFw) {
      await prisma.clientFrameworkAttachment.delete({ where: { id: mirrorFw.id } })
    }

    await prisma.clientBrandAttachment.delete({ where: { id: attachmentId } })
    try { await deleteObject(attachment.storageKey) } catch {}
    return reply.code(204).send()
  })

  // ── PATCH /:id/brand-profile/attachments/:attachmentId — edit summary ────
  app.patch<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const { summary } = (req.body ?? {}) as { summary?: string }
    if (typeof summary !== 'string') return reply.code(400).send({ error: 'summary is required' })
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    const updated = await prisma.clientBrandAttachment.update({
      where: { id: attachmentId },
      data: { summary: summary.trim(), summaryStatus: 'ready' },
      select: { id: true, summary: true, summaryStatus: true },
    })
    return reply.send({ data: updated })
  })

  // ── GET /:id/brand-profile/attachments/:attachmentId/text — raw original ──
  app.get<{ Params: { id: string; attachmentId: string } }>('/:id/brand-profile/attachments/:attachmentId/text', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, attachmentId } = req.params
    const attachment = await prisma.clientBrandAttachment.findFirst({
      where: { id: attachmentId, clientId, agencyId },
      select: { extractedText: true, filename: true },
    })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    return reply.send({ data: { text: attachment.extractedText ?? '', filename: attachment.filename } })
  })

  // ── POST /:id/brand-profile/attachments/from-url — ingest a URL into the brain
  app.post<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-profile/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { url } = (req.body ?? {}) as { url?: string }

    if (!url?.trim()) return reply.code(400).send({ error: 'url is required' })
    let parsedUrl: URL
    try { parsedUrl = new URL(url.trim()) } catch {
      return reply.code(400).send({ error: 'Invalid URL' })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId } })
      if (!vert) return reply.code(404).send({ error: 'Vertical not found' })
    }

    const hostname = parsedUrl.hostname.replace(/^www\./, '')
    const date = new Date().toISOString().slice(0, 10)
    const filename = `${hostname}-${date}.txt`
    const storageKey = `url-import/${agencyId}/${clientId}/${verticalId ?? 'general'}/${crypto.randomUUID()}`

    const attachment = await prisma.clientBrandAttachment.create({
      data: { agencyId, clientId, verticalId, filename, storageKey, mimeType: 'text/plain', sizeBytes: 0, extractionStatus: 'processing' },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, extractionStatus: true, summaryStatus: true },
    })

    await getBrandAttachmentProcessQueue().add('process', {
      agencyId, attachmentId: attachment.id, clientId, verticalId, url: parsedUrl.toString(),
    }, { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } })

    return reply.code(201).send({ data: attachment })
  })

  // ── GET /:id/brand-builder ─────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-builder', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const builder = await prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    return reply.send({ data: builder ?? null })
  })

  // ── PUT /:id/brand-builder ─────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand-builder', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null
    const { dataJson } = (req.body ?? {}) as { dataJson?: Record<string, unknown> }
    if (!dataJson) return reply.code(400).send({ error: 'dataJson is required' })
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const existing = await prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
    })
    let builder
    if (existing) {
      builder = await prisma.clientBrandBuilder.update({ where: { id: existing.id }, data: { dataJson } })
    } else {
      builder = await prisma.clientBrandBuilder.create({ data: { agencyId, clientId, verticalId, dataJson } })
    }
    // Mark AI templates stale if the Brain changed (fire-and-forget)
    markStaleIfBrainChanged(clientId, agencyId).catch(() => {})
    return reply.send({ data: builder })
  })

  // ── GET /:id/brand ─────────────────────────────────────────────────────────
  // Returns merged brand data for workflow node consumption
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/brand', async (req, reply) => {
    const { agencyId } = req.auth
    const clientId = req.params.id
    const verticalId = req.query.verticalId?.trim() || null

    const [client, profile, builder] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      prisma.clientBrandProfile.findFirst({
        where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
        select: { editedJson: true, extractedJson: true },
      }),
      prisma.clientBrandBuilder.findFirst({
        where: { clientId, agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
        select: { dataJson: true },
      }),
    ])

    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const profileData = (profile?.editedJson ?? profile?.extractedJson ?? null) as Record<string, unknown> | null
    const builderData = (builder?.dataJson ?? null) as Record<string, unknown> | null

    // Merge: builder values take priority, profile fills gaps
    const merged = profileData || builderData
      ? { ...(profileData ?? {}), ...(builderData ?? {}) }
      : null

    let verticalName: string | null = null
    if (verticalId) {
      const vert = await prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId }, select: { name: true } })
      verticalName = vert?.name ?? null
    }

    return reply.send({
      data: {
        clientId,
        clientName: client.name,
        vertical: verticalName ?? 'General',
        brand: merged,
        hasBrandProfile: profileData !== null,
        hasBrandBuilder: builderData !== null,
        source: profileData && builderData ? 'merged' : profileData ? 'brand_profile' : builderData ? 'brand_builder' : null,
      },
    })
  })

  // ── Client Brain ──────────────────────────────────────────────────────────────

  const ALLOWED_CLIENT_BRAIN_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md', '.csv', '.json', '.html', '.htm'])

  // GET context
  app.get<{ Params: { clientId: string } }>('/:clientId/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { brainContext: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    return reply.send({ data: { context: client.brainContext ?? null } })
  })

  // PATCH context
  app.patch<{ Params: { clientId: string }; Body: { context: string } }>('/:clientId/brain/context', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const { context } = req.body
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    await prisma.client.update({ where: { id: clientId }, data: { brainContext: context } })
    return reply.send({ data: { ok: true } })
  })

  // GET attachments list (optionally filtered by ?source=)
  app.get<{ Params: { clientId: string }; Querystring: { source?: string } }>('/:clientId/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const sourceFilter = req.query.source?.trim() || undefined
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const attachments = await prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, ...(sourceFilter ? { source: sourceFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, campaignId: true, campaignScopedOnly: true,
        uploadMethod: true, uploadedByUserId: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // POST upload file (optional ?source= and ?verticalId= query params)
  app.post<{ Params: { clientId: string }; Querystring: { source?: string; verticalId?: string } }>('/:clientId/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const source = req.query.source?.trim() || 'client'
    const verticalId = req.query.verticalId?.trim() || null
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const fileExt = extname(filename).toLowerCase()
    if (!ALLOWED_CLIENT_BRAIN_EXTS.has(fileExt)) {
      return reply.code(400).send({ error: `File type ${fileExt} not supported. Allowed: ${[...ALLOWED_CLIENT_BRAIN_EXTS].join(', ')}` })
    }

    const storageKey = `client-brain/${agencyId}/${clientId}/${crypto.randomUUID()}${fileExt}`
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const { Readable } = await import('node:stream')
    await uploadStream(storageKey, Readable.from(buffer), mimetype)

    // Resolve internal user ID from Clerk user ID for audit trail.
    // If no DB User record is linked yet, fall back to storing the Clerk user ID directly —
    // the master view resolves it via Clerk API on read.
    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true, name: true, email: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    const attachment = await prisma.clientBrainAttachment.create({
      data: {
        agencyId, clientId, filename, storageKey, mimeType: mimetype,
        sizeBytes: buffer.byteLength, extractionStatus: 'pending', summaryStatus: 'pending',
        source, verticalId, uploadMethod: 'file',
        uploadedByUserId: storedUploaderId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, uploadMethod: true,
      },
    })

    await getClientBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId })
    return reply.code(201).send({ data: { ...attachment, uploadedByName: uploader?.name ?? uploader?.email ?? null } })
  })

  // POST from URL (optional ?source= and ?verticalId= query params)
  app.post<{ Params: { clientId: string }; Body: { url: string }; Querystring: { source?: string; verticalId?: string } }>('/:clientId/brain/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const { url } = req.body
    const source = req.query.source?.trim() || 'client'
    const verticalId = req.query.verticalId?.trim() || null
    if (!url) return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true, name: true, email: true } })
    const storedUploaderId = uploader?.id ?? req.auth.userId

    let hostname = url
    try { hostname = new URL(url).hostname } catch {}

    const attachment = await prisma.clientBrainAttachment.create({
      data: {
        agencyId, clientId, filename: hostname, sourceUrl: url, mimeType: 'text/html',
        sizeBytes: 0, extractionStatus: 'pending', summaryStatus: 'pending',
        source, verticalId, uploadMethod: 'url',
        uploadedByUserId: storedUploaderId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, uploadMethod: true,
      },
    })

    await getClientBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId, url })
    return reply.code(201).send({ data: { ...attachment, uploadedByName: uploader?.name ?? uploader?.email ?? null } })
  })

  // PATCH summary (manual edit)
  app.patch<{ Params: { clientId: string; attachmentId: string }; Body: { summary: string } }>(
    '/:clientId/brain/attachments/:attachmentId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({ where: { id: attachmentId, clientId, agencyId } })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      await prisma.clientBrainAttachment.update({
        where: { id: attachmentId },
        data: { summary: req.body.summary, summaryStatus: 'ready' },
      })
      return reply.send({ data: { ok: true } })
    }
  )

  // GET /:clientId/brain/all — master view: all brain attachments across all surfaces
  app.get<{ Params: { clientId: string } }>('/:clientId/brain/all', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // 1. ClientBrainAttachment (unified table — source: client | demand_gen | gtm_framework | branding)
    const clientBrainDocs = await prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, sourceUrl: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        source: true, verticalId: true, campaignId: true, campaignScopedOnly: true,
        uploadedByUserId: true, uploadMethod: true,
      },
    })

    // 2. CampaignBrainAttachment (separate table, always source='campaign')
    const campaignBrainDocs = await prisma.campaignBrainAttachment.findMany({
      where: { agencyId, campaign: { clientId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, sourceUrl: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        campaignScopedOnly: true, uploadedByUserId: true,
        campaign: { select: { id: true, name: true } },
      },
    })

    // 3. ClientBrandAttachment (branding brain — separate table, always source='branding')
    const brandDocs = await prisma.clientBrandAttachment.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        verticalId: true, uploadedByUserId: true,
        vertical: { select: { id: true, name: true } },
      },
    })

    // 4. ClientVerticalBrainAttachment — client × vertical research (scheduled tasks, manual uploads)
    const verticalBrainDocs = await prisma.clientVerticalBrainAttachment.findMany({
      where: { clientId, agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, sourceUrl: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true,
        verticalId: true, uploadedByUserId: true, uploadMethod: true,
        vertical: { select: { id: true, name: true } },
      },
    })

    // Resolve uploader display names across all tables.
    // uploadedByUserId may be an internal User UUID or a Clerk user ID (user_xxx fallback).
    const allUploaderIds = [...new Set([
      ...clientBrainDocs.map((d) => d.uploadedByUserId),
      ...campaignBrainDocs.map((d) => d.uploadedByUserId),
      ...brandDocs.map((d) => d.uploadedByUserId),
      ...verticalBrainDocs.map((d) => d.uploadedByUserId),
    ].filter(Boolean) as string[])]

    const uploaderMap: Record<string, string | null> = {}
    if (allUploaderIds.length > 0) {
      const internalIds = allUploaderIds.filter((id) => !id.startsWith('user_'))
      const clerkIds = allUploaderIds.filter((id) => id.startsWith('user_'))

      if (internalIds.length > 0) {
        const dbUsers = await prisma.user.findMany({ where: { id: { in: internalIds }, agencyId }, select: { id: true, name: true, email: true } })
        for (const u of dbUsers) uploaderMap[u.id] = u.name ?? u.email ?? null
      }
      if (clerkIds.length > 0) {
        const clerkNames = await getClerkUserNames(clerkIds)
        for (const [clerkId, { name, email }] of Object.entries(clerkNames)) {
          uploaderMap[clerkId] = name ?? email ?? null
        }
      }
    }

    const SOURCE_LABELS: Record<string, string> = {
      client: 'Client Brain', campaign: 'Campaign', gtm_framework: 'GTM Framework',
      demand_gen: 'Demand Gen', branding: 'Branding', scheduled: 'Scheduled Task',
    }

    const allDocs = [
      ...clientBrainDocs.map((d) => ({
        id: d.id, table: 'client_brain_attachments',
        filename: d.filename, sourceUrl: d.sourceUrl, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: d.source, sourceLabel: SOURCE_LABELS[d.source] ?? d.source,
        verticalId: d.verticalId, verticalName: null as string | null,
        campaignId: d.campaignId, campaignName: null as string | null,
        campaignScopedOnly: d.campaignScopedOnly,
        uploadMethod: d.uploadMethod,
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
      ...campaignBrainDocs.map((d) => ({
        id: d.id, table: 'campaign_brain_attachments',
        filename: d.filename, sourceUrl: d.sourceUrl, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: 'campaign', sourceLabel: 'Campaign',
        verticalId: null, verticalName: null,
        campaignId: d.campaign.id, campaignName: d.campaign.name,
        campaignScopedOnly: d.campaignScopedOnly,
        uploadMethod: d.sourceUrl ? 'url' : 'file',
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
      ...brandDocs.map((d) => ({
        id: d.id, table: 'client_brand_attachments',
        filename: d.filename, sourceUrl: null, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: 'branding', sourceLabel: 'Branding',
        verticalId: d.verticalId, verticalName: d.vertical?.name ?? null,
        campaignId: null, campaignName: null, campaignScopedOnly: false,
        uploadMethod: 'file',
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
      ...verticalBrainDocs.map((d) => ({
        id: d.id, table: 'client_vertical_brain_attachments',
        filename: d.filename, sourceUrl: d.sourceUrl ?? null, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        extractionStatus: d.extractionStatus, summaryStatus: d.summaryStatus, summary: d.summary,
        createdAt: d.createdAt.toISOString(),
        source: 'scheduled', sourceLabel: 'Scheduled Task',
        verticalId: d.verticalId, verticalName: d.vertical?.name ?? null,
        campaignId: null, campaignName: null, campaignScopedOnly: false,
        uploadMethod: d.uploadMethod,
        uploadedByName: d.uploadedByUserId ? (uploaderMap[d.uploadedByUserId] ?? null) : null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return reply.send({ data: allDocs })
  })

  // GET /:clientId/brain/scheduled — scheduled task results for a client, optionally filtered by vertical
  // Accepts verticalId (ClientVertical) OR brandVerticalId (ClientBrandVertical, resolved by name match)
  app.get<{ Params: { clientId: string }; Querystring: { verticalId?: string; brandVerticalId?: string } }>(
    '/:clientId/brain/scheduled',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId } = req.params
      const { verticalId, brandVerticalId } = req.query
      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      // Resolve brandVerticalId → Vertical.id by name match
      // ScheduledTask.verticalId = Vertical.id; ClientBrandVertical has no direct FK to Vertical,
      // so match by name (user names them identically, e.g. "Healthcare").
      let resolvedVerticalId = verticalId
      if (brandVerticalId && !verticalId) {
        const bv = await prisma.clientBrandVertical.findFirst({
          where: { id: brandVerticalId, clientId, agencyId },
          select: { name: true },
        })
        if (bv) {
          const v = await prisma.vertical.findFirst({
            where: { agencyId, name: bv.name },
            select: { id: true },
          })
          resolvedVerticalId = v?.id
        }
      }

      const entries = await prisma.clientBrainAttachment.findMany({
        where: {
          clientId, agencyId, source: 'scheduled',
          ...(resolvedVerticalId ? { verticalId: resolvedVerticalId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, filename: true, summary: true, summaryStatus: true, extractedText: true, createdAt: true, verticalId: true },
      })
      return reply.send({ data: entries })
    },
  )

  // GET raw extracted text for a client brain attachment
  app.get<{ Params: { clientId: string; attachmentId: string } }>(
    '/:clientId/brain/attachments/:attachmentId/text',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({
        where: { id: attachmentId, clientId, agencyId },
        select: { extractedText: true, filename: true },
      })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      return reply.send({ data: { text: attachment.extractedText ?? '', filename: attachment.filename } })
    }
  )

  // ── Client × Vertical Brain ───────────────────────────────────────────────────

  // GET attachments for a specific (client, vertical) pair
  app.get<{ Params: { clientId: string; verticalId: string } }>('/:clientId/brain/vertical/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, verticalId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const attachments = await prisma.clientVerticalBrainAttachment.findMany({
      where: { agencyId, clientId, verticalId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, summary: true, createdAt: true, uploadMethod: true,
      },
    })
    return reply.send({ data: attachments })
  })

  // POST upload file for (client, vertical) pair
  app.post<{ Params: { clientId: string; verticalId: string } }>('/:clientId/brain/vertical/:verticalId/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, verticalId } = req.params
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const fileExt = extname(filename).toLowerCase()
    if (!ALLOWED_CLIENT_BRAIN_EXTS.has(fileExt)) {
      return reply.code(400).send({ error: `File type ${fileExt} not supported. Allowed: ${[...ALLOWED_CLIENT_BRAIN_EXTS].join(', ')}` })
    }

    const storageKey = `client-vertical-brain/${agencyId}/${clientId}/${verticalId}/${crypto.randomUUID()}${fileExt}`
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const { Readable } = await import('node:stream')
    await uploadStream(storageKey, Readable.from(buffer), mimetype)

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })

    const attachment = await prisma.clientVerticalBrainAttachment.create({
      data: {
        agencyId, clientId, verticalId, filename, storageKey, mimeType: mimetype,
        sizeBytes: buffer.byteLength, uploadMethod: 'file',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getClientVerticalBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId, verticalId })
    return reply.code(201).send({ data: attachment })
  })

  // POST from URL for (client, vertical) pair
  app.post<{ Params: { clientId: string; verticalId: string }; Body: { url: string } }>('/:clientId/brain/vertical/:verticalId/attachments/from-url', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, verticalId } = req.params
    const { url } = req.body
    if (!url) return reply.code(400).send({ error: 'url is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const uploader = await prisma.user.findFirst({ where: { clerkUserId: req.auth.userId, agencyId }, select: { id: true } })
    let hostname = url
    try { hostname = new URL(url).hostname } catch {}

    const attachment = await prisma.clientVerticalBrainAttachment.create({
      data: {
        agencyId, clientId, verticalId, filename: hostname, sourceUrl: url, mimeType: 'text/html',
        sizeBytes: 0, uploadMethod: 'url',
        uploadedByUserId: uploader?.id ?? req.auth.userId,
      },
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true, sourceUrl: true,
        extractionStatus: true, summaryStatus: true, createdAt: true,
      },
    })

    await getClientVerticalBrainProcessQueue().add('process', { agencyId, attachmentId: attachment.id, clientId, verticalId, url })
    return reply.code(201).send({ data: attachment })
  })

  // DELETE a (client, vertical) brain attachment
  app.delete<{ Params: { clientId: string; verticalId: string; attachmentId: string } }>('/:clientId/brain/vertical/:verticalId/attachments/:attachmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, verticalId, attachmentId } = req.params
    const attachment = await prisma.clientVerticalBrainAttachment.findFirst({ where: { id: attachmentId, agencyId, clientId, verticalId } })
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
    await prisma.clientVerticalBrainAttachment.delete({ where: { id: attachmentId } })
    if (attachment.storageKey) {
      try { await deleteObject(attachment.storageKey) } catch {}
    }
    return reply.send({ data: { ok: true } })
  })

  // POST /:clientId/setup-suggest — AI magic: suggest setup field values from client brain
  app.post<{ Params: { clientId: string } }>(
    '/:clientId/setup-suggest',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId } = req.params
      const { verticalId, fields } = req.body as {
        verticalId?: string
        fields: Array<{ nodeId: string; field: string; label: string; placeholder?: string }>
      }

      if (!fields || fields.length === 0) return reply.code(400).send({ error: 'fields is required' })

      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: {
          name: true,
          industry: true,
          brandBuilders: { take: 1, orderBy: { createdAt: 'desc' }, select: { dataJson: true } },
          brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
        },
      })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      // Load relevant brain docs (GTM framework + demand gen base — highest signal for keywords/topics)
      const brainDocs = await prisma.clientBrainAttachment.findMany({
        where: {
          clientId, agencyId,
          summaryStatus: 'ready',
          source: { in: ['gtm_framework', 'demand_gen', 'client'] },
          ...(verticalId && verticalId !== '__company__' ? { verticalId } : {}),
        },
        select: { filename: true, summary: true, source: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })

      const brandProfile = client.brandProfiles[0]
      const brandBuilder = client.brandBuilders[0]
      const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson ?? brandBuilder?.dataJson

      const contextParts: string[] = [
        `CLIENT: ${client.name}`,
        `INDUSTRY: ${client.industry ?? 'not specified'}`,
      ]
      if (brandData) {
        const b = brandData as Record<string, unknown>
        const audience = b.target_audience ?? b.audience
        const positioning = b.positioning ?? b.value_proposition ?? b.tagline
        if (positioning) contextParts.push(`POSITIONING: ${JSON.stringify(positioning)}`)
        if (audience) contextParts.push(`TARGET AUDIENCE: ${JSON.stringify(audience)}`)
      }
      if (brainDocs.length > 0) {
        contextParts.push('\nKNOWLEDGE BASE:')
        for (const doc of brainDocs) {
          if (doc.summary?.trim()) {
            contextParts.push(`--- ${doc.filename} (${doc.source}) ---\n${doc.summary.trim()}`)
          }
        }
      }

      const fieldLines = fields.map((f, idx) =>
        `${idx + 1}. field="${f.field}" label="${f.label}"${f.placeholder ? ` example="${f.placeholder}"` : ''}`
      ).join('\n')

      const { model: fastModel } = await getModelForRole('generation_fast')

      const result = await callModel(
        {
          provider: 'anthropic',
          model: fastModel,
          api_key_ref: 'ANTHROPIC_API_KEY',
          max_tokens: 400,
          temperature: 0.4,
        },
        `You are helping set up a content workflow for a marketing agency client.

${contextParts.join('\n')}

FIELDS TO FILL:
${fieldLines}

Based on the client context above, suggest the best value for each field.
Return ONLY a valid JSON object mapping field names to suggested string values.
Be specific and use real details from the context — do not use generic placeholders.
If a field asks for URLs that aren't clearly present in the context, omit it or return an empty string.
Example format: {"field1":"value1","field2":"value2"}`,
      )

      let suggestions: Record<string, string> = {}
      try {
        const text = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
        suggestions = JSON.parse(text)
      } catch {
        // Return empty suggestions rather than erroring — UI will handle gracefully
      }

      return reply.send({ data: { suggestions } })
    }
  )

  // DELETE attachment — Admin only
  app.delete<{ Params: { clientId: string; attachmentId: string } }>(
    '/:clientId/brain/attachments/:attachmentId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, attachmentId } = req.params
      const attachment = await prisma.clientBrainAttachment.findFirst({ where: { id: attachmentId, clientId, agencyId } })
      if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
      if (attachment.storageKey) {
        try { await deleteObject(attachment.storageKey) } catch {}
      }
      await prisma.clientBrainAttachment.delete({ where: { id: attachmentId } })
      return reply.send({ data: { ok: true } })
    }
  )

  // ── Client Doc Style ──────────────────────────────────────────────────────────

  const docStyleBody = z.object({
    primaryColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    secondaryColor:  z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    headingFont:     z.string().max(100).nullable().optional(),
    bodyFont:        z.string().max(100).nullable().optional(),
    agencyName:      z.string().max(200).nullable().optional(),
    coverPage:       z.boolean().nullable().optional(),
    pageNumbers:     z.boolean().nullable().optional(),
    footerText:      z.string().max(500).nullable().optional(),
    applyToGtm:      z.boolean().nullable().optional(),
    applyToDemandGen: z.boolean().nullable().optional(),
    applyToBranding: z.boolean().nullable().optional(),
  })

  // GET /:id/doc-style
  app.get<{ Params: { id: string } }>('/:id/doc-style', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const style = await prisma.clientDocStyle.findUnique({ where: { clientId: req.params.id } })
    return reply.send({ data: style ?? null })
  })

  // PATCH /:id/doc-style
  app.patch<{ Params: { id: string } }>('/:id/doc-style', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = docStyleBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    const style = await prisma.clientDocStyle.upsert({
      where: { clientId: req.params.id },
      create: { agencyId, clientId: req.params.id, ...data },
      update: data,
    })
    return reply.send({ data: style })
  })

  // POST /:id/doc-style/logo
  app.post<{ Params: { id: string } }>('/:id/doc-style/logo', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })
    const LOGO_MIME: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    }
    const ext = extname(data.filename).toLowerCase()
    if (!LOGO_MIME[ext]) return reply.code(400).send({ error: 'Only JPG, PNG, GIF, WEBP, SVG allowed' })
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (buffer.byteLength > 5 * 1024 * 1024) return reply.code(400).send({ error: 'Logo must be under 5 MB' })
    const base64 = `data:${LOGO_MIME[ext]};base64,${buffer.toString('base64')}`
    await prisma.clientDocStyle.upsert({
      where: { clientId: req.params.id },
      create: { agencyId, clientId: req.params.id, logoStorageKey: base64 },
      update: { logoStorageKey: base64 },
    })
    return reply.send({ data: { ok: true } })
  })

  // DELETE /:id/doc-style/logo
  app.delete<{ Params: { id: string } }>('/:id/doc-style/logo', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    await prisma.clientDocStyle.upsert({
      where: { clientId: req.params.id },
      create: { agencyId, clientId: req.params.id },
      update: { logoStorageKey: null },
    })
    return reply.send({ data: { ok: true } })
  })

  // GET /:id/doc-style/merged — agency defaults merged with client overrides
  app.get<{ Params: { id: string } }>('/:id/doc-style/merged', async (req, reply) => {
    const { agencyId } = req.auth
    const client = await prisma.client.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const [agency, clientStyle] = await Promise.all([
      prisma.agencySettings.findUnique({ where: { agencyId } }),
      prisma.clientDocStyle.findUnique({ where: { clientId: req.params.id } }),
    ])
    const merged = {
      logoStorageKey: clientStyle?.logoStorageKey ?? agency?.docLogoStorageKey ?? null,
      primaryColor:   clientStyle?.primaryColor   ?? agency?.docPrimaryColor   ?? '#1B1F3B',
      secondaryColor: clientStyle?.secondaryColor ?? agency?.docSecondaryColor ?? '#4A90D9',
      headingFont:    clientStyle?.headingFont    ?? agency?.docHeadingFont    ?? 'Calibri',
      bodyFont:       clientStyle?.bodyFont       ?? agency?.docBodyFont       ?? 'Calibri',
      agencyName:     clientStyle?.agencyName     ?? agency?.docAgencyName     ?? null,
      coverPage:      clientStyle?.coverPage      ?? agency?.docCoverPage      ?? true,
      pageNumbers:    clientStyle?.pageNumbers    ?? agency?.docPageNumbers    ?? true,
      footerText:     clientStyle?.footerText     ?? agency?.docFooterText     ?? null,
      applyToGtm:     clientStyle?.applyToGtm     ?? agency?.docApplyToGtm     ?? true,
      applyToDemandGen: clientStyle?.applyToDemandGen ?? agency?.docApplyToDemandGen ?? false,
      applyToBranding: clientStyle?.applyToBranding  ?? agency?.docApplyToBranding  ?? false,
    }
    return reply.send({ data: merged })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT BRIEF LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GET /:id/briefs — list briefs for client, scoped to verticalId when provided
  app.get<{ Params: { id: string }; Querystring: { verticalId?: string } }>('/:id/briefs', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId } = req.params
    const { verticalId } = req.query
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    const briefs = await withAgency(agencyId, () =>
      prisma.clientBrief.findMany({
        where: {
          agencyId,
          clientId,
          // verticalId filter: exact match OR unscoped (empty array = pre-scoping legacy brief)
          ...(verticalId ? {
            OR: [
              { verticalIds: { has: verticalId } },
              { verticalIds: { equals: [] } },
            ],
          } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })
    )
    return reply.send({ data: briefs })
  })

  // ── POST /:id/briefs — create a brief (pasted or blank)
  app.post<{ Params: { id: string }; Body: { name: string; type?: string; rawInput?: string; content?: string; verticalId?: string } }>(
    '/:id/briefs',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId } = req.params
      const { name, type = 'company', rawInput, content, verticalId } = req.body
      if (!name) return reply.code(400).send({ error: 'name is required' })
      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      let brief
      try {
        brief = await withAgency(agencyId, () =>
          prisma.clientBrief.create({
            data: {
              agencyId,
              clientId,
              name,
              type,
              source: rawInput ? 'pasted' : 'manual',
              rawInput: rawInput ?? null,
              content: content ?? null,
              extractionStatus: rawInput ? 'pending' : 'none',
              verticalIds: verticalId ? [verticalId] : [],
            },
          })
        )
      } catch (err) {
        req.log.error({ err }, '[briefs/create] Prisma error — client_briefs table may be missing. Run run-migration.mjs against the DB.')
        const msg = err instanceof Error ? err.message : String(err)
        return reply.code(500).send({ error: msg })
      }

      if (rawInput) {
        try {
          const { getBriefExtractQueue } = await import('../lib/queues.js')
          await getBriefExtractQueue().add('extract', { agencyId, clientId, briefId: brief.id })
        } catch (err) {
          req.log.error({ err }, '[briefs/create] failed to enqueue extract job')
        }
      }

      return reply.code(201).send({ data: brief })
    }
  )

  // ── PATCH /:id/briefs/:briefId — update brief (name, content, status, verticalIds, sharedAcrossVerticals, etc.)
  app.patch<{
    Params: { id: string; briefId: string }
    Body: {
      name?: string
      type?: string
      status?: string
      content?: string
      rawInput?: string
      extractedData?: Record<string, unknown>
      verticalIds?: string[]
      sharedAcrossVerticals?: boolean
    }
  }>('/:id/briefs/:briefId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, briefId } = req.params
    const existing = await withAgency(agencyId, () =>
      prisma.clientBrief.findFirst({ where: { id: briefId, agencyId, clientId } })
    )
    if (!existing) return reply.code(404).send({ error: 'Brief not found' })

    const { name, type, status, content, rawInput, extractedData, verticalIds, sharedAcrossVerticals } = req.body
    const brief = await withAgency(agencyId, () =>
      prisma.clientBrief.update({
        where: { id: briefId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(content !== undefined ? { content } : {}),
          ...(rawInput !== undefined ? { rawInput } : {}),
          ...(extractedData !== undefined ? { extractedData: extractedData as object } : {}),
          ...(verticalIds !== undefined ? { verticalIds } : {}),
          ...(sharedAcrossVerticals !== undefined ? { sharedAcrossVerticals } : {}),
        },
      })
    )

    // If rawInput was updated, re-trigger extraction
    if (rawInput !== undefined && rawInput) {
      const { getBriefExtractQueue } = await import('../lib/queues.js')
      await getBriefExtractQueue().add('extract', { agencyId, clientId, briefId })
    }

    return reply.send({ data: brief })
  })

  // ── DELETE /:id/briefs/:briefId
  app.delete<{ Params: { id: string; briefId: string } }>('/:id/briefs/:briefId', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, briefId } = req.params
    const existing = await withAgency(agencyId, () =>
      prisma.clientBrief.findFirst({ where: { id: briefId, agencyId, clientId }, select: { id: true } })
    )
    if (!existing) return reply.code(404).send({ error: 'Brief not found' })
    await withAgency(agencyId, () => prisma.clientBrief.delete({ where: { id: briefId } }))
    return reply.code(204).send()
  })

  // ── POST /:id/briefs/:briefId/extract — re-trigger extraction
  app.post<{ Params: { id: string; briefId: string } }>('/:id/briefs/:briefId/extract', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, briefId } = req.params
    const existing = await withAgency(agencyId, () =>
      prisma.clientBrief.findFirst({ where: { id: briefId, agencyId, clientId }, select: { id: true, rawInput: true } })
    )
    if (!existing) return reply.code(404).send({ error: 'Brief not found' })
    if (!existing.rawInput) return reply.code(400).send({ error: 'Brief has no raw input to extract from' })
    await withAgency(agencyId, () =>
      prisma.clientBrief.update({ where: { id: briefId }, data: { extractionStatus: 'pending' } })
    )
    const { getBriefExtractQueue } = await import('../lib/queues.js')
    await getBriefExtractQueue().add('extract', { agencyId, clientId, briefId })
    return reply.code(202).send({ data: { status: 'pending' } })
  })

  // ── POST /:id/briefs/upload — upload DOCX/TXT file → create brief + queue extraction
  app.post<{ Params: { id: string }; Body: { name?: string; type?: string } }>(
    '/:id/briefs/upload',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id: clientId } = req.params
      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
      if (!client) return reply.code(404).send({ error: 'Client not found' })

      let uploadData: { id?: string; storageKey?: string; filename?: string; text?: string } | null = null
      try {
        const parts = req.parts()
        for await (const part of parts) {
          if (part.type === 'file') {
            const filename = part.filename ?? 'brief.docx'
            const ext = filename.split('.').pop()?.toLowerCase() ?? ''
            if (!['docx', 'txt', 'pdf', 'md'].includes(ext)) {
              return reply.code(400).send({ error: 'Only DOCX, TXT, PDF, and MD files are supported' })
            }
            const { uploadBuffer } = await import('@contentnode/storage')
            const chunks: Buffer[] = []
            for await (const chunk of part.file) { chunks.push(chunk as Buffer) }
            const buf = Buffer.concat(chunks)

            let text = ''
            if (ext === 'docx') {
              const { default: mammoth } = await import('mammoth')
              const res = await mammoth.extractRawText({ buffer: buf })
              text = res.value
            } else {
              text = buf.toString('utf-8')
            }

            const storageKey = `briefs/${agencyId}/${clientId}/${Date.now()}_${filename}`
            await uploadBuffer(storageKey, buf, { contentType: part.mimetype ?? 'application/octet-stream' })
            uploadData = { storageKey, filename, text }
            break
          }
        }
      } catch (err) {
        console.error('[briefs/upload] file processing error:', err)
        return reply.code(500).send({ error: 'File processing failed' })
      }

      if (!uploadData?.text) return reply.code(400).send({ error: 'Could not extract text from file' })

      const briefName = (req.body as Record<string, string | undefined>).name ?? uploadData.filename ?? 'Uploaded Brief'
      const briefType = (req.body as Record<string, string | undefined>).type ?? 'company'

      const brief = await withAgency(agencyId, () =>
        prisma.clientBrief.create({
          data: {
            agencyId,
            clientId,
            name: briefName,
            type: briefType,
            source: 'uploaded',
            rawInput: uploadData!.text,
            storageKey: uploadData!.storageKey ?? null,
            filename: uploadData!.filename ?? null,
            extractionStatus: 'pending',
          },
        })
      )

      const { getBriefExtractQueue } = await import('../lib/queues.js')
      await getBriefExtractQueue().add('extract', { agencyId, clientId, briefId: brief.id })

      return reply.code(201).send({ data: brief })
    }
  )

  // ── PATCH /:id/framework/:verticalId/primary-brief — set/clear primary brief for a vertical
  app.patch<{
    Params: { id: string; verticalId: string }
    Body: { primaryBriefId: string | null }
  }>('/:id/framework/:verticalId/primary-brief', async (req, reply) => {
    const { agencyId } = req.auth
    const { id: clientId, verticalId } = req.params
    const { primaryBriefId } = req.body

    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    // Upsert the framework record just to store primaryBriefId
    const framework = await withAgency(agencyId, () =>
      prisma.clientFramework.upsert({
        where: { clientId_verticalId: { clientId, verticalId } },
        update: { primaryBriefId: primaryBriefId ?? null },
        create: { agencyId, clientId, verticalId, data: {}, sectionStatus: {}, primaryBriefId: primaryBriefId ?? null },
        select: { id: true, primaryBriefId: true },
      })
    )

    return reply.send({ data: framework })
  })
}
