import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractText(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  const o = input as Record<string, unknown>
  if (typeof o.content === 'string') return o.content
  if (typeof o.text === 'string') return o.text
  return JSON.stringify(input, null, 2)
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────────

async function sendViaResend(params: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }
  const data = (await res.json()) as { id?: string }
  console.log(`[email] Resend delivered, id: ${data.id}`)
}

async function sendViaSendGrid(params: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}): Promise<void> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: params.to.map((email) => ({ email })) }],
      from: { email: params.from },
      subject: params.subject,
      content: [
        { type: 'text/plain', value: params.text },
        { type: 'text/html', value: params.html },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SendGrid API error ${res.status}: ${body}`)
  }
  console.log(`[email] SendGrid delivered`)
}

async function sendViaMailgun(params: {
  apiKey: string
  domain: string
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}): Promise<void> {
  const formData = new URLSearchParams()
  formData.append('from', params.from)
  params.to.forEach((t) => formData.append('to', t))
  formData.append('subject', params.subject)
  formData.append('text', params.text)
  formData.append('html', params.html)

  const res = await fetch(`https://api.mailgun.net/v3/${params.domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Mailgun API error ${res.status}: ${body}`)
  }
  const data = (await res.json()) as { id?: string }
  console.log(`[email] Mailgun delivered, id: ${data.id}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class EmailNodeExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const provider = (config.provider as string) ?? 'resend'
    const apiKeyRef = (config.api_key_ref as string) ?? ''
    const fromEmail = (config.from_email as string) ?? 'noreply@example.com'
    const fromName = (config.from_name as string) ?? ''
    const toRaw = (config.to as string) ?? ''
    const subjectTemplate = (config.subject as string) ?? 'Your content is ready'
    const mailgunDomain = (config.mailgun_domain as string) ?? ''

    if (!toRaw.trim()) throw new Error('Email node: "To" address is required')

    const apiKey = apiKeyRef ? (process.env[apiKeyRef] ?? '') : ''
    if (!apiKey) throw new Error(`Email node: API key env var "${apiKeyRef}" is not set`)

    const content = extractText(input)
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
    const to = toRaw.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)
    const subject = interpolate(subjectTemplate, { content: content.slice(0, 60) })
    const html = textToHtml(content)

    console.log(`[email] sending via ${provider} to ${to.join(', ')}, subject: "${subject}"`)

    if (provider === 'resend') {
      await sendViaResend({ apiKey, from, to, subject, text: content, html })
    } else if (provider === 'sendgrid') {
      await sendViaSendGrid({ apiKey, from, to, subject, text: content, html })
    } else if (provider === 'mailgun') {
      if (!mailgunDomain) throw new Error('Email node: Mailgun domain is required')
      await sendViaMailgun({ apiKey, domain: mailgunDomain, from, to, subject, text: content, html })
    } else {
      throw new Error(`Email node: unknown provider "${provider}"`)
    }

    return {
      output: {
        sent: true,
        provider,
        to,
        subject,
        charCount: content.length,
      },
    }
  }
}
