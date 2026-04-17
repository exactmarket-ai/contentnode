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
  max_tokens: 16000,
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
  'single-slide':   'A single 1280×720px presentation slide. Fixed dimensions — no scrolling, no nav, no CTA. Exactly like a PowerPoint/Keynote slide: strong title at top, content area below (bullets, stats, two-column, or visual), brand-coloured accent bar or shape. The entire viewport IS the slide.',
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

// ─── Programmatic slide renderer ─────────────────────────────────────────────
// Generates slide HTML directly from the Creative Director JSON — no second AI call.
// This eliminates the model-compliance problem (models returning <!DOCTYPE> instead of
// bare <section> elements) and makes slide generation deterministic.

function statValue(text: string): string {
  const m = text.match(/(\$[\d,.]+[kmb+]*|[\d,.]+[%kmb+]*)/i)
  return m ? m[0] : text.split(' ').slice(0, 2).join(' ')
}
function statLabel(text: string): string {
  const m = text.match(/(\$[\d,.]+[kmb+]*|[\d,.]+[%kmb+]*)/i)
  if (!m) return text
  return text.slice(text.indexOf(m[0]) + m[0].length).trim() || text
}

function renderSlide(slide: CreativeDirectorSlide, brief: CreativeDirectorBrief): string {
  const { palette: p, fonts } = brief
  const hf = `'${fonts.heading}',sans-serif`
  const bf = `'${fonts.body}',sans-serif`

  const accent  = (s: string) => `<span style="color:${p.accent}">${s}</span>`
  const bar     = `<div style="position:absolute;top:0;left:0;right:0;height:4px;background:${p.accent}"></div>`
  const h1      = (extra = '') => `<h2 style="margin:0 0 0.35em;font-family:${hf};color:#f1f5f9;font-size:1.65em;font-weight:700;line-height:1.15;flex-shrink:0${extra}">${slide.title}</h2>`
  const body    = slide.content ? `<p style="margin:0 0 0.6em;font-family:${bf};color:#cbd5e1;font-size:0.82em;line-height:1.65">${slide.content}</p>` : ''
  const bullets = slide.keyPoints.map(pt =>
    `<li style="display:flex;gap:0.55em;align-items:flex-start;margin:0.3em 0">
      ${accent('<span style="flex-shrink:0;font-size:0.7em;margin-top:0.32em">▶</span>')}
      <span style="font-family:${bf};color:#e2e8f0;font-size:0.8em;line-height:1.55">${pt}</span>
    </li>`).join('')
  const bulletList = slide.keyPoints.length
    ? `<ul style="margin:0;padding:0;list-style:none">${bullets}</ul>`
    : ''
  // Uses div.slide — picked up by the vanilla slider in buildHtmlShell
  const wrap    = (inner: string) =>
    `<div class="slide" style="background:${p.background};padding:2em 2.8em;box-sizing:border-box;position:absolute;inset:0;overflow:hidden">
  ${bar}${inner}
</div>`

  switch (slide.layout) {

    case 'title-splash':
      return wrap(`
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <h1 style="margin:0 0 0.4em;font-family:${hf};color:#f1f5f9;font-size:2.3em;font-weight:800;line-height:1.1">${slide.title}</h1>
    ${body}
    ${bulletList}
  </div>`)

    case 'two-column':
      return wrap(`
  ${h1()}
  <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:1.8em;min-height:0">
    <div>${body}</div>
    <div style="background:${p.surface};border-radius:8px;padding:1.1em">${bulletList}</div>
  </div>`)

    case 'stat-grid': {
      const items = slide.keyPoints.length ? slide.keyPoints : slide.content.split(/[.;]/).filter(s => s.trim())
      const cols  = Math.min(Math.max(items.length, 1), 4)
      const cards = items.slice(0, 4).map(s =>
        `<div style="background:${p.surface};border-radius:8px;padding:1.1em;text-align:center;border-top:3px solid ${p.accent}">
          <div style="font-family:${hf};color:${p.accent};font-size:2.1em;font-weight:800;line-height:1;margin-bottom:0.2em">${statValue(s)}</div>
          <div style="font-family:${bf};color:#94a3b8;font-size:0.7em;line-height:1.35">${statLabel(s)}</div>
        </div>`).join('')
      return wrap(`
  ${h1()}
  ${body}
  <div style="flex:1;display:grid;grid-template-columns:repeat(${cols},1fr);gap:1em;align-content:center">${cards}</div>`)
    }

    case 'quote-callout':
      return wrap(`
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
    <div style="font-family:${hf};color:${p.accent};font-size:4em;line-height:0.7;opacity:0.5;margin-bottom:0.3em">"</div>
    <p style="font-family:${hf};color:${p.primary};font-size:1.2em;font-weight:600;line-height:1.55;max-width:78%;margin:0 0 0.7em">${slide.content || slide.title}</p>
    ${slide.keyPoints[0] ? `<p style="font-family:${bf};color:${p.muted};font-size:0.75em;margin:0">— ${slide.keyPoints[0]}</p>` : ''}
  </div>`)

    case 'timeline': {
      const steps = slide.keyPoints.length ? slide.keyPoints : [slide.content || slide.title]
      const stepHtml = steps.map((s, i) =>
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0.5em;text-align:center">
          <div style="width:2em;height:2em;border-radius:50%;background:${p.accent};color:#000;font-family:${hf};font-weight:700;font-size:0.85em;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</div>
          <div style="font-family:${bf};color:#e2e8f0;font-size:0.72em;line-height:1.4">${s}</div>
        </div>`).join(`<div style="flex:0 0 1.5em;height:2px;background:${p.surface};margin-top:1em;align-self:flex-start"></div>`)
      return wrap(`
  ${h1()}
  ${body}
  <div style="flex:1;display:flex;align-items:center;padding:0.5em 0">${stepHtml}</div>`)
    }

    case 'comparison-table': {
      const mid   = Math.ceil(slide.keyPoints.length / 2)
      const left  = slide.keyPoints.slice(0, mid)
      const right = slide.keyPoints.slice(mid)
      const col   = (items: string[], icon: string, col: string) =>
        `<div style="background:${p.surface};border-radius:8px;padding:1.1em">
          <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:0.4em">
            ${items.map(pt => `<li style="font-family:${bf};color:#e2e8f0;font-size:0.78em;display:flex;gap:0.5em;align-items:flex-start"><span style="color:${col};flex-shrink:0">${icon}</span><span>${pt}</span></li>`).join('')}
          </ul>
        </div>`
      return wrap(`
  ${h1()}
  <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:1.4em">
    ${col(left, '✓', '#22c55e')}
    ${col(right, '→', p.accent)}
  </div>`)
    }

    case 'icon-grid': {
      const items = slide.keyPoints.length ? slide.keyPoints : slide.content.split(/[.;]/).filter(s => s.trim())
      const cols  = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3
      const cards = items.map(s =>
        `<div style="background:${p.surface};border-radius:8px;padding:1em;border-left:3px solid ${p.accent}">
          <div style="font-family:${bf};color:#e2e8f0;font-size:0.78em;line-height:1.5">${s}</div>
        </div>`).join('')
      return wrap(`
  ${h1()}
  ${body}
  <div style="flex:1;display:grid;grid-template-columns:repeat(${cols},1fr);gap:0.75em;align-content:start">${cards}</div>`)
    }

    case 'closing-cta':
      return wrap(`
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <h1 style="margin:0 0 0.5em;font-family:${hf};color:${p.primary};font-size:2em;font-weight:800;line-height:1.15">${slide.title}</h1>
    ${body}
    ${bulletList}
    <div style="margin-top:1.5em;display:inline-flex">
      <span style="padding:0.55em 1.4em;background:${p.accent};color:#000;font-family:${hf};font-weight:700;font-size:0.82em;border-radius:4px">Next Steps</span>
    </div>
  </div>`)

    default:
      return wrap(`
  ${h1()}
  ${body}
  ${bulletList}`)
  }
}

function buildHtmlShell(brief: CreativeDirectorBrief, sections: string): string {
  const { palette, fonts } = brief
  const fontParam = encodeURIComponent(
    `family=${fonts.heading.replace(/ /g, '+')}:wght@400;600;700&family=${fonts.body.replace(/ /g, '+')}:wght@400;500&display=swap`
  )
  // Pure vanilla slider — no Reveal.js dependency that could override inline styles.
  // Marker comment "CONTENTNODE-SLIDES-DECK" used by the frontend to detect slide decks.
  return `<!DOCTYPE html>
<!-- CONTENTNODE-SLIDES-DECK -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Executive Presentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?${fontParam}" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:${palette.background};overflow:hidden}
  .deck{position:relative;width:100%;height:100%}
  /* Slides hidden by default; .active makes them visible */
  .slide{display:none;position:absolute;inset:0;flex-direction:column}
  .slide.active{display:flex}
  /* Navigation controls */
  .nav{position:fixed;bottom:1em;right:1.4em;display:flex;gap:0.55em;align-items:center;z-index:9999}
  .nav-btn{
    background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);
    color:#e2e8f0;padding:0.32em 0.8em;border-radius:4px;cursor:pointer;
    font-size:0.8em;font-family:sans-serif;transition:background 0.12s
  }
  .nav-btn:hover{background:rgba(255,255,255,0.22)}
  .slide-num{color:rgba(255,255,255,0.38);font-size:0.7em;min-width:3.5em;text-align:center;font-family:sans-serif}
</style>
</head>
<body>
<div class="deck">
${sections}
</div>
<div class="nav">
  <button class="nav-btn" id="prev">&#8592;</button>
  <span class="slide-num" id="counter"></span>
  <button class="nav-btn" id="next">&#8594;</button>
</div>
<script>
(function(){
  var slides=Array.from(document.querySelectorAll('.slide'));
  var cur=0;
  function show(n){
    slides[cur].classList.remove('active');
    cur=(n+slides.length)%slides.length;
    slides[cur].classList.add('active');
    document.getElementById('counter').textContent=(cur+1)+' / '+slides.length;
  }
  document.getElementById('next').addEventListener('click',function(){show(cur+1)});
  document.getElementById('prev').addEventListener('click',function(){show(cur-1)});
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='ArrowDown')show(cur+1);
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp')show(cur-1);
  });
  show(0);
})();
</script>
</body>
</html>`
}

// Slides are rendered programmatically — no second model call, no parsing failures.
function buildSlidesFromBrief(
  brief: CreativeDirectorBrief,
): { html: string; tokensUsed: number; inputTokens: number; outputTokens: number } {
  const sections = brief.slides.map(slide => renderSlide(slide, brief)).join('\n\n')
  return {
    html:         buildHtmlShell(brief, sections),
    tokensUsed:   0,
    inputTokens:  0,
    outputTokens: 0,
  }
}

// Fallback: raw exec presentation text fed directly — run Creative Director inline
async function buildSlidesFromRawContent(
  content: string,
): Promise<{ html: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  // Creative Director inline call
  const cdSystem = `You are a senior creative director at a top-tier B2B design agency.
Read the executive presentation and produce a structured creative brief for a slide deck.
Return ONLY valid JSON — no markdown, no explanation, no trailing text after the closing brace.

CRITICAL: Count every section/topic in the source. Your "slides" array MUST contain one entry per section — do not merge, skip, or truncate sections. If there are 13 sections, produce 13 slide objects.

{
  "palette": { "background": "<dark hex>", "surface": "<slightly lighter hex>", "primary": "<brand hex>", "accent": "<vibrant hex>", "muted": "<muted hex>" },
  "fonts": { "heading": "<Google Font name>", "body": "<Google Font name>" },
  "style": "<one-line visual theme>",
  "slides": [
    {
      "number": 1,
      "title": "<slide title>",
      "layout": "<title-splash|two-column|stat-grid|timeline|quote-callout|comparison-table|icon-grid|closing-cta>",
      "content": "<prose description for this slide — full sentences>",
      "keyPoints": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
      "notes": "<optional speaker notes>"
    }
  ]
}

palette.background should be dark (e.g. #0F172A).
Every slide must have a non-empty title and at least one keyPoint or non-empty content.`

  const cdResult = await callModel(
    { ...SLIDE_MODEL, system_prompt: cdSystem, max_tokens: 8192, temperature: 0.4 },
    `Create the creative brief and slide structure for this presentation:\n\n${content.slice(0, 14000)}`,
  )

  let brief: CreativeDirectorBrief
  try {
    const match = cdResult.text.match(/\{[\s\S]*\}/)
    brief = match ? JSON.parse(match[0]) as CreativeDirectorBrief : { palette: { background: '#0F172A', surface: '#1E293B', primary: '#3B82F6', accent: '#F59E0B', muted: '#64748B' }, fonts: { heading: 'Inter', body: 'Inter' }, style: 'Modern dark B2B', slides: [] }
  } catch {
    brief = { palette: { background: '#0F172A', surface: '#1E293B', primary: '#3B82F6', accent: '#F59E0B', muted: '#64748B' }, fonts: { heading: 'Inter', body: 'Inter' }, style: 'Modern dark B2B', slides: [] }
  }

  const result = buildSlidesFromBrief(brief)
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
      // Strip markdown fences first — Claude sometimes wraps JSON in ```json ... ``` even when
      // instructed not to, which causes JSON.parse to hard-fail and drop into the raw fallback.
      let parsed: unknown = null
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]) } catch { parsed = null }
      }

      const { html, tokensUsed, inputTokens, outputTokens } = isCreativeDirectorBrief(parsed)
        ? buildSlidesFromBrief(parsed as CreativeDirectorBrief)
        : await buildSlidesFromRawContent(content)

      return { output: { html }, tokensUsed, inputTokens, outputTokens, modelUsed: SLIDE_MODEL.model }
    }

    // ── Standard HTML page ────────────────────────────────────────────────────
    let brand: BrandContext = { primaryColor: '#1B1F3B', headingFont: 'Inter, system-ui, sans-serif', bodyFont: 'Inter, system-ui, sans-serif', toneNotes: '', clientName: '' }
    if (useBrandColors && ctx.clientId) {
      brand = await fetchBrand(ctx.clientId, ctx.agencyId)
    }

    const pageInstructions = PAGE_TYPE_INSTRUCTIONS[pageType] ?? PAGE_TYPE_INSTRUCTIONS['landing-page']

    // ── Single slide gets its own tightly-scoped prompt ───────────────────────
    if (pageType === 'single-slide') {
      const slideSystemPrompt = `You are an expert presentation designer. Generate a single HTML slide that looks exactly like a professional PowerPoint or Keynote slide.

SLIDE DIMENSIONS: Fixed 1280×720px (16:9). The slide fills the entire viewport. No scrolling.

OUTPUT RULES:
- Return ONLY the raw HTML document — no markdown fences, no explanation.
- Start with <!DOCTYPE html>.
- Use a <style> block for all CSS — no external CSS CDN needed.
- html, body must be: margin:0; padding:0; width:1280px; height:720px; overflow:hidden;
- The slide root div must be: width:1280px; height:720px; position:relative; overflow:hidden;

SLIDE DESIGN:
- Background: ${brand.primaryColor} (dark) or a clean white/light variant — your choice based on content
- Heading font: ${brand.headingFont}
- Body font: ${brand.bodyFont}
- Brand accent colour: ${brand.primaryColor}
- Strong title at the top (48–60px, bold)
- Content area below: use the most appropriate layout for the content —
    bullets with icon dots | two-column split | large stat callouts | quote block | icon grid
- A thin brand-coloured accent bar or geometric shape adds polish
- Text must be fully legible — high contrast
- No navigation elements, no CTAs, no header/footer nav, no scrolling content
${brand.clientName ? `- Client: ${brand.clientName}` : ''}
${brand.toneNotes  ? `- Tone: ${brand.toneNotes}` : ''}
${styleDirection   ? `- Style direction: ${styleDirection}` : ''}

Generate a single, complete, beautiful slide now.`

      const result = await callModel({ ...MODEL, system_prompt: slideSystemPrompt }, content)
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
