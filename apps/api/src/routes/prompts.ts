import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { getPromptSuggestQueue } from '../lib/queues.js'

const CATEGORIES = ['general', 'content', 'seo', 'social', 'email', 'other'] as const

const SEED_TEMPLATES = [
  // ── Blog ─────────────────────────────────────────────────────────────────────
  {
    name: 'Blog — Problem First',
    category: 'content' as const,
    description: 'Thought leadership blog that opens with the reader\'s operational reality before introducing a solution.',
    body: `You are a senior B2B content strategist writing for [AGENCY_CLIENT_NAME]'s target audience of [TARGET_AUDIENCE].

Write a [WORD_COUNT] word blog post with this title: [TITLE]

Structure:
- Opening: Start with a specific operational problem the reader is living right now. No statistics in the first paragraph. No "In today's world." Lead with the situation.
- Problem depth: Explain why this problem exists and why it persists. Be specific to [VERTICAL/INDUSTRY]. Reference [KEY_STAT] to establish stakes.
- Turning point: Introduce the shift — what changes when this problem is addressed correctly.
- Solution framing: Explain [SOLUTION_APPROACH] without making it a product pitch. Write as a knowledgeable peer, not a vendor.
- Proof: Reference [CASE_STUDY_OR_EXAMPLE] in 2-3 sentences. Outcome first, then context.
- Closing: End with a single clear implication for the reader. One sentence. No call to action paragraph.

Voice rules:
- Active voice throughout. No passive constructions.
- Sentences under 25 words where possible.
- No use of: robust, seamless, holistic, leverage, cutting-edge, paradigm, synergy
- Never open a sentence with "By partnering with..."
- Write as a peer, not a vendor.

CTA at end: [PRIMARY_CTA]`,
  },
  {
    name: 'Blog — Contrarian Take',
    category: 'content' as const,
    description: 'Opinion piece that challenges conventional wisdom in the client\'s industry. Built for LinkedIn amplification.',
    body: `You are a senior B2B strategist writing a contrarian opinion piece for [AGENCY_CLIENT_NAME].

Write a [WORD_COUNT] word blog post that challenges a commonly held belief in [VERTICAL/INDUSTRY].

The conventional wisdom to challenge: [CONVENTIONAL_WISDOM]
The contrarian position: [CONTRARIAN_POSITION]

Structure:
- Opening: State what everyone believes. One clear declarative sentence. Then immediately challenge it.
- Why the conventional wisdom exists: Be fair. Explain why people believe this. Do not strawman.
- What changed: Identify the specific shift — market, technology, regulation, or buyer behavior.
- The real picture: Make the contrarian case with specifics. Use [KEY_STAT_1] and [KEY_STAT_2].
- What this means for the reader: One concrete implication they can act on.
- Closing line: A single sentence that reframes the whole argument. Make it memorable.

Voice rules:
- Confident but not arrogant. Direct declarative sentences.
- No hedging language — no "perhaps", "might", "could"
- No use of: disrupt, game-changer, paradigm shift, revolutionary, unprecedented
- The reader should feel smarter, not sold to.

CTA at end: [PRIMARY_CTA]`,
  },
  {
    name: 'Blog — Practical Guide',
    category: 'content' as const,
    description: 'Step-by-step how-to guide for practitioners. Built for SEO and bottom-of-funnel enablement.',
    body: `You are a senior practitioner writing a practical how-to guide for [AGENCY_CLIENT_NAME]'s audience of [TARGET_AUDIENCE] in [VERTICAL/INDUSTRY].

Write a [WORD_COUNT] word practical guide with this title: [TITLE]

The reader's goal: [READER_GOAL]
The reader's current obstacle: [CURRENT_OBSTACLE]

Structure:
- Opening: Name the goal and the obstacle in two sentences. No preamble.
- Context: One short paragraph on why this matters now. Reference [MARKET_PRESSURE] and [KEY_STAT].
- The guide (3-5 steps): Each step has a verb-first heading, 2-3 sentences of explanation, one example from [VERTICAL/INDUSTRY], and one common mistake to avoid.
- What good looks like: Short paragraph describing the outcome. Reference [PROOF_POINT_OR_CASE_STUDY].
- Closing: One sentence on the first action the reader should take today.

Voice rules:
- Write for a smart practitioner. Assume the reader knows their industry.
- Specific over general at every opportunity. Active voice throughout.
- No use of: best practices, world-class, best-in-class, industry-leading, robust

CTA at end: [PRIMARY_CTA]`,
  },

  // ── LinkedIn ──────────────────────────────────────────────────────────────────
  {
    name: 'LinkedIn — Thought Leadership Post',
    category: 'social' as const,
    description: 'Executive thought leadership post for a senior leader\'s personal LinkedIn feed. Not a company ad — a personal perspective.',
    body: `You are writing a LinkedIn thought leadership post for a senior executive at [AGENCY_CLIENT_NAME].

Topic: [POST_TOPIC]
The executive's core point of view: [POV_OR_LESSON]
Target audience: [TARGET_AUDIENCE]

Structure:
- Hook (line 1): Bold, specific, standalone sentence. This is what shows before "...see more". No generic openers.
- Body (3 short paragraphs): POV or lesson learned. Concrete and specific to [VERTICAL/INDUSTRY]. No corporate buzzwords.
- Closing question (1 sentence): Invites reflection or discussion without being salesy.

Length: 150-200 words total. Written in first person.

Voice rules:
- Authentic, not polished-corporate. Reads like a thoughtful person, not a brand.
- No hard sell. No "DM me to learn more" in the body.
- No use of: excited to announce, thrilled, honored, passionate, game-changer
- Short paragraphs — 2-3 lines max. White space matters on LinkedIn.`,
  },
  {
    name: 'LinkedIn — Carousel Post',
    category: 'social' as const,
    description: '7-slide LinkedIn carousel with a teaching moment or insight framework.',
    body: `You are writing a LinkedIn carousel post for [AGENCY_CLIENT_NAME].

Topic: [CAROUSEL_TOPIC]
Core teaching moment: [KEY_INSIGHT]
Target audience: [TARGET_AUDIENCE]

Produce 7 slides:
- Slide 1 (Hook): Bold title (max 10 words). Must make the reader want to swipe.
- Slides 2-6 (Content): One tight insight or step per slide. Headline + 1-2 supporting lines (max 25 words per slide). Progressive — each slide builds on the last.
- Slide 7 (CTA): What to do next. One clear action.

Voice rules:
- Educational, not promotional. The reader should learn something they didn't know.
- Short sentences. No jargon unless [VERTICAL/INDUSTRY]-specific and necessary.
- Tone matches [BRAND_VOICE].`,
  },

  // ── Email ─────────────────────────────────────────────────────────────────────
  {
    name: 'Email — Cold Outreach',
    category: 'email' as const,
    description: 'Cold outbound email to a prospective buyer. No generic openers. Specific to the target buyer and primary service.',
    body: `You are writing a cold outreach email for [AGENCY_CLIENT_NAME] targeting [TARGET_BUYER_ROLE] at [TARGET_COMPANY_TYPE] in [VERTICAL/INDUSTRY].

The primary service or offer: [PRIMARY_SERVICE_OR_OFFER]
The specific pain point this solves: [BUYER_PAIN_POINT]
One relevant proof point or outcome: [PROOF_POINT]

Output:
- Subject line: Max 8 words. Specific, not clever. No question marks.
- Preview text: Max 12 words. Continues the subject line naturally.
- Body (3 short paragraphs):
  1. Opening: Name the specific problem the buyer is likely dealing with right now. No "I hope this finds you well."
  2. Middle: What [AGENCY_CLIENT_NAME] does and why it matters for this buyer. One proof point only.
  3. Close: Soft ask. One sentence. Not a calendar link dump.
- PS line (optional): One additional proof point or social signal.

Voice rules:
- Reads like it's from a human, not a sales team. Confident but not pushy.
- No use of: reach out, touch base, synergy, quick call, pick your brain
- Under 150 words for the body.`,
  },
  {
    name: 'Email — Nurture Sequence (3-Part)',
    category: 'email' as const,
    description: '3-email sequence for new leads or post-inquiry follow-up. Each email earns the next.',
    body: `You are writing a 3-email nurture sequence for [AGENCY_CLIENT_NAME] targeting [TARGET_AUDIENCE] who have shown initial interest in [PRIMARY_SERVICE_OR_OFFER].

Buyer's biggest fear: [BUYER_FEAR]
Buyer's primary motivation: [BUYER_MOTIVATION]
One strong proof point or case reference: [PROOF_POINT]

Write all 3 emails:

Email 1 — Day 0 (Welcome + Credibility):
- Subject + preview text
- Warm, human opener. One strong credibility point. No product pitch.
- Body: 100-120 words.

Email 2 — Day 3 (Address the Fear):
- Subject + preview text
- Name the buyer's biggest fear. Reframe it as solvable. Show empathy, then evidence.
- Body: 120-150 words.

Email 3 — Day 7 (Proof + Soft CTA):
- Subject + preview text
- Social proof or case reference. Soft CTA — not a pressure close.
- Body: 100-120 words.

Voice rules: [BRAND_VOICE]. No use of: just checking in, circling back, per my last email.`,
  },
  {
    name: 'Email — Newsletter Issue',
    category: 'email' as const,
    description: 'Monthly or weekly editorial newsletter. Reads like a trusted advisor, not a company broadcast.',
    body: `You are writing one issue of [AGENCY_CLIENT_NAME]'s [FREQUENCY] email newsletter for subscribers who are [TARGET_AUDIENCE].

Newsletter theme for this issue: [ISSUE_THEME]
One useful insight, story, or how-to to feature: [MAIN_VALUE_SECTION]
Subtle service tie-in (one sentence only): [SERVICE_TIE_IN]

Output:
- Subject line + preview text
- Opener (2-3 sentences): Warm, personal. Sets up the theme. Not a company update.
- Main value section (200-250 words): Useful insight, story, or how-to. NOT a sales pitch.
- Service tie-in (1 sentence): Natural, not forced.
- CTA: Single, clear. Not multiple asks.

Avoid phrases: [AVOID_PHRASES]

Voice rules:
- Reads like it's from a trusted advisor, not a marketing department.
- No use of: exciting news, we're thrilled, don't miss out, limited time
- Conversational. First person singular preferred.`,
  },

  // ── Social ────────────────────────────────────────────────────────────────────
  {
    name: 'Social — Content Series (5 Posts)',
    category: 'social' as const,
    description: 'Themed series of 5 social posts forming a coherent narrative arc. Works across LinkedIn and Instagram.',
    body: `You are writing a 5-post social content series for [AGENCY_CLIENT_NAME] targeting [TARGET_AUDIENCE].

Series theme: [SERIES_THEME]
Campaign or content goal: [CONTENT_GOAL]
Platforms: [PLATFORMS e.g. LinkedIn, Instagram]

Write all 5 posts. Each post:
- Hook (line 1): Standalone, scroll-stopping. Specific, not vague.
- Body (max 60 words): One core idea per post. No fluff.
- Hashtags (3-5): Relevant to [VERTICAL/INDUSTRY] and [SERIES_THEME].

Posts should form a narrative arc:
- Post 1: Establish the problem or premise
- Post 2: Deepen the context
- Post 3: Introduce the shift or insight
- Post 4: Show proof or example
- Post 5: Land the conclusion or CTA

Voice rules: [BRAND_VOICE]. Short sentences. Active voice. No corporate filler.`,
  },

  // ── Strategy ──────────────────────────────────────────────────────────────────
  {
    name: 'Case Study',
    category: 'content' as const,
    description: 'Customer success story in Challenge → Solution → Result format. Outcome-led, not brochure-style.',
    body: `You are writing a case study for [AGENCY_CLIENT_NAME] about a client success in [VERTICAL/INDUSTRY].

Client background: [CLIENT_BACKGROUND]
The challenge they faced: [CHALLENGE]
The solution delivered: [SOLUTION_APPROACH]
3 quantified results: [RESULT_1], [RESULT_2], [RESULT_3]
Pull quote (or placeholder): [PULL_QUOTE]

Structure (400-600 words):
- Headline: Outcome-led. Lead with the result, not the client name.
- Client background: 2 sentences. Context only.
- The challenge: What was happening and why it mattered.
- The solution: What was done and how. Not a product spec — focus on impact.
- Results: 3 specific, quantified outcomes. Numbers first.
- Pull quote: One sentence attributed to [CLIENT_ROLE].
- CTA: [PRIMARY_CTA]

Voice rules:
- Reads as a proof asset, not a brochure.
- Active voice. Outcome before process.
- No use of: synergy, holistic, innovative, cutting-edge`,
  },
  {
    name: 'Sales One-Pager',
    category: 'other' as const,
    description: 'Single-page capability summary for sales conversations, proposals, and pitch packs.',
    body: `You are writing a sales one-pager for [AGENCY_CLIENT_NAME] targeting [TARGET_BUYER_ROLE] at [TARGET_COMPANY_TYPE].

Primary service or offer: [PRIMARY_SERVICE]
3 differentiators: [DIFFERENTIATOR_1], [DIFFERENTIATOR_2], [DIFFERENTIATOR_3]
Buyer fears to address: [BUYER_FEAR_1], [BUYER_FEAR_2]
2-3 outcome stats or proof points: [PROOF_POINTS]
Named offerings (4-6): [OFFERINGS_LIST]

Sections (punchy, print-ready):
1. Headline: Who you help + the outcome. Max 12 words.
2. The problem we solve (3 bullets): Address buyer fears directly.
3. Our approach (3 differentiators): What sets [AGENCY_CLIENT_NAME] apart.
4. Proof: 2-3 outcome stats or client archetypes.
5. Services: 4-6 named offerings, one line each.
6. CTA: [PRIMARY_CTA]

Voice rules:
- Every line earns its place. No filler.
- Designed to be sent as a PDF or printed for a meeting.
- No use of: world-class, industry-leading, best-in-class, passionate`,
  },
]

const createBody = z.object({
  name:        z.string().min(1).max(120),
  body:        z.string().min(1),
  category:    z.enum(CATEGORIES).default('general'),
  description: z.string().max(300).optional(),
  parentId:    z.string().optional(),
  clientId:    z.string().optional(),
})

const updateBody = createBody.partial()

const ADMIN_ROLES = new Set(['owner', 'admin', 'super_admin', 'org_admin'])

export async function promptRoutes(app: FastifyInstance) {
  // ── GET / — list prompt templates (optional ?clientId= filter) ──────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    const templates = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: clientId ?? null, deletedAt: null },
      orderBy: [{ source: 'asc' }, { isStale: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, category: true, description: true, parentId: true, clientId: true, useCount: true, source: true, isStale: true, createdBy: true, createdAt: true, updatedAt: true, body: true },
    })
    return reply.send({ data: templates })
  })

  // ── GET /trash — soft-deleted templates (admin only) ─────────────────────
  app.get<{ Querystring: { clientId?: string } }>('/trash', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const { clientId } = req.query
    const templates = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: clientId ?? null, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, name: true, category: true, description: true, createdBy: true, deletedAt: true, deletedBy: true, body: true },
    })
    return reply.send({ data: templates })
  })

  // ── POST /suggest — enqueue brain-powered prompt generation for a client ──
  app.post<{ Querystring: { clientId?: string } }>('/suggest', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    await getPromptSuggestQueue().add('suggest', { agencyId, clientId }, {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    })

    return reply.send({ data: { queued: true } })
  })

  // ── POST / — create a new prompt template ────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const template = await prisma.promptTemplate.create({
      data: { agencyId, createdBy: userId, ...parsed.data } as any,
    })
    return reply.code(201).send({ data: template })
  })

  // ── PATCH /:id — update name / body / category / description ─────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId, deletedAt: null } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const template = await prisma.promptTemplate.update({
      where: { id: req.params.id },
      data: parsed.data,
    })
    return reply.send({ data: template })
  })

  // ── POST /:id/use — increment use count (fire-and-forget from frontend) ──
  app.post<{ Params: { id: string } }>('/:id/use', async (req, reply) => {
    const { agencyId } = req.auth
    await prisma.promptTemplate.updateMany({
      where: { id: req.params.id, agencyId, deletedAt: null },
      data: { useCount: { increment: 1 } },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── DELETE /:id — soft delete (owner or admin) ────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId, deletedAt: null } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const isAdmin = ADMIN_ROLES.has(role)
    const isOwner = existing.createdBy !== null && existing.createdBy === userId
    if (!isAdmin && !isOwner) {
      const msg = existing.createdBy === null
        ? 'This is an agency-owned template. Only admins can delete it.'
        : 'You can only delete templates you created.'
      return reply.code(403).send({ error: msg })
    }

    await prisma.promptTemplate.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), deletedBy: userId },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /:id/restore — restore soft-deleted (admin only) ─────────────────
  app.post<{ Params: { id: string } }>('/:id/restore', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })
    await prisma.promptTemplate.update({
      where: { id: req.params.id },
      data: { deletedAt: null, deletedBy: null },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── DELETE /:id/permanent — hard delete (admin only) ─────────────────────
  app.delete<{ Params: { id: string } }>('/:id/permanent', async (req, reply) => {
    const { agencyId, role } = req.auth
    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })
    await prisma.promptTemplate.delete({ where: { id: req.params.id } })
    return reply.send({ data: { ok: true } })
  })

  // ── POST /seed — idempotent seed of starter blog templates ───────────────
  app.post('/seed', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: null, name: { in: SEED_TEMPLATES.map((t) => t.name) } },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((t) => t.name))
    const toInsert = SEED_TEMPLATES.filter((t) => !existingNames.has(t.name))

    // Upgrade any existing ones from 'user' to 'global' so they appear under the Global tab
    await prisma.promptTemplate.updateMany({
      where: { agencyId, clientId: null, name: { in: SEED_TEMPLATES.map((t) => t.name) }, source: 'user' },
      data: { source: 'global' },
    })

    if (toInsert.length === 0) {
      return reply.send({ data: { skipped: true, message: 'Blog templates already seeded' } })
    }
    await prisma.promptTemplate.createMany({
      data: toInsert.map((t) => ({ agencyId, clientId: null, source: 'global', ...t, createdBy: null })),
    })
    return reply.send({ data: { seeded: toInsert.length } })
  })
}
