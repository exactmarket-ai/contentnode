import type { FastifyInstance } from 'fastify'
import { permissionService } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

export async function permissionRoutes(app: FastifyInstance) {
  // ── GET /me — resolved permissions for the calling user ─────────────────────
  // Optionally pass ?clientId= to include client-level override in the resolution.
  app.get('/me', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { clientId } = req.query as Record<string, string>
    const perms = await permissionService.resolvePermissions(agencyId, userId, clientId ?? null)
    return reply.send({ data: perms })
  })

  // ── GET /roles — return default permission sets for all roles ────────────────
  app.get('/roles', async (_req, reply) => {
    const roles = [
      'super_admin', 'org_admin', 'client_manager',
      'editor', 'reviewer', 'viewer', 'api_user',
      'owner', 'admin', 'manager', 'lead', 'member',
    ]
    const data = Object.fromEntries(
      roles.map((r) => [r, permissionService.getRoleDefaults(r)])
    )
    return reply.send({ data })
  })

  // ── GET /users/:clerkUserId — resolved permissions for a specific user ───────
  // Requires owner or admin role.
  app.get<{ Params: { clerkUserId: string } }>(
    '/users/:clerkUserId',
    { preHandler: requireRole('owner', 'admin', 'super_admin', 'org_admin') },
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clerkUserId } = req.params
      const { clientId } = req.query as Record<string, string>
      const perms = await permissionService.resolvePermissions(agencyId, clerkUserId, clientId ?? null)
      return reply.send({ data: perms })
    }
  )

  // ── PUT /users/:clerkUserId/override — set per-user permissions override ─────
  app.put<{ Params: { clerkUserId: string } }>(
    '/users/:clerkUserId/override',
    { preHandler: requireRole('owner', 'admin', 'super_admin', 'org_admin') },
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clerkUserId } = req.params
      const body = req.body as Record<string, unknown>
      // Pass null to clear the override (revert to role defaults)
      const override = body.permissions === null ? null : (body.permissions as object | null) ?? null
      await permissionService.setUserPermissionsOverride(agencyId, clerkUserId, override)
      return reply.send({ data: { ok: true } })
    }
  )

  // ── PUT /clients/:clientId/override — set client-level permissions override ──
  app.put<{ Params: { clientId: string } }>(
    '/clients/:clientId/override',
    { preHandler: requireRole('owner', 'admin', 'super_admin', 'org_admin') },
    async (req, reply) => {
      const { agencyId } = req.auth
      const { clientId } = req.params
      const body = req.body as Record<string, unknown>
      const override = body.permissions === null ? null : (body.permissions as object | null) ?? null
      await permissionService.setClientPermissionsOverride(agencyId, clientId, override)
      return reply.send({ data: { ok: true } })
    }
  )

  // ── PUT /org/override — set agency-level permissions override ────────────────
  app.put(
    '/org/override',
    { preHandler: requireRole('owner', 'super_admin') },
    async (req, reply) => {
      const { agencyId } = req.auth
      const body = req.body as Record<string, unknown>
      const override = body.permissions === null ? null : (body.permissions as object | null) ?? null
      await permissionService.setAgencyPermissionsOverride(agencyId, override)
      return reply.send({ data: { ok: true } })
    }
  )
}
