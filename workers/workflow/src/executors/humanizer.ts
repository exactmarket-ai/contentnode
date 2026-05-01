import { callModel, embedText, type ModelConfig } from '@contentnode/ai'
import { prisma, withAgency, usageEventService, getModelForRole } from '@contentnode/database'
import type { Prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { DetectionOutput } from './detection.js'

// ─────────────────────────────────────────────────────────────────────────────
// Humanizer node executor — rewrites content to reduce AI detection score
// Provider is selected via HUMANIZER_SERVICE env var:
//   undetectable (default when keys present) | stealthgpt | humanizeai | claude
// ─────────────────────────────────────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<string, string> = {
  'executive-natural':  'Write like a senior executive who values clarity and directness. Avoid corporate jargon.',
  'conversational':     'Write as you would speak to a knowledgeable friend. Use contractions, varied sentence lengths, and natural rhythm.',
  'confident-expert':   'Write with authoritative confidence. State opinions directly without hedging.',
  'premium-brand':      'Write with polished, sophisticated language. Elevated but not stuffy.',
  'founder-voice':      'Write with the energy and conviction of a startup founder who deeply believes in their mission.',
  'sales-polished':     'Write persuasively with a focus on outcomes and benefits. Professional but driven.',
  'journalistic-clean': 'Write in a clean, factual journalistic style. Lead with the news, be precise.',
  'social-native':      'Write for social media: punchy, engaging, formatted for quick scanning.',
  'custom':             'Follow the additional instructions provided.',
}

function buildSliderInstructions(sliders: Record<string, number>): string {
  const map = (val: number, low: string, high: string) =>
    val < 33 ? `lean ${low}` : val > 66 ? `lean ${high}` : `balance between ${low} and ${high}`

  return [
    `Naturalness: ${map(sliders.naturalness, 'structured', 'organic and unpredictable')}`,
    `Energy: ${map(sliders.energy, 'calm and measured', 'vibrant and punchy')}`,
    `Precision: ${map(sliders.precision, 'approximate and impressionistic', 'exact and specific')}`,
    `Formality: ${map(sliders.formality, 'casual and relaxed', 'formal and polished')}`,
    `Boldness: ${map(sliders.boldness, 'understated', 'assertive and direct')}`,
    `Compression: ${map(sliders.compression, 'expansive and detailed', 'tight and concise')}`,
    `Personality: ${map(sliders.personality, 'neutral', 'distinctly personal')}`,
    `Safety: ${map(sliders.safety, 'edgy and unconventional', 'safe and broadly acceptable')}`,
  ].join('\n')
}

function buildFullRewritePrompt(content: string, mode: string, sliders: Record<string, number>): string {
  const modeDesc = MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['conversational']
  return `You are rewriting AI-generated content so it passes AI detection tools like GPTZero. Your job is to make it read like a real human wrote it — not a polished, structured AI.

VOICE:
${modeDesc}

STYLE PARAMETERS:
${buildSliderInstructions(sliders)}

HOW TO DEFEAT AI DETECTION — follow these exactly:
- Shatter the structure. AI writes in perfect logical order. Humans don't. Jump between ideas. Circle back. Let a thought land before you explain it.
- Radical sentence variation. Go short. Then write a much longer sentence that winds through a few ideas before landing somewhere unexpected. Then one word. Fragment intentionally.
- Kill the transitions. Remove "furthermore", "moreover", "additionally", "consequently", "it is worth noting", "it is important to", "in conclusion", "to summarize", "delve into", "tapestry", "multifaceted", "leverage", "utilize". Never use them.
- Add opinion and friction. Real humans have takes. Add a mild editorial opinion or a moment of doubt. "Which is surprising, honestly." or "Most people miss this."
- Use contractions everywhere. Don't → don't. It is → it's. They are → they're. AI often avoids these.
- Break paragraph rhythm. Vary how long paragraphs are. Put a one-sentence paragraph next to a five-sentence one. AI tends toward uniform paragraph sizes.
- Ask a rhetorical question occasionally. It signals human voice.
- Preserve ALL facts, data, and claims exactly — do not invent or change any information
- Return ONLY the rewritten content, no explanation

CONTENT TO REWRITE:
${content}`
}

function buildTargetedRewritePrompt(content: string, flaggedSentences: string[], mode: string, sliders: Record<string, number>): string {
  const modeDesc = MODE_DESCRIPTIONS[mode] ?? MODE_DESCRIPTIONS['conversational']
  const flaggedList = flaggedSentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')
  return `An AI detector flagged specific sentences in this content. Rewrite ONLY those sentences so they read as human-written and defeat the detector. Leave every other word exactly as-is.

VOICE:
${modeDesc}

STYLE PARAMETERS:
${buildSliderInstructions(sliders)}

FLAGGED SENTENCES (rewrite these only):
${flaggedList}

HOW TO REWRITE FLAGGED SENTENCES:
- Break up overly smooth, logical flow — humans are less perfectly structured
- Use contractions (don't, it's, they're, we've)
- Vary sentence length dramatically — a flagged sentence that's medium-length can become two short ones or one longer winding one
- Add a grounded, specific detail or a touch of opinion if it fits naturally
- Never use: "furthermore", "moreover", "additionally", "it is worth noting", "consequently", "in conclusion", "delve into", "multifaceted", "tapestry", "leverage", "utilize"
- Preserve all facts and meaning exactly

Return the FULL content with only the flagged sentences replaced. No preamble.

FULL CONTENT:
${content}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking — split content into ≤1000-word chunks at sentence boundaries
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHUNK_WORDS = 400  // smaller chunks = faster per-request on slow APIs

function splitIntoChunks(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let current: string[] = []
  let wordCount = 0

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length
    if (wordCount + words > MAX_CHUNK_WORDS && current.length > 0) {
      chunks.push(current.join(' '))
      current = []
      wordCount = 0
    }
    current.push(sentence)
    wordCount += words
  }

  if (current.length > 0) chunks.push(current.join(' '))
  return chunks
}

async function processInChunks(
  content: string,
  fn: (chunk: string) => Promise<string>,
): Promise<string> {
  const words = content.split(/\s+/).filter(Boolean).length
  if (words <= MAX_CHUNK_WORDS) return fn(content)

  const chunks = splitIntoChunks(content)
  console.log(`[humanizer] splitting into ${chunks.length} chunks`)
  const results: string[] = []
  for (const chunk of chunks) {
    results.push(await fn(chunk))
  }
  return results.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────────────────────────────────────

async function runUndetectable(content: string): Promise<string> {
  const apiKey = process.env.UNDETECTABLE_API_KEY
  const userId = process.env.UNDETECTABLE_USER_ID

  if (!apiKey) throw new Error('Undetectable.ai: UNDETECTABLE_API_KEY is not set in worker environment')
  if (!userId) throw new Error('Undetectable.ai: UNDETECTABLE_USER_ID is not set — set it to the User ID from your Undetectable.ai account dashboard')

  const submitRes = await fetch('https://humanize.undetectable.ai/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
    body: JSON.stringify({
      content,
      readability: 'University',
      purpose: 'Marketing Material',
      strength: 'More Humanized',
      model: 'v11',
      userId,
    }),
  })

  if (!submitRes.ok) {
    const errBody = await submitRes.text().catch(() => submitRes.statusText)
    if (submitRes.status === 404 || errBody.includes('User not found')) {
      throw new Error(
        `Undetectable.ai: "User not found" — UNDETECTABLE_USER_ID is set to "${userId}" but Undetectable.ai doesn't recognise it. ` +
        `Find your User ID in the Undetectable.ai dashboard and update UNDETECTABLE_USER_ID in Railway.`
      )
    }
    throw new Error(`Undetectable.ai submit failed (${submitRes.status}): ${errBody}`)
  }

  const { id } = (await submitRes.json()) as { id: string }
  if (!id) throw new Error('Undetectable.ai: no document ID returned')

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const docRes = await fetch('https://humanize.undetectable.ai/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({ id, userId }),
    })
    if (!docRes.ok) continue
    const doc = (await docRes.json()) as { status: string; output?: string }
    if (doc.status === 'done' && doc.output) return doc.output
  }

  throw new Error('Undetectable.ai: timed out waiting for result')
}

async function runStealthGPT(content: string): Promise<string> {
  const apiKey = process.env.STEALTHGPT_API_KEY
  if (!apiKey) throw new Error('StealthGPT: STEALTHGPT_API_KEY not set')

  let res: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180_000)
    res = await fetch('https://stealthgpt.ai/api/stealthify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-token': apiKey,
      },
      body: JSON.stringify({
        prompt: content,
        rephrase: true,
        tone: 'College',
        mode: 'Low',
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('StealthGPT timed out after 3 minutes')
    }
    const cause = err instanceof Error ? `${err.message} — ${(err as NodeJS.ErrnoException).cause ?? ''}` : String(err)
    throw new Error(`StealthGPT network error: ${cause}`)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`StealthGPT failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { result?: string }
  if (!data.result) throw new Error(`StealthGPT: no result in response — ${JSON.stringify(data)}`)
  return data.result
}

async function runHumanizeAI(content: string): Promise<string> {
  const apiKey = process.env.HUMANIZEAI_API_KEY
  if (!apiKey) throw new Error('HumanizeAI: HUMANIZEAI_API_KEY not set')
  // TODO: implement HumanizeAI API call
  // Docs: https://humanizeai.pro/api
  throw new Error('HumanizeAI integration not yet implemented')
}

async function runBypassGPT(content: string): Promise<string> {
  const apiKey = process.env.BYPASSGPT_API_KEY
  if (!apiKey) throw new Error('BypassGPT: BYPASSGPT_API_KEY not set')

  const BASE = 'https://www.bypassgpt.ai/api/bypassgpt/v1'

  // Step 1: Submit and get task_id
  const submitRes = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ input: content, model_type: 'Enhanced' }),
  })

  if (!submitRes.ok) {
    const text = await submitRes.text()
    throw new Error(`BypassGPT generate failed (${submitRes.status}): ${text}`)
  }

  const submitJson = (await submitRes.json()) as { error_code: number; data: { task_id: string } }
  if (submitJson.error_code !== 0) throw new Error(`BypassGPT generate error: ${JSON.stringify(submitJson)}`)
  const { task_id } = submitJson.data
  if (!task_id) throw new Error('BypassGPT: no task_id returned')

  // Step 2: Poll until finished (2 min timeout)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))

    const pollRes = await fetch(`${BASE}/retrieval?task_id=${task_id}`, {
      headers: { 'api-key': apiKey },
    })

    if (!pollRes.ok) continue

    const pollJson = (await pollRes.json()) as {
      error_code: number
      data: { finished: boolean; bypass_status: string; output?: string }
    }

    if (pollJson.error_code !== 0) continue
    const { finished, bypass_status, output } = pollJson.data
    if (finished && bypass_status === 'ok' && output) return output
    if (finished && bypass_status !== 'ok') throw new Error(`BypassGPT task failed with status: ${bypass_status}`)
  }

  throw new Error('BypassGPT: timed out waiting for result')
}

// ─────────────────────────────────────────────────────────────────────────────
// Service selection
// ─────────────────────────────────────────────────────────────────────────────

type HumanizerService = 'undetectable' | 'stealthgpt' | 'humanizeai' | 'bypassgpt' | 'claude' | 'cnHumanizer'

function resolveService(configService?: string): HumanizerService {
  // Node config takes highest priority (set via the new Humanizer config panel)
  if (configService && configService !== 'auto') return configService as HumanizerService

  // Then env var override
  const envService = process.env.HUMANIZER_SERVICE as HumanizerService | undefined
  if (envService) return envService

  // Auto-detect based on which keys are present
  if (process.env.UNDETECTABLE_API_KEY && process.env.UNDETECTABLE_USER_ID) return 'undetectable'
  if (process.env.BYPASSGPT_API_KEY) return 'bypassgpt'
  if (process.env.STEALTHGPT_API_KEY) return 'stealthgpt'
  if (process.env.HUMANIZEAI_API_KEY) return 'humanizeai'
  return 'claude'
}

// ─────────────────────────────────────────────────────────────────────────────
// Example collection — saves before/after pairs for few-shot Claude humanizer
// ─────────────────────────────────────────────────────────────────────────────

async function saveHumanizerExample(
  agencyId: string,
  before: string,
  after: string,
  service: string,
  workflowRunId: string,
  detectionScoreBefore?: number,
): Promise<void> {
  const wordsBefore = before.split(/\s+/).filter(Boolean).length
  const wordsAfter = after.split(/\s+/).filter(Boolean).length
  await withAgency(agencyId, () =>
    prisma.humanizerExample.create({
      data: {
        agencyId,
        contentBefore: before,
        contentAfter: after,
        wordCountBefore: wordsBefore,
        wordCountAfter: wordsAfter,
        detectionScoreBefore: detectionScoreBefore ?? null,
        service,
        workflowRunId,
      },
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude few-shot humanizer
// ─────────────────────────────────────────────────────────────────────────────

// WeightedSignal — matches the shape stored by boxDiffProcessor
interface WeightedSignal {
  signal: string
  confidence: number
  observedCount: number
  firstSeenAt: string
  lastSeenAt: string
  docTypes?: string[]  // doc types this signal was observed on; empty/absent = universal
}

// Only inject signals above this confidence — keeps the personalisation block
// selective rather than dumping every ever-observed signal into the prompt.
const MIN_INJECT_CONFIDENCE = 0.4
const MAX_INJECT_PER_CAT    = 12

// docType-aware signal selection:
// - Signals matching the current doc type rank highest
// - Universal signals (empty docTypes) rank second
// - Signals with docTypes that don't include the current type are excluded
function topSignals(raw: unknown, docType?: string | null): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  // Support legacy string[] (pre-migration)
  if (typeof raw[0] === 'string') return raw as string[]

  return (raw as WeightedSignal[])
    .filter((s) => {
      if (s.confidence < MIN_INJECT_CONFIDENCE) return false
      // If no docType context, include all signals
      if (!docType) return true
      // Universal signals (no docType restriction)
      if (!s.docTypes || s.docTypes.length === 0) return true
      // Include signals observed on this doc type
      return s.docTypes.includes(docType)
    })
    .sort((a, b) => {
      // Exact doc type match floats to top within same confidence tier
      const aMatch = docType && a.docTypes?.includes(docType) ? 0.1 : 0
      const bMatch = docType && b.docTypes?.includes(docType) ? 0.1 : 0
      return (b.confidence + bMatch) - (a.confidence + aMatch)
    })
    .slice(0, MAX_INJECT_PER_CAT)
    .map((s) => s.signal)
}

// Returns { stakeholderId, docType } from the run — both may be null
async function getRunContext(agencyId: string, workflowRunId: string): Promise<{ stakeholderId: string | null; docType: string | null }> {
  const run = await withAgency(agencyId, () =>
    prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      select: {
        reviewerIds: true,
        workflow:    { select: { nodes: true } },
      },
    })
  )
  if (!run) return { stakeholderId: null, docType: null }

  const reviewerIds  = run.reviewerIds as string[]
  const stakeholderId = reviewerIds[0] ?? null

  // Infer doc type from the connected content-output node's output_type config
  type NodeShape = { type?: string; subtype?: string; config?: Record<string, unknown> }
  const nodes = (run.workflow?.nodes as unknown as NodeShape[]) ?? []
  const outputNode = nodes.find((n) => n.type === 'output' && n.subtype === 'content-output')
  const rawType = outputNode?.config?.output_type as string | undefined
  // Normalise: "Blog Post" → "blog", "Email" → "email", etc.
  const docType = rawType
    ? rawType.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_').split('_post')[0]
    : null

  return { stakeholderId, docType }
}

async function buildPersonalizationBlock(agencyId: string, workflowRunId: string): Promise<string> {
  const { stakeholderId, docType } = await getRunContext(agencyId, workflowRunId)
  if (!stakeholderId) return ''

  const profile = await withAgency(agencyId, () =>
    prisma.stakeholderPreferenceProfile.findUnique({
      where: { stakeholderId },
      select: { toneSignals: true, structureSignals: true, rejectPatterns: true, revisionCount: true },
    })
  )
  if (!profile || (profile.revisionCount ?? 0) < 1) return ''

  const tone      = topSignals(profile.toneSignals,      docType)
  const structure = topSignals(profile.structureSignals, docType)
  const reject    = topSignals(profile.rejectPatterns,   docType)
  if (!tone.length && !structure.length && !reject.length) return ''

  const docNote = docType ? ` (filtered for ${docType} content)` : ''
  const lines = [`PERSONALIZATION — learned from ${profile.revisionCount} real edits by this stakeholder${docNote}:`]
  if (tone.length)      lines.push(`Tone preferences: ${tone.join('; ')}`)
  if (structure.length) lines.push(`Structure preferences: ${structure.join('; ')}`)
  if (reject.length)    lines.push(`Always avoid — they consistently remove these: ${reject.join('; ')}`)

  return lines.join('\n')
}

// ── Stakeholder-specific few-shot retrieval from HumanizerSignal ────────────
// Uses pgvector cosine similarity to find the most structurally similar
// before/after pairs this stakeholder has edited. Falls back to recency sort
// if embeddings aren't computed yet or OPENAI_API_KEY is missing.

async function buildStakeholderFewShotExamples(
  agencyId:       string,
  stakeholderId:  string,
  contentToMatch: string,
): Promise<string> {
  // Try vector similarity first
  try {
    const embedding = await embedText(contentToMatch.slice(0, 3000))
    const vec = `[${embedding.join(',')}]`

    type SignalRow = { original_text: string; edited_text: string }
    const signals = await withAgency(agencyId, () =>
      prisma.$queryRaw<SignalRow[]>`
        SELECT "original_text", "edited_text"
        FROM "humanizer_signals"
        WHERE "agency_id" = ${agencyId}
          AND "stakeholder_id" = ${stakeholderId}
          AND "embedding" IS NOT NULL
          AND LENGTH("original_text") > 50
          AND "original_text" != '[original not available]'
        ORDER BY "embedding" <=> ${vec}::vector
        LIMIT 4
      `
    )

    if (signals.length > 0) {
      return signals.map((s, i) =>
        `--- EXAMPLE ${i + 1}: how this stakeholder rewrites AI content ---\n[ORIGINAL]\n${s.original_text.slice(0, 700)}\n\n[REVISED BY STAKEHOLDER]\n${s.edited_text.slice(0, 700)}`
      ).join('\n\n')
    }
  } catch {
    // OPENAI_API_KEY not set or embeddings not computed yet — fall through
  }

  // Fallback: most recent signals by recency
  const recent = await withAgency(agencyId, () =>
    prisma.humanizerSignal.findMany({
      where: {
        agencyId,
        stakeholderId,
        editedText:   { not: '' },
        originalText: { not: '[original not available]' },
      },
      orderBy: { createdAt: 'desc' },
      take:    3,
      select:  { originalText: true, editedText: true },
    })
  )

  if (!recent.length) return ''
  return recent.map((s, i) =>
    `--- EXAMPLE ${i + 1}: how this stakeholder rewrites AI content ---\n[ORIGINAL]\n${s.originalText.slice(0, 700)}\n\n[REVISED BY STAKEHOLDER]\n${s.editedText.slice(0, 700)}`
  ).join('\n\n')
}

async function buildFewShotExamples(agencyId: string): Promise<string> {
  // Pull up to 5 best examples: lowest detectionScoreAfter, or approved examples first
  const examples = await withAgency(agencyId, () =>
    prisma.humanizerExample.findMany({
      where: {
        agencyId,
        contentBefore: { not: null },
        contentAfter: { not: '' },
        OR: [
          { approved: true },
          { detectionScoreAfter: { lte: 30 } },
        ],
      },
      orderBy: [
        { approved: 'desc' },
        { detectionScoreAfter: 'asc' },
      ],
      take: 5,
      select: { contentBefore: true, contentAfter: true, detectionScoreAfter: true },
    })
  )
  if (examples.length === 0) return ''

  const lines = examples.map((ex, i) => {
    const scoreNote = ex.detectionScoreAfter !== null ? ` (detection score after: ${ex.detectionScoreAfter}%)` : ''
    return `--- EXAMPLE ${i + 1}${scoreNote} ---\n[BEFORE]\n${ex.contentBefore}\n\n[AFTER]\n${ex.contentAfter}`
  })
  return lines.join('\n\n')
}

function buildClaudeHumanizerPrompt(content: string, fewShotBlock: string, personalizationBlock?: string): string {
  const examplesSection = fewShotBlock
    ? `\nHere are examples of AI-written content rewritten to sound human. Study the patterns — shorter word count, broken rhythm, specific detail, opinion, contractions:\n\n${fewShotBlock}\n\n--- END EXAMPLES ---\n`
    : ''

  const personalizationSection = personalizationBlock
    ? `\n${personalizationBlock}\n`
    : ''

  return `You are rewriting AI-generated content to sound like it was written by a real human. Your goal: preserve the meaning and word count (within 10%), but break every pattern AI detectors look for.${examplesSection}${personalizationSection}

RULES — follow all of these:
- Keep word count within 10% of the original. Do NOT pad with extra content.
- Shatter uniform structure. Humans jump between ideas, circle back, let a thought land before explaining it.
- Radical sentence variation: mix very short sentences with longer winding ones. Use fragments intentionally.
- Kill AI transitions: never use "furthermore", "moreover", "additionally", "consequently", "it is worth noting", "it is important to", "in conclusion", "to summarize", "delve into", "tapestry", "multifaceted", "leverage", "utilize".
- Use contractions everywhere: don't, it's, they're, we've, I'd, you'll.
- Add a moment of opinion, doubt, or direct address: "Which is surprising, honestly." / "Most people get this wrong." / "Here's the thing."
- Vary paragraph length dramatically. One-sentence paragraphs next to five-sentence ones.
- Occasional rhetorical question signals human voice.
- Preserve ALL facts, data, names, and claims exactly — do not invent or change any information.
- Return ONLY the rewritten content. No preamble, no explanation.

CONTENT TO REWRITE:
${content}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage tracking
// ─────────────────────────────────────────────────────────────────────────────

async function recordHumanizerUsage(
  agencyId: string,
  service: HumanizerService,
  wordsProcessed: number,
  workflowRunId: string,
  userId?: string | null,
): Promise<void> {
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  await withAgency(agencyId, () =>
    prisma.usageRecord.create({
      data: {
        agencyId,
        metric: 'humanizer_words',
        quantity: wordsProcessed,
        periodStart,
        periodEnd,
        metadata: { service, workflowRunId, ...(userId ? { userId } : {}) } as Prisma.InputJsonValue,
      },
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class HumanizerNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const { model: regModel } = await getModelForRole('humanizer')

    // Accept DetectionOutput, raw string, or array of upstream outputs
    const resolvedInput = Array.isArray(input)
      ? input.filter((v) => v != null).join('\n\n')
      : input
    const inputObj = resolvedInput as Partial<DetectionOutput> | null
    const content: string =
      typeof inputObj?.content === 'string'
        ? inputObj.content
        : typeof resolvedInput === 'string'
        ? resolvedInput
        : JSON.stringify(resolvedInput)

    const flaggedSentences: string[] | null =
      Array.isArray(inputObj?.flagged_sentences) ? (inputObj.flagged_sentences as string[]) : null

    const service = resolveService(config.humanizer_service as string | undefined)
    const wordsProcessed = content.split(/\s+/).filter(Boolean).length

    console.log(`[humanizer] using service: ${service} (${wordsProcessed} words)`)

    let humanized: string
    let tokensUsed: number | undefined
    let modelUsed: string | undefined

    if (service === 'undetectable') {
      humanized = await processInChunks(content, (chunk) => runUndetectable(chunk))
    } else if (service === 'bypassgpt') {
      humanized = await processInChunks(content, (chunk) => runBypassGPT(chunk))
    } else if (service === 'stealthgpt') {
      humanized = await processInChunks(content, (chunk) => runStealthGPT(chunk))
    } else if (service === 'humanizeai') {
      humanized = await processInChunks(content, (chunk) => runHumanizeAI(chunk))
    } else if (service === 'cnHumanizer') {
      const { stakeholderId } = await getRunContext(ctx.agencyId, ctx.workflowRunId)
      const [fewShotBlock, personalizationBlock] = await Promise.all([
        stakeholderId
          ? buildStakeholderFewShotExamples(ctx.agencyId, stakeholderId, content)
          : buildFewShotExamples(ctx.agencyId),
        buildPersonalizationBlock(ctx.agencyId, ctx.workflowRunId),
      ])
      const prompt = buildClaudeHumanizerPrompt(content, fewShotBlock, personalizationBlock || undefined)
      const modelCfg = config.model_config as Record<string, unknown> | null
      const modelConfig: ModelConfig = {
        provider: ((modelCfg?.provider as string) ?? 'anthropic') as 'anthropic' | 'ollama',
        model:    (modelCfg?.model as string) ?? regModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        temperature: (modelCfg?.temperature as number) ?? 0.9,
      }
      console.log(`[humanizer] cnHumanizer: ${fewShotBlock ? 'few-shot examples' : 'no examples'}, ${personalizationBlock ? 'stakeholder profile injected' : 'no stakeholder profile'}`)
      const result = await callModel(modelConfig, prompt)
      humanized = result.text
      tokensUsed = result.tokens_used
      modelUsed = result.model_used
    } else {
      // Legacy Claude fallback (old slider-based approach)
      const targetedRewrite = (config.targeted_rewrite as boolean) ?? true
      const mode = (config.mode as string) ?? 'executive-natural'
      const sliders: Record<string, number> = {
        naturalness:  (config.naturalness  as number) ?? 70,
        energy:       (config.energy       as number) ?? 60,
        precision:    (config.precision    as number) ?? 65,
        formality:    (config.formality    as number) ?? 50,
        boldness:     (config.boldness     as number) ?? 55,
        compression:  (config.compression  as number) ?? 40,
        personality:  (config.personality  as number) ?? 60,
        safety:       (config.safety       as number) ?? 80,
      }
      const useTargeted = targetedRewrite && flaggedSentences !== null && flaggedSentences.length > 0
      const prompt = useTargeted
        ? buildTargetedRewritePrompt(content, flaggedSentences!, mode, sliders)
        : buildFullRewritePrompt(content, mode, sliders)

      const modelCfg = config.model_config as Record<string, unknown> | null
      const modelConfig: ModelConfig = {
        provider: ((modelCfg?.provider as string) ?? 'anthropic') as 'anthropic' | 'ollama',
        model:    (modelCfg?.model as string) ?? regModel,
        api_key_ref: 'ANTHROPIC_API_KEY',
        temperature: (modelCfg?.temperature as number) ?? 0.95,
      }
      const result = await callModel(modelConfig, prompt)
      humanized = result.text
      tokensUsed = result.tokens_used
      modelUsed = result.model_used
    }

    // Save before/after pair for future few-shot examples (third-party services only)
    const isThirdParty = ['undetectable', 'bypassgpt', 'stealthgpt', 'humanizeai'].includes(service)
    if (isThirdParty) {
      const detectionScore = typeof (input as Record<string, unknown>)?.overall_score === 'number'
        ? (input as Record<string, unknown>).overall_score as number
        : undefined
      saveHumanizerExample(ctx.agencyId, content, humanized, service, ctx.workflowRunId, detectionScore).catch((err) => {
        console.error('[humanizer] failed to save example:', err)
      })
    }

    // Record usage per service — existing monthly-bucket tracking (non-blocking)
    recordHumanizerUsage(ctx.agencyId, service, wordsProcessed, ctx.workflowRunId, ctx.userId).catch((err) => {
      console.error('[humanizer] failed to record usage:', err)
    })

    // Granular UsageEvent (non-blocking)
    const isOnline = !['undetectable', 'bypassgpt', 'stealthgpt', 'humanizeai'].includes(service)
      ? service === 'cnHumanizer' || service === 'claude'
      : true
    usageEventService.record({
      agencyId:         ctx.agencyId,
      userId:           ctx.userId ?? undefined,
      userRole:         ctx.userRole ?? undefined,
      clientId:         ctx.clientId ?? undefined,
      toolType:         'content',
      toolSubtype:      'humanizer',
      provider:         service,
      model:            service,
      isOnline,
      workflowId:       ctx.workflowId,
      workflowRunId:    ctx.workflowRunId,
      nodeId:           ctx.nodeId,
      nodeType:         'logic',
      inputCharacters:  content.length,
      outputCharacters: humanized.length,
      durationMs:       0,       // humanizer doesn't track per-call wall time currently
      status:           'success',
      permissionsAtTime: ctx.resolvedPermissions,
    }).catch(() => {})

    return { output: humanized, wordsProcessed, tokensUsed, modelUsed }
  }
}
