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

  const metaPreamble = docStyle
    ? `Document metadata:\n- Agency name: "${docStyle.agencyName || 'Your Agency'}"\n- Current year: ${new Date().getFullYear()}\n- URL placeholder rule: If any url field is empty, null, or "na", write [URL] as the placeholder — never write "na" into the document.\n\n`
    : ''

  const base = `${brandPreamble}${metaPreamble}Here is the complete intake JSON:\n\n\`\`\`json\n${intakeStr}\n\`\`\`\n\nGenerate the ${name} now.\n\n`

  const instructions = [
    // 01 Brochure
    `Using the intake JSON provided, generate a professional B2B brochure in markdown. Output EXACTLY the sections below in this order, with the exact ## headers shown. No other sections. No HTML tags of any kind — no <br>, <strong>, <div>, or any other tag.

════════════════════════════════════════════
COPY LENGTH ENFORCEMENT — NON-NEGOTIABLE:
• Pillar value props: 12 WORDS MAXIMUM. Count every word. Trim mercilessly.
  ✓ CORRECT: "Clinical systems that stay available." (5 words)
  ✓ CORRECT: "Built for healthcare's threat environment." (5 words)
  ✗ WRONG: "Our managed security operations center provides 24×7 monitoring, detection, and response across cloud and on-premises environments." (16 words — too long)
• Service list items: NAME ONLY — zero descriptions after the name.
  ✓ CORRECT: "- Endpoint Protection"
  ✗ WRONG: "- Endpoint Protection — covering all devices across your environment"
• Why Us bullets: 15 WORDS MAXIMUM. Lead with the differentiator. Cut after the first sentence.
  ✓ CORRECT: "**24×7 NOC** — 99.9% uptime SLA with round-the-clock monitoring."
  ✗ WRONG: "**24×7 NOC** — Our network operations center provides round-the-clock monitoring with a guaranteed 99.9% uptime SLA, staffed by certified engineers who escalate within 15 minutes."
════════════════════════════════════════════

## Cover
[vertical.taglines[0] — copy character-for-character from the intake, no quotes, no formatting, plain text only]
[vertical.positioning_statement — one sentence, no quotes]
[vertical.name]

## Stats Bar
Output exactly 4 lines, one per statistic from statistics[]. Each line must follow this format exactly:
- **[stat value]** | [short label] | [source, year]

## Challenges
| Challenge | Our Response | Service Pillar |
|---|---|---|
[One row per challenge from challenges[]. Challenge = name only. Our Response = one short sentence from solution. Service Pillar = service_pillar value. Do NOT add any row where all cells are empty, "na", or placeholder text.]

## Four Pillars
[For each of the 4 pillars from pillars[], output this block — no tables, no HTML:]
### [pillar.name]
[pillar.value_prop trimmed to 12 WORDS MAXIMUM — one sentence only. If the original is longer, cut it. See enforcement rules above.]
- [key_service_1 name — name only, no description]
- [key_service_2 name — name only, no description]
- [key_service_3 name — name only, no description]

[blank line between pillars]

## Why Us
[One bullet per differentiator from differentiators[]. Format: - **[label]** — [position, 15 WORDS MAXIMUM — one sentence only, lead with the differentiator, cut everything after the first sentence. See enforcement rules above.]]

## Proof Points Strip
[ALL entries from proof_points[] — output every one, do not limit to 4. Up to 6 maximum. Format:]
- **[stat]** | [label]
[If proof_points[] has fewer than 6 entries, supplement with: "~6 years" | "avg. client relationship" and "30 years" | "IT services experience" as defaults if they are not already present.]

## Case Studies
### [case_studies[0].client_profile — use actual value, never "na"]
**Who they are:** [1 sentence — use real data from case_studies[0].situation]
**Challenge:** [situation — 1–2 sentences]
**What we delivered:** [engagement — 1–2 sentences]
**Outcome:** [outcomes — 1–2 sentences, quantified where possible]

### [case_studies[1].client_profile or "Case Study Pending" if missing — never "na"]
**Who they are:** [1 sentence or "Contact your team to add a second case study."]
**Challenge:** [real data or "—"]
**What we delivered:** [real data or "—"]
**Outcome:** [real data or "—"]

## Back Cover
**[primary_cta.name]**
[primary_cta.description — 1–2 sentences]
[REQUIRED: output the ACTUAL URL from primary_cta.url — you MUST substitute the real value here. Never write the literal text "primary_cta.url". If the URL is https://example.com/consult then write https://example.com/consult.]
- → [first entry from secondary_ctas[] if available, otherwise: "Book a discovery call"]
- → [second entry from secondary_ctas[] if available, otherwise: "Download the Healthcare eBook"]
- → [document_control.marketing_contact if available, otherwise: "Contact your account team"]

RULES:
- No HTML tags anywhere.
- No markdown tables in the Four Pillars section.
- Bold only using **double asterisks**.
- Platform-agnostic language — no specific tool names (no "Monday.com", "Box", "Salesforce", "HubSpot"). Use "your project management stack", "your delivery workflow" instead.
- Every case study outcome must be specific and quantified where possible.
- Back cover URL must be the real substituted URL value.`,

    // 02 eBook
    `Using the intake JSON provided, generate a complete standalone eBook as a single valid HTML document.

CRITICAL RULES (read before generating any code):
- Output ONLY valid HTML. Start with <!DOCTYPE html> and end with </html>. No markdown fences, no backticks.
- All CSS in a single <style> block inside <head>. No inline style attributes except for dynamically computed values.
- All colors via CSS variables — var(--color-primary), var(--color-dark), var(--color-accent). NEVER hardcode #1a2744, #0070f3, or any brand hex. The variable values will be injected by the system.
- Public-facing content only. Never include internal notes, DPA requirements, "Available on request", security posture checklists, or any operational/sales-only content.
- Platform-agnostic language. Replace any specific tool names: "Monday.com" → "your project management tool", "Box" → "your file delivery stack", "GPTZero/Originality.ai/Copyleaks" → "configurable AI detection services".

────────────────────────────────────────────
CSS VARIABLES (define at :root — system will override with client brand values):
:root {
  --color-primary: #1B1F3B;
  --color-dark: #1B1F3B;
  --color-accent: #4A90D9;
  --heading-font: 'DM Sans', sans-serif;
  --body-font: 'DM Sans', sans-serif;
}
Service pillar pill colors (hardcoded — not brand colors):
  Cloud / Cloud Security → var(--color-accent)
  Cybersecurity / Cyber → #ef4444
  IT Operations / IT Ops → #00dcc3
  Data + AI / Data → #9b51e0
  Default / other → #6b7280

────────────────────────────────────────────
HEAD:
- <title>[vertical.name] — [vertical.client_name]</title>
- Google Fonts: DM Sans (300, 400, 500, 600, 700)
- All CSS in one <style> block

────────────────────────────────────────────
NAV BAR:
Fixed top, var(--color-dark) background, white text.
Left: vertical.client_name + vertical.name pill.
Right: 5 anchor links — "The Landscape" "In Practice" "What We Do" "Why Us" "Talk to Us".

────────────────────────────────────────────
COVER SECTION (id="cover"):
Full-width, var(--color-dark) background, min-height 100vh, centered.
1. Large headline: exact verbatim text of vertical.taglines[0] — copy character-for-character. White, 48–56px.
2. Subhead: vertical.positioning_statement. Light grey, 20px.
3. Stats row: 3 stats from statistics[0..2]. Each: bold large number (white), label below (light grey), source below (muted, 12px).

────────────────────────────────────────────
SECTION 1 — THE LANDSCAPE (id="landscape"):
White background.

1a. SECTION HEADER: "The Landscape" + market_pressure_narrative (1 paragraph).

1b. STAT GRID: 4 cards in a 2×2 grid from statistics[0..3]. Each card: large bold stat (var(--color-primary)), label, source (muted italic).

1c. CHALLENGE ROWS: One row per challenge from challenges[]. Each row: challenge name (left, bold), service pillar pill (colored per pillar type, inline right). No internal solution notes — public-facing only.

1d. PULL QUOTE BLOCK: A large italic pull quote using the first entry from brand_voice.sounds_like[] if available, otherwise derive a sharp 1-sentence quote from market_pressure_narrative. Style: large italic text (22–26px), var(--color-accent) left border (4px), light background. Speaker role below: "Industry practitioner" or derive from context. Do NOT use a named individual.

1e. REGULATORY CARDS: One card per framework from regulatory_frameworks[]. Each card:
  - Framework name (bold, var(--color-primary))
  - Our capability: capability field from the framework (1–2 sentences)
  - Service pillar pill (bottom of card, colored per pillar type rules above)
  Style as a card grid (2–3 columns), white background, subtle border, rounded corners. No tables.

────────────────────────────────────────────
SECTION 2 — IN PRACTICE (id="practice"):
Light grey background.

2a. SECTION HEADER: "In Practice".

2b. CASE STUDY CARDS: Two cards from case_studies[0] and case_studies[1].
  If case_studies[] has fewer than 2 entries, generate structured placeholder cards:
  Placeholder card structure:
    - Header band: var(--color-primary) background, "Enterprise Client" + "Managed Services Engagement" in white.
    - Two-column body: left = "The Situation" + 2-sentence placeholder context; right = "What We Delivered" + 2-sentence placeholder.
    - Outcome badge: var(--color-accent) pill with "Outcome pending — contact team".
  Real card structure (when data exists):
    - Header band: var(--color-primary) background, client_profile + engagement type in white.
    - Two-column body: left = "The Situation" + situation (2 sentences); right = "What We Delivered" + engagement (2 sentences).
    - Outcome badge: var(--color-accent) pill with headline_stat or outcomes summary.
    - Quote band (if quote field exists): italic quote text + speaker attribution.
  Do NOT show "Case studies coming soon" or any notice. Always render two structured cards.

────────────────────────────────────────────
SECTION 3 — WHAT WE DO (id="services"):
White background.

3a. SECTION HEADER: "What We Do".

3b. PILLAR BANDS: One full-width band per pillar from pillars[]. Each band:
  - Left column (40%): pillar name (large, var(--color-primary)), value_prop (one sentence), key_services as bullet list.
  - Right column (60%): SEGMENT CARDS — one small card per segment from segments[] that maps to this pillar (or all segments if no pillar mapping). Each segment card shows:
    - Segment name (bold)
    - LEAD HOOK: segment.lead_hook displayed prominently as a styled italic callout (font-size 15–16px, var(--color-accent) color, quotation marks). This is the opening question — make it visually prominent.
    - core_pain (smaller, muted)
  Alternate band background: odd = white, even = var(--color-primary) at 4% opacity.

────────────────────────────────────────────
SECTION 4 — WHY US (id="why"):
Light grey background.

4a. SECTION HEADER: "Why Us".

4b. DIFFERENTIATOR CARDS: Grid of cards from differentiators[]. Each card: label (bold, var(--color-primary)), position (body text, 1 sentence).

4c. PROOF STRIP: Full-width band, var(--color-dark) background, white text. One cell per proof point from proof_points[]. Each cell: large bold stat number (white, 40–48px), label below (light grey, 14px). This strip is mandatory — do not skip it.

────────────────────────────────────────────
SECTION 5 — TALK TO US (id="contact"):
var(--color-dark) background, white text.

SPLIT LAYOUT — two columns (CSS grid, 1fr 1fr, gap 48px):

LEFT COLUMN (primary CTA):
  - Large heading: primary_cta.name (white, 28–32px)
  - Description: primary_cta.description (light grey)
  - CTA button: var(--color-accent) background, white text, "Get Started" or primary_cta.name, links to the actual URL from primary_cta.url (substitute the real value from the intake JSON)
  - URL also shown as plain visible text below the button (muted, 12px)

RIGHT COLUMN (secondary entry points):
  Use secondary_ctas[] if available, otherwise generate 3 standard entry points:
  "Book a discovery call", "Download the brochure", "View our service stack".
  Each as a list item with → arrow, white text, 16px.

────────────────────────────────────────────
SOURCES FOOTNOTE:
Numbered list of all stat sources: statistics[].map(s => s.source + ' (' + s.year + ')').
Small muted text. Section header "Sources".

────────────────────────────────────────────
FOOTER:
Dark background. Left: vertical.client_name + vertical.name. Right: document_control.document_version if available, otherwise blank.

────────────────────────────────────────────
FINAL CHECKS before outputting:
- No specific tool names (Monday.com, Box, GPTZero, etc.)
- No internal content (DPA, security posture, "available on request")
- Proof strip present in Section 4
- Two case study cards present (real or structured placeholder — never a notice)
- Lead hooks visible in Section 3 segment cards
- Split two-column layout in Section 5
- All colors via var() — no hardcoded brand hex values
- Output starts with <!DOCTYPE html> and ends with </html>`,

    // 03 Sales Cheat Sheet
    `Using the intake JSON provided, generate a sales cheat sheet as a complete standalone HTML document.

CRITICAL RULES:
- Output ONLY valid HTML. Start with <!DOCTYPE html>, end with </html>. No markdown fences.
- "INTERNAL USE ONLY" red banner at the very top — prominent, impossible to miss.
- This is an internal sales tool. Never include public-facing marketing copy.
- Platform-agnostic language throughout: "Monday.com" → "your project management tool", "Box" → "your file delivery stack", "GPTZero/Originality.ai/Copyleaks" → "configurable AI detection services", "Anthropic and OpenAI" → "AI model providers". This applies everywhere — ICP table, pain map, objections, CTA scripts.
- No internal architecture documentation: never mention BullMQ, PostgreSQL, RLS, queue names, or API key management. Replace with business outcomes.
- Never leave a field blank. If intake data is missing, generate a credible placeholder that fits the format.

────────────────────────────────────────────
HEAD:
- Title: "[vertical.name] Sales Cheat Sheet — [vertical.client_name] — INTERNAL ONLY"
- All CSS in one <style> block. Clean, high-contrast. Max-width 1100px. Include @media print { .no-print { display:none } .page-break { page-break-before: always } }.

────────────────────────────────────────────
PAGE 1

P1-A. HEADER BAND
"INTERNAL USE ONLY" in a red (#dc2626) banner. Below it: "[vertical.name] Sales Cheat Sheet — [vertical.client_name]".

P1-B. ICP SEGMENT TABLE
Table with columns: Segment | Primary Buyer | Core Pain | Opening Hook | Entry Point
One row per segment from segments[].

OPENING HOOK RULES (most critical field — never leave blank):
- Use segment.lead_hook verbatim if it is populated.
- If lead_hook is empty, generate a hook using this formula: start with "If" or a direct operational scenario for that segment's core_pain. Make it a question forcing the prospect to think about a real consequence. Under 40 words. Something a rep can say word-for-word on a cold call.
- Example formula: "If your [role] is spending [time] on [pain], what happens when [consequence]?"
- NEVER output "No hook specified" or leave this cell empty.

P1-C. PAIN-TO-SOLUTION MAP
Table with columns: # | Pain Point | Your Response | Service Pillar
One row per challenge from challenges[]. Pain Point = challenge.name. Your Response = challenge.solution (1-2 sentences, business language). Service Pillar = challenge.service_pillar as a colored pill.

────────────────────────────────────────────
PAGE 2 (add <div class="page-break"></div> before this page)

P2-A. OBJECTION HANDLING
Table with exactly 3 columns: The Objection | Your Response | Follow-Up Question
The Follow-Up Question MUST be a separate column — never embed it inside the response text.
From objections[]. If objections[] is empty, generate 4 realistic objections for this vertical.

P2-B. QUALIFYING QUESTIONS
2-column grid. 8 questions derived from challenges[] and segments[]. Each question paired with a "Why it works" note (1 sentence). Label the columns "Question" and "Why it works".

P2-C. REGULATORY CONTEXT
Do NOT use a table. Use two sections:

Section A — one block per framework from regulatory_frameworks[]:
Framework name as a subheading. 3-4 specific bullet points covering: what it requires, the client's exposure, and how your services address it.

Section B — Agency Role Statement (always present, fixed text):
"We implement the controls. Demonstrating compliance is the organisation's responsibility."

Sales note at bottom (muted text, italic):
"Use regulatory pressure as the urgency trigger, not the primary value prop. Lead with operational outcomes."

Do NOT include: internal notes, DPA reminders, "Available on request", security posture checklists, or any operational process instructions for the team.

P2-D. CASE STUDY CARDS
Two case study cards side-by-side. Always render the full card structure.

If case_studies[] has data, use: client_profile as header, situation, engagement, outcomes, headline_stat, and quote if present.
If case_studies[] is empty or has fewer than 2 entries, use structured placeholder cards:
  - Header: "Enterprise Client | Managed Services Engagement"
  - The Situation: "[3 bullet placeholders — fill with client type and core challenge]"
  - What We Delivered: "[3 bullet placeholders — fill with services engaged]"
  - Outcome: "[Stat or result — fill before use]"
  - Quote: "[Client quote — add before distributing]"
  - "Use this story when:" tag: "[Match to segment — fill before use]"

Each card must also show a "Use this story when:" tag at the bottom derived from the most relevant segment or challenge.
NEVER show "Case studies coming soon" or any notice. Always render two structured cards.

P2-E. PROOF POINTS
Use proof_points[] from the intake. Format each as: stat/claim (bold) + one-sentence business implication + source if available.
If proof_points[] is empty, use: "Research-to-finished deliverable in under 5 minutes vs. 1-2 days of senior strategist time — confirmed in active production."
Do NOT include technical architecture details (BullMQ, PostgreSQL, API layers, etc.).

P2-F. CTA SCRIPTS
3 scripted versions of the primary ask — different lengths (1 sentence, 2 sentences, 3 sentences).
Base on primary_cta. Each version must end with the actual URL value from primary_cta.url on its own line.
Label them: "Quick ask (phone)" | "Standard ask (email)" | "Full ask (meeting request)".

Output complete valid HTML only.`,

    // 04 BDR Emails
    `Using the intake JSON provided, generate BDR call scripts and email sequences in markdown format.

════════════════════════════════════════════
SEGMENT COUNT RULE — NON-NEGOTIABLE:
Count how many items are in segments[]. Output EXACTLY that many email blocks in Email Sequences — one block per segment, in order. Then add exactly ONE final AI/Innovation email.

Examples:
  segments[] has 4 items → 4 segment email blocks + 1 AI email = 5 total
  segments[] has 3 items → 3 segment email blocks + 1 AI email = 4 total

Do NOT stop early. Do NOT skip any segment. Count first, then write every block.

════════════════════════════════════════════
CRITICAL RULES:
- Platform-agnostic language everywhere: "Monday.com" → "your project management tool", "Box" → "your file delivery stack", "GPTZero" → "your AI detection tool". No specific tool names.
- Never include audience targeting metadata inside email bodies.
- Email body: 4-5 LINES MAXIMUM. One sentence per line. No paragraphs.
- CTA: write [Link] as the placeholder — nothing else. No URL, no "primary_cta.url".

────────────────────────────────────────────
## Cover
**[vertical.name] BDR Call Scripts & Email Sequences**
[vertical.client_name]
[exact count of segments[]] Segments · [exact count of segments[] + 1] Email Sequences
Internal Use Only

────────────────────────────────────────────
## Contents
Table with 2 columns: Segment | Subject Line
One row per segment email block (in order), plus one row for the AI/Innovation email.

────────────────────────────────────────────
## How to Use
Single short paragraph only — no bullet lists, no bracket-type documentation:
"Personalise every [customize with...] bracket before sending. Subject lines and conversation starters work without customisation but specificity improves response rates. The primary CTA is the same in every email — never pitch a full managed services engagement on cold outreach."

────────────────────────────────────────────
## Call Scripts
Table with exactly 4 columns:
# | Segment (subject line in smaller text below the segment name) | Conversation Starters (all 3 in one cell, numbered 1. 2. 3., each 1-2 sentences) | Voicemail Script (2-3 sentences max)

One row per segment from segments[]. Use segments[].lead_hook as the basis for Starter 1.

────────────────────────────────────────────
## Email Sequences

Repeat the following block for EVERY segment in segments[], then add the AI block at the end:

**[Segment Name from segments[]]**
**Subject:** [specific value-focused subject line]
**Preview:** [1 sentence — the hook]
---
[Email body — 4-5 LINES MAXIMUM. One sentence per line. No audience metadata.]

[Link]
[One short closing question: "Worth 30 minutes?" or "Want to see it?"]

---
*[customize with: specific challenge, company name, recent trigger event]*

After all segment blocks, add this final block:

**AI-Forward Outreach (All Segments)**
**Subject:** [AI-specific subject line]
**Preview:** [AI-focused hook]
---
[Email body — 4-5 LINES MAXIMUM]

[Link]
[closing question]

---
*[customize with: specific AI initiative, company name]*

────────────────────────────────────────────
## Back Cover
**[vertical.client_name] — [vertical.name]**
*BDR Call Scripts & Email Sequences*

INTERNAL USE ONLY — Not for Distribution

[Agency name from document metadata] · Version 1.0 · [Current year from document metadata]`,

    // 05 Customer Deck
    `Using the intake JSON provided, generate a 14-slide customer-facing presentation in markdown format. Use ## Slide N: [Title] as the header for each slide.

════════════════════════════════════════════
COPY LENGTH ENFORCEMENT — NON-NEGOTIABLE HARD LIMITS
Every piece of text must fit in its designated space on screen. These are maximums, not targets.

• Slide titles: 3–5 words maximum
• Stat labels: 2–4 words maximum
• Bullet points: ONE LINE MAXIMUM — if a bullet exceeds 12 words, cut it. Never write a sentence that wraps to a second line on a slide.
• Value propositions: one sentence, 12 words maximum
• Service list items: service name ONLY — zero descriptions
• Deep dive bullets: one line each, lead with the outcome (what the client gains) not the mechanism
• Differentiator cards: bold headline + ONE sentence maximum — never a paragraph, never a second sentence
• Assessment path descriptions: one sentence maximum, 12 words maximum
• Case study cells: 2–3 bullets each, one line per bullet maximum

VIOLATION EXAMPLES — NEVER WRITE THESE:
❌ "Automates the end-to-end content production workflow from intake through stakeholder approval, eliminating manual coordination overhead and ensuring consistent asset delivery."
✅ "Brief to approved asset — zero manual handoffs."

❌ "HIPAA — We provide comprehensive audit trail documentation, role-based access control, and content governance logs to support your HIPAA compliance posture across all content operations."
✅ "HIPAA — Audit-ready documentation and access logs."

════════════════════════════════════════════
CUSTOMER-FACING RULES:
- Remove ALL internal sales notes, DPA reminders, "Available on request" language, and technical architecture details.
- Business language only. Never write: BullMQ, PostgreSQL, RLS, API layers, database terminology, or infrastructure specifics.
- Platform-agnostic: "Monday.com" → "your PM tool", "Box" → "your file delivery platform", "Anthropic/OpenAI" → "AI model providers".
- Every statistic must have a source citation. Write [UNSOURCED] if no source is available.

════════════════════════════════════════════

────────────────────────────────────────────
## Slide 1: [REQUIRED — output the EXACT verbatim text of vertical.taglines[0]. If taglines is empty or missing, write a 3–5 word tagline from the vertical.positioning_statement.]
- [REQUIRED — vertical.positioning_statement, one sentence. If empty, write a one-sentence value proposition from the intake context.]
- [vertical.name] · [vertical.client_name]

────────────────────────────────────────────
## Slide 2: Market Pressure
Output EXACTLY 4 stat cards from statistics[]. Format each line:
- **[large stat value]** — [2–4 word label] — ([source], [year])

If statistics[] has fewer than 4, derive plausible sourced stats from the market context.
Narrative: MAXIMUM 2 sentences below the 4 stat lines. Each sentence: one line only.

────────────────────────────────────────────
## Slide 3: The Challenges
One bullet per challenge from challenges[]. Hard format:
- **[challenge.name]** — [why_it_exists, MAXIMUM 8 WORDS] · [service_pillar]

Rules: NO sub-bullets, NO paragraph explanations. Challenge name + 8-word consequence + pillar only.

────────────────────────────────────────────
## Slide 4: Compliance & Regulatory
MAXIMUM 4 frameworks from regulatory_frameworks[]. If more than 4 exist, pick the 4 most referenced.
For each framework:
**[Framework Name]**
- [capability, MAXIMUM 10 WORDS — customer-facing only, no internal notes]
- [capability, MAXIMUM 10 WORDS]
- [capability, MAXIMUM 10 WORDS]

Hard rules: EXACTLY 3 bullets per framework. MAXIMUM 4 frameworks total. No "Available on request." No "Lead with this." No descriptions beyond 10 words.
Final line (not a bullet): one sentence stating the compliance role.

────────────────────────────────────────────
## Slide 5: Our Four Pillars
One block per pillar from pillars[]:
**[pillar.name]**
[value_prop — ONE SENTENCE, 12 WORDS MAXIMUM. If the existing value_prop is longer, trim it.]
- [key_service_1 name — name only, zero description]
- [key_service_2 name — name only, zero description]
- [key_service_3 name — name only, zero description]

────────────────────────────────────────────
## Slide 6: [pillars[0].name]
[ONE punchy sub-heading — what clients gain, 8 words max]
- **[bold outcome claim, ≤8 words]** — [clarifier, ≤6 words]
- **[bold outcome claim, ≤8 words]** — [clarifier, ≤6 words]
- **[bold outcome claim, ≤8 words]** — [clarifier, ≤6 words]
- **[bold outcome claim, ≤8 words]** — [clarifier, ≤6 words]

Rules: ZERO multi-sentence bullets. ZERO paragraphs. Lead with what the client gets, not how the system works.

────────────────────────────────────────────
## Slide 7: [pillars[1].name]
Same format as Slide 6. Sub-heading (8 words max) + 4–5 outcome bullets in the same **bold claim** — [short clarifier] format.

────────────────────────────────────────────
## Slide 8: [pillars[2].name or "Delivery & Operations"]
Same format. Sub-heading + 4–5 outcome bullets.

────────────────────────────────────────────
## Slide 9: [pillars[3].name if it exists, otherwise "Scale & Governance"]
Same format. Sub-heading + 4–5 outcome bullets.

────────────────────────────────────────────
## Slide 10: Why Us
Stats line (one line): **[proof_points[0].stat]** [label] · **[proof_points[1].stat]** [label] · **[proof_points[2].stat]** [label] · (continue for all proof_points — all on ONE line)

6 differentiator bullets from differentiators[]:
- **[label]** — [position, ONE SENTENCE, 10 WORDS MAXIMUM — hard stop, no second sentence]

Rules: NO multi-sentence differentiator descriptions. Bold headline + one sentence. Full stop.

────────────────────────────────────────────
## Slide 11: Case Study — [case_studies[0].client_profile or "Enterprise Healthcare Client"]
**Situation** | **What We Delivered** | **Outcomes**
- [one-line bullet] | - [one-line bullet] | - [one-line bullet]
- [one-line bullet] | - [one-line bullet] | - [one-line bullet]
- [one-line bullet] | - [one-line bullet] | - [one-line bullet]

Total word count for entire slide: under 80 words.

────────────────────────────────────────────
## Slide 12: Case Study — [case_studies[1].client_profile or "Mid-Market Healthcare Client"]
Same structure as Slide 11 using case_studies[1] or placeholder.

────────────────────────────────────────────
## Slide 13: Your Path Forward
4 paths from segments[] and regulatory_frameworks[]. Each path:
- **[Path name]** — [trigger condition, ONE SENTENCE, 12 WORDS MAX]
  → [CTA label] — [ACTUAL URL from primary_cta.url — you MUST substitute the real URL here. Never output the literal text "primary_cta.url".]

────────────────────────────────────────────
## Slide 14: [REQUIRED — exact verbatim text of vertical.taglines[0] — identical to Slide 1 title]
REQUIRED — output ALL FOUR elements below. Do NOT truncate this slide:
- [vertical.positioning_statement — one sentence]
- **Proof:** [proof_points[0].stat] [proof_points[0].label] · [proof_points[1].stat] [proof_points[1].label] · [proof_points[2].stat] [proof_points[2].label]
- **[primary_cta.name]** → [ACTUAL URL from primary_cta.url — substitute real value]
- [document_control.marketing_contact or agency contact — one line]

CLOSING SLIDE RULE: This slide MUST be complete. Never truncate. Output all four elements even if you are near the end of your output budget.`,

    // 06 Video Script
    `Using the intake JSON provided, generate a video script document in markdown format.

CRITICAL RULES — PLATFORM-AGNOSTIC LANGUAGE:
Never name specific third-party tools in On-Screen Text or Voiceover copy. These are public-facing.
Banned: Monday.com, Asana, Jira, Box, Dropbox, SharePoint, Salesforce, HubSpot, Slack, Teams, and any other named vendor.
Replace with: "your PM tool", "your project management platform", "your file delivery platform", "assets land where they always have", "your CRM", "your collaboration platform", etc.
Production Notes are internal and may reference specific tools — the ban applies ONLY to On-Screen Text and Voiceover columns.

CTA URL RULE:
Every version's final CTA must use the exact URL from primary_cta.url. If primary_cta.url is empty or missing, use [URL] as a placeholder. Never invent or hardcode a URL.

## Cover

# [vertical.name] Video Script
**Client:** [vertical.client_name]
**Format:** Version A (60s) and Version B (90s)
**Audience:** [segments[0].name]
**Call to Action:** [primary_cta.name]

## Production Notes
> **Tone:** [derive from brand_voice.tone — if empty, use "confident, direct, peer-level"]
> **Voiceover:** Clear professional delivery. Measured pace. No uptalk.
> **Music:** Understated professional background. Fade in at open, fade out under CTA.
> **Brand colours:** Per brand guidelines — reference design team for hex values.
> **Positioning constraint:** [vertical.what_we_are_not[0] — use exact text]
> **Target runtime:** Version A — 60 seconds. Version B — 90 seconds.
> **Pre-production check:** Confirm CTA URL matches primary_cta.url exactly before handoff to production team.

## Version A — 60-Second Storyboard
| Scene | Time | On-Screen Text | Voiceover | Imagery Suggestion |
|-------|------|---------------|-----------|-------------------|
[8-10 rows. Scene numbers 1–N. Scene 1: hook — operational consequence from challenges[]. Scene 3: key stat from statistics[]. Scene 4: product/service intro. Scene 7: invisible integration point (use generic tool language — "your PM tool triggers it. Assets land where they always have."). Final scene: CTA — use exact URL from primary_cta.url or [URL] if empty. On-Screen Text and Voiceover columns must contain zero specific vendor names.]

## 60-Second Distribution Notes
- LinkedIn video: caption "X orgs face [challenge]. See how [vertical.client_name] responds →"
- YouTube pre-roll: skip-proof hook in first 5 seconds
- Website hero: autoplay, muted, loop first 15 seconds

## Version B — 90-Second Storyboard
| Scene | Time | On-Screen Text | Voiceover | Imagery Suggestion |
|-------|------|---------------|-----------|-------------------|
[12-14 rows. Same scene numbering continues from 1. Expand challenge section with additional stat, add a case study moment (use client_profile + headline_stat from case_studies[0] — no specific tool names), fuller CTA close. On-Screen Text and Voiceover columns must contain zero specific vendor names.]

## 30-Second Cut Guide
**For a 30-second cut:** Use Scenes 1 (hook), 3 (key stat), 4 (product intro), 7 (invisible integration point), and the final CTA scene only. Remove all other scenes. Adjust timing proportionally — target 5–7 seconds per retained scene.

## 60-Second Voiceover Script (Version A)
[Timecoded voiceover matching Version A storyboard exactly. Format: 0:00–0:08 [text]. Every line keyed to a storyboard scene. Zero specific vendor or tool names. Final line must include the exact CTA URL from primary_cta.url or [URL] if empty.]`,

    // 07 Web Page Copy
    `Using the intake JSON provided, generate web page copy in markdown format for a vertical landing page.

════════════════════════════════════════════
SEGMENT COUNT RULE — NON-NEGOTIABLE:
Count how many items are in segments[]. Output EXACTLY that many ### segment cards in ## Segments — one card per segment, in order. Do NOT stop at 2. Do NOT skip any segment.
Examples: segments[] has 5 items → output 5 ### cards. segments[] has 3 items → output 3 ### cards.

URL RULE: If primary_cta.url is empty, null, or "na", write [URL] — never write "na".

════════════════════════════════════════════
CRITICAL RULES:
1. CTA TEXT: Only clean labels: "[Book a Demo]", "[Get Started]", "[See How It Works]", "[Download]", "[View]". No audience descriptions, no targeting metadata.
2. PLATFORM-AGNOSTIC LANGUAGE: "Monday.com" → "your PM tool", "Box" → "your file delivery platform", "GPTZero/Originality.ai/Copyleaks" → "configurable AI detection", "Claude/GPT-5/Ollama" → "leading AI models". No specific vendor names.
3. 3-BOX HEADINGS: 3-5 words maximum — punchy, no filler.
4. 3-BOX BODIES: Exactly ONE sentence, maximum 15 words. No second sentence.
5. SERVICE CARDS: ONE sentence, 15 words maximum. No vendor names.
6. SOLUTION STACK: MAXIMUM 4 service cards per pillar. Prioritize the most important services.
7. STATS BAR FORMAT: Output as bullet lines — NEVER as a markdown table or inline text. Use exactly this format:
   - **[stat value]** | [2-4 word label] | [Source, Year]

────────────────────────────────────────────
## Cover
**[vertical.name] Web Page Copy**
[vertical.client_name]
URL: /[slugify vertical.name]/
Draft v1

────────────────────────────────────────────
## Page Metadata
- **URL:** /[slugify vertical.name]/
- **Title tag:** [vertical.taglines[0] | vertical.client_name] (max 60 chars)
- **Meta description:** [1 sentence from vertical.positioning_statement] (max 155 chars)

────────────────────────────────────────────
## Hero
**Headline:** [vertical.taglines[0]]
**Sub-headline:** [derived from vertical.positioning_statement — 1 sentence, active voice]
**Benefit pills:** [differentiators[0].label] | [differentiators[1].label] | [differentiators[2].label]
**CTA 1:** [primary_cta.name — clean label] → [primary_cta.url or [URL] if empty]
**CTA 2:** [See How It Works] ↓

────────────────────────────────────────────
## Intro
**Sub-heading:** [derived from market_narrative — 1 sentence]
Output 4 stat lines in EXACTLY this bullet format (no table headers, no Stat/Label/Source column labels):
- **[statistics[0].stat]** | [statistics[0].label — 2-4 words] | [statistics[0].source, year]
- **[statistics[1].stat]** | [statistics[1].label — 2-4 words] | [statistics[1].source, year]
- **[statistics[2].stat]** | [statistics[2].label — 2-4 words] | [statistics[2].source, year]
- **[statistics[3].stat]** | [statistics[3].label — 2-4 words] | [statistics[3].source, year]
**Intro callout:** 2-sentence paragraph derived from vertical.positioning_statement and market_narrative

────────────────────────────────────────────
## 3-Box Treatment
[Exactly 3 boxes. Heading: 3-5 words max. Body: ONE sentence, max 15 words. No second sentence.]

### Box 1
**[differentiators[0].label — 3-5 words max]**
[ONE sentence, max 15 words, derived from differentiators[0].description]

### Box 2
**[differentiators[1].label — 3-5 words max]**
[ONE sentence, max 15 words, derived from differentiators[1].description]

### Box 3
**[differentiators[2].label — 3-5 words max]**
[ONE sentence, max 15 words, derived from differentiators[2].description]

────────────────────────────────────────────
## CTA Banner
**[primary_cta.name — clean label]**
[primary_cta.description — 1 sentence max]
→ [[primary_cta.name]] [primary_cta.url or [URL] if empty]

────────────────────────────────────────────
## Solution Stack
Group services by pillar from service_stack[]. MAXIMUM 4 service cards per pillar.

### [pillar 1 name]
- **[service name]** — [ONE SENTENCE, max 15 words. No vendor names.]
[add up to 3 more service cards — maximum 4 total per pillar]

### [pillar 2 name]
[same format — maximum 4 service cards]

[continue for each pillar — maximum 4 service cards per pillar]

────────────────────────────────────────────
## Segments
[Count segments[] first. Output EXACTLY that many ### cards in order:]

### [segments[0].name]
*[segments[0].buyer_titles joined with " · " — if empty, derive: "Head of [function] · VP [function]"]*
[segments[0].core_pain framed as active tension — ONE SENTENCE ONLY]
**ContentNode delivers:** [3-4 relevant capability names from service_stack[], pipe-separated, no descriptions]

[REPEAT for every remaining segment — all must be present]

────────────────────────────────────────────
## Case Studies
[Always show exactly 2 structured cards. Use case_studies[] if available; fill with placeholder if fewer than 2.]

### [case_studies[0].client_profile if available, else "[Segment] Engagement"]
**Situation:** [case_studies[0].situation if available, else "[Case study to be added]"]
**What We Delivered:** [case_studies[0].what_we_delivered if available, else "[Case study to be added]"]
**Outcome:** [case_studies[0].headline_stat if available, else "[Case study to be added]"]
[[View Full Case Study →]]

### [case_studies[1].client_profile if available, else "[Segment] Engagement"]
**Situation:** [case_studies[1].situation if available, else "[Case study to be added]"]
**What We Delivered:** [case_studies[1].what_we_delivered if available, else "[Case study to be added]"]
**Outcome:** [case_studies[1].headline_stat if available, else "[Case study to be added]"]
[[View Full Case Study →]]

────────────────────────────────────────────
## Resources

### eBOOK
**[vertical.name] [vertical.client_name] eBook**
[One sentence: what insight the eBook delivers, derived from market_narrative]
[[Download]]

### BROCHURE
**[vertical.name] [vertical.client_name] Brochure**
[One sentence: what the brochure covers, derived from positioning_statement]
[[View]]

────────────────────────────────────────────
## Why Us
Output as bullet lines in EXACTLY this format (visual strip — no inline text, no dot separators):
- **[proof_points[0].stat]** | [proof_points[0].label — 2-4 words]
- **[proof_points[1].stat]** | [proof_points[1].label — 2-4 words]
[continue for ALL proof_points[]. If proof_points[] is empty, use 3 placeholder lines: - **[Stat]** | Label to be added]

────────────────────────────────────────────
## Final CTA
**[primary_cta.name — clean label only]**
[primary_cta.description — 1 sentence]
→ [[primary_cta.name]] [primary_cta.url or [URL] if empty]

ENFORCE: All segment cards present — count matches segments[]. Stats bar = bullet lines only. Why Us = bullet lines only. Solution stack = max 4 cards per pillar. 3-box headings = 3-5 words. No "na" anywhere. No vendor names in public copy.`,

    // 08 Internal Brief
    `Using the intake JSON provided, generate an internal GTM launch brief in markdown format.

CRITICAL RULES:
- PLATFORM-AGNOSTIC: Never name specific third-party tools anywhere in this document. Use "your PM tool", "your file delivery platform", "your CRM", "leading AI models", "configurable detection services" instead of Monday.com, Box, Salesforce, GPTZero, Claude, etc.
- NO AUDIENCE METADATA in CTAs or anywhere else. CTAs show only clean labels.
- NO DATE-SPECIFIC urgency (no "end of 2025", no year references for forward-looking claims).

# INTERNAL USE ONLY

## Cover

# [vertical.name] GTM Launch Brief
**Client:** [vertical.client_name]
**Internal Use Only · Sales + Marketing**
Prepared by: [document_control.marketing_contact if available, else "Marketing Team"]

## Send Note
**To:** Sales Team + BDR Team
**Subject:** [vertical.name] Kit Ready — [vertical.client_name] — Action Required

## Opening
The [vertical.name] GTM kit is ready. [1 sentence non-dated urgency framing based on regulatory_frameworks[] — e.g. "With [regulation] enforcement accelerating, the window for differentiated positioning is now." Do NOT include any specific year or "end of [year]" language.]

## Why This Vertical, Why Now

[4-cell visual impact bar — render as a 4-column table, NO shading on data rows:]
| **[statistics[0].stat]** | **[statistics[1].stat]** | **[statistics[2].stat]** | **[statistics[3].stat]** |
|---|---|---|---|
| [statistics[0].label] · [statistics[0].source] | [statistics[1].label] · [statistics[1].source] | [statistics[2].label] · [statistics[2].source] | [statistics[3].label] · [statistics[3].source] |

[1 compact urgency paragraph (3-4 sentences max) drawing from regulatory_frameworks[] and market_narrative. No year references. No database terminology. No specific vendor names.]

## What's in the Kit

2-column table only — NO shading, NO background colors, simple borders:
| Asset | What It Is + How to Use It |
|-------|---------------------------|
| 01 Brochure | Leave-behind for discovery and qualification meetings |
| 02 eBook | Gated thought-leadership asset; use in nurture sequences and post-meeting follow-up |
| 03 Sales Cheat Sheet | Rep quick-reference — objection handling, CTA scripts, regulatory context |
| 04 BDR Call Scripts & Emails | Cold outreach sequences with call scripts and email copy; ready to send |
| 05 Customer Deck | Client-facing presentation for evaluation and proposal meetings |
| 06 Video Script | Video content for LinkedIn, YouTube, and website hero — two cuts (60s and 90s) |
| 07 Web Page Copy | Vertical landing page copy; hand to web team with brand guidelines |
| 08 Internal Brief | This document — distribute to sales and BDR teams at kit launch |

## Where to Start

2-column table — simple borders, NO shading:
| Sales Team | BDR Team |
|------------|----------|
| 1. [ONE imperative action, max 15 words] | 1. [ONE imperative action, max 15 words] |
| 2. [ONE imperative action, max 15 words] | 2. [ONE imperative action, max 15 words] |
| 3. [ONE imperative action, max 15 words] | 3. [ONE imperative action, max 15 words] |
| 4. [ONE imperative action, max 15 words] | 4. [ONE imperative action, max 15 words] |
| 5. [ONE imperative action, max 15 words] | 5. [ONE imperative action, max 15 words] |

Each cell = one imperative verb phrase only. No conjunctions. No explanatory sentences. Examples: "Lead with the eBook in discovery follow-up." / "Send Email 1 within 24 hours of trigger."

## Primary CTA

> **[primary_cta.name — clean label only, no audience description]**
> [primary_cta.description — 1 sentence]
> → [primary_cta.url]
>
> Client win: [case_studies[0].headline_stat from case_studies[0].client_profile if available, else "[Add client win here: segment, problem, ContentNode workflow used, measurable result]"]

## Compliance Angle

[Exactly 3–4 sentences covering these four points — one sentence each:]
1. Data isolation: [one sentence on multi-tenant data isolation architecture — no database names]
2. Agency-owned keys: [one sentence on agency retaining ownership of all AI provider credentials]
3. SOC 2: [one sentence on current SOC 2 status — if not certified, say "pursuing" or "in progress"]
4. What we don't claim: [one sentence — we do not provide legal counsel or guarantee regulatory compliance]

## Key Messages

[5 messages. Each message rendered as a blockquote block — bold headline + exactly one sentence. Simple border, white background. Use blockquote syntax (>) for each.]

> **[Message 1 headline]**
> [One sentence. No specific tool names.]

> **[Message 2 headline]**
> [One sentence. No specific tool names.]

> **[Message 3 headline]**
> [One sentence. No specific tool names.]

> **ContentNode fits inside existing workflows.**
> ContentNode triggers from status changes in your PM tool, delivers finished files to your file delivery stack, and writes asset links back automatically — the client's experience never changes.

> **[Message 5 headline]**
> [One sentence. No specific tool names.]

## Non-Negotiable

> ⚠ **What We Are NOT:**
> [List VERBATIM from vertical.what_we_are_not[]. Every line exactly as written. Do not paraphrase. Do not reorder. Do not add or remove words.]

CRITICAL FORMATTING RULES:
- Key messages = blockquote blocks (>) only — one per message, no numbered list, no shading
- Asset table = exactly 2 columns: Asset | What It Is + How to Use It
- Where to Start = max 15 words per cell, imperative only
- Non-negotiable = verbatim copy from what_we_are_not[]
- Zero specific third-party tool names anywhere in document
- Zero audience targeting metadata anywhere in document`
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

  // Only check URL if it looks like an actual URL (not a trigger description)
  if (primaryCtaUrl && /^https?:\/\//.test(primaryCtaUrl)) {
    // Assets where a raw CTA URL is naturally expected in the copy
    const CTA_URL_ASSET_INDICES = [0, 3, 6] // Brochure, BDR Emails, Web Page Copy
    // Lenient match: strip protocol + trailing slash so https://x.com/ ≡ x.com
    const urlCore = primaryCtaUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
    const missing = CTA_URL_ASSET_INDICES
      .filter(i => {
        const a = assets[i]
        if (!a?.content) return false
        const haystack = searchable(a).toLowerCase()
        return !haystack.includes(urlCore) && !haystack.includes(primaryCtaUrl.toLowerCase())
      })
      .map(i => assets[i].name)
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
const LONG_ASSET_INDICES = new Set([1, 2, 3, 4, 6])
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
