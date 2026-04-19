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
  { id: 'client_name',      label: 'Client Name',         description: 'The client or company name',                  section: 'meta' },
  { id: 'agency_name',      label: 'Agency Name',         description: 'The agency producing this document',          section: 'meta' },
  { id: 'vertical_name',    label: 'Vertical Name',       description: 'The industry vertical (e.g. Healthcare)',     section: 'meta' },
  { id: 'document_date',    label: 'Document Date',       description: 'Date the document was generated',             section: 'meta' },
  // §01 Vertical Overview
  { id: 's01_positioning_statement', label: 'Positioning Statement', description: 'One-line positioning statement',   section: '01' },
  { id: 's01_tagline_options',       label: 'Tagline Options',       description: 'Primary tagline options (3)',       section: '01' },
  { id: 's01_how_to_use',            label: 'How to Use',            description: 'How to use this document',         section: '01' },
  { id: 's01_what_is_not',           label: 'What It Is Not',        description: 'Scope exclusions',                 section: '01' },
  { id: 's01_platform_name',         label: 'Platform Name',         description: 'Product / platform name',          section: '01' },
  { id: 's01_platform_benefit',      label: 'Platform Benefit',      description: 'Core platform benefit',            section: '01' },
  // §02 Customer Definition
  { id: 's02_industry',              label: 'Industry',              description: 'Target industry',                   section: '02' },
  { id: 's02_company_size',          label: 'Company Size',          description: 'Target company size/ARR range',     section: '02' },
  { id: 's02_geography',             label: 'Geography',             description: 'Target geography',                  section: '02' },
  { id: 's02_it_posture',            label: 'IT Posture',            description: 'IT complexity posture',             section: '02' },
  { id: 's02_compliance_status',     label: 'Compliance Status',     description: 'Regulatory / compliance context',   section: '02' },
  { id: 's02_contract_profile',      label: 'Contract Profile',      description: 'Typical contract / deal structure', section: '02' },
  // §03 Company Origin
  { id: 's03_founding_story',        label: 'Founding Story',        description: 'Origin and founding story',         section: '03' },
  { id: 's03_key_milestones',        label: 'Key Milestones',        description: 'Key company milestones',            section: '03' },
  { id: 's03_unique_capability',     label: 'Unique Capability',     description: 'Core unique capability / IP',       section: '03' },
  // §04 Triggers & Pain
  { id: 's04_trigger_events',        label: 'Trigger Events',        description: 'Buying trigger events',             section: '04' },
  { id: 's04_pain_points',           label: 'Pain Points',           description: 'Stakeholder pain points',           section: '04' },
  // §05 Business Outcomes
  { id: 's05_business_outcomes',     label: 'Business Outcomes',     description: 'Key business outcomes delivered',   section: '05' },
  { id: 's05_core_capabilities',     label: 'Core Capabilities',     description: 'Core platform capabilities',        section: '05' },
  // §06 Competitive Positioning
  { id: 's06_differentiators',       label: 'Differentiators',       description: 'Key competitive differentiators',   section: '06' },
  { id: 's06_win_themes',            label: 'Win Themes',            description: 'Top win themes vs. competition',    section: '06' },
  // §07 Target Accounts
  { id: 's07_ideal_customer_profile', label: 'Ideal Customer Profile', description: 'ICP definition',                section: '07' },
  { id: 's07_target_accounts',        label: 'Target Accounts',       description: 'Named target account list',       section: '07' },
  // §08 Personas
  { id: 's08_persona_names',         label: 'Persona Names',         description: 'Buyer persona names / titles',      section: '08' },
  { id: 's08_persona_goals',         label: 'Persona Goals',         description: 'Persona goals and motivations',     section: '08' },
  { id: 's08_persona_pain_points',   label: 'Persona Pain Points',   description: 'Persona-level pain points',         section: '08' },
  // §09 Objections
  { id: 's09_objections',            label: 'Objections',            description: 'Common objections',                 section: '09' },
  { id: 's09_objection_responses',   label: 'Objection Responses',   description: 'Recommended objection responses',   section: '09' },
  // §10 Proof Points
  { id: 's10_proof_points',          label: 'Proof Points',          description: 'Customer proof points / stats',     section: '10' },
  { id: 's10_case_study_results',    label: 'Case Study Results',    description: 'Key case study outcomes',           section: '10' },
  // §11 Pricing
  { id: 's11_pricing_model',         label: 'Pricing Model',         description: 'Pricing model description',         section: '11' },
  { id: 's11_pricing_tiers',         label: 'Pricing Tiers',         description: 'Pricing tiers / packages',          section: '11' },
  // §12 Competitive Intelligence
  { id: 's12_competitor_names',      label: 'Competitor Names',      description: 'Key named competitors',             section: '12' },
  { id: 's12_competitive_positioning', label: 'Competitive Positioning', description: 'vs. competitor positioning',   section: '12' },
  // §13 Sales Process
  { id: 's13_discovery_questions',   label: 'Discovery Questions',   description: 'Key discovery questions',           section: '13' },
  { id: 's13_sales_stages',          label: 'Sales Stages',          description: 'Sales stage definitions',           section: '13' },
  // §14 Sales Plays
  { id: 's14_email_templates',       label: 'Email Templates',       description: 'Outbound email templates',          section: '14' },
  { id: 's14_call_scripts',          label: 'Call Scripts',          description: 'Discovery call scripts',            section: '14' },
  // §15 Marketing Themes
  { id: 's15_marketing_channels',    label: 'Marketing Channels',    description: 'Primary marketing channels',        section: '15' },
  { id: 's15_content_themes',        label: 'Content Themes',        description: 'Core content themes / pillars',     section: '15' },
  // §16 Partner Strategy
  { id: 's16_partner_program',       label: 'Partner Program',       description: 'Partner / channel program details', section: '16' },
  // §17 Success Metrics
  { id: 's17_kpis',                  label: 'KPIs',                  description: 'Key success metrics and KPIs',      section: '17' },
  // §18 CTAs & Campaigns
  { id: 's18_ctas',                  label: 'CTAs',                  description: 'Primary calls to action',           section: '18' },
  { id: 's18_campaign_themes',       label: 'Campaign Themes',       description: 'Campaign theme descriptions',       section: '18' },
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
 * Find the last actual <w:r> run element start before position `before`.
 * Skips <w:rPr>, <w:rFonts>, <w:rStyle> etc. which also start with <w:r but are NOT run containers.
 */
function findLastRunStart(xml: string, before: number): number {
  let pos = before
  while (pos > 0) {
    const idx = xml.lastIndexOf('<w:r', pos - 1)
    if (idx === -1) return -1
    const next = xml[idx + 4]
    if (next === '>' || next === ' ') return idx   // <w:r> or <w:r ...> — actual run
    pos = idx                                       // <w:rPr> etc. — skip and keep looking
  }
  return -1
}

/**
 * Replace searchText with replacement in OOXML, handling Word's split-run problem.
 * Word often fragments a single visible string across multiple <w:r><w:t> elements.
 * Tries direct string match first, then a run-boundary-bridging regex.
 */
function xmlReplaceText(xml: string, searchText: string, replacement: string): string {
  const xmlEsc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const escaped = xmlEsc(searchText)

  // 1. Simple replacement — text sits in a single <w:t> node (most common)
  for (const needle of [escaped, searchText]) {
    if (xml.includes(needle)) return xml.replace(needle, replacement)
  }

  // 2. Split-run match — only for short texts, never crossing paragraph/cell boundaries
  if (escaped.length > 100) return xml

  const chars = [...escaped].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // SEP: optional run-boundary gap that must not cross </w:p>, </w:tc>, or </w:tr>
  const SEP = '(?:</w:t>(?:(?!<(?:\\/w:p|\\/w:tc|\\/w:tr))[\\s\\S])*?<w:t(?:[^>]*)>)?'

  let match: RegExpExecArray | null
  try {
    match = new RegExp(chars.join(SEP)).exec(xml)
  } catch {
    return xml
  }
  // Reject if no match or the matched span is suspiciously large
  if (!match || match[0].length > 1500) return xml

  const matchStart = match.index
  const matchEnd   = matchStart + match[0].length

  // Find the enclosing <w:r> (not <w:rPr> etc.) before matchStart
  const runStart = findLastRunStart(xml, matchStart + 1)
  if (runStart === -1) return xml

  const runEndIdx = xml.indexOf('</w:r>', matchEnd)
  if (runEndIdx === -1) return xml
  const runEnd = runEndIdx + '</w:r>'.length

  // Safety: the replaced span must be a reasonable size
  if (runEnd - runStart > 2000) return xml

  // Preserve rPr (formatting) from the first matched run
  const firstRunClose = xml.indexOf('</w:r>', runStart)
  const firstRunXml   = xml.substring(runStart, firstRunClose + '</w:r>'.length)
  const rPrMatch      = firstRunXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
  const rPr           = rPrMatch ? rPrMatch[0] : ''

  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${replacement}</w:t></w:r>`
  return xml.substring(0, runStart) + newRun + xml.substring(runEnd)
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

    const confirmedVars = (template.confirmedVars as unknown as VariableSuggestion[]) ?? []

    // Always re-apply markers from originalKey using the split-run-aware replacement.
    // This is more reliable than trusting processedKey, which may have incomplete markers
    // because Word splits text across XML runs and the old simple string replace missed them.
    let buffer: Buffer
    try {
      const origBuffer = await downloadBuffer(template.originalKey)
      buffer = confirmedVars.length > 0
        ? await markDocxBuffer(origBuffer, confirmedVars)
        : origBuffer
    } catch (err) {
      console.error('[docTemplates/fill] storage download failed:', err)
      return reply.code(500).send({ error: 'Could not load template file from storage.' })
    }

    try {
      const PizZip = await import('pizzip')
      const PizZipCtor = (PizZip as any).default ?? PizZip
      const Docxtemplater = await import('docxtemplater')
      const DocxtemplaterCtor = (Docxtemplater as any).default ?? Docxtemplater

      const zip = new PizZipCtor(buffer)

      // Scan for {{placeholders}} in the marked buffer
      const xmlFile = zip.files['word/document.xml']
      const rawXml: string = xmlFile ? xmlFile.asText() : ''
      const flatText = rawXml.replace(/<\/w:t>[\s\S]*?<w:t[^>]*>/g, '')
      const foundNames = [...new Set(
        [...flatText.matchAll(/\{\{([^{}]+?)\}\}/g)].map((m) => m[1].trim()),
      )]

      console.log(`[docTemplates/fill] confirmedVars=${confirmedVars.length} found=${foundNames.length} placeholders: ${foundNames.join(', ')}`)

      const sourceVars = body.variables ?? {}

      // Normalize helper — camelCase→snake, lowercase, collapse non-alphanumeric → _
      const norm = (s: string) =>
        s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
          .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

      // Normalised lookup: covers keys sent as-is AND normalised versions
      const lookup: Record<string, string> = {}
      for (const [k, v] of Object.entries(sourceVars)) {
        lookup[k]       = v
        lookup[norm(k)] = v
      }

      // Alias dictionary for designer-friendly placeholder names
      const ALIASES: Record<string, string> = {
        company: 'client_name', company_name: 'client_name', client: 'client_name',
        organization: 'client_name', organisation: 'client_name', brand: 'client_name',
        industry: 'vertical_name', vertical: 'vertical_name', sector: 'vertical_name',
        date: 'document_date', doc_date: 'document_date', report_date: 'document_date',
        positioning: 's01_positioning_statement', position: 's01_positioning_statement',
        positioning_statement: 's01_positioning_statement',
        tagline: 's01_tagline_options', taglines: 's01_tagline_options',
        headline: 's01_tagline_options', headlines: 's01_tagline_options',
        platform: 's01_platform_name', product: 's01_platform_name', solution: 's01_platform_name',
        core_benefit: 's01_platform_benefit', value_prop: 's01_platform_benefit',
        target_industry: 's02_industry', target_market: 's02_industry',
        company_size: 's02_company_size', employee_count: 's02_company_size',
        geography: 's02_geography', region: 's02_geography', location: 's02_geography',
        founding_story: 's03_founding_story', history: 's03_founding_story', story: 's03_founding_story',
        milestones: 's03_key_milestones', achievements: 's03_key_milestones',
        unique_capability: 's03_unique_capability', differentiator: 's03_unique_capability',
        triggers: 's04_trigger_events', trigger_events: 's04_trigger_events',
        pain_points: 's04_pain_points', challenges: 's04_pain_points', pains: 's04_pain_points',
        business_outcomes: 's05_business_outcomes', outcomes: 's05_business_outcomes',
        capabilities: 's05_core_capabilities', features: 's05_core_capabilities',
        differentiators: 's06_differentiators', why_us: 's06_differentiators',
        win_themes: 's06_win_themes',
        icp: 's07_ideal_customer_profile', ideal_customer: 's07_ideal_customer_profile',
        target_accounts: 's07_target_accounts', accounts: 's07_target_accounts',
        personas: 's08_persona_names', buyer_personas: 's08_persona_names',
        persona_goals: 's08_persona_goals', goals: 's08_persona_goals',
        objections: 's09_objections', common_objections: 's09_objections',
        objection_responses: 's09_objection_responses', responses: 's09_objection_responses',
        proof_points: 's10_proof_points', proof: 's10_proof_points', stats: 's10_proof_points',
        case_studies: 's10_case_study_results', results: 's10_case_study_results',
        competitors: 's12_competitor_names', competition: 's12_competitor_names',
        competitive_positioning: 's12_competitive_positioning', vs_competitors: 's12_competitive_positioning',
        discovery_questions: 's13_discovery_questions', questions: 's13_discovery_questions',
        email_templates: 's14_email_templates', emails: 's14_email_templates',
        call_scripts: 's14_call_scripts', scripts: 's14_call_scripts',
        marketing_channels: 's15_marketing_channels', channels: 's15_marketing_channels',
        content_themes: 's15_content_themes', themes: 's15_content_themes',
        kpis: 's17_kpis', metrics: 's17_kpis', success_metrics: 's17_kpis',
      }

      // Build render map — one entry per placeholder name actually found in the template
      const renderVars: Record<string, string> = {}
      for (const found of foundNames) {
        const n = norm(found)
        const resolved = sourceVars[found]
          ?? lookup[n]
          ?? (ALIASES[n] ? sourceVars[ALIASES[n]] ?? lookup[norm(ALIASES[n])] : undefined)
          ?? ''
        renderVars[found] = resolved
      }

      const matched = Object.values(renderVars).filter(Boolean).length
      console.log(`[docTemplates/fill] matched ${matched}/${foundNames.length} placeholders`)

      if (foundNames.length === 0) {
        return reply.code(422).send({
          error: 'No placeholders found in template',
          detail: 'The template does not contain any {{variable}} markers. Either run the "Process" step first so the system can map your template text to variables, or add {{variable_name}} placeholders directly in your Word template.',
        })
      }

      const doc = new DocxtemplaterCtor(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        nullGetter: () => '',
        errorLogging: false,
      })

      doc.render(renderVars)

      const out: Buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
      const outFilename = body.filename ?? `${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`

      // Debug header — visible in Network tab → Response Headers
      const debugSample = foundNames.slice(0, 5).map((k) => `${k}=${renderVars[k] ? renderVars[k].slice(0, 30).replace(/\n/g, '\\n') : '(empty)'}`).join(', ')
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${outFilename}"`)
        .header('X-Fill-Debug', `using=${template.processedKey ? 'processedKey' : 'originalKey'} found=${foundNames.length} matched=${matched} sample=[${debugSample}]`)
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
          ...(docType    ? [{ docType }]    : []),
          { agencyDefault: true },
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
