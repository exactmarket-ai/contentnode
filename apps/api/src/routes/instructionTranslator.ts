import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getModelForRole } from '@contentnode/database'

const instructionObjectSchema = z.object({
  role_context: z.string(),
  audience: z.string(),
  tone: z.string(),
  strategic_direction: z.string(),
  visual_language: z.string(),
  constraints: z.array(z.string()),
  gaps: z.array(z.string()),
  confidence: z.record(z.enum(['direct', 'inferred', 'inherited'])),
})

const parseBody = z.object({
  raw_text: z.string().min(1).max(10000),
  baseline: instructionObjectSchema.optional(),
  text_contexts: z.array(z.object({ label: z.string(), content: z.string() })).optional(),
  file_hints: z.array(z.object({ label: z.string(), filename: z.string() })).optional(),
})

function buildPrompt(raw_text: string, baseline?: z.infer<typeof instructionObjectSchema>, text_contexts?: { label: string; content: string }[], file_hints?: { label: string; filename: string }[]): string {
  const hasBaseline = !!baseline
  const hasContext = (text_contexts?.length ?? 0) > 0 || (file_hints?.length ?? 0) > 0

  let prompt = ''

  if (hasBaseline) {
    prompt += `You are an expert content strategist. You have existing structured instructions (baseline) and a new brief. Your job is to UPDATE the baseline using the new brief — only change fields the brief explicitly addresses. Fields not mentioned in the brief should be carried forward unchanged with confidence "inherited".

Existing baseline instructions:
${JSON.stringify(baseline, null, 2)}

`
  } else {
    prompt += `You are an expert content strategist. Analyze the following brief, notes, or instructions and extract a structured instruction object.

`
  }

  if (hasContext) {
    prompt += `The following sources are connected to this workflow and their content IS available:\n`
    for (const ctx of text_contexts ?? []) {
      prompt += `\n[${ctx.label}]:\n${ctx.content.slice(0, 2000)}\n`
    }
    if ((file_hints?.length ?? 0) > 0) {
      prompt += `\nAttached documents (content will be provided at workflow runtime — do NOT list these as gaps):\n`
      for (const hint of file_hints ?? []) {
        prompt += `- "${hint.filename}" (from node: ${hint.label})\n`
      }
    }
    prompt += `\n`
  }

  prompt += `${hasBaseline ? 'New brief to merge in' : 'Brief / Notes'}:
${raw_text}

Return ONLY valid JSON with no markdown fences, matching this exact shape:
{
  "role_context": "...",
  "audience": "...",
  "tone": "...",
  "strategic_direction": "...",
  "visual_language": "...",
  "constraints": ["..."],
  "gaps": ["..."],
  "confidence": {
    "role_context": "direct",
    "audience": "inherited",
    "tone": "inferred",
    "strategic_direction": "direct",
    "visual_language": "inherited",
    "constraints": "direct",
    "gaps": "direct"
  }
}

Confidence values:
- "direct" — explicitly stated in the new brief
- "inferred" — derived from context in the new brief
- "inherited" — carried forward unchanged from the baseline${hasBaseline ? '' : ' (not applicable here)'}

If a field has no relevant information, use an empty string or empty array.
In the "gaps" array, list any information that is genuinely missing from the brief that would improve the AI's output — such as missing audience detail, unclear tone, no CTA, missing platform, etc. Be thorough: if something is vague or absent, flag it. The only exception: do not list attached documents or files as gaps, as those are already available in the workflow.`

  return prompt
}

export async function instructionTranslatorRoutes(app: FastifyInstance) {
  app.post<{ Body: z.infer<typeof parseBody> }>('/parse', async (req, reply) => {
    const body = parseBody.parse(req.body)
    const { raw_text, baseline, text_contexts, file_hints } = body

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY not configured' })
    }

    const prompt = buildPrompt(raw_text, baseline, text_contexts, file_hints)
    const { model: brainModel } = await getModelForRole('brain_processing')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: brainModel,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      req.log.error({ status: response.status }, 'Anthropic API error in instruction translator')
      return reply.status(502).send({ error: 'AI service unavailable' })
    }

    const aiResponse = await response.json() as { content: Array<{ text: string }> }
    const text = aiResponse.content?.[0]?.text ?? ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return reply.status(422).send({ error: 'Failed to parse brief — try rephrasing' })
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])
      return reply.send({ data: parsed })
    } catch {
      return reply.status(422).send({ error: 'Failed to parse brief — try rephrasing' })
    }
  })

  // ── POST /suggest-gap — suggest a value for a single missing field ──────────
  const suggestBody = z.object({
    raw_text: z.string().min(1).max(10000),
    gap: z.string().min(1),
    parsed: z.record(z.unknown()).optional(),
  })

  app.post<{ Body: z.infer<typeof suggestBody> }>('/suggest-gap', async (req, reply) => {
    const { raw_text, gap, parsed } = suggestBody.parse(req.body)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY not configured' })
    }
    const { model: brainModelSuggest } = await getModelForRole('brain_processing')

    const context = parsed
      ? Object.entries(parsed)
          .filter(([k, v]) => k !== 'gaps' && k !== 'confidence' && v && (typeof v === 'string' ? v.trim() : true))
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : v}`)
          .join('\n')
      : ''

    const prompt = `You are an expert content strategist helping to fill in missing information from a content brief.

Original brief:
${raw_text}

${context ? `What we already know:\n${context}\n` : ''}
Missing information: "${gap}"

Provide a concise, specific suggested value for this missing piece of information. Your suggestion should:
- Be realistic and actionable
- Fit naturally with what's already known about the brief
- Be 1-3 sentences maximum
- Not include any explanation or preamble — just the suggestion itself`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: brainModelSuggest,
        max_tokens: 200,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      return reply.status(502).send({ error: 'AI service unavailable' })
    }

    const aiResponse = await response.json() as { content: Array<{ text: string }> }
    const suggestion = aiResponse.content?.[0]?.text?.trim() ?? ''

    return reply.send({ suggestion })
  })
}
