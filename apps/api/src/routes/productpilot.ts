/**
 * productpilot.ts
 *
 * POST /api/v1/productpilot/chat
 * POST /api/v1/productpilot/save-synthesis
 *
 * productPILOT — AI Product Marketing strategist.
 * Guides users through PM skill frameworks using multi-directional questioning.
 * Context: Client Brain → Vertical Brain → Agency Brain → Built-in PM expertise.
 * Synthesis stored as ClientBrainAttachment when user saves.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma, getModelForRole } from '@contentnode/database'
import { findSkill, PRODUCT_MARKETING_SKILLS } from '../skills/productMarketing.js'

// ─── Schema ───────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(20000),
})

const chatBody = z.object({
  messages:    z.array(messageSchema).min(1).max(60),
  clientId:    z.string(),
  categoryKey: z.string(),
  skillKey:    z.string(),
  templateId:  z.string().optional(),
  verticalId:  z.string().optional(),
})

const saveSynthesisBody = z.object({
  clientId:    z.string(),
  categoryKey: z.string(),
  skillKey:    z.string(),
  synthesis:   z.string().min(1).max(50000),
})

const saveTemplateBody = z.object({
  skillKey:    z.string(),
  categoryKey: z.string(),
  name:        z.string().min(1).max(120),
  messages:    z.array(messageSchema).min(1).max(60),
})

// ─── Context assembler ────────────────────────────────────────────────────────

async function buildClientContext(agencyId: string, clientId: string, verticalId?: string): Promise<string[]> {
  const parts: string[] = []

  const [client, clientAttachments] = await Promise.all([
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
      parts.push(`TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
  }

  if (client.brainContext?.trim()) {
    parts.push(`\nCLIENT BRAIN:\n${client.brainContext.trim()}`)
  }

  if (clientAttachments.length > 0) {
    parts.push('\nCLIENT DOCUMENTS:')
    for (const doc of clientAttachments) {
      if (doc.summary?.trim()) parts.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
    }
  }

  // Vertical brain (when a vertical is selected)
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
      parts.push(`\nVERTICAL: ${vertical.name}`)
      if (vertical.brainContext?.trim()) parts.push(`VERTICAL BRAIN:\n${vertical.brainContext.trim()}`)
      for (const doc of verticalAttachments) {
        if (doc.summary?.trim()) parts.push(`[vertical doc] ${doc.filename}:\n${doc.summary.trim()}`)
      }
    }
  }

  // Agency brain
  const [agency, agencyAttachments] = await Promise.all([
    prisma.agency.findFirst({ where: { id: agencyId }, select: { name: true, brainContext: true } }),
    prisma.agencyBrainAttachment.findMany({
      where: { agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
  ])

  if (agency?.brainContext?.trim()) {
    parts.push(`\nAGENCY KNOWLEDGE (${agency.name}):\n${agency.brainContext.trim()}`)
  }
  for (const doc of agencyAttachments) {
    if (doc.summary?.trim()) parts.push(`[agency] ${doc.filename}:\n${doc.summary.trim()}`)
  }

  return parts
}

// ─── Question extractor ───────────────────────────────────────────────────────

function extractQuestions(messages: Array<{ role: string; content: string }>): string[] {
  const questions: string[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    // Strip XML blocks (synthesis/suggestions)
    const cleaned = msg.content
      .replace(/<SKILL_SYNTHESIS>[\s\S]*?<\/SKILL_SYNTHESIS>/gi, '')
      .replace(/<PRODUCTPILOT_SUGGESTIONS>[\s\S]*?<\/PRODUCTPILOT_SUGGESTIONS>/gi, '')
      .trim()
    // Extract lines ending with ?
    const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean)
    const questionLines = lines.filter((l) => l.endsWith('?'))
    if (questionLines.length > 0) {
      // Take the last question in the turn (the one they left the user with)
      questions.push(questionLines[questionLines.length - 1])
    }
  }
  return questions
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  contextParts: string[],
  categoryKey: string,
  skillKey: string,
  clientName: string,
  questionFlow?: string[],
): string {
  const skill = findSkill(categoryKey, skillKey)
  if (!skill) throw new Error(`Skill not found: ${categoryKey}/${skillKey}`)

  const category = PRODUCT_MARKETING_SKILLS.find((c) => c.key === categoryKey)
  const categoryLabel = category?.label ?? categoryKey

  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available yet — draw on what you learn from the conversation.'

  // Related skills in same category for suggestions — include categoryKey so Claude generates correct suggestion objects
  const relatedSkills = (category?.skills ?? [])
    .filter((s) => s.key !== skillKey)
    .slice(0, 5)
    .map((s) => ({ key: s.key, categoryKey: category!.key, name: s.name, description: s.description }))

  return `You are productPILOT, the AI Product Marketing strategist built into ContentNode. You guide agency teams and their clients through PM skill frameworks using Socratic, multi-directional questioning that builds deep strategic clarity.

You are currently running the **${skill.name}** skill (category: ${categoryLabel}) for client **${clientName}**.

## THE SKILL FRAMEWORK YOU ARE RUNNING:

${skill.instructions}

## CLIENT CONTEXT:
${contextBlock}

## HOW TO CONDUCT THIS SESSION:

**Your role:** You are not filling out a form. You are a strategic thinking partner who helps the user think more deeply, more completely, and more honestly than they would alone.

**Multi-directional questioning principles:**
1. **Never ask linear, predictable questions** — Don't just march through the framework top to bottom. Jump to where the most interesting or underexplored territory is.
2. **Connect across dimensions** — When an answer in one area reveals something about another area, surface it: "You just said X — that has implications for Y that most people overlook. Let's go there."
3. **Surface contradictions** — If something the user says conflicts with something earlier, name it: "You said A earlier, but now you're saying B — how do you reconcile that?"
4. **Pressure-test assumptions** — Take the answer one layer deeper: "Why is that true? What evidence supports it? What would change if it wasn't true?"
5. **Apply devil's advocate** — Regularly challenge: "What would your harshest critic say about this?" or "What's the failure mode here?"
6. **Ask the uncomfortable question** — The question the user is hoping you won't ask is usually the most important one.
7. **One question per turn** — Never stack questions. Ask the one that matters most right now.

**Session arc:**
- First 2-3 exchanges: Orient to the client, what they know, what's fuzzy
- Middle exchanges: Go deep on the most valuable or weakest dimensions
- Final exchanges: Synthesis — pull the threads together, surface the insight
- When synthesis is ready (usually after 6-10 meaningful exchanges): produce the synthesis block

**Synthesis rules:**
- Produce the synthesis block when you have enough to write something genuinely useful
- Do NOT produce it prematurely just to end the session
- Make it dense with specifics — no generic statements
- Write it in a format the client can share with their team

**Response format:**
- Keep responses SHORT: 3-5 lines of conversation + one sharp question
- After the question, ALWAYS include a <PRODUCTPILOT_PATHS> block (see below)
- Then optionally a <PRODUCTPILOT_SUGGESTIONS> block with related skills
- When synthesis is ready: produce a <SKILL_SYNTHESIS> block (this ends the active session — omit PATHS when doing this)

**Paths block (ALWAYS include after your question, unless producing synthesis):**
<PRODUCTPILOT_PATHS>
["Path A — 5-8 words specific to what was just discussed", "Path B — a challenge or pushback angle", "Path C — a different dimension worth exploring"]
</PRODUCTPILOT_PATHS>

Rules for paths:
- Each path is 5-8 words — short, direct, feels like something the user would naturally say
- Path A: the most obvious next direction from this answer
- Path B: a challenge, contradiction, or "what if we're wrong" angle
- Path C: an adjacent dimension they probably haven't considered yet
- Make them SPECIFIC to what was just said — never generic ("tell me more", "go deeper")

**Suggestions block (2-3 related skills — only include when genuinely relevant):**
<PRODUCTPILOT_SUGGESTIONS>
[
  {
    "key": "skill-key",
    "categoryKey": "category-key",
    "name": "Skill Name",
    "reason": "One sentence: why this skill is the natural next step given what we just learned"
  }
]
</PRODUCTPILOT_SUGGESTIONS>

**Related skills available:**
${JSON.stringify(relatedSkills, null, 2)}

**Synthesis block (produce when ready — signals the session is complete):**
<SKILL_SYNTHESIS>
# ${skill.name} — [Client Name]

[Structured synthesis of everything learned in this session, organized by the framework dimensions. Dense with specifics. Useful as a standalone document.]
</SKILL_SYNTHESIS>

Always end each response with either a question (still gathering) or the synthesis block (complete).${
    questionFlow && questionFlow.length > 0
      ? `

## LOADED SESSION TEMPLATE — PROVEN QUESTION PATH:
A previous session for this skill produced the following question sequence that worked exceptionally well. Use it as your scaffolding — follow the spirit and sequence, but adapt each question to what you're actually learning from this client's answers. Don't quote them verbatim; make them fit the conversation:

${questionFlow.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : ''
  }`
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function productPilotRoutes(app: FastifyInstance) {

  // ── POST /chat ───────────────────────────────────────────────────────────────
  app.post('/chat', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues })
    }

    const { messages, clientId, categoryKey, skillKey, templateId, verticalId } = parsed.data

    const skill = findSkill(categoryKey, skillKey)
    if (!skill) return reply.code(404).send({ error: 'Skill not found' })

    const [client, template] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
      templateId
        ? prisma.skillSessionTemplate.findFirst({ where: { id: templateId, agencyId }, select: { questionFlow: true } })
        : Promise.resolve(null),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const questionFlow = template ? (template.questionFlow as string[]) : undefined

    const contextParts = await buildClientContext(agencyId, clientId, verticalId)
    const systemPrompt = buildSystemPrompt(contextParts, categoryKey, skillKey, client.name, questionFlow)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 })
    const { model: researchModel } = await getModelForRole('research_synthesis')

    const levelHint = `[productPILOT — ${skill.name} — Client: ${client.name}]`
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => ({
      role:    m.role,
      content: i === 0 ? `${levelHint}\n\n${m.content}` : m.content,
    }))

    const response = await anthropic.messages.create({
      model:      researchModel,
      max_tokens: 2500,
      system:     systemPrompt,
      messages:   anthropicMessages,
    })

    const fullText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Extract synthesis block
    const synthMatch = fullText.match(/<SKILL_SYNTHESIS>([\s\S]+?)<\/SKILL_SYNTHESIS>/i)
    let synthesis: string | null = null
    let replyText = fullText

    if (synthMatch) {
      synthesis = synthMatch[1].trim()
      replyText = fullText.replace(synthMatch[0], '').trim()
    }

    // Extract paths block
    const pathsMatch = replyText.match(/<PRODUCTPILOT_PATHS>([\s\S]+?)<\/PRODUCTPILOT_PATHS>/i)
    let paths: string[] = []
    if (pathsMatch) {
      replyText = replyText.replace(pathsMatch[0], '').trim()
      try { paths = JSON.parse(pathsMatch[1].trim()) } catch { /* malformed */ }
    }

    // Extract suggestions block
    const suggestMatch = replyText.match(/<PRODUCTPILOT_SUGGESTIONS>([\s\S]+?)<\/PRODUCTPILOT_SUGGESTIONS>/i)
    let suggestions: unknown[] = []

    if (suggestMatch) {
      replyText = replyText.replace(suggestMatch[0], '').trim()
      try { suggestions = JSON.parse(suggestMatch[1].trim()) } catch { /* malformed */ }
    }

    return reply.send({ data: { reply: replyText.trim(), paths, suggestions, synthesis } })
  })

  // ── POST /save-synthesis — store completed skill in Brain ────────────────────
  app.post('/save-synthesis', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = saveSynthesisBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues })
    }

    const { clientId, categoryKey, skillKey, synthesis } = parsed.data

    const [client, skill] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
      Promise.resolve(findSkill(categoryKey, skillKey)),
    ])
    if (!client) return reply.code(404).send({ error: 'Client not found' })
    if (!skill)  return reply.code(404).send({ error: 'Skill not found' })

    const filename = `productpilot-${skillKey}.md`

    // Upsert: if a synthesis for this skill already exists, replace it
    const existing = await prisma.clientBrainAttachment.findFirst({
      where: { clientId, agencyId, filename, source: 'productpilot' },
      select: { id: true },
    })

    if (existing) {
      await prisma.clientBrainAttachment.update({
        where: { id: existing.id },
        data: {
          summary:       synthesis,
          summaryStatus: 'ready',
        },
      })
    } else {
      await prisma.clientBrainAttachment.create({
        data: {
          agencyId,
          clientId,
          filename,
          storageKey:    `productpilot/${clientId}/${skillKey}.md`,
          source:        'productpilot',
          summary:       synthesis,
          summaryStatus: 'ready',
          sizeBytes:     Buffer.byteLength(synthesis, 'utf8'),
        },
      })
    }

    return reply.send({ data: { ok: true, skillName: skill.name } })
  })

  // ── GET /session-templates — list saved paths for a skill ────────────────────
  app.get('/session-templates', async (req, reply) => {
    const { agencyId } = req.auth
    const { skillKey } = req.query as { skillKey?: string }

    const where = skillKey
      ? { agencyId, skillKey }
      : { agencyId }

    const templates = await prisma.skillSessionTemplate.findMany({
      where,
      select: { id: true, skillKey: true, categoryKey: true, name: true, useCount: true, createdAt: true },
      orderBy: [{ useCount: 'desc' }, { createdAt: 'desc' }],
    })

    return reply.send({ data: templates })
  })

  // ── POST /save-session-template — extract questions and save path ─────────────
  app.post('/save-session-template', async (req, reply) => {
    const { agencyId, userId } = req.auth as { agencyId: string; userId?: string }

    const parsed = saveTemplateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues })
    }

    const { skillKey, categoryKey, name, messages } = parsed.data

    const skill = findSkill(categoryKey, skillKey)
    if (!skill) return reply.code(404).send({ error: 'Skill not found' })

    const questionFlow = extractQuestions(messages)
    if (questionFlow.length === 0) {
      return reply.code(422).send({ error: 'No questions found in session history' })
    }

    const template = await prisma.skillSessionTemplate.create({
      data: {
        agencyId,
        skillKey,
        categoryKey,
        name: name.trim(),
        questionFlow,
        createdByUserId: userId ?? null,
      },
      select: { id: true, name: true, skillKey: true, categoryKey: true },
    })

    return reply.send({ data: template })
  })
}
