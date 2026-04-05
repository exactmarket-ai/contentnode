import Anthropic from '@anthropic-ai/sdk'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelConfig {
  /** AI provider to route to */
  provider: 'anthropic' | 'ollama'
  /** Model identifier (e.g. "claude-sonnet-4-5", "llama3") */
  model: string
  /**
   * Name of the environment variable that holds the actual API key.
   * For Ollama (local) this can be an empty string — no key is needed.
   * Example: "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_CLIENT_X"
   */
  api_key_ref: string
  /** Optional system prompt prepended to every call */
  system_prompt?: string
  temperature?: number
  max_tokens?: number
}

export interface ModelResult {
  text: string
  tokens_used: number
  model_used: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Key resolution — reads from env, never logs the value
// ─────────────────────────────────────────────────────────────────────────────

function resolveApiKey(ref: string): string {
  if (!ref) return ''
  const key = process.env[ref]
  if (!key) {
    throw new Error(`API key env var "${ref}" is not set`)
  }
  return key
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
// ─────────────────────────────────────────────────────────────────────────────

async function callAnthropic(config: ModelConfig, prompt: string): Promise<ModelResult> {
  const apiKey = resolveApiKey(config.api_key_ref)

  const client = new Anthropic({ apiKey })

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.max_tokens ?? 4096,
    ...(config.system_prompt ? { system: config.system_prompt } : {}),
    ...(config.temperature !== undefined ? {} : {}), // Anthropic uses temperature at top level
    messages,
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  return {
    text,
    tokens_used: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
    model_used: response.model,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama (local)
// ─────────────────────────────────────────────────────────────────────────────

interface OllamaChatResponse {
  model: string
  message: { role: string; content: string }
  prompt_eval_count?: number
  eval_count?: number
}

async function callOllama(config: ModelConfig, prompt: string): Promise<ModelResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'

  const body = {
    model: config.model,
    stream: false,
    messages: [
      ...(config.system_prompt
        ? [{ role: 'system', content: config.system_prompt }]
        : []),
      { role: 'user', content: prompt },
    ],
    options: {
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    },
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Ollama request failed with status ${res.status}`)
  }

  const data = (await res.json()) as OllamaChatResponse

  return {
    text: data.message.content,
    tokens_used: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    model_used: data.model,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route an AI call to the correct provider.
 *
 * API keys are read from environment variables named by `config.api_key_ref`.
 * Keys are never written to logs or included in thrown error messages.
 */
export async function callModel(config: ModelConfig, prompt: string): Promise<ModelResult> {
  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(config, prompt)
    case 'ollama':
      return callOllama(config, prompt)
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`)
    }
  }
}
