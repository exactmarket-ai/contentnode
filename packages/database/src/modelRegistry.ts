import { prisma } from './client.js'

// ─────────────────────────────────────────────────────────────────────────────
// Safe hardcoded fallbacks — used when the registry is unavailable or the
// role key is not found. Generation roles fall back to Sonnet; fast/scoring
// roles fall back to Haiku.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_FALLBACKS: Record<string, { provider: string; model: string }> = {
  generation_primary: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  generation_fast:    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  humanizer:          { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  research_synthesis: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  brain_processing:   { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  scoring_review:     { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
}

const DEFAULT_FALLBACK = { provider: 'anthropic', model: 'claude-sonnet-4-5' }

/**
 * Returns { provider, model } for the given registry role key.
 *
 * Queries the model_registry table fresh on every call — no cross-request
 * caching — so registry changes take effect on the next run without a restart.
 *
 * Falls back to hardcoded safe defaults if the registry is unavailable or the
 * role key is not found. Logs a warning when fallback is used.
 */
export async function getModelForRole(roleKey: string): Promise<{ provider: string; model: string }> {
  try {
    const entry = await prisma.modelRegistry.findUnique({ where: { roleKey } })
    if (entry) {
      return { provider: entry.provider, model: entry.model }
    }
    const fallback = ROLE_FALLBACKS[roleKey] ?? DEFAULT_FALLBACK
    console.warn(`[modelRegistry] Role "${roleKey}" not found — using fallback ${fallback.provider}/${fallback.model}`)
    return fallback
  } catch (err) {
    const fallback = ROLE_FALLBACKS[roleKey] ?? DEFAULT_FALLBACK
    console.warn(`[modelRegistry] Registry query failed for role "${roleKey}" — using fallback ${fallback.provider}/${fallback.model}`, err)
    return fallback
  }
}

/**
 * Returns the default API key env var name for a given provider.
 * Used by executors to build a complete ModelConfig from registry results.
 */
export function defaultApiKeyRefForProvider(provider: string): string {
  switch (provider) {
    case 'openai':   return 'OPENAI_API_KEY'
    case 'google':   return 'GOOGLE_API_KEY'
    case 'mistral':  return 'MISTRAL_API_KEY'
    case 'groq':     return 'GROQ_API_KEY'
    case 'ollama':   return ''
    default:         return 'ANTHROPIC_API_KEY'
  }
}
