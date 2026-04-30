/**
 * gtmpilot.ts
 *
 * POST /api/v1/gtm-pilot/chat
 *
 * gtmPILOT — AI GTM Framework strategist.
 * Context priority:
 *   1. Client Brain (client.brainContext + ClientBrainAttachment + ClientFrameworkAttachment summaries)
 *   2. Organization Brain (vertical.brainContext + VerticalBrainAttachment + agency.brainContext + AgencyBrainAttachment)
 *   3. Industry standards (Claude's built-in GTM + demand gen expertise)
 *
 * Returns conversational reply + <GTMPILOT_SUGGESTIONS> block with section navigation actions.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma }               from '@contentnode/database'

// ─── Schema ───────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(10000),
})

const conflictEntrySchema = z.object({
  sectionNum:    z.string(),
  clientClaim:   z.string(),
  researchFinds: z.string(),
  recommendation: z.string().optional(),
})

const chatBody = z.object({
  messages:          z.array(messageSchema).min(1).max(40),
  clientId:          z.string(),
  verticalId:        z.string(),
  verticalName:      z.string().optional().nullable(),
  filledSections:    z.array(z.string()).optional(),
  emptySections:     z.array(z.string()).optional(),
  activeSection:     z.string().optional().nullable(),        // current section user is viewing
  researchBySection: z.record(z.string()).optional().nullable(), // { "03": "research findings..." }
  conflictLog:       z.array(conflictEntrySchema).optional().nullable(),
  companyBrief:      z.string().optional().nullable(),
})

// ─── Vertical → compliance framework map ──────────────────────────────────────

const COMPLIANCE_VERTICAL_MAP: Array<{ keywords: string[]; frameworks: string; description: string }> = [
  {
    keywords: ['healthcare', 'health care', 'medical', 'hospital', 'clinic', 'dental', 'pharma', 'hipaa', 'health it', 'ehr', 'emr', 'telehealth'],
    frameworks: 'HIPAA, HITRUST CSF, 42 CFR Part 2 (substance use records), state health data privacy laws (e.g. CMIA in California)',
    description: 'patient data protection, electronic health records security, breach notification requirements',
  },
  {
    keywords: ['manufacturing', 'defense', 'aerospace', 'government contractor', 'federal', 'dod', 'cmmc', 'itar', 'military', 'contractor'],
    frameworks: 'CMMC 2.0, ITAR, EAR, ISO 27001, NIST CSF, NIST SP 800-171',
    description: 'controlled unclassified information (CUI) protection, supply chain security, export control compliance',
  },
  {
    keywords: ['finance', 'financial', 'banking', 'bank', 'insurance', 'investment', 'wealth management', 'fintech', 'credit union', 'mortgage', 'lending', 'accounting', 'cpa'],
    frameworks: 'SOC 2 Type II, PCI-DSS, GLBA (Gramm-Leach-Bliley), SEC cybersecurity disclosure rules, FFIEC guidelines',
    description: 'financial data protection, payment card security, fiduciary data obligations',
  },
  {
    keywords: ['education', 'edtech', 'school', 'university', 'college', 'k-12', 'district', 'academic', 'campus', 'student'],
    frameworks: 'FERPA, CIPA, COPPA (for platforms serving minors), state student data privacy laws (e.g. SOPIPA in California)',
    description: 'student education record protection, internet safety for minors, parental consent requirements',
  },
  {
    keywords: ['energy', 'utilities', 'utility', 'electric', 'grid', 'power', 'oil', 'gas', 'water', 'pipeline', 'ot', 'ics', 'scada', 'nerc'],
    frameworks: 'NERC CIP, ICS/OT security frameworks (ISA/IEC 62443), NIST CSF, TSA pipeline directives',
    description: 'critical infrastructure protection, operational technology (OT) security, grid reliability',
  },
  {
    keywords: ['retail', 'ecommerce', 'e-commerce', 'consumer', 'merchant', 'shop', 'store', 'hospitality', 'hotel', 'restaurant'],
    frameworks: 'PCI-DSS, CCPA/CPRA, state consumer privacy laws (Virginia CDPA, Colorado CPA, etc.), FTC Act Section 5',
    description: 'payment card data security, consumer data privacy rights, data breach notification',
  },
  {
    keywords: ['legal', 'law firm', 'attorney', 'lawyer', 'professional services', 'staffing', 'hr', 'human resources', 'consulting', 'advisory'],
    frameworks: 'SOC 2 Type II, state bar data security requirements, ABA cybersecurity guidelines, GDPR (for EU client data)',
    description: 'client confidentiality obligations, professional duty of competence, data handling for privileged information',
  },
  {
    keywords: ['msp', 'managed service', 'it service', 'mssp', 'cybersecurity', 'security operations', 'soc', 'var', 'technology'],
    frameworks: 'SOC 2 Type II, NIST CSF, ISO 27001, CIS Controls — plus client-inherited frameworks (e.g. HIPAA BAA, CMMC if serving those sectors)',
    description: 'third-party risk management, client data handling, security operations compliance',
  },
]

function getComplianceFrameworks(verticalName: string): { frameworks: string; description: string } | null {
  const lower = verticalName.toLowerCase()
  for (const entry of COMPLIANCE_VERTICAL_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return { frameworks: entry.frameworks, description: entry.description }
    }
  }
  return null
}

// ─── Section reference ────────────────────────────────────────────────────────

const SECTION_REFERENCE = `
GTM FRAMEWORK SECTIONS (sectionNum → meaning):

"01" — Vertical Overview: Positioning statement, tagline options, how the service is used, what it is not. The north-star for all messaging in this vertical.
"02" — Customer Definition + Profile: Target industry, company size, geography, IT posture, compliance status, buyer table (segment × primary buyer × core pain × entry point), secondary targets.
"03" — Market Pressures + Stats: The market pressure narrative, supporting stats table (stat × context × source × year), additional context. The "why now" fuel for top-of-funnel content.
"04" — Core Challenges: Each challenge with: why it exists, its consequence, the solution, and service pillars it maps to. Drives problem-aware messaging.
"05" — Solutions + Service Stack: Service pillars (value prop, key services, relevant segments) + full service stack (service × what it delivers × priority). The "what we do" content engine.
"06" — Why [Client]: Differentiators (label + positioning narrative). The "why us" content that feeds cheat sheets, emails, and decks.
"07" — Segments + Buyer Profiles: Expanded buyer profiles per segment — persona, trigger events, what they've tried, their language. Powers BDR sequences and speaker notes.
"08" — Messaging Framework: Core message, pillar messages, supporting proof points, tone. Used across all 8 asset types.
"09" — Proof Points + Case Studies: Client evidence by challenge — case study, quotes, stats, outcomes. Feeds brochures, emails, web pages, and video scripts.
"10" — Objection Handling: Top objections with bridge sentences. Powers cheat sheets, BDR emails, and deck speaker notes.
"11" — Brand Voice Examples: Approved examples that define the tone guardrail for all 8 asset types.
"12" — Competitive Differentiation: Competitor-by-competitor: strengths, weaknesses, how the client differs, landmines to avoid. Feeds cheat sheets, BDR emails, and decks.
"13" — Customer Quotes + Testimonials: Categorised quotes with attribution and usage context. Feeds eBooks, brochures, decks, and web pages.
"14" — Campaign Themes + Asset Mapping: Campaign theme ideas, the asset each maps to, and the sequence. Used for campaign planning across all verticals.
"15" — Frequently Asked Questions: Questions the client is always asked, with answers. Powers eBooks, BDR email 3, and cheat sheets.
"16" — Content Funnel Mapping: Asset type → funnel stage → CTA → next asset. Ensures sequencing and CTA alignment across all 8 assets.
"17" — Regulatory + Compliance: Compliance constraints, required disclaimers, proof requirements. Critical for regulated industries.
"18" — CTAs + Next Steps: Approved CTAs by funnel stage with guidance. Used across all 8 assets.
`

// ─── Context assembler ────────────────────────────────────────────────────────

async function buildContext(
  agencyId: string,
  clientId: string,
  verticalId: string,
): Promise<string[]> {
  const parts: string[] = []

  // ── Layer 1: Client Brain ─────────────────────────────────────────────────
  const [client, clientAttachments, frameworkAttachments] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: {
        name: true, industry: true, brainContext: true,
        brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
      },
    }),
    prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.clientFrameworkAttachment.findMany({
      where: { clientId, verticalId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  if (!client) return parts

  parts.push(`=== LAYER 1: CLIENT BRAIN ===`)
  parts.push(`CLIENT: ${client.name}`)
  if (client.industry) parts.push(`INDUSTRY: ${client.industry}`)

  const brandProfile = client.brandProfiles[0]
  const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson
  if (brandData) {
    const b = brandData as Record<string, unknown>
    if (b.positioning ?? b.value_proposition) parts.push(`POSITIONING: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
    if (b.target_audience ?? b.audience) parts.push(`TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
  }

  if (client.brainContext?.trim()) {
    parts.push(`\nCLIENT BRAIN SYNTHESIS:\n${client.brainContext.trim()}`)
  }

  if (clientAttachments.length > 0) {
    parts.push('\nCLIENT BRAIN DOCUMENTS:')
    for (const doc of clientAttachments) {
      if (doc.summary?.trim()) parts.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  if (frameworkAttachments.length > 0) {
    parts.push('\nGTM FRAMEWORK BRAIN (uploaded files for this vertical):')
    for (const doc of frameworkAttachments) {
      if (doc.summary?.trim()) parts.push(`[framework] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  // ── Layer 2: Organization Brain (Vertical + Agency) ───────────────────────
  const orgParts: string[] = []

  const [vertical, verticalAttachments, agency, agencyAttachments] = await Promise.all([
    prisma.vertical.findFirst({
      where: { id: verticalId, agencyId },
      select: { name: true, brainContext: true },
    }),
    prisma.verticalBrainAttachment.findMany({
      where: { verticalId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.agency.findFirst({
      where: { id: agencyId },
      select: { name: true, brainContext: true },
    }),
    prisma.agencyBrainAttachment.findMany({
      where: { agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
  ])

  if (vertical) {
    orgParts.push(`VERTICAL: ${vertical.name}`)
    if (vertical.brainContext?.trim()) {
      orgParts.push(`VERTICAL BRAIN:\n${vertical.brainContext.trim()}`)
    }
    for (const doc of verticalAttachments) {
      if (doc.summary?.trim()) orgParts.push(`[vertical doc] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  if (agency?.brainContext?.trim()) {
    orgParts.push(`AGENCY KNOWLEDGE (${agency.name}):\n${agency.brainContext.trim()}`)
  }
  for (const doc of agencyAttachments) {
    if (doc.summary?.trim()) orgParts.push(`[agency doc] ${doc.filename}:\n${doc.summary.trim()}`)
  }

  if (orgParts.length > 0) {
    parts.push(`\n=== LAYER 2: ORGANIZATION BRAIN ===`)
    parts.push(...orgParts)
  }

  return parts
}

// ─── System prompt builder ────────────────────────────────────────────────────

const SECTION_DEPENDENCIES: Record<string, string[]> = {
  '07': ['02'],
  '08': ['01', '02', '04'],
  '10': ['02', '04'],
  '12': ['01', '06'],
  '14': ['01', '08'],
  '16': ['08'],
  '18': ['01', '08'],
}

function buildSystemPrompt(
  contextParts: string[],
  filledSections: string[],
  emptySections: string[],
  verticalName: string,
  activeSection?: string | null,
  researchBySection?: Record<string, string> | null,
  conflictLog?: Array<{ sectionNum: string; clientClaim: string; researchFinds: string; recommendation?: string }> | null,
  companyBrief?: string | null,
): string {
  const filledList = filledSections.length > 0
    ? filledSections.join(', ')
    : 'none yet'
  const emptyList = emptySections.length > 0
    ? emptySections.join(', ')
    : 'all sections are filled'

  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available yet — encourage the user to upload documents in the Brain section.'

  // Company brief block
  const briefBlock = companyBrief
    ? `\nCOMPANY BRIEF (what this company does in plain language):\n${companyBrief}\n`
    : ''

  // Intake mode: no brief, no filled sections, very little context
  const needsIntake = !companyBrief && filledSections.length === 0 && contextParts.length < 3
  const intakeInstructions = needsIntake
    ? `\nINTAKE MODE: This is a brand new framework with no brief and no context yet. Before doing any strategic work, you need to build a foundation. Ask 3 focused intake questions (one at a time, in order):
1. What does this company sell or do? (product/service, target market, business model)
2. What makes them different from others who do the same thing?
3. Who is the ideal buyer for this vertical — their title, their biggest pain, and what they've tried before?
After the user answers all 3, synthesize their answers into a company brief, output it on a new line starting with: "BRIEF_SAVE: " followed by the brief text (2-3 sentences). Do NOT include the BRIEF_SAVE line in what you show to the user — it is a silent signal to the system.`
    : ''

  // Section-specific research context
  let researchBlock = ''
  if (activeSection && researchBySection?.[activeSection]) {
    researchBlock = `\nRESEARCH FINDINGS FOR §${activeSection} (from automated research run):\n${researchBySection[activeSection]}\n`
  }

  // Conflict log for active section
  let conflictBlock = ''
  const activeSectionConflicts = conflictLog?.filter((c) => c.sectionNum === activeSection) ?? []
  if (activeSectionConflicts.length > 0) {
    conflictBlock = `\nCONFLICTS FOR §${activeSection} (client-supplied GTM vs. research):\n` +
      activeSectionConflicts.map((c) =>
        `⚠ Client says: "${c.clientClaim}"\n  Research shows: "${c.researchFinds}"\n  Recommendation: ${c.recommendation ?? 'Ask the strategist to adjudicate.'}`
      ).join('\n\n') + '\n'
  }

  // §17 regulatory context — toggle + pre-populate + cross-section awareness
  let section17Block = ''
  if (activeSection === '17') {
    const compliance = getComplianceFrameworks(verticalName)
    const frameworkSuggestion = compliance
      ? `Based on the vertical name "${verticalName}", the most likely applicable frameworks are:\n${compliance.frameworks}\n(These typically relate to: ${compliance.description})`
      : `I don't have a default framework list for "${verticalName}" — ask the user to identify any applicable regulatory frameworks.`

    section17Block = `
SECTION 17 — REGULATORY + COMPLIANCE CONTEXT (active):
This section is fully framework-agnostic — it applies to any regulated vertical, not just cybersecurity clients.

STEP 1 — TOGGLE QUESTION (required as your first response on §17, unless the user has already answered it):
Ask exactly this: "Does this vertical operate under any regulatory or compliance frameworks?"

If the user says NO or this vertical is unregulated:
- Acknowledge it clearly, then output on a new line: SECTION_SKIP: 17
- The SECTION_SKIP: line must appear alone on its own line and is a silent system signal — do NOT show it to the user or explain it
- Suggest moving to the next relevant section (§18 CTAs, or whichever is most valuable)
- Do not fill any §17 fields

If the user says YES or the vertical is clearly regulated, proceed to Step 2.

STEP 2 — LEAD WITH A PRE-POPULATED LIST (do not wait for the user to name frameworks):
${frameworkSuggestion}

Present the list and say something like: "Here are the frameworks most common in this vertical. Remove any that don't apply, add any I'm missing, and for each that stays, I'll help you map your service capability to it."

STEP 3 — MAP CAPABILITIES (for each confirmed framework):
Help the user articulate:
- What specific service or technical capability demonstrates compliance with this framework
- What proof exists (certification, audit report, documented process, third-party attestation)
- The plain-language sales version (not legalese — what a rep can say in a meeting)

CROSS-SECTION DOWNSTREAM IMPACT:
When the user confirms a regulation applies, tell them which assets will use it:
- Brochure → compliance credentialing section ("We understand your regulatory environment")
- BDR Email 3 → compliance objection handling ("We're already certified for [framework]")
- Sales cheat sheet → quick-reference compliance table for reps in regulated deals
Flag this when it's relevant: "Confirming HIPAA here means I'll pull it into the brochure's credentialing section and BDR Email 3's compliance positioning."
`
  }

  // Section dependency warning
  let dependencyBlock = ''
  if (activeSection && SECTION_DEPENDENCIES[activeSection]) {
    const unfilledDeps = SECTION_DEPENDENCIES[activeSection].filter((dep) => !filledSections.includes(dep))
    if (unfilledDeps.length > 0) {
      const depNames: Record<string, string> = {
        '01': '§01 Vertical Overview', '02': '§02 Customer Definition + Profile',
        '04': '§04 Core Challenges', '06': '§06 Why [Client]', '08': '§08 Messaging Framework',
      }
      const depList = unfilledDeps.map((d) => depNames[d] ?? `§${d}`).join(' and ')
      dependencyBlock = `\nSECTION DEPENDENCY ALERT: The user is viewing §${activeSection} but ${depList} ${unfilledDeps.length === 1 ? 'is' : 'are'} not yet filled. §${activeSection} cannot be done well without ${depList} being defined first. Guide the user to complete the prerequisite section(s) before working on §${activeSection}.\n`
    }
  }

  return `You are gtmPILOT, the AI GTM Framework strategist built into ContentNode. You help agency teams complete 18-section GTM Frameworks with precision and real strategic depth — drawing on client brain context, vertical knowledge, and your built-in expertise in B2B go-to-market strategy.

Your role: Help the user think through what is actually true about this client's GTM strategy. The sections get filled as a result of that thinking — not as the goal of it.

${SECTION_REFERENCE}

CLIENT CONTEXT (in priority order — use this to ground every response):
${contextBlock}
${briefBlock}
CURRENT FRAMEWORK STATE:
Vertical: ${verticalName}
Sections already filled: ${filledList}
Sections still empty: ${emptyList}
${activeSection ? `User is currently viewing: §${activeSection}` : ''}${researchBlock}${conflictBlock}${section17Block}${dependencyBlock}${intakeInstructions}

YOUR ROLE — GUIDE, DON'T FILL:
You are not a form assistant. You are a GTM thinking partner. The difference matters:

- Form assistant: "§08 is empty. What's the primary differentiator?"
- Thinking partner: "Messaging unlocks everything downstream. Before we go there — where does the positioning feel contested or fuzzy to you right now?"

SESSION ARC:
**Orient** (first 1-2 turns): Ask what feels most unclear or underexplored. Don't assume the most important work is filling the emptiest section — sometimes a filled section has a weak answer worth challenging.
**Explore**: Go deep on the most strategically valuable territory. Ask the uncomfortable question. When an answer is vague, push for evidence. When something conflicts with what you know, name it.
**Narrow**: When you have enough to write something specific, confirm it: "Based on what you've said, here's what I'd put in §08 — does this feel right?"
**Fill**: User confirms. Navigate to that section.

BEHAVIORAL RULES:
- One question per turn — ask the one that matters most right now
- Present 2-3 directions before settling on one — let the user choose where to go
- Never ask for information already in the brain context — reference it, challenge it, or build on it
- Surface contradictions: "You said X earlier but now Y — how do you reconcile that?"
- Push for specificity: job titles aren't buyer personas, revenue growth isn't a proof point
- Short responses: 3-5 lines + one question + suggestion block

GTM BEST PRACTICES TO APPLY:
- §08 (Messaging Framework) is the highest-value section — everything else references it
- §04 (Core Challenges) should be solved before §05 (Solutions) — don't jump ahead
- §09 (Proof Points) is only as good as the specificity of the outcomes — push for numbers
- §12 (Competitive Diff) requires knowing both strengths AND landmines — ask about both
- §07 (Segments + Buyer Profiles) needs trigger events, not just job titles
- §03 (Market Pressures) is most powerful with third-party stats — push for sources

SUGGESTION BLOCK — always at the very end of your message (2-3 real options, not a to-do list):
<GTMPILOT_SUGGESTIONS>
[
  {
    "id": "unique_id",
    "title": "Short title (4-6 words)",
    "description": "One sentence: why this direction is worth exploring, not just what it is",
    "sectionNum": "08",
    "action": "navigate"
  }
]
</GTMPILOT_SUGGESTIONS>

Valid sectionNum values: "01" through "18"
Valid action values: "navigate" (go to this section)
Make suggestions feel like real choices — different angles, different tradeoffs — not just a queue of sections to complete.
If giving general advice with no specific section navigation, omit the suggestions block entirely.`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function gtmPilotRoutes(app: FastifyInstance) {
  app.post('/chat', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const {
      messages, clientId, verticalId, verticalName,
      filledSections = [], emptySections = [],
      activeSection, researchBySection, conflictLog, companyBrief,
    } = parsed.data

    // Verify client and vertical belong to this agency
    const [client, vertical] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

    const contextParts = await buildContext(agencyId, clientId, verticalId)
    const systemPrompt = buildSystemPrompt(
      contextParts,
      filledSections,
      emptySections,
      verticalName ?? vertical.name,
      activeSection,
      researchBySection as Record<string, string> | null | undefined,
      conflictLog,
      companyBrief,
    )

    const levelHint = `[GTM Framework — Client: ${client.name} — Vertical: ${verticalName ?? vertical.name}]`

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => ({
      role:    m.role,
      content: i === 0 ? `${levelHint}\n\n${m.content}` : m.content,
    }))

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 })

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     systemPrompt,
      messages:   anthropicMessages,
    })

    const fullText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Extract <GTMPILOT_SUGGESTIONS> block
    const match = fullText.match(/<GTMPILOT_SUGGESTIONS>([\s\S]+?)<\/GTMPILOT_SUGGESTIONS>/i)
    let suggestions: unknown[] = []
    let replyText = fullText

    if (match) {
      replyText = fullText.replace(match[0], '').trim()
      try { suggestions = JSON.parse(match[1].trim()) } catch { /* malformed — return empty */ }
    } else {
      replyText = fullText.replace(/<GTMPILOT_SUGGESTIONS>[\s\S]*/i, '').trim()
    }

    return reply.send({ data: { reply: replyText, suggestions } })
  })
}
