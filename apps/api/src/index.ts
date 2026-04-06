import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import { prisma } from '@contentnode/database'
import { authPlugin } from './plugins/auth.js'
import { workflowRoutes } from './routes/workflows.js'
import { clientRoutes } from './routes/clients.js'
import { nodeRoutes } from './routes/nodes.js'
import { runRoutes } from './routes/runs.js'
import { feedbackRoutes } from './routes/feedback.js'
import { transcriptionRoutes } from './routes/transcriptions.js'
import { insightRoutes } from './routes/insights.js'
import { documentRoutes } from './routes/documents.js'
import { portalRoutes } from './routes/portal.js'
import { usageRoutes } from './routes/usage.js'
import { getRedis } from './lib/redis.js'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

// ── Security / middleware ──────────────────────────────────────────────────
await app.register(helmet)
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
})
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
})

// ── Auth ──────────────────────────────────────────────────────────────────
await app.register(authPlugin)

// ── Health check (no auth required) ──────────────────────────────────────
app.get('/health', async (_req, reply) => {
  const checks: Record<string, 'ok' | 'error'> = {}

  // Database
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
  }

  // Redis
  try {
    const redis = getRedis()
    await redis.ping()
    checks.redis = 'ok'
  } catch {
    checks.redis = 'error'
  }

  const healthy = Object.values(checks).every((v) => v === 'ok')
  return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks })
})

// ── API routes ────────────────────────────────────────────────────────────
await app.register(workflowRoutes, { prefix: '/api/v1/workflows' })
await app.register(clientRoutes, { prefix: '/api/v1/clients' })
await app.register(nodeRoutes, { prefix: '/api/v1/nodes' })
await app.register(runRoutes, { prefix: '/api/v1/runs' })
await app.register(feedbackRoutes, { prefix: '/api/v1/feedback' })
await app.register(transcriptionRoutes, { prefix: '/api/v1/transcriptions' })
await app.register(insightRoutes, { prefix: '/api/v1/insights' })
await app.register(documentRoutes, { prefix: '/api/v1/documents' })
await app.register(portalRoutes,   { prefix: '/portal' })
await app.register(usageRoutes,    { prefix: '/api/v1/usage' })

// ── Start ─────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
