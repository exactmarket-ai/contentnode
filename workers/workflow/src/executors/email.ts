import { prisma } from '@contentnode/database'
import { downloadBuffer } from '@contentnode/storage'
import { safeDecrypt } from '../lib/crypto.js'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface ImageAsset { storageKey?: string; url?: string; filename?: string }

function extractImageAssets(input: unknown): ImageAsset[] {
  if (!input || typeof input !== 'object') return []
  const o = input as Record<string, unknown>
  if (Array.isArray(o.assets)) return o.assets as ImageAsset[]
  if (Array.isArray(o.generatedAssets)) return o.generatedAssets as ImageAsset[]
  return []
}

const PROVIDER_DEFAULT_ENV: Record<string, string> = {
  sendgrid: 'SENDGRID_API_KEY',
  resend:   'RESEND_API_KEY',
  mailgun:  'MAILGUN_API_KEY',
}

async function resolveEmailCredential(agencyId: string, provider: string, apiKeyRef: string): Promise<{ apiKey: string; meta: Record<string, unknown> }> {
  // 1. Try agency-level credential in DB (Settings → Email Provider Credentials)
  const cred = await prisma.agencyCredential.findFirst({
    where: { agencyId, provider },
    orderBy: { createdAt: 'asc' },
  }).catch(() => null)

  if (cred?.keyValue) {
    const key = safeDecrypt(cred.keyValue) ?? cred.keyValue
    return { apiKey: key, meta: (cred.meta as Record<string, unknown>) ?? {} }
  }

  // 2. Explicit env var reference from node config (legacy)
  if (apiKeyRef && process.env[apiKeyRef]) {
    return { apiKey: process.env[apiKeyRef]!, meta: {} }
  }

  // 3. Well-known env var for the provider (e.g. SENDGRID_API_KEY in worker env)
  const defaultRef = PROVIDER_DEFAULT_ENV[provider]
  if (defaultRef && process.env[defaultRef]) {
    return { apiKey: process.env[defaultRef]!, meta: {} }
  }

  return { apiKey: '', meta: {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractText(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return input
  const o = input as Record<string, unknown>
  if (typeof o.content === 'string') return o.content
  if (typeof o.text === 'string') return o.text
  // Image generation output — no text body, skip it
  if (Array.isArray(o.assets) || Array.isArray(o.generatedAssets)) return ''
  return JSON.stringify(input, null, 2)
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^===+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textToHtml(text: string): string {
  return stripMarkdown(text)
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

interface EmailAttachment { filename: string; content: string; type: string; disposition: 'attachment' }

async function sendViaSendGrid(params: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  text: string
  html: string
  attachments?: EmailAttachment[]
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
      ...(params.attachments?.length ? { attachments: params.attachments } : {}),
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
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const provider = (config.provider as string) ?? 'resend'
    const apiKeyRef = (config.api_key_ref as string) ?? ''  // legacy fallback only
    const fromEmail = (config.from_email as string) ?? 'noreply@example.com'
    const fromName = (config.from_name as string) ?? ''
    const toRaw = (config.to as string) ?? ''
    const subjectTemplate = (config.subject as string) ?? 'Your content is ready'
    const mailgunDomain = (config.mailgun_domain as string) ?? ''

    if (!toRaw.trim()) throw new Error('Email node: "To" address is required')

    const { apiKey, meta } = await resolveEmailCredential(ctx.agencyId, provider, apiKeyRef)
    const resolvedMailgunDomain = (meta.mailgunDomain as string | undefined) ?? mailgunDomain
    if (!apiKey) throw new Error(`Email node: no ${provider} API key configured. Add one in Settings → Credentials.`)

    const imageAssets = extractImageAssets(input)
    const content = extractText(input)
    const cleanContent = stripMarkdown(content)
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
    const to = toRaw.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)
    const subject = interpolate(subjectTemplate, { content: cleanContent.slice(0, 60) })

    // Build attachments from image assets
    const attachments: EmailAttachment[] = []
    for (const asset of imageAssets) {
      if (!asset.storageKey) continue
      try {
        const buffer = await downloadBuffer(asset.storageKey)
        const ext = asset.storageKey.split('.').pop()?.toLowerCase() ?? 'jpg'
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        const filename = asset.filename ?? `image-${attachments.length + 1}.${ext}`
        attachments.push({ filename, content: buffer.toString('base64'), type: mime, disposition: 'attachment' })
      } catch (err) {
        console.warn(`[email] could not load image asset ${asset.storageKey}:`, err)
      }
    }

    // Build HTML — embed images inline if present, otherwise plain text-to-html
    const html = attachments.length > 0
      ? textToHtml(content) + attachments.map((a) =>
          `<p><img src="data:${a.type};base64,${a.content}" style="max-width:100%" alt="${a.filename}" /></p>`
        ).join('')
      : textToHtml(content)

    console.log(`[email] sending via ${provider} to ${to.join(', ')}, subject: "${subject}", attachments: ${attachments.length}`)

    if (provider === 'resend') {
      await sendViaResend({ apiKey, from, to, subject, text: cleanContent, html })
    } else if (provider === 'sendgrid') {
      await sendViaSendGrid({ apiKey, from, to, subject, text: cleanContent, html, attachments })
    } else if (provider === 'mailgun') {
      if (!resolvedMailgunDomain) throw new Error('Email node: Mailgun domain is required')
      await sendViaMailgun({ apiKey, domain: resolvedMailgunDomain, from, to, subject, text: cleanContent, html })
    } else {
      throw new Error(`Email node: unknown provider "${provider}"`)
    }

    return {
      output: {
        sent: true,
        provider,
        to,
        subject,
        attachments: attachments.length,
        charCount: content.length,
      },
    }
  }
}
