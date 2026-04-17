import { callModel, type ModelConfig } from '@contentnode/ai'
import { prisma } from '@contentnode/database'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.3,
  max_tokens: 8192,
}

// Slide decks need the full token budget — 13+ slides of Reveal.js HTML can run long
const SLIDE_DECK_MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.3,
  max_tokens: 8192,
}

const PAGE_TYPE_INSTRUCTIONS: Record<string, string> = {
  'landing-page':   'Conversion-focused layout: hero with headline + subhead + CTA, 3-column benefits grid, social proof / testimonials, final CTA section.',
  'email-html':     'HTML email with INLINE styles only (no <style> blocks — Gmail strips them). Max-width 600px centered table layout. Compatible with Outlook, Gmail, Apple Mail.',
  'one-pager':      'Clean document-style layout. Strong typography hierarchy, generous whitespace. Print-friendly — avoid large background fills.',
  'case-study':     'Structured story: client challenge → solution → measurable results. Highlight key metrics with large callout numbers. Quote from stakeholder.',
  'event-page':     'Event details prominent at top (date, location, format). Agenda section, speaker cards, registration CTA. Urgency / scarcity elements.',
  'product-brief':  'Product overview: headline value prop, key features in icon grid, use-case scenarios, technical specs table, CTA to learn more / demo.',
  'slide-deck':     'Reveal.js 4 presentation (CDN: https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.css + reveal.js). Each slide is a <section>. Use 8 layout types: title-splash, two-column, stat-grid, timeline, quote-callout, comparison-table, icon-grid, closing-cta. Load Google Fonts in <head>. No Tailwind — style via inline CSS + Reveal.js theme variables. The creative brief from the input specifies exact palette/fonts/layout per slide — follow it precisely.',
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
    const [client, docStyle, agencySettings] = await Promise.all([
      prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: { name: true },
      }),
      // Brand colors/fonts live in ClientDocStyle, not Client directly
      prisma.clientDocStyle.findUnique({
        where: { clientId },
        select: { primaryColor: true, headingFont: true, bodyFont: true },
      }),
      // Agency doc defaults live in AgencySettings, not Agency
      prisma.agencySettings.findUnique({
        where: { agencyId },
        select: { docPrimaryColor: true, docHeadingFont: true, docBodyFont: true },
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
      primaryColor: docStyle?.primaryColor ?? agencySettings?.docPrimaryColor ?? defaults.primaryColor,
      headingFont:  docStyle?.headingFont  ?? agencySettings?.docHeadingFont  ?? defaults.headingFont,
      bodyFont:     docStyle?.bodyFont     ?? agencySettings?.docBodyFont     ?? defaults.bodyFont,
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

    const isSlideDeck = pageType === 'slide-deck'

    const systemPrompt = isSlideDeck
      ? `You are an expert HTML/CSS developer specialising in Reveal.js presentations.
Generate a complete, self-contained, production-quality Reveal.js 4 HTML presentation from the content provided.

OUTPUT RULES:
- Return ONLY the raw HTML document — no markdown fences, no explanation, no commentary.
- Start with <!DOCTYPE html>.
- Load Reveal.js 4 via CDN: https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.css and reveal.js
- Load Google Fonts in <head> based on the creative brief fonts in the input.
- Each slide is a <section> inside <div class="reveal"><div class="slides">.
- Initialise with: Reveal.initialize({ hash: true, transition: 'fade', progress: true, controls: true });
- Do NOT use Tailwind — style via <style> block using the palette from the creative brief.
- Use the layout type specified per slide in the creative brief (title-splash, two-column, stat-grid, timeline, quote-callout, comparison-table, icon-grid, closing-cta).

QUALITY CHECKLIST:
✓ All slides visible — no missing content from the exec presentation
✓ Consistent colour palette from the creative brief
✓ Font pairing applied: heading font for h1/h2, body font for p/li
✓ slide-number or progress bar enabled
✓ Speaker notes in <aside class="notes"> where helpful`
      : `You are an expert HTML/CSS developer and conversion copywriter.
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

    const userPrompt = isSlideDeck
      ? `Generate the Reveal.js slide deck from this creative brief and content:\n\n${content}`
      : `Generate the HTML page from this content:\n\n${content}`

    const modelCfg = isSlideDeck
      ? { ...SLIDE_DECK_MODEL, system_prompt: systemPrompt }
      : { ...MODEL, system_prompt: systemPrompt }

    const result = await callModel(modelCfg, userPrompt)

    // Strip accidental markdown fences
    let html = result.text.trim()
    const fenceStart = html.match(/^```(?:html)?\n?/)
    if (fenceStart) html = html.slice(fenceStart[0].length)
    if (html.endsWith('```')) html = html.slice(0, -3).trimEnd()

    if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
      throw new Error('HTML Page: model did not return valid HTML')
    }

    // Detect truncation — if </html> is missing the output was cut off
    if (isSlideDeck && !html.includes('</html>')) {
      throw new Error('Slide deck was truncated (too many slides for one pass). Try splitting into fewer slides or use Design Slides from researchNODE which runs a two-step pipeline.')
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
