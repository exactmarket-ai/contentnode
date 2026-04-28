import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { getPromptSuggestQueue } from '../lib/queues.js'

const CATEGORIES = ['general', 'content', 'seo', 'social', 'email', 'other'] as const

const SEED_TEMPLATES = [
  {
    name: 'Blog — Problem First',
    category: 'content' as const,
    description: 'Thought leadership and SEO blog that opens with the reader\'s operational reality before introducing a solution.',
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
- Active voice throughout
- No passive constructions
- Sentences under 25 words where possible
- No use of: robust, seamless, holistic, leverage, cutting-edge, paradigm, synergy
- Never open a sentence with "By partnering with..."
- Write as a peer, not a vendor

CTA at end: [PRIMARY_CTA]`,
  },
  {
    name: 'Blog — Contrarian Take',
    category: 'content' as const,
    description: 'Opinion piece that challenges conventional wisdom in the client\'s industry. Built for LinkedIn amplification and top-of-funnel awareness.',
    body: `You are a senior B2B strategist writing a contrarian opinion piece for [AGENCY_CLIENT_NAME].

Write a [WORD_COUNT] word blog post that challenges a commonly held belief in [VERTICAL/INDUSTRY].

The conventional wisdom to challenge: [CONVENTIONAL_WISDOM]
The contrarian position: [CONTRARIAN_POSITION]

Structure:
- Opening: State what everyone believes. One clear declarative sentence. Then immediately challenge it.
- Why the conventional wisdom exists: Be fair — explain why people believe this and why it made sense at some point. Do not strawman the opposing view.
- What changed: Identify the specific shift — market, technology, regulation, or buyer behavior — that makes the old belief wrong or incomplete.
- The real picture: Make the contrarian case with specifics. Use [KEY_STAT_1] and [KEY_STAT_2]. Ground it in [VERTICAL/INDUSTRY] reality.
- What this means for the reader: One concrete implication they can act on.
- Closing line: A single sentence that reframes the whole argument. Make it memorable.

Voice rules:
- Confident but not arrogant
- Direct declarative sentences
- No hedging language — no "perhaps", "might", "could"
- Active voice throughout
- No use of: disrupt, game-changer, paradigm shift, revolutionary, unprecedented
- The reader should feel smarter after reading this, not sold to

CTA at end: [PRIMARY_CTA]`,
  },
  {
    name: 'Blog — Practical Guide',
    category: 'content' as const,
    description: 'Step-by-step how-to guide written for practitioners. Built for SEO and bottom-of-funnel enablement.',
    body: `You are a senior practitioner writing a practical how-to guide for [AGENCY_CLIENT_NAME]'s audience of [TARGET_AUDIENCE] in [VERTICAL/INDUSTRY].

Write a [WORD_COUNT] word practical guide with this title: [TITLE]

The reader's goal: [READER_GOAL]
The reader's current obstacle: [CURRENT_OBSTACLE]

Structure:
- Opening: Name the goal and the obstacle in two sentences. No preamble. Get to it immediately.
- Context: One short paragraph on why this matters now. Reference [MARKET_PRESSURE] and [KEY_STAT].
- The guide (3-5 steps or sections):
  Each step has:
  * A clear action-oriented heading (verb first)
  * 2-3 sentences of explanation
  * One specific example or proof point from [VERTICAL/INDUSTRY]
  * One common mistake to avoid
- What good looks like: A short paragraph describing the outcome when this is done correctly. Reference [PROOF_POINT_OR_CASE_STUDY].
- Closing: One sentence on the first action the reader should take today.

Voice rules:
- Write for a smart practitioner, not a beginner
- Assume the reader knows their industry
- No explaining basic concepts they already know
- Specific over general at every opportunity
- Active voice throughout
- No use of: best practices, world-class, best-in-class, industry-leading, robust
- Every claim must be specific — no vague outcomes

CTA at end: [PRIMARY_CTA]`,
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

export async function promptRoutes(app: FastifyInstance) {
  // ── GET / — list prompt templates (optional ?clientId= filter) ──────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    const templates = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: clientId ?? null },
      orderBy: [{ source: 'asc' }, { isStale: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, category: true, description: true, parentId: true, clientId: true, useCount: true, source: true, isStale: true, createdAt: true, updatedAt: true, body: true },
    })
    return reply.send({ data: templates })
  })

  // ── POST /suggest — enqueue brain-powered prompt generation for a client ──
  app.post<{ Querystring: { clientId?: string } }>('/suggest', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    // Verify the client belongs to this agency
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
    const { agencyId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const template = await prisma.promptTemplate.create({
      data: { agencyId, ...parsed.data } as any,
    })
    return reply.code(201).send({ data: template })
  })

  // ── PATCH /:id — update name / body / category / description ─────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } })
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
      where: { id: req.params.id, agencyId },
      data: { useCount: { increment: 1 } },
    })
    return reply.send({ data: { ok: true } })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
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
      data: toInsert.map((t) => ({ agencyId, clientId: null, source: 'global', ...t })),
    })
    return reply.send({ data: { seeded: toInsert.length } })
  })
}
