import type { FastifyInstance } from 'fastify'

export async function runRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({ data: [], meta: { total: 0 } })
  })

  app.get<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.send({ data: null })
  })

  app.post<{ Params: { id: string } }>('/:id/cancel', async (_req, reply) => {
    return reply.code(202).send({ data: null })
  })
}
