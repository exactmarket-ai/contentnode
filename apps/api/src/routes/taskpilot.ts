/**
 * taskpilot.ts
 *
 * POST /api/v1/task-pilot/chat
 *
 * taskPILOT — AI research task strategist.
 * Knows all of a client's scheduled tasks, their status, recent output,
 * and the client's brain context. Helps plan, interpret, and optimise research.
 *
 * Returns conversational reply + <TASKPILOT_SUGGESTIONS> block with task actions.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma, getModelForRole } from '@contentnode/database'

// ─── Schema ───────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(10000),
})

const taskSchema = z.object({
  id:                z.string(),
  type:              z.string(),
  label:             z.string(),
  frequency:         z.string(),
  enabled:           z.boolean(),
  lastStatus:        z.string(),
  lastRunAt:         z.string().nullable().optional(),
  nextRunAt:         z.string().nullable().optional(),
  changeDetected:    z.boolean().optional(),
  lastChangeSummary: z.string().nullable().optional(),
  vertical:          z.object({ id: z.string(), name: z.string() }).nullable().optional(),
})

const chatBody = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  clientId: z.string(),
  tasks:    z.array(taskSchema),
})

// ─── Task type labels ─────────────────────────────────────────────────────────

const TASK_TYPE_LABELS: Record<string, string> = {
  web_scrape:      'Web Scrape',
  review_miner:    'Review Miner',
  audience_signal: 'Audience Signal',
  seo_intent:      'SEO Intent',
  research_brief:  'Research Brief',
}

// ─── Context assembler ────────────────────────────────────────────────────────

async function buildContext(agencyId: string, clientId: string): Promise<string[]> {
  const parts: string[] = []

  const [client, recentOutputs] = await Promise.all([
    prisma.client.findFirst({
      where:  { id: clientId, agencyId },
      select: {
        name: true, industry: true, brainContext: true,
        brandProfiles: {
          take: 1, orderBy: { createdAt: 'desc' },
          select: { editedJson: true, extractedJson: true },
        },
      },
    }),
    // Task outputs are stored as clientBrainAttachment with source='scheduled'
    prisma.clientBrainAttachment.findMany({
      where:  { agencyId, clientId, source: 'scheduled', summaryStatus: 'ready' },
      select: { filename: true, extractedText: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }).catch(() => []),
  ])

  if (!client) return parts

  parts.push(`=== CLIENT ===`)
  parts.push(`Name: ${client.name}`)
  if (client.industry) parts.push(`Industry: ${client.industry}`)

  const brand = client.brandProfiles[0]
  const brandData = brand?.editedJson ?? brand?.extractedJson
  if (brandData) {
    const b = brandData as Record<string, unknown>
    if (b.positioning ?? b.value_proposition) {
      parts.push(`Positioning: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
    }
    if (b.target_audience ?? b.audience) {
      parts.push(`Target Audience: ${JSON.stringify(b.target_audience ?? b.audience)}`)
    }
  }

  if (client.brainContext?.trim()) {
    parts.push(`\nClient Brain:\n${client.brainContext.trim().slice(0, 1200)}`)
  }

  if (recentOutputs.length > 0) {
    parts.push(`\n=== RECENT TASK OUTPUTS ===`)
    for (const att of recentOutputs) {
      const preview = (att.extractedText ?? '').slice(0, 600)
      if (preview.trim()) {
        // filename is "[Scheduled] <task label>"
        const label = att.filename.replace(/^\[Scheduled\]\s*/, '')
        parts.push(`"${label}" (${att.createdAt.toDateString()}):\n${preview}${preview.length >= 600 ? '…' : ''}`)
      }
    }
  }

  return parts
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(contextParts: string[], tasks: z.infer<typeof taskSchema>[]): string {
  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available — encourage the user to upload documents in the Brain section.'

  const taskList = tasks.length === 0
    ? 'No tasks configured yet.'
    : tasks.map((t) => {
        const status = t.lastStatus === 'success' ? '✓' : t.lastStatus === 'failed' ? '✗' : t.lastStatus === 'running' ? '⟳' : '○'
        const change = t.changeDetected ? ` [CHANGE DETECTED: ${t.lastChangeSummary ?? 'update found'}]` : ''
        const vert = t.vertical ? ` (${t.vertical.name})` : ''
        return `- id:${t.id} | ${status} | ${TASK_TYPE_LABELS[t.type] ?? t.type} | "${t.label}"${vert} | ${t.frequency} | ${t.enabled ? 'enabled' : 'disabled'} | last:${t.lastRunAt ? new Date(t.lastRunAt).toDateString() : 'never'}${change}`
      }).join('\n')

  const hasTypes = new Set(tasks.map((t) => t.type))
  const missingTypes = ['web_scrape', 'review_miner', 'audience_signal', 'seo_intent', 'research_brief']
    .filter((t) => !hasTypes.has(t))
    .map((t) => TASK_TYPE_LABELS[t])

  return `You are taskPILOT, the AI research task strategist built into ContentNode. You help agency teams plan, configure, and interpret their scheduled research tasks — web scrapes, review mining, Reddit audience signals, SEO intent analysis, and research briefs.

Your role: Help the user think through what they actually need to know about this client's market — then work backwards to which tasks will surface those signals. Don't prescribe a research stack; help them arrive at the right one.

RESEARCH TASK TYPES YOU KNOW ABOUT:
- Web Scrape: crawls competitor or industry sites, extracts intelligence, writes summaries. Best for tracking competitor messaging, news, product changes.
- Review Miner: scrapes Trustpilot, G2, or Capterra reviews for a company or its competitors. Surfaces objections, testimonials, and competitive weaknesses.
- Audience Signal: mines Reddit for pain points, vocabulary, objections, and questions. Best for understanding how buyers actually talk about their problems.
- SEO Intent: expands seed keywords and maps to funnel stage. Surfaces Awareness / Consideration / Decision intent patterns.
- Research Brief: synthesises signals from multiple sources into a structured intelligence brief. Best run after other tasks have populated data.

CLIENT CONTEXT:
${contextBlock}

CURRENT SCHEDULED TASKS:
${taskList}
${missingTypes.length > 0 ? `\nMISSING TASK TYPES (not yet configured): ${missingTypes.join(', ')}` : ''}

HOW TO RESPOND:

YOUR ROLE — GUIDE, DON'T PRESCRIBE:
Don't jump straight to "here's what tasks you need." Start by understanding what the user is trying to learn about this client or their market. The right research stack follows from that — not from a default template.

The difference:
- Prescriptive: "You're missing a Review Miner. Here's how to set one up."
- Guide: "What's the thing you most want to understand about this client's competitive position right now? That shapes which task will give you the most useful signal."

SESSION ARC:
**Orient**: Ask what question they're trying to answer. If they don't know, ask what decision they're trying to make. If tasks already exist, ask which results surprised them or felt thin.
**Explore**: Identify 2-3 possible directions — different task types, different competitors, different signals — and explain the tradeoff of each. Let the user choose.
**Recommend**: Once you understand what they need, suggest the specific task configuration — pre-filled with real values from the brain context (client name, competitor names, industry keywords, relevant subreddits).
**Optimise**: For existing tasks, interpret results, diagnose problems, suggest frequency adjustments.

BEHAVIORAL RULES:
- One question per turn — the most strategically valuable one right now
- Always reference actual task labels and types from the task list — never be generic
- Use brain context to pre-populate specific config values (company names, URLs, keywords) — not placeholder text
- Short responses: 3-5 lines + one question + suggestion block

SUGGESTION BLOCK (always at the very end):
<TASKPILOT_SUGGESTIONS>
[
  {
    "id": "unique_id",
    "title": "Short title (4-6 words)",
    "description": "One sentence: what this action will do",
    "action": "add_task|run_task|view_output|schedule_task",
    "taskId": "existing-task-id-or-null",
    "taskType": "web_scrape|review_miner|audience_signal|seo_intent|research_brief or null",
    "taskLabel": "display name for this suggestion",
    "taskDraft": { ... } // only for add_task — see below
  }
]
</TASKPILOT_SUGGESTIONS>

Valid actions:
- "add_task": suggest creating a new task (set taskType, leave taskId null). ALWAYS include a "taskDraft" object to pre-configure the modal.
- "run_task": suggest running an existing task now (set taskId)
- "view_output": suggest viewing the last output of a task (set taskId)
- "schedule_task": suggest opening the schedule modal for a task (set taskId)

TASK DRAFT — for add_task suggestions, populate "taskDraft" with ready-to-use config:
{
  "label": "Descriptive task name (4-8 words, be specific)",
  "frequency": "daily|weekly|monthly",
  "config": { /* type-specific fields below */ }
}

Config fields by task type:
- web_scrape:      { "seedUrls": "url1\\nurl2", "synthesisTarget": "summary|dg_s7|gtm_12|raw", "stayOnDomain": true/false, "linkPattern": "" }
- review_miner:    { "companyName": "Client Corp", "platforms": ["trustpilot","g2","capterra"], "competitors": "Comp A\\nComp B", "synthesis": "theme_analysis|competitive_battlecard|objection_map|testimonials|full" }
- audience_signal: { "keywords": "keyword1\\nkeyword2", "subreddits": "subreddit1\\nsubreddit2", "goal": "pain_points|vocabulary_map|objection_map|question_map|full", "minUpvotes": 5 }
- seo_intent:      { "seedKeywords": "keyword1\\nkeyword2", "dataSource": "claude|google_autocomplete|dataforseo", "funnelFocus": "all|awareness|consideration|decision" }
- research_brief:  { "prompt": "Search for [topic] news in the last 7 days. Focus on: ...", "recencyDays": 7 }

Use what you know about the client's industry, competitors, and audience to populate specific URLs, company names, keywords, and subreddits. The more specific, the better.
If giving general advice with no specific task action, omit the suggestions block entirely.`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function taskPilotRoutes(app: FastifyInstance) {
  app.post('/chat', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const { messages, clientId, tasks } = parsed.data

    const client = await prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: { id: true, name: true },
    })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const contextParts = await buildContext(agencyId, clientId)
    const systemPrompt = buildSystemPrompt(contextParts, tasks)

    const levelHint = `[Task Research — Client: ${client.name}]`
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => ({
      role:    m.role,
      content: i === 0 ? `${levelHint}\n\n${m.content}` : m.content,
    }))

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 })
    const { model: researchModel } = await getModelForRole('research_synthesis')

    const response = await anthropic.messages.create({
      model:      researchModel,
      max_tokens: 2000,
      system:     systemPrompt,
      messages:   anthropicMessages,
    })

    const fullText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const match = fullText.match(/<TASKPILOT_SUGGESTIONS>([\s\S]+?)<\/TASKPILOT_SUGGESTIONS>/i)
    let suggestions: unknown[] = []
    let replyText = fullText

    if (match) {
      replyText = fullText.replace(match[0], '').trim()
      try { suggestions = JSON.parse(match[1].trim()) } catch { /* malformed */ }
    } else {
      replyText = fullText.replace(/<TASKPILOT_SUGGESTIONS>[\s\S]*/i, '').trim()
    }

    return reply.send({ data: { reply: replyText, suggestions } })
  })
}
