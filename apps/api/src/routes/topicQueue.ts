import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'

// ── Preference profile helper (mirrors scheduledResearch.ts logic) ─────────────

async function updateTopicPreferenceProfile(
  agencyId: string,
  clientId: string,
  verticalId: string | null,
): Promise<void> {
  const count = await prisma.topicPreferenceLog.count({
    where: { agencyId, clientId, ...(verticalId ? { verticalId } : {}) },
  })
  if (count === 0 || count % 10 !== 0) return

  const recent = await prisma.topicPreferenceLog.findMany({
    where: { agencyId, clientId, ...(verticalId ? { verticalId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { title: true, summary: true, score: true, decision: true },
  })

  const existing = await prisma.clientBrainAttachment.findFirst({
    where: { agencyId, clientId, source: 'scheduled', filename: `[Preference] topic_preference_profile:${verticalId ?? 'all'}` },
    select: { extractedText: true },
  })
  const currentProfile = existing?.extractedText ?? ''

  const decisionLog = recent.map((d) =>
    `- Title: ${d.title}\n  Summary: ${d.summary}\n  Score: ${d.score}\n  Decision: ${d.decision}`,
  ).join('\n\n')

  const result = await callModel(
    { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', temperature: 0.3, max_tokens: 1000 },
    `You maintain a topic preference profile for a content team.\nReview their recent selections and update the profile.\n\nCURRENT PROFILE:\n${currentProfile || '(none — this is the first update)'}\n\nRECENT DECISIONS (last 10):\n${decisionLog}\n\nWrite an updated preference profile in plain English. Cover:\n- Topic angles they consistently approve\n- Topic angles they consistently reject\n- Tone or framing preferences visible in approvals\n- Patterns in the sources or publications they favor\n- A diversity note: flag if approvals are becoming too narrow\n\nKeep it under 200 words. Be specific. Use their actual topic titles as examples where relevant.\nReturn the profile text only. No preamble.`,
  )

  const profileText = result.text.trim()
  const profileLabel = `[Preference] topic_preference_profile:${verticalId ?? 'all'}`

  if (existing) {
    await prisma.clientBrainAttachment.updateMany({
      where: { agencyId, clientId, source: 'scheduled', filename: profileLabel },
      data: { extractedText: profileText, summary: profileText.slice(0, 3000), summaryStatus: 'ready', extractionStatus: 'ready' },
    })
  } else {
    await prisma.clientBrainAttachment.create({
      data: {
        agencyId, clientId,
        ...(verticalId ? { verticalId } : {}),
        filename: profileLabel, mimeType: 'text/plain', source: 'scheduled',
        uploadMethod: 'url', extractionStatus: 'ready',
        extractedText: profileText, summaryStatus: 'ready', summary: profileText.slice(0, 3000),
      },
    })
  }

  // Brain re-synthesis happens on the next research run (writeToBrain → synthesiseClientContext)
  console.log(`[topic-queue] preference profile updated for client ${clientId} (${count} decisions)`)
}

// ─────────────────────────────────────────────────────────────────────────────

export async function topicQueueRoutes(app: FastifyInstance) {

  // ── GET /api/v1/topic-queue/:clientId ───────────────────────────────────────

  app.get<{ Params: { clientId: string }; Querystring: { verticalId?: string } }>(
    '/:clientId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId } = req.params
      const { verticalId } = req.query

      const topics = await prisma.topicQueue.findMany({
        where: {
          agencyId,
          clientId,
          status: 'pending',
          ...(verticalId ? { verticalId } : {}),
        },
        orderBy: { score: 'desc' },
        include: { vertical: { select: { id: true, name: true } } },
      })

      const prefCount = await prisma.topicPreferenceLog.count({ where: { agencyId, clientId } })
      const verticals = await prisma.topicPreferenceLog.findMany({
        where: { agencyId, clientId },
        distinct: ['verticalId'],
        select: { verticalId: true },
      })

      return reply.send({
        data: topics,
        meta: {
          totalDecisions: prefCount,
          verticalCount: verticals.length,
          hasPreferenceProfile: prefCount > 0,
        },
      })
    },
  )

  // ── PATCH /api/v1/topic-queue/:id/status ────────────────────────────────────

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/:id/status',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { id } = req.params
      const parsed = z.object({ status: z.enum(['approved', 'rejected']) }).safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

      const topic = await prisma.topicQueue.findFirst({ where: { id, agencyId } })
      if (!topic) return reply.code(404).send({ error: 'Topic not found' })

      const updated = await prisma.topicQueue.update({
        where: { id },
        data: { status: parsed.data.status, reviewedAt: new Date() },
      })

      await prisma.topicPreferenceLog.create({
        data: {
          agencyId,
          clientId: topic.clientId,
          verticalId: topic.verticalId,
          topicQueueId: id,
          decision: parsed.data.status,
          title: topic.title,
          summary: topic.summary,
          score: topic.score,
        },
      })

      // Fire-and-forget — updates on every 10th decision
      updateTopicPreferenceProfile(agencyId, topic.clientId, topic.verticalId).catch((err) =>
        console.error('[topic-queue] preference update failed:', err),
      )

      return reply.send({ data: updated })
    },
  )

  // ── POST /api/v1/topic-queue/generate ───────────────────────────────────────

  app.post<{ Body: unknown }>(
    '/generate',
    async (req, reply) => {
      const { agencyId } = req.auth
      const parsed = z.object({ topicIds: z.array(z.string()).min(1) }).safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

      const { topicIds } = parsed.data

      const topics = await prisma.topicQueue.findMany({
        where: { id: { in: topicIds }, agencyId, status: 'approved' },
        include: { vertical: { select: { id: true, name: true } } },
      })
      if (topics.length === 0) return reply.code(400).send({ error: 'No approved topics found' })

      const workflowRunIds: string[] = []

      for (const topic of topics) {
        try {
          const clientId = topic.clientId

          const [client, brandBuilder] = await Promise.all([
            prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true, brainContext: true } }),
            prisma.clientBrandBuilder.findFirst({
              where: { clientId, agencyId },
              orderBy: { updatedAt: 'desc' },
              select: { dataJson: true },
            }),
          ])

          const brandData   = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
          const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')
          const clientName  = client?.name ?? ''
          const brainCtx    = client?.brainContext ?? ''

          const sources = (topic.sources as Array<{ title: string; publication: string; url: string; publish_date: string }>) ?? []
          const sourceBlock = sources.map((s, i) =>
            `${i + 1}. ${s.title} — ${s.publication} (${s.publish_date})\n   ${s.url}`,
          ).join('\n')

          const systemPrompt = `You are a content strategist and expert B2B blog writer${clientName ? ` for ${clientName}` : ''}.
Write ONE publication-ready blog post on the given topic.
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}
${brainCtx ? `\nClient context:\n${brainCtx.slice(0, 3000)}` : ''}

Blog requirements:
- Title: use the exact approved title unless you have a compelling reason to refine it slightly
- 700–950 words, structured with a strong intro, 3–4 H2 sections, concise conclusion
- Cite each provided source at least once using [source: domain.com]
- End with a ## Sources section listing the actual URLs

Also write:
- LinkedIn post (150–200 words): punchy hook, 3 key takeaways as short bullets, CTA
- Image prompt: professional blog header image description

Use EXACTLY this format with these delimiter lines:
%%TITLE%%
[title here]
%%SLUG%%
[url-friendly-slug]
%%EXCERPT%%
[2-sentence teaser]
%%CONTENT%%
[full markdown blog content]
%%LINKEDIN%%
[linkedin post text]
%%IMAGE_PROMPT%%
[image generation prompt]
%%SOURCES%%
[one URL per line]`

          const result = await callModel(
            { provider: 'anthropic', model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', temperature: 0.65, max_tokens: 8192, system_prompt: systemPrompt },
            `Approved topic: ${topic.title}\n\nAngle summary: ${topic.summary}\n\nSource material:\n${sourceBlock}\n\nWrite the blog post now.`,
          )

          const get = (key: string, nextKey: string) => {
            const re = new RegExp(`%%${key}%%\\s*([\\s\\S]*?)\\s*(?=%%${nextKey}%%|$)`)
            return result.text.match(re)?.[1]?.trim() ?? ''
          }
          const title       = get('TITLE', 'SLUG') || topic.title
          const slug        = get('SLUG', 'EXCERPT') || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          const excerpt     = get('EXCERPT', 'CONTENT')
          const content     = get('CONTENT', 'LINKEDIN')
          const linkedIn    = get('LINKEDIN', 'IMAGE_PROMPT')
          const imagePrompt = get('IMAGE_PROMPT', 'SOURCES')
          const sourcesRaw  = get('SOURCES', 'END_NEVER_MATCHES')
          const sourceUrls  = sourcesRaw.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('http'))

          let workflow = await prisma.workflow.findFirst({
            where: { agencyId, clientId, name: 'Content Hub' },
            select: { id: true, defaultAssigneeId: true },
          })
          if (!workflow) {
            workflow = await prisma.workflow.create({
              data: { agencyId, clientId, name: 'Content Hub', connectivityMode: 'online' },
              select: { id: true, defaultAssigneeId: true },
            })
          }

          const run = await prisma.workflowRun.create({
            data: {
              agencyId,
              workflowId: workflow.id,
              status: 'completed',
              reviewStatus: 'none',
              itemName: title,
              output: {
                generatedContent: true,
                topicQueueId: topic.id,
                sourceLabel: topic.title,
                autoGenerated: true,
                blogs: [{ title, slug, excerpt, content, sources: sourceUrls, linkedIn: { post: linkedIn, imagePrompt } }],
              },
              ...(workflow.defaultAssigneeId ? { assigneeId: workflow.defaultAssigneeId } : {}),
            },
          })

          workflowRunIds.push(run.id)
        } catch (err) {
          console.error(`[topic-queue/generate] topic ${topic.id} generation failed:`, err)
        }
      }

      return reply.send({ data: { queued: workflowRunIds.length, workflowRunIds } })
    },
  )
}
