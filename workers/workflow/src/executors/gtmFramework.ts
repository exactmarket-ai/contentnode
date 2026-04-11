import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Section metadata
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_NAMES: Record<string, string> = {
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

// Keys that are internal UI state, not content
const SKIP_KEYS = new Set(['_open', 'stage'])

// ─────────────────────────────────────────────────────────────────────────────
// Generic section serialiser — walks the data tree and emits readable text
// ─────────────────────────────────────────────────────────────────────────────

function labelify(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/_/g, ' ')
    .trim()
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

function assembleSection(data: Record<string, unknown>, sNum: string): string {
  const sectionKey = `s${sNum}`
  const section = data[sectionKey] as Record<string, unknown> | undefined
  const title = SECTION_NAMES[sNum] ?? `Section ${sNum}`

  if (!section) return `## Section ${sNum}: ${title}\n(No data)`

  const lines: string[] = [`## Section ${sNum}: ${title}`]

  for (const [key, value] of Object.entries(section)) {
    if (SKIP_KEYS.has(key)) continue
    const serialized = serializeValue(value)
    if (!serialized.trim()) continue
    lines.push(`\n### ${labelify(key)}`)
    lines.push(serialized)
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class GtmFrameworkExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const verticalId = config.verticalId as string | undefined
    const sections = (config.sections as string[]) ?? []

    if (!ctx.clientId) {
      throw new Error('GTM Framework node: no client is associated with this workflow')
    }
    if (!verticalId) {
      throw new Error('GTM Framework node: no vertical selected — configure the node first')
    }
    if (sections.length === 0) {
      throw new Error('GTM Framework node: no sections selected')
    }

    let output = ''

    await withAgency(ctx.agencyId, async () => {
      const [client, vertical, fw] = await Promise.all([
        prisma.client.findFirst({ where: { id: ctx.clientId!, agencyId: ctx.agencyId }, select: { name: true } }),
        prisma.vertical.findFirst({ where: { id: verticalId, agencyId: ctx.agencyId }, select: { name: true } }),
        prisma.clientFramework.findFirst({
          where: { clientId: ctx.clientId!, agencyId: ctx.agencyId },
          orderBy: { updatedAt: 'desc' },
          select: { data: true },
        }),
      ])

      if (!fw) throw new Error('GTM Framework node: no framework data found for this client')

      const data = fw.data as Record<string, unknown>
      const sortedSections = [...sections].sort()

      const header = [
        `# GTM Framework Context`,
        `Client: ${client?.name ?? ctx.clientId}`,
        `Vertical: ${vertical?.name ?? verticalId}`,
        `Sections included: ${sortedSections.map((s) => `${s} ${SECTION_NAMES[s] ?? ''}`).join(', ')}`,
        '',
      ].join('\n')

      const body = sortedSections
        .map((s) => assembleSection(data, s))
        .join('\n\n---\n\n')

      output = `${header}\n${body}`
    })

    return { output }
  }
}
