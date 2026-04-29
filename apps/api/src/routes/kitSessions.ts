/**
 * GTM Kit Session routes — /api/v1/kit-sessions
 *
 * GET  /intake/:clientId/:verticalId   — map framework to intake JSON + validate
 * GET  /:clientId/:verticalId          — get or create session
 * PATCH /:sessionId                    — update session state (mode, status, chat, approvals)
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { getKitGenerationQueue, getStoryboardQueue } from '../lib/queues.js'
import { downloadBuffer } from '@contentnode/storage'

// ── Intake JSON mapper ────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : []
}

function mapFrameworkToIntake(fw: Record<string, unknown>, verticalName: string, clientName: string) {
  const s01 = (fw.s01 ?? {}) as Record<string, unknown>
  const s02 = (fw.s02 ?? {}) as Record<string, unknown>
  const s03 = (fw.s03 ?? {}) as Record<string, unknown>
  const s04 = (fw.s04 ?? {}) as Record<string, unknown>
  const s05 = (fw.s05 ?? {}) as Record<string, unknown>
  const s06 = (fw.s06 ?? {}) as Record<string, unknown>
  const s07 = (fw.s07 ?? {}) as Record<string, unknown>
  const s08 = (fw.s08 ?? {}) as Record<string, unknown>
  const s09 = (fw.s09 ?? {}) as Record<string, unknown>
  const s10 = (fw.s10 ?? {}) as Record<string, unknown>
  const s11 = (fw.s11 ?? {}) as Record<string, unknown>
  const s17 = (fw.s17 ?? {}) as Record<string, unknown>
  const s18 = (fw.s18 ?? {}) as Record<string, unknown>

  // §01 → vertical
  const taglineOptions = str(s01.taglineOptions)
  const taglines = taglineOptions
    .split('\n')
    .map((l) => l.replace(/^\d+[\.\)]\s*/, '').replace(/^[""]|[""]$/g, '').trim())
    .filter(Boolean)

  const whatIsNotRaw = str(s01.whatIsNot)
  const whatWeAreNot = whatIsNotRaw
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)

  const vertical = {
    name: verticalName,
    client_name: clientName,
    positioning_statement: str(s01.positioningStatement),
    taglines,
    what_we_are_not: whatWeAreNot,
    how_to_use: str(s01.howToUse),
  }

  // §02 → ICP / segments (buyer table → segments array)
  const buyerTable = arr<Record<string, unknown>>(s02.buyerTable)
  const s07Segments = arr<Record<string, unknown>>((s07 as Record<string, unknown>).segments)

  // Merge §02 buyer table rows with §07 segment detail
  const segments = buyerTable
    .filter((r) => str(r.segment) || str(r.primaryBuyer))
    .map((row) => {
      const name = str(row.segment)
      const matched = s07Segments.find((s) => str(s.name).toLowerCase() === name.toLowerCase())
      return {
        name,
        buyer_titles: str(row.primaryBuyer).split('/').map((t) => t.trim()).filter(Boolean),
        core_pain: str(row.corePain),
        lead_hook: matched ? str(matched.leadHook) : '',
        entry_point: str(row.entryPoint),
        key_pressures: matched
          ? str(matched.keyPressures).split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
          : [],
        what_is_different: matched ? str(matched.whatIsDifferent) : '',
        compliance_notes: matched ? str(matched.complianceNotes) : '',
      }
    })

  // §03 → statistics
  const statsTable = arr<Record<string, unknown>>(s03.statsTable)
  const statistics = statsTable
    .filter((r) => str(r.stat))
    .map((r) => ({
      stat: str(r.stat),
      label: str(r.context),
      source: str(r.source),
      year: str(r.year),
    }))

  // §04 → challenges
  const challengeRows = arr<Record<string, unknown>>((s04 as Record<string, unknown>).challenges)
  const challenges = challengeRows
    .filter((c) => str(c.name))
    .map((c) => ({
      name: str(c.name),
      why_it_exists: str(c.whyExists),
      business_consequence: str(c.consequence),
      solution: str(c.solution),
      service_pillar: str(c.pillarsText),
    }))

  // §05 → pillars + service stack
  const pillars = arr<Record<string, unknown>>((s05 as Record<string, unknown>).pillars)
    .filter((p) => str(p.pillar))
    .map((p) => ({
      name: str(p.pillar),
      value_prop: str(p.valueProp),
      key_services: str(p.keyServices),
      relevant_to: str(p.relevantTo),
    }))

  const serviceStack = arr<Record<string, unknown>>((s05 as Record<string, unknown>).serviceStack)
    .filter((s) => str(s.service))
    .map((s) => ({
      service: str(s.service),
      regulatory_domain: str(s.regulatoryDomain),
      what_it_delivers: str(s.whatItDelivers),
      priority: str(s.priority),
    }))

  // §06 → differentiators
  const differentiatorRows = arr<Record<string, unknown>>((s06 as Record<string, unknown>).differentiators)
  const differentiators = differentiatorRows
    .filter((d) => str(d.label))
    .map((d) => ({
      label: str(d.label),
      position: str(d.position),
    }))

  // §08 → messaging
  const vpTable = arr<Record<string, unknown>>((s08 as Record<string, unknown>).valuePropTable)
  const messaging = {
    problems: str(s08.problems),
    solution: str(s08.solution),
    outcomes: str(s08.outcomes),
    value_prop_table: vpTable.filter((r) => str(r.pillar)).map((r) => ({
      pillar: str(r.pillar),
      meaning: str(r.meaning),
      proof_point: str(r.proofPoint),
      citation: str(r.citation),
    })),
  }

  // §09 → proof points + case studies
  const proofPointRows = arr<Record<string, unknown>>((s09 as Record<string, unknown>).proofPoints)
  const proof_points = proofPointRows
    .filter((p) => str(p.text))
    .map((p) => ({ stat: str(p.text), context: str(p.source) }))

  const caseStudyRows = arr<Record<string, unknown>>((s09 as Record<string, unknown>).caseStudies)
  const case_studies = caseStudyRows
    .filter((c) => str(c.clientProfile) || str(c.outcomes))
    .map((c) => ({
      client_profile: str(c.clientProfile),
      url: str(c.url),
      situation: str(c.situation),
      engagement: str(c.engagement),
      outcomes: str(c.outcomes),
      thirty_second: str(c.thirtySecond),
      headline_stat: str(c.headlineStat),
      quote: '',
      quote_attribution: '',
      approved_for_use: true,
    }))

  // §10 → objections
  const objectionRows = arr<Record<string, unknown>>((s10 as Record<string, unknown>).objections)
  const objections = objectionRows
    .filter((o) => str(o.objection))
    .map((o) => ({
      objection: str(o.objection),
      response: str(o.response),
      followup: str(o.followUp),
    }))

  // §11 → brand voice
  const goodExamples = arr<Record<string, unknown>>(s11.goodExamples)
  const badExamples = arr<Record<string, unknown>>(s11.badExamples)
  const brand_voice = {
    tone: str(s11.toneTarget),
    vocabulary_level: str(s11.vocabularyLevel),
    sentence_style: str(s11.sentenceStyle),
    sounds_like: goodExamples.map((e) => str(e.text)).filter(Boolean),
    not_like: badExamples.map((e) => str(e.bad)).filter(Boolean),
    avoid: str(s11.whatToAvoid).split(',').map((t) => t.trim()).filter(Boolean),
  }

  // §17 → regulatory frameworks
  const regRows = arr<Record<string, unknown>>((s17 as Record<string, unknown>).regulations)
  const regulatory_frameworks = regRows
    .filter((r) => str(r.requirement))
    .map((r) => ({
      name: str(r.requirement),
      capability: str(r.capability),
      service_pillar: str(r.servicePillar),
      sales_note: str(r.salesNote),
    }))

  // §18 → primary CTA
  const ctaRows = arr<Record<string, unknown>>((s18 as Record<string, unknown>).ctas)
  const primaryCtaRow = ctaRows.find((c) => str(c.ctaName)) ?? ctaRows[0] ?? {}
  const primary_cta = {
    name: str(primaryCtaRow.ctaName),
    description: str(primaryCtaRow.description),
    url: str(primaryCtaRow.targetAudienceTrigger),
    assets: str(primaryCtaRow.assets),
  }

  const contact = ((s18 as Record<string, unknown>).contact ?? {}) as Record<string, unknown>

  return {
    vertical,
    icp: {
      industry: str(s02.industry),
      company_size: str(s02.companySize),
      geography: str(s02.geography),
      it_posture: str(s02.itPosture),
      compliance_status: str(s02.complianceStatus),
      contract_profile: str(s02.contractProfile),
      secondary_targets: str(s02.secondaryTargets),
    },
    segments,
    statistics,
    market_narrative: str(s03.marketPressureNarrative),
    additional_context: str(s03.additionalContext),
    challenges,
    pillars,
    service_stack: serviceStack,
    differentiators,
    messaging,
    proof_points,
    case_studies,
    objections,
    brand_voice,
    regulatory_frameworks,
    primary_cta,
    document_control: {
      vertical_owner: str(contact.verticalOwner),
      marketing_contact: str(contact.marketingContact),
      sales_lead: str(contact.salesLead),
      document_version: str(contact.documentVersion),
    },
  }
}

// ── Required-field validation ─────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
  blocking: boolean
}

function validateIntake(intake: ReturnType<typeof mapFrameworkToIntake>): ValidationError[] {
  const errors: ValidationError[] = []

  // ── Hard blocks — generation cannot proceed without these ─────────────────

  if (!intake.vertical.positioning_statement) {
    errors.push({ field: 'vertical.positioning_statement', message: 'Section 01: Positioning statement is required', blocking: true })
  }
  if (intake.vertical.what_we_are_not.length === 0) {
    errors.push({ field: 'vertical.what_we_are_not', message: 'Section 01: "What we are NOT" is required for the Internal Brief', blocking: true })
  }

  const challengesWithPillar = intake.challenges.filter((c) => c.service_pillar.trim())
  if (challengesWithPillar.length < 3) {
    errors.push({
      field: 'challenges',
      message: `Section 04: At least 3 challenges with service pillar mappings are required (found ${challengesWithPillar.length})`,
      blocking: true,
    })
  }

  if (!intake.primary_cta.name || !intake.primary_cta.url) {
    errors.push({
      field: 'primary_cta',
      message: 'Section 18: Primary CTA (name and URL) is required — every asset ends with this call to action',
      blocking: true,
    })
  }

  // ── Optional sections — warnings only, generation proceeds with placeholders ─

  const statsWithSource = intake.statistics.filter((s) => s.source.trim() && s.year.trim())
  if (statsWithSource.length === 0) {
    errors.push({
      field: 'statistics',
      message: 'Section 03 has no statistics. Placeholder stat blocks have been used. Add real stats to your GTM Framework and regenerate to replace them.',
      blocking: false,
    })
  } else if (statsWithSource.length < 4) {
    errors.push({
      field: 'statistics',
      message: `Section 03: Only ${statsWithSource.length} statistic${statsWithSource.length === 1 ? '' : 's'} with source and year (4 recommended). Assets may have sparse stat sections.`,
      blocking: false,
    })
  }

  if (intake.proof_points.length === 0) {
    errors.push({
      field: 'proof_points',
      message: 'Section 09 has no proof points. Placeholders have been used. Add real proof points to your GTM Framework and regenerate.',
      blocking: false,
    })
  }

  const hasCaseStudies = intake.case_studies.some((c) => c.outcomes.trim())
  if (!hasCaseStudies) {
    errors.push({
      field: 'case_studies',
      message: 'Section 13 has no testimonials or case studies. Structured placeholders have been used. Add real examples to your GTM Framework and regenerate.',
      blocking: false,
    })
  }

  // ── Other warnings ────────────────────────────────────────────────────────

  if (intake.brand_voice.sounds_like.length === 0 && intake.brand_voice.not_like.length === 0) {
    errors.push({ field: 'brand_voice', message: 'Section 11: No brand voice examples — generic tone guardrails will apply', blocking: false })
  }
  if (intake.differentiators.length < 3) {
    errors.push({ field: 'differentiators', message: `Section 06: Fewer than 3 differentiators (found ${intake.differentiators.length}) — some asset sections will be sparse`, blocking: false })
  }
  if (intake.segments.length === 0) {
    errors.push({ field: 'segments', message: 'Section 02: No buyer segments defined — segment-specific copy will be omitted', blocking: false })
  }

  return errors
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function kitSessionRoutes(app: FastifyInstance) {

  // GET /intake/:clientId/:verticalId — map framework to intake JSON, run validation
  app.get<{ Params: { clientId: string; verticalId: string } }>(
    '/intake/:clientId/:verticalId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, verticalId } = req.params

      const [client, vertical, fw] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
        prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
        prisma.clientFramework.findUnique({
          where: { clientId_verticalId: { clientId, verticalId } },
        }),
      ])

      if (!client)   return reply.code(404).send({ error: 'Client not found' })
      if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

      const fwData = (fw?.data ?? {}) as Record<string, unknown>
      const intake = mapFrameworkToIntake(fwData, vertical.name, client.name)
      const errors = validateIntake(intake)
      const blocking = errors.filter((e) => e.blocking)

      return reply.send({
        intake,
        validation: {
          errors,
          blocking: blocking.length > 0,
          blockingCount: blocking.length,
          warningCount: errors.filter((e) => !e.blocking).length,
        },
        meta: {
          clientName: client.name,
          verticalName: vertical.name,
          frameworkLastUpdated: fw?.updatedAt ?? null,
        },
      })
    }
  )

  // GET /:clientId/:verticalId — get most recent active session, or create one
  app.get<{ Params: { clientId: string; verticalId: string } }>(
    '/:clientId/:verticalId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, verticalId } = req.params

      const [client, vertical] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } }),
        prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true, name: true } }),
      ])
      if (!client)   return reply.code(404).send({ error: 'Client not found' })
      if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

      // Return most recent active session (excludes completed and archived)
      const session = await prisma.kitSession.findFirst({
        where: { agencyId, clientId, verticalId, status: { notIn: ['complete', 'archived'] } },
        orderBy: { updatedAt: 'desc' },
      })

      return reply.send({ data: session })
    }
  )

  // POST /:clientId/:verticalId — create a new session
  app.post<{ Params: { clientId: string; verticalId: string }; Body: { mode: string } }>(
    '/:clientId/:verticalId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, verticalId } = req.params
      const mode = req.body?.mode === 'quick' ? 'quick' : 'full'

      const [client, vertical] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }),
        prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { id: true } }),
      ])
      if (!client)   return reply.code(404).send({ error: 'Client not found' })
      if (!vertical) return reply.code(404).send({ error: 'Vertical not found' })

      const session = await prisma.kitSession.create({
        data: { agencyId, clientId, verticalId, mode, status: 'intake' },
      })

      return reply.code(201).send({ data: session })
    }
  )

  // PATCH /:sessionId — update session state
  app.patch<{ Params: { sessionId: string }; Body: Record<string, unknown> }>(
    '/:sessionId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const allowed = ['mode', 'status', 'currentAsset', 'approvedAssets', 'chatHistory', 'intakeJson', 'generatedFiles']
      const update: Record<string, unknown> = {}
      for (const key of allowed) {
        if (key in req.body) update[key] = req.body[key]
      }

      const updated = await prisma.kitSession.update({
        where: { id: sessionId },
        data: update as Parameters<typeof prisma.kitSession.update>[0]['data'],
      })

      return reply.send({ data: updated })
    }
  )

  // POST /:sessionId/generate — kick off generation from asset 0 (or current)
  app.post<{ Params: { sessionId: string }; Body: { resumeFromAsset?: number } }>(
    '/:sessionId/generate',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params
      const resumeFrom = req.body?.resumeFromAsset ?? 0

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })
      if (!session.intakeJson) return reply.code(400).send({ error: 'Session has no intakeJson — save intake before generating' })

      // Initialize generatedFiles with pending assets if empty
      const existingFiles = (session.generatedFiles ?? {}) as { assets?: unknown[] }
      if (!existingFiles.assets || existingFiles.assets.length !== 8) {
        const ASSET_DEFS = [
          { index: 0, name: 'Brochure',          num: '01', ext: 'docx', status: 'pending' },
          { index: 1, name: 'eBook',             num: '02', ext: 'html', status: 'pending' },
          { index: 2, name: 'Sales Cheat Sheet', num: '03', ext: 'html', status: 'pending' },
          { index: 3, name: 'BDR Emails',        num: '04', ext: 'docx', status: 'pending' },
          { index: 4, name: 'Customer Deck',     num: '05', ext: 'pptx', status: 'pending' },
          { index: 5, name: 'Video Script',      num: '06', ext: 'docx', status: 'pending' },
          { index: 6, name: 'Web Page Copy',     num: '07', ext: 'docx', status: 'pending' },
          { index: 7, name: 'Internal Brief',    num: '08', ext: 'docx', status: 'pending' },
        ]
        await prisma.kitSession.update({
          where: { id: sessionId },
          data: { generatedFiles: { assets: ASSET_DEFS } as any, status: 'generating' },
        })
      }

      await getKitGenerationQueue().add(
        'generate-asset',
        { sessionId, agencyId, assetIndex: resumeFrom },
        { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
      )

      return reply.code(202).send({ ok: true, message: `Generation queued from asset ${resumeFrom}` })
    }
  )

  // POST /:sessionId/approve — approve current checkpoint in Full Session mode
  app.post<{ Params: { sessionId: string }; Body: { notes?: string } }>(
    '/:sessionId/approve',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params
      const notes = req.body?.notes ?? ''

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })
      if (session.status !== 'checkpoint') return reply.code(400).send({ error: 'Session is not at a checkpoint' })

      const assetIndex = session.currentAsset ?? 0
      const approvedAssets = [...((session.approvedAssets as number[]) ?? []), assetIndex]

      // Store approval note in chatHistory
      const chatHistory = [...((session.chatHistory as unknown[]) ?? [])]
      if (notes) chatHistory.push({ role: 'user', content: notes, assetIndex, type: 'approval' })

      await prisma.kitSession.update({
        where: { id: sessionId },
        data: { approvedAssets: approvedAssets as any, chatHistory: chatHistory as any },
      })

      await getKitGenerationQueue().add(
        'generate-asset',
        { sessionId, agencyId, assetIndex: assetIndex + 1 },
        { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
      )

      return reply.send({ ok: true, nextAsset: assetIndex + 1 })
    }
  )

  // POST /:sessionId/cancel — cancel generation and save progress
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/cancel',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      await prisma.kitSession.update({
        where: { id: sessionId },
        data: { status: 'cancelled' },
      })

      return reply.send({ ok: true })
    }
  )

  // POST /:sessionId/archive — archive a completed session so a new one can be started
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/archive',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      await prisma.kitSession.update({
        where: { id: sessionId },
        data: { status: 'archived' },
      })

      return reply.send({ ok: true })
    }
  )

  // GET /:clientId/:verticalId/history — list archived sessions (metadata only, no content)
  app.get<{ Params: { clientId: string; verticalId: string } }>(
    '/:clientId/:verticalId/history',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId, verticalId } = req.params

      const sessions = await prisma.kitSession.findMany({
        where: { agencyId, clientId, verticalId, status: 'archived' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, mode: true, status: true, createdAt: true, updatedAt: true },
      })

      return reply.send({ data: sessions })
    }
  )

  // POST /:sessionId/storyboard — enqueue storyboard generation
  app.post<{ Params: { sessionId: string }; Body: { framesPerScene?: number } }>(
    '/:sessionId/storyboard',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params
      const raw = (req.body as { framesPerScene?: unknown })?.framesPerScene
      const framesPerScene = (typeof raw === 'number' && [1, 2, 3, 4].includes(raw) ? raw : 1) as 1 | 2 | 3 | 4

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const files  = (session.generatedFiles ?? {}) as Record<string, unknown>
      const assets = (files.assets as Array<Record<string, unknown>>) ?? []
      if (assets[5]?.status !== 'complete') {
        return reply.code(400).send({ error: 'Asset 06 (Video Script) must be complete before generating storyboard' })
      }

      const current = (files.storyboard ?? {}) as Record<string, unknown>
      await prisma.kitSession.update({
        where: { id: sessionId },
        data: {
          generatedFiles: {
            ...files,
            storyboard: { ...current, status: 'pending', framesPerScene, startedAt: new Date().toISOString() },
          } as object,
        },
      })

      await getStoryboardQueue().add(
        'generate-storyboard',
        { sessionId, agencyId, framesPerScene },
        { removeOnComplete: { count: 20 }, removeOnFail: { count: 10 } },
      )

      return reply.send({ ok: true })
    }
  )

  // GET /:sessionId/storyboard — return storyboard progress
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/storyboard',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const files = (session.generatedFiles ?? {}) as Record<string, unknown>
      const storyboard = (files.storyboard ?? null) as Record<string, unknown> | null
      return reply.send({ data: storyboard })
    }
  )

  // GET /:sessionId/storyboard/download — stream PDF from storage
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/storyboard/download',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const files     = (session.generatedFiles ?? {}) as Record<string, unknown>
      const storyboard = (files.storyboard ?? null) as Record<string, unknown> | null
      if (!storyboard || storyboard.status !== 'complete' || !storyboard.pdfStorageKey) {
        return reply.code(404).send({ error: 'Storyboard PDF not available yet' })
      }

      const buf = await downloadBuffer(storyboard.pdfStorageKey as string)
      const filename = (storyboard.pdfFilename as string | undefined) ?? 'storyboard.pdf'

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buf)
    }
  )

  // GET /:sessionId/storyboard/scenes/:sceneNumber/download — download a single scene page
  app.get<{ Params: { sessionId: string; sceneNumber: string } }>(
    '/:sessionId/storyboard/scenes/:sceneNumber/download',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId, sceneNumber } = req.params

      const session = await prisma.kitSession.findFirst({ where: { id: sessionId, agencyId } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const files     = (session.generatedFiles ?? {}) as Record<string, unknown>
      const storyboard = (files.storyboard ?? null) as Record<string, unknown> | null
      const scenes    = (storyboard?.scenes ?? []) as Array<Record<string, unknown>>
      const scene     = scenes.find(s => s.sceneNumber === parseInt(sceneNumber, 10))

      if (!scene?.pageStorageKey) {
        return reply.code(404).send({ error: `Scene ${sceneNumber} PDF not available yet` })
      }

      const buf      = await downloadBuffer(scene.pageStorageKey as string)
      const filename = `Scene ${sceneNumber}.pdf`

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buf)
    }
  )

  // GET /:sessionId/storyboard/scenes/:sceneNumber/frames/:frameIndex/download — download a raw AI frame image
  app.get<{ Params: { sessionId: string; sceneNumber: string; frameIndex: string } }>(
    '/:sessionId/storyboard/scenes/:sceneNumber/frames/:frameIndex/download',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { sessionId, sceneNumber, frameIndex } = req.params

      const session = await prisma.kitSession.findFirst({
        where: { id: sessionId, agencyId },
        select: { storyboardImageCache: true },
      })
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const cache    = (session.storyboardImageCache ?? {}) as Record<string, string>
      const cacheKey = `scene_${sceneNumber}_frame_${frameIndex}`
      const dataUrl  = cache[cacheKey]

      if (!dataUrl) return reply.code(404).send({ error: 'Image not found' })

      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buf    = Buffer.from(base64, 'base64')
      const filename = `Scene ${sceneNumber} Frame ${frameIndex}.png`

      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buf)
    }
  )
}
