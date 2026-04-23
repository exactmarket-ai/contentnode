import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Client {
  id: string
  name: string
  industry: string | null
  logoUrl: string | null
  status: string
  stakeholderCount: number
  workflowCount: number
  feedbackCount: number
  lastActivity: string | null
}

interface Run {
  id: string
  workflowName: string
  clientId: string | null
  clientName: string | null
  status: string
  reviewStatus: string | null
  completedAt: string | null
  createdAt: string
  dueDate: string | null
  assignee: { id: string; name: string | null; avatarStorageKey?: string | null } | null
  triggeredByUser: { name: string | null; email: string } | null
}

interface Deliverable {
  id: string
  itemName: string | null
  reviewStatus: string
  status: string
  priority: string | null
  budgetMs: number | null
  sowNumber: string | null
  mainCategory: string | null
  dueDate: string | null
  assignee: { id: string; name: string | null } | null
  workflow: {
    id: string
    name: string
    client: { id: string; name: string }
  }
}

interface WrikeTask {
  id: string
  title: string
  status: string
  briefDescription?: string
  parentIds?: string[]
  superParentIds?: string[]
  responsibleIds?: string[]
  updatedDate?: string
  createdDate?: string
  dates?: { due?: string; start?: string }
}

interface WrikeFolder {
  id: string
  title: string
  childIds?: string[]
  project?: { status?: string; startDate?: string; endDate?: string; ownerIds?: string[] }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBudget(v: number | null) {
  if (v == null) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function timeAgo(iso: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function isWithinDays(iso: string | null, days: number) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < days * 86400000
}

function clientHealth(c: Client): 'active' | 'stale' | 'dormant' {
  if (isWithinDays(c.lastActivity, 14)) return 'active'
  if (isWithinDays(c.lastActivity, 60)) return 'stale'
  return 'dormant'
}

const HEALTH = {
  active:  { dot: 'bg-emerald-400', label: 'Active',  bar: '#10b981', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  stale:   { dot: 'bg-amber-400',   label: 'Stale',   bar: '#f59e0b', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  dormant: { dot: 'bg-slate-300',   label: 'Dormant', bar: '#cbd5e1', badge: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const REVIEW_STATUS: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  none:             { label: 'Needs review',     color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-400' },
  pending:          { label: 'In review',        color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-500' },
  sent_to_client:   { label: 'Sent to client',   color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200', dot: 'bg-violet-500' },
  client_responded: { label: 'Client responded', color: 'text-emerald-600',bg: 'bg-emerald-50 border-emerald-200',dot: 'bg-emerald-500' },
  closed:           { label: 'Closed',           color: 'text-slate-500',  bg: 'bg-slate-50 border-slate-200',   dot: 'bg-slate-400' },
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function LogoAvatar({ logoUrl, name, size = 'md' }: { logoUrl: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base' }[size]
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  if (logoUrl) {
    return <img src={logoUrl.startsWith('/') ? assetUrl(logoUrl) : logoUrl} alt={name} className={cn(dims, 'rounded-lg object-contain border border-border bg-white')} />
  }
  return (
    <div className={cn(dims, 'rounded-lg flex items-center justify-center font-semibold shrink-0')} style={{ backgroundColor: '#f3e8ff', color: '#a200ee' }}>
      {initials || <Icons.Building2 className="h-1/2 w-1/2" />}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight" style={{ color }}>{value}</p>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        <div className="rounded-lg p-2.5" style={{ backgroundColor: `${color}18` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
    </div>
  )
}

function SubTabToggle({ tabs, active, onChange }: {
  tabs: { value: string; label: string; icon: React.ComponentType<{ className?: string }> }[]
  active: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 w-fit">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            active === t.value
              ? 'bg-white shadow-sm text-foreground border border-border'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <t.icon className="h-3.5 w-3.5" />
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Deliverables budget table (shared between Portfolio + Wrike tabs) ──────────

const PRIORITY_STYLE: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-zinc-100 text-zinc-500',
}

function DeliverablesBudgetTable({ deliverables }: { deliverables: Deliverable[] }) {
  const totalBudget = deliverables.reduce((s, d) => s + (d.budgetMs ?? 0), 0)
  const withBudget  = deliverables.filter((d) => d.budgetMs != null).length

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {withBudget > 0 && (
        <div className="flex items-center gap-6 border-b border-border px-4 py-3 bg-muted/20">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Budget</p>
            <p className="text-sm font-bold text-foreground">{formatBudget(totalBudget)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Projects w/ Budget</p>
            <p className="text-sm font-bold text-foreground">{withBudget} / {deliverables.length}</p>
          </div>
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Project</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">SOW #</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Price / Cost</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Priority</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Due</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Assignee</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deliverables.slice(0, 20).map((d) => {
            const overdue = d.dueDate && new Date(d.dueDate) < new Date()
            const rs = REVIEW_STATUS[d.reviewStatus] ?? REVIEW_STATUS.none
            const pri = d.priority?.toLowerCase() ?? ''
            return (
              <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground">{d.workflow.client.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground max-w-[180px] truncate">{d.itemName ?? d.workflow.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{d.sowNumber ?? '—'}</td>
                <td className="px-4 py-2.5 font-semibold text-foreground">{formatBudget(d.budgetMs) ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {pri ? (
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', PRIORITY_STYLE[pri] ?? 'bg-zinc-100 text-zinc-500')}>{d.priority}</span>
                  ) : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', rs.bg, rs.color)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', rs.dot)} />
                    {rs.label}
                  </span>
                </td>
                <td className={cn('px-4 py-2.5 whitespace-nowrap', overdue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                  {d.dueDate ? new Date(d.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  {overdue && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">overdue</span>}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{d.assignee?.name ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Wrike components ───────────────────────────────────────────────────────────

const WRIKE_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Active:      { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  Completed:   { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  Deferred:    { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-700',   dot: 'bg-amber-400' },
  Cancelled:   { bg: 'bg-red-50 border-red-200',      text: 'text-red-600',     dot: 'bg-red-400' },
}

function wrikeStatusStyle(status: string) {
  return WRIKE_STATUS_COLORS[status] ?? { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600', dot: 'bg-slate-400' }
}

function WrikeExecutiveTab({ tasks, folders, deliverables, loading, notConnected, error }: {
  tasks: WrikeTask[]
  folders: WrikeFolder[]
  deliverables: Deliverable[]
  loading: boolean
  notConnected: boolean
  error?: string | null
}) {
  if (notConnected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
        <Icons.Plug className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-foreground">Wrike not connected</p>
        <p className="mt-1 text-xs text-muted-foreground">Go to Settings → Integrations to connect Wrike</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
        <Icons.Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading Wrike data…</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
        <p className="text-sm font-medium text-red-700">Failed to load Wrike data</p>
        <p className="mt-1 text-xs text-red-500">{error}</p>
      </div>
    )
  }

  // Compute status breakdown
  const statusMap: Record<string, number> = {}
  for (const t of tasks) {
    statusMap[t.status] = (statusMap[t.status] ?? 0) + 1
  }

  const folderMap = Object.fromEntries(folders.map((f) => [f.id, f]))

  // Resolve project folder via superParentIds so nested tasks (Project → Sub-folder → Task)
  // still map to their project, not the intermediate sub-folder
  const resolveProject = (t: WrikeTask): WrikeFolder | undefined => {
    const allAncestors = [...new Set([...(t.parentIds ?? []), ...(t.superParentIds ?? [])])]
    return folders.find((f) => f.project && allAncestors.includes(f.id))
      ?? folders.find((f) => allAncestors.includes(f.id))
  }

  const folderTaskCounts: Record<string, number> = {}
  for (const t of tasks) {
    const pf = resolveProject(t)
    if (pf) folderTaskCounts[pf.id] = (folderTaskCounts[pf.id] ?? 0) + 1
  }
  const WRIKE_SYS = new Set(['Root', 'Recycle Bin', 'My Work'])
  const folderDisplayTitle = (title: string) => title.split('|').map((s) => s.trim()).at(-1) ?? title
  const topFolders = Object.entries(folderTaskCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, count]) => ({ folder: folderMap[id], count, id }))
    .filter((f) => f.folder && !WRIKE_SYS.has(f.folder.title))

  const completedCount  = statusMap['Completed']  ?? 0
  const activeCount     = statusMap['Active']      ?? 0
  const deferredCount   = statusMap['Deferred']    ?? 0
  const cancelledCount  = statusMap['Cancelled']   ?? 0

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Icons.CheckSquare} label="Total Tasks"     value={tasks.length}    sub="in Wrike"               color="#185fa5" />
        <KpiCard icon={Icons.Play}        label="Active"          value={activeCount}     sub="in progress"            color="#7c3aed" />
        <KpiCard icon={Icons.CheckCircle2}label="Completed"       value={completedCount}  sub="finished"               color="#059669" />
        <KpiCard icon={Icons.FolderOpen}  label="Projects"        value={folders.length}  sub="total projects"         color="#d97706" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status breakdown */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Task Status Breakdown</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            {Object.entries(statusMap).length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No task data</p>
            ) : (
              <div className="divide-y divide-border">
                {Object.entries(statusMap).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
                  const s = wrikeStatusStyle(status)
                  const pct = Math.round((count / tasks.length) * 100)
                  return (
                    <div key={status} className="flex items-center gap-3 px-4 py-3">
                      <span className={cn('h-2 w-2 rounded-full shrink-0', s.dot)} />
                      <span className="flex-1 text-xs font-medium text-foreground">{status}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.dot.replace('bg-', '').includes('500') ? undefined : undefined, background: s.dot === 'bg-blue-500' ? '#3b82f6' : s.dot === 'bg-emerald-500' ? '#10b981' : s.dot === 'bg-amber-400' ? '#fbbf24' : s.dot === 'bg-red-400' ? '#f87171' : '#94a3b8' }} />
                        </div>
                        <span className="w-8 text-right text-xs font-semibold text-foreground">{count}</span>
                        <span className="w-8 text-right text-[10px] text-muted-foreground">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Top projects by task count */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Projects by Task Volume</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            {topFolders.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No project data</p>
            ) : (
              <div className="divide-y divide-border">
                {topFolders.map(({ folder, count }) => {
                  const ps = folder.project?.status
                  const psStyle = ps === 'Green' ? 'bg-emerald-400' : ps === 'Yellow' ? 'bg-amber-400' : ps === 'Red' ? 'bg-red-400' : 'bg-slate-300'
                  return (
                    <div key={folder.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={cn('h-2.5 w-2.5 rounded-sm shrink-0', psStyle)} title={ps ?? 'No status'} />
                      <span className="flex-1 truncate text-xs font-medium text-foreground" title={folder.title}>{folderDisplayTitle(folder.title)}</span>
                      <span className="text-xs font-semibold text-foreground">{count}</span>
                      <span className="text-[10px] text-muted-foreground">tasks</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent tasks table */}
      {(() => {
        const deliverableByTitle = new Map(
          deliverables.map((d) => [d.itemName?.split('|').at(-1)?.trim().toLowerCase() ?? '', d])
        )
        return (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Tasks</h3>
            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Task</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Due</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Price / Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tasks.slice(0, 15).map((task) => {
                    const s = wrikeStatusStyle(task.status)
                    const parentFolder = resolveProject(task)
                    const dueDate = task.dates?.due
                    const overdue = dueDate && new Date(dueDate) < new Date()
                    const taskKey = task.title.split('|').at(-1)?.trim().toLowerCase() ?? ''
                    const matchedDel = deliverableByTitle.get(taskKey)
                    return (
                      <tr key={task.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground line-clamp-1" title={task.title}>{task.title.split('|').map((s) => s.trim()).at(-1) ?? task.title}</p>
                          {task.briefDescription && <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{task.briefDescription}</p>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', s.bg, s.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                            {task.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[200px]" title={parentFolder?.title}>{parentFolder ? (parentFolder.title.split('|').map((s) => s.trim()).slice(1).join(' | ') || parentFolder.title) : '—'}</td>
                        <td className={cn('px-4 py-2.5', overdue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                          {dueDate ? new Date(dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {matchedDel?.budgetMs != null ? formatBudget(matchedDel.budgetMs) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function WrikeStakeholderTab({ tasks, folders, loading, notConnected }: {
  tasks: WrikeTask[]
  folders: WrikeFolder[]
  loading: boolean
  notConnected: boolean
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  if (notConnected) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
        <Icons.Plug className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-foreground">Wrike not connected</p>
        <p className="mt-1 text-xs text-muted-foreground">Go to Settings → Integrations to connect Wrike</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
        <Icons.Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading Wrike data…</span>
      </div>
    )
  }

  const folderMap = Object.fromEntries(folders.map((f) => [f.id, f]))
  const resolveProject = (t: WrikeTask): WrikeFolder | undefined => {
    const allAncestors = [...new Set([...(t.parentIds ?? []), ...(t.superParentIds ?? [])])]
    return folders.find((f) => f.project && allAncestors.includes(f.id))
      ?? folders.find((f) => allAncestors.includes(f.id))
  }
  const uniqueStatuses = [...new Set(tasks.map((t) => t.status))]

  const filtered = tasks.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 w-48"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-all', statusFilter === 'all' ? 'border-blue-400 bg-blue-600 text-white' : 'border-border bg-white text-muted-foreground hover:border-blue-300')}
          >
            All <span className="ml-1 text-[10px] opacity-70">{tasks.length}</span>
          </button>
          {uniqueStatuses.map((s) => {
            const style = wrikeStatusStyle(s)
            const count = tasks.filter((t) => t.status === s).length
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn('flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all', statusFilter === s ? 'border-blue-400 bg-blue-600 text-white' : cn('border-border bg-white', style.text, 'hover:border-blue-300'))}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusFilter === s ? 'bg-white' : style.dot)} />
                {s} <span className="ml-0.5 opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Task list */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Icons.CheckSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No tasks match this filter</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Task</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Project</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Due Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Assignees</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((task) => {
                const s = wrikeStatusStyle(task.status)
                const parentFolder = resolveProject(task)
                const dueDate = task.dates?.due
                const overdue = dueDate && new Date(dueDate) < new Date()
                return (
                  <tr key={task.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 max-w-[260px]">
                      <p className="font-medium text-foreground truncate" title={task.title}>{task.title.split('|').map((s) => s.trim()).at(-1) ?? task.title}</p>
                      {task.briefDescription && <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{task.briefDescription}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', s.bg, s.text)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                        {task.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" title={parentFolder?.title}>{parentFolder ? (parentFolder.title.split('|').map((s) => s.trim()).slice(1).join(' | ') || parentFolder.title) : '—'}</td>
                    <td className={cn('px-4 py-3', overdue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                      {dueDate ? new Date(dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      {overdue && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">overdue</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.responsibleIds?.length ? `${task.responsibleIds.length} assigned` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Monday types ──────────────────────────────────────────────────────────────

interface MondayColumn { id: string; title: string; type: string }
interface MondayGroup  { id: string; title: string; color: string }
interface MondayColVal { id: string; text?: string; value?: string; label?: string; date?: string; number?: number; url?: string; url_text?: string }
interface MondayItem   { id: string; name: string; state?: string; group?: { id: string; title: string }; column_values?: MondayColVal[]; subitems?: MondayItem[] }
interface MondayBoard  { id: string; name: string; columns?: MondayColumn[]; groups?: MondayGroup[]; items_page?: { items: MondayItem[] } }

// ── Monday CEO grid ───────────────────────────────────────────────────────────

function MondayTab() {
  const [boards,       setBoards]       = useState<MondayBoard[]>([])
  const [boardId,      setBoardId]      = useState<string>('all')
  const [boardData,    setBoardData]    = useState<MondayBoard | null>(null)
  const [groupId,      setGroupId]      = useState<string>('all')
  const [loading,      setLoading]      = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [connected,    setConnected]    = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [editingCell,  setEditingCell]  = useState<{ itemId: string; colId: string } | null>(null)
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({})
  const [savingCell,   setSavingCell]   = useState<Record<string, boolean>>({})

  // Check status + load boards
  useEffect(() => {
    apiFetch('/api/v1/integrations/monday/status').then(r => r.json()).then(({ data }) => {
      setConnected(!!data?.connected)
      if (!data?.connected) { setLoading(false); return }
      apiFetch('/api/v1/integrations/monday/boards').then(r => r.json()).then(({ data: b }) => {
        setBoards(b ?? [])
      }).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }).catch(() => setLoading(false))
  }, [])

  // Load selected board items
  useEffect(() => {
    if (boardId === 'all') { setBoardData(null); return }
    setItemsLoading(true)
    apiFetch(`/api/v1/integrations/monday/boards/${boardId}`).then(r => r.json()).then(({ data }) => {
      setBoardData(data)
      setGroupId('all')
    }).catch((e) => setError(e.message)).finally(() => setItemsLoading(false))
  }, [boardId])

  async function patchCell(itemId: string, colId: string, rawValue: string) {
    const col   = boardData?.columns?.find(c => c.id === colId)
    const type  = col?.type ?? 'text'
    let value: string
    if (type === 'status')    value = JSON.stringify({ label: rawValue })
    else if (type === 'date') value = JSON.stringify({ date: rawValue })
    else if (type === 'long_text') value = JSON.stringify({ text: rawValue })
    else                      value = JSON.stringify(rawValue)

    const cKey = `${itemId}:${colId}`
    setPendingEdits(p => ({ ...p, [cKey]: rawValue }))
    setSavingCell(s => ({ ...s, [cKey]: true }))
    setEditingCell(null)

    try {
      await apiFetch(`/api/v1/integrations/monday/boards/${boardId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: colId, value }),
      })
      setBoardData(prev => {
        if (!prev?.items_page) return prev
        return {
          ...prev,
          items_page: {
            ...prev.items_page,
            items: prev.items_page.items.map(it =>
              it.id !== itemId ? it : {
                ...it,
                column_values: it.column_values?.map(cv =>
                  cv.id !== colId ? cv : { ...cv, text: rawValue, label: rawValue }
                ),
              }
            ),
          },
        }
      })
      setPendingEdits(p => { const n = { ...p }; delete n[cKey]; return n })
    } catch {
      setPendingEdits(p => { const n = { ...p }; delete n[cKey]; return n })
    } finally {
      setSavingCell(s => { const n = { ...s }; delete n[cKey]; return n })
    }
  }

  if (!connected && !loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
        <Icons.LayoutGrid className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-foreground">Monday.com not connected</p>
        <p className="mt-1 text-xs text-muted-foreground">Go to Settings → Integrations to connect Monday</p>
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
      <span className="ml-3 text-sm text-muted-foreground">Loading Monday boards…</span>
    </div>
  )

  // Build column value lookup: colId → text
  const colVal = (item: MondayItem, colId: string): string => {
    const cv = item.column_values?.find(c => c.id === colId)
    return cv?.label ?? cv?.text ?? cv?.date ?? cv?.url ?? (cv?.number != null ? String(cv.number) : '') ?? ''
  }

  // Build colId lookup by title
  const colByTitle = (title: string): string =>
    boardData?.columns?.find(c => c.title.toLowerCase() === title.toLowerCase())?.id ?? ''

  const groups   = boardData?.groups ?? []
  const allItems = boardData?.items_page?.items ?? []
  const items    = groupId === 'all' ? allItems : allItems.filter(i => i.group?.id === groupId)

  // Column IDs (resolved by title — works even if IDs change)
  const COL = {
    jobName:        colByTitle('Project')               || colByTitle('Job name'),
    client:         colByTitle('Client'),
    mainCategory:   colByTitle('Main Category')         || colByTitle('Main category'),
    focus:          colByTitle('Focus'),
    type:           colByTitle('Type'),
    subProject:     colByTitle('Sub Project')           || colByTitle('Sub project'),
    status:         colByTitle('Status'),
    statusInternal: colByTitle('Status Internal')       || colByTitle('Status internal'),
    statusExternal: colByTitle('Status External')       || colByTitle('Status external'),
    priority:       colByTitle('Priority'),
    dayMapping:     colByTitle('Day Mapping')            || colByTitle('Day mapping'),
    stage:          colByTitle('Stage (see wrike stages)') || colByTitle('Stage'),
    followupStatus: colByTitle('Followup Status')       || colByTitle('Followup status'),
    followupDate:   colByTitle('Followup Date')         || colByTitle('Followup date'),
    mainContact:    colByTitle('Main Contact Name')     || colByTitle('Main Contact Na...'),
    otherContacts:  colByTitle('Other Contact Names')   || colByTitle('Other Contact N...'),
    stakeholders:   colByTitle('Other Stakeholders')    || colByTitle('Other Stakeholde...'),
    lastUpdated:    colByTitle('Last Updated'),
    design:         colByTitle('Design'),
    content:        colByTitle('Content'),
    video:          colByTitle('Video'),
    pm:             colByTitle('PM'),
    quarter:        colByTitle('Quarter'),
    sowNumber:      colByTitle('SOW #'),
    budget:         colByTitle('Budget for MS'),
    boxFolder:      colByTitle('Client Folder - Box')   || colByTitle('Client Folder (Box)'),
    clientFolder:   colByTitle('Client Folder - External') || colByTitle('Client Folder (Client)'),
    notes:          colByTitle('Workspace Notes')       || colByTitle('Workspace (Notes)'),
    autonomy:       colByTitle('Autonomy mode'),
    aiTarget:       colByTitle('AI Target %'),
    maxPasses:      colByTitle('Max AI Passes'),
    division:       colByTitle('Division'),
    due:            colByTitle('Due date')    || colByTitle('Due Date'),
    gate:           colByTitle('Gate status') || colByTitle('Gate Status'),
    flagNotes:      colByTitle('Flag notes')  || colByTitle('Flag Notes'),
  }

  const statusColor = (label: string) => {
    const l = label?.toLowerCase() ?? ''
    if (l.includes('complete'))  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    if (l.includes('escalate'))  return 'bg-red-100 text-red-700 border-red-200'
    if (l.includes('progress') || l.includes('active')) return 'bg-blue-100 text-blue-700 border-blue-200'
    if (l.includes('stuck') || l.includes('block'))     return 'bg-orange-100 text-orange-700 border-orange-200'
    return 'bg-muted/40 text-muted-foreground border-border'
  }

  const clientName = (board: MondayBoard) => board.name.replace(/\s*[-–]\s*campaigns?$/i, '').trim()

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Client / Board</label>
          <select
            className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-[#a200ee] min-w-[200px]"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
          >
            <option value="all">Select a client…</option>
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        {groups.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Group / Project</label>
            <select
              className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-[#a200ee] min-w-[180px]"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="all">All groups</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        )}
        {boardId !== 'all' && (
          <div className="ml-auto text-xs text-muted-foreground self-center">
            {items.length} items
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
      )}

      {itemsLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
          <span className="ml-3 text-sm text-muted-foreground">Loading items…</span>
        </div>
      )}

      {!itemsLoading && boardId === 'all' && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Select a client board to view items
        </div>
      )}

      {/* CEO grid */}
      {!itemsLoading && boardData && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/30 min-w-[200px]">Project</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[120px]">Client</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[130px]">Main Category</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[100px]">Focus</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[100px]">Type</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">Sub Project</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[200px]">Workspace Notes</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[130px]">Status (Internal)</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[130px]">Status (External)</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[90px]">Priority</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[110px]">Day Mapping</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Stage</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[130px]">Followup Status</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Followup Date</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[140px]">Main Contact</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">Other Contacts</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">Stakeholders</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Design</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Content</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Video</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">PM</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Last Updated</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Quarter</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">SOW #</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[110px]">Budget for MS</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Box</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[100px]">Client Folder</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[100px]">Status</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Due</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[90px]">Gate</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[200px]">Flag Notes</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[120px]">Group</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Autonomy</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">AI Target %</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Max Passes</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Division</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const boxUrl          = item.column_values?.find(c => c.id === COL.boxFolder)?.url ?? ''
                const clientFolderUrl = item.column_values?.find(c => c.id === COL.clientFolder)?.url ?? ''

                const ec = (colId: string, cls: string, render?: (v: string) => React.ReactNode) => {
                  if (!colId) return <td className={cls}>—</td>
                  const cKey   = `${item.id}:${colId}`
                  const isEdit = editingCell?.itemId === item.id && editingCell?.colId === colId
                  const isSave = !!savingCell[cKey]
                  const val    = pendingEdits[cKey] ?? colVal(item, colId)
                  const cType  = boardData?.columns?.find(c => c.id === colId)?.type
                  const disp   = render ? render(val) : (val || <span className="text-muted-foreground/20 text-[10px] group-hover:text-muted-foreground/40">+</span>)
                  if (isEdit) return (
                    <td className={cn('p-0', cls)}>
                      <input
                        autoFocus
                        type={cType === 'date' ? 'date' : cType === 'numbers' ? 'number' : 'text'}
                        defaultValue={val}
                        className="w-full min-w-[80px] bg-violet-50 border-0 border-b-2 border-[#a200ee] px-3 py-2 text-xs outline-none"
                        onBlur={(e) => patchCell(item.id, colId, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setEditingCell(null)
                        }}
                      />
                    </td>
                  )
                  return (
                    <td className={cn(cls, 'cursor-text group hover:bg-violet-50/30 transition-colors')} onClick={() => setEditingCell({ itemId: item.id, colId })}>
                      {isSave ? <span className="opacity-40">{render ? render(val) : val || '—'}</span> : disp}
                    </td>
                  )
                }

                return (
                  <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 sticky left-0 bg-white font-medium text-foreground max-w-[200px] truncate" title={item.name}>{item.name}</td>
                    {ec(COL.client,         'px-3 py-2 text-muted-foreground max-w-[120px] truncate')}
                    {ec(COL.mainCategory,   'px-3 py-2 text-muted-foreground')}
                    {ec(COL.focus,          'px-3 py-2 text-muted-foreground')}
                    {ec(COL.type,           'px-3 py-2 text-muted-foreground')}
                    {ec(COL.subProject,     'px-3 py-2 text-muted-foreground max-w-[160px] truncate')}
                    {ec(COL.notes,          'px-3 py-2 text-muted-foreground max-w-[200px] truncate')}
                    {ec(COL.statusInternal, 'px-3 py-2', v => v ? <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', statusColor(v))}>{v}</span> : undefined)}
                    {ec(COL.statusExternal, 'px-3 py-2', v => v ? <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', statusColor(v))}>{v}</span> : undefined)}
                    {ec(COL.priority,       'px-3 py-2 text-muted-foreground')}
                    {ec(COL.dayMapping,     'px-3 py-2 text-muted-foreground')}
                    {ec(COL.stage,          'px-3 py-2 text-muted-foreground text-center')}
                    {ec(COL.followupStatus, 'px-3 py-2 text-muted-foreground')}
                    {ec(COL.followupDate,   'px-3 py-2 text-muted-foreground')}
                    {ec(COL.mainContact,    'px-3 py-2 text-muted-foreground max-w-[140px] truncate')}
                    {ec(COL.otherContacts,  'px-3 py-2 text-muted-foreground max-w-[160px] truncate')}
                    {ec(COL.stakeholders,   'px-3 py-2 text-muted-foreground max-w-[160px] truncate')}
                    {ec(COL.design,         'px-3 py-2 text-muted-foreground')}
                    {ec(COL.content,        'px-3 py-2 text-muted-foreground')}
                    {ec(COL.video,          'px-3 py-2 text-muted-foreground')}
                    {ec(COL.pm,             'px-3 py-2 text-muted-foreground')}
                    {ec(COL.lastUpdated,    'px-3 py-2 text-muted-foreground')}
                    {ec(COL.quarter,        'px-3 py-2 text-muted-foreground')}
                    {ec(COL.sowNumber,      'px-3 py-2 text-muted-foreground')}
                    {ec(COL.budget,         'px-3 py-2 text-muted-foreground')}
                    <td className="px-3 py-2">
                      {boxUrl ? <a href={boxUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[11px]">Open</a> : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {clientFolderUrl ? <a href={clientFolderUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[11px]">Open</a> : '—'}
                    </td>
                    {ec(COL.status,    'px-3 py-2', v => v ? <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', statusColor(v))}>{v}</span> : undefined)}
                    {ec(COL.due,       'px-3 py-2', v => {
                      if (!v) return undefined
                      const overdue = new Date(v) < new Date()
                      return <span className={overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                    })}
                    {ec(COL.gate,      'px-3 py-2', v => v ? <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">{v}</span> : undefined)}
                    {ec(COL.flagNotes, 'px-3 py-2 text-muted-foreground max-w-[200px] truncate')}
                    <td className="px-3 py-2 text-muted-foreground">{item.group?.title ?? '—'}</td>
                    {ec(COL.autonomy,  'px-3 py-2 text-muted-foreground')}
                    {ec(COL.aiTarget,  'px-3 py-2 text-muted-foreground text-center')}
                    {ec(COL.maxPasses, 'px-3 py-2 text-muted-foreground text-center')}
                    {ec(COL.division,  'px-3 py-2 text-muted-foreground')}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!itemsLoading && boardData && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No items in this board
        </div>
      )}
    </div>
  )
}

// ── Executive View ─────────────────────────────────────────────────────────────

const EXEC_SUBTABS = [
  { value: 'portfolio', label: 'Portfolio',   icon: Icons.LayoutDashboard },
  { value: 'wrike',     label: 'Wrike',       icon: Icons.CheckSquare },
  { value: 'monday',    label: 'Monday',      icon: Icons.LayoutGrid },
]

function ExecutiveView({ clients, runs, deliverables, wrikeTasks, wrikeFolders, wrikeLoading, wrikeConnected, wrikeError, wrikeFilterBar }: {
  clients: Client[]
  runs: Run[]
  deliverables: Deliverable[]
  wrikeTasks: WrikeTask[]
  wrikeFolders: WrikeFolder[]
  wrikeLoading: boolean
  wrikeConnected: boolean
  wrikeError: string | null
  wrikeFilterBar: React.ReactNode
}) {
  const navigate = useNavigate()
  const [subTab, setSubTab] = useState('portfolio')

  const activeClients = clients.filter((c) => c.status === 'active')
  const totalWorkflows = activeClients.reduce((s, c) => s + c.workflowCount, 0)
  const needsReview = runs.filter((r) => r.reviewStatus === 'none' || r.reviewStatus === 'pending')
  const completedThisWeek = runs.filter((r) => r.status === 'completed' && isWithinDays(r.completedAt, 7))

  return (
    <div className="flex flex-col gap-6">
      <SubTabToggle tabs={EXEC_SUBTABS} active={subTab} onChange={setSubTab} />

      {subTab === 'portfolio' && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard icon={Icons.Users}        label="Active Clients"      value={activeClients.length}    sub="currently active"   color="#185fa5" />
            <KpiCard icon={Icons.Workflow}     label="Total Workflows"     value={totalWorkflows}           sub="across all clients" color="#7c3aed" />
            <KpiCard icon={Icons.ClipboardEdit}label="Pending Review"      value={needsReview.length}       sub="awaiting action"    color="#d97706" />
            <KpiCard icon={Icons.CheckCircle2} label="Completed This Week" value={completedThisWeek.length} sub="in the last 7 days" color="#059669" />
          </div>

          {/* Client portfolio grid */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Client Portfolio</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeClients.length === 0 && (
                <div className="col-span-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
                  <Icons.Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">No active clients yet</p>
                </div>
              )}
              {activeClients.map((client) => {
                const health = clientHealth(client)
                const h = HEALTH[health]
                const clientRuns = runs.filter((r) => r.clientId === client.id)
                const pending = clientRuns.filter((r) => r.reviewStatus === 'none' || r.reviewStatus === 'pending').length
                return (
                  <div
                    key={client.id}
                    className="group relative overflow-hidden rounded-xl border border-border bg-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <div className="h-1 w-full" style={{ backgroundColor: h.bar }} />
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <LogoAvatar logoUrl={client.logoUrl} name={client.name} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{client.name}</p>
                          {client.industry && <p className="truncate text-[11px] text-muted-foreground">{client.industry}</p>}
                        </div>
                        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', h.badge)}>
                          <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full', h.dot)} />
                          {h.label}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-muted/30">
                        <div className="flex flex-col items-center py-2">
                          <p className="text-base font-bold text-foreground">{client.workflowCount}</p>
                          <p className="text-[10px] text-muted-foreground">Workflows</p>
                        </div>
                        <div className="flex flex-col items-center py-2">
                          <p className="text-base font-bold text-foreground">{client.feedbackCount}</p>
                          <p className="text-[10px] text-muted-foreground">Feedback</p>
                        </div>
                        <div className="flex flex-col items-center py-2">
                          <p className={cn('text-base font-bold', pending > 0 ? 'text-orange-600' : 'text-foreground')}>{pending}</p>
                          <p className="text-[10px] text-muted-foreground">Pending</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground">
                          {client.lastActivity ? `Last activity ${timeAgo(client.lastActivity)}` : 'No activity'}
                        </p>
                        <div className="flex items-center gap-1 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100" style={{ color: '#185fa5' }}>
                          View client <Icons.ArrowRight className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Projects & Budget */}
          {deliverables.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-foreground">Projects & Budget</h2>
              <DeliverablesBudgetTable deliverables={deliverables} />
            </div>
          )}

          {/* Needs attention table */}
          {needsReview.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-foreground">Needs Attention</h2>
              <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Workflow</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Due</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Assignee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {needsReview.slice(0, 8).map((run) => {
                      const rs = REVIEW_STATUS[run.reviewStatus ?? 'none'] ?? REVIEW_STATUS.none
                      const overdue = run.dueDate && new Date(run.dueDate) < new Date()
                      return (
                        <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">{run.clientName ?? '—'}</td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{run.workflowName}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', rs.bg, rs.color)}>
                              <span className={cn('h-1.5 w-1.5 rounded-full', rs.dot)} />
                              {rs.label}
                            </span>
                          </td>
                          <td className={cn('px-4 py-2.5', overdue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                            {run.dueDate ? new Date(run.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                            {overdue && <span className="ml-1 text-[10px]">overdue</span>}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{run.assignee?.name ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {subTab === 'wrike' && (
        <>
          {wrikeFilterBar}
          <WrikeExecutiveTab
            tasks={wrikeTasks} folders={wrikeFolders} deliverables={deliverables}
            loading={wrikeLoading} notConnected={!wrikeConnected}
            error={wrikeError}
          />
        </>
      )}

      {subTab === 'monday' && <MondayTab />}
    </div>
  )
}

// ── Stakeholder View ───────────────────────────────────────────────────────────

const STAKEHOLDER_FILTERS = [
  { value: 'all',             label: 'All' },
  { value: 'none',            label: 'Needs Review' },
  { value: 'pending',         label: 'In Review' },
  { value: 'sent_to_client',  label: 'Sent to Client' },
  { value: 'client_responded',label: 'Client Responded' },
  { value: 'closed',          label: 'Closed' },
]

const STAKEHOLDER_SUBTABS = [
  { value: 'pipeline', label: 'Pipeline', icon: Icons.ClipboardList },
  { value: 'wrike',    label: 'Wrike',    icon: Icons.CheckSquare },
]

function StakeholderView({ clients, runs, wrikeTasks, wrikeFolders, wrikeLoading, wrikeConnected, wrikeFilterBar }: {
  clients: Client[]
  runs: Run[]
  wrikeTasks: WrikeTask[]
  wrikeFolders: WrikeFolder[]
  wrikeLoading: boolean
  wrikeConnected: boolean
  wrikeFilterBar: React.ReactNode
}) {
  const navigate = useNavigate()
  const [subTab, setSubTab] = useState('pipeline')
  const [filter, setFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')

  const activeClients = clients.filter((c) => c.status === 'active')
  const filtered = runs.filter((r) => {
    if (filter !== 'all' && r.reviewStatus !== filter) return false
    if (clientFilter !== 'all' && r.clientId !== clientFilter) return false
    return true
  })

  const statusCounts = STAKEHOLDER_FILTERS.slice(1).reduce<Record<string, number>>((acc, f) => {
    acc[f.value] = runs.filter((r) => r.reviewStatus === f.value).length
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      <SubTabToggle tabs={STAKEHOLDER_SUBTABS} active={subTab} onChange={setSubTab} />

      {subTab === 'pipeline' && (
        <>
          {/* Per-client summary row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {activeClients.slice(0, 10).map((client) => {
              const clientRuns = runs.filter((r) => r.clientId === client.id)
              const pending = clientRuns.filter((r) => r.reviewStatus === 'none' || r.reviewStatus === 'pending').length
              const health = clientHealth(client)
              const h = HEALTH[health]
              return (
                <button
                  key={client.id}
                  onClick={() => setClientFilter(clientFilter === client.id ? 'all' : client.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/30',
                    clientFilter === client.id ? 'border-blue-400 bg-blue-50/50' : 'border-border bg-white',
                  )}
                >
                  <div className={cn('h-2 w-2 rounded-full shrink-0', h.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{client.name}</p>
                    {pending > 0 ? <p className="text-[10px] text-orange-600 font-medium">{pending} pending</p> : <p className="text-[10px] text-muted-foreground">Up to date</p>}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {STAKEHOLDER_FILTERS.map((f) => {
              const count = f.value === 'all' ? runs.length : statusCounts[f.value] ?? 0
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                    filter === f.value ? 'border-blue-400 bg-blue-600 text-white' : 'border-border bg-white text-muted-foreground hover:border-blue-300 hover:text-foreground',
                  )}
                >
                  {f.label}
                  {count > 0 && (
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', filter === f.value ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground')}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            {clientFilter !== 'all' && (
              <button onClick={() => setClientFilter('all')} className="flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                <Icons.X className="h-3 w-3" />
                {clients.find((c) => c.id === clientFilter)?.name}
              </button>
            )}
          </div>

          {/* Deliverables table */}
          <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Icons.InboxIcon className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No deliverables match this filter</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Client</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Workflow</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Review Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Run Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Due Date</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Assignee</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Triggered</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((run) => {
                    const rs = REVIEW_STATUS[run.reviewStatus ?? 'none'] ?? REVIEW_STATUS.none
                    const overdue = run.dueDate && new Date(run.dueDate) < new Date()
                    const statusColor: Record<string, string> = { completed: 'text-emerald-600', running: 'text-blue-600', failed: 'text-red-600', pending: 'text-amber-600' }
                    return (
                      <tr key={run.id} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-4 py-3 font-medium text-foreground">{run.clientName ?? '—'}</td>
                        <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{run.workflowName}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', rs.bg, rs.color)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', rs.dot)} />
                            {rs.label}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3 capitalize font-medium', statusColor[run.status] ?? 'text-muted-foreground')}>{run.status}</td>
                        <td className={cn('px-4 py-3', overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                          {run.dueDate ? new Date(run.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          {overdue && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">overdue</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{run.assignee?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{run.triggeredByUser?.name ?? run.triggeredByUser?.email ?? '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/review/${run.id}`)}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
                            title="Open"
                          >
                            <Icons.ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {subTab === 'wrike' && (
        <>
          {wrikeFilterBar}
          <WrikeStakeholderTab
            tasks={wrikeTasks} folders={wrikeFolders}
            loading={wrikeLoading} notConnected={!wrikeConnected}
          />
        </>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function toDateInput(d: Date) {
  return d.toISOString().split('T')[0]
}

export function ClientPortalDashboard() {
  const [view, setView]               = useState<'executive' | 'stakeholder'>('executive')
  const [clients, setClients]         = useState<Client[]>([])
  const [runs, setRuns]               = useState<Run[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [wrikeFolders, setWrikeFolders] = useState<WrikeFolder[]>([])
  const [allWrikeTasks, setAllWrikeTasks] = useState<WrikeTask[]>([])
  const [wrikeLoading, setWrikeLoading] = useState(false)
  const [wrikeConnected, setWrikeConnected] = useState(false)
  const [loading, setLoading]         = useState(true)

  const [wrikeError, setWrikeError] = useState<string | null>(null)

  // Wrike filters
  const [wrikeStart,    setWrikeStart]    = useState(() => toDateInput(new Date(Date.now() - 90 * 86400000)))
  const [wrikeEnd,      setWrikeEnd]      = useState(() => toDateInput(new Date()))
  const [wrikeClientId,     setWrikeClientId]     = useState('all')
  const [wrikeProjectId,    setWrikeProjectId]    = useState('all')
  const [wrikeSubProjectId, setWrikeSubProjectId] = useState('all')
  const [useDates,      setUseDates]      = useState(true)

  // Same loading pattern as DeliverablesPage — Promise.allSettled so folders failure
  // doesn't silently swallow task data
  const loadWrikeData = useCallback(() => {
    setWrikeLoading(true)
    setWrikeError(null)
    Promise.allSettled([
      apiFetch('/api/v1/integrations/wrike/tasks').then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(`tasks ${r.status}: ${body?.error ?? r.statusText}`)
        return body
      }),
      apiFetch('/api/v1/integrations/wrike/folders').then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(`folders ${r.status}: ${body?.error ?? r.statusText}`)
        return body
      }),
    ])
      .then(([t, f]) => {
        if (t.status === 'fulfilled') setAllWrikeTasks(t.value?.data ?? [])
        else setWrikeError(t.reason?.message ?? 'Failed to load tasks')
        if (f.status === 'fulfilled') setWrikeFolders(f.value?.data ?? [])
        else setWrikeError((prev) => prev ?? f.reason?.message ?? 'Failed to load folders')
      })
      .finally(() => setWrikeLoading(false))
  }, [])

  useEffect(() => {
    Promise.all([
      apiFetch('/api/v1/clients').then((r) => r.json()),
      apiFetch('/api/v1/runs?limit=100').then((r) => r.json()),
      apiFetch('/api/v1/integrations/wrike/status').then((r) => r.json()),
      apiFetch('/api/v1/deliverables?limit=500&sort=dueDate&order=asc').then((r) => r.ok ? r.json() : { data: { runs: [] } }),
    ])
      .then(([clientRes, runRes, wrikeStatus, delRes]) => {
        setClients(clientRes.data ?? [])
        setRuns(runRes.data ?? [])
        setDeliverables(delRes.data?.runs ?? [])
        const connected = !!wrikeStatus.data?.connected
        setWrikeConnected(connected)
        if (connected) loadWrikeData()
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loadWrikeData])

  const runWrikeFilter = useCallback(() => {
    loadWrikeData()
  }, [loadWrikeData])

  // Classify folders by pipe count in title (0=client, 1=project, 2=sub-project)
  const WRIKE_SYS_TOP = new Set(['Root', 'Recycle Bin', 'My Work'])
  const pipeSeg = (title: string) => title.split('|').map((s) => s.trim())

  const wrikeClientFolders = wrikeFolders.filter(
    (f) => pipeSeg(f.title).length === 1 && !WRIKE_SYS_TOP.has(f.title)
  )
  const selectedClientTitle = wrikeClientFolders.find((f) => f.id === wrikeClientId)?.title ?? null
  const wrikeProjectFolders = wrikeFolders.filter((f) => {
    const segs = pipeSeg(f.title)
    if (segs.length !== 2) return false
    if (selectedClientTitle) return segs[0] === selectedClientTitle
    return true
  })
  const selectedProjectSegs = wrikeProjectFolders.find((f) => f.id === wrikeProjectId) ? pipeSeg(wrikeProjectFolders.find((f) => f.id === wrikeProjectId)!.title) : null
  const wrikeSubProjectFolders = wrikeFolders.filter((f) => {
    const segs = pipeSeg(f.title)
    if (segs.length !== 3) return false
    if (selectedProjectSegs) return segs[0] === selectedProjectSegs[0] && segs[1] === selectedProjectSegs[1]
    if (selectedClientTitle) return segs[0] === selectedClientTitle
    return true
  })

  // Client-side filtering: date + client + project + sub-project (most specific wins)
  const wrikeTasks = allWrikeTasks.filter((t) => {
    if (useDates && wrikeStart && wrikeEnd) {
      const d = t.updatedDate ?? t.createdDate
      if (d) {
        const ts = d.slice(0, 10)
        if (ts < wrikeStart || ts > wrikeEnd) return false
      }
    }
    const allAncestors = [...new Set([...(t.parentIds ?? []), ...(t.superParentIds ?? [])])]
    if (wrikeSubProjectId !== 'all') {
      if (!allAncestors.includes(wrikeSubProjectId)) return false
    } else if (wrikeProjectId !== 'all') {
      if (!allAncestors.includes(wrikeProjectId)) return false
    } else if (wrikeClientId !== 'all') {
      if (!allAncestors.includes(wrikeClientId)) return false
    }
    return true
  })

  const wrikeFilterBar = (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-3 shadow-sm">
      {/* Client */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Client</label>
        <select
          className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 min-w-[160px]"
          value={wrikeClientId}
          onChange={(e) => { setWrikeClientId(e.target.value); setWrikeProjectId('all'); setWrikeSubProjectId('all') }}
        >
          <option value="all">All clients</option>
          {wrikeClientFolders.map((f) => (
            <option key={f.id} value={f.id}>{f.title}</option>
          ))}
        </select>
      </div>

      {/* Project */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Project</label>
        <select
          className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 min-w-[180px]"
          value={wrikeProjectId}
          onChange={(e) => { setWrikeProjectId(e.target.value); setWrikeSubProjectId('all') }}
        >
          <option value="all">All projects</option>
          {wrikeProjectFolders.map((f) => {
            const segs = pipeSeg(f.title)
            return <option key={f.id} value={f.id}>{segs[segs.length - 1]}</option>
          })}
        </select>
      </div>

      {/* Sub-project */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sub-project</label>
        <select
          className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 min-w-[200px]"
          value={wrikeSubProjectId}
          onChange={(e) => setWrikeSubProjectId(e.target.value)}
        >
          <option value="all">All sub-projects</option>
          {wrikeSubProjectFolders.map((f) => {
            const segs = pipeSeg(f.title)
            return <option key={f.id} value={f.id}>{segs[1]} | {segs[2]}</option>
          })}
        </select>
      </div>

      {/* Date range toggle + pickers */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide cursor-pointer">
          <input type="checkbox" checked={useDates} onChange={(e) => setUseDates(e.target.checked)} className="accent-blue-500" />
          Filter by Date Updated
        </label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={wrikeStart}
            onChange={(e) => setWrikeStart(e.target.value)}
            disabled={!useDates}
            className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="text-[10px] text-muted-foreground">to</span>
          <input
            type="date"
            value={wrikeEnd}
            onChange={(e) => setWrikeEnd(e.target.value)}
            disabled={!useDates}
            className="h-8 rounded-lg border border-border bg-muted/20 px-2 text-xs outline-none focus:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={runWrikeFilter}
        disabled={wrikeLoading}
        className="flex h-8 items-center gap-1.5 rounded-lg px-4 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: '#185fa5' }}
      >
        {wrikeLoading
          ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
          : <><Icons.RefreshCw className="h-3.5 w-3.5" /> Run</>
        }
      </button>
    </div>
  )

  return (
    <div className="flex h-full flex-col overflow-auto bg-background">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Client Dashboard</h1>
            <p className="text-xs text-muted-foreground">Portfolio overview and delivery pipeline</p>
          </div>
          {/* View toggle */}
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setView('executive')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                view === 'executive' ? 'bg-white shadow-sm text-foreground border border-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icons.LayoutDashboard className="h-3.5 w-3.5" />
              Executive View
            </button>
            <button
              onClick={() => setView('stakeholder')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                view === 'stakeholder' ? 'bg-white shadow-sm text-foreground border border-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icons.Users className="h-3.5 w-3.5" />
              Stakeholder View
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6">
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Icons.Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading dashboard…</span>
          </div>
        ) : view === 'executive' ? (
          <ExecutiveView
            clients={clients} runs={runs} deliverables={deliverables}
            wrikeTasks={wrikeTasks} wrikeFolders={wrikeFolders}
            wrikeLoading={wrikeLoading} wrikeConnected={wrikeConnected}
            wrikeError={wrikeError} wrikeFilterBar={wrikeFilterBar}
          />
        ) : (
          <StakeholderView
            clients={clients} runs={runs}
            wrikeTasks={wrikeTasks} wrikeFolders={wrikeFolders}
            wrikeLoading={wrikeLoading} wrikeConnected={wrikeConnected}
            wrikeFilterBar={wrikeFilterBar}
          />
        )}
      </div>
    </div>
  )
}
