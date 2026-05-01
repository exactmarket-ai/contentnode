import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const memberBody = z.object({
  clientId:        z.string(),
  name:            z.string().min(1).max(200),
  role:            z.string().min(1).max(200),
  linkedInUrl:     z.string().url().optional().or(z.literal('')),
  headshotUrl:     z.string().url().optional().or(z.literal('')),
  bio:             z.string().max(1000).optional(),
  personalTone:    z.string().max(1000).optional(),
  signatureTopics: z.array(z.string()).default([]),
  signatureStories:z.array(z.string()).default([]),
  avoidPhrases:    z.array(z.string()).default([]),
})

const memberPatch = memberBody.partial().omit({ clientId: true }).extend({
  // Integration / content pack fields (new columns added by migration)
  defaultContentPackId: z.string().nullable().optional(),
  mondayBoardId:        z.string().nullable().optional(),
  mondayColumnMapping:  z.record(z.unknown()).nullable().optional(),
  boxFolderId:          z.string().nullable().optional(),
})

const CONTENT_TYPES = [
  'linkedin_post',
  'linkedin_carousel',
  'linkedin_article',
  'linkedin_bio',
  'speaking_bio',
  'email_intro',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fetch extended integration fields for a leadership member
// (stored in columns added by migration — gracefully degrade if not yet applied)
// ─────────────────────────────────────────────────────────────────────────────

type MemberExtended = {
  defaultContentPackId: string | null
  mondayBoardId:        string | null
  mondayColumnMapping:  Record<string, unknown> | null
  boxFolderId:          string | null
}

async function getMemberExtended(memberId: string): Promise<MemberExtended> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      default_content_pack_id: string | null
      monday_board_id:         string | null
      monday_column_mapping:   unknown
      box_folder_id:           string | null
    }>>`
      SELECT default_content_pack_id, monday_board_id, monday_column_mapping, box_folder_id
      FROM leadership_members WHERE id = ${memberId}
    `
    const row = rows[0]
    if (!row) return emptyMemberExtended()
    return {
      defaultContentPackId: row.default_content_pack_id,
      mondayBoardId:        row.monday_board_id,
      mondayColumnMapping:  row.monday_column_mapping && typeof row.monday_column_mapping === 'object'
        ? (row.monday_column_mapping as Record<string, unknown>)
        : null,
      boxFolderId:          row.box_folder_id,
    }
  } catch {
    return emptyMemberExtended()
  }
}

function emptyMemberExtended(): MemberExtended {
  return { defaultContentPackId: null, mondayBoardId: null, mondayColumnMapping: null, boxFolderId: null }
}

export async function leadershipRoutes(app: FastifyInstance) {
  // ── GET / — list members for a client ─────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as Record<string, string>
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    const members = await prisma.leadershipMember.findMany({
      where: { agencyId, clientId },
      orderBy: { createdAt: 'asc' },
    })
    const withExtended = await Promise.all(members.map(async (m) => ({
      ...m,
      ...await getMemberExtended(m.id),
    })))
    return reply.send({ data: withExtended })
  })

  // ── POST / — create member ─────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = memberBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const member = await prisma.leadershipMember.create({
      data: {
        agencyId,
        clientId:        parsed.data.clientId,
        name:            parsed.data.name,
        role:            parsed.data.role,
        linkedInUrl:     parsed.data.linkedInUrl || null,
        headshotUrl:     parsed.data.headshotUrl || null,
        bio:             parsed.data.bio ?? null,
        personalTone:    parsed.data.personalTone ?? null,
        signatureTopics: parsed.data.signatureTopics,
        signatureStories:parsed.data.signatureStories,
        avoidPhrases:    parsed.data.avoidPhrases,
      },
    })
    return reply.code(201).send({ data: member })
  })

  // ── PATCH /:id — update member ─────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.leadershipMember.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Member not found' })

    const parsed = memberPatch.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    // Separate extended fields from Prisma-managed fields
    const {
      defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId,
      ...coreData
    } = parsed.data

    const updated = await prisma.leadershipMember.update({
      where: { id: existing.id },
      data: {
        ...coreData,
        linkedInUrl:  coreData.linkedInUrl  !== undefined ? (coreData.linkedInUrl  || null) : undefined,
        headshotUrl:  coreData.headshotUrl  !== undefined ? (coreData.headshotUrl  || null) : undefined,
      },
    })

    // Update integration fields via raw SQL
    const hasExtended = [defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId]
      .some((v) => v !== undefined)

    if (hasExtended) {
      try {
        if (defaultContentPackId !== undefined) {
          await prisma.$executeRaw`UPDATE leadership_members SET default_content_pack_id = ${defaultContentPackId} WHERE id = ${req.params.id}`
        }
        if (mondayBoardId !== undefined) {
          await prisma.$executeRaw`UPDATE leadership_members SET monday_board_id = ${mondayBoardId} WHERE id = ${req.params.id}`
        }
        if (mondayColumnMapping !== undefined) {
          await prisma.$executeRaw`UPDATE leadership_members SET monday_column_mapping = ${JSON.stringify(mondayColumnMapping)}::jsonb WHERE id = ${req.params.id}`
        }
        if (boxFolderId !== undefined) {
          await prisma.$executeRaw`UPDATE leadership_members SET box_folder_id = ${boxFolderId} WHERE id = ${req.params.id}`
        }
      } catch {
        // Columns not yet created — ignore, schema migration needed
      }
    }

    const extended = await getMemberExtended(req.params.id)
    return reply.send({ data: { ...updated, ...extended } })
  })

  // ── DELETE /:id — delete member ────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.leadershipMember.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Member not found' })

    await prisma.leadershipMember.delete({ where: { id: existing.id } })
    return reply.code(204).send()
  })

  // ── POST /:id/generate — generate content in the member's voice ────────────
  app.post<{ Params: { id: string } }>('/:id/generate', async (req, reply) => {
    const { agencyId } = req.auth
    const body = req.body as { contentType?: string; topic?: string }

    const contentType = body.contentType ?? 'linkedin_post'
    if (!CONTENT_TYPES.includes(contentType as typeof CONTENT_TYPES[number])) {
      return reply.code(400).send({ error: `contentType must be one of: ${CONTENT_TYPES.join(', ')}` })
    }

    const member = await prisma.leadershipMember.findFirst({ where: { id: req.params.id, agencyId } })
    if (!member) return reply.code(404).send({ error: 'Member not found' })

    // Pull client brain for company context
    const client = await prisma.client.findFirst({
      where: { id: member.clientId, agencyId },
      select: { name: true },
    })
    const [brandProfile, brandBuilder] = await Promise.all([
      prisma.clientBrandProfile.findFirst({ where: { clientId: member.clientId, agencyId, verticalId: null } }),
      prisma.clientBrandBuilder.findFirst({ where: { clientId: member.clientId, agencyId, verticalId: null } }),
    ])
    const brandCtx = {
      ...((brandProfile?.extractedJson ?? {}) as object),
      ...((brandBuilder?.dataJson ?? {}) as object),
    } as Record<string, unknown>

    // Build context block
    const execContext = [
      `Name: ${member.name}`,
      `Role: ${member.role}`,
      member.bio             ? `Bio: ${member.bio}` : null,
      member.personalTone    ? `Personal tone: ${member.personalTone}` : null,
      (member.signatureTopics as string[]).length  ? `Signature topics: ${(member.signatureTopics as string[]).join(', ')}` : null,
      (member.signatureStories as string[]).length ? `Signature stories/examples they reference: ${(member.signatureStories as string[]).join(' | ')}` : null,
      (member.avoidPhrases as string[]).length     ? `Things this person would never say: ${(member.avoidPhrases as string[]).join(', ')}` : null,
    ].filter(Boolean).join('\n')

    const companyContext = [
      client?.name ? `Company: ${client.name}` : null,
      brandCtx.brandVoice    ? `Company brand voice: ${brandCtx.brandVoice}` : null,
      brandCtx.keyOfferings  ? `Key offerings: ${brandCtx.keyOfferings}` : null,
      brandCtx.primaryBuyer  ? `Primary buyer: ${brandCtx.primaryBuyer}` : null,
    ].filter(Boolean).join('\n')

    const formatInstructions: Record<string, string> = {
      linkedin_post:     'Write a single LinkedIn post (150-200 words). Hook on line 1. 3 short paragraphs. End with a question or call to reflect. No hashtag spam — 2-3 max.',
      linkedin_carousel: 'Write a 7-slide LinkedIn carousel. Slide 1: bold hook title (max 10 words). Slides 2-6: one tight insight per slide (heading + 1-2 lines). Slide 7: CTA. Output each slide clearly labelled.',
      linkedin_article:  'Write an 800-1200 word LinkedIn article. Include: suggested title, intro anecdote (2-3 paragraphs), 3 insight sections with H2 headings, actionable takeaway, closing paragraph with CTA.',
      linkedin_bio:      'Write a LinkedIn "About" section (250-300 words). First 2 lines must work as a standalone hook. Include: brief journey, what they stand for, 2-3 specific achievements, CTA. First person.',
      speaking_bio:      'Write a 100-word third-person speaker bio suitable for conference programme books and event introductions.',
      email_intro:       'Write a 3-paragraph personal introduction email from this executive to a new prospective client contact. Warm, direct, not salesy.',
    }

    const systemPrompt = `You are a world-class ghostwriter specialising in executive thought leadership. You write in the executive's authentic voice — not the company's marketing voice. The content you produce is indistinguishable from something the executive wrote themselves.

Rules:
- Write entirely in the executive's voice as defined below
- Never use corporate buzzwords or generic phrases
- Never reference the company in a promotional way — mention it naturally if relevant
- No em-dash lists, no hollow openers like "In today's fast-paced world"
- Output only the finished content — no preamble, no explanation`

    const userMessage = `Executive profile:
${execContext}

Company context (for natural reference only — this is not company content):
${companyContext}

${body.topic ? `Topic / angle for this piece: ${body.topic}\n\n` : ''}Task: ${formatInstructions[contentType]}

Write it now.`

    const result = await callModel(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        api_key_ref: 'ANTHROPIC_API_KEY',
        system_prompt: systemPrompt,
        max_tokens: 1500,
      },
      userMessage,
    )

    return reply.send({ data: { content: result.text.trim(), contentType, memberId: member.id } })
  })
}
