/**
 * deliverables.ts
 * Agency-wide deliverables board — visible to Manager+ roles only.
 *
 * GET  /api/v1/deliverables        — list with search/filter/sort
 * PATCH /api/v1/deliverables/:id   — update any deliverable field
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

const MANAGER_PLUS = ['owner', 'admin', 'editor', 'manager']

const updateBody = z.object({
  priority:           z.string().nullable().optional(),
  internalNotes:      z.string().nullable().optional(),
  statusExternal:     z.string().nullable().optional(),
  followupStatus:     z.string().nullable().optional(),
  mainClientName:     z.string().nullable().optional(),
  otherStakeholders:  z.string().nullable().optional(),
  teamDesign:         z.string().nullable().optional(),
  teamContent:        z.string().nullable().optional(),
  teamVideo:          z.string().nullable().optional(),
  sowNumber:          z.string().nullable().optional(),
  budgetMs:           z.number().nullable().optional(),
  mainCategory:       z.string().nullable().optional(),
  focus:              z.string().nullable().optional(),
  clientFolderBox:    z.string().nullable().optional(),
  clientFolderClient: z.string().nullable().optional(),
  assigneeId:         z.string().nullable().optional(),
  dueDate:            z.string().datetime().nullable().optional(),
  reviewStatus:       z.string().nullable().optional(),
  itemName:           z.string().nullable().optional(),
})

const SELECT = {
  id:                 true,
  itemName:           true,
  reviewStatus:       true,
  status:             true,
  priority:           true,
  internalNotes:      true,
  statusExternal:     true,
  followupStatus:     true,
  mainClientName:     true,
  otherStakeholders:  true,
  teamDesign:         true,
  teamContent:        true,
  teamVideo:          true,
  sowNumber:          true,
  budgetMs:           true,
  mainCategory:       true,
  focus:              true,
  clientFolderBox:    true,
  clientFolderClient: true,
  dueDate:            true,
  createdAt:          true,
  updatedAt:          true,
  assigneeId:         true,
  assignee:           { select: { id: true, name: true, avatarStorageKey: true } },
  workflow: {
    select: {
      id:     true,
      name:   true,
      client: { select: { id: true, name: true } },
    },
  },
}

export async function deliverablesRoutes(app: FastifyInstance) {
  // GET — list with search / filter / sort
  app.get('/', { preHandler: requireRole(...MANAGER_PLUS) }, async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as {
      q?: string
      clientId?: string
      stage?: string
      priority?: string
      assigneeId?: string
      quarter?: string
      sort?: string
      order?: string
      limit?: string
      offset?: string
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      agencyId,
      createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    }

    if (q.clientId)   where.workflow = { clientId: q.clientId }
    if (q.stage)      where.reviewStatus = q.stage
    if (q.priority)   where.priority = q.priority
    if (q.assigneeId) where.assigneeId = q.assigneeId

    // Quarter filter — derive from createdAt
    if (q.quarter) {
      const [qNum, year] = q.quarter.split(' ') // "Q2 2026"
      const qIdx = parseInt(qNum.slice(1)) - 1
      const yr   = parseInt(year)
      const startMonth = qIdx * 3
      const start = new Date(yr, startMonth, 1)
      const end   = new Date(yr, startMonth + 3, 1)
      where.createdAt = { gte: start, lt: end }
    }

    // Full-text search across key text fields
    if (q.q && q.q.trim()) {
      const term = q.q.trim()
      where.OR = [
        { itemName:          { contains: term, mode: 'insensitive' } },
        { internalNotes:     { contains: term, mode: 'insensitive' } },
        { statusExternal:    { contains: term, mode: 'insensitive' } },
        { mainClientName:    { contains: term, mode: 'insensitive' } },
        { otherStakeholders: { contains: term, mode: 'insensitive' } },
        { sowNumber:         { contains: term, mode: 'insensitive' } },
        { mainCategory:      { contains: term, mode: 'insensitive' } },
        { focus:             { contains: term, mode: 'insensitive' } },
        { teamDesign:        { contains: term, mode: 'insensitive' } },
        { teamContent:       { contains: term, mode: 'insensitive' } },
        { teamVideo:         { contains: term, mode: 'insensitive' } },
        { workflow: { name:  { contains: term, mode: 'insensitive' } } },
        { workflow: { client: { name: { contains: term, mode: 'insensitive' } } } },
        { assignee: { name:  { contains: term, mode: 'insensitive' } } },
      ]
    }

    const SORT_MAP: Record<string, object> = {
      client:    { workflow: { client: { name: q.order === 'asc' ? 'asc' : 'desc' } } },
      project:   { workflow: { name: q.order === 'asc' ? 'asc' : 'desc' } },
      stage:     { reviewStatus: q.order === 'asc' ? 'asc' : 'desc' },
      priority:  { priority: q.order === 'asc' ? 'asc' : 'desc' },
      dueDate:   { dueDate: q.order === 'asc' ? 'asc' : 'desc' },
      updatedAt: { updatedAt: q.order === 'asc' ? 'asc' : 'desc' },
      budget:    { budgetMs: q.order === 'asc' ? 'asc' : 'desc' },
      sow:       { sowNumber: q.order === 'asc' ? 'asc' : 'desc' },
    }
    const orderBy = SORT_MAP[q.sort ?? ''] ?? { updatedAt: 'desc' }

    const limit  = Math.min(parseInt(q.limit  ?? '500'), 500)
    const offset = parseInt(q.offset ?? '0')

    const [runs, total, clients, members] = await Promise.all([
      prisma.workflowRun.findMany({ where, select: SELECT, orderBy, take: limit, skip: offset }),
      prisma.workflowRun.count({ where }),
      prisma.client.findMany({ where: { agencyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ where: { agencyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return reply.send({ data: { runs, total, clients, members } })
  })

  // PATCH — update a single deliverable's fields
  app.patch<{ Params: { id: string } }>('/:id', { preHandler: requireRole(...MANAGER_PLUS) }, async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const run = await prisma.workflowRun.findFirst({ where: { id: req.params.id, agencyId } })
    if (!run) return reply.code(404).send({ error: 'Not found' })

    const d = parsed.data
    const updated = await prisma.workflowRun.update({
      where: { id: req.params.id },
      data: {
        ...(d.priority           !== undefined ? { priority:           d.priority }           : {}),
        ...(d.internalNotes      !== undefined ? { internalNotes:      d.internalNotes }      : {}),
        ...(d.statusExternal     !== undefined ? { statusExternal:     d.statusExternal }     : {}),
        ...(d.followupStatus     !== undefined ? { followupStatus:     d.followupStatus }     : {}),
        ...(d.mainClientName     !== undefined ? { mainClientName:     d.mainClientName }     : {}),
        ...(d.otherStakeholders  !== undefined ? { otherStakeholders:  d.otherStakeholders }  : {}),
        ...(d.teamDesign         !== undefined ? { teamDesign:         d.teamDesign }         : {}),
        ...(d.teamContent        !== undefined ? { teamContent:        d.teamContent }        : {}),
        ...(d.teamVideo          !== undefined ? { teamVideo:          d.teamVideo }          : {}),
        ...(d.sowNumber          !== undefined ? { sowNumber:          d.sowNumber }          : {}),
        ...(d.budgetMs           !== undefined ? { budgetMs:           d.budgetMs }           : {}),
        ...(d.mainCategory       !== undefined ? { mainCategory:       d.mainCategory }       : {}),
        ...(d.focus              !== undefined ? { focus:              d.focus }              : {}),
        ...(d.clientFolderBox    !== undefined ? { clientFolderBox:    d.clientFolderBox }    : {}),
        ...(d.clientFolderClient !== undefined ? { clientFolderClient: d.clientFolderClient } : {}),
        ...(d.assigneeId         !== undefined ? { assigneeId:         d.assigneeId }         : {}),
        ...(d.dueDate            !== undefined ? { dueDate:            d.dueDate ? new Date(d.dueDate) : null } : {}),
        ...(d.reviewStatus       !== undefined ? { reviewStatus:       d.reviewStatus as never } : {}),
        ...(d.itemName           !== undefined ? { itemName:           d.itemName }           : {}),
      },
      select: SELECT,
    })

    return reply.send({ data: updated })
  })
}
