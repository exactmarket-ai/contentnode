import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { downloadBuffer } from '@contentnode/storage'
import { Queue, type Job } from 'bullmq'
import { getConnection, QUEUE_KIT_GENERATION, type KitGenerationJobData } from './queues.js'


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
    : docStyle && !HTML_ASSET_INDICES.has(assetIndex)
      ? [
          `BRAND CONTEXT — apply to content only (no CSS/HTML):\n`,
          docStyle.agencyName ? `- Agency name: "${docStyle.agencyName}" — use in the brand footer signature line at the bottom of the document.\n` : '',
          docStyle.footerText ? `- Footer tagline: "${docStyle.footerText}" — use as the closing brand line.\n` : '',
          `- Primary brand colour: ${docStyle.primaryColor} (for your reference — applied by the design renderer)\n`,
          `- Secondary brand colour: ${docStyle.secondaryColor} (for your reference — applied by the design renderer)\n`,
          `\n`,
        ].join('')
      : ''

  const metaPreamble = docStyle
    ? `Document metadata:\n- Agency name: "${docStyle.agencyName || 'Your Agency'}"\n- Current year: ${new Date().getFullYear()}\n- URL placeholder rule: If any url field is empty, null, or "na", write [URL] as the placeholder — never write "na" into the document.\n\n`
    : ''

  const base = `${brandPreamble}${metaPreamble}Here is the complete intake JSON:\n\n\`\`\`json\n${intakeStr}\n\`\`\`\n\nGenerate the ${name} now.\n\n`

  const instructions = [
    // 01 Brochure
    `Using the intake JSON provided, generate a professional B2B brochure in markdown. Output EXACTLY the sections below in this order, with the exact ## headers shown. No other sections. No HTML tags of any kind.

════════════════════════════════════════════
COPY LENGTH RULES — NON-NEGOTIABLE:
• Pillar value props: 12 WORDS MAXIMUM — one punchy sentence.
  ✓ "Clinical systems that stay available."
  ✓ "Built for healthcare's threat environment."
  ✗ "Our managed security operations center provides 24×7 monitoring across cloud and on-premises." (too long)
• Service bullets: SHORT DESCRIPTIVE PHRASE — max 8 words. Include a 1–3 word qualifier that makes it specific. No full sentences. No dash-explanations longer than 3 words.
  ✓ "MDR + 24/7 SOC monitoring and response"
  ✓ "HIPAA-aligned Tier 4/5 Private Cloud"
  ✓ "DRaaS with tested recovery procedures"
  ✗ "Endpoint Protection" (too bare — add what makes it relevant)
  ✗ "AI Email Security — stops phishing before clinical inboxes reach staff" (too long after the dash)
• Why Us bullets: ONE complete sentence, 15–25 words. Plain prose — NO bold label prefix, NO "**label** —" format.
  ✓ "One partner covers the full compliance stack — Security Assessments, HIPAA-aligned cloud, MDR, DRaaS, and vCISO under a single contract."
  ✗ "**Full Stack** — One partner covers the full compliance stack." (wrong format)
════════════════════════════════════════════

## Cover
[vertical.taglines[0] — copy character-for-character from the intake, no quotes, plain text only]
[vertical.positioning_statement — one sentence, no quotes]
[vertical.name]

## Stats Bar
Output exactly 4 lines, one per statistic from statistics[]. Format exactly:
- **[stat value]** | [short label — what the stat describes, 4–7 words] | [source, year]

## Challenges
| Challenge | [vertical.client_name] Solution | Service Pillar |
|---|---|---|
[One row per challenge from challenges[]. Challenge = challenge name only. Solution = one short sentence drawn from the challenge.solution field. Service Pillar = service_pillar value. Skip any row where all cells are "na" or empty.]

## What We Deliver
[For each pillar from pillars[], output this block — no tables, no HTML:]
### [pillar.name]
[pillar.value_prop trimmed to 12 WORDS MAXIMUM]
- [key_service_1 as short descriptive phrase, max 8 words — add a specific qualifier from the intake]
- [key_service_2 as short descriptive phrase, max 8 words]
- [key_service_3 as short descriptive phrase, max 8 words]
- [key_service_4 if present, max 8 words]
- [key_service_5 if present, max 8 words]

[blank line between pillars]

## Why [vertical.client_name]
[One sentence framing why this section matters — draw from market_position or brand_voice.differentiators context. E.g. "There are a lot of managed IT providers. Here's what makes [client_name] different for [vertical.name] specifically."]

[One bullet per differentiator from differentiators[]. Each bullet is a PLAIN COMPLETE SENTENCE — no bold label, no "**label** —" prefix. 15–25 words. Lead with the proof or outcome, not the feature name.]

## Proof Points Strip
[ALL entries from proof_points[] — every one, up to 6 maximum. Format:]
- **[stat]** | [label] | [sub-label if present]
[Supplement if fewer than 6: add "~6 years" | "avg. client relationship" and "30 years" | "IT services experience" if not already present.]

## In Practice
### [case_studies[0].client_profile — never "na"]
**Who they are:** [1 sentence from situation — describe the organisation]
**The challenge:** [situation — 1–2 sentences on the problem they faced]
**What [vertical.client_name] did:** [engagement — 2–3 sentences on what was delivered]
**The outcome:** [outcomes — 1–2 sentences, quantified wherever possible]
[If case_studies[0].quote is present and not "na": "[quote text]" — [speaker_role or "Client"]]

### [case_studies[1].client_profile or "Case Study Pending" if missing — never "na"]
**Who they are:** [1 sentence or "Contact your team to add a second case study."]
**The challenge:** [real data or "—"]
**What [vertical.client_name] did:** [real data or "—"]
**The outcome:** [real data or "—"]
[If case_studies[1].quote is present and not "na": "[quote text]" — [speaker_role or "Client"]]

## Where Do You Start?
[1–2 sentence intro drawn from primary_cta context or market_pressure_narrative — where most prospects come from, what prompts them to act.]

**[primary_cta.name]**
[primary_cta.description — 1–2 sentences, what they get, no commitment language]
[REQUIRED: the ACTUAL URL from primary_cta.url — substitute the real value. Never write "primary_cta.url" literally.]

Other entry points:
[For each entry in secondary_ctas[]: [name] — [short description, 5–8 words]: [url]]
[If secondary_ctas[] is empty, output:]
- Book a discovery call — 30 minutes, no pitch: [primary_cta.url]
- Download the [vertical.name] guide: [URL]

[Agency name from BRAND CONTEXT above if provided, otherwise vertical.client_name] | [root domain from primary_cta.url]
[Footer tagline from BRAND CONTEXT if provided, otherwise vertical.service_line_summary or list of main pillars separated by · ]

RULES:
- No HTML tags anywhere.
- No markdown tables outside Challenges.
- Bold only via **double asterisks**.
- Platform-agnostic: no "Monday.com", "Box", "Salesforce", "HubSpot" — use generic terms.
- Every case study outcome must be specific and quantified where the data exists.
- All URLs must be real substituted values from the intake — never placeholder text.`,

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
Count how many items are in segments[]. Output EXACTLY that many numbered email blocks — one per segment, in order. Then add exactly ONE final AI/governance email numbered N+1.

  segments[] has 5 items → Email 1–5 + Email 6 (AI) = 6 total
  segments[] has 3 items → Email 1–3 + Email 4 (AI) = 4 total

Do NOT stop early. Do NOT skip any segment. Count segments first, then write every block.

════════════════════════════════════════════
EMAIL BODY RULES — NON-NEGOTIABLE:
• Open with "Hi [Name]," — always, no exceptions.
• Body = EXACTLY 3 SHORT PARAGRAPHS (not bullet points, not a single long paragraph).
  - P1 (1–2 sentences): Consequence or scenario question specific to this segment. Use segment.lead_hook if populated. A question that forces the prospect to think about a real operational consequence.
  - P2 (2–3 sentences): The broader pattern or why the problem is hard to fix internally. Weave in a specific statistic from statistics[] or reference segment.key_pressures. Write as a peer, not a vendor.
  - P3 (1–2 sentences): Name [vertical.client_name] and the specific service combination for this segment. End with the primary_cta.name offer — one sentence, e.g. "The entry point is [primary_cta.name] — [brief benefit clause]."
• After P3 on its own line: [Link]
• Then one short closing question: "Worth 20 minutes?" / "Can we schedule a brief conversation?" / "Would a conversation about [topic] be useful?"
• Then "Best," on its own line, then "[Sign off]" on its own line.
• CTA placeholder: [Link] only — never the actual URL.
• NEVER include audience targeting metadata in the email body.

════════════════════════════════════════════

────────────────────────────────────────────
## Cover
[vertical.client_name]
[vertical.name] + [short label for the primary regulatory framework from regulatory_frameworks[0].name, e.g. "HIPAA" or "Compliance"]
Call Scripts and Emails
BDR Outreach · [exact count of segments[]] Segments · [exact count of segments[] + 1] Email Sequences

────────────────────────────────────────────
## Contents
Call Scripts  Summary table — subject lines, conversation starters, voicemail scripts
Email 1  [segment 1 description — same wording used as the Email 1 heading below]
Email 2  [segment 2 description]
[continue for every segment...]
Email [N+1]  AI governance — all segments

────────────────────────────────────────────
## How to Use
Personalise every [customize with...] bracket before sending. Subject lines and conversation starters are written to work without customisation, but specificity always improves response rates. [primary_cta.name] is the call to action in every sequence — never pitch a full managed services engagement on cold outreach.

────────────────────────────────────────────
## Call Scripts
Subject lines, opening conversation starters, and voicemail scripts for all [count of segments[]] segments.

| # | Email / Segment | Conversation Starters | Voicemail Script |
|---|---|---|---|
[One row per segment in segments[]. Rules per column:
  # — row number
  Email / Segment — "[Segment description from segments[].name]" then on a new line "Subject: [subject line for this segment's email]"
  Conversation Starters — three starters in one cell. Format: 1. "[starter in quotes]" 2. "[starter in quotes]" 3. "[starter in quotes]". Each is 1–2 sentences. Starter 1 uses segment.lead_hook as the basis. All three are questions or direct observations the rep can say verbatim on a cold call.
  Voicemail Script — complete script: "Hi [First Name], this is [Name] from [vertical.client_name] — I [sent you a note / reached out] about [short service description] for [segment description]. [1 sentence on the core gap — what most orgs in this segment can't sustain]. I'll [follow up by email / send a follow-up note], or [call me at / reach me at] [phone number] to connect sooner."]

────────────────────────────────────────────
Output one block per segment below, numbered sequentially, then the AI block.

## Email 1  [Segment 1 description — e.g. "Physician groups + multi-specialty practices"]
### [Subject line for Email 1 — repeated here as the visual section banner]

**Subject Line**
[subject line]

**Preview Text**
[1 sentence — expands the subject line into a specific operational hook]


Hi [Name],

[P1 — 1–2 sentences. Direct consequence question or scenario tied to segment.lead_hook or segment.core_pain. Specific.]

[P2 — 2–3 sentences. The broader pattern. Why it is hard to fix internally. A statistic from statistics[] or reference from segment.key_pressures.]

[P3 — 1–2 sentences. Name [vertical.client_name] + the specific services for this segment. Close with: "The entry point is [primary_cta.name]" + a brief benefit clause, e.g. "— maps your current posture against [framework], no commitment required."]

[Link]

[Closing question]

Best,

[Sign off]

[Repeat the exact structure above as "## Email 2  [Segment 2]", "## Email 3  [Segment 3]", etc., for every remaining segment in segments[]]

────────────────────────────────────────────
Final block — always last:

## Email [N+1]  AI governance — all segments
### [Subject line — references a specific admin time cost or productivity gap from statistics[], e.g. "The problem with AI in [vertical] isn't AI — it's the missing governance layer"]

**Subject Line**
[subject line]

**Preview Text**
[1 sentence — names the governance or deployment barrier]


Hi [Name],

[P1 — 1–2 sentences. Open with a specific statistic about AI admin burden or productivity opportunity from statistics[]. Specific percentage or figure if available.]

[P2 — 2–3 sentences. Name the governance gap — why AI pilots stall for this vertical (PHI, compliance infrastructure, no governed deployment layer). Draw from regulatory_frameworks[] or challenges[] as context.]

[P3 — 1–2 sentences. Name [vertical.client_name]'s AI service. Describe the outcome — productivity gain + governance built in. Close with a reference to primary_cta.name.]

[Link]

[Closing question]

Best,

[Sign off]

────────────────────────────────────────────
## Back Cover
[vertical.client_name]
[VERTICAL.NAME IN CAPS] + [COMPLIANCE LABEL IN CAPS]  |  CALL SCRIPTS AND EMAILS  |  INTERNAL USE ONLY
Confidential — Not for Distribution  ·  [vertical.client_name] Marketing  ·  v1.0  ·  [current year from document metadata]`,

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
Count segments[]. Output EXACTLY that many segment blocks in ## Segments — one per segment, in order.
URL RULE: If primary_cta.url is empty, null, or "na", write [URL] — never write "na".
STAT BAR RULE: Stats for the visual strip MUST start with a number or symbol (%, $, ~, <, >). If a stat is word-based (e.g., "vCISO-Led"), keep it as a plain bullet instead.

════════════════════════════════════════════
COPY RULES:
- 3-box headings: 3–5 words — match the benefit pills from hero exactly
- 3-box body: ONE sentence, maximum 15 words
- Service card descriptions: ONE sentence, maximum 20 words, no vendor names
- Segment core pain: ONE sentence, active tension, no passive constructions
- [vertical.client_name] delivers: 3–5 pipe-separated service names, no descriptions
- NEVER write "ContentNode delivers:" — always use "[vertical.client_name] delivers:"
- Platform-agnostic: "leading AI models", no specific tool names in public copy

════════════════════════════════════════════

────────────────────────────────────────────
## Cover
[vertical.client_name]
[vertical.name] + [short compliance label from regulatory_frameworks[0].name, e.g. "HIPAA"]
Web Page Copy
[primary_cta.url base domain if available, else "[vertical.client_name slug].com/[vertical slug]"]  ·  Draft v1  ·  [current year from document metadata]

────────────────────────────────────────────
## Page Metadata

**Page URL**
[full page URL from primary_cta.url base + /[vertical slug], e.g. nexustek.com/healthcare]

**Page title tag**
[Service 1 + Service 2 for [vertical.name] | [vertical.client_name] — max 60 chars. Use primary service names from pillars[].]

**Meta description**
[vertical.positioning_statement adapted to 1 sentence, max 155 chars. Describes what [vertical.client_name] provides, for whom, and the primary benefit.]

────────────────────────────────────────────
## Hero Section

# [HERO HEADLINE IN ALL CAPS. ENDS WITH A PERIOD. Derived from vertical.taglines[0] — short, punchy, consequence-first. Max 6 words. Example: "IT THAT KEEPS HEALTHCARE RUNNING."]
[Sub-headline — 1 sentence derived from vertical.positioning_statement. Lowercase, active voice, names the service combination and the "without [trade-off]" clause.]

[Three benefit pill labels in brackets on one line — these become the 3-box headings below. Derive from the 3 core capabilities or differentiators most relevant to this vertical.]
[[Pill 1]]  [[Pill 2]]  [[Pill 3]]

CTA buttons:
[[primary_cta.name]]  [[See Client Stories]]

**[Secondary sub-heading — "Where [X], [Y], and [Z] Converge" derived from the 3 pillars or differentiators. 6–10 words.]**
[1 sentence expanding the secondary sub-heading — who this is built for, from [icp] context.]

*[EYEBROW CALLOUT IN ALL CAPS — 4–6 words that sum up the brand promise. Derive from vertical.positioning_statement or brand_voice. Example: "MEET THE MOMENT WITH CONFIDENCE"]*

────────────────────────────────────────────
## Stats

[4 stat lines in bullet format. Stats starting with a number or symbol render as visual boxes:]
- **[statistics[0].stat]** | [statistics[0].label — 3–6 words including context] | [statistics[0].source]
- **[statistics[1].stat]** | [statistics[1].label — 3–6 words] | [statistics[1].source]
- **[statistics[2].stat]** | [statistics[2].label — 3–6 words] | [statistics[2].source]
- **[statistics[3].stat]** | [statistics[3].label — 3–6 words] | [statistics[3].source]

[INTRO CALLOUT IN ALL CAPS — 1 sentence, uppercase. Derived from market_narrative: who [vertical.client_name] serves and what operational realities they address. Example: "FROM PHYSICIAN GROUPS TO HEALTH SYSTEMS, WE ADDRESS THE OPERATIONAL REALITIES OF MID-MARKET HEALTHCARE."]

────────────────────────────────────────────
## 3-Box Treatment

[EXACTLY 3 boxes. Heading = the EXACT benefit pill label used in hero. Body = ONE sentence, max 15 words, drawn from challenges[] or differentiators[]. NO second sentence.]

### [Pill 1 label — exact match]
[ONE sentence. Max 15 words. Consequence of the problem + how [vertical.client_name] solves it.]

### [Pill 2 label — exact match]
[ONE sentence. Max 15 words.]

### [Pill 3 label — exact match]
[ONE sentence. Max 15 words.]

────────────────────────────────────────────
## CTA Banner

**[vertical.name] IT + [primary_cta.name]**
[primary_cta.description — 2 sentences. Sentence 1: what it maps/covers. Sentence 2: format — time required, no commitment required.]
[[Get Started]]

────────────────────────────────────────────
## Solution Stack

**[One bold headline for this section — e.g., "The Full IT Stack. One Partner."]**
[1 sentence: [count of pillars[]] service pillars through [vertical.client_name]'s delivery model — built for [icp context].]

[For each pillar in pillars[] — output as a ### heading followed by service cards. MAXIMUM 4 service cards per pillar. Each service card format:]

### [pillar name]

**[pillar name]**
[Service name from service_stack[] matching this pillar]
[Description — 1–2 sentences. Named capabilities. No generic statements.]

**[pillar name]**
[Next service name]
[Description — 1–2 sentences.]

[continue — max 4 services per pillar]

────────────────────────────────────────────
## Segments Section

**Built for Every [vertical.name] Segment**
[1 sentence: from [smallest segment type] to [largest segment type] — one partner, right-sized for every [icp.company_size or "mid-market"] [vertical.name] organisation.]

[EXACTLY one block per segment in segments[], in order. Do NOT skip any. Format:]

**SEGMENT [N]**
### [segments[N].name]
*[segments[N].buyer_titles joined with " · " — if empty, derive the most relevant titles for this segment type]*
[segments[N].core_pain framed as operational consequence — ONE SENTENCE ONLY. Lead with the gap or risk, not the feature.]
**[vertical.client_name] delivers:**  [3–5 relevant service names from service_stack[], pipe-separated, no descriptions]

────────────────────────────────────────────
## Case Studies Section

**Proven in [vertical.name]**

[Always output EXACTLY 2 case study blocks. Use case_studies[] data if available; use structured placeholder if fewer than 2 entries.]

*CASE STUDY*
### [case_studies[0].client_profile | "[Segment type] | [Service type] Engagement" if empty]

**The situation**
[case_studies[0].situation — 2–3 sentences on who they are and the problem they faced. If empty: "Case study to be added — contact marketing."]

**What [vertical.client_name] delivered**
[case_studies[0].engagement — 2–3 sentences on what was delivered. If empty: "—"]

[If case_studies[0] has a quote or headline_stat: output it as a blockquote]
> [case_studies[0].headline_stat or quote — 1 sentence. If both present, use the quote.]

[[View Full Case Study →]]  [case_studies[0].url if available, else omit URL]

*CASE STUDY*
### [case_studies[1].client_profile | second placeholder if missing]

**The situation**
[case_studies[1].situation or placeholder]

**What [vertical.client_name] delivered**
[case_studies[1].engagement or "—"]

[If case_studies[1] has headline_stat or quote: blockquote it]

[[View Full Case Study →]]  [case_studies[1].url if available]

────────────────────────────────────────────
## Resources

Explore the full [vertical.name] GTM kit.

**eBOOK**
[Short punchy title for the eBook — derived from vertical.taglines[] or market_narrative. Not "[vertical.name] [vertical.client_name] eBook". Example: "IT that keeps care moving"]
[1 sentence: what the eBook helps the reader do or understand — specific to this vertical.]
[[Download]]

**BROCHURE**
[Short punchy title for the brochure — derived from positioning_statement or differentiators[]. Example: "Secure IT. Uninterrupted Care."]
[1 sentence: what the brochure covers — service pillars, challenges, case studies.]
[[View]]

────────────────────────────────────────────
## Why [vertical.client_name]

[ALL proof_points[] as visual strip bullet lines. Format — stats starting with a number render as visual boxes:]
- **[proof_points[0].stat]** | [proof_points[0].context — 3–5 words]
- **[proof_points[1].stat]** | [proof_points[1].context — 3–5 words]
[continue for ALL proof_points[]. If proof_points[] is empty, use 4 lines: - **[Stat]** | [Label — fill before launch]]

────────────────────────────────────────────
## Final CTA

# [Question headline — "Ready to [verb] [desired outcome]?" Derived from vertical.positioning_statement or brand_voice. Ends with "?". Example: "Ready to Put IT to Work for Your Patients?"]
[P1 — 1–2 sentences on what happens in the first conversation. Draw from primary_cta.description — how [vertical.client_name] starts: understanding the environment, where risk exists, where fastest impact is.]

[[primary_cta.name]]  [[View All Services]]

────────────────────────────────────────────
## Back Cover
[vertical.client_name]
[VERTICAL.NAME IN CAPS] + [COMPLIANCE LABEL IN CAPS]  |  WEB PAGE COPY  |  DRAFT V1
Confidential — Internal Use Only  ·  [vertical.client_name] Marketing  ·  [current year from document metadata]`,

    // 08 Internal Brief
    `Using the intake JSON provided, generate an internal GTM launch brief in markdown format.

CRITICAL RULES:
- This is an internal sales enablement document for [vertical.client_name]'s own sales and BDR teams.
- Write about [vertical.client_name]'s services, segments, and offer as the subject matter — this is their kit.
- NEVER mention ContentNode, BullMQ, PostgreSQL, or any internal tooling. This is not about the platform.
- NO DATE-SPECIFIC forward-looking urgency (no "by end of [year]"). Use present-tense regulatory pressure.

## Cover
[The renderer generates the title block automatically — this section is skipped. Leave it empty.]

## Send Note
For marketing to send to sales and company

Subject line: [vertical.name] + [short compliance label, e.g. "HIPAA"] GTM kit — everything you need to start conversations today

Great news — the full [vertical.name] + [compliance label] GTM kit is ready.

[2–3 sentences contextualising why this vertical matters right now. Draw from market_narrative and regulatory_frameworks[]. Name the gap: the prospect's obligations vs. what their internal team can sustain. This is the emotional case for prioritising the vertical — write it as a peer communicating to reps, not a marketing brief. No year-specific urgency.]

## Why This Vertical, Why Now

[4-cell stat boxes — output as a EXACTLY 2-row table with 4 columns. Row 1 = stat values. Row 2 = stat labels with source. Use statistics[0–3].]
| **[statistics[0].stat]** | **[statistics[1].stat]** | **[statistics[2].stat]** | **[statistics[3].stat]** |
|---|---|---|---|
| [statistics[0].label] · [statistics[0].source] | [statistics[1].label] · [statistics[1].source] | [statistics[2].label] · [statistics[2].source] | [statistics[3].label] · [statistics[3].source] |

[1 urgency paragraph, 2–3 sentences. Name the specific regulatory driver from regulatory_frameworks[] — what is changing, what it now requires, and why mid-market providers in this vertical have a gap. No year references. No generic "the compliance landscape is evolving" language — be specific.]

## What's in the Kit

[Intro line: "Eight assets, ready to use across cold outreach, discovery, proposals, and [relevant channel from icp or market context]."]

| ASSET | WHAT IT IS + HOW TO USE IT |
|---|---|
| Messaging Framework | The strategic foundation — positioning, segment callouts for all [count of segments[]] [vertical.name] sub-segments, objection handling, proof points, and brand voice guidance. Read this first. |
| Sales Cheat Sheet | Two-page desk reference — ICP by segment, buyer personas, lead hooks, pain-to-solution mapping, [count of objections[]] objections with responses, qualifying questions, regulatory context, and [count of case_studies[]] case studies with 'when to use' tags. |
| BDR Call Scripts + Emails | [count of segments[]]-segment call script table and [count of segments[] + 1] personalised prospecting emails — [comma-separated list of segment names from segments[]] and AI governance. Ready to personalise and send. |
| Customer Deck | [count of pillars[] + 4]-slide sales presentation for discovery and proposal conversations. Market pressure, compliance context, [count of pillars[]] service pillars, [count of case_studies[]] case studies, and a clear [primary_cta.name] CTA. |
| Brochure | Print and digital leave-behind. [count of challenges[]] challenges, [count of pillars[]] service pillars, [count of differentiators[]] differentiators, and [count of case_studies[]] case studies. Pairs with the deck or stands alone. |
| eBook | [Synthesise a short title from vertical.taglines[]] — The [icp.company_size or "mid-market"] [vertical.name] provider's guide to [top 2–3 themes from pillars[]]. Use as a lead magnet, email nurture attachment, or LinkedIn content. |
| Video Script | 60-second and 90-second storyboards with on-screen text, imagery direction, and a full voiceover script. Built for LinkedIn organic, paid social, and BDR email embeds. |
| Web Page Copy | Full copy for [primary_cta.url domain if available, else "[vertical.client_name].com/[vertical slug]"] — hero, three-box benefits, solution stack, all [count of segments[]] segments, [count of case_studies[]] case studies, and resources slider. Hand off to web team at launch. |

## Where to Start

If You're in Sales
- [Imperative action 1 — what to read first and why. Name the specific asset.]
- [Imperative action 2 — specific personalisation step with the BDR doc or cheat sheet]
- [Imperative action 3 — which asset to attach to intro emails]
- [Imperative action 4 — what to use for discovery and proposal calls]
- [Imperative action 5 — the primary CTA rule: lead every conversation with primary_cta.name, never a full pitch]

If You Are in BDR / Outbound
- [Imperative action 1 — start with the BDR emails, personalise the brackets]
- [Imperative action 2 — video use for email engagement]
- [Imperative action 3 — which cheat sheet section to open compliance conversations with]
- [Imperative action 4 — where to drive CTA traffic and what the offer is]
- [Imperative action 5 — a specific value-add attachment for mid-funnel nurture]

## The [primary_cta.name] — Your Primary CTA

Every asset drives one conversion: the [primary_cta.name].

[2–3 sentences on what the assessment covers — draw from primary_cta.description and regulatory_frameworks[]. Name the specific frameworks it maps against. State the format: time required, no commitment. Write it as a sales tool, not a product description.]

[If case_studies[] has data: Write a 2–3 sentence vignette about case_studies[0] — who they were (client_profile + situation), what [vertical.client_name] did (engagement), and the key outcome (outcomes or headline_stat). If there is a quote in case_studies[0], include it verbatim as a blockquote: > "[quote text]" — [quote attribution if available, else "Client"]]

## The [regulatory_frameworks[0].name] Angle — Don't Miss This

[2–3 sentences on the specific regulatory urgency angle for this vertical. What is [regulatory_frameworks[0].name] requiring now that it didn't before? What are most mid-market providers in this vertical missing? How does [vertical.client_name]'s offer close that specific gap? Be concrete — name the controls (e.g. MFA, encryption, continuous monitoring). This is the urgency trigger reps should use to move "we'll look at it later" to "we need to act now."]

## Key Messages to Land in Every Conversation

[5 key messages. Each = a bold short headline (3–6 words) followed by a paragraph of 2–3 sentences. Derive from vertical.taglines[], vertical.positioning_statement, differentiators[], and primary_cta. Write each as something a rep can internalise and repeat, not marketing copy.]

**[Message 1 headline — derived from vertical.taglines[0] or core positioning: the patient/client outcome]**
[2–3 sentences explaining why this headline is the emotional anchor for every segment — clinical/operational consequence, not an IT outcome.]

**[Message 2 headline — mid-market complexity vs. enterprise IT gap]**
[2–3 sentences on why the prospect's obligations exceed their internal team's capacity — reference icp.company_size context and the gap that [vertical.client_name] closes.]

**[Message 3 headline — compliance positioning: implement, not certify]**
[2–3 sentences on what [vertical.client_name] does vs. doesn't do. What controls they implement and manage. The positioning boundary that protects every conversation.]

**[Message 4 headline — full stack / single partner differentiation, derived from pillars[]]**
[2–3 sentences on the [count of pillars[]] pillars and how they integrate through [vertical.client_name]'s delivery model. What separates them from point solution vendors and generic MSPs.]

**[Message 5 headline — the CTA is the door, not the pitch]**
[2–3 sentences on primary_cta.name as the right first ask. Low friction, high value. Never open with a full managed services pitch.]

## One Non-Negotiable

Never claim [vertical.client_name] [list verbatim from vertical.what_we_are_not[] — join with ", " and end with a period]. These are the positioning boundaries in the Messaging Framework — they protect every conversation and set the right client expectations from the start.

## Back Cover
[vertical.client_name]
[VERTICAL.NAME IN CAPS] + [COMPLIANCE LABEL IN CAPS]  |  GTM LAUNCH BRIEF  |  INTERNAL USE ONLY
[vertical.client_name] Marketing  ·  [current year from document metadata]`
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

  const { provider: rProv, model: SONNET } = await getModelForRole('generation_primary')
  const API_KEY = defaultApiKeyRefForProvider(rProv)
  const PROVIDER = rProv as 'anthropic' | 'openai' | 'ollama'

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
              provider: PROVIDER,
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
                provider: PROVIDER,
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
