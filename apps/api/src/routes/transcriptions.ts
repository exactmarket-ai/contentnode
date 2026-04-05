import type { FastifyInstance } from 'fastify'

export async function transcriptionRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({ data: [], meta: { total: 0 } })
  })

  app.get<{ Params: { id: string } }>('/:id', async (_req, reply) => {
    return reply.send({ data: null })
  })

  // Upload audio for transcription (multipart)
  app.post('/upload', async (_req, reply) => {
    return reply.code(202).send({ data: null })
  })
}
