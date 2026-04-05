import type { FastifyInstance } from 'fastify'

export async function nodeRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({ data: [], meta: { total: 0 } })
  })

  app.get<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.send({ data: null })
  })

  app.post('/', async (_req, reply) => {
    return reply.code(201).send({ data: null })
  })

  app.patch<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.send({ data: null })
  })

  app.delete<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.code(204).send()
  })
}
