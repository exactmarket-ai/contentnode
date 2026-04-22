/**
 * programs.ts
 *
 * Routes for the Program Marketing system.
 * Programs are standing marketing engagements — strategy + templates + recurring content packs.
 *
 * POST /api/v1/programs/pilot        — programsPILOT two-phase AI chat
 * GET  /api/v1/programs              — list programs
 * GET  /api/v1/programs/:id          — get program with recent packs
 * POST /api/v1/programs              — create program
 * PATCH /api/v1/programs/:id         — update program
 * DELETE /api/v1/programs/:id        — delete program
 * POST /api/v1/programs/:id/run      — manually trigger a content pack cycle
 * GET  /api/v1/programs/:id/packs    — list content packs
 * GET  /api/v1/programs/:id/packs/:packId — get pack with all items
 * PATCH /api/v1/programs/:id/packs/:packId/items/:itemId — edit item content
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'
import { prisma }               from '@contentnode/database'

// ─── Program types ─────────────────────────────────────────────────────────────

const PROGRAM_TYPES = [
  // Content (recurring)
  'thought_leadership', 'seo_content', 'newsletter', 'social_media',
  // Outbound / demand gen (one-time templates)
  'outbound_email_sequence', 'linkedin_outreach_sequence', 'cold_calling_program',
  // Inbound / nurture (one-time)
  'email_nurture_sequence', 'lead_magnet_program', 'webinar_event_program',
  // ABM (one-time)
  'abm_program',
  // Retention (one-time)
  'customer_onboarding_program', 'reengagement_program',
  // Partner / launch (one-time)
  'partner_enablement_program', 'product_launch_program',
  // Legacy (kept for backward compat)
  'competitive_intel', 'customer_story', 'event_content',
] as const

type ProgramType = (typeof PROGRAM_TYPES)[number]

const ONE_TIME_TYPES = new Set<string>([
  'outbound_email_sequence', 'linkedin_outreach_sequence', 'cold_calling_program',
  'email_nurture_sequence', 'lead_magnet_program', 'webinar_event_program',
  'abm_program', 'customer_onboarding_program', 'reengagement_program',
  'partner_enablement_program', 'product_launch_program',
])

const PROGRAM_TYPE_META: Record<string, { label: string; description: string; templateItems: string[] }> = {
  thought_leadership:       { label: 'Thought Leadership', description: 'Original POV content, expert takes, industry commentary', templateItems: ['Program Brief', 'Article Template', 'LinkedIn Post Formula', 'Image Prompt Formula'] },
  seo_content:              { label: 'SEO Content', description: 'Keyword-targeted blogs designed to rank and convert', templateItems: ['Program Brief', 'SEO Blog Template', 'Target Keyword Clusters'] },
  newsletter:               { label: 'Newsletter', description: 'Recurring email digest with curated insights + original commentary', templateItems: ['Program Brief', 'Newsletter Issue Template'] },
  social_media:             { label: 'Social Media', description: 'Platform-specific post batches on a recurring cadence', templateItems: ['Program Brief', 'LinkedIn Post Formula', 'Instagram Caption Formula', 'X Post Formula'] },
  outbound_email_sequence:  { label: 'Outbound Email Sequence', description: '5-email cold sequence + voicemails + objection guide', templateItems: ['Program Brief', 'Email 1 — Cold Intro', 'Email 2 — Value Add', 'Email 3 — Social Proof', 'Email 4 — Different Angle', 'Email 5 — Break-up', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide'] },
  linkedin_outreach_sequence: { label: 'LinkedIn Outreach Sequence', description: 'Connection request + 4 follow-up messages', templateItems: ['Program Brief', 'Connection Request Message', 'Message 1 — Post-Connect Intro', 'Message 2 — Value / Resource', 'Message 3 — Soft Ask', 'Message 4 — Break-up'] },
  cold_calling_program:     { label: 'Cold Calling Program', description: 'Opener, pitch, discovery questions, objection handling, scripts', templateItems: ['Program Brief', 'Opener Script', '3-Minute Pitch Script', 'Discovery Question Bank', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide', 'Call Wrap-up Script'] },
  email_nurture_sequence:   { label: 'Email Nurture Sequence', description: 'Full drip sequence from lead magnet to conversion ask', templateItems: ['Program Brief', 'Delivery Email', 'Nurture Email 1 — Welcome', 'Nurture Emails 2–5', 'Re-engagement Email', 'Conversion Email'] },
  lead_magnet_program:      { label: 'Lead Magnet Program', description: 'Full document (eBook/whitepaper/guide) + landing page + delivery email', templateItems: ['Program Brief', 'Lead Magnet Document', 'Landing Page Copy', 'Thank-you Page Copy', 'Delivery Email'] },
  webinar_event_program:    { label: 'Webinar / Event Program', description: 'Invite sequence + post-event sequence + social promotion', templateItems: ['Program Brief', 'Invite Email 1', 'Invite Email 2 — Reminder', 'Invite Email 3 — Day-of', 'Post-Event Email 1 — Replay', 'Post-Event Email 2 — Follow-up', 'Social Promotion Posts', 'Event Page Copy'] },
  abm_program:              { label: 'ABM Program', description: 'Target account profile + personalised outreach templates', templateItems: ['Program Brief', 'ICP & Account Profile Template', 'Personalised Outreach Email', 'LinkedIn Message Template', 'Account One-Pager Structure', 'Account Research Guide'] },
  customer_onboarding_program: { label: 'Customer Onboarding Program', description: 'Welcome + milestone emails + checklist + FAQ', templateItems: ['Program Brief', 'Welcome Email', 'Day 3 Check-in Email', 'Day 7 Milestone Email', 'Day 30 Success Review Email', 'Onboarding Checklist', 'FAQ Document'] },
  reengagement_program:     { label: 'Re-engagement Program', description: '3-email win-back + sunset email', templateItems: ['Program Brief', 'Win-back Email 1', 'Win-back Email 2', 'Win-back Email 3 — Offer', 'Sunset Email'] },
  partner_enablement_program: { label: 'Partner Enablement Program', description: 'Co-marketing, co-sell, and partner comms templates', templateItems: ['Program Brief', 'Partner Welcome Email', 'Co-Marketing Email Template', 'Co-Sell Introduction Email', 'Partner Newsletter Template', 'Joint Press Release Template'] },
  product_launch_program:   { label: 'Product Launch Program', description: 'Full launch kit: emails, blog, press release, socials, sales one-pager', templateItems: ['Program Brief', 'Pre-launch Teaser Email', 'Launch Day Announcement Email', 'Launch Blog Post', 'Press Release', 'Social Announcement Posts', 'Sales One-Pager Structure', 'Internal FAQ'] },
  competitive_intel:        { label: 'Competitive Intel', description: 'Ongoing competitive landscape analysis (legacy)', templateItems: ['Program Brief', 'Intelligence Brief Template'] },
  customer_story:           { label: 'Customer Story', description: 'Case study pipeline (legacy)', templateItems: ['Program Brief', 'Case Study Template'] },
  event_content:            { label: 'Event Content', description: 'Event asset production (legacy)', templateItems: ['Program Brief', 'Event Content Template'] },
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(30000),
})

const pilotBody = z.object({
  messages:         z.array(messageSchema).min(0).max(80),
  clientId:         z.string().min(1),
  verticalId:       z.string().optional().nullable(),
  currentProgramId: z.string().optional().nullable(),
  pilotPhase:       z.enum(['think', 'build']).default('think'),
})

const createProgramBody = z.object({
  clientId:        z.string().min(1),
  verticalId:      z.string().optional().nullable(),
  name:            z.string().min(1).max(200),
  type:            z.string(),
  scheduledTaskId: z.string().optional().nullable(),
  contentConfig:   z.record(z.unknown()).optional(),
  autoPublish:     z.boolean().optional(),
  brief:           z.string().optional().nullable(),
  cadence:         z.string().optional().nullable(),
  pilotPhase:      z.string().optional(),
  executionModel:  z.string().optional(),
})

const updateProgramBody = z.object({
  name:            z.string().min(1).max(200).optional(),
  status:          z.enum(['active', 'paused', 'archived']).optional(),
  verticalId:      z.string().nullable().optional(),
  scheduledTaskId: z.string().nullable().optional(),
  contentConfig:   z.record(z.unknown()).optional(),
  autoPublish:     z.boolean().optional(),
  setupComplete:   z.boolean().optional(),
  brief:           z.string().nullable().optional(),
  cadence:         z.string().nullable().optional(),
  pilotPhase:      z.string().optional(),
  pilotMessages:   z.unknown().optional(),
})

const updateItemBody = z.object({
  editedContent: z.string(),
})

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildContext(
  agencyId: string,
  clientId: string,
  verticalId?: string | null,
): Promise<{ clientName: string; contextParts: string[]; scheduledTasks: Array<{ id: string; label: string; type: string; frequency: string; lastStatus: string }> }> {
  const [client, clientAttachments, scheduledTasks] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, agencyId },
      select: {
        name: true, industry: true, brainContext: true,
        brandProfiles: { take: 1, orderBy: { createdAt: 'desc' }, select: { editedJson: true, extractedJson: true } },
      },
    }),
    prisma.clientBrainAttachment.findMany({
      where: { clientId, agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.scheduledTask.findMany({
      where: { agencyId, clientId, enabled: true },
      select: { id: true, label: true, type: true, frequency: true, lastStatus: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const parts: string[] = []

  if (client) {
    parts.push(`=== CLIENT ===`)
    parts.push(`Name: ${client.name}`)
    if (client.industry) parts.push(`Industry: ${client.industry}`)

    const brand = client.brandProfiles[0]
    const brandData = brand?.editedJson ?? brand?.extractedJson
    if (brandData) {
      const b = brandData as Record<string, unknown>
      if (b.positioning ?? b.value_proposition) parts.push(`Positioning: ${JSON.stringify(b.positioning ?? b.value_proposition)}`)
      if (b.target_audience ?? b.audience) parts.push(`Target Audience: ${JSON.stringify(b.target_audience ?? b.audience)}`)
      if (b.tone_of_voice ?? b.brand_voice) parts.push(`Brand Voice: ${JSON.stringify(b.tone_of_voice ?? b.brand_voice)}`)
    }
    if (client.brainContext?.trim()) parts.push(`\nClient Brain:\n${client.brainContext.trim()}`)
    if (clientAttachments.length > 0) {
      parts.push('\nClient Documents:')
      for (const doc of clientAttachments) {
        if (doc.summary?.trim()) parts.push(`[${doc.source}] ${doc.filename}:\n${doc.summary.trim()}`)
      }
    }
  }

  // Vertical brain
  if (verticalId) {
    const [vertical, verticalAttachments] = await Promise.all([
      prisma.vertical.findFirst({ where: { id: verticalId, agencyId }, select: { name: true, brainContext: true } }),
      prisma.verticalBrainAttachment.findMany({
        where: { verticalId, agencyId, summaryStatus: 'ready' },
        select: { filename: true, summary: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])
    if (vertical) {
      parts.push(`\n=== VERTICAL: ${vertical.name} ===`)
      if (vertical.brainContext?.trim()) parts.push(vertical.brainContext.trim())
      for (const doc of verticalAttachments) {
        if (doc.summary?.trim()) parts.push(`[vertical] ${doc.filename}:\n${doc.summary.trim()}`)
      }
    }
  }

  // Agency brain
  const [agency, agencyAttachments] = await Promise.all([
    prisma.agency.findFirst({ where: { id: agencyId }, select: { name: true, brainContext: true } }),
    prisma.agencyBrainAttachment.findMany({
      where: { agencyId, summaryStatus: 'ready' },
      select: { filename: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ])
  if (agency?.brainContext?.trim()) {
    parts.push(`\n=== AGENCY: ${agency.name} ===\n${agency.brainContext.trim()}`)
  }
  for (const doc of agencyAttachments) {
    if (doc.summary?.trim()) parts.push(`[agency] ${doc.filename}:\n${doc.summary.trim()}`)
  }

  return { clientName: client?.name ?? 'Unknown Client', contextParts: parts, scheduledTasks }
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  contextParts: string[],
  clientName: string,
  scheduledTasks: Array<{ id: string; label: string; type: string; frequency: string; lastStatus: string }>,
  pilotPhase: 'think' | 'build',
  currentProgram?: { type?: string; brief?: string | null; name?: string } | null,
): string {
  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : 'No brain context available yet — draw on what you learn from the conversation.'

  const taskList = scheduledTasks.length > 0
    ? scheduledTasks.map((t) => `- [id:${t.id}] "${t.label}" (${t.type}, ${t.frequency}, last: ${t.lastStatus})`).join('\n')
    : '(No research tasks set up yet — user may proceed without a research feed.)'

  const typeMenu = Object.entries(PROGRAM_TYPE_META)
    .filter(([k]) => !['competitive_intel', 'customer_story', 'event_content'].includes(k))
    .map(([key, m]) => `- **${key}** — ${m.label}: ${m.description}`)
    .join('\n')

  const phaseInstructions = pilotPhase === 'build'
    ? buildPhasePrompt(currentProgram)
    : thinkPhasePrompt()

  return `You are programsPILOT, the AI program marketing strategist built into ContentNode.

A Program is a standing marketing engagement — a defined strategy, a written brief, templates for every deliverable, and (for recurring types) a content cadence. You help agency teams build complete programs through a two-phase conversation.

## CLIENT CONTEXT:
${contextBlock}

## AVAILABLE RESEARCH TASKS (for linking to recurring programs):
${taskList}

## PROGRAM TYPES:
${typeMenu}

${phaseInstructions}

## RULES (both phases):
- One question per turn — never stack multiple questions
- 3–5 lines of sharp insight + one question + paths
- Use the client brain context to pre-populate specific names, angles, and keywords — never generic placeholders
- Short responses — quality over length

## PATHS (quick-reply buttons — always include after every response except final output blocks):
<PATHS>
["option 1", "option 2", "option 3"]
</PATHS>
Keep each option under 55 characters. Do NOT include PATHS alongside PROGRAM_BRIEF or PROGRAM_COMPLETE blocks.`
}

function thinkPhasePrompt(): string {
  return `## CURRENT PHASE: THINK (Phase 1 — Strategy)

Your job in this phase: understand what kind of program will actually move the needle for this client. Do NOT ask which program type they want — ask what problem they're trying to solve. The type follows from that.

### SESSION ARC:
**Orient** — Ask what's the content / marketing problem they're trying to solve right now. Is it visibility, pipeline, retention, enablement? One question.

**Explore** — Once you understand the goal, present 2–3 program directions that fit. Name the tradeoff of each in one line. Let the user choose.

**Deepen** — Ask the strategy questions specific to the chosen type (see below). One per turn.

**Confirm brief** — When you have goal, audience, message pillars, tone, competitive angle, and cadence/scope: produce the program brief and ask for confirmation.

**Output** — On confirmation, output the PROGRAM_BRIEF block and transition to Phase 2.

### STRATEGY QUESTIONS BY TYPE:
**All types:** goal → audience (role, company type, journey stage) → message pillars (2–3) → competitive angle → tone/voice

**Outbound sequences:** also ask: best value to offer a prospect at this stage | single outcome the ideal prospect is trying to achieve | most common objection at this stage | call opening style (for cold calling)

**Nurture / lead magnet:** also ask: trigger event that puts someone in this sequence | what must they believe before they're ready to buy | format for the lead magnet if applicable

**Content programs:** also ask: 3 content territories to own | any contrarian take the client should be known for | platforms and posting frequency

**ABM:** also ask: number of target accounts in scope | level of personalisation required

**Retention programs:** also ask: most important 30-day milestone (onboarding) | most common reason customers go quiet (re-engagement)

### PROGRAM BRIEF FORMAT:
When ready to produce the brief, output it in this markdown structure (filled with real specifics from the conversation):

<PROGRAM_BRIEF>
{
  "name": "Descriptive program name (6–10 words)",
  "type": "program_type_key",
  "executionModel": "recurring or one_time",
  "brief": "# [Program Name]\\n\\n## Goal\\n[1–2 sentences]\\n\\n## Target Audience\\n[specific]\\n\\n## Message Pillars\\n1. [pillar]\\n2. [pillar]\\n3. [pillar]\\n\\n## Tone & Voice\\n[description]\\n\\n## Competitive Angle\\n[what this client says that competitors can't credibly claim]\\n\\n## Cadence & Format\\n[for recurring: frequency + content mix; for one-time: scope]\\n\\n## What Success Looks Like\\n[specific, measurable]",
  "contentConfig": { /* type-specific config — see below */ },
  "cadence": "Weekly | Bi-weekly | Monthly | One-time",
  "scheduledTaskId": "task_id_or_null"
}
</PROGRAM_BRIEF>

contentConfig shapes by type:
- thought_leadership / seo_content / newsletter / social_media: { blogCount, platforms, generateImages, imageStyle, wordCountMin, wordCountMax, contentPillars }
- outbound sequences / cold_calling: { sequenceLength, targetPersona, primaryCTA, includeVoicemail, toneProfile }
- lead_magnet: { documentType, topicFocus, targetWordCount, includeLandingPage }
- webinar_event: { eventTopic, preEventEmails, postEventEmails, socialPosts }
- abm: { targetPersona, personalizationLevel, includeOnePager }
- onboarding / reengagement: { triggerEvent, milestoneCount, includeChecklist }
- partner / launch: { scope, channels, includeInternalAssets }

Use null (not "null") for scheduledTaskId when no task is linked.`
}

function buildPhasePrompt(program?: { type?: string; brief?: string | null; name?: string } | null): string {
  const typeMeta = program?.type ? PROGRAM_TYPE_META[program.type] : null
  const templateList = typeMeta
    ? typeMeta.templateItems.map((item, i) => `  ${i + 1}. ${item}`).join('\n')
    : '  (templates depend on program type)'

  return `## CURRENT PHASE: BUILD (Phase 2 — Template Creation)

The strategy is locked. Now you build the actual templates — every deliverable this program will use.

Program: "${program?.name ?? 'This program'}" (${program?.type ?? 'unknown type'})

Templates to build in order:
${templateList}

### HOW TO BUILD:
For each template:
1. Say "Let's write [Template Name]." — then produce the FULL template immediately. Don't ask permission first, don't give an outline — write the real thing.
2. Use everything from the brief: the specific audience, message pillars, tone, competitive angle. No placeholders. Real copy.
3. After presenting the template, ask: "Ready to move to the next one, or would you like to adjust anything?"
4. On approval or "next", move to the next template.
5. After ALL templates are built: output the PROGRAM_COMPLETE block.

### TEMPLATE QUALITY STANDARDS:
- Write AS IF you are a senior copywriter for this specific client
- Every template must reference the client's specific competitive angle, audience, and tone from the brief
- Outbound emails: subject line + opening line + body + CTA, not an outline
- Call scripts: actual words to say, not instructions
- Blog templates: headline formula + intro hook + H2 structure + CTA, not a description of what to write

### COMPLETION OUTPUT (after ALL templates confirmed):
<PROGRAM_COMPLETE>
{
  "pilotPhase": "complete",
  "setupComplete": true
}
</PROGRAM_COMPLETE>`
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function programRoutes(app: FastifyInstance) {

  // ── programsPILOT chat ───────────────────────────────────────────────────────
  app.post('/pilot', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = pilotBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { messages, clientId, verticalId, currentProgramId, pilotPhase } = parsed.data

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Load current program for Phase 2 context
    let currentProgram: { type?: string; brief?: string | null; name?: string } | null = null
    if (currentProgramId) {
      currentProgram = await prisma.program.findFirst({
        where: { id: currentProgramId, agencyId },
        select: { type: true, brief: true, name: true },
      })
    }

    const { clientName, contextParts, scheduledTasks } = await buildContext(agencyId, clientId, verticalId)
    const systemPrompt = buildSystemPrompt(contextParts, clientName, scheduledTasks, pilotPhase, currentProgram)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })

    const anthropicMessages: Anthropic.MessageParam[] = messages.length > 0
      ? messages.map((m) => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: `[Starting programsPILOT session — Client: ${clientName}]` }]

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      system:     systemPrompt,
      messages:   anthropicMessages,
    })

    const responseText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Parse <PROGRAM_BRIEF> block (Phase 1 → Phase 2 transition)
    const briefMatch = responseText.match(/<PROGRAM_BRIEF>([\s\S]+?)<\/PROGRAM_BRIEF>/i)
    let programRecord: Record<string, unknown> | null = null

    if (briefMatch) {
      try {
        const config = JSON.parse(briefMatch[1].trim()) as {
          name?: string; type?: string; executionModel?: string; brief?: string
          contentConfig?: Record<string, unknown>; cadence?: string; scheduledTaskId?: string | null
        }

        const resolvedType = PROGRAM_TYPES.includes(config.type as ProgramType) ? config.type! : 'thought_leadership'
        const executionModel = ONE_TIME_TYPES.has(resolvedType) ? 'one_time' : (config.executionModel ?? 'recurring')

        let resolvedTaskId: string | null = config.scheduledTaskId ?? null
        if (resolvedTaskId) {
          const task = await prisma.scheduledTask.findFirst({ where: { id: resolvedTaskId, agencyId } })
          if (!task) resolvedTaskId = null
        }

        const programData = {
          agencyId, clientId,
          ...(verticalId ? { verticalId } : {}),
          name:           (config.name ?? 'Untitled Program').trim(),
          type:           resolvedType,
          executionModel,
          brief:          config.brief ?? null,
          cadence:        config.cadence ?? null,
          scheduledTaskId: resolvedTaskId,
          contentConfig:  (config.contentConfig ?? {}) as never,
          pilotPhase:     'build',
          pilotMessages:  messages as never,
        }

        if (currentProgramId) {
          const existing = await prisma.program.findFirst({ where: { id: currentProgramId, agencyId } })
          if (existing) {
            programRecord = await prisma.program.update({
              where: { id: currentProgramId },
              data: programData,
            }) as Record<string, unknown>
          }
        } else {
          programRecord = await prisma.program.create({ data: programData }) as Record<string, unknown>
        }

        // Save brief to client brain so all other PILOTs can see it
        if (config.brief && programRecord) {
          const progId = (programRecord as { id: string }).id
          const briefFilename = `${(config.name ?? 'Program').trim()} — Program Brief`
          const storageKey = `programspilot/${clientId}/${progId}.md`
          const briefText = config.brief
          const existing = await prisma.clientBrainAttachment.findFirst({
            where: { agencyId, clientId, storageKey },
            select: { id: true },
          })
          if (existing) {
            await prisma.clientBrainAttachment.update({
              where: { id: existing.id },
              data: { summary: briefText, summaryStatus: 'ready', sizeBytes: Buffer.byteLength(briefText, 'utf8') },
            })
          } else {
            await prisma.clientBrainAttachment.create({
              data: {
                agencyId, clientId,
                filename:      briefFilename,
                storageKey,
                source:        'programspilot',
                summary:       briefText,
                summaryStatus: 'ready',
                sizeBytes:     Buffer.byteLength(briefText, 'utf8'),
              },
            })
          }
        }
      } catch { /* malformed — skip */ }
    }

    // Parse <PROGRAM_COMPLETE> block (Phase 2 completion)
    const completeMatch = responseText.match(/<PROGRAM_COMPLETE>([\s\S]+?)<\/PROGRAM_COMPLETE>/i)
    if (completeMatch && currentProgramId) {
      try {
        const prog = await prisma.program.findFirst({
          where: { id: currentProgramId, agencyId },
          select: { brief: true, name: true },
        })
        await prisma.program.update({
          where: { id: currentProgramId },
          data: { pilotPhase: 'complete', setupComplete: true, pilotMessages: messages as never },
        })
        // Update brain attachment to reflect templates are complete
        if (prog?.brief) {
          const storageKey = `programspilot/${clientId}/${currentProgramId}.md`
          const updatedBrief = `${prog.brief}\n\n---\n\n**Status:** All templates built and ready.`
          await prisma.clientBrainAttachment.updateMany({
            where: { agencyId, clientId, storageKey },
            data: { summary: updatedBrief, sizeBytes: Buffer.byteLength(updatedBrief, 'utf8') },
          })
        }
      } catch { /* ignore */ }
    }

    // Parse <PATHS> block
    const pathsMatch = responseText.match(/<PATHS>\s*([\s\S]+?)\s*<\/PATHS>/i)
    let paths: string[] = []
    if (pathsMatch) {
      try {
        const p = JSON.parse(pathsMatch[1].trim())
        if (Array.isArray(p)) paths = p.filter((x): x is string => typeof x === 'string')
      } catch { /* ignore */ }
    }

    const cleanResponse = responseText
      .replace(/<PROGRAM_BRIEF>[\s\S]*?<\/PROGRAM_BRIEF>/gi, '')
      .replace(/<PROGRAM_COMPLETE>[\s\S]*?<\/PROGRAM_COMPLETE>/gi, '')
      .replace(/<PATHS>[\s\S]*?<\/PATHS>/gi, '')
      .trim()

    return reply.send({ message: cleanResponse, paths, program: programRecord, phaseComplete: !!completeMatch })
  })

  // ── List programs ─────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, verticalId } = req.query as Record<string, string>

    const programs = await prisma.program.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
        ...(verticalId ? { verticalId } : {}),
      },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
        vertical:      { select: { id: true, name: true } },
        _count:        { select: { workflowRuns: true, contentPacks: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: programs, meta: { total: programs.length } })
  })

  // ── Get single program ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth

    const program = await prisma.program.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
        vertical:      { select: { id: true, name: true } },
        contentPacks: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { items: true } } },
        },
      },
    })

    if (!program) return reply.code(404).send({ error: 'Program not found' })
    return reply.send({ data: program })
  })

  // ── Create program ────────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createProgramBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { clientId, verticalId, name, type, scheduledTaskId, contentConfig, autoPublish, brief, cadence, pilotPhase, executionModel } = parsed.data

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    if (scheduledTaskId) {
      const task = await prisma.scheduledTask.findFirst({ where: { id: scheduledTaskId, agencyId } })
      if (!task) return reply.code(404).send({ error: 'Scheduled task not found' })
    }

    const resolvedExecModel = executionModel ?? (ONE_TIME_TYPES.has(type) ? 'one_time' : 'recurring')

    const program = await prisma.program.create({
      data: {
        agencyId, clientId,
        ...(verticalId ? { verticalId } : {}),
        name, type,
        executionModel: resolvedExecModel,
        scheduledTaskId: scheduledTaskId ?? null,
        contentConfig:  (contentConfig ?? {}) as never,
        autoPublish:    autoPublish ?? false,
        brief:          brief ?? null,
        cadence:        cadence ?? null,
        pilotPhase:     pilotPhase ?? 'setup',
      },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
        vertical:      { select: { id: true, name: true } },
      },
    })

    return reply.code(201).send({ data: program })
  })

  // ── Update program ────────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateProgramBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const existing = await prisma.program.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Program not found' })

    const { name, status, verticalId, scheduledTaskId, contentConfig, autoPublish, setupComplete, brief, cadence, pilotPhase, pilotMessages } = parsed.data

    if (scheduledTaskId) {
      const task = await prisma.scheduledTask.findFirst({ where: { id: scheduledTaskId, agencyId } })
      if (!task) return reply.code(404).send({ error: 'Scheduled task not found' })
    }

    const program = await prisma.program.update({
      where: { id: req.params.id },
      data: {
        ...(name            !== undefined ? { name }           : {}),
        ...(status          !== undefined ? { status }         : {}),
        ...(verticalId      !== undefined ? { verticalId }     : {}),
        ...(scheduledTaskId !== undefined ? { scheduledTaskId: scheduledTaskId ?? null } : {}),
        ...(contentConfig   !== undefined ? { contentConfig: contentConfig as never } : {}),
        ...(autoPublish     !== undefined ? { autoPublish }    : {}),
        ...(setupComplete   !== undefined ? { setupComplete }  : {}),
        ...(brief           !== undefined ? { brief, briefEditedAt: new Date() } : {}),
        ...(cadence         !== undefined ? { cadence }        : {}),
        ...(pilotPhase      !== undefined ? { pilotPhase }     : {}),
        ...(pilotMessages   !== undefined ? { pilotMessages: pilotMessages as never } : {}),
      },
      include: {
        scheduledTask: { select: { id: true, label: true, lastStatus: true, lastRunAt: true } },
        vertical:      { select: { id: true, name: true } },
      },
    })

    return reply.send({ data: program })
  })

  // ── Delete program ────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const existing = await prisma.program.findFirst({ where: { id: req.params.id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Program not found' })
    await prisma.program.delete({ where: { id: req.params.id } })
    return reply.code(204).send()
  })

  // ── Manually trigger a content pack cycle ────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/run', async (req, reply) => {
    const { agencyId } = req.auth

    const program = await prisma.program.findFirst({ where: { id: req.params.id, agencyId } })
    if (!program) return reply.code(404).send({ error: 'Program not found' })
    if (program.executionModel === 'one_time') {
      return reply.code(400).send({ error: 'One-time programs cannot be re-run' })
    }

    // Enqueue BullMQ job for manual cycle (same queue as scheduled research)
    const { getScheduledResearchQueue } = await import('../lib/queues.js')
    const queue = getScheduledResearchQueue()
    const job = await queue.add('manual-program-cycle', {
      agencyId,
      programId: program.id,
      clientId:  program.clientId,
      taskId:    program.scheduledTaskId ?? '',
      manual:    true,
    })

    return reply.send({ data: { jobId: job.id, message: 'Content pack generation queued' } })
  })

  // ── List content packs ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/packs', async (req, reply) => {
    const { agencyId } = req.auth

    const program = await prisma.program.findFirst({ where: { id: req.params.id, agencyId }, select: { id: true } })
    if (!program) return reply.code(404).send({ error: 'Program not found' })

    const packs = await prisma.programContentPack.findMany({
      where: { programId: program.id, agencyId },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return reply.send({ data: packs })
  })

  // ── Get content pack with items ───────────────────────────────────────────────
  app.get<{ Params: { id: string; packId: string } }>('/:id/packs/:packId', async (req, reply) => {
    const { agencyId } = req.auth

    const pack = await prisma.programContentPack.findFirst({
      where: { id: req.params.packId, programId: req.params.id, agencyId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })

    if (!pack) return reply.code(404).send({ error: 'Content pack not found' })
    return reply.send({ data: pack })
  })

  // ── Edit a content item ───────────────────────────────────────────────────────
  app.patch<{ Params: { id: string; packId: string; itemId: string } }>(
    '/:id/packs/:packId/items/:itemId',
    async (req, reply) => {
      const { agencyId } = req.auth
      const parsed = updateItemBody.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

      // Verify ownership through pack → program → agency
      const pack = await prisma.programContentPack.findFirst({
        where: { id: req.params.packId, programId: req.params.id, agencyId },
        select: { id: true },
      })
      if (!pack) return reply.code(404).send({ error: 'Content pack not found' })

      const item = await prisma.programContentItem.findFirst({
        where: { id: req.params.itemId, packId: pack.id },
      })
      if (!item) return reply.code(404).send({ error: 'Item not found' })

      const updated = await prisma.programContentItem.update({
        where: { id: item.id },
        data: { editedContent: parsed.data.editedContent },
      })

      return reply.send({ data: updated })
    },
  )
}
