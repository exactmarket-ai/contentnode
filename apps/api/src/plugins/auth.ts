import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { verifyToken } from '@clerk/backend'
import { agencyStorage } from '@contentnode/database'

// Extend Fastify's request type to carry decoded auth info
declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      agencyId: string
      userId: string
      role: string
    }
  }
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? ''

async function authPluginFn(app: FastifyInstance) {
  app.decorateRequest('auth', null)

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === '/health') return

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing or malformed Authorization header' })
    }

    const token = authHeader.slice(7)

    let payload: Awaited<ReturnType<typeof verifyToken>>
    try {
      payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY })
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' })
    }

    // Extract tenant context from JWT claims.
    // We expect agency_id and role to be set as custom session claims in Clerk.
    const claims = payload as Record<string, unknown>
    const meta = ((payload as Record<string, unknown>)['publicMetadata'] ?? {}) as Record<string, unknown>

    const agencyId = (claims['agency_id'] ?? meta['agency_id']) as string | undefined
    const role = ((claims['role'] ?? meta['role']) as string | undefined) ?? 'member'

    if (!agencyId) {
      return reply.code(403).send({ error: 'Token is missing agency_id claim' })
    }

    req.auth = { agencyId, userId: payload.sub, role }

    // Seed AsyncLocalStorage so Prisma middleware can read agency_id.
    // enterWith() transitions the current async context immediately — the route
    // handler runs in the same async continuation and will see the store.
    agencyStorage.enterWith({ agencyId })
  })
}

export const authPlugin = fp(authPluginFn, { name: 'auth' })

// ── Role-based access guard ───────────────────────────────────────────────
// Usage: app.get('/foo', { preHandler: requireRole('admin') }, handler)
export function requireRole(...allowedRoles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' })
    }
  }
}
