import type { FastifyInstance } from 'fastify'
import { prisma } from '@contentnode/database'

export async function pipelineRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/pipeline
   * Returns all active WorkflowRuns + FrameworkRevisions for the agency
   * in a shape ready for the pipeline kanban board.
   * Optional query params: clientId, assigneeId
   */
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const query = req.query as { clientId?: string; assigneeId?: string }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runWhere: any = { agencyId }
    if (query.clientId) runWhere.workflow = { clientId: query.clientId }
    if (query.assigneeId) runWhere.assigneeId = query.assigneeId

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revWhere: any = { agencyId }
    if (query.clientId)  revWhere.clientId  = query.clientId
    if (query.assigneeId) revWhere.assigneeId = query.assigneeId

    const [runs, revisions, clients, members] = await Promise.all([
      prisma.workflowRun.findMany({
        where: {
          ...runWhere,
          // Exclude very old closed runs — only last 90 days
          createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 250,
        select: {
          id:           true,
          status:       true,
          reviewStatus: true,
          itemName:     true,
          createdAt:    true,
          completedAt:  true,
          dueDate:      true,
          assigneeId:   true,
          assignee:     { select: { id: true, name: true, avatarStorageKey: true } },
          workflow: {
            select: {
              id:   true,
              name: true,
              client: { select: { id: true, name: true } },
            },
          },
          _count: { select: { comments: true } },
        },
      }),

      prisma.frameworkRevision.findMany({
        where: {
          ...revWhere,
          createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          client:   { select: { id: true, name: true } },
          vertical: { select: { id: true, name: true } },
          // assignee relation may not exist — guard below
        },
      }),

      prisma.client.findMany({
        where:   { agencyId },
        select:  { id: true, name: true },
        orderBy: { name: 'asc' },
      }),

      prisma.user.findMany({
        where:  { agencyId },
        select: { id: true, name: true, email: true, avatarStorageKey: true },
      }),
    ])

    return reply.send({ data: { runs, revisions, clients, members } })
  })

  /**
   * PATCH /api/v1/pipeline/runs/:id/stage
   * Move a run to a new pipeline stage (updates reviewStatus).
   */
  app.patch<{ Params: { id: string }; Body: { reviewStatus: string } }>(
    '/runs/:id/stage',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { reviewStatus } = req.body ?? {}
      const allowed = ['none', 'pending', 'sent_to_client', 'client_responded', 'closed']
      if (!allowed.includes(reviewStatus)) return reply.code(400).send({ error: 'Invalid stage' })

      const run = await prisma.workflowRun.findFirst({ where: { id: req.params.id, agencyId } })
      if (!run) return reply.code(404).send({ error: 'Not found' })

      const updated = await prisma.workflowRun.update({
        where: { id: req.params.id },
        data:  { reviewStatus: reviewStatus as never },
        select: { id: true, reviewStatus: true },
      })
      return reply.send({ data: updated })
    },
  )

  /**
   * PATCH /api/v1/pipeline/revisions/:id/stage
   * Move a framework revision to a new stage (updates reviewStatus).
   */
  app.patch<{ Params: { id: string }; Body: { reviewStatus: string } }>(
    '/revisions/:id/stage',
    async (req, reply) => {
      const { agencyId } = req.auth
      const { reviewStatus } = req.body ?? {}
      const allowed = ['draft', 'agency_review', 'sent_to_client', 'client_responded', 'closed']
      if (!allowed.includes(reviewStatus)) return reply.code(400).send({ error: 'Invalid stage' })

      const rev = await prisma.frameworkRevision.findFirst({ where: { id: req.params.id, agencyId } })
      if (!rev) return reply.code(404).send({ error: 'Not found' })

      const updated = await prisma.frameworkRevision.update({
        where: { id: req.params.id },
        data:  { reviewStatus },
        select: { id: true, reviewStatus: true },
      })
      return reply.send({ data: updated })
    },
  )
}
