// Re-exported from @contentnode/database so the audit service is available
// to both the API and background workers without cross-package coupling.
export { auditService } from '@contentnode/database'
export type { AuditLogEntry, ActorType } from '@contentnode/database'
