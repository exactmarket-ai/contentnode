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
  scheduledDay:         z.number().int().min(0).max(27).nullish(),
  assigneeId:           z.string().nullish(),
})

const updateBody = createBody
  .partial()
  .omit({ scope: true, type: true })
  .extend({ enabled: z.boolean().optional() })

function computeNextRunAt(frequency: string, scheduledDay?: number | null): Date {
  const now = new Date()
  if (frequency === 'daily') return new Date(now.getTime() + 86_400_000)
  if (frequency === 'weekly') {
    if (scheduledDay != null) {
      // scheduledDay: 0=Mon … 6=Sun (matches UI Mon-first order)
      // Convert to JS getDay(): Sun=0, Mon=1 … Sat=6
      const jsTarget = scheduledDay === 6 ? 0 : scheduledDay + 1
      const current  = now.getDay()
      let daysUntil  = jsTarget - current
      if (daysUntil <= 0) daysUntil += 7
      const next = new Date(now)
      next.setDate(now.getDate() + daysUntil)
      next.setHours(9, 0, 0, 0)
      return next
    }
    return new Date(now.getTime() + 7 * 86_400_000)
  }
  if (frequency === 'monthly') {
    if (scheduledDay != null) {
      const day  = Math.min(Math.max(scheduledDay, 1), 28)
      const next = new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0, 0)
      if (next <= now) next.setMonth(next.getMonth() + 1)
      return next
    }
    return new Date(now.getTime() + 30 * 86_400_000)
  }
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
    const { label, scope, type, frequency, clientId, verticalId, config, autoGenerate, autoGenerateBlogCount, scheduledDay, assigneeId } = parsed.data

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
        nextRunAt: computeNextRunAt(frequency, scheduledDay),
        ...(autoGenerate !== undefined ? { autoGenerate } : {}),
        ...(autoGenerateBlogCount !== undefined ? { autoGenerateBlogCount } : {}),
        ...(scheduledDay !== undefined ? { scheduledDay: scheduledDay ?? null } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? null } : {}),
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

    const { label, frequency, config, enabled, clientId, verticalId, autoGenerate, autoGenerateBlogCount, scheduledDay, assigneeId } = parsed.data
    const updateData: Record<string, unknown> = {}
    if (label !== undefined) updateData.label = label
    if (scheduledDay !== undefined) updateData.scheduledDay = scheduledDay ?? null
    if (frequency !== undefined) {
      updateData.frequency = frequency
      const effectiveDay = scheduledDay !== undefined ? (scheduledDay ?? null) : (existing.scheduledDay ?? null)
      updateData.nextRunAt = computeNextRunAt(frequency, effectiveDay)
    } else if (scheduledDay !== undefined) {
      // scheduledDay changed without frequency change — recompute nextRunAt
      updateData.nextRunAt = computeNextRunAt(existing.frequency, scheduledDay ?? null)
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
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId ?? null

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

    const buildPrompt = (priorTitles: string[]) => {
      const avoidClause = priorTitles.length > 0
        ? `\nDo NOT cover the same angle as any of these already-written blogs:\n${priorTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\nPick a completely fresh angle from the research.`
        : ''
      const systemPrompt = `You are a content strategist and expert B2B blog writer${clientName ? ` for ${clientName}` : ''}.
Write ONE publication-ready blog post based on the research below, taking a unique angle.${avoidClause}
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}

Blog requirements:
- Title: compelling, SEO-friendly headline
- 650–900 words of substantive content
- Structure: engaging intro, 3–4 H2 sections, concise conclusion
- Cite sources inline using the format [source: domain.com] wherever relevant
- End with a "## Sources" section listing the actual URLs used

Also write:
- A LinkedIn post (150–200 words): punchy hook, 3 key takeaways as short bullets, a CTA to read the blog
- An image generation prompt: describe a professional, brand-appropriate blog header image (style, subject, composition, mood)

Use EXACTLY this format with these delimiter lines — nothing before or after:
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

      const userPrompt = `Research task: ${task.label}
${sourceUrls.length > 0 ? `\nSource URLs found in this research:\n${sourceUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : ''}
--- FULL RESEARCH OUTPUT ---
${att.extractedText.slice(0, 13000)}`

      return { systemPrompt, userPrompt }
    }

    const parseBlog = (text: string): unknown | null => {
      const get = (key: string, nextKey: string) => {
        const re = new RegExp(`%%${key}%%\\s*([\\s\\S]*?)\\s*(?=%%${nextKey}%%|$)`)
        return text.match(re)?.[1]?.trim() ?? ''
      }
      const title   = get('TITLE',        'SLUG')
      const slug    = get('SLUG',         'EXCERPT')
      const excerpt = get('EXCERPT',      'CONTENT')
      const content = get('CONTENT',      'LINKEDIN')
      const post    = get('LINKEDIN',     'IMAGE_PROMPT')
      const imagePrompt = get('IMAGE_PROMPT', 'SOURCES')
      const sourcesRaw  = get('SOURCES',  'END_NEVER_MATCHES')
      if (!title || !content) {
        console.warn('[generate-content] delimiter parse failed — missing title or content')
        return null
      }
      const sources = sourcesRaw.split('\n').map(s => s.trim()).filter(s => s.startsWith('http'))
      const autoSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return { title, slug: slug || autoSlug, excerpt, content, sources, linkedIn: { post, imagePrompt } }
    }

    // One blog per call — single-blog JSON is nearly never malformed
    let blogs: unknown[] = []
    let tokensUsed = 0
    for (let i = 0; i < blogCount; i++) {
      const priorTitles = (blogs as Array<{ title?: string }>).map((b) => b.title ?? '').filter(Boolean)
      const { systemPrompt, userPrompt } = buildPrompt(priorTitles)
      try {
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
        const blog = parseBlog(result.text)
        if (blog) blogs.push(blog)
      } catch (err) {
        console.error(`[generate-content] blog ${i + 1} failed:`, err)
      }
    }

    if (!blogs.length) return reply.code(500).send({ error: 'Generation failed — check API connectivity or try again' })

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
