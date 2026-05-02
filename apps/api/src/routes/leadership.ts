import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, getModelForRole } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { getThoughtLeaderSocialSyncQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const socialProfileSchema = z.object({
  platform:    z.enum(['linkedin', 'x', 'substack', 'website', 'other']),
  url:         z.string().url(),
  syncEnabled: z.boolean().default(true),
})

const memberBody = z.object({
  clientId:        z.string(),
  name:            z.string().min(1).max(200),
  role:            z.string().min(1).max(200),
  socialProfiles:  z.array(socialProfileSchema).default([]),
  headshotUrl:     z.string().url().optional().or(z.literal('')),
  bio:             z.string().max(1000).optional(),
  personalTone:    z.string().max(1000).optional(),
  signatureTopics: z.array(z.string()).default([]),
  signatureStories:z.array(z.string()).default([]),
  avoidPhrases:    z.array(z.string()).default([]),
})

const memberPatch = memberBody.partial().omit({ clientId: true }).extend({
  defaultContentPackId: z.string().nullable().optional(),
  mondayBoardId:        z.string().nullable().optional(),
  mondayColumnMapping:  z.record(z.unknown()).nullable().optional(),
  boxFolderId:          z.string().nullable().optional(),
  linkedUserId:         z.string().nullable().optional(),
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

async function getLinkedUserId(memberId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
      SELECT user_id FROM leadership_members WHERE id = ${memberId} LIMIT 1
    `
    return rows[0]?.user_id ?? null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brain seed helper — builds initial profile attachment text
// ─────────────────────────────────────────────────────────────────────────────

function buildProfileSeedText(member: {
  name: string
  role: string
  clientName: string
  bio: string | null
  personalTone: string | null
  signatureTopics: unknown
  signatureStories: unknown
  avoidPhrases: unknown
  socialProfiles: unknown
}): string {
  const topics  = Array.isArray(member.signatureTopics)  ? (member.signatureTopics  as string[]).join(', ')  : ''
  const stories = Array.isArray(member.signatureStories) ? (member.signatureStories as string[]).join(', ')  : ''
  const avoid   = Array.isArray(member.avoidPhrases)     ? (member.avoidPhrases     as string[]).join(', ')  : ''
  const profiles = Array.isArray(member.socialProfiles)
    ? (member.socialProfiles as Array<{ platform: string; url: string }>).map((p) => `${p.platform}: ${p.url}`).join(', ')
    : ''

  return [
    `THOUGHT LEADER PROFILE SEED`,
    ``,
    `Name: ${member.name}`,
    `Title: ${member.role}`,
    `Company: ${member.clientName}`,
    member.bio         ? `\nBio: ${member.bio}` : null,
    member.personalTone ? `\nVoice and tone: ${member.personalTone}` : null,
    topics             ? `\nSignature topics: ${topics}` : null,
    stories            ? `\nSignature stories and examples they reference: ${stories}` : null,
    avoid              ? `\nThings they would never say: ${avoid}` : null,
    profiles           ? `\nSocial profiles: ${profiles}` : null,
  ].filter((l) => l !== null).join('\n')
}


export async function leadershipRoutes(app: FastifyInstance) {
  // ── GET /agency-users — list agency users for the user-linking dropdown ────
  app.get('/agency-users', async (req, reply) => {
    const { agencyId } = req.auth
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; email: string; role: string }>>`
      SELECT id, name, email, role FROM users WHERE agency_id = ${agencyId} ORDER BY name ASC NULLS LAST
    `
    return reply.send({
      data: rows.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email, role: u.role })),
    })
  })

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
      linkedUserId: await getLinkedUserId(m.id),
    })))
    return reply.send({ data: withExtended })
  })

  // ── POST / — create member ─────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = memberBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const member = await prisma.leadershipMember.create({
      data: {
        agencyId,
        clientId:        parsed.data.clientId,
        name:            parsed.data.name,
        role:            parsed.data.role,
        socialProfiles:  parsed.data.socialProfiles as never,
        headshotUrl:     parsed.data.headshotUrl || null,
        bio:             parsed.data.bio ?? null,
        personalTone:    parsed.data.personalTone ?? null,
        signatureTopics: parsed.data.signatureTopics,
        signatureStories:parsed.data.signatureStories,
        avoidPhrases:    parsed.data.avoidPhrases,
      },
    })

    // Seed brain asynchronously — don't block the response
    seedOrUpdateBrainViaAttachment(agencyId, parsed.data.clientId, member.id, member).catch(() => {})

    return reply.code(201).send({ data: { ...member, linkedUserId: null } })
  })

  // ── PATCH /:id — update member ─────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.leadershipMember.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Member not found' })

    const parsed = memberPatch.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const {
      defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId, linkedUserId,
      ...coreData
    } = parsed.data

    const updated = await prisma.leadershipMember.update({
      where: { id: existing.id },
      data: {
        ...coreData,
        socialProfiles: coreData.socialProfiles !== undefined ? (coreData.socialProfiles as never) : undefined,
        headshotUrl:    coreData.headshotUrl !== undefined ? (coreData.headshotUrl || null) : undefined,
      },
    })

    // Update integration and linking fields via raw SQL
    const hasExtended = [defaultContentPackId, mondayBoardId, mondayColumnMapping, boxFolderId, linkedUserId]
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
        if (linkedUserId !== undefined) {
          await prisma.leadershipMember.update({
            where: { id: req.params.id },
            data: { userId: linkedUserId },
          })
        }
      } catch {
        // Columns not yet created — ignore
      }
    }

    // Write profile update attachment and trigger re-synthesis asynchronously
    const profileFieldsChanged = ['name', 'role', 'bio', 'personalTone', 'signatureTopics', 'signatureStories', 'avoidPhrases', 'socialProfiles']
      .some((k) => k in coreData)

    if (profileFieldsChanged) {
      seedOrUpdateBrainViaAttachment(agencyId, existing.clientId, existing.id, updated).catch(() => {})
    }

    const extended = await getMemberExtended(req.params.id)
    const linkedUserIdResult = await getLinkedUserId(req.params.id)
    return reply.send({ data: { ...updated, ...extended, linkedUserId: linkedUserIdResult } })
  })

  // ── DELETE /:id — delete member ────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.leadershipMember.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Member not found' })

    await prisma.leadershipMember.delete({ where: { id: existing.id } })
    return reply.code(204).send()
  })

  // ── GET /:id/brain — brain status + attachment counts + compiled context ────
  app.get<{ Params: { id: string } }>('/:id/brain', async (req, reply) => {
    const { agencyId } = req.auth
    const member = await prisma.leadershipMember.findFirst({
      where: { id: req.params.id, agencyId },
      select: { id: true, socialSyncLastRanAt: true },
    })
    if (!member) return reply.code(404).send({ error: 'Member not found' })

    const [brain, attachmentCounts] = await Promise.all([
      prisma.thoughtLeaderBrain.findFirst({
        where: { leadershipMemberId: req.params.id },
        select: { context: true, lastSynthesisAt: true },
      }),
      prisma.$queryRaw<Array<{ source: string; cnt: bigint }>>`
        SELECT source, COUNT(*) AS cnt
        FROM thought_leader_brain_attachments
        WHERE leadership_member_id = ${req.params.id} AND agency_id = ${agencyId}
        GROUP BY source
      `,
    ])

    const counts = attachmentCounts.map((r) => ({ source: r.source, count: Number(r.cnt) }))

    return reply.send({
      data: {
        exists:             !!brain,
        lastSynthesisAt:    brain?.lastSynthesisAt ?? null,
        context:            brain?.context ?? null,
        attachments:        counts,
        socialSyncLastRanAt: member.socialSyncLastRanAt,
      },
    })
  })

  // ── GET /:id/brain/attachments — chronological attachment feed ───────────
  app.get<{ Params: { id: string } }>('/:id/brain/attachments', async (req, reply) => {
    const { agencyId } = req.auth
    const member = await prisma.leadershipMember.findFirst({
      where: { id: req.params.id, agencyId },
      select: { id: true },
    })
    if (!member) return reply.code(404).send({ error: 'Member not found' })

    const attachments = await prisma.thoughtLeaderBrainAttachment.findMany({
      where: { leadershipMemberId: req.params.id, agencyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, source: true, content: true, metadata: true, createdAt: true },
    })

    return reply.send({ data: attachments })
  })

  // ── POST /:id/sync-now — manual social profile sync (or synthesis-only) ──
  app.post<{ Params: { id: string } }>('/:id/sync-now', async (req, reply) => {
    const { agencyId } = req.auth
    const body = req.body as { synthesizeOnly?: boolean } | null
    const synthesizeOnly = (body as { synthesizeOnly?: boolean } | null)?.synthesizeOnly === true

    const member = await prisma.leadershipMember.findFirst({
      where: { id: req.params.id, agencyId },
      select: { id: true, socialProfiles: true },
    })
    if (!member) return reply.code(404).send({ error: 'Member not found' })

    if (!synthesizeOnly) {
      const profiles = member.socialProfiles as Array<{ syncEnabled: boolean }>
      const hasSync = profiles.some((p) => p.syncEnabled)
      if (!hasSync) return reply.code(400).send({ error: 'No sync-enabled social profiles on this member' })
    }

    const queue = getThoughtLeaderSocialSyncQueue()
    await queue.add(synthesizeOnly ? 'synthesize' : 'sync-now', {
      agencyId,
      leadershipMemberId: member.id,
      ...(synthesizeOnly ? { synthesizeOnly: true } : {}),
    }, {
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 10 },
    })

    return reply.code(202).send({ data: { queued: true, synthesizeOnly } })
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

    // Use Thought Leader brain context if available, otherwise fall back to profile fields
    const brainRecord = await prisma.thoughtLeaderBrain.findFirst({
      where: { leadershipMemberId: req.params.id },
      select: { context: true },
    })

    let execContext: string
    if (brainRecord?.context) {
      execContext = `THOUGHT LEADER VOICE PROFILE:\n${brainRecord.context}`
    } else {
      execContext = [
        `Name: ${member.name}`,
        `Role: ${member.role}`,
        member.bio             ? `Bio: ${member.bio}` : null,
        member.personalTone    ? `Personal tone: ${member.personalTone}` : null,
        (member.signatureTopics as string[]).length  ? `Signature topics: ${(member.signatureTopics as string[]).join(', ')}` : null,
        (member.signatureStories as string[]).length ? `Signature stories/examples they reference: ${(member.signatureStories as string[]).join(' | ')}` : null,
        (member.avoidPhrases as string[]).length     ? `Things this person would never say: ${(member.avoidPhrases as string[]).join(', ')}` : null,
      ].filter(Boolean).join('\n')
    }

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

    const { model: researchModel } = await getModelForRole('research_synthesis')

    const result = await callModel(
      {
        provider: 'anthropic',
        model: researchModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        system_prompt: systemPrompt,
        max_tokens: 1500,
      },
      userMessage,
    )

    return reply.send({ data: { content: result.text.trim(), contentType, memberId: member.id } })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Brain seed via attachment — called from API routes (no direct worker import)
// The worker process handles synthesis; we just write the attachment here.
// ─────────────────────────────────────────────────────────────────────────────

async function seedOrUpdateBrainViaAttachment(
  agencyId: string,
  clientId: string,
  memberId: string,
  member: {
    name: string
    role: string
    bio: string | null
    personalTone: string | null
    signatureTopics: unknown
    signatureStories: unknown
    avoidPhrases: unknown
    socialProfiles: unknown
  },
): Promise<void> {
  try {
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } })
    const seedText = buildProfileSeedText({ ...member, clientName: client?.name ?? '' })

    await prisma.thoughtLeaderBrainAttachment.create({
      data: { agencyId, clientId, leadershipMemberId: memberId, source: 'profile', content: seedText },
    })
    console.log(`[leadership] brain profile attachment written for member ${memberId}`)

    // Enqueue synthesis — worker picks it up and runs synthesiseThoughtLeaderContext
    const queue = getThoughtLeaderSocialSyncQueue()
    await queue.add('synthesize', {
      agencyId,
      leadershipMemberId: memberId,
      synthesizeOnly: true,
    }, {
      removeOnComplete: { count: 10 },
      removeOnFail:     { count: 10 },
    })
  } catch (err) {
    console.error(`[leadership] brain attachment failed for member ${memberId}:`, err)
  }
}
