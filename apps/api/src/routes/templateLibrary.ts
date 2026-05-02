import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, getModelForRole } from '@contentnode/database'
import { callModel } from '@contentnode/ai'

// ─────────────────────────────────────────────────────────────────────────────
// Pack usage helpers — gracefully degrade if content_pack_items doesn't exist
// ─────────────────────────────────────────────────────────────────────────────

async function getTemplatePackCount(templateId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM content_pack_items
      WHERE prompt_template_id = ${templateId}
    `
    return Number(rows[0]?.count ?? 0)
  } catch {
    return 0
  }
}

async function getTemplatePackRefs(templateId: string): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT cp.id, cp.name
      FROM content_pack_items cpi
      JOIN content_packs cp ON cp.id = cpi.content_pack_id
      WHERE cpi.prompt_template_id = ${templateId}
    `
    return rows
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['owner', 'admin'])

const CATEGORIES = ['Copy', 'Creative', 'Strategy', 'Marketing', 'Design', 'Business'] as const
const SOURCES    = ['user', 'ai', 'global'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isAdmin(role: string): boolean {
  return ADMIN_ROLES.has(role)
}

/** SHA-256 of a JSON-serialised object */
function hashJson(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

/**
 * Fetch the merged Brain context for a client (mirrors the GET /brand endpoint logic).
 * Returns null if neither profile nor builder exists.
 */
async function getBrainContext(clientId: string, agencyId: string): Promise<Record<string, unknown> | null> {
  const [profile, builder] = await Promise.all([
    prisma.clientBrandProfile.findFirst({
      where: { clientId, agencyId, verticalId: null },
    }),
    prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId, verticalId: null },
    }),
  ])

  if (!profile && !builder) return null

  const profileData  = (profile?.editedJson ?? profile?.extractedJson ?? {}) as Record<string, unknown>
  const builderData  = (builder?.dataJson ?? {}) as Record<string, unknown>

  // Builder takes priority over profile
  return { ...profileData, ...builderData }
}

/** Compute current Brain hash for staleness checks */
export async function computeBrainHash(clientId: string, agencyId: string): Promise<string | null> {
  const ctx = await getBrainContext(clientId, agencyId)
  if (!ctx) return null
  return hashJson(ctx)
}

/** Mark AI templates stale if the Brain has changed */
export async function markStaleIfBrainChanged(clientId: string, agencyId: string): Promise<void> {
  const currentHash = await computeBrainHash(clientId, agencyId)
  if (!currentHash) return

  await prisma.promptTemplate.updateMany({
    where: {
      clientId,
      agencyId,
      source: 'ai',
      NOT: { brainSnapshotVersion: currentHash },
    },
    data: { isStale: true },
  })
}

/** Strip client-name prefix from a template name for copy-to-global */
function stripClientPrefix(name: string): string {
  // Handles: [AI] ClientName — Name  |  [AI] ClientName: Name  |  ClientName — Name
  return name
    .replace(/^\[AI\]\s+[^—:]+[—:]\s*/, '')
    .replace(/^[^—]+—\s*/, '')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// AI template generation spec
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateSpec {
  name: string
  category: typeof CATEGORIES[number]
  description: string
  usedFields: string[]
  generationHint: string
}

const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    name: 'Homepage hero copy',
    category: 'Copy',
    description: 'Above-the-fold headline and sub-headline for the homepage',
    usedFields: ['brandVoice', 'primaryBuyer', 'signaturePhrases', 'avoidPhrases'],
    generationHint: 'Write a prompt that generates compelling homepage hero copy — a headline (max 12 words) and a sub-headline (max 25 words). The prompt must encode the brand voice, target buyer, and any must-use or must-avoid phrases.',
  },
  {
    name: 'Service page copy',
    category: 'Copy',
    description: 'Body copy for a core service or offering page',
    usedFields: ['brandVoice', 'keyOfferings', 'primaryBuyer', 'buyerFears', 'buyerMotivations'],
    generationHint: 'Write a prompt that generates a 300-400 word service page section. The prompt must address buyer fears, speak to buyer goals, and describe the offering clearly in the brand voice.',
  },
  {
    name: 'Prospecting email',
    category: 'Copy',
    description: 'Cold outbound email to a prospective buyer',
    usedFields: ['brandVoice', 'primaryBuyer', 'keyOfferings'],
    generationHint: 'Write a prompt that generates a short cold outbound email (subject line + 3 paragraphs). Must be specific to the target buyer and primary service. No generic openers.',
  },
  {
    name: 'LinkedIn ad copy',
    category: 'Copy',
    description: 'Short-form LinkedIn sponsored content copy',
    usedFields: ['primaryBuyer', 'keyOfferings'],
    generationHint: 'Write a prompt that generates LinkedIn ad copy: a hook line (max 8 words), body (max 50 words), and CTA. Optimised for the primary buyer pain point and differentiator.',
  },
  {
    name: 'Campaign concept',
    category: 'Creative',
    description: 'Overarching creative concept for a marketing campaign',
    usedFields: ['visualStyle', 'campaignThemesApproved', 'primaryBuyer'],
    generationHint: 'Write a prompt that generates a campaign concept brief: a campaign name, a big idea (2 sentences), key visual direction, and 3 content pillars. Must reflect approved visual themes and buyer profile.',
  },
  {
    name: 'Social content series',
    category: 'Creative',
    description: 'A themed series of 5 social posts',
    usedFields: ['brandVoice', 'primaryBuyer', 'campaignThemesApproved'],
    generationHint: 'Write a prompt that generates 5 social posts as a series. Each post must have a hook, body (max 60 words), and hashtags. Posts should form a coherent narrative arc.',
  },
  {
    name: 'Competitive positioning',
    category: 'Strategy',
    description: 'How this brand stands apart from its competitors',
    usedFields: ['keyOfferings', 'keyAchievements'],
    generationHint: 'Write a prompt that generates a competitive positioning statement: where the brand wins, who it is not for, and what makes it uniquely suited for its primary buyers.',
  },
  {
    name: 'ICP and buyer persona',
    category: 'Strategy',
    description: 'Ideal customer profile and detailed buyer persona',
    usedFields: ['primaryBuyer', 'buyerMotivations', 'buyerFears'],
    generationHint: 'Write a prompt that generates a detailed ICP document: demographics, firmographics, pain points, goals, objections, and how to reach them. Ground every detail in the brand context provided.',
  },
  {
    name: '90-day content calendar',
    category: 'Marketing',
    description: 'A structured 90-day content plan across channels',
    usedFields: ['keyOfferings', 'primaryBuyer', 'campaignThemesApproved'],
    generationHint: 'Write a prompt that generates a 90-day content calendar: weekly themes, content types per channel (blog, email, social), and suggested titles. Aligned to the campaign themes and buyer journey.',
  },
  {
    name: 'Brand consistency audit',
    category: 'Design',
    description: 'Checklist for auditing brand consistency across assets',
    usedFields: ['brandVoice', 'avoidPhrases', 'visualStyle'],
    generationHint: 'Write a prompt that generates a brand consistency audit checklist covering tone of voice, visual identity, and messaging rules. Flag specific things to look for and avoid.',
  },
  {
    name: 'QBR agenda and talking points',
    category: 'Business',
    description: 'Quarterly business review agenda with prepared talking points',
    usedFields: ['keyOfferings', 'keyAchievements', 'primaryBuyer'],
    generationHint: 'Write a prompt that generates a QBR agenda (5-7 agenda items) with 2-3 talking points per item. Ground the talking points in the client\'s key offerings and achievements.',
  },

  // ── Social / Thought Leadership ───────────────────────────────────────────
  {
    name: 'LinkedIn thought leadership post',
    category: 'Copy',
    description: 'Executive thought leadership post for a C-suite leader\'s personal LinkedIn feed',
    usedFields: ['brandVoice', 'signaturePhrases', 'keyAchievements', 'primaryBuyer'],
    generationHint: 'Write a prompt that generates a LinkedIn thought leadership post in the voice of a senior executive — not a company ad, but a personal perspective. Structure: bold hook (1 sentence), POV or lesson learned (3 short paragraphs), closing question that invites reflection. 150-200 words total. Uses the executive\'s authentic brand voice and any signature phrases. No corporate buzzwords, no hard sell.',
  },
  {
    name: 'LinkedIn carousel post',
    category: 'Creative',
    description: 'Multi-slide LinkedIn carousel with a teaching moment or insight framework',
    usedFields: ['brandVoice', 'keyOfferings', 'primaryBuyer', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a 7-slide LinkedIn carousel. Slide 1: bold hook or provocative title (max 10 words). Slides 2-6: one tight insight or step per slide (headline + 1-2 supporting lines, max 25 words). Slide 7: CTA slide with what to do next. Topic should be directly educational for the primary buyer. Tone matches brand voice.',
  },
  {
    name: 'LinkedIn long-form article',
    category: 'Marketing',
    description: '800-1200 word authored article for LinkedIn Publishing',
    usedFields: ['brandVoice', 'keyOfferings', 'primaryBuyer', 'buyerMotivations', 'keyAchievements'],
    generationHint: 'Write a prompt that generates an 800-1200 word LinkedIn article for a senior executive. Structure: compelling headline with a keyword angle, personal anecdote opener (2-3 paragraphs), 3 key insights with real examples, actionable takeaway section, conversational conclusion with call to connect. Voice is authoritative but human — no filler phrases. Provide a suggested headline.',
  },
  {
    name: 'Executive LinkedIn "About" bio',
    category: 'Business',
    description: 'LinkedIn profile "About" section for a C-suite executive or founder',
    usedFields: ['brandVoice', 'keyAchievements', 'primaryBuyer', 'keyOfferings', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a LinkedIn "About" section for a senior executive (250-300 words). Opening 2 lines must work as a standalone hook (visible before "...more"). Then: a brief professional journey paragraph, a "what I stand for" statement, 3 specific achievements with numbers where possible, and a clear CTA (DM / connect / visit). Written in first person. Authentic, not salesy.',
  },

  // ── Email Marketing ───────────────────────────────────────────────────────
  {
    name: 'Email newsletter',
    category: 'Marketing',
    description: 'Monthly or weekly editorial newsletter for a subscriber list',
    usedFields: ['brandVoice', 'primaryBuyer', 'keyOfferings', 'signaturePhrases', 'avoidPhrases'],
    generationHint: 'Write a prompt that generates one email newsletter issue (400-500 words). Required sections: subject line + preview text, warm personal opener (2-3 sentences), main value section (a useful insight, story, or how-to — not a sales pitch), subtle service tie-in (1 sentence), and a single CTA. Brand voice throughout. No avoid phrases. Reads like it\'s from a trusted advisor, not a company.',
  },
  {
    name: 'Email nurture sequence',
    category: 'Marketing',
    description: '3-email sequence for new leads or post-inquiry follow-up',
    usedFields: ['brandVoice', 'primaryBuyer', 'keyOfferings', 'buyerFears', 'buyerMotivations'],
    generationHint: 'Write a prompt that generates a 3-email nurture sequence. Email 1 (Day 0): welcome + one credibility-building point. Email 2 (Day 3): address the buyer\'s biggest fear and reframe it as solvable. Email 3 (Day 7): social proof or case reference + soft CTA. Each email needs: subject line, preview text, and body (150-200 words). No pressure. Brand voice.',
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    name: 'Blog post',
    category: 'Marketing',
    description: 'SEO-optimised blog post for the awareness or consideration stage',
    usedFields: ['brandVoice', 'primaryBuyer', 'keyOfferings', 'buyerMotivations', 'avoidPhrases'],
    generationHint: 'Write a prompt that generates an 800-1000 word SEO blog post. Output: suggested title (contains a clear keyword phrase), meta description (max 155 chars), intro paragraph, 3-4 H2 sections with practical content, and a conclusion with a subtle CTA. Targeted at the primary buyer\'s top-of-funnel questions. Brand voice. No filler openers like "In today\'s fast-paced world".',
  },
  {
    name: 'Case study',
    category: 'Copy',
    description: 'Customer success story in Challenge → Solution → Result format',
    usedFields: ['keyOfferings', 'keyAchievements', 'primaryBuyer'],
    generationHint: 'Write a prompt that generates a case study (400-600 words). Structure: outcome-led headline (lead with the result), client background (2 sentences, fictional if needed), the challenge they faced, the solution delivered (what + how), 3 quantified results, a pull quote (placeholder format), and a closing CTA. Reads as a proof asset, not a brochure.',
  },
  {
    name: 'Video script',
    category: 'Creative',
    description: '60-90 second explainer or brand video script',
    usedFields: ['brandVoice', 'primaryBuyer', 'keyOfferings', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a 60-90 second video script (~150-200 spoken words). Format with timed sections: [HOOK 0-10s], [PROBLEM 10-25s], [SOLUTION 25-50s], [PROOF 50-70s], [CTA 70-90s]. Include optional B-roll direction in brackets after each section. Brand voice. Ends with a memorable line using a signature phrase if available.',
  },
  {
    name: 'Podcast episode talking points',
    category: 'Creative',
    description: 'Episode brief and talking points for a podcast guest appearance or hosted show',
    usedFields: ['brandVoice', 'keyAchievements', 'keyOfferings', 'primaryBuyer', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a podcast episode brief: a compelling episode title, a 3-sentence host/guest introduction, 5 talking points (each with one supporting sub-point or story hook), 3 concrete examples or case references to weave in, and a memorable closing statement. Conversational and authentic — not a slide deck read aloud.',
  },

  // ── Sales Enablement ──────────────────────────────────────────────────────
  {
    name: 'Sales one-pager',
    category: 'Business',
    description: 'Single-page capability summary for sales conversations and proposal packs',
    usedFields: ['keyOfferings', 'primaryBuyer', 'buyerFears', 'keyAchievements', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a sales one-pager. Sections: headline (who we help + the outcome), the problem we solve (3 bullets addressing buyer fears), our approach (3 differentiators), proof section (2-3 outcome stats or client archetypes), services snapshot (4-6 named offerings, one line each), and a contact CTA. Punchy. Designed to be printed or sent as a PDF attachment.',
  },

  // ── Events / PR ───────────────────────────────────────────────────────────
  {
    name: 'Press release',
    category: 'Business',
    description: 'News announcement in standard AP-style press release format',
    usedFields: ['keyAchievements', 'keyOfferings', 'primaryBuyer'],
    generationHint: 'Write a prompt that generates a press release (~400-500 words). Include: headline, sub-headline, dateline, lede paragraph covering who/what/when/where/why, a context paragraph, an executive quote (placeholder format), a supporting data or milestone paragraph, boilerplate "About" section (3 sentences), and ### end marker with media contact placeholder. AP-style, formal.',
  },
  {
    name: 'Webinar promotion copy',
    category: 'Marketing',
    description: 'Registration page copy and social teasers for a webinar or live event',
    usedFields: ['primaryBuyer', 'keyOfferings', 'buyerMotivations', 'brandVoice'],
    generationHint: 'Write a prompt that generates webinar promotion copy. Output: registration page headline + sub-headline, 3 outcome-focused benefit bullets (what attendees will walk away with), 50-word speaker intro blurb, registration button CTA text (5-8 words), and 2 social teaser posts — one LinkedIn (100 words) and one short-form (50 words). Creates urgency without being pushy.',
  },
  {
    name: 'Conference speaking proposal',
    category: 'Business',
    description: 'Abstract and speaker bio for conference or summit CFP submissions',
    usedFields: ['keyAchievements', 'keyOfferings', 'primaryBuyer', 'brandVoice', 'signaturePhrases'],
    generationHint: 'Write a prompt that generates a conference speaking proposal. Output: session title (outcome-focused, 8-12 words), 3 suggested session formats (keynote / panel / workshop) with a one-line rationale each, a 200-word session abstract (problem + key takeaways as 3 bullets + why this speaker), and a 100-word third-person speaker bio. Professional and compelling — written to win a slot.',
  },
]

async function generateOneTemplate(
  spec: TemplateSpec,
  clientName: string,
  brainCtx: Record<string, unknown>,
  agencyId: string,
): Promise<string> {
  const contextLines = spec.usedFields
    .map((f) => {
      const val = brainCtx[f]
      if (!val) return null
      const display = Array.isArray(val) ? val.join(', ') : String(val)
      return `${f}: ${display}`
    })
    .filter(Boolean)
    .join('\n')

  const systemPrompt = `You are an expert marketing prompt engineer. Your job is to write a single, ready-to-use AI prompt for a specific content task. The prompt you write will later be run by a team member to generate actual marketing content for this client.

Rules for the prompt you write:
- Fully populated — no placeholder tokens like [BRAND VOICE] or [INSERT X]. Replace every variable with the actual value from the brand context.
- Self-contained — someone can paste it into any AI tool and get usable output immediately
- Specific to this client — not generic boilerplate
- 150-300 words
- Written in second person ("You are a...", "Write a...")
- No preamble, no explanation — just the prompt itself`

  const userMessage = `Client: ${clientName}

Brand context for this template:
${contextLines || 'No specific brand context available — use generic best practices.'}

Task: ${spec.generationHint}

Write the prompt now.`

  const templateGenModel = await getModelForRole('generation_fast')
  const result = await callModel(
    {
      provider: 'anthropic',
      model: templateGenModel,
      api_key_ref: 'ANTHROPIC_API_KEY',
      system_prompt: systemPrompt,
      max_tokens: 600,
    },
    userMessage,
  )

  return result.text.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function templateLibraryRoutes(app: FastifyInstance) {
  // ── GET / — list templates ────────────────────────────────────────────────
  // ?clientId=:id  → client library
  // ?global=true   → Global Library (clientId IS NULL)
  app.get('/', async (req, reply) => {
    const { agencyId, role } = req.auth
    const q = req.query as Record<string, string>
    const clientId = q.clientId ?? null
    const isGlobal = q.global === 'true'

    if (!clientId && !isGlobal) {
      return reply.code(400).send({ error: 'Provide clientId or global=true' })
    }

    // Team members can only see clients they have access to — enforce via agencyId scope
    const where = isGlobal
      ? { agencyId, clientId: null }
      : { agencyId, clientId, isHidden: false }

    const templates = await prisma.promptTemplate.findMany({
      where: { ...where, deletedAt: null },
      orderBy: [{ source: 'asc' }, { createdAt: 'desc' }],
    })

    // Attach pack usage counts (graceful — returns 0 if table not yet migrated)
    const templatesWithPacks = await Promise.all(
      templates.map(async (t) => {
        const [packUsageCount, packs] = await Promise.all([
          getTemplatePackCount(t.id),
          getTemplatePackRefs(t.id),
        ])
        return { ...t, packUsageCount, packNames: packs.map((p) => p.name) }
      })
    )

    return reply.send({ data: templatesWithPacks })
  })

  // ── POST / — create template ──────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    const body = req.body as Record<string, unknown>

    const parsed = z.object({
      clientId:    z.string().nullable().optional(),
      name:        z.string().min(1).max(200),
      body:        z.string().min(1),
      category:    z.string().default('Business'),
      description: z.string().max(300).optional(),
      source:      z.enum(['user', 'ai', 'global']).default('user'),
    }).safeParse(body)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    const data = parsed.data

    // Only admins can create global templates
    if (data.source === 'global' && !isAdmin(role)) {
      return reply.code(403).send({ error: 'Only admins can create global templates' })
    }

    const duplicate = await prisma.promptTemplate.findFirst({
      where: { agencyId, clientId: data.clientId ?? null, name: data.name, deletedAt: null },
      select: { id: true },
    })
    if (duplicate) return reply.code(409).send({ error: 'A template with this name already exists' })

    const template = await prisma.promptTemplate.create({
      data: {
        agencyId,
        clientId:  data.clientId ?? null,
        name:      data.name,
        body:      data.body,
        category:  data.category,
        description: data.description ?? null,
        source:    data.source,
        createdBy: userId,
      },
    })

    return reply.code(201).send({ data: template })
  })

  // ── PATCH /:id — update template ──────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    const q = req.query as Record<string, string>

    const existing = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    // Global templates (source === 'global') are agency-wide — only admins can overwrite them
    if (!isAdmin(role) && existing.source === 'global') {
      return reply.code(403).send({ error: 'Only admins can edit global templates' })
    }

    // Warn before editing a template that lives in content packs
    if (q.confirmPackUpdate !== 'true') {
      const packCount = await getTemplatePackCount(existing.id)
      if (packCount > 0) {
        const packs = await getTemplatePackRefs(existing.id)
        return reply.code(409).send({
          error: 'pack_warning',
          packUsageCount: packCount,
          packs,
        })
      }
    }

    const body = req.body as Record<string, unknown>
    const parsed = z.object({
      name:        z.string().min(1).max(200).optional(),
      body:        z.string().min(1).optional(),
      category:    z.string().optional(),
      description: z.string().max(300).nullable().optional(),
    }).safeParse(body)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const updated = await prisma.promptTemplate.update({
      where: { id: existing.id },
      data: { ...parsed.data },
    })

    return reply.send({ data: updated })
  })

  // ── DELETE /:id — delete template ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, role } = req.auth
    const existing = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    // Team members cannot delete AI or global templates
    if (!isAdmin(role) && (existing.source === 'ai' || existing.source === 'global')) {
      return reply.code(403).send({ error: 'Only admins can delete AI or global templates' })
    }

    // Block delete if the template is referenced by any content pack
    const packCount = await getTemplatePackCount(existing.id)
    if (packCount > 0) {
      const packs = await getTemplatePackRefs(existing.id)
      return reply.code(409).send({ error: 'in_use', packUsageCount: packCount, packs })
    }

    await prisma.promptTemplate.delete({ where: { id: existing.id } })
    return reply.code(204).send()
  })

  // ── POST /:id/replace-in-packs — swap all pack references to a new template ─
  app.post<{ Params: { id: string } }>('/:id/replace-in-packs', async (req, reply) => {
    const { agencyId } = req.auth
    const body = req.body as { newTemplateId?: string }

    if (!body.newTemplateId) {
      return reply.code(400).send({ error: 'newTemplateId is required' })
    }

    // Verify both templates belong to this agency
    const [oldTpl, newTpl] = await Promise.all([
      prisma.promptTemplate.findFirst({ where: { id: req.params.id, agencyId } }),
      prisma.promptTemplate.findFirst({ where: { id: body.newTemplateId, agencyId } }),
    ])
    if (!oldTpl) return reply.code(404).send({ error: 'Source template not found' })
    if (!newTpl) return reply.code(404).send({ error: 'Replacement template not found' })

    try {
      await prisma.$executeRaw`
        UPDATE content_pack_items
        SET prompt_template_id = ${body.newTemplateId}
        WHERE prompt_template_id = ${req.params.id}
      `
    } catch {
      // Table doesn't exist yet — nothing to update
    }

    return reply.send({ ok: true })
  })

  // ── POST /:id/use — increment use count ────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/use', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })
    await prisma.promptTemplate.update({
      where: { id: existing.id },
      data: { useCount: { increment: 1 } },
    })
    return reply.code(204).send()
  })

  // ── POST /:id/copy-to-global — copy client template to Global Library ─────
  app.post<{ Params: { id: string } }>('/:id/copy-to-global', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const body = req.body as { name?: string }

    const source = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId },
    })
    if (!source) return reply.code(404).send({ error: 'Template not found' })
    if (!source.clientId) return reply.code(400).send({ error: 'Template is already global' })

    const globalName = (body.name ?? stripClientPrefix(source.name)).trim()
    if (!globalName) return reply.code(400).send({ error: 'name is required' })

    // Collision check
    const collision = await prisma.promptTemplate.findFirst({
      where: { agencyId, clientId: null, name: globalName },
    })
    if (collision) return reply.code(409).send({ error: 'A global template with this name already exists' })

    const globalTemplate = await prisma.promptTemplate.create({
      data: {
        agencyId,
        clientId:    null,
        name:        globalName,
        body:        source.body,
        category:    source.category,
        description: source.description,
        source:      'global',
        parentId:    source.id,
        createdBy:   userId,
      },
    })

    return reply.code(201).send({ data: globalTemplate })
  })

  // ── POST /push-to-client — push global template down to a client ──────────
  app.post('/push-to-client', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const body = req.body as { templateId?: string; clientId?: string }

    if (!body.templateId || !body.clientId) {
      return reply.code(400).send({ error: 'templateId and clientId are required' })
    }

    const globalTemplate = await prisma.promptTemplate.findFirst({
      where: { id: body.templateId, agencyId, clientId: null, source: 'global' },
    })
    if (!globalTemplate) return reply.code(404).send({ error: 'Global template not found' })

    // Verify target client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: body.clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Collision check
    const collision = await prisma.promptTemplate.findFirst({
      where: { agencyId, clientId: body.clientId, name: globalTemplate.name },
    })
    if (collision) return reply.code(409).send({ error: 'A template with this name already exists for this client' })

    const pushed = await prisma.promptTemplate.create({
      data: {
        agencyId,
        clientId:    body.clientId,
        name:        globalTemplate.name,
        body:        globalTemplate.body,
        category:    globalTemplate.category,
        description: globalTemplate.description,
        source:      'global',
        parentId:    globalTemplate.id,
        createdBy:   userId,
      },
    })

    return reply.code(201).send({ data: pushed })
  })

  // ── POST /suggested-name — preview the stripped name before copy-to-global ─
  app.post('/suggested-name', async (req, reply) => {
    const body = req.body as { name?: string }
    if (!body.name) return reply.code(400).send({ error: 'name is required' })
    return reply.send({ data: { suggestedName: stripClientPrefix(body.name) } })
  })

  // ── POST /generate — generate AI templates from Client Brain ──────────────
  app.post('/generate', async (req, reply) => {
    const { agencyId, userId, role } = req.auth
    const body = req.body as { clientId?: string }

    if (!body.clientId) return reply.code(400).send({ error: 'clientId is required' })

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, agencyId },
      select: { id: true, name: true },
    })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Fetch brain context
    const brainCtx = await getBrainContext(client.id, agencyId)
    if (!brainCtx) {
      return reply.code(422).send({
        error: 'No Brain data found for this client. Add a Brand Profile or Company Profile first.',
      })
    }

    const snapshotVersion = hashJson(brainCtx)

    // Generate all templates in parallel (batched to avoid rate limits)
    const BATCH_SIZE = 3
    const generated: Array<{ name: string; category: string; description: string; body: string }> = []

    for (let i = 0; i < TEMPLATE_SPECS.length; i += BATCH_SIZE) {
      const batch = TEMPLATE_SPECS.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((spec) => generateOneTemplate(spec, client.name, brainCtx, agencyId))
      )
      for (let j = 0; j < batch.length; j++) {
        const spec = batch[j]
        const result = results[j]
        const body = result.status === 'fulfilled'
          ? result.value
          : `You are a content expert specialising in ${spec.category.toLowerCase()} for ${client.name}. Write ${spec.description.toLowerCase()}.`
        generated.push({ name: `[AI] ${client.name} — ${spec.name}`, category: spec.category, description: spec.description, body })
      }
    }

    // Delete existing AI templates for this client before inserting fresh ones.
    // This makes the endpoint idempotent — repeated calls never accumulate duplicates.
    await prisma.promptTemplate.deleteMany({
      where: { agencyId, clientId: client.id, source: 'ai' },
    })

    // Write all to DB
    const records = await Promise.all(
      generated.map((t) =>
        prisma.promptTemplate.create({
          data: {
            agencyId,
            clientId:            client.id,
            name:                t.name,
            body:                t.body,
            category:            t.category,
            description:         t.description,
            source:              'ai',
            brainSnapshotVersion: snapshotVersion,
            isStale:             false,
            createdBy:           'system',
          },
        })
      )
    )

    return reply.code(201).send({ data: records, meta: { count: records.length, snapshotVersion } })
  })
}
