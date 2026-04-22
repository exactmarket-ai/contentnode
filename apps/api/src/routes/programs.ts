import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel, type ModelConfig } from '@contentnode/ai'

// ─────────────────────────────────────────────────────────────────────────────
// Default model
// ─────────────────────────────────────────────────────────────────────────────

const SONNET: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.7,
  max_tokens: 2048,
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_TYPES = [
  'thought_leadership',
  'seo_content',
  'competitive_intel',
  'newsletter',
  'customer_story',
  'event_content',
] as const

const createProgramBody = z.object({
  clientId:       z.string().min(1),
  name:           z.string().min(1).max(200),
  type:           z.enum(PROGRAM_TYPES),
  scheduledTaskId: z.string().min(1).optional(),
  contentConfig:  z.record(z.unknown()).optional(),
  autoPublish:    z.boolean().optional(),
})

const updateProgramBody = z.object({
  name:            z.string().min(1).max(200).optional(),
  status:          z.enum(['active', 'paused', 'archived']).optional(),
  scheduledTaskId: z.string().min(1).nullable().optional(),
  contentConfig:   z.record(z.unknown()).optional(),
  autoPublish:     z.boolean().optional(),
  setupComplete:   z.boolean().optional(),
})

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(20000),
})

const pilotBody = z.object({
  messages:         z.array(messageSchema).min(0).max(60),
  clientId:         z.string().min(1),
  currentProgramId: z.string().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildProgramsContext(
  agencyId: string,
  clientId: string,
): Promise<{
  clientName: string
  contextParts: string[]
  scheduledTasks: Array<{ id: string; label: string; type: string; frequency: string; lastStatus: string }>
  existingPrograms: Array<{ id: string; name: string; type: string; status: string }>
}> {
  const [client, scheduledTasks, existingPrograms] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: {
        name: true,
        industry: true,
        brainContext: true,
        brandProfiles: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { editedJson: true, extractedJson: true },
        },
      },
    }),
    prisma.scheduledTask.findMany({
      where: { agencyId, clientId, enabled: true },
      select: { id: true, label: true, type: true, frequency: true, lastStatus: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.program.findMany({
      where: { agencyId, clientId },
      select: { id: true, name: true, type: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const contextParts: string[] = []

  if (client) {
    contextParts.push(`CLIENT: ${client.name}`)
    if (client.industry) contextParts.push(`INDUSTRY: ${client.industry}`)

    const brandProfile = client.brandProfiles[0]
    const brandData = brandProfile?.editedJson ?? brandProfile?.extractedJson
    if (brandData) {
      const b = brandData as Record<string, unknown>
      if (b.positioning ?? b.value_proposition)
        contextParts.push(`POSITIONING: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
      if (b.target_audience ?? b.audience)
        contextParts.push(`TARGET AUDIENCE: ${JSON.stringify(b.target_audience ?? b.audience)}`)
      if (b.tone ?? b.brand_voice)
        contextParts.push(`BRAND VOICE: ${JSON.stringify(b.tone ?? b.brand_voice)}`)
    }

    if (client.brainContext?.trim()) {
      contextParts.push(`\nCLIENT BRAIN:\n${client.brainContext.trim()}`)
    }
  }

  return {
    clientName: client?.name ?? 'Unknown Client',
    contextParts,
    scheduledTasks,
    existingPrograms,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_TYPE_DESCRIPTIONS: Record<string, string> = {
  thought_leadership: 'Thought Leadership — Original POV content, expert takes, industry commentary. Positions founders/executives as category voices.',
  seo_content:        'SEO Content — Keyword-targeted blog posts, pillar pages, and supporting articles designed to rank and convert.',
  competitive_intel:  'Competitive Intel — Regular competitive landscape analysis, win/loss themes, and battlecard updates.',
  newsletter:         'Newsletter — Recurring email digest (weekly/biweekly) blending curated insights with original commentary.',
  customer_story:     'Customer Story — Ongoing pipeline of case studies, testimonials, and outcome narratives from real customers.',
  event_content:      'Event Content — Pre/post event asset production: summaries, social clips, blog recaps, speaker assets.',
}

function buildPilotSystemPrompt(
  contextParts: string[],
  clientName: string,
  scheduledTasks: Array<{ id: string; label: string; type: string; frequency: string; lastStatus: string }>,
  existingPrograms: Array<{ id: string; name: string; type: string; status: string }>,
): string {
  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available yet — draw on what you learn from the conversation.'

  const taskList = scheduledTasks.length > 0
    ? scheduledTasks.map((t) => `- [${t.id}] "${t.label}" (${t.type}, ${t.frequency}, last: ${t.lastStatus})`).join('\n')
    : '(No research tasks set up yet — user will need to create one or proceed without a research feed.)'

  const programList = existingPrograms.length > 0
    ? existingPrograms.map((p) => `- ${p.name} (${p.type}, ${p.status})`).join('\n')
    : '(No programs yet — this would be the first one.)'

  const typeMenu = Object.entries(PROGRAM_TYPE_DESCRIPTIONS)
    .map(([key, desc]) => `- **${key}**: ${desc}`)
    .join('\n')

  return `You are programsPILOT, the AI content engine guide built into ContentNode.

Your job is to help the user set up a standing content program — an always-on engine that pulls from a research source and produces content packs (blogs + social posts) that land in the Pipeline for review.

You guide users through a short, focused setup: understand their goal → pick a program type → connect a research source → configure content output.

## CLIENT CONTEXT:
${contextBlock}

## AVAILABLE PROGRAM TYPES:
${typeMenu}

## AVAILABLE RESEARCH TASKS (for this client):
${taskList}
Note: scheduledTaskId values are the IDs in square brackets above. Use these exact IDs in your PROGRAM_CONFIG output.

## EXISTING PROGRAMS FOR THIS CLIENT:
${programList}

## YOUR ROLE — GUIDE, DON'T CONFIGURE:
You are not a setup wizard. You are a thinking partner helping the user figure out what kind of content program will actually move the needle for this client. The configuration follows from that thinking — it is not the goal of it.

The difference:
- Setup wizard: "What type of program do you want? Here are the options."
- Thinking partner: "What's the content problem you're trying to solve for this client right now — visibility, pipeline, retention? That shapes which program type will actually work."

## SESSION ARC:
**Orient**: Ask what the user is trying to achieve — not which program type they want. Understand the goal before suggesting a direction.
**Explore**: Present 2-3 program directions that fit the goal. Explain the tradeoff of each in one line. Let the user choose.
**Narrow**: Once they've chosen a direction, ask about the research source and content config — one question at a time.
**Confirm**: When you have everything, summarize what you're setting up and ask for confirmation before outputting the config block.

## RULES:
- Keep responses SHORT — 3-5 lines + one clear question or path options.
- One question per turn — never stack.
- Present options with tradeoffs, not single recommendations.
- When the user confirms the setup, output a <PROGRAM_CONFIG> block and STOP.
- Never output a <PROGRAM_CONFIG> block before the user confirms.
- If no research task fits, set scheduledTaskId to null.
- blogCount should be 1–5 (default: 2).
- platforms should be a non-empty array.
- generateImages defaults to true.
- imageStyle defaults to "professional" if not specified.

## OUTPUT FORMAT (only when user confirms):
When the user confirms the setup, output exactly this block and nothing else after it:

<PROGRAM_CONFIG>
{"name":"...","type":"thought_leadership","scheduledTaskId":"task_id_or_null","contentConfig":{"blogCount":2,"platforms":["linkedin","facebook"],"generateImages":true,"imageStyle":"professional"},"autoPublish":false}
</PROGRAM_CONFIG>

Use null (not the string "null") for scheduledTaskId when no task is selected.
autoPublish should always be false unless the user explicitly requests auto-publishing.

## PATHS (quick-reply buttons):
After each response (except when outputting PROGRAM_CONFIG), suggest 2–4 short next steps the user can click. Output them as a <PATHS> block on a new line after your reply:

<PATHS>
["option 1", "option 2", "option 3"]
</PATHS>

Keep each option under 50 characters. Do NOT output PATHS with a PROGRAM_CONFIG block.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Route plugin
// ─────────────────────────────────────────────────────────────────────────────

export async function programRoutes(app: FastifyInstance) {

  // ── List programs ────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as Record<string, string>

    const programs = await prisma.program.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
      },
      include: {
        scheduledTask: {
          select: { id: true, label: true, lastStatus: true, lastRunAt: true },
        },
        _count: { select: { workflowRuns: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: programs, meta: { total: programs.length } })
  })

  // ── Get single program ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const program = await prisma.program.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        scheduledTask: {
          select: { id: true, label: true, lastStatus: true, lastRunAt: true },
        },
        workflowRuns: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            reviewStatus: true,
            createdAt: true,
            workflow: { select: { name: true, itemName: true } },
          },
        },
      },
    })

    if (!program) return reply.code(404).send({ error: 'Program not found' })

    return reply.send({ data: program })
  })

  // ── Create program ───────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createProgramBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { clientId, name, type, scheduledTaskId, contentConfig, autoPublish } = parsed.data

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (scheduledTaskId) {
      const task = await prisma.scheduledTask.findFirst({ where: { id: scheduledTaskId, agencyId } })
      if (!task) return reply.code(404).send({ error: 'Scheduled task not found' })
    }

    const program = await prisma.program.create({
      data: {
        agencyId,
        clientId,
        name,
        type,
        status: 'active',
        scheduledTaskId: scheduledTaskId ?? null,
        contentConfig: (contentConfig ?? {}) as never,
        autoPublish: autoPublish ?? false,
      },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
      },
    })

    return reply.code(201).send({ data: program })
  })

  // ── Update program ───────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateProgramBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const existing = await prisma.program.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Program not found' })

    const { name, status, scheduledTaskId, contentConfig, autoPublish, setupComplete } = parsed.data

    if (scheduledTaskId) {
      const task = await prisma.scheduledTask.findFirst({ where: { id: scheduledTaskId, agencyId } })
      if (!task) return reply.code(404).send({ error: 'Scheduled task not found' })
    }

    const program = await prisma.program.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(scheduledTaskId !== undefined ? { scheduledTaskId: scheduledTaskId ?? null } : {}),
        ...(contentConfig !== undefined ? { contentConfig: contentConfig as never } : {}),
        ...(autoPublish !== undefined ? { autoPublish } : {}),
        ...(setupComplete !== undefined ? { setupComplete } : {}),
      },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
      },
    })

    return reply.send({ data: program })
  })

  // ── Delete program ───────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const existing = await prisma.program.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Program not found' })

    await prisma.program.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── programsPILOT chat ───────────────────────────────────────────────────────
  app.post('/pilot', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = pilotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { messages, clientId, currentProgramId } = parsed.data

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Build context
    const { clientName, contextParts, scheduledTasks, existingPrograms } =
      await buildProgramsContext(agencyId, clientId)

    const systemPrompt = buildPilotSystemPrompt(contextParts, clientName, scheduledTasks, existingPrograms)

    // Call Claude — pass system prompt via config, conversation as structured text
    const conversationText = messages.length > 0
      ? messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')
      : '(starting conversation)'

    const modelConfig = { ...SONNET, system_prompt: systemPrompt }
    const result = await callModel(modelConfig, conversationText)
    const responseText = result.text

    // Parse PROGRAM_CONFIG block
    const configMatch = responseText.match(/<PROGRAM_CONFIG>([\s\S]+?)<\/PROGRAM_CONFIG>/i)
    let program: Record<string, unknown> | null = null

    if (configMatch) {
      let parsedConfig: Record<string, unknown> | null = null
      try {
        parsedConfig = JSON.parse(configMatch[1].trim())
      } catch {
        // Malformed config block — skip program creation
      }

      if (parsedConfig) {
        const { name, type, scheduledTaskId, contentConfig, autoPublish } = parsedConfig as {
          name?: string
          type?: string
          scheduledTaskId?: string | null
          contentConfig?: Record<string, unknown>
          autoPublish?: boolean
        }

        // Validate type is one of the allowed values
        const validType = PROGRAM_TYPES.includes(type as (typeof PROGRAM_TYPES)[number])
          ? (type as (typeof PROGRAM_TYPES)[number])
          : 'thought_leadership'

        // Validate scheduledTaskId belongs to this agency (if provided)
        let resolvedTaskId: string | null = scheduledTaskId ?? null
        if (resolvedTaskId) {
          const task = await prisma.scheduledTask.findFirst({ where: { id: resolvedTaskId, agencyId } })
          if (!task) resolvedTaskId = null
        }

        if (currentProgramId) {
          // PATCH existing program
          const existing = await prisma.program.findFirst({ where: { id: currentProgramId, agencyId } })
          if (existing) {
            program = await prisma.program.update({
              where: { id: currentProgramId },
              data: {
                ...(name ? { name } : {}),
                type: validType,
                scheduledTaskId: resolvedTaskId,
                contentConfig: (contentConfig ?? {}) as never,
                autoPublish: autoPublish ?? false,
                setupComplete: true,
              },
              include: {
                scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
              },
            }) as Record<string, unknown>
          }
        } else {
          // Create new program
          program = await prisma.program.create({
            data: {
              agencyId,
              clientId,
              name: (name ?? 'Untitled Program').trim(),
              type: validType,
              status: 'active',
              scheduledTaskId: resolvedTaskId,
              contentConfig: (contentConfig ?? {}) as never,
              autoPublish: autoPublish ?? false,
              setupComplete: true,
            },
            include: {
              scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
            },
          }) as Record<string, unknown>
        }
      }
    }

    // Parse <PATHS> block for quick-reply buttons
    const pathsMatch = responseText.match(/<PATHS>\s*([\s\S]+?)\s*<\/PATHS>/i)
    let paths: string[] = []
    if (pathsMatch) {
      try {
        const parsed = JSON.parse(pathsMatch[1].trim())
        if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === 'string')
      } catch { /* malformed — ignore */ }
    }

    // Strip XML blocks from the text returned to the client
    const cleanResponse = responseText
      .replace(/<PROGRAM_CONFIG>[\s\S]*?<\/PROGRAM_CONFIG>/gi, '')
      .replace(/<PATHS>[\s\S]*?<\/PATHS>/gi, '')
      .trim()

    return reply.send({ message: cleanResponse, paths, program })
  })
}
