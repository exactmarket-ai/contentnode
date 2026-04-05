import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────────
// Agency context — stored in AsyncLocalStorage so every query in a request
// automatically has the correct agency_id injected without manual plumbing.
// ─────────────────────────────────────────────────────────────────────────────

interface AgencyContext {
  agencyId: string
}

export const agencyStorage = new AsyncLocalStorage<AgencyContext>()

/** Run a function with an agency context bound to the current async tree. */
export function withAgency<T>(agencyId: string, fn: () => T): T {
  return agencyStorage.run({ agencyId }, fn)
}

/** Returns the current agency ID from context, or throws if not set. */
export function requireAgencyId(): string {
  const ctx = agencyStorage.getStore()
  if (!ctx) {
    throw new Error(
      'No agency context found. Wrap your request handler with withAgency().'
    )
  }
  return ctx.agencyId
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables that are tenant-scoped and need agency_id automatically injected.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_MODELS = new Set([
  'Client',
  'Stakeholder',
  'User',
  'Workflow',
  'Node',
  'Edge',
  'Document',
  'WorkflowRun',
  'Feedback',
  'TranscriptSession',
  'TranscriptSegment',
  'Insight',
  'UsageRecord',
  'AuditLog',
])

// Write operations where we inject agency_id into the data payload
const WRITE_OPERATIONS = new Set(['create', 'createMany', 'upsert'])

// Read / write operations where we inject agency_id into the where clause
const FILTER_OPERATIONS = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

/**
 * Prisma middleware that automatically injects `agency_id` into every query
 * that touches a tenant-scoped model.
 *
 * Attach this to your PrismaClient via `prisma.$use(agencyMiddleware)`.
 */
export const agencyMiddleware: Prisma.Middleware = async (params, next) => {
  if (!params.model || !TENANT_MODELS.has(params.model)) {
    return next(params)
  }

  // Bypass in migration / seeding contexts where agency context is not set
  const ctx = agencyStorage.getStore()
  if (!ctx) {
    return next(params)
  }

  const { agencyId } = ctx

  if (WRITE_OPERATIONS.has(params.action)) {
    if (params.action === 'createMany') {
      // createMany passes { data: [...] }
      const items: Record<string, unknown>[] = Array.isArray(params.args?.data)
        ? params.args.data
        : [params.args?.data]
      params.args.data = items.map((item) => ({ ...item, agency_id: agencyId }))
    } else if (params.action === 'upsert') {
      params.args.create = { ...params.args.create, agency_id: agencyId }
      params.args.where = { ...params.args.where, agency_id: agencyId }
    } else {
      // create
      params.args.data = { ...params.args.data, agency_id: agencyId }
    }
  }

  if (FILTER_OPERATIONS.has(params.action)) {
    params.args = params.args ?? {}
    params.args.where = { ...params.args.where, agency_id: agencyId }
  }

  return next(params)
}
