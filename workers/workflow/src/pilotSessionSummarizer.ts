import type { Job } from 'bullmq'
import { prisma, withAgency } from '@contentnode/database'
import { callModel }          from '@contentnode/ai'
import type { PilotSessionSummaryJobData } from './queues.js'

const MIN_MESSAGES_TO_SUMMARIZE = 6

const SUMMARY_SCHEMA = `{
  "decisions": ["Specific decision made — complete sentence with context", ...],
  "rejected": ["Option considered and rejected, with the reason — complete sentence", ...],
  "openQuestions": ["Unresolved question to pick up next session — complete sentence", ...]
}`

const MODEL_CONFIG = {
  provider:    'anthropic' as const,
  model:       'claude-sonnet-4-6',
  api_key_ref: 'ANTHROPIC_API_KEY',
  max_tokens:  1200,
  temperature: 0.1,
}

function cleanJson(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
}

async function writeFallbackToBrain(
  agencyId: string,
  clientId: string,
  verticalId: string,
  sessionId: string,
  transcript: string,
): Promise<void> {
  const filename = `PILOT Session Notes — ${sessionId.slice(0, 8)}.md`
  const content  = `# PILOT Session Notes\n\nThis session could not be auto-summarized. Full transcript preserved for context.\n\n${transcript}`

  await withAgency(agencyId, async () => {
    const existing = await prisma.clientBrainAttachment.findFirst({
      where: { clientId, agencyId, filename, source: 'pilot_session' },
      select: { id: true },
    })
    if (existing) {
      await prisma.clientBrainAttachment.update({
        where: { id: existing.id },
        data: {
          extractedText:    content,
          summary:          content,
          summaryStatus:    'ready',
          extractionStatus: 'done',
          sizeBytes:        content.length,
        },
      })
    } else {
      await prisma.clientBrainAttachment.create({
        data: {
          agencyId,
          clientId,
          verticalId,
          filename,
          source:           'pilot_session',
          mimeType:         'text/markdown',
          storageKey:       `brain/${clientId}/${filename}`,
          sizeBytes:        content.length,
          extractedText:    content,
          summary:          content,
          summaryStatus:    'ready',
          extractionStatus: 'done',
        },
      })
    }
  })

  console.log(`[pilot-summarizer] fallback transcript written to brain for session ${sessionId}`)
}

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

  const messages  = session.messages as Array<{ role: string; content: string }>
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  type Summary = { decisions: string[]; rejected: string[]; openQuestions: string[] }
  let summary: Summary

  // ── Attempt 1: normal call ───────────────────────────────────────────────
  let rawResponse = ''
  try {
    const result = await callModel(
      MODEL_CONFIG,
      `You are summarizing a gtmPILOT session — a strategic conversation where an agency team worked through a GTM Framework for a client.

Extract exactly three components. Respond with raw JSON only. Do not wrap your response in markdown code fences. Do not include any text before or after the JSON object.

${SUMMARY_SCHEMA}

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

    rawResponse = result.text
    const cleaned = cleanJson(rawResponse)

    try {
      summary = JSON.parse(cleaned) as Summary
    } catch (parseErr) {
      // ── Attempt 2: retry with stricter prompt ────────────────────────────
      console.warn(`[pilot-summarizer] JSON parse failed for ${sessionId} — retrying. Raw (first 500 chars): ${rawResponse.slice(0, 500)}`)

      const retryResult = await callModel(
        MODEL_CONFIG,
        `Your previous response contained invalid JSON. Respond with only a valid JSON object. No other text. No markdown. No trailing commas. No comments.

The object must have exactly these three keys, each an array of strings:

${SUMMARY_SCHEMA}

TRANSCRIPT:
${transcript}`
      )

      const retryCleaned = cleanJson(retryResult.text)

      try {
        summary = JSON.parse(retryCleaned) as Summary
        console.log(`[pilot-summarizer] retry succeeded for session ${sessionId}`)
      } catch (retryParseErr) {
        // ── Fallback: write raw transcript to brain ──────────────────────
        console.error(`[pilot-summarizer] retry also failed for ${sessionId} — writing fallback to brain. Retry raw: ${retryResult.text.slice(0, 500)}`)

        await writeFallbackToBrain(agencyId, clientId, verticalId, sessionId, transcript)

        await withAgency(agencyId, () =>
          prisma.pilotSession.update({
            where: { id: sessionId },
            data: {
              status:       'summarized',
              summarizedAt: new Date(),
              summary:      {
                decisions:     [],
                rejected:      [],
                openQuestions: [],
                fallbackNote:  'Auto-summary failed after retry. Full session notes saved to vertical brain.',
              },
            },
          })
        )
        return
      }
    }
  } catch (err) {
    console.error(`[pilot-summarizer] Claude call failed for ${sessionId}:`, err)
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
