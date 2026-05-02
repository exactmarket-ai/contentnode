import { prisma, withAgency } from '@contentnode/database'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EvidenceQuote {
  text: string
  stakeholderId: string
  stakeholderName: string
  runId: string | null
}

// Shape stored in StakeholderPreferenceProfile JSON arrays
interface PatternSignalEntry {
  patternType: string
  insightTitle: string
  signal: string
  confidence: number
  observedCount: number
  clientId: string
  firstSeenAt: string
  lastSeenAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

function signalArrayKey(patternType: string): 'toneSignals' | 'structureSignals' | 'rejectPatterns' {
  if (patternType === 'tone') return 'toneSignals'
  if (patternType === 'structure' || patternType === 'length') return 'structureSignals'
  return 'rejectPatterns' // forbidden_term, claims, unknown
}

function buildActionDescription(type: string, title: string): string {
  switch (type) {
    case 'tone': {
      const tone = title.replace(/^content is /i, '').trim()
      return `flags content tone as "${tone}"`
    }
    case 'forbidden_term': {
      const term = title.replace(/^avoid:\s*/i, '').replace(/^"|"$/g, '').trim()
      return `removes or avoids the phrase "${term}"`
    }
    case 'structure':
      return `flags content as ${title.toLowerCase()}`
    case 'length':
      return /too long/i.test(title)
        ? 'flags content as too long and trims it down'
        : 'flags content as too short and requests expansion'
    case 'claims':
      return 'consistently requests changes to specific claims or statements'
    default:
      return `flags content issues related to ${type}`
  }
}

function buildProse(
  stakeholderRole: string | null,
  stakeholderName: string,
  type: string,
  title: string,
  instanceCount: number,
  confidence: number,
  campaignCount: number,
  exampleQuote: string | undefined,
): string {
  const roleLabel = `${stakeholderRole ?? 'reviewer'} reviewer`
  const action = buildActionDescription(type, title)
  const level = confidence >= 0.7 ? 'high' : 'medium'

  let line = `${roleLabel} ${stakeholderName} ${action}. Triggered ${instanceCount} time${instanceCount === 1 ? '' : 's'}`
  if (campaignCount > 1) {
    line += ` across ${campaignCount} campaign${campaignCount === 1 ? '' : 's'}`
  }
  line += `. Confidence: ${level}.`
  if (exampleQuote) {
    line += ` Example: ${exampleQuote}`
  }
  return line
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesizeInsightToBrain(
  insightId: string,
  agencyId: string,
  clientId: string,
): Promise<void> {
  await withAgency(agencyId, async () => {
    const insight = await prisma.insight.findFirst({
      where: { id: insightId, agencyId, clientId },
    })
    if (!insight) return

    const stakeholderIds = insight.stakeholderIds as string[]
    if (!Array.isArray(stakeholderIds) || stakeholderIds.length === 0) return

    const stakeholders = await prisma.stakeholder.findMany({
      where: { id: { in: stakeholderIds }, agencyId },
      select: { id: true, name: true, role: true },
    })
    if (stakeholders.length === 0) return

    // Count distinct workflows from evidence quote run IDs
    const quotes = (insight.evidenceQuotes as EvidenceQuote[]) ?? []
    const runIds = quotes.map((q) => q.runId).filter((id): id is string => !!id)
    let campaignCount = 1
    if (runIds.length > 0) {
      const runs = await prisma.workflowRun.findMany({
        where: { id: { in: runIds }, agencyId },
        select: { workflowId: true },
      })
      campaignCount = Math.max(1, new Set(runs.map((r) => r.workflowId)).size)
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const arrayKey = signalArrayKey(insight.type)
    const confidence = insight.confidence ?? 0

    for (const sh of stakeholders) {
      const stakeholderQuotes = quotes.filter((q) => q.stakeholderId === sh.id)
      const exampleQuote = stakeholderQuotes[0]?.text

      // ── 1. Upsert StakeholderPreferenceProfile ──────────────────────────────
      const newEntry: PatternSignalEntry = {
        patternType: insight.type,
        insightTitle: insight.title,
        signal: buildActionDescription(insight.type, insight.title),
        confidence,
        observedCount: insight.instanceCount,
        clientId,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
      }

      const existingProfile = await prisma.stakeholderPreferenceProfile.findFirst({
        where: { stakeholderId: sh.id },
      })

      if (existingProfile) {
        const arr = (existingProfile[arrayKey] as PatternSignalEntry[]) ?? []
        const idx = arr.findIndex(
          (e) => e.patternType === insight.type && e.insightTitle === insight.title && e.clientId === clientId
        )
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], confidence, observedCount: insight.instanceCount, signal: newEntry.signal, lastSeenAt: nowIso }
        } else {
          arr.push(newEntry)
        }
        await prisma.stakeholderPreferenceProfile.update({
          where: { stakeholderId: sh.id },
          data: { [arrayKey]: arr, lastSignalAt: now },
        })
      } else {
        await prisma.stakeholderPreferenceProfile.create({
          data: {
            stakeholderId: sh.id,
            agencyId,
            [arrayKey]: [newEntry],
            lastSignalAt: now,
          },
        })
      }

      // ── 2. Write/update ClientBrainAttachment ───────────────────────────────
      const prose = buildProse(sh.role, sh.name, insight.type, insight.title, insight.instanceCount, confidence, campaignCount, exampleQuote)
      const roleLabel = sh.role ?? 'reviewer'
      const summary = `STAKEHOLDER PATTERN — ${roleLabel} ${sh.name} — ${insight.type}\n\n${prose}`
      const filename = `stakeholder-pattern-${sh.id}-${insight.type}-${toSlug(insight.title)}.md`

      const existingAttachment = await prisma.clientBrainAttachment.findFirst({
        where: { agencyId, clientId, filename },
        select: { id: true },
      })

      if (existingAttachment) {
        await prisma.clientBrainAttachment.update({
          where: { id: existingAttachment.id },
          data: { summary, summaryStatus: 'ready' },
        })
      } else {
        await prisma.clientBrainAttachment.create({
          data: {
            agencyId,
            clientId,
            source: 'stakeholder_pattern',
            filename,
            mimeType: 'text/markdown',
            summaryStatus: 'ready',
            summary,
            uploadMethod: 'note',
          },
        })
      }

      console.log(`[insightBrainSynthesizer] wrote brain attachment for stakeholder ${sh.id}, pattern ${insight.type}`)
    }
  })
}
