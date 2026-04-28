import { prisma, withAgency } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { downloadBuffer } from '@contentnode/storage'
import { Queue, type Job } from 'bullmq'
import { getConnection, QUEUE_KIT_GENERATION, type KitGenerationJobData } from './queues.js'

const SONNET = 'claude-sonnet-4-6'
const API_KEY = 'ANTHROPIC_API_KEY'

export interface DocStyle {
  primaryColor: string
  secondaryColor: string
  headingFont: string
  bodyFont: string
  logoDataUrl: string | null
  agencyName: string
  footerText: string
  includeCoverPage: boolean
  includePageNumbers: boolean
}

export interface AssetRecord {
  index: number
  name: string
  num: string
  ext: string
  status: 'pending' | 'generating' | 'complete' | 'error'
  content?: string
  stage?: string
  completedAt?: string
  error?: string
}

export interface GeneratedFiles {
  assets: AssetRecord[]
  docStyle?: DocStyle
  checkpointQuestions?: string
  consistencyIssues?: string[]
}

async function resolveDocStyle(agencyId: string, clientId: string): Promise<DocStyle> {
  const [agency, clientStyle] = await Promise.all([
    prisma.agencySettings.findUnique({ where: { agencyId } }),
    prisma.clientDocStyle.findUnique({ where: { clientId } }),
  ])

  const logoKey = clientStyle?.logoStorageKey ?? agency?.docLogoStorageKey ?? null
  let logoDataUrl: string | null = null
  if (logoKey) {
    try {
      if (logoKey.startsWith('data:')) {
        logoDataUrl = logoKey
      } else {
        const buf = await downloadBuffer(logoKey)
        const ext = logoKey.split('.').pop()?.toLowerCase() ?? 'png'
        const mime = ext === 'svg' ? 'image/svg+xml'
          : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
          : ext === 'gif' ? 'image/gif'
          : 'image/png'
        logoDataUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch (err) {
      console.warn('[kit-generation] logo resolve failed (non-fatal):', err)
    }
  }

  return {
    primaryColor:     clientStyle?.primaryColor   ?? agency?.docPrimaryColor   ?? '#1B1F3B',
    secondaryColor:   clientStyle?.secondaryColor ?? agency?.docSecondaryColor ?? '#4A90D9',
    headingFont:      clientStyle?.headingFont    ?? agency?.docHeadingFont    ?? 'Calibri',
    bodyFont:         clientStyle?.bodyFont       ?? agency?.docBodyFont       ?? 'Calibri',
    logoDataUrl,
    agencyName:       clientStyle?.agencyName     ?? agency?.docAgencyName     ?? '',
    footerText:       clientStyle?.footerText     ?? agency?.docFooterText     ?? '',
    includeCoverPage: (clientStyle?.coverPage     ?? agency?.docCoverPage      ?? true),
    includePageNumbers: (clientStyle?.pageNumbers ?? agency?.docPageNumbers    ?? true),
  }
}

export const ASSET_DEFINITIONS: Omit<AssetRecord, 'status'>[] = [
  { index: 0, name: 'Brochure',           num: '01', ext: 'docx' },
  { index: 1, name: 'eBook',              num: '02', ext: 'html' },
  { index: 2, name: 'Sales Cheat Sheet',  num: '03', ext: 'html' },
  { index: 3, name: 'BDR Emails',         num: '04', ext: 'docx' },
  { index: 4, name: 'Customer Deck',      num: '05', ext: 'pptx' },
  { index: 5, name: 'Video Script',       num: '06', ext: 'docx' },
  { index: 6, name: 'Web Page Copy',      num: '07', ext: 'docx' },
  { index: 7, name: 'Internal Brief',     num: '08', ext: 'docx' },
]

export function initAssets(): AssetRecord[] {
  return ASSET_DEFINITIONS.map(d => ({ ...d, status: 'pending' as const }))
}

const CHECKPOINT_QUESTIONS: string[] = [
  `Before we move to the eBook, a few quick checks:\n1. The challenge column shows names only — no sub-paragraphs. Does that work or do you want context added?\n2. Are all differentiators one line each?\n3. Should 'Read the full story' rows be excluded from case studies? (Default: yes)\n\nApprove to continue or tell me what to change.`,
  `eBook check:\n1. Confirm the eBook is not gated — no 'download behind a form' language.\n2. Are the service pillar pills showing in the correct brand colours?\n3. Should lead hooks appear verbatim or paraphrased?\n\nApprove to continue or tell me what to change.`,
  `Cheat Sheet check:\n1. Do entry points for each segment match your primary CTA?\n2. Should competitor names appear? (Default: internal doc only, never public)\n3. Is the agency role statement present — 'We implement the controls; the organisation demonstrates compliance'?\n\nApprove to continue or tell me what to change.`,
  `BDR Email check:\n1. Are all email bodies 5-6 lines maximum?\n2. Are voicemail scripts 2-3 sentences maximum?\n3. Do all emails have [customize with...] placeholder brackets?\n4. Is the CTA the primary assessment offer in every email?\n\nApprove to continue or tell me what to change.`,
  `Deck check:\n1. Is every statistic sourced? Flag any unsourced stats now.\n2. Case study slides have a design team placeholder note to insert visuals — confirmed?\n3. Do regulatory frameworks match your intake?\n\nApprove to continue or tell me what to change.`,
  `Video Script check:\n1. Does the CTA URL at the end match your primary CTA?\n2. Is the production note present with the positioning constraint?\n\nApprove to continue or tell me what to change.`,
  `Web Page check:\n1. Are all segment cards one sentence only?\n2. Does the resources slider show only the eBook and Brochure?\n3. Are all service cards one sentence maximum?\n\nApprove to continue or tell me what to change.`,
  `Internal Brief check:\n1. Are key messages plain bullets with no shaded boxes?\n2. Does the asset table use simple borders only?\n3. Does the non-negotiable box use the exact 'What we are NOT' language from your framework?\n\nAll 8 assets complete — approve to go to delivery.`,
]

const SYSTEM_PROMPT = `You are a senior B2B content strategist generating a professional go-to-market asset for an agency. You have been given a structured intake JSON containing all client and vertical information. Generate the asset exactly as specified. Apply these rules to all output:
- Active voice throughout, no passive constructions
- Never use: holistic, end-to-end, robust, seamless, cutting-edge, synergy, leverage as a verb, utilize, paradigm, digital transformation journey
- Never open with "By partnering with..." or "In today's increasingly complex..."
- Lead with operational consequence before technical solution
- Write as a peer, not a vendor
- Every claim must be specific and quantified where possible
- Never claim the agency certifies compliance, builds industry-specific software, or provides legal counsel
- Use US English spelling, grammar, and idioms throughout`

function getAssetUserPrompt(assetIndex: number, intake: Record<string, unknown>, docStyle?: DocStyle): string {
  const intakeStr = JSON.stringify(intake, null, 2)
  const { name } = ASSET_DEFINITIONS[assetIndex]

  const brandPreamble = docStyle && HTML_ASSET_INDICES.has(assetIndex)
    ? `CRITICAL — Use these exact brand values in all CSS. Define them at the top of your :root block and use var() throughout — never hardcode hex values:\n` +
      `:root {\n  --color-primary: ${docStyle.primaryColor};\n  --color-dark: ${docStyle.primaryColor};\n  --color-accent: ${docStyle.secondaryColor};\n  --heading-font: '${docStyle.headingFont}', sans-serif;\n  --body-font: '${docStyle.bodyFont}', sans-serif;\n}\n` +
      `Always write background-color: var(--color-primary), color: var(--color-accent), etc. Do not use #1a2744, #0070f3, or any other hardcoded hex in the CSS.\n` +
      (docStyle.agencyName ? `Agency name for footer and navigation: "${docStyle.agencyName}" — include this in the footer and nav bar.\n` : '') +
      (docStyle.footerText ? `Footer tagline: "${docStyle.footerText}" — include this in the document footer section.\n` : '') +
      `\n`
    : ''

  const base = `${brandPreamble}Here is the complete intake JSON:\n\n\`\`\`json\n${intakeStr}\n\`\`\`\n\nGenerate the ${name} now.\n\n`

  const instructions = [
    // 01 Brochure
    `Using the intake JSON provided, generate a professional B2B brochure in markdown format with these sections in order:

1. **Cover**: headline from vertical.taglines[0], sub-headline from vertical.positioning_statement, vertical name
2. **Stats bar**: 4 statistics from statistics[] — show stat, label, and source for each
3. **Challenges table**: 3 columns — Challenge Name (name field only, no sub-paragraph text), Solution (derived from challenge.solution), Service Pillar (challenge.service_pillar). One row per challenge from challenges[].
4. **Four pillars**: use pillars[] array. Format as 2×2 grid using markdown. Each cell: pillar name as bold header, one-sentence value_prop, then key_services as bullet list.
5. **Why Us**: each differentiator from differentiators[] as a single bullet. One line per differentiator. No paragraphs.
6. **Proof points**: stats from proof_points[] as a callout block
7. **Case studies**: two cards from case_studies[0] and case_studies[1]. Each card: client_profile | situation (2 sentences max) | engagement (2 sentences max) | outcomes (2 sentences max). Omit any "Read the full story" rows.
8. **Back cover CTA**: primary_cta.name as headline, primary_cta.description as body, then the exact URL from primary_cta.url on its own line as plain text. IMPORTANT: Substitute the actual URL value from the intake JSON — do not output "primary_cta.url" as a literal string.

Enforce all copy length rules. Output clean markdown only.`,

    // 02 eBook
    `Using the intake JSON provided, generate a complete standalone eBook as a full HTML document. Include <!DOCTYPE html>, <html>, <head> (with title, Google Fonts DM Sans link, and all CSS inline in <style>), and <body>.

Structure and requirements:
- CSS: define --color-primary, --color-dark, --color-accent CSS variables at :root. Use professional dark navy (#1a2744) for dark sections and accent (#0070f3) for highlights.
- Navigation bar: vertical name on left, 5 section links on right (The Landscape, In Practice, What We Do, Why Us, Talk to Us)
- Cover section: dark background (#1a2744), large headline using the exact verbatim text of vertical.taglines[0] (copy character-for-character), 3 stats from statistics[] in a row
- Section 1 — The Landscape: 4-stat grid (stat + label + source), challenge rows with colored service pillar pills (one row per challenge from challenges[]), regulatory cards from regulatory_frameworks[]
- Section 2 — In Practice: 2 case study cards from case_studies[] — client_profile, situation, outcomes, headline_stat
- Section 3 — What We Do: 4 pillar bands from pillars[], each with value_prop and key_services bullet list and matching proof point from proof_points[]
- Section 4 — Why Us: differentiator cards from differentiators[], proof strip with stats from proof_points[]
- Section 5 — Talk to Us: split CTA block — left side: primary_cta.name + primary_cta.description + CTA button linking to the actual URL from primary_cta.url (substitute the real URL from the intake JSON, also show it as visible plain text beneath the button); right side: relevant stat
- Sources footnote: numbered list of all stat sources from statistics[].map(s => s.source + ' (' + s.year + ')')
- Footer: vertical.client_name, vertical.name, document_control.document_version if available

Global style: max-width 960px, margin: 0 auto, box-shadow on main container, font-family: 'DM Sans', sans-serif. Output complete valid HTML only.`,

    // 03 Sales Cheat Sheet
    `Using the intake JSON provided, generate a 2-page sales cheat sheet as a complete standalone HTML document.

Requirements:
- Add "INTERNAL USE ONLY" prominently at the very top (red badge or banner)
- CSS: clean, high-contrast, professional. Include @media print rule that hides nav and shows page-break markers. Max-width 1000px.
- Page 1 sections (use page-break CSS class between pages):
  1. ICP Segment table: columns = Segment | Primary Buyer | Core Pain | Opening Hook | Entry Point. One row per segment from segments[]. Use lead_hook for "Opening Hook".
  2. Pain-to-Solution table: columns = # | Pain Point | Your Response | Service Pillar. One row per challenge from challenges[]. Use challenge.name, challenge.solution, challenge.service_pillar.
- Page 2 sections:
  1. Objection handling table: columns = The Objection | Your Response | Follow-Up Question. From objections[].
  2. Qualifying questions grid: 2 columns, 8 questions derived from challenges[] and segments[] insights, each with a "Why it works" note
  3. Regulatory context table from regulatory_frameworks[]: columns = Framework | Our Capability | Sales Note
  4. 2 case study cards from case_studies[]
  5. Proof points from proof_points[] and key stats from statistics[]
  6. CTA block: 3 scripted versions of the primary ask (different lengths: 1 sentence, 2 sentences, 3 sentences) based on primary_cta. Every version must end with the exact URL from primary_cta.url as a plain-text standalone line. Substitute the actual URL value from the intake JSON — never output the field path name.

Output complete valid HTML only.`,

    // 04 BDR Emails
    `Using the intake JSON provided, generate BDR call scripts and email sequences in markdown format.

Structure:
## Cover
[Vertical Name] BDR Email Sequences & Call Scripts — [Client Name]
*Version 1.0 — Internal Use Only*

## Contents
Table listing all emails: Segment | Subject Line

## How to Use
Personalisation instructions. Explain [customize with name/company/context] bracket system.

## Call Scripts
Table: Segment | Conversation Starter 1 | Conversation Starter 2 | Conversation Starter 3 | Voicemail Script (2-3 sentences max)
One row per segment from segments[].

## Email Sequences
One email block per segment from segments[], plus one AI/Innovation email for all segments. Each email:
**Subject:** [specific value-focused subject]
**Preview:** [1 sentence]
---
[Email body — MAXIMUM 5 LINES. Count lines carefully. Trim immediately if over 6 lines. Each line = one sentence or one short thought. No long paragraphs.]

**CTA:** [primary assessment offer] → [the actual URL from primary_cta.url in the intake JSON]

---
[customization note in brackets]

ENFORCE: No email body may exceed 6 lines. Count before writing. Every email CTA line must contain the actual URL value from primary_cta.url as plain text — never output "primary_cta.url" as a literal string.`,

    // 05 Customer Deck
    `Using the intake JSON provided, generate a customer presentation in markdown format structured as slides. Use ## Slide N: [Title] as the header for each slide.

## Slide 1: Cover
- Headline: vertical.taglines[0]
- Sub-headline: vertical.positioning_statement
- Client: vertical.client_name | Vertical: vertical.name

## Slide 2: Market Pressure
4 stat cards from statistics[]. For each: bold the stat value, show label beneath, cite source. Add market_narrative text below the stats.

## Slide 3: Challenges
2×3 grid layout (use markdown table or bullet structure). Each challenge from challenges[] with: name, why_it_exists (1 sentence), service_pillar as a colored label. Group by service_pillar where possible.

## Slide 4: Compliance & Regulatory
4 cards from regulatory_frameworks[]: name, capability (1 sentence), sales_note.

## Slide 5: Our Four Pillars
2×2 grid from pillars[]. Each cell: pillar name (bold), value_prop (1 sentence), key_services as 3-4 bullet points.

## Slide 6: Cloud Deep-Dive
Focus on cloud services from service_stack[] where regulatory_domain includes cloud concepts. 4 feature callouts: service name + what_it_delivers.

## Slide 7: Cybersecurity Deep-Dive
5 service cards from service_stack[] where regulatory_domain includes security concepts. Each: service name + what_it_delivers.

## Slide 8: IT Operations & Data + AI
Split slide: left = IT operations services, right = data/AI services from remaining service_stack[] items.

## Slide 9: Why Us
Stats strip from proof_points[]. Below: 6 differentiator cards from differentiators[] — each as bold label + one-sentence position.

## Slide 10: Case Study — [case_studies[0].client_profile]
3-column layout: Situation | Engagement | Outcomes. From case_studies[0].
*[Design team: insert case study visual from case study deck]*

## Slide 11: Case Study — [case_studies[1].client_profile]
3-column layout: Situation | Engagement | Outcomes. From case_studies[1].
*[Design team: insert case study visual from case study deck]*

## Slide 12: Assessment Paths
4 paths color-coded by scenario. Derive paths from regulatory_frameworks[] and segments[]. Each path: scenario name, trigger condition, entry point/CTA.

## Slide 13: Closing
Exact text of vertical.taglines[0], primary_cta.name and primary_cta.description, then the actual URL from primary_cta.url as a plain-text standalone line (substitute the real URL value from the intake JSON — never output the field path name), plus proof_points[] as closing stats.

ENFORCE: Every statistic must have a source citation on its slide. Flag [UNSOURCED] next to any stat without a source.`,

    // 06 Video Script
    `Using the intake JSON provided, generate a video script document in markdown format.

## Cover
**[vertical.name] Video Script**
Client: [vertical.client_name]
Draft v1 | Internal Use Only

## Production Notes
> **Tone:** [derive from brand_voice.tone — if empty, use "confident, direct, peer-level"]
> **Voiceover:** Clear professional delivery. Measured pace. No uptalk.
> **Music:** Understated professional background. Fade in at open, fade out under CTA.
> **Brand colours:** Per brand guidelines — reference design team for hex values.
> **Positioning constraint:** [vertical.what_we_are_not[0] — use exact text]

## Version A — 60-Second Storyboard
| Scene/Time | On-Screen Text | Imagery Suggestion |
|------------|---------------|-------------------|
[8-10 rows. Open with operational consequence from challenges[]. Build through solution. Close with CTA. Final row CTA URL must exactly match primary_cta.url]

## 60-Second Distribution Notes
- LinkedIn video: caption "X orgs face [challenge]. See how [client] responds →"
- YouTube pre-roll: skip-proof hook in first 5 seconds
- Website hero: autoplay, muted, loop first 15 seconds

## Version B — 90-Second Storyboard
| Scene/Time | On-Screen Text | Imagery Suggestion |
|------------|---------------|-------------------|
[12-14 rows. Expand challenge section, add a case study moment, fuller CTA close]

## 60-Second Voiceover Script (Version A)
[Timecoded voiceover matching Version A storyboard exactly. Format: 0:00-0:08 [text]. Every line keyed to a storyboard row.]`,

    // 07 Web Page Copy
    `Using the intake JSON provided, generate web page copy in markdown format for a vertical landing page.

## Page Metadata
- **URL:** /[slugify vertical.name]/
- **Title tag:** [vertical.taglines[0] | vertical.client_name] (max 60 chars)
- **Meta description:** [1 sentence from vertical.positioning_statement] (max 155 chars)

## Hero
**Headline:** [vertical.taglines[0]]
**Sub-headline:** [derived from vertical.positioning_statement — 1 sentence, active voice]
**Benefit pills:** [differentiators[0].label] | [differentiators[1].label] | [differentiators[2].label]
**CTA 1:** [primary_cta.name] → [primary_cta.url]
**CTA 2:** See how it works ↓

## Intro
**Sub-heading:** [derived from market_narrative — 1 sentence]
**Stats bar:** 4 stats from statistics[] — each: bold stat, label, source
**Intro callout:** 2-sentence paragraph derived from vertical.positioning_statement and market_narrative

## 3-Box Treatment
[3 boxes — MAXIMUM 2 LINES EACH. Derive from top 3 differentiators[]. Bold title + max 1 sentence.]

## CTA Banner
[primary_cta.name] — [primary_cta.description]
→ [primary_cta.url]

## Solution Stack
Group services by pillar from service_stack[]. Each service card:
**[service.service]** — [service.what_it_delivers — ONE SENTENCE MAXIMUM]

## Segments
[One card per segment from segments[]. Each card: segment.name as bold title, then ONE SENTENCE ONLY — the segment.core_pain framed as active tension. No exceptions.]

## Case Studies
[2 cards from case_studies[]. Each: client_profile, headline_stat, outcomes (2 sentences max)]

## Resources
*eBook* — [vertical.name] [vertical.client_name] eBook → download
*Brochure* — [vertical.name] [vertical.client_name] Brochure → download
[ONLY these two items in the resources section]

## Why Us
Stats bar from proof_points[].

## Final CTA
[primary_cta.name]
[primary_cta.description]
→ [primary_cta.url]

ENFORCE: Segment cards = 1 sentence only. Service cards = 1 sentence only. 3-box items = max 2 lines. Resources = eBook and Brochure only.`,

    // 08 Internal Brief
    `Using the intake JSON provided, generate an internal GTM launch brief in markdown format.

# INTERNAL USE ONLY

## Cover
**[vertical.name] GTM Launch Brief**
Client: [vertical.client_name]
Prepared by: [document_control.marketing_contact or "Marketing Team"]
Internal Use Only — Do Not Distribute

## Send Note
**To:** Sales Team + BDR Team
**Subject:** [vertical.name] Kit Ready — [vertical.client_name] — Action Required

## Opening
The [vertical.name] GTM kit is ready. [1 sentence urgency framing based on regulatory_frameworks[] — e.g. "With [regulation] enforcement accelerating, this is the quarter to move."]

## Why This Vertical, Why Now
[4 stats from statistics[] — bold the stat value, cite source and year in parentheses]
[2-3 sentence urgency paragraph drawing from regulatory_frameworks[] and market_narrative]

## What's in the Kit
SIMPLE TABLE — simple borders only, NO cell shading, NO background colors:
| # | Asset | Description | How to Use |
|---|-------|-------------|------------|
[One row per asset: 01 Brochure through 08 Internal Brief — one-line description and specific use case]

## Where to Start
| Sales Team | BDR Team |
|------------|----------|
| 1. [action] | 1. [action] |
| 2. [action] | 2. [action] |
| 3. [action] | 3. [action] |
| 4. [action] | 4. [action] |
| 5. [action] | 5. [action] |

## Primary CTA
> **[primary_cta.name]**
> [primary_cta.description]
> → [primary_cta.url]
>
> Proof: [case_studies[0].headline_stat — if available] from [case_studies[0].client_profile]

## Compliance Angle
[1 paragraph — how to use regulatory_frameworks[] in deal conversations. Specific frameworks by name. Never claim we certify compliance or provide legal counsel.]

## Key Messages
Five plain bullets. NO shaded boxes. NO heavy borders. Each = **Bold headline** + one sentence explanation.

1. **[Message headline]** — [one sentence]
2. **[Message headline]** — [one sentence]
3. **[Message headline]** — [one sentence]
4. **[Message headline]** — [one sentence]
5. **[Message headline]** — [one sentence]

## Non-Negotiable

> ⚠ **What We Are NOT:**
> [List VERBATIM from vertical.what_we_are_not[]. Every line exactly as written. Do not paraphrase. Do not reorder. Do not add or remove words.]

CRITICAL FORMATTING RULES:
- Key messages section = plain markdown bullets only, no shading whatsoever
- Asset table = | pipes | only, no CSS, no background
- Non-negotiable = verbatim text, copy-paste from what_we_are_not[]`
  ]

  return base + instructions[assetIndex]
}

// Indices of HTML assets — strip tags before substring checks so entity-encoded
// content or href attributes don't cause false negatives
const HTML_ASSET_INDICES = new Set([1, 2])

function stripHtmlForCheck(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')           // remove tags
    .replace(/&amp;/g, 'and')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
}

function searchable(a: AssetRecord): string {
  if (!a.content) return ''
  return HTML_ASSET_INDICES.has(a.index) ? stripHtmlForCheck(a.content) : a.content
}

function runConsistencyChecks(assets: AssetRecord[], intake: Record<string, unknown>): string[] {
  const issues: string[] = []
  const vertical = (intake.vertical ?? {}) as Record<string, unknown>
  const primaryCtaUrl = ((intake.primary_cta ?? {}) as Record<string, unknown>).url as string | undefined
  const taglines = (vertical.taglines as string[] | undefined) ?? []
  const whatNotLines = (vertical.what_we_are_not as string[] | undefined) ?? []

  if (primaryCtaUrl) {
    // Check raw content for URL (href attributes in HTML also contain it)
    const missing = assets
      .filter(a => a.content && !a.content.includes(primaryCtaUrl))
      .map(a => a.name)
    if (missing.length > 0) {
      issues.push(`Primary CTA URL not found in: ${missing.join(', ')}`)
    }
  }

  if (taglines[0]) {
    // Use 15-char prefix; strip HTML for eBook/Sales Cheat Sheet before comparing
    const tag = taglines[0].substring(0, 15)
    const taglineAssets = [0, 1, 4, 6]
    const missing = taglineAssets
      .filter(i => assets[i]?.content && !searchable(assets[i]).includes(tag))
      .map(i => assets[i].name)
    if (missing.length > 0) {
      issues.push(`Primary tagline not detected in: ${missing.join(', ')}`)
    }
  }

  if (whatNotLines.length > 0 && assets[7]?.content) {
    const sample = whatNotLines[0].substring(0, 20)
    if (!searchable(assets[7]).includes(sample)) {
      issues.push(`"What we are NOT" language may be missing or paraphrased in Internal Brief — verify verbatim language`)
    }
  }

  return issues
}

let _kitQueue: Queue<KitGenerationJobData> | null = null
function getKitQueue(): Queue<KitGenerationJobData> {
  if (!_kitQueue) _kitQueue = new Queue<KitGenerationJobData>(QUEUE_KIT_GENERATION, { connection: getConnection() })
  return _kitQueue
}

const MAX_RETRIES = 2
const LONG_ASSET_INDICES = new Set([1, 2])
const RETRY_DELAYS_MS = [5_000, 15_000]

export async function processKitGenerationJob(
  data: KitGenerationJobData,
  job?: Job<KitGenerationJobData>,
  token?: string,
): Promise<void> {
  const { sessionId, agencyId, assetIndex } = data
  console.log(`[kit-generation] asset ${assetIndex} starting for session ${sessionId}`)

  await withAgency(agencyId, async () => {
    const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
    if (!session) throw new Error(`[kit-generation] session ${sessionId} not found`)

    const intake = session.intakeJson as Record<string, unknown>
    if (!intake) throw new Error(`[kit-generation] session ${sessionId} has no intakeJson`)

    const existingFiles = (session.generatedFiles ?? { assets: initAssets() }) as GeneratedFiles
    const assets: AssetRecord[] = existingFiles.assets?.length === 8 ? existingFiles.assets : initAssets()
    const docStyle: DocStyle = existingFiles.docStyle ?? await resolveDocStyle(agencyId, session.clientId)

    assets[assetIndex] = { ...ASSET_DEFINITIONS[assetIndex], status: 'generating', stage: 'Reading framework data...' }
    await prisma.kitSession.update({
      where: { id: sessionId },
      data: { status: 'generating', currentAsset: assetIndex, generatedFiles: { assets, docStyle } as any },
    })

    // Renew BullMQ job lock every 30s so long-running assets don't get re-queued
    const lockRenewal = job && token
      ? setInterval(() => {
          job.extendLock(token, 60_000).catch(e => console.warn('[kit-generation] lock renewal failed:', e))
        }, 30_000)
      : null

    const isLongAsset = LONG_ASSET_INDICES.has(assetIndex)
    let content: string | null = null
    let lastError: Error | null = null

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_DELAYS_MS[attempt - 1]
          console.warn(`[kit-generation] asset ${assetIndex} retry ${attempt}/${MAX_RETRIES} in ${delay}ms`)
          await new Promise(r => setTimeout(r, delay))
        }

        // Stage progress timer — fires every 15s for long assets
        let stageTimer: ReturnType<typeof setInterval> | null = null
        if (isLongAsset) {
          const startedAt = Date.now()
          assets[assetIndex].stage = 'Generating content with Claude...'
          stageTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000)
            assets[assetIndex].stage = elapsed < 60
              ? `Generating — ${elapsed}s elapsed...`
              : `Almost done — ${elapsed}s elapsed, wrapping up...`
            prisma.kitSession.update({
              where: { id: sessionId },
              data: { generatedFiles: { assets, docStyle } as any },
            }).catch(() => {})
          }, 15_000)
        } else {
          assets[assetIndex].stage = 'Generating content with Claude...'
          await prisma.kitSession.update({
            where: { id: sessionId },
            data: { generatedFiles: { assets, docStyle } as any },
          })
        }

        try {
          const result = await callModel(
            {
              provider: 'anthropic',
              model: SONNET,
              api_key_ref: API_KEY,
              system_prompt: SYSTEM_PROMPT,
              max_tokens: isLongAsset ? 16000 : undefined,
              timeout_ms: isLongAsset ? 8 * 60 * 1000 : 3 * 60 * 1000,
            },
            getAssetUserPrompt(assetIndex, intake, docStyle),
          )
          content = result.text

          if (HTML_ASSET_INDICES.has(assetIndex) && result.finish_reason === 'max_tokens') {
            console.warn(`[kit-generation] asset ${assetIndex} truncated — requesting continuation`)
            const cont = await callModel(
              {
                provider: 'anthropic',
                model: SONNET,
                api_key_ref: API_KEY,
                system_prompt: SYSTEM_PROMPT,
                max_tokens: 8000,
                continuationOf: content,
                timeout_ms: 5 * 60 * 1000,
              },
              getAssetUserPrompt(assetIndex, intake),
            )
            content = content + cont.text
            if (cont.finish_reason === 'max_tokens') {
              console.warn(`[kit-generation] asset ${assetIndex} continuation also truncated — content may be incomplete`)
            }
          }

          break // success — exit retry loop
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          console.error(`[kit-generation] asset ${assetIndex} attempt ${attempt + 1} failed: ${lastError.message}`)
        } finally {
          if (stageTimer) clearInterval(stageTimer)
        }
      }
    } finally {
      if (lockRenewal) clearInterval(lockRenewal)
    }

    if (content === null) {
      // All retries exhausted — record error on this asset but continue pipeline
      console.error(`[kit-generation] asset ${assetIndex} failed after all retries — marking error and continuing`)
      assets[assetIndex] = {
        ...ASSET_DEFINITIONS[assetIndex],
        status: 'error',
        error: lastError?.message ?? 'Generation failed after retries',
      }
    } else {
      // Post-process HTML assets
      if (HTML_ASSET_INDICES.has(assetIndex)) {
        content = content
          .replace(/^```html\s*\n?/i, '')
          .replace(/\n?```\s*$/, '')
          .trim()
        const dtIdx = content.search(/<!doctype html/i)
        if (dtIdx > 0) content = content.slice(dtIdx)

        if (content.includes('</head>')) {
          const rootOverride = [
            '<style>',
            ':root {',
            `  --color-primary: ${docStyle.primaryColor};`,
            `  --color-dark: ${docStyle.primaryColor};`,
            `  --color-accent: ${docStyle.secondaryColor};`,
            `  --heading-font: '${docStyle.headingFont}', sans-serif;`,
            `  --body-font: '${docStyle.bodyFont}', sans-serif;`,
            '}',
            '</style>',
          ].join('\n')
          content = content.replace('</head>', rootOverride + '\n</head>')
        }
      }

      assets[assetIndex] = {
        ...ASSET_DEFINITIONS[assetIndex],
        status: 'complete',
        content,
        completedAt: new Date().toISOString(),
      }
    }

    // Advance pipeline regardless of whether this asset succeeded or errored
    const isLastAsset = assetIndex === 7
    const isFullMode = session.mode === 'full'
    const approvedAssets = (session.approvedAssets as number[]) ?? []

    if (isLastAsset) {
      const issues = runConsistencyChecks(assets, intake)
      const allApproved = isFullMode ? [...approvedAssets, 7] : Array.from({ length: 8 }, (_, i) => i)
      await prisma.kitSession.update({
        where: { id: sessionId },
        data: {
          status: 'delivery',
          currentAsset: 7,
          approvedAssets: allApproved as any,
          generatedFiles: { assets, docStyle, consistencyIssues: issues } as any,
        },
      })
      console.log(`[kit-generation] session ${sessionId} complete — delivery ready`)
    } else if (isFullMode) {
      await prisma.kitSession.update({
        where: { id: sessionId },
        data: {
          status: assets[assetIndex].status === 'error' ? 'error' : 'checkpoint',
          currentAsset: assetIndex,
          generatedFiles: { assets, docStyle, checkpointQuestions: CHECKPOINT_QUESTIONS[assetIndex] } as any,
        },
      })
      console.log(`[kit-generation] session ${sessionId} checkpoint after asset ${assetIndex}`)
    } else {
      await prisma.kitSession.update({
        where: { id: sessionId },
        data: { generatedFiles: { assets, docStyle } as any, currentAsset: assetIndex },
      })
      await getKitQueue().add(
        'generate-asset',
        { sessionId, agencyId, assetIndex: assetIndex + 1 },
        { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
      )
      console.log(`[kit-generation] session ${sessionId} enqueued asset ${assetIndex + 1}`)
    }
  })
}
