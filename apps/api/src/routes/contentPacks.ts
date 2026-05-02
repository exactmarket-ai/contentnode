import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, getModelForRole } from '@contentnode/database'
import { getContentPackGenQueue, getThoughtLeaderSocialSyncQueue } from '../lib/queues.js'
import { callModel } from '@contentnode/ai'

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const createPackBody = z.object({
  clientId:    z.string().min(1),
  name:        z.string().min(1).max(200),
  description: z.string().max(500).nullish(),
})

const updatePackBody = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullish(),
})

const addItemBody = z.object({
  promptTemplateId: z.string().min(1),
  order:            z.number().int().min(0).default(0),
})

const reorderItemsBody = z.object({
  items: z.array(z.object({
    id:    z.string().min(1),
    order: z.number().int().min(0),
  })).min(1),
})

const generateBody = z.object({
  clientId:     z.string().min(1),
  topicId:      z.string().min(1),
  targetType:   z.enum(['member', 'vertical', 'company']),
  targetId:     z.string().optional(),
  packNames:    z.array(z.string()).default([]),
  checkedItems: z.array(z.object({
    promptTemplateId: z.string().min(1),
    promptName:       z.string().min(1),
  })).min(1),
})

// ─────────────────────────────────────────────────────────────────────────────
// Raw SQL result types — column names match migration.sql exactly
// ─────────────────────────────────────────────────────────────────────────────

type PackRow = {
  id: string; agency_id: string; client_id: string
  name: string; description: string | null
  created_at: Date; updated_at: Date
}

type ItemRow = {
  id: string; content_pack_id: string; prompt_template_id: string
  order: number; created_at: Date
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — items query (correct column names)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPackItems(packId: string) {
  return prisma.$queryRaw<Array<{
    id: string; content_pack_id: string; prompt_template_id: string
    order: number; created_at: Date
    pt_id: string | null; pt_name: string | null
    pt_description: string | null; pt_category: string | null
    usage_count: bigint
  }>>`
    SELECT
      cpi.id,
      cpi.content_pack_id,
      cpi.prompt_template_id,
      cpi."order",
      cpi.created_at,
      pt.id          AS pt_id,
      pt.name        AS pt_name,
      pt.description AS pt_description,
      pt.category    AS pt_category,
      (SELECT COUNT(*) FROM content_pack_items ci2
       WHERE ci2.prompt_template_id = cpi.prompt_template_id) AS usage_count
    FROM content_pack_items cpi
    LEFT JOIN prompt_templates pt ON pt.id = cpi.prompt_template_id
    WHERE cpi.content_pack_id = ${packId}
    ORDER BY cpi."order" ASC, cpi.created_at ASC
  `
}

function mapItem(item: {
  id: string; content_pack_id: string; prompt_template_id: string
  order: number; created_at: Date
  pt_id?: string | null; pt_name?: string | null
  pt_description?: string | null; pt_category?: string | null
  usage_count?: bigint
}) {
  return {
    id:                  item.id,
    packId:              item.content_pack_id,
    promptTemplateId:    item.prompt_template_id,
    promptName:          item.pt_name ?? '',
    promptCategory:      item.pt_category ?? '',
    promptDescription:   item.pt_description ?? null,
    order:               item.order,
    createdAt:           item.created_at,
    usageCount:          Number(item.usage_count ?? 0),
    promptTemplate:      item.pt_id ? {
      id:          item.pt_id,
      name:        item.pt_name,
      description: item.pt_description,
      category:    item.pt_category,
    } : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function contentPackRoutes(app: FastifyInstance) {

  // ── GET /?clientId= — list packs ──────────────────────────────────────────
  app.get<{ Querystring: { clientId?: string } }>('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    let packs: PackRow[] = []
    try {
      packs = await prisma.$queryRaw<PackRow[]>`
        SELECT id, agency_id, client_id, name, description, created_at, updated_at
        FROM content_packs
        WHERE agency_id = ${agencyId} AND client_id = ${clientId}
        ORDER BY created_at ASC
      `
    } catch { /* table not yet created */ }

    const packsWithItems = await Promise.all(packs.map(async (pack) => {
      let items: Awaited<ReturnType<typeof fetchPackItems>> = []
      try { items = await fetchPackItems(pack.id) } catch { /* table not yet created */ }
      return {
        id:          pack.id,
        agencyId:    pack.agency_id,
        clientId:    pack.client_id,
        name:        pack.name,
        description: pack.description,
        createdAt:   pack.created_at,
        updatedAt:   pack.updated_at,
        itemCount:   items.length,
        items:       items.map(mapItem),
      }
    }))

    return reply.send({ data: packsWithItems })
  })

  // ── POST / — create pack ──────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = createPackBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const id = crypto.randomUUID()
    const now = new Date()
    const { name, description, clientId } = parsed.data

    await prisma.$executeRaw`
      INSERT INTO content_packs (id, agency_id, client_id, name, description, created_at, updated_at)
      VALUES (${id}, ${agencyId}, ${clientId}, ${name}, ${description ?? null}, ${now}, ${now})
    `

    return reply.code(201).send({
      data: { id, agencyId, clientId, name, description: description ?? null, createdAt: now, updatedAt: now, itemCount: 0, items: [] },
    })
  })

  // ── PATCH /:id — update name/description ──────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updatePackBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const [existing] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!existing) return reply.code(404).send({ error: 'Content pack not found' })

    const now = new Date()
    if (parsed.data.name !== undefined) {
      await prisma.$executeRaw`
        UPDATE content_packs SET name = ${parsed.data.name}, updated_at = ${now} WHERE id = ${req.params.id}
      `
    }
    if (parsed.data.description !== undefined) {
      await prisma.$executeRaw`
        UPDATE content_packs SET description = ${parsed.data.description}, updated_at = ${now} WHERE id = ${req.params.id}
      `
    }

    const [updated] = await prisma.$queryRaw<PackRow[]>`
      SELECT id, agency_id, client_id, name, description, created_at, updated_at
      FROM content_packs WHERE id = ${req.params.id}
    `
    return reply.send({ data: {
      id: updated.id, agencyId: updated.agency_id, clientId: updated.client_id,
      name: updated.name, description: updated.description,
      createdAt: updated.created_at, updatedAt: updated.updated_at,
    }})
  })

  // ── DELETE /:id — delete pack ──────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const [existing] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!existing) return reply.code(404).send({ error: 'Content pack not found' })

    // FK cascade handles items, but be explicit
    await prisma.$executeRaw`DELETE FROM content_pack_items WHERE content_pack_id = ${req.params.id}`
    await prisma.$executeRaw`DELETE FROM content_packs WHERE id = ${req.params.id}`
    return reply.code(204).send()
  })

  // ── GET /:id/items ─────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/items', async (req, reply) => {
    const { agencyId } = req.auth
    const [pack] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!pack) return reply.code(404).send({ error: 'Content pack not found' })

    let items: Awaited<ReturnType<typeof fetchPackItems>> = []
    try { items = await fetchPackItems(req.params.id) } catch { /* table not yet created */ }

    return reply.send({ data: items.map(mapItem) })
  })

  // ── POST /:id/items — add item ─────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/:id/items', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = addItemBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const [pack] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!pack) return reply.code(404).send({ error: 'Content pack not found' })

    const template = await prisma.promptTemplate.findFirst({
      where: { id: parsed.data.promptTemplateId, agencyId, deletedAt: null },
      select: { id: true },
    })
    if (!template) return reply.code(404).send({ error: 'Prompt template not found' })

    const id = crypto.randomUUID()
    const now = new Date()
    await prisma.$executeRaw`
      INSERT INTO content_pack_items (id, content_pack_id, prompt_template_id, "order", created_at)
      VALUES (${id}, ${req.params.id}, ${parsed.data.promptTemplateId}, ${parsed.data.order}, ${now})
    `

    const [item] = await prisma.$queryRaw<Array<ItemRow & { usage_count: bigint }>>`
      SELECT cpi.id, cpi.content_pack_id, cpi.prompt_template_id, cpi."order", cpi.created_at,
        (SELECT COUNT(*) FROM content_pack_items ci2 WHERE ci2.prompt_template_id = cpi.prompt_template_id) AS usage_count
      FROM content_pack_items cpi WHERE cpi.id = ${id}
    `

    return reply.code(201).send({ data: mapItem(item) })
  })

  // ── DELETE /:id/items/:itemId ──────────────────────────────────────────────
  app.delete<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', async (req, reply) => {
    const { agencyId } = req.auth
    const [pack] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!pack) return reply.code(404).send({ error: 'Content pack not found' })

    const [item] = await prisma.$queryRaw<ItemRow[]>`
      SELECT id FROM content_pack_items WHERE id = ${req.params.itemId} AND content_pack_id = ${req.params.id}
    `
    if (!item) return reply.code(404).send({ error: 'Item not found' })

    await prisma.$executeRaw`DELETE FROM content_pack_items WHERE id = ${req.params.itemId}`
    return reply.code(204).send()
  })

  // ── PATCH /:id/items/reorder ───────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/items/reorder', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = reorderItemsBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const [pack] = await prisma.$queryRaw<PackRow[]>`
      SELECT id FROM content_packs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
    `
    if (!pack) return reply.code(404).send({ error: 'Content pack not found' })

    await Promise.all(parsed.data.items.map((item) =>
      prisma.$executeRaw`
        UPDATE content_pack_items SET "order" = ${item.order}
        WHERE id = ${item.id} AND content_pack_id = ${req.params.id}
      `,
    ))
    return reply.send({ data: { ok: true } })
  })

  // ── GET /runs?clientId= — list content pack runs ───────────────────────────
  app.get<{ Querystring: { clientId?: string; status?: string } }>('/runs', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, status } = req.query
    if (!clientId) return reply.code(400).send({ error: 'clientId is required' })

    let runs: Array<{
      id: string; topic_title: string; target_type: string; target_name: string
      pack_names: unknown; status: string; review_status: string
      created_at: Date; completed_at: Date | null
    }> = []
    try {
      if (status) {
        runs = await prisma.$queryRaw`
          SELECT id, topic_title, target_type, target_name, pack_names, status, review_status, created_at, completed_at
          FROM content_pack_runs
          WHERE agency_id = ${agencyId} AND client_id = ${clientId} AND status = ${status}
          ORDER BY created_at DESC LIMIT 100
        `
      } else {
        runs = await prisma.$queryRaw`
          SELECT id, topic_title, target_type, target_name, pack_names, status, review_status, created_at, completed_at
          FROM content_pack_runs
          WHERE agency_id = ${agencyId} AND client_id = ${clientId}
          ORDER BY created_at DESC LIMIT 100
        `
      }
    } catch { /* table not yet created */ }

    return reply.send({ data: runs.map((r) => ({
      id:          r.id,
      topicTitle:  r.topic_title,
      targetType:  r.target_type,
      targetName:  r.target_name,
      packNames:   r.pack_names,
      status:      r.status,
      reviewStatus: r.review_status,
      createdAt:   r.created_at,
      completedAt: r.completed_at,
    })) })
  })

  // ── GET /runs/:id — run detail with items ──────────────────────────────────
  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const { agencyId } = req.auth
    let run: Array<{
      id: string; topic_title: string; topic_summary: string | null
      target_type: string; target_id: string | null; target_name: string
      pack_ids: unknown; pack_names: unknown; status: string; review_status: string
      error_message: string | null; created_at: Date; completed_at: Date | null
    }> = []
    try {
      run = await prisma.$queryRaw`
        SELECT id, topic_title, topic_summary, target_type, target_id, target_name,
               pack_ids, pack_names, status, review_status, error_message, created_at, completed_at
        FROM content_pack_runs WHERE id = ${req.params.id} AND agency_id = ${agencyId}
      `
    } catch { /* table not yet created */ }

    if (!run[0]) return reply.code(404).send({ error: 'Run not found' })

    let items: Array<{
      id: string; prompt_name: string; status: string
      content: string | null; error_message: string | null; completed_at: Date | null
    }> = []
    try {
      items = await prisma.$queryRaw`
        SELECT id, prompt_name, status, content, error_message, completed_at
        FROM content_pack_run_items WHERE run_id = ${req.params.id}
        ORDER BY created_at ASC
      `
    } catch { /* table not yet created */ }

    const r = run[0]
    return reply.send({ data: {
      id:           r.id, topicTitle: r.topic_title, topicSummary: r.topic_summary,
      targetType:   r.target_type, targetId: r.target_id, targetName: r.target_name,
      packIds:      r.pack_ids, packNames: r.pack_names,
      status:       r.status, reviewStatus: r.review_status,
      errorMessage: r.error_message, createdAt: r.created_at, completedAt: r.completed_at,
      items: items.map((i) => ({
        id: i.id, promptName: i.prompt_name, status: i.status,
        content: i.content, errorMessage: i.error_message, completedAt: i.completed_at,
      })),
    }})
  })

  // ── PATCH /runs/:id/stage — update review_status ───────────────────────────
  app.patch<{ Params: { id: string }; Body: { reviewStatus: string } }>('/runs/:id/stage', async (req, reply) => {
    const { agencyId } = req.auth
    const { reviewStatus } = req.body
    const valid = ['none', 'pending', 'approved', 'closed']
    if (!valid.includes(reviewStatus)) return reply.code(400).send({ error: 'Invalid reviewStatus' })

    try {
      await prisma.$executeRaw`
        UPDATE content_pack_runs SET review_status = ${reviewStatus}, updated_at = NOW()
        WHERE id = ${req.params.id} AND agency_id = ${agencyId}
      `
    } catch { /* table not yet created */ }

    // Capture edit signal when a member-targeted run is approved
    if (reviewStatus === 'approved') {
      captureEditSignal(agencyId, req.params.id).catch((err) => {
        console.error(`[content-packs] edit signal capture failed for run ${req.params.id}:`, err)
      })
    }

    return reply.send({ data: { ok: true } })
  })

  // ── POST /generate — trigger content generation ───────────────────────────
  app.post('/generate', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = generateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const { clientId, topicId, targetType, targetId, packNames, checkedItems } = parsed.data

    if (targetType !== 'company' && !targetId) {
      return reply.code(400).send({ error: 'targetId is required when targetType is member or vertical' })
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Look up topic
    const topicRows = await prisma.$queryRaw<Array<{
      id: string; title: string; summary: string; sources: unknown; vertical_id: string | null
    }>>`
      SELECT id, title, summary, sources, vertical_id FROM topic_queue
      WHERE id = ${topicId} AND agency_id = ${agencyId} AND client_id = ${clientId}
    `
    if (!topicRows[0]) return reply.code(404).send({ error: 'Topic not found' })
    const topic = topicRows[0]

    // Look up target name
    let targetName = 'Company'
    if (targetType === 'member' && targetId) {
      const m = await prisma.leadershipMember.findFirst({ where: { id: targetId, agencyId }, select: { name: true } })
      if (!m) return reply.code(404).send({ error: 'Leadership member not found' })
      targetName = m.name
    } else if (targetType === 'vertical' && targetId) {
      const v = await prisma.vertical.findFirst({ where: { id: targetId, agencyId }, select: { name: true } })
      if (!v) return reply.code(404).send({ error: 'Vertical not found' })
      targetName = v.name
    } else if (targetType === 'company') {
      targetName = client.name
    }

    // Create ContentPackRun
    const runId = crypto.randomUUID()
    const now = new Date()
    const packNamesJson = JSON.stringify(packNames)

    await prisma.$executeRaw`
      INSERT INTO content_pack_runs
        (id, agency_id, client_id, topic_id, topic_title, topic_summary, target_type, target_id, target_name, pack_names, status, created_at, updated_at)
      VALUES
        (${runId}, ${agencyId}, ${clientId}, ${topicId}, ${topic.title}, ${topic.summary}, ${targetType},
         ${targetId ?? null}, ${targetName}, ${packNamesJson}::jsonb, 'pending', ${now}, ${now})
    `

    // Create items + enqueue
    const queue = getContentPackGenQueue()
    await Promise.all(checkedItems.map(async (item, index) => {
      const itemId = crypto.randomUUID()
      await prisma.$executeRaw`
        INSERT INTO content_pack_run_items (id, run_id, prompt_template_id, prompt_name, status, created_at)
        VALUES (${itemId}, ${runId}, ${item.promptTemplateId}, ${item.promptName}, 'pending', ${now})
      `
      await queue.add('generate-item', {
        agencyId, clientId, runId, itemId,
        promptTemplateId: item.promptTemplateId,
        promptName:       item.promptName,
        topicId,
        topicTitle:   topic.title,
        topicSummary: topic.summary,
        targetType,
        targetId:   targetId ?? null,
        targetName,
      }, {
        removeOnComplete: { count: 20 },
        removeOnFail:     { count: 20 },
        delay: index * 200, // small stagger to avoid race on status checks
      })
    }))

    return reply.code(201).send({ data: { runId } })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit signal capture — fired async on stage → approved for member runs
// ─────────────────────────────────────────────────────────────────────────────

async function captureEditSignal(agencyId: string, runId: string): Promise<void> {
  // Load run metadata
  const runRows = await prisma.$queryRaw<Array<{
    target_type: string; target_id: string | null; client_id: string; topic_title: string;
  }>>`
    SELECT target_type, target_id, client_id, topic_title
    FROM content_pack_runs
    WHERE id = ${runId} AND agency_id = ${agencyId}
    LIMIT 1
  `
  const run = runRows[0]
  if (!run || run.target_type !== 'member' || !run.target_id) return

  // Find items where content was edited (content differs from original_content)
  const editedItems = await prisma.$queryRaw<Array<{
    id: string; prompt_name: string; content: string | null; original_content: string | null;
  }>>`
    SELECT id, prompt_name, content, original_content
    FROM content_pack_run_items
    WHERE run_id = ${runId}
      AND status = 'completed'
      AND original_content IS NOT NULL
      AND content IS DISTINCT FROM original_content
  `

  if (!editedItems.length) return

  for (const item of editedItems) {
    const original = (item.original_content ?? '').trim()
    const approved = (item.content ?? '').trim()
    if (!original || !approved) continue

    // Summarize the diff with a small Claude call (non-fatal)
    let keyDifferences = ''
    try {
      const diffModel = await getModelForRole('generation_fast')
      const diffResult = await callModel(
        { provider: 'anthropic', model: diffModel, api_key_ref: 'ANTHROPIC_API_KEY', max_tokens: 100, temperature: 0 },
        `Compare these two versions of content for the same thought leader. Write ONE sentence describing what changed and why it matters for capturing their authentic voice.

GENERATED:
${original.slice(0, 500)}

APPROVED:
${approved.slice(0, 500)}

One sentence:`,
      )
      keyDifferences = diffResult.text.trim()
    } catch {
      // Non-fatal — omit the diff line
    }

    const signalContent = [
      `EDIT SIGNAL`,
      ``,
      `Date: ${new Date().toISOString().split('T')[0]}`,
      `Prompt type: ${item.prompt_name}`,
      `Topic: ${run.topic_title}`,
      ``,
      `What was generated:`,
      original.slice(0, 500),
      ``,
      `What was approved:`,
      approved.slice(0, 500),
      keyDifferences ? `\nKey differences: ${keyDifferences}` : '',
    ].join('\n')

    await prisma.$executeRaw`
      INSERT INTO thought_leader_brain_attachments
        (id, agency_id, client_id, leadership_member_id, source, content, metadata, created_at)
      VALUES (
        ${crypto.randomUUID()},
        ${agencyId},
        ${run.client_id},
        ${run.target_id},
        'edit_signal',
        ${signalContent},
        ${JSON.stringify({ contentPackRunId: runId, itemId: item.id })}::jsonb,
        NOW()
      )
    `
    console.log(`[content-packs] edit signal written for member ${run.target_id} item ${item.id}`)
  }

  // Trigger synthesis after all edit signals are written
  if (editedItems.length > 0) {
    try {
      const queue = getThoughtLeaderSocialSyncQueue()
      await queue.add('synthesize-after-edit', {
        agencyId,
        leadershipMemberId: run.target_id,
        synthesizeOnly: true,
      }, {
        removeOnComplete: { count: 10 },
        removeOnFail:     { count: 10 },
      })
    } catch (err) {
      console.error(`[content-packs] synthesis queue failed for member ${run.target_id}:`, err)
    }
  }
}
