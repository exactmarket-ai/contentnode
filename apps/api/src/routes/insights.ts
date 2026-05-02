import type { FastifyInstance } from 'fastify'
import { prisma, auditService } from '@contentnode/database'
import { getInsightSynthesisQueue } from '../lib/queues.js'

export async function insightRoutes(app: FastifyInstance) {
  // ── GET /pending/count — count of pending insights (sidebar badge) ─────────
  // Must be registered before /:id to avoid conflict
  app.get('/pending/count', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId } = req.query as Record<string, string>

    const count = await prisma.insight.count({
      where: {
        agencyId,
        status: 'pending',
        ...(clientId ? { clientId } : {}),
      },
    })

    return reply.send({ count })
  })

  // ── GET / — list insights (filter by client, status, type) ────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { clientId, status, type } = req.query as Record<string, string>

    const data = await prisma.insight.findMany({
      where: {
        agencyId,
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      },
      include: {
        client: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    })

    return reply.send({ data, meta: { total: data.length } })
  })

  // ── GET /:id — single insight ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const data = await prisma.insight.findFirst({
      where: { id: req.params.id, agencyId },
      include: {
        client: { select: { id: true, name: true, slug: true } },
      },
    })

    if (!data) return reply.code(404).send({ error: 'Not found' })
    return reply.send({ data })
  })

  // ── PATCH /:id — update status, connectedNodeId, or bake in ──────────────
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const body = req.body as {
      status?: 'pending' | 'applied' | 'confirmed' | 'dismissed'
      connectedNodeId?: string | null
      dismissedUntilRun?: number
      action?: 'bake_in'
    }

    const insight = await prisma.insight.findFirst({
      where: { id: req.params.id, agencyId },
    })

    if (!insight) return reply.code(404).send({ error: 'Not found' })

    const updates: Record<string, unknown> = {}

    if (body.status) updates.status = body.status
    if (body.connectedNodeId !== undefined) updates.connectedNodeId = body.connectedNodeId
    if (body.dismissedUntilRun !== undefined) updates.dismissedUntilRun = body.dismissedUntilRun

    if (body.action === 'bake_in') {
      updates.status = 'confirmed'
    }

    const updated = await prisma.insight.update({
      where: { id: req.params.id },
      data: updates,
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      action: body.action === 'bake_in' ? 'insight.confirmed' : 'insight.updated',
      resourceType: 'Insight',
      resourceId: req.params.id,
      metadata: { status: updates.status, action: body.action },
    })

    // Fire-and-forget synthesis when insight is confirmed or set to high-confidence
    if (body.action === 'bake_in' || (body.status && body.status !== 'dismissed')) {
      const shouldSynthesize = body.action === 'bake_in' || (updated.confidence != null && updated.confidence >= 0.7)
      if (shouldSynthesize && updated.clientId) {
        getInsightSynthesisQueue()
          .add('synthesize', { insightId: updated.id, agencyId, clientId: updated.clientId })
          .catch((e) => console.error('[insights] failed to enqueue synthesis:', e))
      }
    }

    return reply.send({ data: updated })
  })
}
