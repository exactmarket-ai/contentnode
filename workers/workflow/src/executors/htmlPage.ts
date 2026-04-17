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

const SLIDE_BATCH_SIZE = 5

// ─── Page type instructions (non-slide) ───────────────────────────────────────

const PAGE_TYPE_INSTRUCTIONS: Record<string, string> = {
  'landing-page':   'Conversion-focused layout: hero with headline + subhead + CTA, 3-column benefits grid, social proof / testimonials, final CTA section.',
  'email-html':     'HTML email with INLINE styles only (no <style> blocks — Gmail strips them). Max-width 600px centered table layout. Compatible with Outlook, Gmail, Apple Mail.',
  'one-pager':      'Clean document-style layout. Strong typography hierarchy, generous whitespace. Print-friendly — avoid large background fills.',
  'case-study':     'Structured story: client challenge → solution → measurable results. Highlight key metrics with large callout numbers. Quote from stakeholder.',
  'event-page':     'Event details prominent at top (date, location, format). Agenda section, speaker cards, registration CTA. Urgency / scarcity elements.',
  'product-brief':  'Product overview: headline value prop, key features in icon grid, use-case scenarios, technical specs table, CTA to learn more / demo.',
}

// ─── Brand context ─────────────────────────────────────────────────────────────

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
      prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } }),
      prisma.clientDocStyle.findUnique({ where: { clientId }, select: { primaryColor: true, headingFont: true, bodyFont: true } }),
      prisma.agencySettings.findUnique({ where: { agencyId }, select: { docPrimaryColor: true, docHeadingFont: true, docBodyFont: true } }),
    ])
    let toneNotes = ''
    try {
      const builder = await prisma.clientBrandBuilder.findFirst({ where: { clientId, agencyId }, select: { dataJson: true }, orderBy: { updatedAt: 'desc' } })
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

// ─── Slide deck types ─────────────────────────────────────────────────────────

interface CreativeDirectorSlide {
  number:    number
  title:     string
  layout:    string
  content:   string
  keyPoints: string[]
  notes:     string
}

interface CreativeDirectorBrief {
  palette:  { background: string; surface: string; primary: string; accent: string; muted: string }
  fonts:    { heading: string; body: string }
  style:    string
  slides:   CreativeDirectorSlide[]
}

function isCreativeDirectorBrief(input: unknown): input is CreativeDirectorBrief {
  if (typeof input !== 'object' || input === null) return false
  const obj = input as Record<string, unknown>
  return (
    typeof obj.palette === 'object' &&
    typeof obj.fonts   === 'object' &&
    Array.isArray(obj.slides) &&
    (obj.slides as unknown[]).length > 0
  )
}

// ─── Slide HTML generator ─────────────────────────────────────────────────────

function buildSlideSystemPrompt(brief: CreativeDirectorBrief): string {
  const { palette, fonts } = brief
  return `You are an expert HTML/CSS developer building slides for a Reveal.js 4 presentation.

DESIGN BRIEF:
- Background: ${palette.background}
- Surface (card bg): ${palette.surface}
- Primary: ${palette.primary}
- Accent: ${palette.accent}
- Muted: ${palette.muted}
- Heading font: ${fonts.heading}
- Body font: ${fonts.body}
- Style: ${brief.style}

OUTPUT RULES:
- Return ONLY <section> elements — one per slide. No <!DOCTYPE>, no <html>, no <head>.
- Each <section> is self-contained with inline style attributes using the palette above.
- Layout types: title-splash | two-column | stat-grid | timeline | quote-callout | comparison-table | icon-grid | closing-cta
- Include <aside class="notes"> with speaker notes for each slide.
- Keep markup concise — no redundant wrapper divs.`
}

function buildHtmlShell(brief: CreativeDirectorBrief, sections: string): string {
  const { palette, fonts } = brief
  const fontParam = encodeURIComponent(
    `family=${fonts.heading.replace(/ /g, '+')}:wght@400;600;700&family=${fonts.body.replace(/ /g, '+')}:wght@400;500&display=swap`
  )
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
</style>
</head>
<body>
<div class="reveal">
  <div class="slides">
${sections}
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@4/dist/reveal.js"></script>
<script>
Reveal.initialize({ hash: true, transition: 'fade', progress: true, controls: true, slideNumber: 'c/t' });
</script>
</body>
</html>`
}

async function buildSlidesFromBrief(
  brief: CreativeDirectorBrief,
): Promise<{ html: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  const sectionSystem = buildSlideSystemPrompt(brief)
  const allSections: string[] = []
  let totalTokens = 0, totalInput = 0, totalOutput = 0

  for (let i = 0; i < brief.slides.length; i += SLIDE_BATCH_SIZE) {
    const batch = brief.slides.slice(i, i + SLIDE_BATCH_SIZE)
    const batchText = batch.map((s) =>
      `[Slide ${s.number} — ${s.layout}]\nTitle: ${s.title}\n${s.content}\nKey points: ${s.keyPoints.join(' • ')}\nNotes: ${s.notes}`
    ).join('\n\n---\n\n')

    const result = await callModel(
      { ...SLIDE_MODEL, system_prompt: sectionSystem, max_tokens: 4096 },
      `Generate the <section> HTML for these ${batch.length} slides:\n\n${batchText}`,
    )

    let sections = result.text.trim()
    const fence = sections.match(/^```(?:html)?\n?/)
    if (fence) sections = sections.slice(fence[0].length)
    if (sections.endsWith('```')) sections = sections.slice(0, -3).trimEnd()

    allSections.push(sections)
    totalTokens += result.tokens_used
    totalInput  += result.input_tokens
    totalOutput += result.output_tokens
  }

  return {
    html:        buildHtmlShell(brief, allSections.join('\n\n')),
    tokensUsed:  totalTokens,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  }
}

// Fallback: raw exec presentation text fed directly — run Creative Director inline
async function buildSlidesFromRawContent(
  content: string,
): Promise<{ html: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  // Creative Director inline call
  const cdSystem = `You are a senior creative director at a top-tier B2B design agency.
Read the executive presentation and produce a structured creative brief for a Reveal.js slide deck.
Return ONLY valid JSON — no markdown, no explanation.

{
  "palette": { "background": "<hex>", "surface": "<hex>", "primary": "<hex>", "accent": "<hex>", "muted": "<hex>" },
  "fonts": { "heading": "<Google Font>", "body": "<Google Font>" },
  "style": "<one-line visual theme>",
  "slides": [
    {
      "number": 1,
      "title": "<slide title>",
      "layout": "<title-splash|two-column|stat-grid|timeline|quote-callout|comparison-table|icon-grid|closing-cta>",
      "content": "<full content for this slide>",
      "keyPoints": ["<bullet 1>", "<bullet 2>"],
      "notes": "<speaker notes>"
    }
  ]
}

Extract EVERY slide present in the presentation. Do not skip any.`

  const cdResult = await callModel(
    { ...SLIDE_MODEL, system_prompt: cdSystem, max_tokens: 4096, temperature: 0.4 },
    `Create the creative brief and slide structure for this presentation:\n\n${content.slice(0, 14000)}`,
  )

  let brief: CreativeDirectorBrief
  try {
    const match = cdResult.text.match(/\{[\s\S]*\}/)
    brief = match ? JSON.parse(match[0]) as CreativeDirectorBrief : { palette: { background: '#0F172A', surface: '#1E293B', primary: '#3B82F6', accent: '#F59E0B', muted: '#64748B' }, fonts: { heading: 'Inter', body: 'Inter' }, style: 'Modern dark B2B', slides: [] }
  } catch {
    brief = { palette: { background: '#0F172A', surface: '#1E293B', primary: '#3B82F6', accent: '#F59E0B', muted: '#64748B' }, fonts: { heading: 'Inter', body: 'Inter' }, style: 'Modern dark B2B', slides: [] }
  }

  const result = await buildSlidesFromBrief(brief)
  return {
    ...result,
    tokensUsed:  result.tokensUsed  + cdResult.tokens_used,
    inputTokens: result.inputTokens + cdResult.input_tokens,
    outputTokens: result.outputTokens + cdResult.output_tokens,
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

    // ── Slide deck ────────────────────────────────────────────────────────────
    if (pageType === 'slide-deck') {
      // If the upstream Creative Director node provided a structured brief, use it directly.
      // Otherwise fall back to running the Creative Director inline (single-node usage).
      let parsed: unknown
      try { parsed = JSON.parse(content) } catch { parsed = null }

      const { html, tokensUsed, inputTokens, outputTokens } = isCreativeDirectorBrief(parsed)
        ? await buildSlidesFromBrief(parsed)
        : await buildSlidesFromRawContent(content)

      return { output: { html }, tokensUsed, inputTokens, outputTokens, modelUsed: SLIDE_MODEL.model }
    }

    // ── Standard HTML page ────────────────────────────────────────────────────
    let brand: BrandContext = { primaryColor: '#1B1F3B', headingFont: 'Inter, system-ui, sans-serif', bodyFont: 'Inter, system-ui, sans-serif', toneNotes: '', clientName: '' }
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
- Configure Tailwind colours: <script>tailwind.config={theme:{extend:{colors:{brand:'${brand.primaryColor}'}}}}</script>
- All styling via Tailwind. No separate <style> blocks.
- Fully responsive — mobile-first. Use semantic HTML5.

BRAND:
- Primary: ${brand.primaryColor}
- Heading font: ${brand.headingFont}
- Body font: ${brand.bodyFont}
${brand.clientName ? `- Client: ${brand.clientName}` : ''}
${brand.toneNotes  ? `- Tone: ${brand.toneNotes}`    : ''}

PAGE TYPE: ${pageType}
LAYOUT: ${pageInstructions}
${styleDirection ? `STYLE DIRECTION: ${styleDirection}` : ''}

QUALITY:
✓ Clear visual hierarchy  ✓ Accent CTA using brand colour  ✓ Generous padding  ✓ Hover states  ✓ Dark header/footer`

    const result = await callModel({ ...MODEL, system_prompt: systemPrompt }, content)

    let html = result.text.trim()
    const fence = html.match(/^```(?:html)?\n?/)
    if (fence) html = html.slice(fence[0].length)
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
