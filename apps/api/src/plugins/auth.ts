import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { verifyToken } from '@clerk/backend'
import { agencyStorage, prisma } from '@contentnode/database'

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

const DEV_MODE = !CLERK_SECRET_KEY || CLERK_SECRET_KEY === 'sk_test_...'

async function authPluginFn(app: FastifyInstance) {
  app.decorateRequest('auth', null)

  // CRITICAL #3: Prevent starting in production without a real Clerk secret key
  if (process.env.NODE_ENV === 'production' && DEV_MODE) {
    throw new Error(
      '[auth] CLERK_SECRET_KEY is not set or is a placeholder. ' +
      'The server cannot start in production without a valid Clerk secret key.'
    )
  }

  if (DEV_MODE) {
    app.log.warn('[auth] CLERK_SECRET_KEY not set — running in dev mode, all requests authenticated as dev-agency')
  }

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === '/health') return
    // Portal and writer portal routes use magic link auth — skip Clerk JWT check
    if (req.url.startsWith('/portal')) return
    if (req.url.startsWith('/writer')) return
    // Invite token validation is public — no Clerk auth needed to peek at invite details
    if (req.method === 'GET' && req.url.startsWith('/api/v1/team/accept-invite/')) return
    // Client logos are public assets — no auth needed for <img src> to work
    if (req.method === 'GET' && /^\/api\/v1\/clients\/[^/]+\/logo(\?.*)?$/.test(req.url)) return

    // Dev bypass: when no Clerk secret key is configured, treat every request
    // as an authenticated dev user so local development works without Clerk.
    if (DEV_MODE) {
      req.auth = { agencyId: 'dev-agency', userId: 'dev-user', role: 'owner' }
      agencyStorage.enterWith({ agencyId: 'dev-agency' })
      return
    }

    const authHeader = req.headers.authorization
    req.log.debug({ authHeader: authHeader ? `${authHeader.slice(0, 20)}...` : 'missing' }, '[auth] incoming authorization header')

    if (!authHeader?.startsWith('Bearer ')) {
      req.log.warn({ url: req.url, method: req.method }, '[auth] 401 — missing or malformed Authorization header')
      return reply.code(401).send({ error: 'Missing or malformed Authorization header' })
    }

    const token = authHeader.slice(7)

    let payload: Awaited<ReturnType<typeof verifyToken>>
    try {
      payload = await verifyToken(token, {
        secretKey: CLERK_SECRET_KEY,
        authorizedParties: (process.env.CORS_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean),
      })
    } catch (err) {
      req.log.warn(`[auth] 401 — token verification failed: ${(err as Error)?.message ?? String(err)}`)
      return reply.code(401).send({ error: 'Invalid or expired token' })
    }

    // Extract tenant context from JWT claims.
    // We expect agency_id and role to be set as custom session claims in Clerk.
    const claims = payload as Record<string, unknown>
    const meta = ((payload as Record<string, unknown>)['publicMetadata'] ?? {}) as Record<string, unknown>

    const agencyIdFromToken = (claims['agency_id'] ?? meta['agency_id']) as string | undefined
    const roleFromToken = ((claims['role'] ?? meta['role']) as string | undefined) ?? 'member'
    // DEFAULT_AGENCY_ID always wins in local dev — production JWT agency_id may not exist locally
    const agencyId = process.env.DEFAULT_AGENCY_ID ?? agencyIdFromToken
    // DEFAULT_ROLE env var overrides token role for local dev (when Clerk custom claims aren't configured)
    const role = process.env.DEFAULT_ROLE ?? roleFromToken

    req.log.debug({ agencyId, role, sub: payload.sub }, '[auth] token claims')

    if (!agencyId) {
      // Fallback: look up agency_id from the database using the Clerk user ID.
      // This handles cases where the JWT template hasn't propagated yet or
      // the session token customization isn't configured.
      const fallback = process.env.DEFAULT_AGENCY_ID
      if (fallback) {
        const roleOverride = process.env.DEFAULT_ROLE ?? role
        req.log.warn({ sub: payload.sub, fallback, roleOverride }, '[auth] agency_id missing from token — using DEFAULT_AGENCY_ID fallback')
        req.auth = { agencyId: fallback, userId: payload.sub, role: roleOverride }
        agencyStorage.enterWith({ agencyId: fallback })
        return
      }
      try {
        const rows = await prisma.$queryRaw<{ agency_id: string; role: string }[]>`
          SELECT agency_id, role FROM get_user_by_clerk_id(${payload.sub})
        `
        if (rows.length > 0) {
          const { agency_id, role: userRole } = rows[0]
          req.log.info({ sub: payload.sub, agencyId: agency_id }, '[auth] agency_id resolved from database')
          req.auth = { agencyId: agency_id, userId: payload.sub, role: userRole }
          agencyStorage.enterWith({ agencyId: agency_id })
          return
        }
      } catch (err) {
        req.log.error({ err }, '[auth] failed to look up user from database')
      }
      req.log.warn({ sub: payload.sub, claimsKeys: Object.keys(claims) }, '[auth] 403 — token missing agency_id claim and user not found in database')
      return reply.code(403).send({ error: 'Token is missing agency_id claim' })
    }

    req.auth = { agencyId, userId: payload.sub, role }
    agencyStorage.enterWith({ agencyId })

    // Track last active — fire-and-forget, only updates if stale (>5 min)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    prisma.user.updateMany({
      where: {
        clerkUserId: payload.sub,
        agencyId,
        OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: fiveMinutesAgo } }],
      },
      data: { lastActiveAt: new Date() },
    }).catch(() => {})
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
