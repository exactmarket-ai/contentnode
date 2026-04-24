import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '@contentnode/database'

export const myWorkRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/my-work — employee home: my assigned runs + recent comments + members
  app.get('/', async (req, reply) => {
    const { agencyId, userId: clerkUserId } = req.auth

    const me = await prisma.user.findFirst({
      where: { clerkUserId, agencyId },
      select: { id: true, name: true },
    })
    if (!me) return reply.code(403).send({ error: 'User not found' })

    const [runs, members] = await Promise.all([
      prisma.workflowRun.findMany({
        where: { agencyId, assigneeId: me.id, status: { notIn: ['cancelled'] } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 60,
        select: {
          id: true,
          status: true,
          reviewStatus: true,
          itemName: true,
          createdAt: true,
          completedAt: true,
          dueDate: true,
          assigneeId: true,
          assignee: { select: { id: true, name: true, avatarStorageKey: true } },
          workflow: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.user.findMany({
        where: { agencyId },
        select: { id: true, name: true, email: true, avatarStorageKey: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ])

    const myRunIds = runs.map((r) => r.id)

    const recentComments = myRunIds.length > 0
      ? await prisma.comment.findMany({
          where: { agencyId, workflowRunId: { in: myRunIds } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: {
            id: true,
            body: true,
            createdAt: true,
            user: { select: { id: true, name: true, avatarStorageKey: true } },
            workflowRun: {
              select: {
                id: true,
                itemName: true,
                workflow: { select: { name: true, client: { select: { name: true } } } },
              },
            },
          },
        })
      : []

    return reply.send({
      data: { userId: me.id, userName: me.name, runs, recentComments, members },
    })
  })
}
