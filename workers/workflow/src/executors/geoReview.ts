import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// GEO Review node executor (Generative Engine Optimization)
// Scores content 0-100 across 10 GEO criteria using Claude.
// In 'optimize' mode the runner injects GEO requirements into the upstream
// ai-generate prompt before this node runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface GEOBreakdownItem {
  criterion: string
  score: number   // 0-10
  note: string
}

export interface GEOReviewOutput {
  content: string
  score: number           // 0-100 (sum of 10 criteria, each 0-10)
  breakdown: GEOBreakdownItem[]
  mode: string
  not_applicable: boolean
  not_applicable_reason?: string
  action: string          // 'pass' | 'flag' | 'block' — the routing decision
  gated_note?: string     // advisory for gated content
}

const SHORT_FORM_TYPES = new Set([
  'linkedin-post', 'linkedin_post', 'linkedin post',
  'instagram-caption', 'instagram_caption', 'instagram caption',
  'ad-copy', 'ad_copy', 'ad copy',
  'cold-email', 'cold_email', 'cold email',
  'social-post', 'social_post', 'social post',
  'tweet', 'twitter',
  'sms',
])

const GATED_TYPES = new Set([
  'white-paper', 'white_paper', 'whitepaper',
])

function isShortForm(contentType: string): boolean {
  const n = contentType.toLowerCase().trim()
  if (SHORT_FORM_TYPES.has(n)) return true
  return (
    n.includes('linkedin') || n.includes('instagram') ||
    n.includes('ad-copy') || n.includes('ad copy') ||
    n.includes('social post') || n.includes('cold email')
  )
}

function isGated(contentType: string): boolean {
  const n = contentType.toLowerCase().trim()
  return GATED_TYPES.has(n) || n.includes('white paper') || n.includes('whitepaper')
}

function extractContent(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.text === 'string') return obj.text
  }
  return JSON.stringify(input)
}

const GEO_CRITERIA = [
  'Answer-first structure',
  'FAQ block',
  'Heading clarity',
  'Cited statistics',
  'Entity definitions',
  'Author authority signals',
  'E-E-A-T language',
  'Content freshness signals',
  'Structured answer density',
  'Citation coverage',
]

function buildGEOPrompt(content: string): string {
  return `You are an expert GEO (Generative Engine Optimization) content reviewer. Evaluate the following content against 10 GEO criteria — these are signals that help AI language models accurately cite and reference this content. Score each criterion 0–10 (0 = completely absent or failing, 10 = perfect). Provide a concise one-line note explaining what was found or missing for each.

Content to evaluate:
---
${content.slice(0, 8000)}
---

Scoring criteria:
1. Answer-first structure — Does the content answer its primary question in the first 30–50 words? (Do not build up to it.)
2. FAQ block — Is there a dedicated FAQ section with direct, self-contained answers of 35–55 words each?
3. Heading clarity — Are H2/H3 headings phrased as questions or direct statements matching how someone would ask an AI this topic?
4. Cited statistics — Does the content include at least one cited statistic or data point with a named source?
5. Entity definitions — Are key terms, products, or concepts defined explicitly within the content?
6. Author authority signals — Is there a named author with credentials or role indicated?
7. E-E-A-T language — Does the content use first-person experience language, specific examples, or direct expertise indicators rather than generic claims?
8. Content freshness signals — Does the content include a publication or last-updated date? Are statistics and examples current?
9. Structured answer density — What percentage of the content is in answer-extractable format (bullets, numbered lists, Q&A, definitions) vs. prose requiring interpretation? (0 = all prose, 10 = 50%+ structured)
10. Citation coverage — Does the first 30% of the content contain the core answer? (44% of LLM citations come from the first 30% of a piece)

Respond with valid JSON only — no markdown fences, no extra text:
{
  "criteria": [
    { "criterion": "Answer-first structure", "score": <0-10>, "note": "<one line>" },
    { "criterion": "FAQ block", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Heading clarity", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Cited statistics", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Entity definitions", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Author authority signals", "score": <0-10>, "note": "<one line>" },
    { "criterion": "E-E-A-T language", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Content freshness signals", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Structured answer density", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Citation coverage", "score": <0-10>, "note": "<one line>" }
  ]
}`
}

export class GeoReviewNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = extractContent(input)
    const mode = (config.mode as string) ?? 'optimize'
    const threshold = (config.threshold as number) ?? 70
    const belowAction = (config.below_threshold_action as string) ?? 'flag'
    const upstreamContentType = (config.upstream_content_type as string) ?? ''

    // Short-form content — not applicable
    if (isShortForm(upstreamContentType)) {
      return {
        output: {
          content,
          score: null,
          breakdown: [],
          mode,
          not_applicable: true,
          not_applicable_reason: 'Short-form content type — GEO evaluation does not apply',
          action: 'pass',
        },
        routePath: 'pass',
      }
    }

    const { model: reviewModel } = await getModelForRole('scoring_review')

    const modelConfig: ModelConfig = {
      provider: 'anthropic',
      model: reviewModel,
      api_key_ref: 'ANTHROPIC_API_KEY',
      system_prompt: 'You are an expert GEO content reviewer. Always respond with valid JSON only.',
      temperature: 0.2,
    }

    const result = await callModel(modelConfig, buildGEOPrompt(content))

    let breakdown: GEOBreakdownItem[]
    try {
      let json = result.text.trim()
      const fence = json.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/s)
      if (fence) json = fence[1].trim()
      const parsed = JSON.parse(json) as { criteria: GEOBreakdownItem[] }
      breakdown = parsed.criteria.map((c) => ({
        criterion: c.criterion,
        score: Math.max(0, Math.min(10, Math.round(Number(c.score) || 0))),
        note: c.note || '',
      }))
      if (breakdown.length !== GEO_CRITERIA.length) {
        const found = new Set(breakdown.map((b) => b.criterion))
        for (const crit of GEO_CRITERIA) {
          if (!found.has(crit)) breakdown.push({ criterion: crit, score: 0, note: 'Not evaluated' })
        }
      }
    } catch {
      breakdown = GEO_CRITERIA.map((c) => ({ criterion: c, score: 0, note: 'Could not parse evaluation' }))
    }

    const score = breakdown.reduce((sum, b) => sum + b.score, 0)  // 0-100

    let routePath: string
    if (score >= threshold) {
      routePath = 'pass'
    } else if (belowAction === 'pass_through') {
      routePath = 'pass'
    } else {
      routePath = belowAction  // 'flag' | 'block'
    }

    // Advisory note for gated content
    const gatedNote = isGated(upstreamContentType)
      ? 'Gated content has limited AI citation value. Consider an ungated summary or landing page as a companion asset.'
      : undefined

    return {
      output: {
        content,
        score,
        breakdown,
        mode,
        not_applicable: false,
        action: routePath,
        ...(gatedNote ? { gated_note: gatedNote } : {}),
      } satisfies GEOReviewOutput,
      routePath,
      tokensUsed: result.tokens_used,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed: result.model_used,
    }
  }
}
