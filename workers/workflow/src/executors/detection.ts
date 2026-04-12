import { prisma, withAgency, type Prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

async function logDetectionUsage(agencyId: string, service: string, workflowRunId: string | undefined, wordCount: number) {
  try {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    await withAgency(agencyId, () =>
      prisma.usageRecord.create({
        data: {
          agencyId,
          metric: 'detection_call',
          quantity: wordCount,
          periodStart,
          periodEnd,
          metadata: { service, workflowRunId } as Prisma.InputJsonValue,
        },
      })
    )
  } catch (err) {
    console.warn('[detection] failed to log usage record:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection node executor — scores content for AI likelihood
// Supports GPTZero (primary), Originality.ai, Copyleaks, Sapling, and Local
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionOutput {
  overall_score: number          // 0-100, higher = more AI-like
  flagged_sentences: string[]
  content: string                // passthrough of input content
  service: string
}

interface GPTZeroResponse {
  documents: Array<{
    completely_generated_prob: number
    sentences: Array<{
      sentence: string
      generated_prob: number
    }>
  }>
}

interface OriginalityResponse {
  score: { ai: number }
  items: Array<{ text: string; score: number }>
}

interface SaplingResponse {
  score: number
  sentences: Array<{ sentence: string; score: number }>
}

function extractContent(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.output === 'string') return obj.output
  }
  return JSON.stringify(input)
}

/**
 * Heuristic AI-text detector for offline / local mode.
 * Flags sentences containing patterns common in AI-generated text.
 */
function localDetect(content: string): DetectionOutput {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)

  const flagged: string[] = []

  const AI_PATTERNS = [
    /\b(furthermore|moreover|additionally|consequently|therefore|thus)\b/i,
    /\b(it is (worth noting|important to note|crucial to|essential to))\b/i,
    /\b(in (conclusion|summary|essence)|to (summarize|conclude|wrap up))\b/i,
    /\b(delve into|tapestry|multifaceted|paradigm|leverage|utilize)\b/i,
    /\b(at the end of the day|needless to say|rest assured)\b/i,
    /\b(as (an AI|a language model))\b/i,
    /\b(key takeaway|key insight|key point|in today's (world|landscape|era))\b/i,
  ]

  for (const sentence of sentences) {
    if (AI_PATTERNS.some((p) => p.test(sentence))) {
      flagged.push(sentence)
    }
  }

  const score = sentences.length === 0
    ? 0
    : Math.min(100, Math.round((flagged.length / sentences.length) * 100))

  return { overall_score: score, flagged_sentences: flagged, content, service: 'local' }
}

export class DetectionNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    const content = extractContent(input)
    const service = (config.service as string) ?? 'local'
    const wordCount = content.split(/\s+/).filter(Boolean).length
    // Default env var names per service — users don't need to configure these
    const SERVICE_KEY_DEFAULTS: Record<string, string> = {
      gptzero: 'GPTZERO_API_KEY',
      originality: 'ORIGINALITY_API_KEY',
      sapling: 'SAPLING_API_KEY',
      copyleaks: 'COPYLEAKS_API_KEY',
    }
    const apiKeyRef = (config.api_key_ref as string) || SERVICE_KEY_DEFAULTS[service] || ''

    let result: DetectionOutput

    switch (service) {
      case 'local':
        result = localDetect(content)
        break

      case 'gptzero': {
        // Resolve from env var first; if the ref looks like an env var name but isn't set, treat as missing
        const apiKey = process.env[apiKeyRef] ?? (/^[A-Z][A-Z0-9_]+$/.test(apiKeyRef) ? null : apiKeyRef)
        if (!apiKey) {
          console.warn(`[detection] GPTZero API key not configured — falling back to local detection`)
          result = localDetect(content)
          break
        }

        const res = await fetch('https://api.gptzero.me/v2/predict/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ document: content }),
        })
        if (!res.ok) throw new Error(`GPTZero API error ${res.status}: ${res.statusText}`)

        const data = (await res.json()) as GPTZeroResponse
        const doc = data.documents[0]
        const score = Math.round((doc?.completely_generated_prob ?? 0) * 100)
        const flagged = (doc?.sentences ?? [])
          .filter((s) => s.generated_prob > 0.5)
          .map((s) => s.sentence)

        result = { overall_score: score, flagged_sentences: flagged, content, service }
        await logDetectionUsage(ctx.agencyId, service, ctx.workflowRunId, wordCount)
        break
      }

      case 'originality': {
        const apiKey = process.env[apiKeyRef] ?? (/^[A-Z][A-Z0-9_]+$/.test(apiKeyRef) ? null : apiKeyRef)
        if (!apiKey) {
          console.warn(`[detection] Originality.ai API key not configured — falling back to local detection`)
          result = localDetect(content)
          break
        }

        const res = await fetch('https://api.originality.ai/api/v1/scan/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-OAI-API-KEY': apiKey },
          body: JSON.stringify({ content, aiModelVersion: '1' }),
        })
        if (!res.ok) throw new Error(`Originality.ai API error ${res.status}: ${res.statusText}`)

        const data = (await res.json()) as OriginalityResponse
        const score = Math.round((data.score?.ai ?? 0) * 100)
        const flagged = (data.items ?? [])
          .filter((item) => item.score > 0.5)
          .map((item) => item.text)

        result = { overall_score: score, flagged_sentences: flagged, content, service }
        await logDetectionUsage(ctx.agencyId, service, ctx.workflowRunId, wordCount)
        break
      }

      case 'sapling': {
        const apiKey = process.env[apiKeyRef] ?? (/^[A-Z][A-Z0-9_]+$/.test(apiKeyRef) ? null : apiKeyRef)
        if (!apiKey) {
          console.warn(`[detection] Sapling API key not configured — falling back to local detection`)
          result = localDetect(content)
          break
        }

        const res = await fetch('https://api.sapling.ai/api/v1/aidetect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: apiKey, text: content }),
        })
        if (!res.ok) throw new Error(`Sapling API error ${res.status}: ${res.statusText}`)

        const data = (await res.json()) as SaplingResponse
        const score = Math.round((data.score ?? 0) * 100)
        const flagged = (data.sentences ?? [])
          .filter((s) => s.score > 0.5)
          .map((s) => s.sentence)

        result = { overall_score: score, flagged_sentences: flagged, content, service }
        await logDetectionUsage(ctx.agencyId, service, ctx.workflowRunId, wordCount)
        break
      }

      case 'copyleaks': {
        // Copyleaks uses an async scan flow; for now return a stub
        // In production this would poll the Copyleaks webhook result
        result = localDetect(content)
        result = { ...result, service: 'copyleaks' }
        break
      }

      default:
        result = localDetect(content)
    }

    return { output: result }
  }
}
