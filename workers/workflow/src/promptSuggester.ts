import { prisma, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel, type ModelResult } from '@contentnode/ai'

const SYSTEM_PROMPT = `You are a world-class content strategist helping a marketing agency build powerful AI writing prompts for their clients.

Given a client's brand profile, GTM framework, and uploaded materials, generate exactly 8 specific prompt templates that will produce high-quality, on-brand content in AI content workflows.

Each prompt must:
- Be immediately usable — specific enough to generate consistent, high-quality output
- Reflect this client's exact voice, tone, audience, and goals
- Use [TOPIC], [AUDIENCE], [PRODUCT], or similar placeholders for dynamic content
- Cover a useful spread of content types (blog, LinkedIn, email, ad copy, etc.)

Return ONLY a valid JSON array — no markdown fences, no explanation, no other text:
[{"name":"...","category":"Copy|Creative|Strategy|Marketing|Design|Business","description":"One sentence: when to use this prompt","body":"The full prompt text with [PLACEHOLDERS]"}]`

export interface PromptSuggestJobData {
  clientId: string
  agencyId: string
}

export async function generatePromptSuggestions(clientId: string, agencyId: string): Promise<void> {
  console.log(`[promptSuggester] starting for client=${clientId}`)
  // Load all available brain data
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId },
    select: {
      name: true,
      industry: true,
      brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { extractedJson: true, editedJson: true } },
      brandBuilders: { take: 1, orderBy: { createdAt: 'desc' }, select: { dataJson: true } },
      brandAttachments: {
        where: { extractionStatus: 'ready', summary: { not: null } },
        select: { filename: true, summary: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      frameworks: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { data: true, vertical: { select: { name: true } } },
      },
    },
  })

  if (!client) {
    console.warn(`[promptSuggester] client=${clientId} not found — skipping`)
    return
  }
  console.log(`[promptSuggester] loaded client="${client.name}", brandProfiles=${client.brandProfiles.length}, brandBuilders=${client.brandBuilders.length}, attachments=${client.brandAttachments.length}, frameworks=${client.frameworks.length}`)

  const brandProfile = client.brandProfiles[0]
  const brandBuilder = client.brandBuilders[0]
  const brandData =
    brandProfile?.editedJson ??
    brandProfile?.extractedJson ??
    brandBuilder?.dataJson

  const framework = client.frameworks[0]

  // Build context
  const lines: string[] = [
    `CLIENT: ${client.name}`,
    `INDUSTRY: ${client.industry ?? 'not specified'}`,
  ]

  if (brandData) {
    const b = brandData as Record<string, unknown>
    // Pull the most useful signal rather than dumping the whole blob
    const voice = (b.voice_and_tone ?? b.voice ?? b.tone) as Record<string, unknown> | undefined
    const audience = (b.target_audience ?? b.audience) as Record<string, unknown> | undefined
    const messaging = (b.messaging ?? b.messages) as Record<string, unknown> | undefined
    const doNotUse = b.do_not_use

    lines.push('\nBRAND:')
    if (b.mission)      lines.push(`  Mission: ${b.mission}`)
    if (b.tagline)      lines.push(`  Tagline: ${b.tagline}`)
    if (b.values)       lines.push(`  Values: ${JSON.stringify(b.values)}`)
    if (voice)          lines.push(`  Voice/Tone: ${JSON.stringify(voice)}`)
    if (audience)       lines.push(`  Target Audience: ${JSON.stringify(audience)}`)
    if (messaging)      lines.push(`  Messaging: ${JSON.stringify(messaging)}`)
    if (doNotUse)       lines.push(`  Do NOT use: ${JSON.stringify(doNotUse)}`)
  }

  if (framework?.data) {
    const f = framework.data as Record<string, unknown>
    lines.push(`\nGTM FRAMEWORK${framework.vertical?.name ? ` (${framework.vertical.name})` : ''}:`)
    lines.push(JSON.stringify(f, null, 2).slice(0, 3000)) // cap size
  }

  if (client.brandAttachments.length > 0) {
    lines.push('\nUPLOADED MATERIALS:')
    for (const att of client.brandAttachments) {
      lines.push(`— ${att.filename}:\n${att.summary}`)
    }
  }

  console.log(`[promptSuggester] calling Claude with ${lines.length} context lines`)
  const { provider: rProv, model: rModel } = await getModelForRole('generation_fast')
  let response: ModelResult
  try {
    response = await callModel(
      { provider: rProv as 'anthropic' | 'openai' | 'ollama', model: rModel, api_key_ref: defaultApiKeyRefForProvider(rProv), system_prompt: SYSTEM_PROMPT },
      lines.join('\n')
    )
  } catch (err) {
    console.error('[promptSuggester] callModel failed:', err)
    return
  }
  console.log(`[promptSuggester] got response, length=${response.text.length}`)

  // Strip any accidental markdown fences and parse
  let suggestions: Array<{ name: string; category: string; description: string; body: string }>
  try {
    const raw = response.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    suggestions = JSON.parse(raw)
    if (!Array.isArray(suggestions)) throw new Error('not an array')
  } catch {
    console.error('[promptSuggester] failed to parse response:', response.text.slice(0, 500))
    return
  }

  // Mark old AI suggestions stale, then create fresh ones
  await prisma.promptTemplate.updateMany({
    where: { clientId, agencyId, source: 'ai', isStale: false },
    data: { isStale: true },
  })

  if (suggestions.length > 0) {
    await prisma.promptTemplate.createMany({
      data: suggestions.map((s) => ({
        agencyId,
        clientId,
        name:        s.name        ?? 'Untitled',
        body:        s.body        ?? '',
        category:    s.category    ?? 'Marketing',
        description: s.description ?? null,
        source:      'ai',
        isStale:     false,
        createdBy:   'system',
      })),
    })
  }

  console.log(`[promptSuggester] generated ${suggestions.length} prompts for client=${clientId}`)
}
