// Shared types, constants, and utilities for the PM / Pipeline system.

export interface Client { id: string; name: string }
export interface Member { id: string; name: string | null; email: string; avatarStorageKey: string | null }

export interface PipelineRun {
  id: string
  status: string
  reviewStatus: string
  itemName: string | null
  createdAt: string
  completedAt: string | null
  dueDate: string | null
  assigneeId: string | null
  assignee: { id: string; name: string | null; avatarStorageKey: string | null } | null
  workflow: { id: string; name: string; client: { id: string; name: string } | null } | null
  _count: { comments: number }
}

export interface PipelineRevision {
  id: string
  clientId: string
  verticalId: string
  reviewStatus: string
  revisionType: string
  exportedAt: string | null
  createdAt: string
  assigneeId: string | null
  notes: string | null
  client: { id: string; name: string }
  vertical: { id: string; name: string }
}

export type CardItem =
  | { _type: 'run';      data: PipelineRun }
  | { _type: 'revision'; data: PipelineRevision }

export type ColKey =
  | 'in_production'
  | 'last_mile'
  | 'ready_for_client'
  | 'client_review'
  | 'client_responded'
  | 'closed'

export type PipelineView = 'board' | 'timeline' | 'table' | 'dashboard'

export const COLUMNS: {
  key: ColKey
  label: string
  sublabel: string
  icon: string
  color: string
  headerCls: string
  barColor: string
  barBg: string
}[] = [
  { key: 'in_production',    label: 'In Production',    sublabel: 'Generating',      icon: 'Zap',          color: 'text-blue-500',    headerCls: 'border-blue-500/40 bg-blue-500/5',    barColor: '#3b82f6', barBg: '#dbeafe' },
  { key: 'last_mile',        label: 'Last Mile',        sublabel: 'Internal QA',     icon: 'Eye',          color: 'text-amber-500',   headerCls: 'border-amber-500/40 bg-amber-500/5',  barColor: '#f59e0b', barBg: '#fef3c7' },
  { key: 'ready_for_client', label: 'Ready for Client', sublabel: 'Agency approved', icon: 'CheckCircle',  color: 'text-emerald-500', headerCls: 'border-emerald-500/40 bg-emerald-500/5', barColor: '#10b981', barBg: '#d1fae5' },
  { key: 'client_review',    label: 'Client Review',    sublabel: 'With client',     icon: 'Users',        color: 'text-violet-500',  headerCls: 'border-violet-500/40 bg-violet-500/5', barColor: '#8b5cf6', barBg: '#ede9fe' },
  { key: 'client_responded', label: 'Client Responded', sublabel: 'Awaiting action', icon: 'MessageSquare',color: 'text-purple-500',  headerCls: 'border-purple-500/40 bg-purple-500/5', barColor: '#a855f7', barBg: '#f3e8ff' },
  { key: 'closed',           label: 'Closed',           sublabel: 'Published / done',icon: 'Archive',      color: 'text-slate-400',   headerCls: 'border-slate-400/40 bg-slate-400/5',  barColor: '#94a3b8', barBg: '#f1f5f9' },
]

export const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<ColKey, typeof COLUMNS[number]>

export function runToCol(run: PipelineRun): ColKey {
  if (['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)) return 'in_production'
  if (run.status === 'failed' || run.status === 'cancelled') return 'closed'
  if (run.reviewStatus === 'closed')           return 'closed'
  if (run.reviewStatus === 'client_responded') return 'client_responded'
  if (run.reviewStatus === 'sent_to_client')   return 'client_review'
  if (run.reviewStatus === 'pending')          return 'ready_for_client'
  return 'last_mile'
}

export function revToCol(rev: PipelineRevision): ColKey {
  if (rev.reviewStatus === 'closed')           return 'closed'
  if (rev.reviewStatus === 'client_responded') return 'client_responded'
  if (rev.reviewStatus === 'sent_to_client')   return 'client_review'
  if (rev.reviewStatus === 'agency_review')    return 'ready_for_client'
  return 'last_mile'
}

export function getItemStage(item: CardItem): ColKey {
  return item._type === 'run' ? runToCol(item.data) : revToCol(item.data)
}

export function getItemTitle(item: CardItem): string {
  if (item._type === 'run') return item.data.itemName || item.data.workflow?.name || 'Untitled'
  return `GTM — ${item.data.vertical.name}`
}

export function getItemClient(item: CardItem): string {
  if (item._type === 'run') return item.data.workflow?.client?.name ?? '—'
  return item.data.client.name
}

export function getItemClientId(item: CardItem): string {
  if (item._type === 'run') return item.data.workflow?.client?.id ?? 'none'
  return item.data.clientId
}

export function getItemDueDate(item: CardItem): string | null {
  return item._type === 'run' ? item.data.dueDate : null
}

export function getItemCreatedAt(item: CardItem): string {
  return item.data.createdAt
}

export function getItemAssignee(item: CardItem, members: Member[]) {
  const id = item._type === 'run' ? item.data.assigneeId : item.data.assigneeId
  return members.find((m) => m.id === id) ?? null
}

export function isItemOverdue(item: CardItem): boolean {
  const d = getItemDueDate(item)
  if (!d) return false
  return new Date(d).getTime() < Date.now()
}

export function dueDateChip(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0)  return { text: `${Math.abs(days)}d overdue`, cls: 'bg-red-500/10 text-red-600 border-red-200' }
  if (days === 0) return { text: 'Due today',                 cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  if (days <= 3)  return { text: `Due in ${days}d`,           cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  return {
    text: new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    cls: 'bg-muted text-muted-foreground border-border',
  }
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)    return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export const RUN_COL_TO_STATUS: Partial<Record<ColKey, string>> = {
  last_mile:        'none',
  ready_for_client: 'pending',
  client_review:    'sent_to_client',
  client_responded: 'client_responded',
  closed:           'closed',
}

export const REV_COL_TO_STATUS: Partial<Record<ColKey, string>> = {
  last_mile:        'draft',
  ready_for_client: 'agency_review',
  client_review:    'sent_to_client',
  client_responded: 'client_responded',
  closed:           'closed',
}
