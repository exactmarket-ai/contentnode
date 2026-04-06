import { prisma, withAgency } from '@contentnode/database'

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
          suggestedConfigChange: candidate.suggestedConfigChange,
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
