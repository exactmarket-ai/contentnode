import { prisma, withAgency } from '@contentnode/database'
import type { Prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Translation node executor — translates content via DeepL (primary) or
// Google Translate (fallback). Provider is selected via node config.
// ─────────────────────────────────────────────────────────────────────────────

// Languages that support DeepL formality setting
const DEEPL_FORMALITY_LANGS = new Set([
  'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT-BR', 'PT-PT', 'RU', 'JA',
])

// ─────────────────────────────────────────────────────────────────────────────
// DeepL integration
// ─────────────────────────────────────────────────────────────────────────────

async function translateWithDeepL(
  text: string,
  targetLang: string,
  sourceLang: string,
  formality: string,
): Promise<{ translatedText: string; detectedSourceLanguage: string }> {
  const apiKey = process.env.DEEPL_API_KEY
  if (!apiKey) throw new Error('DeepL: DEEPL_API_KEY not set')

  // Free keys end with :fx — paid keys use a different host
  const isFreeKey = apiKey.endsWith(':fx')
  const baseUrl = process.env.DEEPL_API_URL ?? (isFreeKey ? 'https://api-free.deepl.com/v2' : 'https://api.deepl.com/v2')

  const body: Record<string, unknown> = {
    text: [text],
    target_lang: targetLang,
  }
  if (sourceLang && sourceLang !== 'auto') {
    // DeepL source_lang only accepts 2-letter codes (EN, DE) — strip region if present
    body.source_lang = sourceLang.split('-')[0]
  }
  if (formality && formality !== 'default' && DEEPL_FORMALITY_LANGS.has(targetLang)) {
    body.formality = formality
  }

  const res = await fetch(`${baseUrl}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`DeepL translate failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as {
    translations: Array<{ text: string; detected_source_language: string }>
  }

  const translation = data.translations[0]
  if (!translation) throw new Error('DeepL: no translation in response')

  return {
    translatedText: translation.text,
    detectedSourceLanguage: translation.detected_source_language,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Translate integration
// ─────────────────────────────────────────────────────────────────────────────

async function translateWithGoogle(
  text: string,
  targetLang: string,
  sourceLang: string,
): Promise<{ translatedText: string; detectedSourceLanguage: string }> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY
  if (!apiKey) throw new Error('Google Translate: GOOGLE_TRANSLATE_API_KEY not set')

  const body: Record<string, unknown> = {
    q: text,
    target: targetLang,
    format: 'text',
  }
  if (sourceLang && sourceLang !== 'auto') {
    body.source = sourceLang
  }

  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Google Translate failed (${res.status}): ${errBody}`)
  }

  const data = (await res.json()) as {
    data: { translations: Array<{ translatedText: string; detectedSourceLanguage: string }> }
  }

  const translation = data.data?.translations?.[0]
  if (!translation) throw new Error('Google Translate: no translation in response')

  return {
    translatedText: translation.translatedText,
    detectedSourceLanguage: translation.detectedSourceLanguage ?? sourceLang,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage tracking
// ─────────────────────────────────────────────────────────────────────────────

async function logTranslationUsage(
  agencyId: string,
  provider: string,
  charCount: number,
  targetLanguage: string,
  workflowRunId: string,
  userId?: string | null,
): Promise<void> {
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  await withAgency(agencyId, () =>
    prisma.usageRecord.create({
      data: {
        agencyId,
        metric: 'translation_chars',
        quantity: charCount,
        periodStart,
        periodEnd,
        metadata: { provider, targetLanguage, workflowRunId, ...(userId ? { userId } : {}) } as Prisma.InputJsonValue,
      },
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class TranslationNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    // Resolve content from upstream — accept string or object with .content
    const resolvedInput = Array.isArray(input)
      ? input.filter((v) => v != null).join('\n\n')
      : input

    const content: string =
      typeof (resolvedInput as Record<string, unknown>)?.content === 'string'
        ? ((resolvedInput as Record<string, unknown>).content as string)
        : typeof resolvedInput === 'string'
        ? resolvedInput
        : JSON.stringify(resolvedInput)

    const targetLanguage = (config.target_language as string) ?? 'ES'
    const sourceLanguage = (config.source_language as string) ?? 'auto'
    const provider = (config.provider as string) ?? 'deepl'
    const formality = (config.formality as string) ?? 'default'
    const preserveFormatting = (config.preserve_formatting as boolean) ?? true

    // If neither key is configured, pass through with a warning
    const hasDeepL = !!process.env.DEEPL_API_KEY
    const hasGoogle = !!process.env.GOOGLE_TRANSLATE_API_KEY

    if (!hasDeepL && !hasGoogle) {
      console.warn('[translation] No API key configured — passing content through unchanged')
      return {
        output: {
          content,
          originalContent: content,
          targetLanguage,
          sourceLanguage,
          provider: 'none',
          charCount: content.length,
          warning: 'No translation API key configured. Content passed through unchanged.',
        },
      }
    }

    const isFreeKey = process.env.DEEPL_API_KEY?.endsWith(':fx')
  console.log(`[translation] provider=${provider} target=${targetLanguage} chars=${content.length} deepl-tier=${isFreeKey ? 'free' : 'paid'}`)

    let translatedText: string
    let detectedSourceLanguage: string
    let usedProvider: string

    // Try primary provider first, fall back if key missing
    const useDeepL = provider === 'deepl' && hasDeepL
    const useGoogle = provider === 'google' && hasGoogle
    const fallbackToGoogle = provider === 'deepl' && !hasDeepL && hasGoogle
    const fallbackToDeepL = provider === 'google' && !hasGoogle && hasDeepL

    if (useDeepL || fallbackToDeepL) {
      usedProvider = 'deepl'
      const result = await translateWithDeepL(content, targetLanguage, sourceLanguage, formality)
      translatedText = result.translatedText
      detectedSourceLanguage = result.detectedSourceLanguage
    } else if (useGoogle || fallbackToGoogle) {
      usedProvider = 'google'
      const result = await translateWithGoogle(content, targetLanguage, sourceLanguage)
      translatedText = result.translatedText
      detectedSourceLanguage = result.detectedSourceLanguage
    } else {
      // Should not reach here given the key check above
      usedProvider = 'none'
      translatedText = content
      detectedSourceLanguage = sourceLanguage
    }

    const charCount = content.length

    // Log usage (non-blocking)
    logTranslationUsage(ctx.agencyId, usedProvider, charCount, targetLanguage, ctx.workflowRunId, ctx.userId).catch(
      (err) => { console.error('[translation] failed to record usage:', err) },
    )

    return {
      output: {
        content: translatedText,
        originalContent: content,
        targetLanguage,
        sourceLanguage: detectedSourceLanguage,
        provider: usedProvider,
        charCount,
      },
    }
  }
}
