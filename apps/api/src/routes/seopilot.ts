/**
 * seopilot.ts — seoPILOT API routes
 *
 * GET  /api/v1/seo/sessions              — list sessions by clientId
 * POST /api/v1/seo/sessions              — create session
 * GET  /api/v1/seo/sessions/:id          — get session
 * POST /api/v1/seo/sessions/:id/messages — send message, get PILOT response
 * GET  /api/v1/seo/briefs                — list briefs by clientId
 * POST /api/v1/seo/briefs/:id/push-to-newsroom — push brief to Newsroom
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { prisma, getModelForRole } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

// ─── Allowed roles ─────────────────────────────────────────────────────────────

const SEO_ROLES = ['owner', 'strategist', 'org_admin', 'admin'] as const

// ─── Schema ────────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(20000),
})

const messagesBody = z.object({
  messages:    z.array(messageSchema).min(0).max(60),
  clientId:    z.string(),
  templateKey: z.string(),
})

// ─── Template registry ─────────────────────────────────────────────────────────

const SEO_TEMPLATES: Record<string, { name: string; goal: string; opening: string }> = {
  pillar_strategy: {
    name: 'Pillar Content Strategy',
    goal: 'Define a pillar page and cluster content around a topic you can own completely in search.',
    opening: "Let's build a pillar content strategy. Before we get into keyword clusters, I want to understand what owning a topic cluster actually needs to do right now. Owning a topic can mean generating qualified trial signups, establishing category credibility, or fighting for a specific audience segment — those require very different cluster shapes.",
  },
  competitor_gap: {
    name: 'Competitor Gap Audit',
    goal: "Find keywords competitors rank for that this client doesn't — and build a plan to close the gap.",
    opening: "Let's find the keyword opportunities competitors are capturing that you're not. Before we dig into gaps, I need to understand who we're benchmarking against. The answer changes everything — a direct product competitor tells a different story than a content-dominant player in the same space.",
  },
  product_launch: {
    name: 'Product Launch SEO',
    goal: 'Build keyword coverage across all funnel stages for an upcoming product launch.',
    opening: "We're building keyword coverage for a product launch. The most common mistake here is starting at the bottom of the funnel — targeting people who already know the product exists. The real opportunity is above that: the searches happening before someone knows they need this.",
  },
  awareness_expansion: {
    name: 'Brand Awareness Expansion',
    goal: 'Move beyond bottom-funnel into awareness-stage territory to expand total addressable search.',
    opening: "We're mapping awareness-stage keyword territory. This means the searches happening before the ICP knows a solution like this exists — problem-aware, not solution-aware. The challenge is always framing: companies want to talk about themselves, but awareness content has to talk about the problem.",
  },
  faq_domination: {
    name: 'FAQ & Question Domination',
    goal: 'Target question-based queries for featured snippets and AI-generated answer boxes.',
    opening: "Let's map the question-based queries you should own for featured snippets and AI answers. Question content works when it meets people exactly where they are — frustrated, comparing, deciding. The ICP has a very specific moment when they type a question into Google.",
  },
  geo_readiness: {
    name: 'GEO Readiness Audit',
    goal: "Improve how AI models describe and recommend this brand when answering category queries.",
    opening: "We're auditing how this brand appears in AI-generated answers — GEO, or Generative Engine Optimization. The question is whether AI chatbots like ChatGPT, Perplexity, and Claude describe and recommend the brand accurately when asked. This starts with a simple check: if someone asked \"who are the best companies in this category,\" would this client appear?",
  },
  seasonal_campaign: {
    name: 'Seasonal Campaign',
    goal: 'Capitalize on predictable seasonal search spikes and own the category during peak buying windows.',
    opening: "We're capitalizing on seasonal search patterns. Every B2B category has moments when buyers go into evaluation mode — and the searches that happen then look very different from baseline. The goal is to own the category during that window.",
  },
  new_market: {
    name: 'New Market Entry',
    goal: 'Build SEO presence for a new audience or vertical the client is entering.',
    opening: "We're building SEO presence for entry into a new audience or vertical. New market SEO usually fails because the content speaks the current ICP's language, not the new audience's. The vocabulary difference is often invisible to the team.",
  },
  thought_leadership: {
    name: 'Thought Leadership Cluster',
    goal: 'Position an executive as the go-to voice in their category through searchable, contrarian content.',
    opening: "We're positioning an executive as the go-to voice in their category. Thought leadership SEO works when it's genuinely contrarian — not \"AI is changing everything\" but a specific, searchable claim that a specific audience would seek out. The question that unlocks this: what is the one position this executive holds that would make peers in their industry uncomfortable?",
  },
}

// ─── Client context builder ────────────────────────────────────────────────────

async function buildSeoClientContext(agencyId: string, clientId: string): Promise<string[]> {
  const parts: string[] = []

  const [client, clientAttachments, framework] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: {
        name: true, industry: true, brainContext: true,
        brandProfiles: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { editedJson: true, extractedJson: true },
        },
      },
    }),
    prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.clientFramework.findFirst({
      where: { clientId, agencyId },
      orderBy: { updatedAt: 'desc' },
      select: { data: true },
    }),
  ])

  if (!client) return parts

  parts.push(`CLIENT: ${client.name}`)
  if (client.industry) parts.push(`INDUSTRY: ${client.industry}`)

  const brandProfile = client.brandProfiles[0]
  const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson
  if (brandData) {
    const b = brandData as Record<string, unknown>
    if (b.positioning ?? b.value_proposition)
      parts.push(`POSITIONING: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
    if (b.target_audience ?? b.audience)
      parts.push(`ICP / TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
    if (b.competitors ?? b.competitive_set)
      parts.push(`COMPETITIVE SET: ${JSON.stringify(b.competitors ?? b.competitive_set)}`)
    if (b.brand_voice ?? b.tone ?? b.voice)
      parts.push(`BRAND VOICE: ${JSON.stringify(b.brand_voice ?? b.tone ?? b.voice)}`)
  }

  // GTM Framework — extract SEO-relevant fields
  if (framework?.data) {
    const fw = framework.data as Record<string, unknown>
    const seoFields: Record<string, unknown> = {}
    for (const key of Object.keys(fw)) {
      const lower = key.toLowerCase()
      if (/icp|ideal.customer|target|audience|persona/.test(lower))
        seoFields[key] = fw[key]
      if (/compet|rival|alternative|player/.test(lower))
        seoFields[key] = fw[key]
      if (/position|value.prop|message|differenti/.test(lower))
        seoFields[key] = fw[key]
      if (/vertical|industry|market|segment/.test(lower))
        seoFields[key] = fw[key]
    }
    if (Object.keys(seoFields).length > 0) {
      parts.push(`\nGTM FRAMEWORK (SEO-relevant fields):\n${JSON.stringify(seoFields, null, 2).slice(0, 3000)}`)
    }
  }

  if (client.brainContext?.trim()) {
    parts.push(`\nCLIENT BRAIN:\n${client.brainContext.trim()}`)
  }

  if (clientAttachments.length > 0) {
    parts.push('\nCLIENT DOCUMENTS:')
    for (const doc of clientAttachments) {
      if (doc.summary?.trim())
        parts.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  return parts
}

// ─── System prompt builder ─────────────────────────────────────────────────────

function buildSeoPilotSystemPrompt(
  contextParts: string[],
  templateKey: string,
  clientName: string,
): string {
  const template = SEO_TEMPLATES[templateKey]
  if (!template) throw new Error(`Unknown seoPILOT template: ${templateKey}`)

  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available yet — draw on what you learn from the conversation.'

  return `You are seoPILOT — a B2B SEO strategist embedded in ContentNode.ai.

ROLE: You are a thinking partner, not an answer machine. Your job is to ask the questions that sharpen the user's SEO strategy for ${clientName}, one at a time, until they have arrived at a clear set of content priorities they believe in.

BEHAVIORAL RULES:
- One question per turn. Never stack questions.
- Always offer 2–3 paths (directions with tradeoffs). Never prescribe one answer.
- Responses: 3–5 lines of text + one question + <PATHS> block. Never walls of text.
- Never ask for information already present in the client context below.
- Surface the question the user hopes you won't ask.
- Use the client's actual ICP language, vertical, and competitive context — never generic placeholder text.
- When the user has confirmed their strategic direction, emit the <SEOPILOT_STRATEGY> block and nothing else in that same response (no <PATHS> block on the output turn).

SESSION ARC:
- Orient (turns 1–2): Understand the business goal behind this SEO initiative.
- Explore (middle turns): Surface 2–3 possible directions with explicit tradeoffs before the user commits.
- Narrow (late turns): Confirm the right direction before committing to output. The user must explicitly confirm.
- Output (final turn): Emit the <SEOPILOT_STRATEGY> block. Session ends.

CLIENT CONTEXT:
${contextBlock}

TEMPLATE: ${templateKey} — ${template.name}
TEMPLATE GOAL: ${template.goal}

PATHS FORMAT (every turn except output):
<PATHS>
["path A — 5-8 words, specific next step",
 "path B — challenge or contradiction angle",
 "path C — adjacent dimension they haven't considered"]
</PATHS>
Rules for paths:
- Each path is 5-8 words — short, direct, feels like something the user would naturally say
- Path A: most obvious next direction from this answer
- Path B: a challenge, contradiction, or "what if we're wrong" angle
- Path C: an adjacent dimension they probably haven't considered
- Never generic: "tell me more", "go deeper", "continue"

OUTPUT FORMAT (output turn only — omit <PATHS> in this response):
<SEOPILOT_STRATEGY>
{
  "templateKey": "${templateKey}",
  "summary": "2-3 sentence plain English strategy summary",
  "primaryKeyword": "the single most important keyword to rank for",
  "secondaryKeywords": ["keyword 2", "keyword 3", "..."],
  "topicClusters": [
    {
      "pillarTopic": "pillar topic name",
      "pillarKeyword": "pillar keyword phrase",
      "clusterTopics": ["supporting topic 1", "supporting topic 2", "...4-8 total"]
    }
  ],
  "contentPriorities": [
    {
      "topic": "specific content topic",
      "targetKeyword": "keyword phrase to rank for",
      "funnelStage": "awareness|consideration|decision",
      "urgency": "now|next|later",
      "paaQuestions": ["Question 1?", "Question 2?"],
      "contentFormat": "pillar page|blog post|FAQ page|landing page|etc.",
      "estimatedImpact": "high|medium|low",
      "brief": "2-3 sentence content brief explaining what to write and why"
    }
  ],
  "strategicRationale": "Why this strategy fits this specific client — cite their ICP, competitive position, and the direction confirmed in the session"
}
</SEOPILOT_STRATEGY>`
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export async function seoPilotRoutes(app: FastifyInstance) {
  const roleGuard = { preHandler: requireRole(...SEO_ROLES) }

  // ── GET /sessions ────────────────────────────────────────────────────────────
  app.get('/sessions', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as { clientId?: string }

    const sessions = await prisma.seoStrategySession.findMany({
      where: { agencyId, ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, templateKey: true, status: true,
        strategyOutput: true, createdAt: true, updatedAt: true, clientId: true,
      },
    })

    return reply.send({ data: sessions })
  })

  // ── POST /sessions ───────────────────────────────────────────────────────────
  app.post('/sessions', roleGuard, async (req, reply) => {
    const { agencyId, userId } = req.auth

    const parsed = z.object({
      clientId:    z.string(),
      templateKey: z.string(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

    const { clientId, templateKey } = parsed.data

    if (!SEO_TEMPLATES[templateKey])
      return reply.code(400).send({ error: `Unknown template: ${templateKey}` })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    let createdByDbId: string | null = null
    if (userId) {
      const dbUser = await prisma.user.findFirst({ where: { clerkUserId: userId, agencyId }, select: { id: true } })
      createdByDbId = dbUser?.id ?? null
    }

    const session = await prisma.seoStrategySession.create({
      data: {
        agencyId,
        clientId,
        templateKey,
        status: 'in_progress',
        messages: [],
        createdBy: createdByDbId,
      },
      select: { id: true, templateKey: true, status: true, createdAt: true },
    })

    return reply.code(201).send({ data: session })
  })

  // ── GET /sessions/:id ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/sessions/:id', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const session = await prisma.seoStrategySession.findFirst({
      where: { id, agencyId },
      include: {
        briefs: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, topic: true, targetKeyword: true, funnelStage: true,
            urgency: true, paaQuestions: true, contentFormat: true,
            estimatedImpact: true, brief: true, pushedToNewsroom: true,
            newsroomTopicId: true, createdAt: true,
          },
        },
      },
    })

    if (!session) return reply.code(404).send({ error: 'Session not found' })
    return reply.send({ data: session })
  })

  // ── POST /sessions/:id/messages ──────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/sessions/:id/messages', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const parsed = messagesBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

    const { messages, clientId, templateKey } = parsed.data

    if (!SEO_TEMPLATES[templateKey])
      return reply.code(400).send({ error: `Unknown template: ${templateKey}` })

    const [session, client] = await Promise.all([
      prisma.seoStrategySession.findFirst({ where: { id, agencyId }, select: { id: true, status: true } }),
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
    ])
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    if (session.status === 'complete') return reply.code(409).send({ error: 'Session already complete' })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const contextParts = await buildSeoClientContext(agencyId, clientId)
    const systemPrompt = buildSeoPilotSystemPrompt(contextParts, templateKey, client.name)

    const { model: chatModel } = await getModelForRole('generation_primary')
    const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role, content: m.content,
    }))

    const response = await anthropic.messages.create({
      model:      chatModel,
      max_tokens: 2500,
      system:     systemPrompt,
      messages:   anthropicMessages,
    })

    const fullText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Extract <SEOPILOT_STRATEGY> block
    const strategyMatch = fullText.match(/<SEOPILOT_STRATEGY>([\s\S]+?)<\/SEOPILOT_STRATEGY>/i)
    let strategyOutput: Record<string, unknown> | null = null
    let replyText = fullText

    if (strategyMatch) {
      replyText = fullText.replace(strategyMatch[0], '').trim()
      try {
        strategyOutput = JSON.parse(strategyMatch[1].trim())
      } catch {
        return reply.code(500).send({ error: 'Strategy output could not be parsed — session not saved' })
      }
    }

    // Extract <PATHS> block
    const pathsMatch = replyText.match(/<PATHS>([\s\S]+?)<\/PATHS>/i)
    let paths: string[] = []
    if (pathsMatch) {
      replyText = replyText.replace(pathsMatch[0], '').trim()
      try { paths = JSON.parse(pathsMatch[1].trim()) } catch { /* malformed */ }
    }

    const assistantMessage = { role: 'assistant' as const, content: replyText.trim() }
    const updatedMessages = [...messages, assistantMessage]

    if (strategyOutput) {
      // Session complete — save strategy, create briefs
      const priorities = (strategyOutput.contentPriorities as Array<Record<string, unknown>>) ?? []

      await prisma.$transaction(async (tx) => {
        await tx.seoStrategySession.update({
          where: { id },
          data: {
            status: 'complete',
            strategyOutput: JSON.parse(JSON.stringify(strategyOutput)),
            messages: JSON.parse(JSON.stringify(updatedMessages)),
          },
        })

        if (priorities.length > 0) {
          await tx.seoContentBrief.createMany({
            data: priorities.map((p) => ({
              agencyId,
              clientId,
              sessionId: id,
              topic:          String(p.topic ?? ''),
              targetKeyword:  String(p.targetKeyword ?? ''),
              funnelStage:    String(p.funnelStage ?? 'awareness'),
              urgency:        String(p.urgency ?? 'next'),
              paaQuestions:   Array.isArray(p.paaQuestions) ? p.paaQuestions : [],
              contentFormat:  p.contentFormat ? String(p.contentFormat) : null,
              estimatedImpact: p.estimatedImpact ? String(p.estimatedImpact) : null,
              brief:           p.brief ? String(p.brief) : null,
            })),
          })
        }
      })
    } else {
      await prisma.seoStrategySession.update({
        where: { id },
        data: { messages: JSON.parse(JSON.stringify(updatedMessages)) },
      })
    }

    return reply.send({
      data: {
        message:  replyText.trim(),
        paths,
        strategy: strategyOutput ?? undefined,
      },
    })
  })

  // ── GET /briefs ──────────────────────────────────────────────────────────────
  // ── DELETE /sessions/:id ────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/sessions/:id', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const session = await prisma.seoStrategySession.findFirst({ where: { id, agencyId } })
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    if (session.status === 'complete') return reply.code(409).send({ error: 'Cannot delete a completed session' })

    await prisma.seoStrategySession.delete({ where: { id } })
    return reply.code(204).send()
  })

  // ── GET /briefs ──────────────────────────────────────────────────────────────
  app.get('/briefs', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as { clientId?: string }

    const briefs = await prisma.seoContentBrief.findMany({
      where: { agencyId, ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: briefs })
  })

  // ── POST /briefs/:id/push-to-newsroom ────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/briefs/:id/push-to-newsroom', roleGuard, async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const brief = await prisma.seoContentBrief.findFirst({ where: { id, agencyId } })
    if (!brief) return reply.code(404).send({ error: 'Brief not found' })
    if (brief.pushedToNewsroom) return reply.code(409).send({ error: 'Already pushed to Newsroom' })

    const summary = [
      brief.brief ?? '',
      '',
      `Target keyword: ${brief.targetKeyword}`,
      `Funnel stage: ${brief.funnelStage}`,
    ].join('\n').trim()

    const topic = await prisma.topicQueue.create({
      data: {
        agencyId,
        clientId:       brief.clientId,
        title:          brief.topic,
        summary,
        score:          0,
        scoreRationale: 'Created from seoPILOT strategy',
        sources:        [],
        paaQuestions:   Array.isArray(brief.paaQuestions) ? brief.paaQuestions : [],
        sourceTag:      'seoPILOT',
        status:         'pending',
      },
      select: { id: true },
    })

    const updated = await prisma.seoContentBrief.update({
      where: { id },
      data: { pushedToNewsroom: true, newsroomTopicId: topic.id },
    })

    return reply.send({ data: updated })
  })
}
