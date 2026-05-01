import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// SEO Review node executor
// Scores content 0-100 across 10 SEO criteria using Claude.
// In 'optimize' mode the runner injects SEO requirements into the upstream
// ai-generate prompt before this node runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface SEOBreakdownItem {
  criterion: string
  score: number   // 0-10
  note: string
}

export interface SEOReviewOutput {
  content: string
  score: number           // 0-100 (sum of 10 criteria, each 0-10)
  breakdown: SEOBreakdownItem[]
  mode: string
  not_applicable: boolean
  not_applicable_reason?: string
  action: string          // 'pass' | 'flag' | 'block' — the routing decision
}

// Short-form content types that bypass SEO/GEO evaluation entirely
const SHORT_FORM_TYPES = new Set([
  'linkedin-post', 'linkedin_post', 'linkedin post',
  'instagram-caption', 'instagram_caption', 'instagram caption',
  'ad-copy', 'ad_copy', 'ad copy',
  'cold-email', 'cold_email', 'cold email',
  'social-post', 'social_post', 'social post',
  'tweet', 'twitter',
  'sms',
])

function isShortForm(contentType: string): boolean {
  const normalized = contentType.toLowerCase().trim()
  if (SHORT_FORM_TYPES.has(normalized)) return true
  return (
    normalized.includes('linkedin') ||
    normalized.includes('instagram') ||
    normalized.includes('ad-copy') ||
    normalized.includes('ad copy') ||
    normalized.includes('social post') ||
    normalized.includes('cold email')
  )
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

const SEO_CRITERIA = [
  'Title tag / H1 presence',
  'Keyword placement',
  'Heading structure',
  'Meta description',
  'Internal link signals',
  'Content depth',
  'Keyword density',
  'Readability',
  'Alt text signals',
  'Schema readiness',
]

function buildSEOPrompt(content: string, targetKeyword: string): string {
  const kwSection = targetKeyword
    ? `Target keyword: "${targetKeyword}"`
    : 'Target keyword: not specified'

  return `You are an expert SEO content reviewer. Evaluate the following content against 10 SEO criteria. Score each criterion 0–10 (0 = completely absent or failing, 10 = perfect). Provide a concise one-line note explaining what was found or missing for each.

${kwSection}

Content to evaluate:
---
${content.slice(0, 8000)}
---

Scoring criteria:
1. Title tag / H1 presence — Does the content have a clear primary heading that includes or closely matches the target keyword?
2. Keyword placement — Does the target keyword or close variant appear in the first 100 words?
3. Heading structure — Are H2s and H3s used to organize the content and cover related subtopics?
4. Meta description — Is a meta description present? Is it 150–160 characters and does it include the keyword?
5. Internal link signals — Are there anchor text references that suggest internal linking opportunities?
6. Content depth — Does the content cover the topic with sufficient depth relative to its type? (Blog: 800+ words, White paper: 1500+, FAQ: complete answers)
7. Keyword density — Is the keyword used naturally without stuffing? (Target: 1–2% density)
8. Readability — Is the content structured for scannability? Short paragraphs, bullets where appropriate?
9. Alt text signals — If image placeholders exist, are they labeled for alt text?
10. Schema readiness — Does the content structure map cleanly to a schema type (Article, FAQPage, HowTo)?

Respond with valid JSON only — no markdown fences, no extra text:
{
  "criteria": [
    { "criterion": "Title tag / H1 presence", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Keyword placement", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Heading structure", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Meta description", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Internal link signals", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Content depth", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Keyword density", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Readability", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Alt text signals", "score": <0-10>, "note": "<one line>" },
    { "criterion": "Schema readiness", "score": <0-10>, "note": "<one line>" }
  ]
}`
}

export class SeoReviewNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = extractContent(input)
    const mode = (config.mode as string) ?? 'optimize'
    const threshold = (config.threshold as number) ?? 70
    const belowAction = (config.below_threshold_action as string) ?? 'flag'
    const targetKeyword = (config.target_keyword as string) ?? ''
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
          not_applicable_reason: 'Short-form content type — SEO evaluation does not apply',
          action: 'pass',
        } satisfies Omit<SEOReviewOutput, 'score'> & { score: null },
        routePath: 'pass',
      }
    }

    const { model: reviewModel } = await getModelForRole('scoring_review')

    const modelConfig: ModelConfig = {
      provider: 'anthropic',
      model: reviewModel,
      api_key_ref: 'ANTHROPIC_API_KEY',
      system_prompt: 'You are an expert SEO content reviewer. Always respond with valid JSON only.',
      temperature: 0.2,
    }

    const result = await callModel(modelConfig, buildSEOPrompt(content, targetKeyword))

    let breakdown: SEOBreakdownItem[]
    try {
      let json = result.text.trim()
      const fence = json.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/s)
      if (fence) json = fence[1].trim()
      const parsed = JSON.parse(json) as { criteria: SEOBreakdownItem[] }
      breakdown = parsed.criteria.map((c) => ({
        criterion: c.criterion,
        score: Math.max(0, Math.min(10, Math.round(Number(c.score) || 0))),
        note: c.note || '',
      }))
      // Ensure all 10 criteria present
      if (breakdown.length !== SEO_CRITERIA.length) {
        const found = new Set(breakdown.map((b) => b.criterion))
        for (const crit of SEO_CRITERIA) {
          if (!found.has(crit)) breakdown.push({ criterion: crit, score: 0, note: 'Not evaluated' })
        }
      }
    } catch {
      breakdown = SEO_CRITERIA.map((c) => ({ criterion: c, score: 0, note: 'Could not parse evaluation' }))
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

    return {
      output: {
        content,
        score,
        breakdown,
        mode,
        not_applicable: false,
        action: routePath,
      } satisfies SEOReviewOutput,
      routePath,
      tokensUsed: result.tokens_used,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed: result.model_used,
    }
  }
}
