import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'

export async function notificationsRoutes(app: FastifyInstance) {
  // ── GET / — list notifications for the current user ────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId, userId } = req.auth
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' })

    const notifications = await prisma.notification.findMany({
      where: { agencyId, userId },
      orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    })

    // Pending notifications are not actionable yet — exclude from unread badge count
    const unreadCount = await prisma.notification.count({
      where: { agencyId, userId, read: false, NOT: { referenceStatus: 'pending' } },
    })

    return reply.send({ data: notifications, unreadCount })
  })

  // ── PATCH /:id/read — mark a single notification as read ───────────────────
  app.patch<{ Params: { id: string } }>('/:id/read', async (req, reply) => {
    const { agencyId, userId } = req.auth
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' })

    const n = await prisma.notification.findFirst({ where: { id: req.params.id, agencyId, userId } })
    if (!n) return reply.code(404).send({ error: 'Not found' })

    await prisma.notification.update({ where: { id: n.id }, data: { read: true } })
    return reply.send({ ok: true })
  })

  // ── POST /read-all — mark all as read ──────────────────────────────────────
  app.post('/read-all', async (req, reply) => {
    const { agencyId, userId } = req.auth
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' })

    await prisma.notification.updateMany({
      where: { agencyId, userId, read: false },
      data: { read: true },
    })
    return reply.send({ ok: true })
  })
}
