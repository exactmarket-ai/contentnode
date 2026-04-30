import type { Job } from 'bullmq'
import { prisma, withAgency } from '@contentnode/database'
import { callModel }          from '@contentnode/ai'
import type { PilotSessionSummaryJobData } from './queues.js'

const MIN_MESSAGES_TO_SUMMARIZE = 6

export async function summarizePilotSession(job: Job<PilotSessionSummaryJobData>) {
  const { agencyId, clientId, verticalId, sessionId } = job.data

  const session = await withAgency(agencyId, () =>
    prisma.pilotSession.findFirst({
      where: { id: sessionId, agencyId, clientId, verticalId },
      select: { messages: true, messageCount: true, status: true },
    })
  )

  if (!session) {
    console.warn(`[pilot-summarizer] session ${sessionId} not found`)
    return
  }
  if (session.messageCount < MIN_MESSAGES_TO_SUMMARIZE) {
    console.log(`[pilot-summarizer] session ${sessionId} too short (${session.messageCount} messages) — skipping`)
    return
  }

  await withAgency(agencyId, () =>
    prisma.pilotSession.update({
      where: { id: sessionId },
      data: { status: 'summarizing' },
    })
  )

  const messages = session.messages as Array<{ role: string; content: string }>
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  let summary: { decisions: string[]; rejected: string[]; openQuestions: string[] }

  try {
    const result = await callModel(
      {
        provider:    'anthropic',
        model:       'claude-sonnet-4-6',
        api_key_ref: 'ANTHROPIC_API_KEY',
        max_tokens:  1200,
        temperature: 0.1,
      },
      `You are summarizing a gtmPILOT session — a strategic conversation where an agency team worked through a GTM Framework for a client.

Extract exactly three components. Output valid JSON only — no markdown, no code fences, no explanation.

{
  "decisions": ["Specific decision made — complete sentence with context", ...],
  "rejected": ["Option considered and rejected, with the reason — complete sentence", ...],
  "openQuestions": ["Unresolved question to pick up next session — complete sentence", ...]
}

Rules:
- decisions: things the team committed to — specific positioning statements, named buyer personas, confirmed differentiators, agreed-on messaging, section content that was validated
- rejected: options that were explicitly or implicitly ruled out — include WHAT was rejected AND WHY
- openQuestions: threads raised but not resolved — the PILOT should pick these up at the start of the next session
- Use specific language from the transcript — do not paraphrase into generic terms
- If a category genuinely has no entries, return an empty array
- Maximum 5 items per category; prioritize the most strategically significant

TRANSCRIPT:
${transcript}`
    )

    summary = JSON.parse(result.text.trim()) as typeof summary
  } catch (err) {
    console.error(`[pilot-summarizer] Claude call or parse failed for ${sessionId}:`, err)
    await withAgency(agencyId, () =>
      prisma.pilotSession.update({
        where: { id: sessionId },
        data: { status: 'failed' },
      })
    )
    return
  }

  await withAgency(agencyId, () =>
    prisma.pilotSession.update({
      where: { id: sessionId },
      data: { summary, status: 'summarized', summarizedAt: new Date() },
    })
  )

  console.log(`[pilot-summarizer] session ${sessionId} summarized — ${summary.decisions.length} decisions, ${summary.rejected.length} rejected, ${summary.openQuestions.length} open`)
}
