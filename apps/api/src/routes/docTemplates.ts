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
 * Apply confirmed variable substitutions to the original .docx XML.
 * Downloads original → does text replacement in word/document.xml → uploads as processedKey.
 */
async function applyVariablesToDocx(
  originalKey: string,
  confirmedVars: VariableSuggestion[],
  processedKey: string,
): Promise<void> {
  const buffer = await downloadBuffer(originalKey)

  // Dynamic import of pizzip (CJS compat)
  const PizZip = await import('pizzip')
  const PizZipCtor = (PizZip as any).default ?? PizZip

  const zip = new PizZipCtor(buffer)

  // Patch word/document.xml — Word stores runs split across <w:t> elements
  // For simple single-run text, direct string replacement works fine
  const xmlFile = zip.files['word/document.xml']
  if (!xmlFile) throw new Error('Invalid .docx: missing word/document.xml')

  let xml: string = xmlFile.asText()

  for (const v of confirmedVars) {
    if (!v.sampleText || !v.variableId) continue
    // Escape special XML characters in the search text
    const escaped = v.sampleText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    // Replace the first occurrence (most templates have unique placeholder text)
    xml = xml.replace(escaped, `{{${v.variableId}}}`)
    // Also try the unescaped version (handles edge cases)
    if (xml.includes(v.sampleText)) {
      xml = xml.replace(v.sampleText, `{{${v.variableId}}}`)
    }
  }

  zip.file('word/document.xml', xml)
  const processed = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
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

  // POST /:id/fill — fill template with variable values, return binary .docx
  app.post('/:id/fill', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }
    const body = req.body as { variables?: Record<string, string>; filename?: string }

    const template = await prisma.docTemplate.findFirst({ where: { id, agencyId } })
    if (!template) return reply.code(404).send({ error: 'Template not found' })

    const storageKey = template.processedKey ?? template.originalKey
    const buffer = await downloadBuffer(storageKey)

    const PizZip = await import('pizzip')
    const PizZipCtor = (PizZip as any).default ?? PizZip
    const Docxtemplater = await import('docxtemplater')
    const DocxtemplaterCtor = (Docxtemplater as any).default ?? Docxtemplater

    const zip = new PizZipCtor(buffer)
    const doc = new DocxtemplaterCtor(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    })

    doc.render(body.variables ?? {})

    const out: Buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    const outFilename = body.filename ?? `${template.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${outFilename}"`)
      .send(out)
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
