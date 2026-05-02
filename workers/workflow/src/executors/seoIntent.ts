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
// Trending signals helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getGoogleTrendsRisingQueries(keyword: string): Promise<{ rising: string[]; top: string[] }> {
  try {
    const req = JSON.stringify({
      comparisonItem: [{ keyword, geo: 'US', time: 'today 3-m' }],
      category: 0,
      property: '',
    })
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(req)}`
    const exploreRes = await fetch(exploreUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!exploreRes.ok) return { rising: [], top: [] }

    const exploreText = await exploreRes.text()
    const cleanExplore = exploreText.replace(/^\)\]\}'\n/, '')
    const exploreData = JSON.parse(cleanExplore) as {
      widgets: Array<{ id: string; request: unknown; token: string }>
    }

    const relatedWidget = exploreData.widgets?.find((w) => w.id === 'RELATED_QUERIES')
    if (!relatedWidget?.token) return { rising: [], top: [] }

    const widgetUrl =
      `https://trends.google.com/trends/api/widgetdata/relatedsearches` +
      `?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(relatedWidget.request))}` +
      `&token=${encodeURIComponent(relatedWidget.token)}`

    const widgetRes = await fetch(widgetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!widgetRes.ok) return { rising: [], top: [] }

    const widgetText = await widgetRes.text()
    const cleanWidget = widgetText.replace(/^\)\]\}'\n/, '')
    const widgetData = JSON.parse(cleanWidget) as {
      default: {
        rankedList: Array<{ rankedKeyword: Array<{ query: string }> }>
      }
    }

    const rankedList = widgetData.default?.rankedList ?? []
    const top = (rankedList[0]?.rankedKeyword ?? []).slice(0, 10).map((k) => k.query)
    const rising = (rankedList[1]?.rankedKeyword ?? []).slice(0, 10).map((k) => k.query)

    return { rising, top }
  } catch {
    return { rising: [], top: [] }
  }
}

/** PAA-style questions via autocomplete prefixes */
async function getQuestionBasedQueries(keyword: string): Promise<string[]> {
  const prefixes = ['how', 'what', 'why', 'when', 'where', 'who', 'is', 'can', 'does', 'which']
  const batches = await Promise.all(prefixes.map((p) => getAutocompleteSuggestions(`${p} ${keyword}`)))
  const seen = new Set<string>()
  const questions: string[] = []
  for (const batch of batches) {
    for (const q of batch) {
      const key = q.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        questions.push(q)
      }
    }
  }
  return questions.slice(0, 20)
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
    const includeTrendingSignals = (config.includeTrendingSignals as boolean) ?? false

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

    let totalTokensUsed = result.tokens_used ?? 0
    let totalInputTokens = result.input_tokens ?? 0
    let totalOutputTokens = result.output_tokens ?? 0

    // ── Trending signals (optional, purely additive) ──────────────────────────
    let trendingSection = ''

    if (includeTrendingSignals) {
      const primaryKeyword = seedKeywords[0] ?? topic

      const [trendsData, questionQueries] = await Promise.all([
        getGoogleTrendsRisingQueries(primaryKeyword),
        getQuestionBasedQueries(primaryKeyword),
      ])

      const trendsAvailable = trendsData.rising.length > 0 || trendsData.top.length > 0
      const questionsAvailable = questionQueries.length > 0

      trendingSection = '\n\n---\n\n## Trending Signals\n'

      // Rising queries block
      if (trendsAvailable) {
        trendingSection += '\n### Rising Queries (Google Trends)\n'
        if (trendsData.rising.length > 0) {
          trendingSection += trendsData.rising.map((q) => `- ${q}`).join('\n') + '\n'
        }
        if (trendsData.top.length > 0) {
          trendingSection += '\n**Top related:**\n'
          trendingSection += trendsData.top.map((q) => `- ${q}`).join('\n') + '\n'
        }
      } else {
        trendingSection += '\n> **Note:** Google Trends data was unavailable (request blocked or timed out). Content angles below are derived from autocomplete signals only.\n'
      }

      // Question-based queries block
      trendingSection += '\n### Question-Based Queries (People Also Ask)\n'
      if (questionsAvailable) {
        trendingSection += questionQueries.map((q) => `- ${q}`).join('\n') + '\n'
      } else {
        trendingSection += '_No question queries returned_\n'
      }

      // Claude-generated content angles from trending data
      trendingSection += '\n### Suggested Content Angles (Based on Trending Signals)\n'

      if (trendsAvailable || questionsAvailable) {
        let trendContext = ''
        if (trendsData.rising.length > 0) {
          trendContext += `Rising queries:\n${trendsData.rising.join('\n')}\n\n`
        }
        if (trendsData.top.length > 0) {
          trendContext += `Top related queries:\n${trendsData.top.join('\n')}\n\n`
        }
        if (questionsAvailable) {
          trendContext += `Question-based queries:\n${questionQueries.join('\n')}\n\n`
        }

        const anglesPrompt = `Based on these currently trending search queries for "${primaryKeyword}", suggest 4-5 specific content angles that tap into current demand. For each angle, give it a title and explain in one sentence why it's timely right now.\n\n${trendContext}\nReturn a numbered list only. No preamble.`

        const anglesResult = await callModel({ ...modelCfg, max_tokens: 1024 }, anglesPrompt)
        trendingSection += anglesResult.text + '\n'
        totalTokensUsed += anglesResult.tokens_used ?? 0
        totalInputTokens += anglesResult.input_tokens ?? 0
        totalOutputTokens += anglesResult.output_tokens ?? 0
      } else {
        trendingSection += '_Trend data was unavailable — no content angles could be generated._\n'
      }
    }

    return {
      output: result.text + trendingSection,
      tokensUsed: totalTokensUsed,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      modelUsed: result.model_used,
    }
  }
}
