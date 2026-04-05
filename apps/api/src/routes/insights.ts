import type { FastifyInstance } from 'fastify'

export async function insightRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({ data: [], meta: { total: 0 } })
  })

  app.get<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.send({ data: null })
  })
}
