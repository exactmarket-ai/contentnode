import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { uploadBuffer, downloadBuffer } from '@contentnode/storage'
import { callModel } from '@contentnode/ai'

// Lazy CJS interop for mammoth
type MammothModule = { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }> }
let _mammoth: MammothModule | null = null
async function getMammoth(): Promise<MammothModule> {
  if (!_mammoth) {
    const mod = await import('mammoth') as any
    _mammoth = mod.default ?? mod
  }
  return _mammoth!
}

// ── Variable vocabulary ────────────────────────────────────────────────────────
// These are the variables available for GTM Framework templates.
// Frontend uses this list for the confirmation UI.

export const GTM_VARIABLES = [
  // Meta
  { id: 'client_name',      label: 'Client Name',     description: 'The client or company name',                            section: 'meta' },
  { id: 'agency_name',      label: 'Agency Name',     description: 'The agency producing this document',                    section: 'meta' },
  { id: 'vertical_name',    label: 'Vertical Name',   description: 'The industry vertical (e.g. Healthcare)',               section: 'meta' },
  { id: 'document_date',    label: 'Document Date',   description: 'Date the document was generated',                       section: 'meta' },
  // §01 Vertical Overview
  { id: 's01_positioning_statement', label: 'Positioning Statement',    description: 'One-line positioning statement for this vertical',                 section: '01' },
  { id: 's01_tagline_options',       label: 'Tagline Options',          description: 'Primary tagline options (2-3)',                                    section: '01' },
  { id: 's01_how_to_use',            label: 'How to Use This Document', description: 'Guidance for sales, marketing, and partners on using this document', section: '01' },
  { id: 's01_what_is_not',           label: 'What the Company Is Not',  description: 'Scope exclusions and boundary statements',                         section: '01' },
  // §02 Customer Definition + Profile
  { id: 's02_industry',            label: 'Industry / Vertical',    description: 'Target industry and sub-segments',                               section: '02' },
  { id: 's02_company_size',        label: 'Company Size',           description: 'Target company size / employee count / ARR range',               section: '02' },
  { id: 's02_geography',           label: 'Geography',              description: 'Target geography and coverage',                                  section: '02' },
  { id: 's02_it_posture',          label: 'IT Posture',             description: 'Typical IT maturity and internal capability of target accounts',  section: '02' },
  { id: 's02_compliance_status',   label: 'Compliance Status',      description: 'Regulatory and compliance context of target accounts',            section: '02' },
  { id: 's02_contract_profile',    label: 'Contract Profile',       description: 'Typical contract and deal structure',                            section: '02' },
  { id: 's02_primary_buyer_table', label: 'Primary Buyer Table',    description: 'Segment-level table of buyers, pain, and entry points',          section: '02' },
  // §03 Market Pressures + Statistics
  { id: 's03_market_pressure_narrative', label: 'Market Pressure Narrative', description: 'Narrative description of market pressures and urgency drivers', section: '03' },
  { id: 's03_key_statistics',            label: 'Key Statistics',            description: 'Statistics table with context, source, and year',              section: '03' },
  // §04 Core Challenges
  { id: 's04_challenges', label: 'Core Challenges', description: 'IT challenges creating the sales opportunity — why it exists, consequence, solution, pillars per challenge', section: '04' },
  // §05 Solutions + Service Stack
  { id: 's05_pillar_cloud',         label: 'Cloud Pillar',         description: 'Cloud value proposition, key services, and relevant segments',         section: '05' },
  { id: 's05_pillar_data_ai',       label: 'Data + AI Pillar',     description: 'Data and AI value proposition, key services, and relevant segments',   section: '05' },
  { id: 's05_pillar_it_operations', label: 'IT Operations Pillar', description: 'IT Operations value proposition, key services, and relevant segments', section: '05' },
  { id: 's05_pillar_cybersecurity', label: 'Cybersecurity Pillar', description: 'Cybersecurity value proposition, key services, and relevant segments', section: '05' },
  { id: 's05_full_service_stack',   label: 'Full Service Stack',   description: 'Table of services with regulatory domain, delivery description, and priority', section: '05' },
  // §06 Why [Company]
  { id: 's06_differentiators', label: 'Differentiators', description: 'Numbered vertical-specific differentiators and proof of fit', section: '06' },
  // §07 Segments + Buyer Profiles
  { id: 's07_segments', label: 'Segments + Buyer Profiles', description: 'Sub-segment framing with buyer titles, key pressures, lead hooks, and compliance notes', section: '07' },
  // §08 Messaging Framework
  { id: 's08_problems',        label: 'Problems',                     description: 'Core problem narrative for this vertical (2-3 sentences)',    section: '08' },
  { id: 's08_solution',        label: 'Solution',                     description: 'How the company solves the problem (2-3 sentences)',          section: '08' },
  { id: 's08_outcomes',        label: 'Outcomes',                     description: 'Key outcomes delivered — the after state (2-3 sentences)',    section: '08' },
  { id: 's08_value_by_pillar', label: 'Value Proposition by Pillar',  description: 'Table of value props by service pillar with proof points',   section: '08' },
  // §09 Proof Points + Case Studies
  { id: 's09_proof_points', label: 'Company Proof Points', description: 'Table of company-wide proof points with scope',                                    section: '09' },
  { id: 's09_case_studies',  label: 'Case Studies',        description: 'Case studies with situation, engagement, outcomes, 30-second version, headline stat', section: '09' },
  // §10 Objection Handling
  { id: 's10_objections', label: 'Objection Handling', description: 'Common objections with sales responses and follow-up questions', section: '10' },
  // §11 Brand Voice Examples
  { id: 's11_tone_target',          label: 'Tone Target',           description: 'Target voice and tone description for this vertical',    section: '11' },
  { id: 's11_vocabulary_level',     label: 'Vocabulary Level',      description: 'Guidance on technical depth and accessibility',          section: '11' },
  { id: 's11_sentence_style',       label: 'Sentence Style',        description: 'Guidance on sentence construction and structure',        section: '11' },
  { id: 's11_what_to_avoid',        label: 'What to Avoid',         description: 'Banned phrases, buzzwords, and patterns to avoid',      section: '11' },
  { id: 's11_sounds_like',          label: 'Sounds Like',           description: 'Good examples of the correct voice and tone',           section: '11' },
  { id: 's11_does_not_sound_like',  label: 'Does Not Sound Like',   description: 'Bad examples with corrected versions',                  section: '11' },
  // §12 Competitive Differentiation
  { id: 's12_competitive_differentiation', label: 'Competitive Differentiation', description: 'Competitor types with their positioning, NexusTek counter, and when it comes up', section: '12' },
  // §13 Customer Quotes + Testimonials
  { id: 's13_customer_quotes', label: 'Customer Quotes + Testimonials', description: 'Quotes with attribution, context, best-used-in guidance, and approval status', section: '13' },
  // §14 Campaign Themes + Asset Mapping
  { id: 's14_campaign_themes', label: 'Campaign Themes + Asset Mapping', description: 'Campaign themes with target audience, primary assets, and key message', section: '14' },
  // §15 Frequently Asked Questions
  { id: 's15_faqs', label: 'Frequently Asked Questions', description: 'Real prospect questions from discovery calls with answers and best-addressed-in guidance', section: '15' },
  // §16 Content Funnel Mapping
  { id: 's16_funnel_mapping',    label: 'Content Funnel Mapping', description: 'Assets mapped to funnel stages with CTAs and buyer state', section: '16' },
  { id: 's16_cta_sequencing',    label: 'CTA Sequencing Notes',   description: 'Notes on how CTAs connect across funnel stages',          section: '16' },
  // §17 Regulatory + Compliance Context
  { id: 's17_regulatory_context',    label: 'Regulatory + Compliance Context', description: 'Regulatory frameworks table with capabilities, service pillars, and sales notes', section: '17' },
  { id: 's17_regulatory_sales_note', label: 'Regulatory Sales Note',           description: 'Disclaimer and scope note for regulatory conversations',                          section: '17' },
  // §18 CTAs + Next Steps
  { id: 's18_ctas', label: 'CTAs + Next Steps', description: 'Table of CTAs with description, target audience trigger, and asset appearances', section: '18' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface VariableSuggestion {
  variableId: string
  variableName: string
  sampleText: string
  reason: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert docx buffer to HTML using mammoth */
async function docxToHtml(buffer: Buffer): Promise<string> {
  const m = await getMammoth()
  const result = await m.convertToHtml({ buffer })
  return result.value
}

/** Strip HTML tags and collapse whitespace for AI analysis */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ask Claude to suggest variable placements based on document text */
async function suggestVariables(docText: string, docType: string): Promise<VariableSuggestion[]> {
  const variableList = GTM_VARIABLES
    .map((v) => `- ${v.id}: ${v.label} — ${v.description}`)
    .join('\n')

  const prompt = `You are analyzing a Word document template for a ${docType} document.

Below is the document text. Identify specific pieces of text that should become template variables.
Return a JSON array of objects. Each object has:
- variableId: the variable ID from the list below (must match exactly)
- variableName: human-readable label
- sampleText: the EXACT text string currently in the document that should be replaced (keep it short — a company name, title, date, etc.)
- reason: one sentence explaining why this text should be a variable

Only suggest variables where you can identify the actual placeholder text in the document.
Focus on: company/client names, agency names, dates, industry-specific terms, key values.
Aim for 5–15 high-confidence suggestions.

Available variables:
${variableList}

Document text:
${docText.slice(0, 4000)}

Respond with ONLY a JSON array, no markdown, no explanation.`

  try {
    const result = await callModel(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.1, api_key_ref: 'ANTHROPIC_API_KEY' },
      prompt,
    )
    const raw = result.text
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Replace searchText with replacement in OOXML.
 *
 * Word splits visible text across multiple <w:r><w:t> elements. Instead of
 * regex surgery (which keeps corrupting documents), this:
 *  1. Extracts every run's text and position into a segment list
 *  2. Joins them into a flat string and finds searchText by character position
 *  3. Replaces exactly the run(s) that cover that span — no XML guesswork
 */
function xmlReplaceText(xml: string, searchText: string, replacement: string): string {
  const xmlEsc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const xmlDecode = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

  // Build segment list: every <w:r>...<w:t>text</w:t>...</w:r> with its XML positions
  type Seg = { runStart: number; runEnd: number; text: string; rPr: string }
  const segs: Seg[] = []
  const runRx = /<w:r[ >][\s\S]*?<\/w:r>/g
  let rm: RegExpExecArray | null
  while ((rm = runRx.exec(xml)) !== null) {
    const runXml = rm[0]
    const tM = /<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/.exec(runXml)
    if (!tM) continue
    const rPrM = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(runXml)
    segs.push({
      runStart: rm.index,
      runEnd:   rm.index + rm[0].length,
      text:     xmlDecode(tM[1]),   // decoded for matching
      rPr:      rPrM ? rPrM[0] : '',
    })
  }

  const flat = segs.map((s) => s.text).join('')
  const pos  = flat.indexOf(searchText)
  if (pos === -1) return xml   // not present even across runs — skip

  // Map flat-text position → segments
  let charPos = 0, firstI = -1, lastI = -1, charInFirst = 0, charInLast = 0
  for (let i = 0; i < segs.length; i++) {
    const end = charPos + segs[i].text.length
    if (firstI === -1 && end > pos)                { firstI = i; charInFirst = pos - charPos }
    if (end >= pos + searchText.length)            { lastI  = i; charInLast  = pos + searchText.length - charPos; break }
    charPos = end
  }
  if (firstI === -1 || lastI === -1) return xml

  const first  = segs[firstI]
  const last   = segs[lastI]
  const before = first.text.slice(0, charInFirst)
  const after  = last.text.slice(charInLast)

  let newRuns = ''
  if (before) newRuns += `<w:r>${first.rPr}<w:t xml:space="preserve">${xmlEsc(before)}</w:t></w:r>`
  newRuns    +=           `<w:r>${first.rPr}<w:t xml:space="preserve">${replacement}</w:t></w:r>`
  if (after)  newRuns += `<w:r>${last.rPr}<w:t xml:space="preserve">${xmlEsc(after)}</w:t></w:r>`

  return xml.substring(0, first.runStart) + newRuns + xml.substring(last.runEnd)
}

/**
 * Write {{var_id}} markers into a docx buffer using confirmedVars.
 * Uses split-run-aware replacement so Word's XML fragmentation doesn't block us.
 */
async function markDocxBuffer(
  buffer: Buffer,
  confirmedVars: VariableSuggestion[],
): Promise<Buffer> {
  const PizZip = await import('pizzip')
  const zip = new ((PizZip as any).default ?? PizZip)(buffer)

  const xmlFile = zip.files['word/document.xml']
  if (!xmlFile) throw new Error('Invalid .docx: missing word/document.xml')

  let xml: string = xmlFile.asText()
  for (const v of confirmedVars) {
    if (!v.sampleText || !v.variableId) continue
    xml = xmlReplaceText(xml, v.sampleText, `{{${v.variableId}}}`)
  }

  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/**
 * Apply confirmed variable substitutions to the original .docx XML.
 * Downloads original → does text replacement in word/document.xml → uploads as processedKey.
 */
async function applyVariablesToDocx(
  originalKey: string,
  confirmedVars: VariableSuggestion[],
  processedKey: string,
): Promise<void> {
  const buffer = await downloadBuffer(originalKey)
  const processed = await markDocxBuffer(buffer, confirmedVars)
  await uploadBuffer(processedKey, processed, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function docTemplateRoutes(app: FastifyInstance) {

  // GET /variables — return full GTM variable vocabulary
  app.get('/variables', async (_req, reply) => {
    return reply.send({ data: GTM_VARIABLES })
  })

  // POST / — upload .docx, convert to HTML, trigger AI analysis
  app.post('/', async (req, reply) => {
    const { agencyId, userId } = req.auth

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, fields } = data
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext !== 'docx') {
      file.resume()
      return reply.code(400).send({ error: 'Only .docx files are supported for templates' })
    }

    // Read name + docType from form fields
    const name    = (fields as any)?.name?.value    ?? filename.replace(/\.docx$/i, '')
    const docType = (fields as any)?.docType?.value ?? 'gtm'

    // Buffer the upload (templates are small — usually < 5 MB)
    const chunks: Buffer[] = []
    for await (const chunk of file) chunks.push(chunk as Buffer)
    const buffer = Buffer.concat(chunks)

    const templateId  = randomUUID()
    const originalKey = `doc-templates/${agencyId}/${templateId}-original.docx`

    // Save original to storage
    await uploadBuffer(originalKey, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    // Convert to HTML for preview
    let htmlPreview: string | null = null
    let suggestions: VariableSuggestion[] = []
    let status = 'ready'
    let errorMessage: string | null = null

    try {
      htmlPreview = await docxToHtml(buffer)
      const docText = htmlToText(htmlPreview)
      suggestions = await suggestVariables(docText, docType)
    } catch (err) {
      status = 'error'
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const record = await prisma.docTemplate.create({
      data: {
        id:          templateId,
        agencyId,
        name,
        docType,
        originalKey,
        htmlPreview,
        suggestions:  suggestions  as any,
        confirmedVars: []          as any,
        status,
        errorMessage,
        sizeBytes: buffer.length,
        createdBy: userId ?? null,
      },
    })

    return reply.code(201).send({ data: record })
  })

  // GET / — list templates for the agency
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const templates = await prisma.docTemplate.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, docType: true, status: true,
        sizeBytes: true, confirmedVars: true, createdAt: true, updatedAt: true,
        assignments: { select: { id: true, clientId: true, verticalId: true, docType: true, agencyDefault: true } },
      },
    })
    return reply.send({ data: templates })
  })

  // GET /:id — get one template (full data inc. htmlPreview + suggestions)
  app.get('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const template = await prisma.docTemplate.findFirst({
      where: { id, agencyId },
      include: { assignments: true },
    })
    if (!template) return reply.code(404).send({ error: 'Template not found' })
    return reply.send({ data: template })
  })

  // PATCH /:id — update name and/or confirmedVars
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; confirmedVars?: VariableSuggestion[] }

    const existing = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const updated = await prisma.docTemplate.update({
      where: { id },
      data: {
        ...(body.name        !== undefined ? { name: body.name }               : {}),
        ...(body.confirmedVars !== undefined ? { confirmedVars: body.confirmedVars as any } : {}),
      },
    })
    return reply.send({ data: updated })
  })

  // DELETE /:id — delete template (and storage files)
  app.delete('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const existing = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })
    await prisma.docTemplate.delete({ where: { id } })
    // Note: storage file deletion is best-effort; actual deletion from R2/disk omitted here
    return reply.code(204).send()
  })

  // POST /:id/process — apply confirmedVars to original .docx, store as processedKey
  app.post('/:id/process', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Template not found' })

    const confirmedVars = existing.confirmedVars as unknown as VariableSuggestion[]
    if (!confirmedVars?.length) {
      return reply.code(400).send({ error: 'No confirmed variables to apply' })
    }

    const processedKey = `doc-templates/${agencyId}/${id}-processed.docx`

    try {
      await applyVariablesToDocx(existing.originalKey, confirmedVars, processedKey)
    } catch (err) {
      await prisma.docTemplate.update({
        where: { id },
        data: { status: 'error', errorMessage: err instanceof Error ? err.message : String(err) },
      })
      return reply.code(500).send({ error: 'Failed to process template' })
    }

    const updated = await prisma.docTemplate.update({
      where: { id },
      data: { processedKey, status: 'ready', errorMessage: null },
    })
    return reply.send({ data: updated })
  })

  // GET /:id/inspect — diagnostic: show what placeholders exist in stored files
  app.get('/:id/inspect', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const template = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!template) return reply.code(404).send({ error: 'Template not found' })

    const scanPlaceholders = async (key: string | null) => {
      if (!key) return null
      try {
        const buf = await downloadBuffer(key)
        const PizZip = await import('pizzip')
        const zip = new ((PizZip as any).default ?? PizZip)(buf)
        const xmlFile = zip.files['word/document.xml']
        if (!xmlFile) return { error: 'No word/document.xml', placeholders: [] }
        const rawXml: string = xmlFile.asText()
        // Raw scan
        const raw = [...new Set([...rawXml.matchAll(/\{\{([^{}]+?)\}\}/g)].map((m) => m[1].trim()))]
        // Flat scan (joins adjacent text nodes to catch split runs)
        const flat = rawXml.replace(/<\/w:t>[\s\S]*?<w:t[^>]*>/g, '')
        const flatFound = [...new Set([...flat.matchAll(/\{\{([^{}]+?)\}\}/g)].map((m) => m[1].trim()))]
        // Also show a snippet of the raw XML around any {{ found
        const snippet = rawXml.indexOf('{{') !== -1
          ? rawXml.substring(Math.max(0, rawXml.indexOf('{{') - 100), rawXml.indexOf('{{') + 200)
          : rawXml.substring(0, 500)
        return { rawPlaceholders: raw, flatPlaceholders: flatFound, xmlSnippet: snippet }
      } catch (err) {
        return { error: String(err), placeholders: [] }
      }
    }

    const [origResult, procResult] = await Promise.all([
      scanPlaceholders(template.originalKey),
      scanPlaceholders(template.processedKey),
    ])

    return reply.send({
      id: template.id,
      name: template.name,
      hasProcessedKey: !!template.processedKey,
      suggestions: template.suggestions,
      confirmedVars: template.confirmedVars,
      originalKey: origResult,
      processedKey: procResult,
    })
  })

  // POST /:id/fill — fill template with variable values, return binary .docx
  app.post('/:id/fill', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { variables?: Record<string, string>; filename?: string }

    const template = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!template) return reply.code(404).send({ error: 'Template not found' })

    const downloadKey = template.processedKey ?? template.originalKey
    let buffer: Buffer
    try {
      buffer = await downloadBuffer(downloadKey)
    } catch (err) {
      console.error('[docTemplates/fill] download failed:', err)
      return reply.code(500).send({ error: 'Could not load template file from storage.' })
    }

    try {
      const PizZip = await import('pizzip')
      const PizZipCtor = (PizZip as any).default ?? PizZip
      const Docxtemplater = await import('docxtemplater')
      const DocxtemplaterCtor = (Docxtemplater as any).default ?? Docxtemplater

      // let because we re-assign zip after the bracket pass
      let zip = new PizZipCtor(buffer)
      const xmlFile = zip.files['word/document.xml']
      const rawXml: string = xmlFile ? xmlFile.asText() : ''

      // ── Step 1: detect placeholder styles via concatenated visible text ───────
      // flatText joins all <w:t> content so we see the logical text even when
      // Word has split a single placeholder across multiple XML runs.
      const extractFlatText = (xml: string) => {
        const parts: string[] = []
        const rx = /(<w:t[^>]*>)([\s\S]*?)<\/w:t>/g
        let m: RegExpExecArray | null
        while ((m = rx.exec(xml)) !== null) {
          parts.push(m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
        }
        return parts.join('')
      }

      const flatText = extractFlatText(rawXml)
      // Extract names from BOTH styles — flatText concatenation reveals names that
      // are split across XML runs (e.g. [client_name] split at underscore).
      const bracketNames = [...new Set([...flatText.matchAll(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g)].map(m => m[1]))]
      const curlyNames   = [...new Set([...flatText.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(m => m[1]))]
      const hasBracket = bracketNames.length > 0
      const hasCurly   = curlyNames.length > 0
      const allNames   = [...new Set([...bracketNames, ...curlyNames])]
      console.log(`[fill] template=${id} hasBracket=${hasBracket}(${bracketNames.join(',')}) hasCurly=${hasCurly}(${curlyNames.join(',')}) flatLen=${flatText.length} sample="${flatText.slice(0, 120).replace(/\n/g, ' ')}"`)

      if (allNames.length === 0) {
        return reply.code(422).send({
          error: 'No placeholders found in template',
          detail: `Flat text sample: "${flatText.slice(0, 300)}"`,
        })
      }

      // ── Step 2: build render vars ─────────────────────────────────────────────
      const norm = (s: string) =>
        s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
          .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

      const sourceVars = body.variables ?? {}
      const lookup: Record<string, string> = {}
      for (const [k, v] of Object.entries(sourceVars)) {
        lookup[k] = v
        lookup[norm(k)] = v
      }

      const ALIASES: Record<string, string> = {
        company: 'client_name', company_name: 'client_name', client: 'client_name',
        organization: 'client_name', organisation: 'client_name', brand: 'client_name',
        product: 's01_platform_name', platform: 's01_platform_name', solution: 's01_platform_name',
        outcome: 's05_business_outcomes', outcomes: 's05_business_outcomes',
        target: 's02_industry', target_market: 's02_industry', target_industry: 's02_industry',
        role: 's08_persona_names', persona: 's08_persona_names', buyer: 's08_persona_names',
        industry: 'vertical_name', vertical: 'vertical_name', sector: 'vertical_name',
        date: 'document_date', doc_date: 'document_date',
        positioning: 's01_positioning_statement', tagline: 's01_tagline_options',
        pain_points: 's04_pain_points', challenges: 's04_pain_points',
        differentiators: 's06_differentiators', why_us: 's06_differentiators',
        competitors: 's12_competitor_names', objections: 's09_objections',
        proof_points: 's10_proof_points', kpis: 's17_kpis', metrics: 's17_kpis',
      }

      const renderVars: Record<string, string> = {}
      for (const found of allNames) {
        const n = norm(found)
        renderVars[found] =
          sourceVars[found]
          ?? lookup[n]
          ?? (ALIASES[n] ? sourceVars[ALIASES[n]] ?? lookup[norm(ALIASES[n])] : undefined)
          ?? ''
      }

      const matched = Object.values(renderVars).filter(Boolean).length
      const debugSample = allNames.slice(0, 6).map(k => `${k}=${(renderVars[k] || '(empty)').slice(0, 25)}`).join(', ')
      console.log(`[fill] matched=${matched}/${allNames.length} ${debugSample}`)

      // ── Step 3: two-pass render ───────────────────────────────────────────────
      // We do NOT try to regex-replace [brackets] in raw XML because Word
      // frequently splits a placeholder like [client_name] across multiple
      // <w:t> XML elements (especially at underscores). Instead we hand each
      // delimiter style directly to docxtemplater, whose linear parser merges
      // adjacent runs before matching delimiters — handling split runs natively.
      //
      // Pass 1: [bracket] delimiters
      if (hasBracket) {
        const doc1 = new DocxtemplaterCtor(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '[', end: ']' },
          nullGetter: () => '',
          errorLogging: false,
        })
        doc1.render(renderVars)
        // Re-parse into a fresh zip so pass 2 reads the already-filled XML
        const buf1: Buffer = doc1.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
        zip = new PizZipCtor(buf1)
      }

      // Pass 2: {{curly}} delimiters — handles processedKey markers + any
      // curlies that were already in the template
      const doc2 = new DocxtemplaterCtor(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        nullGetter: () => '',
        errorLogging: false,
      })
      doc2.render(renderVars)

      const out: Buffer = doc2.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
      const outFilename = body.filename ?? `${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${outFilename}"`)
        .header('X-Fill-Debug', `found=${allNames.length} matched=${matched} style=${hasBracket ? 'bracket' : 'curly'} sample=[${debugSample}]`)
        .header('Access-Control-Expose-Headers', 'X-Fill-Debug')
        .send(out)
    } catch (err: unknown) {
      const dtErr = err as { properties?: { errors?: Array<{ message: string }> } }
      const detail = dtErr?.properties?.errors?.map((e) => e.message).join('; ')
        ?? (err instanceof Error ? err.message : String(err))
      console.error('[docTemplates/fill] render failed:', detail)
      return reply.code(422).send({ error: 'Template rendering failed', detail })
    }
  })

  // ── Assignments ──────────────────────────────────────────────────────────────

  // GET /:id/assignments
  app.get('/:id/assignments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id }   = req.params as { id: string }
    const exists   = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!exists) return reply.code(404).send({ error: 'Template not found' })
    const assignments = await prisma.docTemplateAssignment.findMany({ where: { templateId: id, agencyId } })
    return reply.send({ data: assignments })
  })

  // POST /:id/assignments — create a new assignment
  app.post('/:id/assignments', async (req, reply) => {
    const { agencyId } = req.auth
    const { id }   = req.params as { id: string }
    const body     = req.body as {
      clientId?: string | null
      verticalId?: string | null
      docType?: string | null
      agencyDefault?: boolean
    }
    const exists = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!exists) return reply.code(404).send({ error: 'Template not found' })

    const assignment = await prisma.docTemplateAssignment.create({
      data: {
        id:           randomUUID(),
        agencyId,
        templateId:   id,
        clientId:     body.clientId   ?? null,
        verticalId:   body.verticalId ?? null,
        docType:      body.docType    ?? null,
        agencyDefault: body.agencyDefault ?? false,
      },
    })
    return reply.code(201).send({ data: assignment })
  })

  // DELETE /assignments/:assignmentId
  app.delete('/assignments/:assignmentId', async (req, reply) => {
    const { agencyId } = req.auth
    const { assignmentId } = req.params as { assignmentId: string }
    const existing = await prisma.docTemplateAssignment.findFirst({ where: { id: assignmentId, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Assignment not found' })
    await prisma.docTemplateAssignment.delete({ where: { id: assignmentId } })
    return reply.code(204).send()
  })

  // GET /:id/file — serve the raw original .docx for the browser (docx-preview)
  app.get('/:id/file', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const template = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!template) return reply.code(404).send({ error: 'Template not found' })
    const buffer = await downloadBuffer(template.originalKey)
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `inline; filename="${template.name.replace(/"/g, '')}.docx"`)
      .header('Cache-Control', 'private, max-age=300')
      .send(buffer)
  })

  // GET /resolve — find best template for a given scope
  // Query params: docType, clientId, verticalId
  app.get('/resolve', async (req, reply) => {
    const { agencyId } = req.auth
    const { docType, clientId, verticalId } = req.query as {
      docType?: string; clientId?: string; verticalId?: string
    }

    // Priority: client > vertical > docType > agency_default
    const candidates = await prisma.docTemplateAssignment.findMany({
      where: {
        agencyId,
        template: { status: 'ready' },
        OR: [
          ...(clientId   ? [{ clientId }]   : []),
          ...(verticalId ? [{ verticalId }] : []),
          // docType/agencyDefault only match agency-wide assignments (no clientId set)
          ...(docType    ? [{ docType, clientId: null }]    : []),
          { agencyDefault: true, clientId: null },
        ],
      },
      include: { template: { select: { id: true, name: true, docType: true, processedKey: true, confirmedVars: true } } },
    })

    // Sort by specificity
    const scored = candidates.map((a) => ({
      ...a,
      score: (a.clientId ? 100 : 0) + (a.verticalId ? 50 : 0) + (a.docType ? 25 : 0) + (a.agencyDefault ? 1 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)

    const best = scored[0] ?? null
    return reply.send({ data: best ? { ...best.template, assignmentId: best.id } : null })
  })
}
