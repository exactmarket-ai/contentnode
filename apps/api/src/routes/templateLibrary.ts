import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'

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

  const result = await callModel(
    {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
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
      : { agencyId, clientId }

    const templates = await prisma.promptTemplate.findMany({
      where,
      orderBy: [{ source: 'asc' }, { createdAt: 'desc' }],
    })

    return reply.send({ data: templates })
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
    const existing = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId },
    })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    // Global templates (source === 'global') are agency-wide — only admins can overwrite them
    if (!isAdmin(role) && existing.source === 'global') {
      return reply.code(403).send({ error: 'Only admins can edit global templates' })
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

    await prisma.promptTemplate.delete({ where: { id: existing.id } })
    return reply.code(204).send()
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
