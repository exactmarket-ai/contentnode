import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Google Autocomplete helper (free, no API key)
// ─────────────────────────────────────────────────────────────────────────────

async function getAutocompleteSuggestions(keyword: string): Promise<string[]> {
  try {
    const encoded = encodeURIComponent(keyword)
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encoded}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentNode/1.0)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const data = await res.json() as [string, string[]]
    return data[1] ?? []
  } catch {
    return []
  }
}

/** Fetch keyword data from DataForSEO */
async function fetchDataForSeo(
  keywords: string[],
  apiKey: string,
): Promise<Array<{ keyword: string; searchVolume: number; competition: string }>> {
  try {
    // DataForSEO expects Basic auth: login:password base64 encoded
    // api_key_ref format: "login:password" or just the base64 token
    const credentials = Buffer.from(apiKey).toString('base64')
    const res = await fetch(
      'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ keywords, language_code: 'en', location_code: 2840 }]),
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!res.ok) return []
    const data = await res.json() as {
      tasks?: Array<{ result?: Array<{ keyword: string; search_volume: number; competition: string }> }>
    }
    return (data.tasks?.[0]?.result ?? []).map((r) => ({
      keyword: r.keyword,
      searchVolume: r.search_volume,
      competition: r.competition,
    }))
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class SeoIntentExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const { provider: regProvider, model: regModel } = await getModelForRole('research_synthesis')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.3,
      max_tokens: 4096,
    }

    const seedKeywords = ((config.seedKeywords as string | undefined) ?? '')
      .split('\n').map((k) => k.trim()).filter(Boolean)
    const topic = (config.topic as string | undefined)?.trim() ?? ''
    const dataSource = (config.dataSource as string) ?? 'claude'
    const apiKeyRef = (config.apiKeyRef as string | undefined) ?? ''
    const funnelMapping = (config.funnelMapping as boolean) ?? true
    const expandCount = Math.min(60, Math.max(10, (config.expandCount as number) ?? 30))

    if (seedKeywords.length === 0 && !topic) {
      throw new Error('SEO Intent: provide at least one seed keyword or a topic')
    }

    let keywordData = ''

    // ── Google Autocomplete expansion ─────────────────────────────────────────
    if (dataSource === 'google_autocomplete' || dataSource === 'claude') {
      const suggestions: string[] = [...seedKeywords]

      if (dataSource === 'google_autocomplete') {
        const queryTerms = seedKeywords.length > 0 ? seedKeywords.slice(0, 5) : [topic]
        const autocompleteResults = await Promise.all(
          queryTerms.map((kw) => getAutocompleteSuggestions(kw))
        )
        const expanded = new Set<string>(suggestions)
        for (const results of autocompleteResults) {
          for (const s of results) expanded.add(s)
        }
        suggestions.push(...[...expanded].filter((s) => !suggestions.includes(s)))

        keywordData = `Seed keywords: ${seedKeywords.join(', ')}\n\nGoogle autocomplete suggestions:\n${suggestions.join('\n')}`
      }
    }

    // ── DataForSEO ────────────────────────────────────────────────────────────
    if (dataSource === 'dataforseo' && apiKeyRef) {
      const resolvedKey = process.env[apiKeyRef] ?? apiKeyRef
      const isEnvVarName = /^[A-Z][A-Z0-9_]+$/.test(apiKeyRef)
      if (isEnvVarName && !process.env[apiKeyRef]) {
        throw new Error(`SEO Intent: env var ${apiKeyRef} is not set`)
      }
      const actualKey = isEnvVarName ? process.env[apiKeyRef]! : resolvedKey
      const volumeData = await fetchDataForSeo(seedKeywords, actualKey)
      if (volumeData.length > 0) {
        keywordData = `Keyword search volume data:\n${volumeData
          .map((d) => `${d.keyword}: ${d.searchVolume}/mo, competition: ${d.competition}`)
          .join('\n')}`
      }
    }

    // ── Claude synthesis prompt ───────────────────────────────────────────────
    const funnelInstruction = funnelMapping
      ? `
Map each keyword to a funnel stage:
- **Awareness** — educational, problem-aware (e.g. "what is X", "how does Y work")
- **Consideration** — solution-aware, comparing options (e.g. "best X for Y", "X vs Z")
- **Decision** — ready to buy, brand-aware (e.g. "X pricing", "X alternative", "buy X")
- **Navigational** — looking for a specific site/brand
`
      : ''

    const systemPrompt = `You are an SEO strategist specializing in B2B content. Your task:

1. Expand the provided seed keywords/topic into ${expandCount} keyword variations covering the full topic landscape
2. For each keyword, classify the search intent
${funnelInstruction}
3. Estimate relative search volume: High / Medium / Low
4. Group keywords by theme/cluster

Output format — use this exact structure:
## Keyword Intelligence Report

### Topic: [topic/seed]

### Keyword Clusters

**[Cluster Name]**
| Keyword | Intent | Volume | Stage |
|---------|--------|--------|-------|
| ... | ... | ... | ... |

### Content Opportunities
[3-5 specific content angles with highest potential based on intent + volume]

### Quick Wins
[5 keywords with clear intent but likely lower competition]`

    const userContent = topic
      ? `Topic: ${topic}\n\nSeed keywords: ${seedKeywords.join(', ')}\n\n${keywordData}`
      : `Seed keywords: ${seedKeywords.join(', ')}\n\n${keywordData}`

    const result = await callModel({ ...modelCfg }, `${systemPrompt}\n\n${userContent}`)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed: result.model_used,
    }
  }
}
