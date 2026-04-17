import { callModel, type ModelConfig } from '@contentnode/ai'
import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.3,
  max_tokens: 8096,
}

const PAGE_TYPE_INSTRUCTIONS: Record<string, string> = {
  'landing-page':   'Conversion-focused layout: hero with headline + subhead + CTA, 3-column benefits grid, social proof / testimonials, final CTA section.',
  'email-html':     'HTML email with INLINE styles only (no <style> blocks — Gmail strips them). Max-width 600px centered table layout. Compatible with Outlook, Gmail, Apple Mail.',
  'one-pager':      'Clean document-style layout. Strong typography hierarchy, generous whitespace. Print-friendly — avoid large background fills.',
  'case-study':     'Structured story: client challenge → solution → measurable results. Highlight key metrics with large callout numbers. Quote from stakeholder.',
  'event-page':     'Event details prominent at top (date, location, format). Agenda section, speaker cards, registration CTA. Urgency / scarcity elements.',
  'product-brief':  'Product overview: headline value prop, key features in icon grid, use-case scenarios, technical specs table, CTA to learn more / demo.',
}

// ─── Brand context ────────────────────────────────────────────────────────────

interface BrandContext {
  primaryColor: string
  headingFont:  string
  bodyFont:     string
  toneNotes:    string
  clientName:   string
}

async function fetchBrand(clientId: string, agencyId: string): Promise<BrandContext> {
  const defaults: BrandContext = {
    primaryColor: '#1B1F3B',
    headingFont:  'Inter, system-ui, sans-serif',
    bodyFont:     'Inter, system-ui, sans-serif',
    toneNotes:    '',
    clientName:   '',
  }

  try {
    const [client, agency] = await Promise.all([
      prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: {
          name: true,
          primaryColor: true,
          headingFont: true,
          bodyFont: true,
        },
      }),
      prisma.agency.findUnique({
        where: { id: agencyId },
        select: {
          docPrimaryColor: true,
          docHeadingFont: true,
          docBodyFont: true,
        },
      }),
    ])

    // Attempt to pull tone from the most recent brand builder entry
    let toneNotes = ''
    try {
      const builder = await prisma.clientBrandBuilder.findFirst({
        where: { clientId, agencyId },
        select: { dataJson: true },
        orderBy: { updatedAt: 'desc' },
      })
      const data = (builder?.dataJson ?? {}) as Record<string, unknown>
      toneNotes = (data.toneOfVoice as string) ?? (data.tone as string) ?? (data.brand_voice as string) ?? ''
    } catch { /* non-fatal */ }

    return {
      primaryColor: client?.primaryColor ?? agency?.docPrimaryColor ?? defaults.primaryColor,
      headingFont:  client?.headingFont  ?? agency?.docHeadingFont  ?? defaults.headingFont,
      bodyFont:     client?.bodyFont     ?? agency?.docBodyFont     ?? defaults.bodyFont,
      toneNotes,
      clientName:   client?.name ?? '',
    }
  } catch {
    return defaults
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export class HtmlPageExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const pageType       = (config.pageType       as string)  ?? 'landing-page'
    const styleDirection = (config.styleDirection as string)  ?? ''
    const useBrandColors = (config.useBrandColors as boolean) ?? true

    const content = typeof input === 'string'
      ? input
      : typeof input === 'object' && input !== null
        ? JSON.stringify(input, null, 2)
        : String(input ?? '')

    if (!content.trim()) throw new Error('HTML Page: no input content received from upstream node')

    let brand: BrandContext = {
      primaryColor: '#1B1F3B',
      headingFont:  'Inter, system-ui, sans-serif',
      bodyFont:     'Inter, system-ui, sans-serif',
      toneNotes:    '',
      clientName:   '',
    }
    if (useBrandColors && ctx.clientId) {
      brand = await fetchBrand(ctx.clientId, ctx.agencyId)
    }

    const pageInstructions = PAGE_TYPE_INSTRUCTIONS[pageType] ?? PAGE_TYPE_INSTRUCTIONS['landing-page']

    const systemPrompt = `You are an expert HTML/CSS developer and conversion copywriter.
Generate a complete, self-contained, production-quality HTML page from the content provided.

OUTPUT RULES:
- Return ONLY the raw HTML document — no markdown fences, no explanation, no commentary.
- Start with <!DOCTYPE html>.
- Include Tailwind CSS via CDN in <head>: <script src="https://cdn.tailwindcss.com"></script>
- Configure Tailwind colours immediately after the CDN tag:
  <script>tailwind.config={theme:{extend:{colors:{brand:'${brand.primaryColor}'}}}}</script>
- All styling via Tailwind utility classes. No separate <style> blocks except for @font-face if needed.
- Fully responsive — mobile-first layout.
- Use semantic HTML5 (header, main, section, article, footer).

BRAND:
- Primary colour: ${brand.primaryColor} (use as bg-[${brand.primaryColor}] or text-[${brand.primaryColor}] in Tailwind)
- Heading font: ${brand.headingFont}
- Body font: ${brand.bodyFont}
${brand.clientName ? `- Client: ${brand.clientName}` : ''}
${brand.toneNotes ? `- Tone: ${brand.toneNotes}` : ''}

PAGE TYPE: ${pageType}
LAYOUT REQUIREMENTS: ${pageInstructions}
${styleDirection ? `STYLE DIRECTION: ${styleDirection}` : ''}

QUALITY CHECKLIST:
✓ Clear visual hierarchy — H1 → H2 → body
✓ Accent CTA button using brand colour
✓ Generous padding (py-16 / py-24 on sections)
✓ Hover states on all interactive elements
✓ Dark header or footer for visual anchoring`

    const result = await callModel(MODEL, `Generate the HTML page from this content:\n\n${content}`, systemPrompt)

    // Strip accidental markdown fences
    let html = result.text.trim()
    const fenceStart = html.match(/^```(?:html)?\n?/)
    if (fenceStart) html = html.slice(fenceStart[0].length)
    if (html.endsWith('```')) html = html.slice(0, -3).trimEnd()

    if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
      throw new Error('HTML Page: model did not return valid HTML')
    }

    return {
      output: { html },
      tokensUsed:   result.tokens_used,
      inputTokens:  result.input_tokens,
      outputTokens: result.output_tokens,
      modelUsed:    result.model_used,
    }
  }
}
