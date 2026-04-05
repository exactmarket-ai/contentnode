import { prisma } from './client.js'
import { Prisma } from '@prisma/client'

export type ActorType = 'user' | 'stakeholder' | 'system'

export interface AuditLogEntry {
  actorType: ActorType
  actorId?: string
  action: string
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

/**
 * Append-only AuditLog service.
 * No update or delete methods exist by design (architectural rule #5).
 * Lives in packages/database so it can be used by both the API and workers.
 */
export const auditService = {
  async log(agencyId: string, entry: AuditLogEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        agencyId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    })
  },

  async list(
    agencyId: string,
    opts: { limit?: number; offset?: number; action?: string } = {}
  ) {
    return prisma.auditLog.findMany({
      where: {
        agencyId,
        ...(opts.action ? { action: opts.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    })
  },
}
