import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const BASE_SYSTEM = 'Use US English spelling, grammar, and idioms throughout (e.g. "color" not "colour", "organize" not "organise", "license" not "licence"). Apply this unless the prompt explicitly instructs a different locale.'

function buildSystem(custom?: string): string {
  return custom ? `${BASE_SYSTEM}\n\n${custom}` : BASE_SYSTEM
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelConfig {
  /** AI provider to route to */
  provider: 'anthropic' | 'openai' | 'ollama'
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
  /** If set, treats this as a continuation of a prior truncated response (multi-turn prefill). */
  continuationOf?: string
  /** Per-request timeout in ms. Defaults to 180000 (3 min). Raise for long-output assets. */
  timeout_ms?: number
}

export interface ModelResult {
  text: string
  tokens_used: number   // combined total (kept for backward compat)
  input_tokens: number  // prompt + context tokens (billed at lower rate)
  output_tokens: number // generated tokens (billed at higher rate)
  model_used: string
  finish_reason: string // 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'
}

/** A base64-encoded image to pass as a vision input. */
export interface ImageInput {
  base64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
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

async function callAnthropic(config: ModelConfig, prompt: string, images?: ImageInput[]): Promise<ModelResult> {
  const apiKey = config.api_key_ref ? resolveApiKey(config.api_key_ref) : (process.env.ANTHROPIC_API_KEY ?? '')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  // timeout_ms is per request; retries are handled at the application layer (not the SDK).
  const client = new Anthropic({ apiKey, timeout: config.timeout_ms ?? (3 * 60 * 1000), maxRetries: 0 })

  const userContent: Anthropic.MessageParam['content'] = images && images.length > 0
    ? [
        ...images.map((img): Anthropic.ImageBlockParam => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        })),
        { type: 'text', text: prompt },
      ]
    : prompt

  const messages: Anthropic.MessageParam[] = config.continuationOf
    ? [
        { role: 'user', content: userContent },
        { role: 'assistant', content: config.continuationOf },
        { role: 'user', content: 'Continue exactly from where you left off. Do not repeat any content. Do not add any prefix or preamble.' },
      ]
    : [{ role: 'user', content: userContent }]

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.max_tokens ?? 4096,
    system: buildSystem(config.system_prompt),
    messages,
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const inputT  = response.usage.input_tokens  ?? 0
  const outputT = response.usage.output_tokens ?? 0
  return {
    text,
    tokens_used: inputT + outputT,
    input_tokens: inputT,
    output_tokens: outputT,
    model_used: response.model,
    finish_reason: response.stop_reason ?? 'unknown',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI
// ─────────────────────────────────────────────────────────────────────────────

async function callOpenAI(config: ModelConfig, prompt: string): Promise<ModelResult> {
  const apiKey = config.api_key_ref ? resolveApiKey(config.api_key_ref) : (process.env.OPENAI_API_KEY ?? '')
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  const client = new OpenAI({ apiKey })

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system' as const, content: buildSystem(config.system_prompt) },
    { role: 'user', content: prompt },
  ]

  const response = await client.chat.completions.create({
    model: config.model,
    messages,
    max_tokens: config.max_tokens ?? 4096,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  })

  const text = response.choices[0]?.message?.content ?? ''
  const usage = response.usage

  const inputT  = usage?.prompt_tokens     ?? 0
  const outputT = usage?.completion_tokens ?? 0
  return {
    text,
    tokens_used: inputT + outputT,
    input_tokens: inputT,
    output_tokens: outputT,
    model_used: response.model,
    finish_reason: response.choices[0]?.finish_reason ?? 'unknown',
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
      { role: 'system', content: buildSystem(config.system_prompt) },
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

  const inputT  = data.prompt_eval_count ?? 0
  const outputT = data.eval_count        ?? 0
  return {
    text: data.message.content,
    tokens_used: inputT + outputT,
    input_tokens: inputT,
    output_tokens: outputT,
    model_used: data.model,
    finish_reason: 'end_turn',
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
/**
 * Compute a text embedding using OpenAI's text-embedding-3-small (1536 dims).
 * Throws if OPENAI_API_KEY (or the specified ref) is not set.
 * Callers should catch and fall back gracefully when used for optional enrichment.
 */
export async function embedText(text: string, apiKeyRef = 'OPENAI_API_KEY'): Promise<number[]> {
  const key = process.env[apiKeyRef]
  if (!key) throw new Error(`embedText: ${apiKeyRef} is not set`)
  const openai = new OpenAI({ apiKey: key })
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),  // ~2000 tokens — well within the 8191 token limit
  })
  return resp.data[0].embedding
}

export async function callModel(config: ModelConfig, prompt: string, images?: ImageInput[]): Promise<ModelResult> {
  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(config, prompt, images)
    case 'openai':
      return callOpenAI(config, prompt)
    case 'ollama':
      return callOllama(config, prompt)
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`)
    }
  }
}
