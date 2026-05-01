import type { Job } from 'bullmq'
import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import type { BriefExtractJobData } from './queues.js'

export async function extractBrief(job: Job<BriefExtractJobData>) {
  const { agencyId, clientId, briefId } = job.data

  const brief = await withAgency(agencyId, () =>
    prisma.clientBrief.findFirst({
      where: { id: briefId, agencyId, clientId },
    })
  )

  if (!brief) {
    console.warn(`[brief-extractor] brief ${briefId} not found`)
    return
  }

  if (!brief.rawInput) {
    console.warn(`[brief-extractor] brief ${briefId} has no rawInput — skipping`)
    return
  }

  await withAgency(agencyId, () =>
    prisma.clientBrief.update({
      where: { id: briefId },
      data: { extractionStatus: 'pending' },
    })
  )

  const client = await withAgency(agencyId, () =>
    prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true, industry: true } })
  )

  try {
    const { provider: rProv, model: rModel } = await getModelForRole('research_synthesis')
    const result = await callModel(
      {
        provider: rProv as 'anthropic' | 'openai' | 'ollama',
        model: rModel,
        api_key_ref: defaultApiKeyRefForProvider(rProv),
        max_tokens: 1500,
        temperature: 0.1,
      },
      `You are extracting a structured brief from a raw document or pasted text about a company, product, or solution.

CLIENT: ${client?.name ?? 'Unknown'}${client?.industry ? ` (${client.industry})` : ''}
BRIEF TYPE: ${brief.type}
BRIEF NAME: ${brief.name}

RAW INPUT:
${brief.rawInput}

Extract the following five fields from the content above. Output ONLY valid JSON — no markdown, no code fences, no explanation.

{
  "whatItIs": "Plain language description of what this is and what it does. No jargon.",
  "whoItsFor": "The specific buyer — job title, company type, situation. Not a broad market.",
  "problem": "The specific pain this solves in one sentence. What goes wrong without it.",
  "outcome": "What the buyer stops doing, starts doing, or does differently after using this. Specific enough for a headline.",
  "differentiator": "The one thing that is genuinely ownable — not true of every competitor.",
  "buyerContext": "Buyer job title, their situation, and what they are trying to achieve.",
  "content": "A clean 4-6 sentence brief ready to use as GTM strategy context. Must include: what it is, who it serves, problem solved, outcome delivered, and key differentiator."
}

Rules:
- Use specific language from the source document
- If a field cannot be determined from the content, return an empty string (not null)
- The "content" field is the final brief text that will be injected into AI sessions
- Do not invent claims not supported by the source document`
    )

    const extracted = JSON.parse(result.text.trim()) as {
      whatItIs: string
      whoItsFor: string
      problem: string
      outcome: string
      differentiator: string
      buyerContext: string
      content: string
    }

    await withAgency(agencyId, () =>
      prisma.clientBrief.update({
        where: { id: briefId },
        data: {
          extractedData: extracted as object,
          content: extracted.content || null,
          extractionStatus: 'ready',
          status: 'draft',
        },
      })
    )

    console.log(`[brief-extractor] brief ${briefId} extracted successfully`)
  } catch (err) {
    console.error(`[brief-extractor] extraction failed for ${briefId}:`, err)
    await withAgency(agencyId, () =>
      prisma.clientBrief.update({
        where: { id: briefId },
        data: { extractionStatus: 'failed', errorMessage: String(err) },
      })
    )
  }
}
