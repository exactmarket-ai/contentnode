import { callModel, type ModelConfig } from '@contentnode/ai'
import { getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export class SchemaMarkupExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const content = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    if (!content.trim()) throw new Error('Schema Markup: no content received from upstream node')

    const { provider: regProvider, model: regModel } = await getModelForRole('generation_fast')
    const modelCfg: ModelConfig = {
      provider: regProvider as 'anthropic' | 'openai' | 'ollama',
      model: regModel,
      api_key_ref: defaultApiKeyRefForProvider(regProvider),
      temperature: 0.1,
      max_tokens: 2048,
    }

    const schemaType     = (config.schemaType     as string) ?? 'auto'
    const outputFormat   = (config.outputFormat   as string) ?? 'json-ld-only'
    const includeOptional = (config.includeOptional as boolean) ?? false

    const typeInstruction = schemaType === 'auto'
      ? 'Analyse the content and choose the single most appropriate schema type from: Article, FAQPage, HowTo, Product, Organization, BreadcrumbList, WebPage.'
      : `Use schema type: ${schemaType}.`

    const fieldInstruction = includeOptional
      ? 'Include all required properties AND all commonly-used optional properties. Mark placeholder values with the string "[PLACEHOLDER]".'
      : 'Include only required and high-value properties. Omit rarely-used optional fields.'

    const prompt = `You are a structured data expert. Generate valid JSON-LD schema markup for the content below.

${typeInstruction}
${fieldInstruction}

Rules:
- Output ONLY valid JSON. No markdown fences, no explanation, no prose.
- The JSON must be parseable by JSON.parse() without modification.
- Use schema.org vocabulary.
- Do not invent URLs — use "[URL_HERE]" as placeholder for any URL properties.

CONTENT:
${content.slice(0, 4000)}`

    const tryGenerate = async (): Promise<string> => {
      const result = await callModel({ ...modelCfg }, prompt)
      return result.text.trim()
    }

    let raw = await tryGenerate()

    // Strip markdown fences if the model added them despite instructions
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    // Validate JSON — retry once if invalid
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const retryResult = await callModel(
        { ...modelCfg },
        `${prompt}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY the JSON object — no markdown, no explanation, no extra text.`,
      )
      raw = retryResult.text.trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      parsed = JSON.parse(raw) // throws if still invalid — propagates as node failure
    }

    let output: string
    if (outputFormat === 'script-tag') {
      output = `<script type="application/ld+json">\n${JSON.stringify(parsed, null, 2)}\n</script>`
    } else {
      output = JSON.stringify(parsed, null, 2)
    }

    return { output }
  }
}
