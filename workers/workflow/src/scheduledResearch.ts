import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { prisma, withAgency } from '@contentnode/database'
import { callModel, type ModelConfig } from '@contentnode/ai'
import {
  createQueue,
  QUEUE_SCHEDULED_RESEARCH,
  type ScheduledResearchJobData,
} from './queues.js'

// Singleton — reuse one Queue connection across all invocations of runResearchChecker
const researchQueue = createQueue<ScheduledResearchJobData>(QUEUE_SCHEDULED_RESEARCH)
import { DeepWebScrapeExecutor } from './executors/deepWebScrape.js'
import { ReviewMinerExecutor } from './executors/reviewMiner.js'
import { AudienceSignalExecutor } from './executors/audienceSignal.js'
import { SeoIntentExecutor } from './executors/seoIntent.js'
import { runResearchBrief, type ResearchBriefConfig } from './executors/researchBrief.js'
import {
  synthesiseClientContext,
  synthesiseAgencyContext,
  synthesiseVerticalContext,
} from './clientBrainExtraction.js'
import { runThoughtLeaderSocialSync } from './thoughtLeaderSocialSync.js'
import type { NodeExecutionContext } from './executors/base.js'

const SONNET: ModelConfig = {
  provider:    'anthropic',
  model:       'claude-sonnet-4-6',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.65,
  max_tokens:  16000,
}

// ─── Auto-generate blogs from a completed scheduled task ──────────────────────

async function autoGenerateBlogs(
  agencyId: string,
  task: {
    id: string
    clientId: string | null
    verticalId: string | null
    label: string
    autoGenerateBlogCount: number
    assigneeId: string | null
  },
): Promise<void> {
  if (!task.clientId) return

  // Fetch research output
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
  if (!att?.extractedText) return

  // Brand voice + client name
  const [brandBuilder, client] = await Promise.all([
    prisma.clientBrandBuilder.findFirst({
      where: { clientId: task.clientId, agencyId },
      select: { dataJson: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.client.findFirst({ where: { id: task.clientId, agencyId }, select: { name: true } }),
  ])
  const brandData   = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
  const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')
  const clientName  = client?.name ?? ''

  // Extract source URLs
  const urlRegex  = /https?:\/\/[^\s\)\]\>"',]+/g
  const sourceUrls = [...new Set(
    (att.extractedText.match(urlRegex) ?? [])
      .map((u) => u.replace(/[.,;:!?)]+$/, ''))
      .filter((u) => u.length > 10 && !u.includes('fonts.googleapis')),
  )].slice(0, 20)

  const n = task.autoGenerateBlogCount

  const systemPrompt = `You are a content strategist and expert B2B blog writer${clientName ? ` for ${clientName}` : ''}.
Turn the research intelligence below into ${n} distinct, publication-ready blog posts.
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}
Each blog must take a different angle. No overlap in topic focus.

For EACH blog:
- Title: compelling, SEO-friendly
- 700–950 words, structured with a strong intro, 3–4 H2 sections, conclusion
- Cite sources inline as [source: domain.com]
- End with a ## Sources section listing the actual URLs used

For EACH blog also write:
- LinkedIn post (150–200 words): hook, 3 bullet takeaways, CTA
- Image prompt: professional blog header image description

Return ONLY valid JSON — no markdown fences:
{
  "blogs": [
    {
      "title": "string",
      "slug": "slug",
      "excerpt": "2-sentence summary",
      "content": "Full markdown with citations and ## Sources",
      "sources": ["url1", "url2"],
      "linkedIn": { "post": "string", "imagePrompt": "string" }
    }
  ]
}`

  const userPrompt = `Research task: ${task.label}
${sourceUrls.length > 0 ? `\nSource URLs:\n${sourceUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : ''}
--- RESEARCH OUTPUT ---
${att.extractedText.slice(0, 13000)}`

  const result = await callModel({ ...SONNET, system_prompt: systemPrompt }, userPrompt)

  let blogs: unknown[] = []
  try {
    // Strip markdown code fences then find the outer JSON object via brace matching
    let text = result.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const start = text.indexOf('{')
    if (start === -1) throw new Error('no opening brace')
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = start; i < text.length; i++) {
      if (esc) { esc = false; continue }
      if (inStr && text[i] === '\\') { esc = true; continue }
      if (text[i] === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { if (--depth === 0) { end = i; break } }
      }
    }
    if (end === -1) throw new Error('unclosed JSON object (possible truncation)')
    const p = JSON.parse(text.slice(start, end + 1)) as { blogs?: unknown[] }
    blogs = Array.isArray(p.blogs) ? p.blogs : []
  } catch (parseErr) {
    console.warn(`[auto-generate] JSON parse failed for task ${task.id}: ${parseErr instanceof Error ? parseErr.message : parseErr}`)
    console.warn(`[auto-generate] Response snippet (first 600 chars): ${result.text.slice(0, 600)}`)
    return
  }
  if (!blogs.length) return

  // Find or create "Content Hub" workflow for this client
  let workflow = await prisma.workflow.findFirst({
    where: { agencyId, clientId: task.clientId, name: 'Content Hub' },
    select: { id: true, defaultAssigneeId: true },
  })
  if (!workflow) {
    workflow = await prisma.workflow.create({
      data: {
        agencyId,
        clientId:         task.clientId,
        name:             'Content Hub',
        connectivityMode: 'online',
      },
      select: { id: true },
    })
  }

  const firstTitle = (blogs[0] as Record<string, unknown>)?.title as string | undefined
  const itemName = firstTitle
    ? `${firstTitle}${blogs.length > 1 ? ` (+${blogs.length - 1} more)` : ''}`
    : `Auto-generated blog${blogs.length > 1 ? `s (${blogs.length})` : ''} — ${task.label}`

  await prisma.workflowRun.create({
    data: {
      agencyId,
      workflowId:   workflow.id,
      status:       'completed',
      reviewStatus: 'none',
      itemName,
      output: {
        generatedContent: true,
        sourceLabel:      task.label,
        autoGenerated:    true,
        blogs:            blogs,
      },
      ...(task.assigneeId ? { assigneeId: task.assigneeId } : workflow.defaultAssigneeId ? { assigneeId: workflow.defaultAssigneeId } : {}),
    },
  })

  console.log(`[auto-generate] task ${task.id} → ${blogs.length} blog(s) created, saved to review`)
}

async function generateProgramContent(
  agencyId: string,
  program: { id: string; clientId: string; name: string; type: string; contentConfig: unknown; assigneeId?: string | null },
  task: { id: string; label: string; clientId: string | null; verticalId: string | null; assigneeId: string | null },
): Promise<void> {
  const config = (program.contentConfig ?? {}) as {
    blogCount?: number; platforms?: string[]; generateImages?: boolean; imageStyle?: string
  }
  const blogCount   = config.blogCount   ?? 2
  const platforms   = config.platforms   ?? ['linkedin']
  const includeImgs = config.generateImages ?? false
  const imageStyle  = config.imageStyle ?? 'professional, clean, modern'

  // Fetch research content
  const att = await prisma.clientBrainAttachment.findFirst({
    where: {
      agencyId,
      clientId: task.clientId ?? undefined,
      source: 'scheduled',
      filename: `[Scheduled] ${task.label}`,
      ...(task.verticalId ? { verticalId: task.verticalId } : {}),
    },
    select: { extractedText: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!att?.extractedText) return

  const [brandBuilder, client] = await Promise.all([
    prisma.clientBrandBuilder.findFirst({
      where: { clientId: task.clientId ?? undefined, agencyId },
      select: { dataJson: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.client.findFirst({ where: { id: task.clientId ?? undefined, agencyId }, select: { name: true } }),
  ])
  const brandData   = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
  const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')
  const clientName  = client?.name ?? ''

  const platformInstructions = platforms.map((p) => {
    if (p === 'linkedin') return `LinkedIn post (150-200 words): hook, 3 bullet takeaways, CTA`
    if (p === 'facebook') return `Facebook post (100-150 words): conversational, relatable, question or CTA`
    if (p === 'instagram') return `Instagram caption (80-120 words + 5-8 hashtags): visual hook, punchy copy`
    return `${p} post (100-150 words)`
  }).join('\n')

  const systemPrompt = `You are a content strategist${clientName ? ` for ${clientName}` : ''} creating a content pack for a ${program.type.replace(/_/g, ' ')} program.
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}

Generate ${blogCount} blog post${blogCount > 1 ? 's' : ''} and matching social content from the research below.

For EACH blog:
- Title: compelling, SEO-friendly headline
- 700-950 words, structured with intro, 3-4 H2 sections, conclusion
- Cite sources inline as [source: domain.com]
- ## Sources section at end

For EACH blog also write:
${platformInstructions}
${includeImgs ? `\nFor EACH blog also write:
- Image prompt: professional blog header image (style: ${imageStyle})` : ''}

Return ONLY valid JSON:
{
  "blogs": [
    {
      "title": "string",
      "slug": "slug",
      "excerpt": "2-sentence summary",
      "content": "full markdown",
      "sources": ["url"],
      "social": {
        ${platforms.map((p) => `"${p}": { "post": "string"${p === 'instagram' ? ', "hashtags": ["string"]' : ''}${includeImgs ? ', "imagePrompt": "string"' : ''} }`).join(',\n        ')}
      }
    }
  ]
}`

  const result = await callModel({ ...SONNET, system_prompt: systemPrompt }, `Research task: ${task.label}\n\n--- RESEARCH ---\n${att.extractedText.slice(0, 13000)}`)

  let blogs: unknown[] = []
  try {
    let text = result.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const start = text.indexOf('{')
    if (start === -1) throw new Error('no opening brace')
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = start; i < text.length; i++) {
      if (esc) { esc = false; continue }
      if (inStr && text[i] === '\\') { esc = true; continue }
      if (text[i] === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { if (--depth === 0) { end = i; break } }
      }
    }
    if (end === -1) throw new Error('unclosed JSON')
    const p = JSON.parse(text.slice(start, end + 1)) as { blogs?: unknown[] }
    blogs = Array.isArray(p.blogs) ? p.blogs : []
  } catch (e) {
    console.warn(`[program-content] JSON parse failed for program ${program.id}: ${e instanceof Error ? e.message : e}`)
    return
  }
  if (!blogs.length) return

  // Find or create workflow for this program
  let workflow = await prisma.workflow.findFirst({
    where: { agencyId, clientId: task.clientId ?? undefined, name: program.name },
    select: { id: true, defaultAssigneeId: true },
  })
  if (!workflow) {
    workflow = await prisma.workflow.create({
      data: { agencyId, clientId: task.clientId, name: program.name, connectivityMode: 'online' },
      select: { id: true, defaultAssigneeId: true },
    })
  }

  const firstBlog = blogs[0] as Record<string, unknown>
  const itemName = typeof firstBlog?.title === 'string'
    ? `${firstBlog.title}${blogs.length > 1 ? ` (+${blogs.length - 1} more)` : ''}`
    : `${program.name} — ${task.label}`

  await prisma.workflowRun.create({
    data: {
      agencyId,
      workflowId: workflow.id,
      programId: program.id,
      status: 'completed',
      reviewStatus: 'none',
      itemName,
      output: {
        programContent: true,
        programId: program.id,
        programType: program.type,
        sourceLabel: task.label,
        blogs,
        platforms,
      },
      ...(task.assigneeId ? { assigneeId: task.assigneeId } : workflow.defaultAssigneeId ? { assigneeId: workflow.defaultAssigneeId } : {}),
    },
  })

  await prisma.program.update({
    where: { id: program.id },
    data: { lastRunAt: new Date() },
  }).catch(() => {})

  console.log(`[program-content] program ${program.id} (${program.name}) → ${blogs.length} blog(s) + social content saved to Pipeline`)
}

function computeNextRunAt(frequency: string, scheduledDay?: number | null): Date {
  const now = new Date()
  if (frequency === 'daily') return new Date(now.getTime() + 86_400_000)
  if (frequency === 'weekly') {
    if (scheduledDay != null) {
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

// Minimal fake context — research executors only need these fields
const FAKE_CTX: NodeExecutionContext = {
  workflowRunId: 'scheduled',
  agencyId: 'scheduled',
  nodeId: 'scheduled',
  workflowId: 'scheduled',
}

async function runResearch(
  type: string,
  config: Record<string, unknown>,
  usageCtx: { agencyId: string; clientId: string | null; taskId: string },
): Promise<string> {
  if (type === 'research_brief') {
    return runResearchBrief(
      config as unknown as ResearchBriefConfig,
      usageCtx.agencyId,
      usageCtx.clientId,
      usageCtx.taskId,
    )
  }

  if (type === 'thought_leader_social_sync') {
    const leadershipMemberId = config.leadershipMemberId as string | undefined
    if (!leadershipMemberId) throw new Error('thought_leader_social_sync requires config.leadershipMemberId')
    await runThoughtLeaderSocialSync(usageCtx.agencyId, leadershipMemberId)
    return `Social sync completed for member ${leadershipMemberId}`
  }

  let result: { output?: unknown } | null = null

  if (type === 'web_scrape') {
    result = await new DeepWebScrapeExecutor().execute(null, config, FAKE_CTX)
  } else if (type === 'review_miner') {
    result = await new ReviewMinerExecutor().execute(null, config, FAKE_CTX)
  } else if (type === 'audience_signal') {
    result = await new AudienceSignalExecutor().execute(null, config, FAKE_CTX)
  } else if (type === 'seo_intent') {
    result = await new SeoIntentExecutor().execute(null, config, FAKE_CTX)
  } else {
    throw new Error(`Unknown scheduled task type: ${type}`)
  }

  if (!result) throw new Error('Research executor returned null')
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
}

async function generateChangeSummary(prev: string, next: string): Promise<string> {
  const res = await callModel(
    SONNET,
    `Compare these two research outputs. Write 1-2 sentences summarising what is NEW or MEANINGFULLY DIFFERENT in the updated version. Focus on substance, not formatting.\n\nPREVIOUS:\n${prev.slice(0, 2000)}\n\nUPDATED:\n${next.slice(0, 2000)}\n\nChange summary:`,
  )
  return ((res as { text?: string; content?: string }).text ?? (res as { text?: string; content?: string }).content ?? '').trim()
}

async function writeToBrain(
  agencyId: string,
  scope: string,
  clientId: string | null,
  verticalId: string | null,
  label: string,
  output: string,
): Promise<void> {
  const scheduledLabel = `[Scheduled] ${label}`

  console.log(`[writeToBrain] scope=${scope} clientId=${clientId} verticalId=${verticalId} label="${scheduledLabel}"`)

  // Route on verticalId presence — ignore scope field which may be stale from old seeds
  if (clientId && verticalId) {
    console.log(`[writeToBrain] → vertical branch, writing to clientBrainAttachment with verticalId`)
    // Vertical-scoped: write to clientBrainAttachment with verticalId set
    const existing = await prisma.clientBrainAttachment.findFirst({
      where: { agencyId, clientId, verticalId, source: 'scheduled', filename: scheduledLabel },
    })
    if (existing) {
      await prisma.clientBrainAttachment.update({
        where: { id: existing.id },
        data: {
          extractedText: output,
          summary: output.slice(0, 3000),
          summaryStatus: 'ready',
          extractionStatus: 'ready',
        },
      })
    } else {
      await prisma.clientBrainAttachment.create({
        data: {
          agencyId,
          clientId,
          verticalId,
          filename: scheduledLabel,
          mimeType: 'text/plain',
          source: 'scheduled',
          uploadMethod: 'url',
          extractionStatus: 'ready',
          extractedText: output,
          summaryStatus: 'ready',
          summary: output.slice(0, 3000),
        },
      })
    }
    console.log(`[writeToBrain] ✓ vertical write complete`)
    await synthesiseClientContext(agencyId, clientId)
  } else if (clientId) {
    console.log(`[writeToBrain] → client branch (no vertical)`)
    // Client-scoped (no vertical): write to clientBrainAttachment without verticalId
    const existing = await prisma.clientBrainAttachment.findFirst({
      where: { agencyId, clientId, source: 'scheduled', filename: scheduledLabel, verticalId: null },
    })
    if (existing) {
      await prisma.clientBrainAttachment.update({
        where: { id: existing.id },
        data: { extractedText: output, summary: output.slice(0, 3000), summaryStatus: 'ready', extractionStatus: 'ready' },
      })
    } else {
      await prisma.clientBrainAttachment.create({
        data: {
          agencyId, clientId, filename: scheduledLabel, mimeType: 'text/plain',
          source: 'scheduled', uploadMethod: 'url', extractionStatus: 'ready',
          extractedText: output, summaryStatus: 'ready', summary: output.slice(0, 3000),
        },
      })
    }
    await synthesiseClientContext(agencyId, clientId)
  } else if (scope === 'company') {
    const existing = await prisma.agencyBrainAttachment.findFirst({
      where: { agencyId, uploadMethod: 'url', filename: scheduledLabel },
    })
    if (existing) {
      await prisma.agencyBrainAttachment.update({
        where: { id: existing.id },
        data: {
          extractedText: output,
          summary: output.slice(0, 3000),
          summaryStatus: 'ready',
          extractionStatus: 'ready',
        },
      })
    } else {
      await prisma.agencyBrainAttachment.create({
        data: {
          agencyId,
          filename: scheduledLabel,
          mimeType: 'text/plain',
          uploadMethod: 'url',
          extractionStatus: 'ready',
          extractedText: output,
          summaryStatus: 'ready',
          summary: output.slice(0, 3000),
        },
      })
    }
    // Re-synthesise agency brain context directly
    await synthesiseAgencyContext(agencyId)
  }
}

// ─── Manual program cycle (Run Now) ──────────────────────────────────────────

async function runManualProgramCycle(
  agencyId: string,
  programId: string,
  clientId: string | null,
): Promise<void> {
  const program = await prisma.program.findFirst({ where: { id: programId, agencyId } })
  if (!program) { console.warn(`[manual-program-cycle] program ${programId} not found`); return }

  const effectiveClientId = clientId ?? program.clientId
  if (!effectiveClientId) return

  // Prefer the most-recent scheduled brain attachment; fall back to any ready attachment
  const contextAtt = await prisma.clientBrainAttachment.findFirst({
    where: { agencyId, clientId: effectiveClientId, summaryStatus: 'ready', source: 'scheduled' },
    select: { extractedText: true, filename: true },
    orderBy: { createdAt: 'desc' },
  }) ?? await prisma.clientBrainAttachment.findFirst({
    where: { agencyId, clientId: effectiveClientId, summaryStatus: 'ready' },
    select: { extractedText: true, filename: true },
    orderBy: { createdAt: 'desc' },
  })

  // Fall back to GTM Framework data if no brain attachment exists
  let contextText = contextAtt?.extractedText ?? ''
  if (!contextText) {
    const frameworks = await prisma.clientFramework.findMany({
      where: { agencyId, clientId: effectiveClientId },
      select: { data: true, vertical: { select: { name: true } } },
    })
    if (frameworks.length > 0) {
      contextText = frameworks.map((fw) => {
        const d = fw.data as Record<string, unknown>
        const lines: string[] = [`=== GTM Framework: ${fw.vertical.name} ===`]
        const flatten = (obj: unknown, prefix = ''): void => {
          if (!obj || typeof obj !== 'object') return
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (Array.isArray(v)) {
              v.forEach((item, i) => flatten(item, `${prefix}${k}[${i}].`))
            } else if (v && typeof v === 'object') {
              flatten(v, `${prefix}${k}.`)
            } else if (typeof v === 'string' && v.trim()) {
              lines.push(`${prefix}${k}: ${v.trim()}`)
            }
          }
        }
        flatten(d)
        return lines.join('\n')
      }).join('\n\n')
    }
  }

  if (!contextText) {
    console.warn(`[manual-program-cycle] no brain context for client ${effectiveClientId}`)
    return
  }

  const [brandBuilder, client] = await Promise.all([
    prisma.clientBrandBuilder.findFirst({
      where: { clientId: effectiveClientId, agencyId },
      select: { dataJson: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.client.findFirst({ where: { id: effectiveClientId, agencyId }, select: { name: true } }),
  ])

  const brandData   = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
  const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')
  const clientName  = client?.name ?? ''

  const config = (program.contentConfig ?? {}) as {
    blogCount?: number; platforms?: string[]; generateImages?: boolean; imageStyle?: string
  }
  const blogCount  = config.blogCount  ?? 2
  const platforms  = config.platforms  ?? ['linkedin']
  const includeImgs = config.generateImages ?? false
  const imageStyle  = config.imageStyle ?? 'professional, clean, modern'

  const platformInstructions = platforms.map((p) => {
    if (p === 'linkedin')  return `LinkedIn post (150-200 words): hook, 3 bullet takeaways, CTA`
    if (p === 'facebook')  return `Facebook post (100-150 words): conversational, relatable, question or CTA`
    if (p === 'instagram') return `Instagram caption (80-120 words + 5-8 hashtags): visual hook, punchy copy`
    return `${p} post (100-150 words)`
  }).join('\n')

  const systemPrompt = `You are a content strategist${clientName ? ` for ${clientName}` : ''} creating a content pack for a ${program.type.replace(/_/g, ' ')} program.
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}
Generate ${blogCount} blog post${blogCount > 1 ? 's' : ''} and matching social content from the context below.
For EACH blog:
- Title: compelling, SEO-friendly headline
- 700-950 words, structured with intro, 3-4 H2 sections, conclusion
- Cite sources inline as [source: domain.com]
- ## Sources section at end
For EACH blog also write:
${platformInstructions}
${includeImgs ? `For EACH blog also write:\n- Image prompt: blog header (style: ${imageStyle})` : ''}
Return ONLY valid JSON:
{"blogs":[{"title":"string","slug":"slug","excerpt":"2-sentence summary","content":"full markdown","sources":["url"],"social":{${platforms.map((p) => `"${p}":{"post":"string"${p === 'instagram' ? ',"hashtags":["string"]' : ''}${includeImgs ? ',"imagePrompt":"string"' : ''}}`).join(',')}}}]}`

  const result = await callModel(
    { ...SONNET, system_prompt: systemPrompt },
    `Context: ${contextAtt?.filename ?? 'GTM Framework'}\n\n--- CONTEXT ---\n${contextText.slice(0, 13000)}`,
  )

  let blogs: unknown[] = []
  try {
    let text = result.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const start = text.indexOf('{')
    if (start === -1) throw new Error('no opening brace')
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = start; i < text.length; i++) {
      if (esc) { esc = false; continue }
      if (inStr && text[i] === '\\') { esc = true; continue }
      if (text[i] === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { if (--depth === 0) { end = i; break } }
      }
    }
    if (end === -1) throw new Error('unclosed JSON')
    const parsed = JSON.parse(text.slice(start, end + 1)) as { blogs?: unknown[] }
    blogs = Array.isArray(parsed.blogs) ? parsed.blogs : []
  } catch (e) {
    console.warn(`[manual-program-cycle] JSON parse failed for ${programId}: ${e instanceof Error ? e.message : e}`)
    return
  }
  if (!blogs.length) return

  // Find or create workflow for this program
  let workflow = await prisma.workflow.findFirst({
    where: { agencyId, clientId: effectiveClientId, name: program.name },
    select: { id: true, defaultAssigneeId: true },
  })
  if (!workflow) {
    workflow = await prisma.workflow.create({
      data: { agencyId, clientId: effectiveClientId, name: program.name, connectivityMode: 'online' },
      select: { id: true, defaultAssigneeId: true },
    })
  }

  const firstBlog  = blogs[0] as Record<string, unknown>
  const cycleLabel = `Manual run — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  const itemName   = typeof firstBlog?.title === 'string'
    ? `${firstBlog.title}${blogs.length > 1 ? ` (+${blogs.length - 1} more)` : ''}`
    : `${program.name} — Manual run`

  const assigneeId = workflow.defaultAssigneeId ?? null

  // Pipeline card (WorkflowRun)
  await prisma.workflowRun.create({
    data: {
      agencyId,
      workflowId:   workflow.id,
      programId:    program.id,
      status:       'completed',
      reviewStatus: 'none',
      itemName,
      output: {
        programContent: true,
        programId:   program.id,
        programType: program.type,
        sourceLabel: cycleLabel,
        blogs,
        platforms,
      } as never,
      ...(assigneeId ? { assigneeId } : {}),
    },
  })

  // Content pack (visible in the Packs tab)
  const pack = await prisma.programContentPack.create({
    data: {
      agencyId,
      clientId:   effectiveClientId,
      programId:  program.id,
      cycleLabel,
      status:      'completed',
      reviewStatus: 'none',
      ...(assigneeId ? { assigneeId } : {}),
    },
  })

  let sortOrder = 0
  for (const blog of blogs as Record<string, unknown>[]) {
    const blogTitle = String(blog.title ?? 'Blog Post')
    await prisma.programContentItem.create({
      data: {
        packId:    pack.id,
        itemType:  'blog',
        label:     blogTitle,
        content:   String(blog.content ?? ''),
        sortOrder: sortOrder++,
        isTemplate: false,
        metadata: { slug: blog.slug, excerpt: blog.excerpt, sources: blog.sources } as never,
      },
    })
    const social = blog.social as Record<string, Record<string, unknown>> | undefined
    if (social) {
      for (const platform of platforms) {
        const post = social[platform]
        if (post?.post) {
          await prisma.programContentItem.create({
            data: {
              packId:    pack.id,
              itemType:  'social',
              label:     `${platform.charAt(0).toUpperCase() + platform.slice(1)} — ${blogTitle}`,
              content:   String(post.post),
              sortOrder: sortOrder++,
              isTemplate: false,
              metadata: { platform, ...(post.hashtags ? { hashtags: post.hashtags } : {}) } as never,
            },
          })
        }
      }
    }
  }

  await prisma.program.update({ where: { id: program.id }, data: { lastRunAt: new Date() } }).catch(() => {})
  console.log(`[manual-program-cycle] ${program.name} → ${blogs.length} blog(s) → Pipeline + ContentPack created`)
}

// ─── Topic Preference Profile Updater ────────────────────────────────────────

export async function updateTopicPreferenceProfile(
  agencyId: string,
  clientId: string,
  verticalId: string | null,
): Promise<void> {
  const count = await prisma.topicPreferenceLog.count({
    where: { agencyId, clientId, ...(verticalId ? { verticalId } : {}) },
  })
  // Only update on every 10th decision
  if (count === 0 || count % 10 !== 0) return

  const recent = await prisma.topicPreferenceLog.findMany({
    where: { agencyId, clientId, ...(verticalId ? { verticalId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { title: true, summary: true, score: true, decision: true },
  })

  const existing = await prisma.clientBrainAttachment.findFirst({
    where: {
      agencyId,
      clientId,
      source: 'scheduled',
      filename: `[Preference] topic_preference_profile:${verticalId ?? 'all'}`,
    },
    select: { extractedText: true },
  })
  const currentProfile = existing?.extractedText ?? ''

  const decisionLog = recent.map((d) =>
    `- Title: ${d.title}\n  Summary: ${d.summary}\n  Score: ${d.score}\n  Decision: ${d.decision}`,
  ).join('\n\n')

  const result = await callModel(
    { ...SONNET, system_prompt: undefined },
    `You maintain a topic preference profile for a content team.
Review their recent selections and update the profile.

CURRENT PROFILE:
${currentProfile || '(none — this is the first update)'}

RECENT DECISIONS (last 10):
${decisionLog}

Write an updated preference profile in plain English. Cover:
- Topic angles they consistently approve
- Topic angles they consistently reject
- Tone or framing preferences visible in approvals
- Patterns in the sources or publications they favor
- A diversity note: flag if approvals are becoming too narrow

Keep it under 200 words. Be specific. Use their actual topic titles as examples where relevant.
Return the profile text only. No preamble.`,
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
        agencyId,
        clientId,
        ...(verticalId ? { verticalId } : {}),
        filename: profileLabel,
        mimeType: 'text/plain',
        source: 'scheduled',
        uploadMethod: 'url',
        extractionStatus: 'ready',
        extractedText: profileText,
        summaryStatus: 'ready',
        summary: profileText.slice(0, 3000),
      },
    })
  }

  await synthesiseClientContext(agencyId, clientId)
  console.log(`[topic-preference] updated profile for client ${clientId} vertical ${verticalId ?? 'all'} (${count} decisions)`)
}

// ─── Topic Evaluator ──────────────────────────────────────────────────────────

interface TopicCandidate {
  title: string
  summary: string
  score: number
  score_rationale: string
  sources: Array<{ title: string; publication: string; url: string; publish_date: string }>
}

export async function runTopicEvaluator(
  agencyId: string,
  taskId: string,
  clientId: string,
  verticalId: string | null,
  researchOutput: string,
): Promise<void> {
  // Load brain context
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId },
    select: { brainContext: true, name: true },
  })
  const brainContext = client?.brainContext ?? ''

  // Load preference profile
  const prefAtt = await prisma.clientBrainAttachment.findFirst({
    where: {
      agencyId,
      clientId,
      source: 'scheduled',
      filename: `[Preference] topic_preference_profile:${verticalId ?? 'all'}`,
    },
    orderBy: { createdAt: 'desc' },
    select: { extractedText: true },
  })
  const preferenceProfile = prefAtt?.extractedText ?? ''

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const anthropic = new Anthropic({ apiKey, timeout: 5 * 60 * 1000, maxRetries: 0 })

  const userMessage = `CLIENT CONTEXT:
${brainContext || '(no brain context yet)'}

TOPIC PREFERENCE PROFILE:
${preferenceProfile || '(none — use vertical best practices as baseline)'}

RESEARCH OUTPUT:
${researchOutput.slice(0, 12000)}

Your task: Propose 5-10 blog topic candidates from this research.
For each topic return:
- title: A specific, publishable blog post title. Not generic.
- summary: 2-3 sentences — the exact angle, who it is for, and what the reader gets from it.
- score: 1-100 based on relevance to client, timeliness, differentiation, and match to the preference profile.
- score_rationale: One sentence explaining the score.
- sources: 2-4 sources supporting this topic. Each source must include title, publication, url, and publish_date.

Rules:
- Every topic must have at least 2 sources. Discard any topic that does not.
- Sources must come from the research output or from web search. Do not invent sources.
- Score against the preference profile if one exists. If not, score against vertical best practices.
- Include at least 2 topics outside the established approval pattern to prevent the topic range from narrowing over time.
- Return valid JSON only. No preamble, no markdown fencing.

Return format:
{
  "topics": [
    {
      "title": "",
      "summary": "",
      "score": 0,
      "score_rationale": "",
      "sources": [
        {
          "title": "",
          "publication": "",
          "url": "",
          "publish_date": ""
        }
      ]
    }
  ]
}`

  let responseText = ''
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: 'You are a content strategist evaluating research findings to identify the strongest blog topic candidates for a specific client.',
      tools: [{ type: 'web_search_20250305' as never, name: 'web_search', max_uses: 5 } as never],
      messages: [{ role: 'user', content: userMessage }],
    })

    responseText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  } catch (err) {
    // If web_search tool is unavailable, fall back to plain call
    console.warn('[topic-evaluator] web_search tool unavailable, falling back to plain call:', err instanceof Error ? err.message : err)
    const fallback = await callModel(
      {
        ...SONNET,
        system_prompt: 'You are a content strategist evaluating research findings to identify the strongest blog topic candidates for a specific client.',
        max_tokens: 8000,
      },
      userMessage,
    )
    responseText = fallback.text
  }

  // Parse JSON response
  let topics: TopicCandidate[] = []
  try {
    const text = responseText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const start = text.indexOf('{')
    if (start === -1) throw new Error('no opening brace')
    let depth = 0, inStr = false, esc = false, end = -1
    for (let i = start; i < text.length; i++) {
      if (esc) { esc = false; continue }
      if (inStr && text[i] === '\\') { esc = true; continue }
      if (text[i] === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { if (--depth === 0) { end = i; break } }
      }
    }
    if (end === -1) throw new Error('unclosed JSON')
    const parsed = JSON.parse(text.slice(start, end + 1)) as { topics?: TopicCandidate[] }
    topics = Array.isArray(parsed.topics) ? parsed.topics : []
  } catch (parseErr) {
    console.warn(`[topic-evaluator] JSON parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`)
    console.warn(`[topic-evaluator] Response snippet: ${responseText.slice(0, 400)}`)
    return
  }

  // Filter: must have at least 2 sources
  const valid = topics.filter((t) => Array.isArray(t.sources) && t.sources.length >= 2)
  if (valid.length === 0) {
    console.warn(`[topic-evaluator] no valid topics after source filter (had ${topics.length} before filter)`)
    return
  }

  // Write to TopicQueue
  for (const t of valid) {
    await prisma.topicQueue.create({
      data: {
        agencyId,
        clientId,
        ...(verticalId ? { verticalId } : {}),
        scheduledTaskId: taskId,
        title: t.title,
        summary: t.summary,
        score: Math.min(100, Math.max(0, Number(t.score) || 0)),
        scoreRationale: t.score_rationale ?? '',
        sources: t.sources as never,
        status: 'pending',
      },
    })
  }

  // Pipeline card: "Topic Review" batch card
  if (clientId) {
    try {
      const reviewWorkflow = await prisma.workflow.findFirst({
        where: { agencyId, clientId, name: 'Topic Review' },
        select: { id: true, defaultAssigneeId: true },
      }) ?? await prisma.workflow.create({
        data: { agencyId, clientId, name: 'Topic Review', connectivityMode: 'online' },
        select: { id: true, defaultAssigneeId: true },
      })

      const task = await prisma.scheduledTask.findFirst({ where: { id: taskId, agencyId }, select: { label: true, assigneeId: true } })

      await prisma.workflowRun.create({
        data: {
          agencyId,
          workflowId: reviewWorkflow.id,
          status: 'completed',
          reviewStatus: 'none',
          itemName: `Topic Review: ${task?.label ?? 'Research run'} — ${valid.length} candidates`,
          output: {
            topicReview: true,
            topicCount: valid.length,
            scheduledTaskId: taskId,
            clientId,
            verticalId,
          },
          ...(task?.assigneeId
            ? { assigneeId: task.assigneeId }
            : reviewWorkflow.defaultAssigneeId
              ? { assigneeId: reviewWorkflow.defaultAssigneeId }
              : {}),
        },
      })
    } catch (cardErr) {
      console.error('[topic-evaluator] Pipeline card creation failed:', cardErr)
    }
  }

  console.log(`[topic-evaluator] task ${taskId} → ${valid.length} topic candidates written to queue`)
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runScheduledResearch(job: { data: ScheduledResearchJobData }): Promise<void> {
  const { taskId, agencyId } = job.data

  // Manual "Run Now" from Programs — branch out before scheduled-task logic
  if (job.data.manual && job.data.programId) {
    await withAgency(agencyId, () =>
      runManualProgramCycle(agencyId, job.data.programId!, job.data.clientId ?? null),
    )
    return
  }

  await withAgency(agencyId, async () => {
    const task = await prisma.scheduledTask.findFirst({
      where: { id: taskId, agencyId },
    })
    if (!task) {
      console.warn(`[scheduled-research] task ${taskId} not found`)
      return
    }

    await prisma.scheduledTask.update({ where: { id: taskId }, data: { lastStatus: 'running' } })

    try {
      const config = task.config as Record<string, unknown>
      const output = await runResearch(task.type, config, {
        agencyId,
        clientId: task.clientId,
        taskId,
      })

      // Always write to brain (idempotent upsert) so re-runs fix any stale vertical routing
      await writeToBrain(agencyId, task.scope, task.clientId, task.verticalId, task.label, output)

      const newHash = createHash('sha256').update(output).digest('hex')
      const changed = task.lastOutputHash !== newHash
      let changeSummary: string | null = null

      if (changed) {
        // Generate change summary (skip on first run — no previous hash)
        if (task.lastOutputHash) {
          // Fetch previous content for comparison
          const prevAttachment = task.clientId
            ? await prisma.clientBrainAttachment.findFirst({
                where: {
                  agencyId,
                  clientId: task.clientId,
                  source: 'scheduled',
                  filename: `[Scheduled] ${task.label}`,
                },
                select: { extractedText: true },
              })
            : null
          const prevContent = prevAttachment?.extractedText ?? ''
          if (prevContent) {
            changeSummary = await generateChangeSummary(prevContent, output)
          } else {
            changeSummary = 'Research data updated.'
          }
        } else {
          changeSummary = 'Initial research data collected.'
        }
      }

      await prisma.scheduledTask.update({
        where: { id: taskId },
        data: {
          lastStatus: 'success',
          lastRunAt: new Date(),
          nextRunAt: computeNextRunAt(task.frequency, task.scheduledDay),
          lastOutputHash: newHash,
          ...(changed && { changeDetected: true, lastChangeSummary: changeSummary }),
        },
      })

      console.log(`[scheduled-research] task ${taskId} complete — changed=${changed}`)

      // Create a Pipeline card for the research report itself so it shows up for review
      if (task.clientId) {
        try {
          const researchWorkflow = await prisma.workflow.findFirst({
            where: { agencyId, clientId: task.clientId, name: 'Research Reports' },
            select: { id: true, defaultAssigneeId: true },
          }) ?? await prisma.workflow.create({
            data: {
              agencyId,
              clientId:         task.clientId,
              name:             'Research Reports',
              connectivityMode: 'online',
            },
            select: { id: true, defaultAssigneeId: true },
          })
          await prisma.workflowRun.create({
            data: {
              agencyId,
              workflowId:   researchWorkflow.id,
              status:       'completed',
              reviewStatus: 'none',
              itemName:     `Research: ${task.label}`,
              output: {
                researchReport: true,
                sourceLabel:    task.label,
                content:        output.slice(0, 50000),
              },
              ...(task.assigneeId
                ? { assigneeId: task.assigneeId }
                : researchWorkflow.defaultAssigneeId
                  ? { assigneeId: researchWorkflow.defaultAssigneeId }
                  : {}),
            },
          })
        } catch (reportErr) {
          const msg = reportErr instanceof Error ? reportErr.message : String(reportErr)
          console.error(`[scheduled-research] task ${taskId} Pipeline card creation failed:`, reportErr)
          await prisma.scheduledTask.update({ where: { id: taskId }, data: { lastChangeSummary: `[pipeline-error] ${msg}` } }).catch(() => {})
        }
      }

      // Content mode dispatch — auto_generate (existing) or evaluate_and_queue (new)
      const contentMode = (task as unknown as { contentMode?: string }).contentMode ?? (task.autoGenerate ? 'auto_generate' : 'off')

      if (contentMode === 'auto_generate' && task.clientId) {
        try {
          await autoGenerateBlogs(agencyId, {
            id: taskId,
            clientId: task.clientId,
            verticalId: task.verticalId,
            label: task.label,
            autoGenerateBlogCount: task.autoGenerateBlogCount,
            assigneeId: task.assigneeId,
          })
        } catch (genErr) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr)
          console.error(`[auto-generate] task ${taskId} blog generation failed:`, genErr)
          await prisma.scheduledTask.update({ where: { id: taskId }, data: { lastChangeSummary: `[blog-error] ${msg}` } }).catch(() => {})
        }
      } else if (contentMode === 'evaluate_and_queue' && task.clientId) {
        try {
          await runTopicEvaluator(agencyId, taskId, task.clientId, task.verticalId, output)
        } catch (evalErr) {
          const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
          console.error(`[topic-evaluator] task ${taskId} evaluation failed:`, evalErr)
          await prisma.scheduledTask.update({ where: { id: taskId }, data: { lastChangeSummary: `[eval-error] ${msg}` } }).catch(() => {})
        }
      }

      // Generate content packs for any linked Programs — non-fatal
      if (task.clientId) {
        const linkedPrograms = await prisma.program.findMany({
          where: { agencyId, scheduledTaskId: taskId, status: 'active' },
        }).catch(() => [] as Awaited<ReturnType<typeof prisma.program.findMany>>)
        for (const program of linkedPrograms) {
          try {
            await generateProgramContent(agencyId, program, task)
          } catch (progErr) {
            console.error(`[program-content] program ${program.id} failed:`, progErr)
          }
        }
      }
    } catch (err) {
      console.error(`[scheduled-research] task ${taskId} failed:`, err)
      await prisma.scheduledTask.update({
        where: { id: taskId },
        data: {
          lastStatus: 'failed',
          lastRunAt: new Date(),
          nextRunAt: computeNextRunAt(task.frequency, task.scheduledDay),
        },
      })
      throw err
    }
  })
}

export async function runResearchChecker(): Promise<void> {
  const now = new Date()
  const dueTasks = await prisma.scheduledTask.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, lastStatus: { not: 'running' } },
    select: { id: true, agencyId: true },
  })

  if (dueTasks.length === 0) return
  console.log(`[research-checker] ${dueTasks.length} task(s) due`)

  for (const task of dueTasks) {
    await researchQueue.add(
      'run-research',
      { taskId: task.id, agencyId: task.agencyId },
      {
        jobId: `research-${task.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'fixed', delay: 10000 },
      },
    )
  }
}
