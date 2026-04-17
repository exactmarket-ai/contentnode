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

const SLIDE_MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.3,
  max_tokens: 8192,
}

const SLIDE_BATCH_SIZE = 5   // slides per Claude call — keeps output well under 8192 tokens

// ─── Page type instructions (non-slide pages) ─────────────────────────────────

const PAGE_TYPE_INSTRUCTIONS: Record<string, string> = {
  'landing-page':   'Conversion-focused layout: hero with headline + subhead + CTA, 3-column benefits grid, social proof / testimonials, final CTA section.',
  'email-html':     'HTML email with INLINE styles only (no <style> blocks — Gmail strips them). Max-width 600px centered table layout. Compatible with Outlook, Gmail, Apple Mail.',
  'one-pager':      'Clean document-style layout. Strong typography hierarchy, generous whitespace. Print-friendly — avoid large background fills.',
  'case-study':     'Structured story: client challenge → solution → measurable results. Highlight key metrics with large callout numbers. Quote from stakeholder.',
  'event-page':     'Event details prominent at top (date, location, format). Agenda section, speaker cards, registration CTA. Urgency / scarcity elements.',
  'product-brief':  'Product overview: headline value prop, key features in icon grid, use-case scenarios, technical specs table, CTA to learn more / demo.',
  'slide-deck':     'Reveal.js 4 multi-step pipeline (see generateSlideDeck).',
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
      prisma.clientDocStyle.findUnique({
        where: { clientId },
        select: { primaryColor: true, headingFont: true, bodyFont: true },
      }),
      prisma.agencySettings.findUnique({
        where: { agencyId },
        select: { docPrimaryColor: true, docHeadingFont: true, docBodyFont: true },
      }),
    ])

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

// ─── Slide deck — multi-step pipeline ────────────────────────────────────────
//
// Step 1: Creative Director — JSON design brief (palette, fonts, per-slide layouts)
// Step 2: Parse slides from exec presentation content
// Step 3: Generate <section> HTML in batches of SLIDE_BATCH_SIZE
// Step 4: Assemble complete Reveal.js document
//
// This avoids the 8192-token output ceiling on any single call, handling
// presentations with 20+ slides without truncation.

interface DesignBrief {
  palette: { background: string; surface: string; primary: string; accent: string; muted: string }
  fonts:   { heading: string; body: string }
  style:   string
  slideLayouts: Array<{ slideNumber: number; layout: string; notes: string }>
}

const DEFAULT_BRIEF: DesignBrief = {
  palette: { background: '#0F172A', surface: '#1E293B', primary: '#3B82F6', accent: '#F59E0B', muted: '#64748B' },
  fonts:   { heading: 'Inter', body: 'Inter' },
  style:   'Modern dark B2B',
  slideLayouts: [],
}

const LAYOUT_TYPES = 'title-splash | two-column | stat-grid | timeline | quote-callout | comparison-table | icon-grid | closing-cta'

function parseSlides(content: string): string[] {
  // Split on "Slide N" markers (handles "Slide 1 —", "Slide 1:", "Slide 1 -", etc.)
  const parts = content.split(/(?=\bSlide\s+\d+[\s\-—:])/)
  const slides = parts.map(p => p.trim()).filter(p => /^Slide\s+\d+/i.test(p))

  if (slides.length >= 2) return slides

  // Fallback: split on ⸻ or --- section dividers
  const dividerParts = content.split(/\n\s*(?:⸻|---+)\s*\n/)
  const nonempty = dividerParts.map(p => p.trim()).filter(Boolean)
  if (nonempty.length >= 2) return nonempty

  // Last resort: treat whole content as one slide
  return [content]
}

async function callCreativeDirector(content: string): Promise<DesignBrief> {
  const system = `You are a senior creative director at a top-tier B2B design agency.
Read the executive presentation content and design a visual brief for a Reveal.js slide deck.

Return ONLY valid JSON — no markdown fences, no explanation.

{
  "palette": { "background": "<hex>", "surface": "<hex>", "primary": "<hex>", "accent": "<hex>", "muted": "<hex>" },
  "fonts": { "heading": "<Google Font name>", "body": "<Google Font name>" },
  "style": "<one-line description of the visual theme>",
  "slideLayouts": [
    { "slideNumber": 1, "layout": "<${LAYOUT_TYPES}>", "notes": "<brief instruction for this slide>" }
  ]
}

Choose a layout for EVERY slide number present in the content.
Prefer dark, professional colour palettes for B2B presentations.`

  try {
    const result = await callModel(
      { ...SLIDE_MODEL, system_prompt: system, max_tokens: 2048, temperature: 0.4 },
      `Design the slide deck brief for this executive presentation:\n\n${content.slice(0, 12000)}`,
    )
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return DEFAULT_BRIEF
    return JSON.parse(jsonMatch[0]) as DesignBrief
  } catch {
    return DEFAULT_BRIEF
  }
}

function buildSlideSystemPrompt(brief: DesignBrief): string {
  const { palette, fonts } = brief
  return `You are an expert HTML/CSS developer building slides for a Reveal.js 4 presentation.

DESIGN BRIEF:
- Background: ${palette.background}
- Surface (card/panel bg): ${palette.surface}
- Primary accent: ${palette.primary}
- Secondary accent: ${palette.accent}
- Muted text: ${palette.muted}
- Heading font: ${fonts.heading} (Google Font)
- Body font: ${fonts.body} (Google Font)
- Style: ${brief.style}

OUTPUT RULES:
- Return ONLY <section> elements — one per slide. No <!DOCTYPE>, no <html>, no <head>, no <style>.
- Each <section> must be self-contained with inline style attributes using the palette above.
- Use the layout type hint from the slide notes where provided.
- Layout types: ${LAYOUT_TYPES}
- Keep each slide's HTML concise — content only, no redundant wrapper divs.
- Include <aside class="notes"> with 1–2 speaker notes sentences per slide.`
}

function buildHtmlShell(brief: DesignBrief, slidesSections: string, slideCount: number): string {
  const { palette, fonts } = brief
  const fontParam = encodeURIComponent(`family=${fonts.heading.replace(/ /g, '+')}:wght@400;600;700&family=${fonts.body.replace(/ /g, '+')}:wght@400;500&display=swap`)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Executive Presentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?${fontParam}" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/theme/black.css">
<style>
  :root {
    --bg: ${palette.background};
    --surface: ${palette.surface};
    --primary: ${palette.primary};
    --accent: ${palette.accent};
    --muted: ${palette.muted};
    --font-heading: '${fonts.heading}', sans-serif;
    --font-body: '${fonts.body}', sans-serif;
  }
  .reveal { font-family: var(--font-body); background: var(--bg); }
  .reveal .slides { text-align: left; }
  .reveal h1, .reveal h2, .reveal h3 { font-family: var(--font-heading); color: var(--primary); margin-bottom: 0.5em; }
  .reveal h1 { font-size: 2.2em; }
  .reveal h2 { font-size: 1.6em; }
  .reveal p, .reveal li { color: #e2e8f0; font-size: 0.85em; line-height: 1.6; }
  .reveal ul { margin-left: 1.2em; }
  .reveal .accent { color: var(--accent); }
  .reveal .muted { color: var(--muted); font-size: 0.8em; }
  .reveal .surface-card { background: var(--surface); border-radius: 8px; padding: 1em 1.4em; }
  .reveal .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5em; }
  .reveal .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1em; }
  .reveal .stat-num { font-size: 2.4em; font-weight: 700; color: var(--accent); line-height: 1; }
  .reveal .tag { display: inline-block; background: var(--primary); color: #fff; border-radius: 4px; padding: 2px 10px; font-size: 0.7em; }
  .reveal .progress { height: 4px; background: var(--primary); }
  .reveal section { padding: 1.5em 2em; }
</style>
</head>
<body>
<div class="reveal">
  <div class="slides">
${slidesSections}
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.js"></script>
<script>
Reveal.initialize({
  hash: true,
  transition: 'fade',
  transitionSpeed: 'fast',
  progress: true,
  controls: true,
  slideNumber: 'c/t',
  totalTime: ${slideCount * 90},
});
</script>
</body>
</html>`
}

async function generateSlideDeck(
  content: string,
  _styleDirection: string,
): Promise<{ html: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  // Step 1: Creative Director brief
  const brief = await callCreativeDirector(content)

  // Step 2: Parse individual slides
  const slides = parseSlides(content)

  // Step 3: Generate <section> HTML in batches
  const sectionSystem = buildSlideSystemPrompt(brief)
  const allSections: string[] = []
  let totalTokensUsed = 0
  let totalInput = 0
  let totalOutput = 0

  for (let i = 0; i < slides.length; i += SLIDE_BATCH_SIZE) {
    const batch = slides.slice(i, i + SLIDE_BATCH_SIZE)
    const layoutHints = batch.map((_, idx) => {
      const slideNum = i + idx + 1
      const layout = brief.slideLayouts.find(l => l.slideNumber === slideNum)
      return layout ? `[Slide ${slideNum} — layout: ${layout.layout}. ${layout.notes}]` : `[Slide ${slideNum}]`
    }).join('\n')

    const batchPrompt = `Generate the <section> HTML for these slides. One <section> per slide — no other HTML.

${layoutHints}

SLIDE CONTENT:
${batch.join('\n\n---\n\n')}`

    const result = await callModel(
      { ...SLIDE_MODEL, system_prompt: sectionSystem, max_tokens: 4096 },
      batchPrompt,
    )

    let sections = result.text.trim()
    // Strip accidental fences
    const fence = sections.match(/^```(?:html)?\n?/)
    if (fence) sections = sections.slice(fence[0].length)
    if (sections.endsWith('```')) sections = sections.slice(0, -3).trimEnd()

    allSections.push(sections)
    totalTokensUsed += result.tokens_used
    totalInput      += result.input_tokens
    totalOutput     += result.output_tokens
  }

  // Step 4: Assemble
  const html = buildHtmlShell(brief, allSections.join('\n\n'), slides.length)

  return { html, tokensUsed: totalTokensUsed, inputTokens: totalInput, outputTokens: totalOutput }
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

    // ── Slide deck — multi-step pipeline ──────────────────────────────────────
    if (pageType === 'slide-deck') {
      const { html, tokensUsed, inputTokens, outputTokens } =
        await generateSlideDeck(content, styleDirection)
      return { output: { html }, tokensUsed, inputTokens, outputTokens, modelUsed: SLIDE_MODEL.model }
    }

    // ── Standard HTML page ────────────────────────────────────────────────────
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

    const result = await callModel({ ...MODEL, system_prompt: systemPrompt }, content)

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
