import Anthropic from '@anthropic-ai/sdk'
import { prisma, withAgency } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { synthesiseClientContext } from './clientBrainExtraction.js'
import type { NewsroomResearchJobData } from './queues.js'

const SONNET = { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', api_key_ref: 'ANTHROPIC_API_KEY', temperature: 0.4, max_tokens: 2000 }

// ── JSON extractor (same safe parser used throughout scheduledResearch.ts) ────
interface TopicCandidate {
  title: string
  summary: string
  score: number
  score_rationale: string
  sources: Array<{ title: string; publication: string; url: string; publish_date: string }>
}

function parseTopics(raw: string): TopicCandidate[] {
  try {
    const text = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const start = text.indexOf('{')
    if (start === -1) return []
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
    if (end === -1) return []
    const obj = JSON.parse(text.slice(start, end + 1)) as { topics?: TopicCandidate[] }
    return Array.isArray(obj.topics) ? obj.topics : []
  } catch {
    return []
  }
}

// ── Step helper — update ResearchJob status ────────────────────────────────────
async function setStep(jobId: string, status: string, currentStep: string) {
  await prisma.researchJob.update({ where: { id: jobId }, data: { status, currentStep } }).catch(() => {})
}

// ── Main research handler ──────────────────────────────────────────────────────
export async function runNewsroomResearch(job: { data: NewsroomResearchJobData }): Promise<void> {
  const { agencyId, clientId, verticalId, userId, jobId, recencyWindow } = job.data

  await withAgency(agencyId, async () => {
    // Mark started
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { status: 'building', currentStep: 'Building your research brief', startedAt: new Date() },
    })

    try {
      // ── Fetch client + vertical context ──────────────────────────────────────
      const [client, vertical] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true, brainContext: true } }),
        verticalId ? prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true } }) : null,
      ])
      if (!client) {
        await prisma.researchJob.update({ where: { id: jobId }, data: { status: 'failed', errorMessage: 'Client not found', completedAt: new Date() } })
        return
      }

      const researchJob = await prisma.researchJob.findFirst({ where: { id: jobId }, select: { userInput: true } })
      const userInput = researchJob?.userInput ?? ''
      const recencyLabel = recencyWindow === '7d' ? 'last 7 days' : recencyWindow === '30d' ? 'last 30 days' : 'last 90 days'

      // ── Step A: build focused research prompt ─────────────────────────────────
      const promptResult = await callModel(
        SONNET,
        `You are a research strategist for a content agency.

CLIENT: ${client.name}
${vertical ? `VERTICAL / SOLUTION STACK: ${vertical.name}` : ''}
${client.brainContext ? `BRAIN CONTEXT SUMMARY: ${client.brainContext.slice(0, 1000)}` : ''}
RECENCY WINDOW: ${recencyLabel}

The user wants to find blog topic angles on the following:
"${userInput}"

Convert this into a focused research prompt that:
- Specifies exactly what to search for and why it matters to this client
- Names relevant sources, publications, analysts, or data types to prioritize
- Includes the recency instruction (${recencyLabel})
- Is written for a web search agent, not a human researcher
- Stays under 200 words

Return the research prompt text only. No preamble.`,
      )
      const researchPrompt = promptResult.text.trim()

      // ── Step B: web search research ───────────────────────────────────────────
      await setStep(jobId, 'searching', 'Searching the web for sources')

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

      const anthropic = new Anthropic({ apiKey, timeout: 5 * 60 * 1000, maxRetries: 0 })

      let researchOutput = ''
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: 'You are a research analyst finding the most relevant, recent content on a given topic for a B2B content team. Use web search to find real articles, data, and expert commentary. Summarise your findings in a detailed research brief with specific source URLs, publication names, and publish dates.',
          tools: [{ type: 'web_search_20250305' as never, name: 'web_search', max_uses: 10 } as never],
          messages: [{ role: 'user', content: researchPrompt }],
        })
        researchOutput = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
      } catch {
        const fallback = await callModel({ ...SONNET, max_tokens: 4000 }, researchPrompt)
        researchOutput = fallback.text
      }

      if (!researchOutput.trim()) throw new Error('Research produced no output')

      // ── Step C: write to brain ────────────────────────────────────────────────
      await setStep(jobId, 'evaluating', 'Evaluating topic candidates')

      const brainLabel = `[Manual Newsroom] ${userInput.slice(0, 80)}`
      const existingAtt = await prisma.clientBrainAttachment.findFirst({
        where: { agencyId, clientId, source: 'scheduled', filename: brainLabel, ...(verticalId ? { verticalId } : { verticalId: null }) },
      })
      if (existingAtt) {
        await prisma.clientBrainAttachment.update({
          where: { id: existingAtt.id },
          data: { extractedText: researchOutput, summary: researchOutput.slice(0, 3000), summaryStatus: 'ready', extractionStatus: 'ready' },
        })
      } else {
        await prisma.clientBrainAttachment.create({
          data: {
            agencyId, clientId, ...(verticalId ? { verticalId } : {}),
            filename: brainLabel, mimeType: 'text/plain', source: 'scheduled',
            uploadMethod: 'url', extractionStatus: 'ready',
            extractedText: researchOutput, summaryStatus: 'ready', summary: researchOutput.slice(0, 3000),
          },
        })
      }

      // Brain re-synthesis (worker can call directly — same process)
      await synthesiseClientContext(agencyId, clientId).catch((err) =>
        console.error('[newsroom-research] brain synthesis failed:', err),
      )

      // ── Step D: evaluate topics ───────────────────────────────────────────────
      await setStep(jobId, 'evaluating', 'Adding topics to your queue')

      const prefAtt = await prisma.clientBrainAttachment.findFirst({
        where: { agencyId, clientId, source: 'scheduled', filename: `[Preference] topic_preference_profile:${verticalId ?? 'all'}` },
        select: { extractedText: true },
      })
      const preferenceProfile = prefAtt?.extractedText ?? ''

      const evalMessage = `CLIENT CONTEXT:
${client.brainContext || '(no brain context yet)'}

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
- Score against the preference profile if one exists. If not, score against vertical best practices.
- Return valid JSON only. No preamble, no markdown fencing.

Return format:
{"topics":[{"title":"","summary":"","score":0,"score_rationale":"","sources":[{"title":"","publication":"","url":"","publish_date":""}]}]}`

      let evalText = ''
      try {
        const evalResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          system: 'You are a content strategist evaluating research findings to identify the strongest blog topic candidates for a specific client.',
          tools: [{ type: 'web_search_20250305' as never, name: 'web_search', max_uses: 5 } as never],
          messages: [{ role: 'user', content: evalMessage }],
        })
        evalText = evalResponse.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      } catch {
        const fb = await callModel({ ...SONNET, max_tokens: 6000 }, evalMessage)
        evalText = fb.text
      }

      const topics = parseTopics(evalText).filter((t) => Array.isArray(t.sources) && t.sources.length >= 2)

      const newTopicIds: string[] = []
      for (const t of topics) {
        const row = await prisma.topicQueue.create({
          data: {
            agencyId, clientId,
            ...(verticalId ? { verticalId } : {}),
            title: t.title, summary: t.summary,
            score: Math.min(100, Math.max(0, Number(t.score) || 0)),
            scoreRationale: t.score_rationale ?? '',
            sources: t.sources as never,
            status: 'pending',
          },
        })
        newTopicIds.push(row.id)
      }

      // ── Mark complete ─────────────────────────────────────────────────────────
      await prisma.researchJob.update({
        where: { id: jobId },
        data: {
          status: 'complete',
          currentStep: null,
          topicCount: topics.length,
          newTopicIds,
          completedAt: new Date(),
        },
      })

      // Update notification to complete
      if (userId) {
        await prisma.notification.updateMany({
          where: { agencyId, referenceId: jobId },
          data: {
            title: `${topics.length} topic${topics.length !== 1 ? 's' : ''} added to ${client.name} Newsroom`,
            referenceStatus: 'complete',
            read: false,
          },
        }).catch(() => {})
      }

      console.log(`[newsroom-research] job ${jobId} complete — ${topics.length} topics added for client ${clientId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[newsroom-research] job ${jobId} failed:`, err)

      await prisma.researchJob.update({
        where: { id: jobId },
        data: { status: 'failed', errorMessage: msg, completedAt: new Date() },
      }).catch(() => {})

      // Fetch client name for the failure notification
      const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }).catch((): null => null)

      if (userId) {
        await prisma.notification.updateMany({
          where: { agencyId, referenceId: jobId },
          data: {
            title: `Research failed for ${client?.name ?? 'client'} — tap to retry`,
            referenceStatus: 'failed',
            read: false,
          },
        }).catch(() => {})
      }

      throw err // rethrow so BullMQ marks the job as failed
    }
  })
}
