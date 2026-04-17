import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import {
  getScheduledResearchQueue,
  type ScheduledResearchJobData,
} from '../lib/queues.js'
import { seedDefaultTasksForAllClients } from '../lib/defaultScheduledTasks.js'

const createBody = z.object({
  label:                z.string().min(1).max(120),
  scope:                z.enum(['company', 'client', 'vertical']),
  type:                 z.enum(['web_scrape', 'review_miner', 'audience_signal', 'seo_intent', 'research_brief']),
  frequency:            z.enum(['daily', 'weekly', 'monthly']),
  clientId:             z.string().optional(),
  verticalId:           z.string().nullish(),
  config:               z.record(z.unknown()).default({}),
  autoGenerate:         z.boolean().optional(),
  autoGenerateBlogCount: z.number().int().min(1).max(5).optional(),
})

const updateBody = createBody
  .partial()
  .omit({ scope: true, type: true })
  .extend({ enabled: z.boolean().optional() })

function computeNextRunAt(frequency: string): Date {
  const now = new Date()
  if (frequency === 'daily') return new Date(now.getTime() + 86_400_000)
  if (frequency === 'monthly') return new Date(now.getTime() + 30 * 86_400_000)
  return new Date(now.getTime() + 7 * 86_400_000)
}

export async function scheduledTaskRoutes(app: FastifyInstance) {

  // ── GET /api/v1/scheduled-tasks ───────────────────────────────────────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query

    const tasks = await prisma.scheduledTask.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { vertical: { select: { id: true, name: true } } },
    })
    return reply.send({ data: tasks })
  })

  // ── POST /api/v1/scheduled-tasks ──────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })
    const { label, scope, type, frequency, clientId, verticalId, config, autoGenerate, autoGenerateBlogCount } = parsed.data

    if (scope === 'client' && !clientId) {
      return reply.code(400).send({ error: 'clientId required for client-scoped tasks' })
    }
    if (scope === 'vertical' && (!clientId || !verticalId)) {
      return reply.code(400).send({ error: 'clientId and verticalId required for vertical-scoped tasks' })
    }

    const task = await prisma.scheduledTask.create({
      data: {
        agencyId,
        clientId: clientId ?? null,
        verticalId: verticalId ?? null,
        scope,
        type,
        label,
        frequency,
        config: config as object,
        nextRunAt: computeNextRunAt(frequency),
        ...(autoGenerate !== undefined ? { autoGenerate } : {}),
        ...(autoGenerateBlogCount !== undefined ? { autoGenerateBlogCount } : {}),
      },
    })
    return reply.code(201).send({ data: task })
  })

  // ── PATCH /api/v1/scheduled-tasks/:id ────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message })

    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })

    const { label, frequency, config, enabled, clientId, verticalId, autoGenerate, autoGenerateBlogCount } = parsed.data
    const updateData: Record<string, unknown> = {}
    if (label !== undefined) updateData.label = label
    if (frequency !== undefined) {
      updateData.frequency = frequency
      updateData.nextRunAt = computeNextRunAt(frequency)
    }
    if (config !== undefined) updateData.config = config
    if (enabled !== undefined) updateData.enabled = enabled
    if (clientId !== undefined) updateData.clientId = clientId
    if (verticalId !== undefined) {
      updateData.verticalId = verticalId ?? null
      // Scope follows vertical selection: vertical set → 'vertical', cleared → 'client'
      updateData.scope = verticalId ? 'vertical' : 'client'
    }
    if (autoGenerate !== undefined) updateData.autoGenerate = autoGenerate
    if (autoGenerateBlogCount !== undefined) updateData.autoGenerateBlogCount = autoGenerateBlogCount

    const task = await prisma.scheduledTask.update({
      where: { id },
      data: updateData,
    })
    return reply.send({ data: task })
  })

  // ── DELETE /api/v1/scheduled-tasks/:id ───────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })
    await prisma.scheduledTask.delete({ where: { id } })
    return reply.code(204).send()
  })

  // ── POST /api/v1/scheduled-tasks/:id/run-now ─────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/run-now', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const task = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    if (task.lastStatus === 'running') return reply.code(409).send({ error: 'Task already running' })

    const queue = getScheduledResearchQueue()
    await queue.add(
      'run-research',
      { taskId: id, agencyId } satisfies ScheduledResearchJobData,
      { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
    )

    return reply.send({ data: { queued: true } })
  })

  // ── GET /api/v1/scheduled-tasks/:id/output ───────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/output', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const task = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!task) return reply.code(404).send({ error: 'Task not found' })

    const label = `[Scheduled] ${task.label}`

    // All scopes now write to clientBrainAttachment (vertical-scoped entries have verticalId set)
    if (task.clientId) {
      const att = await prisma.clientBrainAttachment.findFirst({
        where: {
          agencyId,
          clientId: task.clientId,
          source: 'scheduled',
          filename: label,
          ...(task.verticalId ? { verticalId: task.verticalId } : {}),
        },
        select: { extractedText: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      return reply.send({ data: { text: att?.extractedText ?? null, updatedAt: att?.createdAt ?? null } })
    }
    return reply.send({ data: { text: null, updatedAt: null } })
  })

  // ── POST /api/v1/scheduled-tasks/:id/generate-content ────────────────────
  // Turns a completed scheduled task output into 2–3 blog posts + LinkedIn posts
  app.post<{
    Params: { id: string }
    Body: { blogCount?: number }
  }>('/:id/generate-content', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const blogCount = Math.min(Math.max(Number((req.body as { blogCount?: number })?.blogCount ?? 2), 1), 5)

    const task = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    if (!task.clientId) return reply.code(400).send({ error: 'Task has no client' })

    // Fetch the research output from the brain attachment
    const att = await prisma.clientBrainAttachment.findFirst({
      where: {
        agencyId,
        clientId: task.clientId,
        source: 'scheduled',
        filename: `[Scheduled] ${task.label}`,
        ...(task.verticalId ? { verticalId: task.verticalId } : {}),
      },
      select: { extractedText: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!att?.extractedText) return reply.code(404).send({ error: 'No output available — run the task first' })

    // Fetch client brand voice + name
    const [brandBuilder, client] = await Promise.all([
      prisma.clientBrandBuilder.findFirst({
        where: { clientId: task.clientId, agencyId },
        select: { dataJson: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.client.findFirst({ where: { id: task.clientId, agencyId }, select: { name: true } }),
    ])
    const brandData = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
    const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')
    const clientName = client?.name ?? ''

    // Extract source URLs embedded in the research text
    const urlRegex = /https?:\/\/[^\s\)\]\>"',]+/g
    const rawUrls = att.extractedText.match(urlRegex) ?? []
    const sourceUrls = [...new Set(
      rawUrls
        .map((u) => u.replace(/[.,;:!?)]+$/, ''))
        .filter((u) => !u.includes('fonts.googleapis') && !u.includes('cdn.jsdelivr') && u.length > 10),
    )].slice(0, 20)

    const buildPrompt = (n: number, offset: number) => {
      const systemPrompt = `You are a content strategist and expert B2B blog writer${clientName ? ` for ${clientName}` : ''}.
Turn the research intelligence below into ${n} distinct, publication-ready blog posts — each taking a different angle or insight from the research.${offset > 0 ? ` These are blogs ${offset + 1}–${offset + n} in a series; do not repeat angles already covered by earlier blogs.` : ''}
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}

For EACH blog post:
- Title: compelling, SEO-friendly headline
- 650–900 words of substantive content
- Structure: engaging intro, 3–4 H2 sections, concise conclusion
- Cite sources inline using the format [source: domain.com] wherever relevant
- End with a "## Sources" section listing the actual URLs used

For EACH blog post also write:
- A LinkedIn post (150–200 words): punchy hook, 3 key takeaways as short bullets, a CTA to read the blog
- An image generation prompt: describe a professional, brand-appropriate blog header image (style, subject, composition, mood)

Return ONLY valid JSON — no markdown fences, nothing outside the JSON object:
{
  "blogs": [
    {
      "title": "string",
      "slug": "url-friendly-slug",
      "excerpt": "2-sentence teaser",
      "content": "Full markdown blog with inline [source: x] citations and ## Sources section",
      "sources": ["url1", "url2"],
      "linkedIn": {
        "post": "LinkedIn post text",
        "imagePrompt": "Detailed image generation prompt"
      }
    }
  ]
}`

      const userPrompt = `Research task: ${task.label}
${sourceUrls.length > 0 ? `\nSource URLs found in this research:\n${sourceUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : ''}
--- FULL RESEARCH OUTPUT ---
${att.extractedText.slice(0, 13000)}`

      return { systemPrompt, userPrompt }
    }

    const parseBlogs = (text: string): unknown[] => {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (!match) return []
      const parsed = JSON.parse(match[0]) as { blogs?: unknown[] }
      return Array.isArray(parsed.blogs) ? parsed.blogs : []
    }

    // Batch into calls of max 2 blogs to stay well under the 3-min timeout
    const BATCH = 2
    const batches: Array<{ n: number; offset: number }> = []
    for (let i = 0; i < blogCount; i += BATCH) {
      batches.push({ n: Math.min(BATCH, blogCount - i), offset: i })
    }

    let blogs: unknown[] = []
    let tokensUsed = 0
    try {
      for (const { n, offset } of batches) {
        const { systemPrompt, userPrompt } = buildPrompt(n, offset)
        const result = await callModel(
          {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            api_key_ref: 'ANTHROPIC_API_KEY',
            temperature: 0.65,
            max_tokens: 8192,
            system_prompt: systemPrompt,
          },
          userPrompt,
        )
        tokensUsed += result.tokens_used ?? 0
        const batch = parseBlogs(result.text)
        blogs = blogs.concat(batch)
      }
    } catch (err) {
      console.error('[generate-content] callModel failed:', err)
      return reply.code(500).send({ error: 'Content generation timed out or failed — try fewer blogs or try again' })
    }

    if (!blogs.length) return reply.code(500).send({ error: 'Failed to parse generated content — try again' })

    return reply.send({ data: { blogs, sourceUrls, taskLabel: task.label, tokensUsed } })
  })

  // ── POST /api/v1/scheduled-tasks/seed-defaults ───────────────────────────
  app.post('/seed-defaults', async (req, reply) => {
    const { agencyId } = req.auth
    const clientsSeeded = await seedDefaultTasksForAllClients(agencyId)
    return reply.send({ data: { clientsSeeded } })
  })

  // ── POST /api/v1/scheduled-tasks/:id/dismiss ─────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/dismiss', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params
    const existing = await prisma.scheduledTask.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Task not found' })
    await prisma.scheduledTask.update({
      where: { id },
      data: { changeDetected: false },
    })
    return reply.send({ data: { dismissed: true } })
  })
}
