/**
 * Agency-level prompt template management.
 * Templates here have agencyLevel=true and can be propagated to all clients.
 *
 * POST /                — create + auto-propagate
 * GET  /                — list all org-level templates (clientId IS NULL)
 * PATCH /:id            — update, handles visibleToClients toggle
 * DELETE /:id           — blocked while propagated + visible
 * POST /:id/propagate   — manual re-propagation (fills gaps for newly onboarded clients)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { getPromptPropagationQueue } from '../lib/queues.js'

const ADMIN_ROLES = new Set(['owner', 'admin'])

const CLIENT_PROPAGATION_THRESHOLD = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

async function countAgencyClients(agencyId: string): Promise<number> {
  return prisma.client.count({ where: { agencyId, status: 'active' } })
}

async function countClientCopies(agencyId: string, templateId: string): Promise<number> {
  return prisma.promptTemplate.count({
    where: { agencyId, agencyTemplateId: templateId },
  })
}

/**
 * Propagate synchronously for small agencies (≤ threshold).
 * Returns the number of new client copies created.
 */
async function propagateSync(agencyId: string, template: {
  id: string; name: string; body: string; category: string; description: string | null
}): Promise<number> {
  const clients = await prisma.client.findMany({
    where: { agencyId, status: 'active' },
    select: { id: true },
  })

  let count = 0
  for (const client of clients) {
    const existing = await prisma.promptTemplate.findFirst({
      where: { agencyId, clientId: client.id, agencyTemplateId: template.id },
    })
    if (existing) {
      if (existing.isHidden) {
        await prisma.promptTemplate.update({ where: { id: existing.id }, data: { isHidden: false } })
      }
      continue
    }

    await prisma.promptTemplate.create({
      data: {
        agencyId,
        clientId:        client.id,
        name:            template.name,
        body:            template.body,
        category:        template.category,
        description:     template.description,
        source:          'agency',
        agencyTemplateId: template.id,
        agencyLevel:     false,
        visibleToClients: true,
        isHidden:        false,
        createdBy:       'system',
      },
    })
    count++
  }
  return count
}

async function enqueuePropagation(agencyId: string, templateId: string): Promise<void> {
  await getPromptPropagationQueue().add('propagate', { agencyId, templateId }, {
    removeOnComplete: { count: 20 },
    removeOnFail:     { count: 10 },
  })
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function agencyPromptTemplateRoutes(app: FastifyInstance) {
  // ── GET / — list all org-level prompt templates ───────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const templates = await prisma.promptTemplate.findMany({
      where: { agencyId, clientId: null, deletedAt: null },
      orderBy: [{ agencyLevel: 'desc' }, { source: 'asc' }, { createdAt: 'desc' }],
    })

    // Attach client copy counts
    const withCounts = await Promise.all(templates.map(async (t) => ({
      ...t,
      clientCopyCount: t.agencyLevel ? await countClientCopies(agencyId, t.id) : 0,
    })))

    return reply.send({ data: withCounts })
  })

  // ── POST / — create agency-level template + trigger propagation ───────────
  app.post('/', async (req, reply) => {
    const { agencyId, userId, role } = req.auth

    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })

    const parsed = z.object({
      name:             z.string().min(1).max(200),
      body:             z.string().min(1),
      category:         z.string().default('Business'),
      description:      z.string().max(300).optional(),
      visibleToClients: z.boolean().default(true),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    const data = parsed.data

    const template = await prisma.promptTemplate.create({
      data: {
        agencyId,
        clientId:         null,
        name:             data.name,
        body:             data.body,
        category:         data.category,
        description:      data.description ?? null,
        source:           'global',
        agencyLevel:      true,
        visibleToClients: data.visibleToClients,
        createdBy:        userId,
      },
    })

    let propagationStatus = 'none'
    if (data.visibleToClients) {
      const clientCount = await countAgencyClients(agencyId)
      if (clientCount <= CLIENT_PROPAGATION_THRESHOLD) {
        await propagateSync(agencyId, template)
        await prisma.promptTemplate.update({ where: { id: template.id }, data: { propagatedAt: new Date() } })
        propagationStatus = 'complete'
      } else {
        await enqueuePropagation(agencyId, template.id)
        propagationStatus = 'pending'
      }
    }

    return reply.code(201).send({ data: { ...template, propagationStatus } })
  })

  // ── PATCH /:id — update template + handle visibility toggle ──────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, role } = req.auth

    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })

    const template = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId, clientId: null },
    })
    if (!template) return reply.code(404).send({ error: 'Template not found' })

    const parsed = z.object({
      name:             z.string().min(1).max(200).optional(),
      body:             z.string().min(1).optional(),
      category:         z.string().optional(),
      description:      z.string().max(300).nullable().optional(),
      visibleToClients: z.boolean().optional(),
    }).safeParse(req.body)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    const patch = parsed.data

    const updated = await prisma.promptTemplate.update({
      where: { id: template.id },
      data: {
        ...(patch.name !== undefined        ? { name: patch.name }               : {}),
        ...(patch.body !== undefined        ? { body: patch.body }               : {}),
        ...(patch.category !== undefined    ? { category: patch.category }       : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.visibleToClients !== undefined ? { visibleToClients: patch.visibleToClients } : {}),
      },
    })

    // Handle visibility toggle if agencyLevel template
    if (template.agencyLevel && patch.visibleToClients !== undefined) {
      if (patch.visibleToClients) {
        // Turning ON — un-hide existing copies + propagate to any clients without one
        await prisma.promptTemplate.updateMany({
          where: { agencyId, agencyTemplateId: template.id },
          data: { isHidden: false },
        })
        const clientCount = await countAgencyClients(agencyId)
        if (clientCount <= CLIENT_PROPAGATION_THRESHOLD) {
          await propagateSync(agencyId, updated)
          if (!updated.propagatedAt) {
            await prisma.promptTemplate.update({ where: { id: template.id }, data: { propagatedAt: new Date() } })
          }
        } else {
          await enqueuePropagation(agencyId, template.id)
        }
      } else {
        // Turning OFF — hide all client copies
        await prisma.promptTemplate.updateMany({
          where: { agencyId, agencyTemplateId: template.id },
          data: { isHidden: true },
        })
      }
    }

    return reply.send({ data: updated })
  })

  // ── DELETE /:id — blocked if propagated + visible ─────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId, role } = req.auth

    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })

    const template = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId, clientId: null },
    })
    if (!template) return reply.code(404).send({ error: 'Template not found' })

    // Block deletion if propagated and still visible
    if (template.agencyLevel && template.propagatedAt && template.visibleToClients) {
      const copies = await countClientCopies(agencyId, template.id)
      return reply.code(409).send({
        error: `This template has been propagated to ${copies} client${copies !== 1 ? 's' : ''}. Toggle off visibility before deleting.`,
      })
    }

    // Soft-delete the agency template + all client copies
    const now = new Date()
    await prisma.promptTemplate.updateMany({
      where: { agencyId, agencyTemplateId: template.id },
      data: { deletedAt: now },
    })
    await prisma.promptTemplate.update({
      where: { id: template.id },
      data: { deletedAt: now },
    })

    return reply.send({ data: { deleted: true } })
  })

  // ── POST /:id/propagate — manual re-propagation ───────────────────────────
  app.post<{ Params: { id: string } }>('/:id/propagate', async (req, reply) => {
    const { agencyId, role } = req.auth

    if (!ADMIN_ROLES.has(role)) return reply.code(403).send({ error: 'Admins only' })

    const template = await prisma.promptTemplate.findFirst({
      where: { id: req.params.id, agencyId, clientId: null, agencyLevel: true },
    })
    if (!template) return reply.code(404).send({ error: 'Agency template not found' })
    if (!template.visibleToClients) return reply.code(400).send({ error: 'Template is hidden — enable visibility first' })

    const clientCount = await countAgencyClients(agencyId)
    if (clientCount <= CLIENT_PROPAGATION_THRESHOLD) {
      const propagated = await propagateSync(agencyId, template)
      if (!template.propagatedAt) {
        await prisma.promptTemplate.update({ where: { id: template.id }, data: { propagatedAt: new Date() } })
      }
      return reply.send({ data: { propagated, async: false } })
    }

    await enqueuePropagation(agencyId, template.id)
    return reply.send({ data: { propagated: 0, async: true } })
  })
}
