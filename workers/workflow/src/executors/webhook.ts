import { createHmac } from 'node:crypto'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

function extractContent(input: unknown): unknown {
  if (!input) return {}
  if (typeof input === 'string') return { content: input }
  const o = input as Record<string, unknown>
  if (typeof o.content === 'string') return { content: o.content }
  return input
}

export class WebhookNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const url = (config.url as string) ?? ''
    if (!url.trim()) throw new Error('Webhook node: URL is required')

    const method = ((config.method as string) ?? 'POST').toUpperCase()
    const contentType = (config.content_type as string) ?? 'application/json'
    const authType = (config.auth_type as string) ?? 'none'
    const authValueRef = (config.auth_value_ref as string) ?? ''
    const secretRef = (config.secret_ref as string) ?? ''
    const customHeadersRaw = (config.custom_headers as string) ?? ''

    // Resolve secrets from env
    const authValue = authValueRef ? (process.env[authValueRef] ?? '') : ''
    const secret = secretRef ? (process.env[secretRef] ?? '') : ''

    // Build payload
    const payload = extractContent(input)
    let body: string
    if (contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams()
      if (typeof payload === 'object' && payload !== null) {
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          params.append(k, String(v))
        }
      } else {
        params.append('content', String(payload))
      }
      body = params.toString()
    } else {
      body = JSON.stringify(payload)
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'User-Agent': 'ContentNode/1.0',
    }

    if (authType === 'bearer' && authValue) {
      headers['Authorization'] = `Bearer ${authValue}`
    } else if (authType === 'basic' && authValue) {
      headers['Authorization'] = `Basic ${Buffer.from(authValue).toString('base64')}`
    }

    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex')
      headers['X-ContentNode-Signature'] = `sha256=${sig}`
    }

    // Parse and apply custom headers (one per line: Key: Value)
    if (customHeadersRaw.trim()) {
      for (const line of customHeadersRaw.split('\n')) {
        const idx = line.indexOf(':')
        if (idx > 0) {
          const k = line.slice(0, idx).trim()
          const v = line.slice(idx + 1).trim()
          if (k) headers[k] = v
        }
      }
    }

    console.log(`[webhook] ${method} ${url}`)

    const res = await fetch(url, { method, headers, body })
    const responseText = await res.text()

    if (!res.ok) {
      throw new Error(`Webhook failed: ${res.status} ${res.statusText} — ${responseText.slice(0, 200)}`)
    }

    let responseData: unknown = responseText
    try { responseData = JSON.parse(responseText) } catch { /* keep as text */ }

    console.log(`[webhook] delivered, status: ${res.status}`)

    return {
      output: {
        delivered: true,
        status: res.status,
        url,
        response: responseData,
      },
    }
  }
}
