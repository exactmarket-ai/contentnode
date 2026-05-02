import type { FastifyRequest } from 'fastify'
import { prisma } from '@contentnode/database'

// Roles that always see all clients — never filtered, never assigned rows written.
export const UNRESTRICTED_ROLES = new Set(['owner', 'org_admin', 'admin'])

export function isUnrestricted(role: string): boolean {
  return UNRESTRICTED_ROLES.has(role)
}

// Returns client IDs the given Clerk user is explicitly assigned to.
export async function getAllowedClientIds(agencyId: string, clerkUserId: string): Promise<string[]> {
  const rows = await prisma.teamMemberClient.findMany({
    where: { teamMember: { clerkUserId }, agencyId },
    select: { clientId: true },
  })
  return rows.map(r => r.clientId)
}

// Returns true if the request's user may access the specific client.
export async function hasClientAccess(req: FastifyRequest, clientId: string): Promise<boolean> {
  const { agencyId, userId, role } = req.auth
  if (isUnrestricted(role)) return true
  const row = await prisma.teamMemberClient.findFirst({
    where: { teamMember: { clerkUserId: userId }, agencyId, clientId },
  })
  return !!row
}

// Returns a Prisma WHERE clause for client list queries.
// Unrestricted roles  → { agencyId }
// Restricted roles    → { agencyId, id: { in: [...assignedClientIds] } }
export async function clientScopeWhere(req: FastifyRequest): Promise<{ agencyId: string; id?: { in: string[] } }> {
  const { agencyId, userId, role } = req.auth
  if (isUnrestricted(role)) return { agencyId }
  const ids = await getAllowedClientIds(agencyId, userId)
  return { agencyId, id: { in: ids } }
}
