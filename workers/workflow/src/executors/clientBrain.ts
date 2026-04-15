import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import { assembleLayeredContext } from '../clientBrainExtraction.js'

// ─────────────────────────────────────────────────────────────────────────────
// Section metadata
// ─────────────────────────────────────────────────────────────────────────────

const GTM_SECTIONS: Record<string, string> = {
  '01': 'Vertical Overview',
  '02': 'Customer Definition + Profile',
  '03': 'Market Pressures + Stats',
  '04': 'Core Challenges',
  '05': 'Solutions + Service Stack',
  '06': 'Why [Client]',
  '07': 'Segments + Buyer Profiles',
  '08': 'Messaging Framework',
  '09': 'Proof Points + Case Studies',
  '10': 'Objection Handling',
  '11': 'Brand Voice Examples',
  '12': 'Competitive Differentiation',
  '13': 'Customer Quotes + Testimonials',
  '14': 'Campaign Themes + Asset Mapping',
  '15': 'Frequently Asked Questions',
  '16': 'Content Funnel Mapping',
  '17': 'Regulatory + Compliance',
  '18': 'CTAs + Next Steps',
}

const DG_BASE_SECTIONS: Record<string, string> = {
  'B1': 'Revenue & Growth Goals',
  'B2': 'Sales Process & CRM',
  'B3': 'Marketing Budget & Resources',
}

const DG_VERTICAL_SECTIONS: Record<string, string> = {
  'S1': 'Current Marketing Reality',
  'S2': 'Offer Clarity',
  'S3': 'ICP + Buying Psychology',
  'S4': 'Revenue Goals + Constraints',
  'S5': 'Sales Process Alignment',
  'S6': 'Hidden Gold',
  'S7': 'External Intelligence',
}

const SKIP_KEYS = new Set(['_open', 'stage', 'id'])

// ─────────────────────────────────────────────────────────────────────────────
// Generic serialiser — walks any data tree and emits readable text
// ─────────────────────────────────────────────────────────────────────────────

function labelify(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/_/g, ' ').trim()
}

function serializeValue(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === 'string') return `${indent}- ${item.trim()}`
        if (item && typeof item === 'object') {
          const fields = Object.entries(item as Record<string, unknown>)
            .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== null && v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `${indent}  ${labelify(k)}: ${String(v).trim()}`)
          return fields.length > 0 ? fields.join('\n') : null
        }
        return null
      })
      .filter(Boolean)
    return items.join('\n')
  }
  if (typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `${indent}${labelify(k)}: ${String(v).trim()}`)
    return fields.join('\n')
  }
  return String(value).trim()
}

function serializeSection(data: Record<string, unknown>, key: string, title: string, prefix: string): string {
  const section = data[key] as Record<string, unknown> | undefined
  if (!section) return `## ${prefix}: ${title}\n(No data)`

  const lines: string[] = [`## ${prefix}: ${title}`]
  for (const [k, v] of Object.entries(section)) {
    if (SKIP_KEYS.has(k)) continue
    const serialized = serializeValue(v)
    if (!serialized.trim()) continue
    lines.push(`\n### ${labelify(k)}`)
    lines.push(serialized)
  }
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class ClientBrainExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const verticalId = config.verticalId as string | undefined
    const gtmSections    = (config.gtmSections    as string[]) ?? []
    const dgBaseSections = (config.dgBaseSections as string[]) ?? []
    const dgVertSections = (config.dgVertSections as string[]) ?? []
    const includeBrand   = (config.includeBrand   as boolean)  ?? false

    if (!ctx.clientId) throw new Error('Client Brain node: no client is associated with this workflow')

    // Vertical ID: prefer node config, fall back to workflow-level verticalId from context
    const resolvedVerticalId = verticalId || ctx.verticalId || null

    const parts: string[] = []

    // ── Four-tier brain context (Agency / Vertical / Client / Client×Vertical) ─
    const layeredCtx = await assembleLayeredContext(ctx.agencyId, ctx.clientId, resolvedVerticalId)
    if (layeredCtx) {
      parts.push(layeredCtx)
    }

    await withAgency(ctx.agencyId, async () => {
      const [client, vertical] = await Promise.all([
        prisma.client.findFirst({ where: { id: ctx.clientId!, agencyId: ctx.agencyId }, select: { name: true } }),
        resolvedVerticalId
          ? prisma.vertical.findFirst({ where: { id: resolvedVerticalId, agencyId: ctx.agencyId }, select: { name: true } })
          : Promise.resolve(null),
      ])

      const clientName = client?.name ?? ctx.clientId!
      const verticalName = vertical?.name ?? resolvedVerticalId ?? ''

      parts.push([
        `# Client Brain Context`,
        `Client: ${clientName}`,
        verticalName ? `Vertical: ${verticalName}` : '',
      ].filter(Boolean).join('\n'))

      // ── GTM Framework sections ──
      if (gtmSections.length > 0 && resolvedVerticalId) {
        const fw = await prisma.clientFramework.findFirst({
          where: { clientId: ctx.clientId!, verticalId: resolvedVerticalId, agencyId: ctx.agencyId },
          select: { data: true },
        })
        if (fw) {
          const data = fw.data as Record<string, unknown>
          const sorted = [...gtmSections].sort()
          parts.push(`\n# GTM Framework — ${verticalName}`)
          for (const num of sorted) {
            const sectionKey = `s${num}`
            const title = GTM_SECTIONS[num] ? GTM_SECTIONS[num].replace('[Client]', clientName) : `Section ${num}`
            parts.push(serializeSection(data, sectionKey, title, `GTM §${num}`))
          }
        }
      }

      // ── Demand Gen base sections (company-wide) ──
      if (dgBaseSections.length > 0) {
        const base = await prisma.clientDemandGenBase.findUnique({
          where: { clientId: ctx.clientId! },
          select: { data: true },
        })
        if (base) {
          const data = base.data as Record<string, unknown>
          parts.push(`\n# Demand Gen — Company-Wide`)
          for (const key of dgBaseSections) {
            const sectionKey = key.toLowerCase() // B1→b1, B2→b2, B3→b3
            const title = DG_BASE_SECTIONS[key] ?? key
            parts.push(serializeSection(data, sectionKey, title, key))
          }
        }
      }

      // ── Demand Gen vertical sections ──
      if (dgVertSections.length > 0 && resolvedVerticalId) {
        const dg = await prisma.clientDemandGen.findUnique({
          where: { clientId_verticalId: { clientId: ctx.clientId!, verticalId: resolvedVerticalId } },
          select: { data: true },
        })
        if (dg) {
          const data = dg.data as Record<string, unknown>
          parts.push(`\n# Demand Gen — ${verticalName}`)
          for (const key of dgVertSections) {
            const sectionKey = key.toLowerCase() // S1→s1, S2→s2…
            const title = DG_VERTICAL_SECTIONS[key] ?? key
            parts.push(serializeSection(data, sectionKey, title, key))
          }
        }
      }

      // ── Brand profile ──
      if (includeBrand) {
        const brand = await prisma.clientBrandProfile.findFirst({
          where: { clientId: ctx.clientId!, agencyId: ctx.agencyId },
          orderBy: { updatedAt: 'desc' },
          select: { editedJson: true, extractedJson: true },
        })
        if (brand) {
          // Prefer user-edited version; fall back to AI-extracted
          const rawData = brand.editedJson ?? brand.extractedJson
          if (rawData) {
            const data = rawData as Record<string, unknown>
            const lines: string[] = ['\n# Brand Profile']
            for (const [k, v] of Object.entries(data)) {
              if (SKIP_KEYS.has(k)) continue
              const serialized = serializeValue(v)
              if (!serialized.trim()) continue
              lines.push(`\n## ${labelify(k)}`)
              lines.push(serialized)
            }
            parts.push(lines.join('\n'))
          }
        }
      }

      // ── Global campaign brain docs (campaignScopedOnly = false) ──
      // Documents uploaded to a campaign brain and marked "Global" are injected
      // into every workflow run for this client, not just that campaign's runs.
      const globalCampaignDocs = await prisma.campaignBrainAttachment.findMany({
        where: {
          agencyId: ctx.agencyId,
          campaignScopedOnly: false,
          summaryStatus: 'ready',
          summary: { not: null },
          campaign: { clientId: ctx.clientId! },
        },
        select: {
          summary: true,
          filename: true,
          sourceUrl: true,
          campaign: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })

      if (globalCampaignDocs.length > 0) {
        const lines: string[] = ['\n# Campaign Intelligence (Global)']
        for (const doc of globalCampaignDocs) {
          const label = doc.sourceUrl ?? doc.filename
          lines.push(`\n## ${doc.campaign.name} — ${label}`)
          lines.push(doc.summary!)
        }
        parts.push(lines.join('\n'))
      }
    })

    return { output: parts.join('\n\n---\n\n') }
  }
}
