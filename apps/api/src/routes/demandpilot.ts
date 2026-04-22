/**
 * demandpilot.ts
 *
 * POST /api/v1/demand-pilot/chat
 *
 * demandPILOT — AI demand generation strategist.
 * Context priority:
 *   1. Client Brain (client.brainContext + ClientBrainAttachment summaries + GTM assessment)
 *   2. Organization Brain (vertical.brainContext + VerticalBrainAttachment + agency.brainContext + AgencyBrainAttachment)
 *   3. Industry standards (Claude's built-in demand gen expertise)
 *
 * Returns conversational reply + <DEMANDPILOT_SUGGESTIONS> block with section-fill actions.
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
  verticalId:     z.string().optional().nullable(),
  verticalName:   z.string().optional().nullable(),
  level:          z.string().optional(),          // 'company' or vertical name
  filledSections: z.array(z.string()).optional(), // ['b1', 's1', ...]
  emptySections:  z.array(z.string()).optional(), // ['b2', 'b3', ...]
})

// ─── Section reference ────────────────────────────────────────────────────────

const SECTION_REFERENCE = `
DEMAND GEN INTAKE SECTIONS (sectionNum → sectionKey):

"00" (key: "00")  — Feed the Brain: Uploaded files and URLs the AI uses to understand the client. Read-only in this chat — direct the user to upload materials there.
"B1" (key: "b1")  — Revenue & Growth Goals: Funding stage, runway, company-wide revenue targets, new client count, avg deal size, key growth initiatives. Anchors every downstream demand gen decision.
"B2" (key: "b2")  — Sales Process & CRM: CRM platform, sales methodology, avg sales cycle, lead qualification criteria, follow-up process, full pipeline stage breakdown.
"B3" (key: "b3")  — Marketing Budget & Resources: Total marketing budget, frequency, internal team size/roles, external agencies/partners, full marketing tech stack.
"01" (key: "s1")  — Current Marketing Reality: Every active channel (status, what's working, monthly spend), existing marketing assets (website, email lists, ad accounts).
"02" (key: "s2")  — Offer Clarity: Each primary offer explained in plain English (problem solved, outcome, time to value, risk reversal/guarantee), proof points with sources.
"03" (key: "s3")  — ICP + Buying Psychology: Each buyer persona (role, industry, company stage, trigger events that make them look for solutions, what they've already tried, objections before buying, what they value most).
"04" (key: "s4")  — Revenue Goals + Constraints: Campaign-level targets by period (revenue target, lead volume, ad budget, capacity, close rate, timeline expectations). Demand gen-specific — different from B1.
"05" (key: "s5")  — Sales Process Alignment: How marketing feeds the sales funnel from demand gen's perspective — sales method, CRM, cycle, follow-up, and pipeline handoffs.
"06" (key: "s6")  — Hidden Gold: Best/worst/almost-bought customer stories, frequently asked questions. Unlocks campaign angles most agencies miss.
"07" (key: "s7")  — External Intelligence: Market findings from reviews (G2, Trustpilot), Reddit, LinkedIn, competitors, search intent. Pressure-tests everything the client claims.
`

// ─── Context assembler ────────────────────────────────────────────────────────

async function buildContext(
  agencyId: string,
  clientId: string,
  verticalId?: string | null,
): Promise<string[]> {
  const parts: string[] = []

  // ── Layer 1: Client Brain ─────────────────────────────────────────────────
  const [client, clientAttachments, gtm, dgBase] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: {
        name: true, industry: true, brainContext: true,
        brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
        brandBuilders: { take: 1, orderBy: { createdAt: 'desc' }, select: { dataJson: true } },
      },
    }),
    prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.clientGTMAssessment.findUnique({ where: { clientId } }),
    prisma.clientDemandGenBase.findUnique({ where: { clientId } }),
  ])

  if (!client) return parts

  parts.push(`=== LAYER 1: CLIENT BRAIN ===`)
  parts.push(`CLIENT: ${client.name}`)
  if (client.industry) parts.push(`INDUSTRY: ${client.industry}`)

  const brandProfile = client.brandProfiles[0]
  const brandBuilder = client.brandBuilders[0]
  const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson ?? brandBuilder?.dataJson
  if (brandData) {
    const b = brandData as Record<string, unknown>
    if (b.positioning ?? b.value_proposition) parts.push(`POSITIONING: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
    if (b.target_audience ?? b.audience) parts.push(`TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
    if (b.tone_of_voice ?? b.brand_voice) parts.push(`BRAND VOICE: ${JSON.stringify(b.tone_of_voice ?? b.brand_voice)}`)
  }

  if (client.brainContext?.trim()) {
    parts.push(`\nCLIENT BRAIN SYNTHESIS:\n${client.brainContext.trim()}`)
  }

  if (clientAttachments.length > 0) {
    parts.push('\nCLIENT DOCUMENTS:')
    for (const doc of clientAttachments) {
      if (doc.summary?.trim()) parts.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  if (gtm?.data) {
    const gtmStr = JSON.stringify(gtm.data)
    parts.push(`\nGTM ASSESSMENT (existing):\n${gtmStr.slice(0, 2500)}`)
  }

  if (dgBase?.data) {
    const dgStr = JSON.stringify(dgBase.data)
    parts.push(`\nEXISTING DEMAND GEN DATA (company level):\n${dgStr.slice(0, 2000)}`)
  }

  // ── Layer 2: Organization Brain (Vertical + Agency) ───────────────────────
  const orgParts: string[] = []

  if (verticalId) {
    const [vertical, verticalAttachments] = await Promise.all([
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
  }

  const [agency, agencyAttachments] = await Promise.all([
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
  level: string,
): string {
  const filledList = filledSections.length > 0
    ? filledSections.join(', ')
    : 'none yet'
  const emptyList = emptySections.length > 0
    ? emptySections.join(', ')
    : 'all sections are filled'

  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No client brain context available yet — encourage the user to upload documents in the Feed the Brain section.'

  return `You are demandPILOT, the AI demand generation strategist built into ContentNode. You help agency teams complete demand gen intake forms with precision, speed, and real strategic depth.

Your role: Help the user think through what is actually true about this client's demand generation strategy. The sections get filled as a result of that thinking — not as the goal of it.

${SECTION_REFERENCE}

CLIENT CONTEXT (in priority order — use this to ground every response):
${contextBlock}

CURRENT FORM STATE:
Level: ${level}
Sections already filled: ${filledList}
Sections still empty: ${emptyList}

YOUR ROLE — GUIDE, DON'T FILL:
You are not a form assistant. You are a demand gen thinking partner. The difference matters:

- Form assistant: "B1 is empty. What's the target revenue goal?"
- Thinking partner: "Before we lock in targets — what's the honest assessment of their current pipeline health? That shapes what's realistic."

SESSION ARC:
**Orient** (first 1-2 turns): Find out what the user is most uncertain about or what they want to test. Don't march to the emptiest section — start where the strategic uncertainty lives.
**Explore**: Apply demand gen industry standards to challenge what the user believes. Ask what the evidence is. Surface assumptions. One sharp question per turn.
**Narrow**: When the thinking has landed, confirm what goes in the section: "So we'd say X — does that feel accurate to you?"
**Fill**: User confirms. Suggest filling that section.

BEHAVIORAL RULES:
- One question per turn — the most strategically valuable one right now
- Present 2-3 directions before diving into one — let the user decide where to go
- Never ask for information already in the brain context — reference it, build on it, challenge it
- Push for specificity over generality: vague goals produce vague strategies
- Short responses: 3-5 lines + one question + suggestion block

INDUSTRY STANDARDS TO APPLY:
- SaaS (Series A–B): MRR targets, CAC/LTV ratios, product-led vs. sales-led motion
- Professional services: retainer vs. project-based, referral weight, relationship-driven sales
- E-commerce: AOV, repeat purchase rate, channel mix (paid/organic/email)
- B2B services: longer sales cycles, multi-stakeholder buying, strong proof point requirements
- Apply the appropriate benchmarks for this client's industry and stage

SUGGESTION BLOCK (always at the very end of your message — 2-3 real options, different angles):
<DEMANDPILOT_SUGGESTIONS>
[
  {
    "id": "unique_id",
    "title": "Short title (4-6 words)",
    "description": "One sentence: what you'll fill in or do",
    "sectionNum": "B1",
    "sectionKey": "b1",
    "action": "fill"
  }
]
</DEMANDPILOT_SUGGESTIONS>

Valid sectionNum values: "00", "B1", "B2", "B3", "01", "02", "03", "04", "05", "06", "07"
Valid action values: "fill" (ready to fill with confirmed content) | "navigate" (need to explore before filling)
Make suggestions feel like real choices — different angles, not a queue — so the user decides where to go.
If giving general advice with no specific section action, omit the suggestions block entirely.`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function demandPilotRoutes(app: FastifyInstance) {
  app.post('/chat', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const { messages, clientId, verticalId, level, filledSections = [], emptySections = [] } = parsed.data

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: { id: true, name: true },
    })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const contextParts = await buildContext(agencyId, clientId, verticalId)
    const systemPrompt = buildSystemPrompt(
      contextParts,
      filledSections,
      emptySections,
      level ?? 'Company',
    )

    // Prepend context hint to first user message
    const levelHint = verticalId
      ? `[Demand Gen Intake — Client: ${client.name} — Level: ${parsed.data.verticalName ?? 'Vertical'}]`
      : `[Demand Gen Intake — Client: ${client.name} — Level: Company]`

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

    // Extract <DEMANDPILOT_SUGGESTIONS> block
    const match = fullText.match(/<DEMANDPILOT_SUGGESTIONS>([\s\S]+?)<\/DEMANDPILOT_SUGGESTIONS>/i)
    let suggestions: unknown[] = []
    let replyText = fullText

    if (match) {
      replyText = fullText.replace(match[0], '').trim()
      try { suggestions = JSON.parse(match[1].trim()) } catch { /* malformed — return empty */ }
    } else {
      replyText = fullText.replace(/<DEMANDPILOT_SUGGESTIONS>[\s\S]*/i, '').trim()
    }

    return reply.send({ data: { reply: replyText, suggestions } })
  })
}
