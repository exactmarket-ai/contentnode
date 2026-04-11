import { prisma, withAgency } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]).filter((s) => typeof s === 'string' && s.trim()) : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function formatBrandContext(
  clientName: string,
  verticalName: string,
  brand: Record<string, unknown>,
  source: string,
): string {
  const vt = (brand.voice_and_tone ?? {}) as Record<string, unknown>
  const msg = (brand.messaging ?? {}) as Record<string, unknown>
  const pos = (brand.positioning ?? {}) as Record<string, unknown>
  const aud = (brand.target_audience ?? {}) as Record<string, unknown>
  const vis = (brand.visual_identity ?? {}) as Record<string, unknown>

  const lines: string[] = [
    '--- BRAND CONTEXT ---',
    `Client: ${clientName} | Vertical: ${verticalName}`,
  ]

  if (str(brand.brand_name)) lines.push(`Brand: ${str(brand.brand_name)}`)
  if (str(brand.tagline))    lines.push(`Tagline: ${str(brand.tagline)}`)
  if (str(brand.mission))    lines.push(`Mission: ${str(brand.mission)}`)
  if (str(brand.vision))     lines.push(`Vision: ${str(brand.vision)}`)

  const values = arr(brand.values)
  if (values.length) lines.push(`Values: ${values.join(', ')}`)

  const traits = arr(vt.personality_traits)
  if (traits.length) lines.push(`Voice: ${traits.join(', ')}`)

  if (str(vt.writing_style)) lines.push(`Style: ${str(vt.writing_style)}`)

  const vocabUse = arr(vt.vocabulary_to_use)
  if (vocabUse.length) lines.push(`Use: ${vocabUse.join(', ')}`)

  const doNotUse = [...arr(vt.vocabulary_to_avoid), ...arr(brand.do_not_use)]
  if (doNotUse.length) lines.push(`Avoid: ${doNotUse.join(', ')}`)

  const coreMsg = str(msg.core_message)
  if (coreMsg) lines.push(`Core Message: ${coreMsg}`)

  const diffs = arr(pos.differentiators)
  if (diffs.length) lines.push(`Differentiators: ${diffs.join(', ')}`)

  const vps = arr(msg.value_propositions)
  if (vps.length) lines.push(`Value Props: ${vps.join(' | ')}`)

  const primary = str(aud.primary)
  if (primary) lines.push(`Primary Audience: ${primary}`)

  const category = str(pos.category)
  if (category) lines.push(`Market Category: ${category}`)

  const colors = [...arr(vis.primary_colors), ...arr(vis.secondary_colors)]
  if (colors.length) lines.push(`Brand Colors: ${colors.join(', ')}`)

  lines.push('---------------------')
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class BrandContextExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const configClientId = config.clientId as string | undefined
    const clientId = configClientId || ctx.clientId || ''
    const verticalId = (config.verticalId as string | undefined) || null
    const dataSource = (config.dataSource as string | undefined) || 'both'

    if (!clientId) {
      throw new Error('Brand Context node: no client configured. Select a client in the node config panel.')
    }

    let output = ''

    await withAgency(ctx.agencyId, async () => {
      const [client, vertical, profile, builder] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId: ctx.agencyId }, select: { name: true } }),
        verticalId
          ? prisma.clientBrandVertical.findFirst({ where: { id: verticalId, clientId, agencyId: ctx.agencyId }, select: { name: true } })
          : null,
        (dataSource === 'both' || dataSource === 'profile')
          ? prisma.clientBrandProfile.findFirst({
              where: { clientId, agencyId: ctx.agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
              select: { editedJson: true, extractedJson: true },
            })
          : null,
        (dataSource === 'both' || dataSource === 'builder')
          ? prisma.clientBrandBuilder.findFirst({
              where: { clientId, agencyId: ctx.agencyId, ...(verticalId ? { verticalId } : { verticalId: null }) },
              select: { dataJson: true },
            })
          : null,
      ])

      if (!client) throw new Error(`Brand Context node: client ${clientId} not found`)

      const profileData = (profile?.editedJson ?? profile?.extractedJson ?? null) as Record<string, unknown> | null
      const builderData = (builder?.dataJson ?? null) as Record<string, unknown> | null

      if (!profileData && !builderData) {
        throw new Error(
          `Brand Context node: no brand data found for ${client.name}${vertical ? ` / ${vertical.name}` : ' / General'}. ` +
          `Add brand data in Client → Branding.`
        )
      }

      // Merge: builder values take priority, profile fills gaps
      const merged: Record<string, unknown> = { ...(profileData ?? {}), ...(builderData ?? {}) }

      const clientName  = client.name
      const verticalName = vertical?.name ?? 'General'
      const source = profileData && builderData ? 'merged' : profileData ? 'brand_profile' : 'brand_builder'

      output = formatBrandContext(clientName, verticalName, merged, source)
    })

    return { output }
  }
}
