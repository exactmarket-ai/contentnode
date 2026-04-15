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

const chatBody = z.object({
  messages:       z.array(messageSchema).min(1).max(40),
  clientId:       z.string(),
  verticalId:     z.string(),
  verticalName:   z.string().optional().nullable(),
  filledSections: z.array(z.string()).optional(), // ['01', '03', ...]
  emptySections:  z.array(z.string()).optional(), // ['02', '04', ...]
})

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

function buildSystemPrompt(
  contextParts: string[],
  filledSections: string[],
  emptySections: string[],
  verticalName: string,
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

  return `You are gtmPILOT, the AI GTM Framework strategist built into ContentNode. You help agency teams complete 18-section GTM Frameworks with precision and real strategic depth — drawing on client brain context, vertical knowledge, and your built-in expertise in B2B go-to-market strategy.

Your role: Ask sharp, specific questions. Apply GTM best practices for this client's industry. Guide the user through each section — prioritising the sections that unlock the most downstream content value.

${SECTION_REFERENCE}

CLIENT CONTEXT (in priority order — use this to ground every response):
${contextBlock}

CURRENT FRAMEWORK STATE:
Vertical: ${verticalName}
Sections already filled: ${filledList}
Sections still empty: ${emptyList}

HOW TO RESPOND — follow this exact flow:

PHASE 1 — ORIENTATION (first message or if user asks what to do next):
- Reference 1-2 specific things you know about this client from the brain context
- Identify the 2-3 most important EMPTY sections to complete first (prioritise: §08 → §02 → §04 → §06 over everything else for content quality)
- Ask ONE sharp, specific question about the client to start filling the most important empty section
- Output 2-3 starting directions with a <GTMPILOT_SUGGESTIONS> block

PHASE 2 — SECTION DEEP-DIVE:
- When working on a specific section: apply GTM industry standards for this type of business and vertical
- Ask 1-2 very specific, short questions (e.g. "What's their primary differentiator against Competitor X?" not "Tell me about their competitive position")
- Reference what you already know from the brain context — don't ask for info you already have
- After each answer, synthesize what you now know and confirm what goes into the section
- Suggest the next most valuable empty section

PHASE 3 — MOMENTUM:
- After working through a section, immediately suggest the next 2 most important empty sections
- Keep momentum: end every reply pointing to the next section
- The goal is to get all 18 sections filled so all 8 content assets can be drafted

GTM BEST PRACTICES TO APPLY:
- §08 (Messaging Framework) is the highest-value section — everything else references it
- §04 (Core Challenges) should be solved before §05 (Solutions) — don't jump ahead
- §09 (Proof Points) is only as good as the specificity of the outcomes — push for numbers
- §12 (Competitive Diff) requires knowing both strengths AND landmines — ask about both
- §07 (Segments + Buyer Profiles) needs trigger events, not just job titles
- §03 (Market Pressures) is most powerful with third-party stats — push for sources

GENERAL RULES:
- Never ask for info that's already in the brain context — reference it instead
- Keep responses SHORT: 3-5 lines before the suggestions block
- One question per message — never stack questions
- Always output a <GTMPILOT_SUGGESTIONS> block with 2-3 navigation targets
- For already-filled sections: acknowledge briefly and suggest gaps or improvements

SUGGESTION BLOCK (always at the very end of your message):
<GTMPILOT_SUGGESTIONS>
[
  {
    "id": "unique_id",
    "title": "Short title (4-6 words)",
    "description": "One sentence: what you'll focus on in this section",
    "sectionNum": "08",
    "action": "navigate"
  }
]
</GTMPILOT_SUGGESTIONS>

Valid sectionNum values: "01" through "18"
Valid action values: "navigate" (go to this section)
If giving general advice (no section navigation needed), omit the suggestions block entirely.`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function gtmPilotRoutes(app: FastifyInstance) {
  app.post('/chat', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const { messages, clientId, verticalId, verticalName, filledSections = [], emptySections = [] } = parsed.data

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
