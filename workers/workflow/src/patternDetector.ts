import { callModel } from '@contentnode/ai'
import { prisma, withAgency, type Prisma, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Seniority weights — used in collective confidence scoring
// ─────────────────────────────────────────────────────────────────────────────

const SENIORITY_WEIGHT: Record<string, number> = {
  owner:  1.5,
  senior: 1.2,
  member: 1.0,
  junior: 0.7,
}

function seniorityWeight(seniority: string): number {
  return SENIORITY_WEIGHT[seniority] ?? 1.0
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence quote shape
// ─────────────────────────────────────────────────────────────────────────────

interface EvidenceQuote {
  text: string
  stakeholderId: string
  stakeholderName: string
  runId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate pattern — collapsed before dedup check
// ─────────────────────────────────────────────────────────────────────────────

interface PatternCandidate {
  type: 'tone' | 'forbidden_term' | 'structure' | 'length' | 'claims'
  title: string
  body: string
  suggestedNodeType: string
  suggestedConfigChange: Record<string, unknown>
  evidenceQuotes: EvidenceQuote[]
  stakeholderIds: string[]
  instanceCount: number
  confidence: number
  isCollective: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — called after a Feedback record is created
// ─────────────────────────────────────────────────────────────────────────────

export async function detectPatterns(
  feedbackId: string,
  clientId: string,
  agencyId: string,
): Promise<void> {
  await withAgency(agencyId, async () => {
    // Load all feedback for this client with stakeholder info
    const allFeedback = await prisma.feedback.findMany({
      where: { agencyId, workflowRun: { workflow: { clientId } } },
      include: {
        stakeholder: { select: { id: true, name: true, role: true, seniority: true } },
        workflowRun: { select: { id: true, workflowId: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (allFeedback.length === 0) return

    // Total runs for this client — used as denominator in confidence
    const totalRuns = await prisma.workflowRun.count({
      where: { agencyId, workflow: { clientId }, status: 'completed' },
    })
    const denominator = Math.max(totalRuns, 1)

    // Load existing pending/applied insights to dedup
    const existingInsights = await prisma.insight.findMany({
      where: { agencyId, clientId, status: { in: ['pending', 'applied'] } },
      select: { type: true, title: true },
    })
    const existingKeys = new Set(
      existingInsights.map((i) => `${i.type}:${i.title.toLowerCase()}`)
    )

    const candidates: PatternCandidate[] = [
      ...detectTonePatterns(allFeedback, denominator),
      ...detectForbiddenTermPatterns(allFeedback, denominator),
      ...detectStructurePatterns(allFeedback, denominator),
      ...detectLengthPatterns(allFeedback, denominator),
      ...detectClaimsPatterns(allFeedback, denominator),
    ]

    // Create insights for new candidates that pass thresholds
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.title.toLowerCase()}`
      if (existingKeys.has(key)) continue

      await prisma.insight.create({
        data: {
          agencyId,
          clientId,
          type: candidate.type,
          title: candidate.title,
          body: candidate.body,
          confidence: candidate.confidence,
          status: 'pending',
          instanceCount: candidate.instanceCount,
          stakeholderIds: candidate.stakeholderIds,
          isCollective: candidate.isCollective,
          evidenceQuotes: candidate.evidenceQuotes as object[],
          suggestedNodeType: candidate.suggestedNodeType,
          suggestedConfigChange: candidate.suggestedConfigChange as Prisma.InputJsonValue,
        },
      })
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern detector helpers
// ─────────────────────────────────────────────────────────────────────────────

type FeedbackWithStakeholder = {
  id: string
  toneFeedback: string | null
  contentTags: unknown
  specificChanges: unknown
  stakeholderId: string
  stakeholder: { id: string; name: string; role: string | null; seniority: string }
  workflowRun: { id: string; workflowId: string } | null
}

// ── Tone ──────────────────────────────────────────────────────────────────────

function detectTonePatterns(
  feedback: FeedbackWithStakeholder[],
  denominator: number,
): PatternCandidate[] {
  const toneGroups: Record<string, FeedbackWithStakeholder[]> = {}

  for (const fb of feedback) {
    if (!fb.toneFeedback) continue
    toneGroups[fb.toneFeedback] ??= []
    toneGroups[fb.toneFeedback].push(fb)
  }

  const candidates: PatternCandidate[] = []

  for (const [tone, items] of Object.entries(toneGroups)) {
    const byStakeholder = groupByStakeholder(items)
    const result = evaluateThresholds(byStakeholder, denominator)
    if (!result) continue

    const toneLabel = tone.replace(/_/g, ' ')
    candidates.push({
      type: 'tone',
      title: `Content is ${toneLabel}`,
      body: `Stakeholders have repeatedly flagged the tone as "${toneLabel}". Consider adjusting humanizer settings.`,
      suggestedNodeType: 'logic:humanizer',
      suggestedConfigChange: buildToneConfigChange(tone),
      evidenceQuotes: result.evidenceQuotes,
      stakeholderIds: result.stakeholderIds,
      instanceCount: result.instanceCount,
      confidence: result.confidence,
      isCollective: result.isCollective,
    })
  }

  return candidates
}

function buildToneConfigChange(tone: string): Record<string, unknown> {
  switch (tone) {
    case 'too_formal':   return { formality: 30, personality: 70 }
    case 'too_casual':   return { formality: 70, personality: 40 }
    case 'too_generic':  return { boldness: 70, personality: 75 }
    default:             return {}
  }
}

// ── Forbidden terms ───────────────────────────────────────────────────────────

function detectForbiddenTermPatterns(
  feedback: FeedbackWithStakeholder[],
  denominator: number,
): PatternCandidate[] {
  const termGroups: Record<string, FeedbackWithStakeholder[]> = {}

  for (const fb of feedback) {
    const changes = (fb.specificChanges as Array<{ text?: string; instruction?: string }>) ?? []
    for (const change of changes) {
      if (!change.text) continue
      // Only short quoted phrases (< 60 chars) are treated as forbidden terms
      if (change.text.length > 60) continue
      const normalised = change.text.toLowerCase().trim()
      termGroups[normalised] ??= []
      termGroups[normalised].push(fb)
    }
  }

  const candidates: PatternCandidate[] = []

  for (const [term, items] of Object.entries(termGroups)) {
    const byStakeholder = groupByStakeholder(items)
    const result = evaluateThresholds(byStakeholder, denominator)
    if (!result) continue

    candidates.push({
      type: 'forbidden_term',
      title: `Avoid: "${term}"`,
      body: `The phrase "${term}" is frequently flagged for removal. Add it to the Rules node blocklist.`,
      suggestedNodeType: 'logic',
      suggestedConfigChange: { forbidden_terms: [term] },
      evidenceQuotes: result.evidenceQuotes,
      stakeholderIds: result.stakeholderIds,
      instanceCount: result.instanceCount,
      confidence: result.confidence,
      isCollective: result.isCollective,
    })
  }

  return candidates
}

// ── Structure ─────────────────────────────────────────────────────────────────

const STRUCTURE_TAGS = ['missing_points', 'off_brief']

function detectStructurePatterns(
  feedback: FeedbackWithStakeholder[],
  denominator: number,
): PatternCandidate[] {
  const tagGroups: Record<string, FeedbackWithStakeholder[]> = {}

  for (const fb of feedback) {
    const tags = (fb.contentTags as string[]) ?? []
    for (const tag of tags) {
      if (!STRUCTURE_TAGS.includes(tag)) continue
      tagGroups[tag] ??= []
      tagGroups[tag].push(fb)
    }
  }

  const candidates: PatternCandidate[] = []

  for (const [tag, items] of Object.entries(tagGroups)) {
    const byStakeholder = groupByStakeholder(items)
    const result = evaluateThresholds(byStakeholder, denominator)
    if (!result) continue

    const label = tag === 'missing_points' ? 'Missing key points' : 'Off brief'
    candidates.push({
      type: 'structure',
      title: label,
      body: `Content is repeatedly flagged as "${label.toLowerCase()}". Consider adding a Logic node to enforce structural requirements.`,
      suggestedNodeType: 'logic:ai-generate',
      suggestedConfigChange: { structure_enforcement: tag },
      evidenceQuotes: result.evidenceQuotes,
      stakeholderIds: result.stakeholderIds,
      instanceCount: result.instanceCount,
      confidence: result.confidence,
      isCollective: result.isCollective,
    })
  }

  return candidates
}

// ── Length ────────────────────────────────────────────────────────────────────

const LENGTH_TAGS = ['too_long', 'too_short']

function detectLengthPatterns(
  feedback: FeedbackWithStakeholder[],
  denominator: number,
): PatternCandidate[] {
  const tagGroups: Record<string, FeedbackWithStakeholder[]> = {}

  for (const fb of feedback) {
    const tags = (fb.contentTags as string[]) ?? []
    for (const tag of tags) {
      if (!LENGTH_TAGS.includes(tag)) continue
      tagGroups[tag] ??= []
      tagGroups[tag].push(fb)
    }
  }

  const candidates: PatternCandidate[] = []

  for (const [tag, items] of Object.entries(tagGroups)) {
    const byStakeholder = groupByStakeholder(items)
    const result = evaluateThresholds(byStakeholder, denominator)
    if (!result) continue

    const isTooLong = tag === 'too_long'
    candidates.push({
      type: 'length',
      title: isTooLong ? 'Content is too long' : 'Content is too short',
      body: `Content is repeatedly flagged as ${isTooLong ? 'too long' : 'too short'}. Adjust the Content Output node word count range.`,
      suggestedNodeType: 'output:content-output',
      suggestedConfigChange: isTooLong
        ? { max_words: 800, min_words: 500 }
        : { min_words: 1000, max_words: 1500 },
      evidenceQuotes: result.evidenceQuotes,
      stakeholderIds: result.stakeholderIds,
      instanceCount: result.instanceCount,
      confidence: result.confidence,
      isCollective: result.isCollective,
    })
  }

  return candidates
}

// ── Claims ────────────────────────────────────────────────────────────────────

function detectClaimsPatterns(
  feedback: FeedbackWithStakeholder[],
  denominator: number,
): PatternCandidate[] {
  // Look for specific_changes where text > 60 chars (longer excerpts = claims)
  const claimGroups: Record<string, FeedbackWithStakeholder[]> = {}

  for (const fb of feedback) {
    const changes = (fb.specificChanges as Array<{ text?: string; instruction?: string }>) ?? []
    for (const change of changes) {
      if (!change.text || change.text.length <= 60) continue
      // Use instruction as key (normalised) to group similar change types
      const key = (change.instruction ?? '').toLowerCase().trim().slice(0, 80)
      if (!key) continue
      claimGroups[key] ??= []
      claimGroups[key].push(fb)
    }
  }

  const candidates: PatternCandidate[] = []

  for (const [instruction, items] of Object.entries(claimGroups)) {
    const byStakeholder = groupByStakeholder(items)
    const result = evaluateThresholds(byStakeholder, denominator)
    if (!result) continue

    candidates.push({
      type: 'claims',
      title: `Recurring claim change: "${instruction.slice(0, 50)}"`,
      body: `This type of claim-level change recurs across multiple runs. Consider adding it as a standing instruction in the Rules node.`,
      suggestedNodeType: 'logic',
      suggestedConfigChange: { claim_instruction: instruction },
      evidenceQuotes: result.evidenceQuotes,
      stakeholderIds: result.stakeholderIds,
      instanceCount: result.instanceCount,
      confidence: result.confidence,
      isCollective: result.isCollective,
    })
  }

  return candidates
}

// ─────────────────────────────────────────────────────────────────────────────
// Threshold evaluation
// ─────────────────────────────────────────────────────────────────────────────

interface ThresholdResult {
  instanceCount: number
  stakeholderIds: string[]
  evidenceQuotes: EvidenceQuote[]
  confidence: number
  isCollective: boolean
}

function groupByStakeholder(
  items: FeedbackWithStakeholder[],
): Map<string, FeedbackWithStakeholder[]> {
  const map = new Map<string, FeedbackWithStakeholder[]>()
  for (const item of items) {
    const list = map.get(item.stakeholderId) ?? []
    list.push(item)
    map.set(item.stakeholderId, list)
  }
  return map
}

function evaluateThresholds(
  byStakeholder: Map<string, FeedbackWithStakeholder[]>,
  denominator: number,
): ThresholdResult | null {
  const INDIVIDUAL_THRESHOLD = 3
  const COLLECTIVE_THRESHOLD = 2

  let bestIndividual: { stakeholderId: string; items: FeedbackWithStakeholder[] } | null = null

  for (const [stakeholderId, items] of byStakeholder.entries()) {
    if (items.length >= INDIVIDUAL_THRESHOLD) {
      if (!bestIndividual || items.length > bestIndividual.items.length) {
        bestIndividual = { stakeholderId, items }
      }
    }
  }

  // Individual insight
  if (bestIndividual) {
    const { items } = bestIndividual
    const sh = items[0].stakeholder
    const weight = seniorityWeight(sh.seniority)
    const confidence = Math.min(1, (items.length * weight) / denominator)

    return {
      instanceCount: items.length,
      stakeholderIds: [bestIndividual.stakeholderId],
      evidenceQuotes: items.slice(0, 3).map((fb) => ({
        text: extractEvidenceText(fb),
        stakeholderId: fb.stakeholderId,
        stakeholderName: fb.stakeholder.name,
        runId: fb.workflowRun?.id ?? null,
      })),
      confidence,
      isCollective: false,
    }
  }

  // Collective insight — check weighted sum across stakeholders
  const allStakeholders = [...byStakeholder.entries()]
  if (allStakeholders.length < COLLECTIVE_THRESHOLD) return null

  const totalWeightedCount = allStakeholders.reduce((sum, [, items]) => {
    const weight = seniorityWeight(items[0].stakeholder.seniority)
    return sum + items.length * weight
  }, 0)

  if (totalWeightedCount < COLLECTIVE_THRESHOLD) return null

  const allItems = allStakeholders.flatMap(([, items]) => items)
  const confidence = Math.min(1, totalWeightedCount / denominator)

  return {
    instanceCount: allItems.length,
    stakeholderIds: allStakeholders.map(([id]) => id),
    evidenceQuotes: allItems.slice(0, 3).map((fb) => ({
      text: extractEvidenceText(fb),
      stakeholderId: fb.stakeholderId,
      stakeholderName: fb.stakeholder.name,
      runId: fb.workflowRun?.id ?? null,
    })),
    confidence,
    isCollective: true,
  }
}

function extractEvidenceText(fb: FeedbackWithStakeholder): string {
  if (fb.toneFeedback) return `Tone flagged as: ${fb.toneFeedback.replace(/_/g, ' ')}`
  const tags = (fb.contentTags as string[]) ?? []
  if (tags.length > 0) return `Tagged: ${tags.join(', ')}`
  const changes = (fb.specificChanges as Array<{ text?: string }>) ?? []
  if (changes[0]?.text) return changes[0].text.slice(0, 120)
  return 'Feedback submitted'
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit diff analysis — called when an editor saves editedContent
// ─────────────────────────────────────────────────────────────────────────────

interface EditDiff {
  runId: string
  nodeId: string
  editorId: string | null
  originalWords: number
  editedWords: number
  removedPhrases: string[]       // short phrases (2–5 words) present in original, gone from edited
  openingRewritten: boolean      // first paragraph changed significantly
  internalNotes: string | null
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function extractNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const ngrams = new Set<string>()
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '))
  }
  return ngrams
}

function firstParagraph(text: string): string {
  return text.trim().split(/\n{2,}/)[0] ?? ''
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const v of a) { if (b.has(v)) intersection++ }
  return intersection / (a.size + b.size - intersection)
}

function computeDiff(runId: string, nodeId: string, original: string, edited: string, editorId: string | null, notes: string | null): EditDiff {
  const origWords = wordCount(original)
  const editWords = wordCount(edited)

  // Find 3-gram and 4-gram phrases removed
  const orig3 = extractNgrams(original, 3)
  const edit3 = extractNgrams(edited, 3)
  const orig4 = extractNgrams(original, 4)
  const edit4 = extractNgrams(edited, 4)

  const removedPhrases: string[] = []
  for (const p of orig4) { if (!edit4.has(p)) removedPhrases.push(p) }
  if (removedPhrases.length === 0) {
    for (const p of orig3) { if (!edit3.has(p)) removedPhrases.push(p) }
  }
  // Limit to most distinctive (shortest, most common-word-free)
  const topRemoved = removedPhrases.slice(0, 10)

  // Opening paragraph similarity
  const origOpen = firstParagraph(original)
  const editOpen = firstParagraph(edited)
  const openSim = jaccardSimilarity(extractNgrams(origOpen, 2), extractNgrams(editOpen, 2))
  const openingRewritten = openSim < 0.45 && origOpen.length > 50

  return { runId, nodeId, editorId, originalWords: origWords, editedWords: editWords, removedPhrases: topRemoved, openingRewritten, internalNotes: notes }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point for edit-based pattern detection
// ─────────────────────────────────────────────────────────────────────────────

export async function detectEditPatterns(
  agencyId: string,
  clientId: string,
  _triggeredByRunId: string,
): Promise<void> {
  await withAgency(agencyId, async () => {
    // Load all completed runs for this client with editedContent
    const runs = await prisma.workflowRun.findMany({
      where: {
        agencyId,
        workflow: { clientId },
        status: 'completed',
        editedContent: { not: Prisma.JsonNull },
      },
      select: {
        id: true,
        output: true,
        editedContent: true,
        assigneeId: true,
        internalNotes: true,
      },
      orderBy: { completedAt: 'desc' },
      take: 100,
    })

    if (runs.length === 0) return

    const totalRuns = await prisma.workflowRun.count({
      where: { agencyId, workflow: { clientId }, status: 'completed' },
    })
    const denominator = Math.max(totalRuns, 1)

    // Compute diffs for each run
    const diffs: EditDiff[] = []
    for (const run of runs) {
      const edited = (run.editedContent ?? {}) as Record<string, string>
      const output = run.output as { nodeStatuses?: Record<string, { output?: unknown; status?: string }> }
      const nodeStatuses = output?.nodeStatuses ?? {}

      for (const [nodeId, editedText] of Object.entries(edited)) {
        const original = nodeStatuses[nodeId]?.output
        const originalText = typeof original === 'string' ? original
          : (original as Record<string, unknown>)?.content as string | undefined ?? ''
        if (!originalText.trim() || !editedText.trim()) continue
        diffs.push(computeDiff(run.id, nodeId, originalText, editedText, run.assigneeId, run.internalNotes))
      }
    }

    if (diffs.length === 0) return

    const existingInsights = await prisma.insight.findMany({
      where: { agencyId, clientId, status: { in: ['pending', 'applied'] }, type: { in: ['length', 'forbidden_term', 'structure'] } },
      select: { type: true, title: true },
    })
    const existingKeys = new Set(existingInsights.map((i) => `${i.type}:${i.title.toLowerCase()}`))

    const candidates: PatternCandidate[] = [
      ...detectLengthEdits(diffs, denominator),
      ...detectRemovedPhraseEdits(diffs, denominator),
      ...detectOpeningEdits(diffs, denominator),
    ]

    const created: PatternCandidate[] = []
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.title.toLowerCase()}`
      if (existingKeys.has(key)) continue
      await prisma.insight.create({
        data: {
          agencyId,
          clientId,
          type: candidate.type,
          title: candidate.title,
          body: candidate.body,
          confidence: candidate.confidence,
          status: 'pending',
          instanceCount: candidate.instanceCount,
          stakeholderIds: candidate.stakeholderIds,
          isCollective: candidate.isCollective,
          evidenceQuotes: candidate.evidenceQuotes as object[],
          suggestedNodeType: candidate.suggestedNodeType,
          suggestedConfigChange: candidate.suggestedConfigChange as Prisma.InputJsonValue,
        },
      })
      created.push(candidate)
    }

    // Generate corrected prompt suggestions for each new pattern
    if (created.length > 0) {
      generatePromptCorrections(agencyId, clientId, diffs, created).catch((e) =>
        console.error('[patternDetector] prompt correction generation failed:', e)
      )
    }
  })
}

// ─── Edit-specific pattern detectors ─────────────────────────────────────────

function detectLengthEdits(diffs: EditDiff[], denominator: number): PatternCandidate[] {
  const THRESHOLD = 3
  const shrinkDiffs = diffs.filter((d) => d.editedWords < d.originalWords * 0.85)
  const growDiffs   = diffs.filter((d) => d.editedWords > d.originalWords * 1.2)

  const candidates: PatternCandidate[] = []
  if (shrinkDiffs.length >= THRESHOLD) {
    const avgRatio = shrinkDiffs.reduce((s, d) => s + d.editedWords / d.originalWords, 0) / shrinkDiffs.length
    const targetWords = Math.round(shrinkDiffs.reduce((s, d) => s + d.editedWords, 0) / shrinkDiffs.length)
    candidates.push({
      type: 'length',
      title: 'Content is consistently too long',
      body: `Editors trimmed content by an average of ${Math.round((1 - avgRatio) * 100)}% across ${shrinkDiffs.length} runs. Target ~${targetWords} words.`,
      suggestedNodeType: 'output:content-output',
      suggestedConfigChange: { max_words: targetWords, min_words: Math.round(targetWords * 0.8) },
      evidenceQuotes: shrinkDiffs.slice(0, 3).map((d) => ({ text: `Trimmed from ~${d.originalWords} to ~${d.editedWords} words`, stakeholderId: d.editorId ?? 'internal', stakeholderName: 'Internal editor', runId: d.runId })),
      stakeholderIds: [...new Set(shrinkDiffs.map((d) => d.editorId ?? 'internal'))],
      instanceCount: shrinkDiffs.length,
      confidence: Math.min(1, shrinkDiffs.length / denominator * 3),
      isCollective: false,
    })
  }
  if (growDiffs.length >= THRESHOLD) {
    const targetWords = Math.round(growDiffs.reduce((s, d) => s + d.editedWords, 0) / growDiffs.length)
    candidates.push({
      type: 'length',
      title: 'Content is consistently too short',
      body: `Editors expanded content in ${growDiffs.length} runs. Target ~${targetWords} words.`,
      suggestedNodeType: 'output:content-output',
      suggestedConfigChange: { min_words: targetWords, max_words: Math.round(targetWords * 1.3) },
      evidenceQuotes: growDiffs.slice(0, 3).map((d) => ({ text: `Expanded from ~${d.originalWords} to ~${d.editedWords} words`, stakeholderId: d.editorId ?? 'internal', stakeholderName: 'Internal editor', runId: d.runId })),
      stakeholderIds: [...new Set(growDiffs.map((d) => d.editorId ?? 'internal'))],
      instanceCount: growDiffs.length,
      confidence: Math.min(1, growDiffs.length / denominator * 3),
      isCollective: false,
    })
  }
  return candidates
}

function detectRemovedPhraseEdits(diffs: EditDiff[], denominator: number): PatternCandidate[] {
  const THRESHOLD = 3
  const phraseCount: Record<string, EditDiff[]> = {}
  for (const d of diffs) {
    for (const phrase of d.removedPhrases) {
      phraseCount[phrase] ??= []
      phraseCount[phrase].push(d)
    }
  }
  const candidates: PatternCandidate[] = []
  for (const [phrase, items] of Object.entries(phraseCount)) {
    if (items.length < THRESHOLD) continue
    candidates.push({
      type: 'forbidden_term',
      title: `Avoid: "${phrase}"`,
      body: `Editors removed this phrase from ${items.length} runs. Add to the content rules.`,
      suggestedNodeType: 'logic',
      suggestedConfigChange: { forbidden_terms: [phrase] },
      evidenceQuotes: items.slice(0, 3).map((d) => ({ text: `Removed in edit of run ${d.runId.slice(-6)}`, stakeholderId: d.editorId ?? 'internal', stakeholderName: 'Internal editor', runId: d.runId })),
      stakeholderIds: [...new Set(items.map((d) => d.editorId ?? 'internal'))],
      instanceCount: items.length,
      confidence: Math.min(1, items.length / denominator * 3),
      isCollective: false,
    })
  }
  return candidates
}

function detectOpeningEdits(diffs: EditDiff[], denominator: number): PatternCandidate[] {
  const THRESHOLD = 3
  const rewrites = diffs.filter((d) => d.openingRewritten)
  if (rewrites.length < THRESHOLD) return []
  return [{
    type: 'structure',
    title: 'Opening paragraph consistently rewritten',
    body: `Editors rewrote the opening paragraph in ${rewrites.length} runs. Consider changing the AI prompt to improve first-paragraph quality.`,
    suggestedNodeType: 'logic:ai-generate',
    suggestedConfigChange: { prompt_hint: 'opening_paragraph' },
    evidenceQuotes: rewrites.slice(0, 3).map((d) => ({ text: `Opening rewritten in run ${d.runId.slice(-6)}${d.internalNotes ? ` — "${d.internalNotes.slice(0, 60)}"` : ''}`, stakeholderId: d.editorId ?? 'internal', stakeholderName: 'Internal editor', runId: d.runId })),
    stakeholderIds: [...new Set(rewrites.map((d) => d.editorId ?? 'internal'))],
    instanceCount: rewrites.length,
    confidence: Math.min(1, rewrites.length / denominator * 3),
    isCollective: false,
  }]
}

// ─── Prompt correction generation ────────────────────────────────────────────

async function generatePromptCorrections(
  agencyId: string,
  clientId: string,
  diffs: EditDiff[],
  patterns: PatternCandidate[],
): Promise<void> {
  // Take a representative sample of diffs to give the AI context
  const sample = diffs.slice(0, 5)
  const diffSummary = sample.map((d, i) =>
    `Edit ${i + 1}: ${d.originalWords} words → ${d.editedWords} words. ` +
    (d.openingRewritten ? 'Opening paragraph rewritten. ' : '') +
    (d.removedPhrases.length > 0 ? `Phrases removed: ${d.removedPhrases.slice(0, 3).join(', ')}. ` : '') +
    (d.internalNotes ? `Editor note: "${d.internalNotes}". ` : '')
  ).join('\n')

  const patternSummary = patterns.map((p) => `- ${p.title}: ${p.body}`).join('\n')

  const prompt = `You are a prompt engineering expert. An AI content generation system produced content that human editors consistently modified.

Here are patterns detected from ${diffs.length} rounds of edits:
${patternSummary}

Sample edit details:
${diffSummary}

Write a single, concise prompt instruction (2-4 sentences) that, if added to the AI content generation prompt, would produce content closer to what the editors want — avoiding the need for these manual corrections. Be specific and actionable.

Return only the prompt instruction text, nothing else.`

  try {
    const { provider: rProv, model: rModel } = await getModelForRole('brain_processing')
    const result = await callModel(
      { provider: rProv as 'anthropic' | 'openai' | 'ollama', model: rModel, api_key_ref: defaultApiKeyRefForProvider(rProv) },
      prompt,
    )
    const instruction = result.trim()
    if (!instruction || instruction.length < 20) return

    await withAgency(agencyId, async () => {
      await prisma.promptTemplate.create({
        data: {
          agencyId,
          clientId,
          name: `Auto: ${patterns[0]?.title ?? 'Content improvement'} (${new Date().toLocaleDateString()})`,
          body: instruction,
          category: 'general',
          description: `Generated from ${diffs.length} edit diffs. Patterns: ${patterns.map((p) => p.title).join('; ')}`,
          source: 'ai',
          createdBy: 'system',
        },
      })
    })
    console.log(`[patternDetector] generated prompt correction for client ${clientId}`)
  } catch (e) {
    console.error('[patternDetector] prompt correction AI call failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome tracking — called after a workflow run completes
// ─────────────────────────────────────────────────────────────────────────────

export async function trackInsightOutcomes(
  agencyId: string,
  clientId: string,
  workflowRunId: string,
): Promise<void> {
  await withAgency(agencyId, async () => {
    // Find all applied insights for this client that have a connected node
    const appliedInsights = await prisma.insight.findMany({
      where: {
        agencyId,
        clientId,
        status: 'applied',
        connectedNodeId: { not: null },
      },
    })

    if (appliedInsights.length === 0) return

    // Get the star rating from feedback on this run
    const runFeedback = await prisma.feedback.findMany({
      where: { agencyId, workflowRunId, starRating: { not: null } },
      select: { starRating: true },
    })

    if (runFeedback.length === 0) return

    const avgRating =
      runFeedback.reduce((s, f) => s + (f.starRating ?? 0), 0) / runFeedback.length

    for (const insight of appliedInsights) {
      // Set baseline from prior 5 runs if not yet set
      if (insight.baselineScore === null) {
        const priorFeedback = await prisma.feedback.findMany({
          where: {
            agencyId,
            workflowRun: { workflow: { clientId } },
            workflowRunId: { not: workflowRunId },
            starRating: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          take: 5 * 5, // up to 5 runs × up to 5 ratings each
          select: { starRating: true },
        })

        if (priorFeedback.length > 0) {
          const baseline =
            priorFeedback.reduce((s, f) => s + (f.starRating ?? 0), 0) / priorFeedback.length
          await prisma.insight.update({
            where: { id: insight.id },
            data: { baselineScore: baseline },
          })
        }
      }

      // Update post-application score and run count
      const newRunCount = insight.appliedRunCount + 1
      await prisma.insight.update({
        where: { id: insight.id },
        data: {
          postApplicationScore: avgRating,
          appliedRunCount: newRunCount,
        },
      })
    }
  })
}
