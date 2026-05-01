import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'
import { getContentLibraryEditSignalQueue } from '../lib/queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type LibraryItemRow = {
  id: string
  prompt_name: string
  content: string | null
  publish_status: string
  word_count: number | null
  created_at: Date
  topic_title: string
  topic_queue_id: string | null
  assigned_to_type: string
  assigned_to_id: string | null
  assigned_to: string
  content_pack_run_id: string
}

type CountRow = { total: bigint }

// ─────────────────────────────────────────────────────────────────────────────
// Route plugin
// ─────────────────────────────────────────────────────────────────────────────

export async function contentLibraryRoutes(app: FastifyInstance) {

  // ── GET /:clientId — paginated list ───────────────────────────────────────
  app.get<{ Params: { clientId: string } }>('/:clientId', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params
    const q = req.query as Record<string, string>

    const search        = q.search?.trim()       || null
    const contentType   = q.contentType?.trim()  || null
    const assignedToType = q.assignedToType?.trim() || null
    const assignedToId  = q.assignedToId?.trim() || null
    const statusFilter  = q.status?.trim()       || null
    const dateFrom      = q.dateFrom?.trim()     || null
    const dateTo        = q.dateTo?.trim()       || null
    const page          = Math.max(1, parseInt(q.page  ?? '1',  10) || 1)
    const limit         = Math.min(50, Math.max(1, parseInt(q.limit ?? '24', 10) || 24))
    const offset        = (page - 1) * limit

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Build WHERE clauses dynamically using raw SQL
    // We always scope to completed items for this agency/client
    const conditions: string[] = [
      `r.agency_id = '${agencyId.replace(/'/g, "''")}'`,
      `r.client_id = '${clientId.replace(/'/g, "''")}'`,
      `i.status = 'completed'`,
    ]

    if (statusFilter && ['draft', 'approved', 'archived'].includes(statusFilter)) {
      conditions.push(`i.publish_status = '${statusFilter}'`)
    } else {
      // Default: exclude archived
      conditions.push(`i.publish_status != 'archived'`)
    }

    if (contentType) conditions.push(`i.prompt_name ILIKE '%${contentType.replace(/'/g, "''").replace(/%/g, '\\%')}%'`)
    if (assignedToType) conditions.push(`r.target_type = '${assignedToType.replace(/'/g, "''")}'`)
    if (assignedToId)   conditions.push(`r.target_id = '${assignedToId.replace(/'/g, "''")}'`)
    if (dateFrom) conditions.push(`i.created_at >= '${dateFrom}'::timestamptz`)
    if (dateTo)   conditions.push(`i.created_at <= '${dateTo}'::timestamptz + interval '1 day'`)

    if (search) {
      const s = search.replace(/'/g, "''").replace(/%/g, '\\%')
      conditions.push(`(i.prompt_name ILIKE '%${s}%' OR r.topic_title ILIKE '%${s}%' OR r.target_name ILIKE '%${s}%' OR i.content ILIKE '%${s}%')`)
    }

    const where = conditions.join(' AND ')

    const [items, countResult] = await Promise.all([
      prisma.$queryRawUnsafe<LibraryItemRow[]>(`
        SELECT
          i.id,
          i.prompt_name,
          LEFT(i.content, 300) AS content,
          i.publish_status,
          i.word_count,
          i.created_at,
          r.topic_title,
          r.topic_id   AS topic_queue_id,
          r.target_type AS assigned_to_type,
          r.target_id   AS assigned_to_id,
          r.target_name AS assigned_to,
          r.id          AS content_pack_run_id
        FROM content_pack_run_items i
        JOIN content_pack_runs r ON r.id = i.run_id
        WHERE ${where}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      prisma.$queryRawUnsafe<CountRow[]>(`
        SELECT COUNT(*) AS total
        FROM content_pack_run_items i
        JOIN content_pack_runs r ON r.id = i.run_id
        WHERE ${where}
      `),
    ])

    const total = Number(countResult[0]?.total ?? 0)

    return reply.send({
      data: items.map((i) => ({
        id:               i.id,
        contentType:      i.prompt_name,
        content:          i.content,
        publishStatus:    i.publish_status,
        wordCount:        i.word_count,
        createdAt:        i.created_at,
        topicTitle:       i.topic_title,
        topicQueueId:     i.topic_queue_id,
        assignedToType:   i.assigned_to_type,
        assignedToId:     i.assigned_to_id,
        assignedTo:       i.assigned_to,
        contentPackRunId: i.content_pack_run_id,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  })

  // ── GET /:clientId/content-types — distinct prompt names for filters ───────
  app.get<{ Params: { clientId: string } }>('/:clientId/content-types', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const rows = await prisma.$queryRawUnsafe<Array<{ prompt_name: string }>>(
      `SELECT DISTINCT i.prompt_name
       FROM content_pack_run_items i
       JOIN content_pack_runs r ON r.id = i.run_id
       WHERE r.agency_id = '${agencyId.replace(/'/g, "''")}' AND r.client_id = '${clientId.replace(/'/g, "''")}' AND i.status = 'completed'
       ORDER BY i.prompt_name`,
    )

    return reply.send({ data: rows.map((r) => r.prompt_name) })
  })

  // ── GET /:clientId/assignees — distinct assignees for filters ─────────────
  app.get<{ Params: { clientId: string } }>('/:clientId/assignees', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.params

    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const rows = await prisma.$queryRawUnsafe<Array<{ target_type: string; target_id: string | null; target_name: string }>>(
      `SELECT DISTINCT r.target_type, r.target_id, r.target_name
       FROM content_pack_runs r
       WHERE r.agency_id = '${agencyId.replace(/'/g, "''")}' AND r.client_id = '${clientId.replace(/'/g, "''")}' AND r.status = 'completed'
       ORDER BY r.target_name`,
    )

    return reply.send({
      data: rows.map((r) => ({
        type: r.target_type,
        id:   r.target_id,
        name: r.target_name,
      })),
    })
  })

  // ── GET /:clientId/:id — full item ─────────────────────────────────────────
  app.get<{ Params: { clientId: string; id: string } }>('/:clientId/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params

    const rows = await prisma.$queryRawUnsafe<LibraryItemRow[]>(`
      SELECT
        i.id,
        i.prompt_name,
        i.content,
        i.publish_status,
        i.word_count,
        i.created_at,
        r.topic_title,
        r.topic_id   AS topic_queue_id,
        r.target_type AS assigned_to_type,
        r.target_id   AS assigned_to_id,
        r.target_name AS assigned_to,
        r.id          AS content_pack_run_id
      FROM content_pack_run_items i
      JOIN content_pack_runs r ON r.id = i.run_id
      WHERE i.id = '${id.replace(/'/g, "''")}' AND r.agency_id = '${agencyId.replace(/'/g, "''")}' AND r.client_id = '${clientId.replace(/'/g, "''")}'
    `)

    if (!rows[0]) return reply.code(404).send({ error: 'Item not found' })
    const i = rows[0]

    return reply.send({
      data: {
        id:               i.id,
        contentType:      i.prompt_name,
        content:          i.content,
        publishStatus:    i.publish_status,
        wordCount:        i.word_count,
        createdAt:        i.created_at,
        topicTitle:       i.topic_title,
        topicQueueId:     i.topic_queue_id,
        assignedToType:   i.assigned_to_type,
        assignedToId:     i.assigned_to_id,
        assignedTo:       i.assigned_to,
        contentPackRunId: i.content_pack_run_id,
      },
    })
  })

  // ── PATCH /:clientId/:id/content — save edited content before approval ──────
  app.patch<{ Params: { clientId: string; id: string }; Body: { content: string } }>('/:clientId/:id/content', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params
    const { content } = req.body

    if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' })
    }

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT i.id FROM content_pack_run_items i
      JOIN content_pack_runs r ON r.id = i.run_id
      WHERE i.id = ${id} AND r.agency_id = ${agencyId} AND r.client_id = ${clientId}
      LIMIT 1
    `
    if (!rows[0]) return reply.code(404).send({ error: 'Item not found' })

    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    await prisma.$executeRaw`
      UPDATE content_pack_run_items
      SET content = ${content}, word_count = ${wordCount}
      WHERE id = ${id}
    `

    return reply.send({ data: { ok: true } })
  })

  // ── PATCH /:clientId/:id/status — update publish status ───────────────────
  app.patch<{ Params: { clientId: string; id: string }; Body: { publishStatus: string } }>('/:clientId/:id/status', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, id } = req.params
    const { publishStatus } = req.body

    if (!['draft', 'approved', 'archived'].includes(publishStatus)) {
      return reply.code(400).send({ error: 'publishStatus must be draft | approved | archived' })
    }

    // Fetch current item + run data before update (needed for edit signal capture)
    type ItemRow = {
      id: string
      content: string | null
      original_content: string | null
      publish_status: string
      prompt_name: string
      target_type: string
      target_id: string | null
    }
    const existing = await prisma.$queryRawUnsafe<ItemRow[]>(
      `SELECT i.id, i.content, i.original_content, i.publish_status, i.prompt_name,
              r.target_type, r.target_id
       FROM content_pack_run_items i
       JOIN content_pack_runs r ON r.id = i.run_id
       WHERE i.id = '${id.replace(/'/g, "''")}' AND r.agency_id = '${agencyId.replace(/'/g, "''")}' AND r.client_id = '${clientId.replace(/'/g, "''")}'`,
    )
    if (!existing[0]) return reply.code(404).send({ error: 'Item not found' })

    await prisma.$executeRawUnsafe(
      `UPDATE content_pack_run_items SET publish_status = '${publishStatus}' WHERE id = '${id.replace(/'/g, "''")}'`,
    )

    // Capture edit signal when transitioning to approved with edited content
    const item = existing[0]
    if (
      publishStatus === 'approved' &&
      item.publish_status !== 'approved' &&
      item.content &&
      item.original_content &&
      item.content.trim() !== item.original_content.trim()
    ) {
      try {
        const queue = getContentLibraryEditSignalQueue()
        await queue.add(
          `edit-signal-${id}`,
          {
            agencyId,
            clientId,
            itemId:          id,
            promptName:      item.prompt_name,
            targetType:      item.target_type,
            targetId:        item.target_id,
            content:         item.content,
            originalContent: item.original_content,
          },
          { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } },
        )
      } catch (err) {
        // Non-fatal — approval succeeds even if signal capture fails
        req.log.warn({ err, itemId: id }, 'edit signal enqueue failed')
      }
    }

    return reply.send({ data: { ok: true, publishStatus } })
  })
}
