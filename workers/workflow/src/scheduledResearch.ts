import { createHash } from 'node:crypto'
import { prisma, withAgency } from '@contentnode/database'
import { callModel, type ModelConfig } from '@contentnode/ai'
import {
  createQueue,
  QUEUE_SCHEDULED_RESEARCH,
  type ScheduledResearchJobData,
} from './queues.js'
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
import type { NodeExecutionContext } from './executors/base.js'

const HAIKU: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.2,
  max_tokens: 512,
}

function computeNextRunAt(frequency: string): Date {
  const now = new Date()
  if (frequency === 'daily') return new Date(now.getTime() + 86_400_000)
  if (frequency === 'monthly') return new Date(now.getTime() + 30 * 86_400_000)
  return new Date(now.getTime() + 7 * 86_400_000) // weekly default
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
    HAIKU,
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

export async function runScheduledResearch(job: { data: ScheduledResearchJobData }): Promise<void> {
  const { taskId, agencyId } = job.data

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

      const newHash = createHash('sha256').update(output).digest('hex')
      const changed = task.lastOutputHash !== newHash
      let changeSummary: string | null = null

      if (changed) {
        // Write updated research to brain
        await writeToBrain(agencyId, task.scope, task.clientId, task.verticalId, task.label, output)

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
          nextRunAt: computeNextRunAt(task.frequency),
          lastOutputHash: newHash,
          ...(changed && { changeDetected: true, lastChangeSummary: changeSummary }),
        },
      })

      console.log(`[scheduled-research] task ${taskId} complete — changed=${changed}`)
    } catch (err) {
      console.error(`[scheduled-research] task ${taskId} failed:`, err)
      await prisma.scheduledTask.update({
        where: { id: taskId },
        data: {
          lastStatus: 'failed',
          lastRunAt: new Date(),
          nextRunAt: computeNextRunAt(task.frequency),
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

  const queue = createQueue<ScheduledResearchJobData>(QUEUE_SCHEDULED_RESEARCH)
  for (const task of dueTasks) {
    await queue.add(
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
