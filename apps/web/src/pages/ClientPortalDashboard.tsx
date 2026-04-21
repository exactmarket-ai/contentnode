import { useState, useEffect } from 'react'
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Sub-components ─────────────────────────────────────────────────────────────

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

// ── Executive View ─────────────────────────────────────────────────────────────

function ExecutiveView({ clients, runs }: { clients: Client[]; runs: Run[] }) {
  const navigate = useNavigate()
  const activeClients = clients.filter((c) => c.status === 'active')
  const totalWorkflows = activeClients.reduce((s, c) => s + c.workflowCount, 0)
  const needsReview = runs.filter((r) => r.reviewStatus === 'none' || r.reviewStatus === 'pending')
  const completedThisWeek = runs.filter((r) => r.status === 'completed' && isWithinDays(r.completedAt, 7))

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Icons.Users}        label="Active Clients"       value={activeClients.length}      sub="currently active"         color="#185fa5" />
        <KpiCard icon={Icons.Workflow}     label="Total Workflows"      value={totalWorkflows}             sub="across all clients"       color="#7c3aed" />
        <KpiCard icon={Icons.ClipboardEdit}label="Pending Review"       value={needsReview.length}         sub="awaiting action"          color="#d97706" />
        <KpiCard icon={Icons.CheckCircle2} label="Completed This Week"  value={completedThisWeek.length}   sub="in the last 7 days"       color="#059669" />
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
                {/* Health bar accent */}
                <div className="h-1 w-full" style={{ backgroundColor: h.bar }} />

                <div className="p-4">
                  {/* Header row */}
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

                  {/* Metrics row */}
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

                  {/* Footer */}
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

      {/* Activity summary — runs needing action */}
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

function StakeholderView({ clients, runs }: { clients: Client[]; runs: Run[] }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')

  const filtered = runs.filter((r) => {
    if (filter !== 'all' && r.reviewStatus !== filter) return false
    if (clientFilter !== 'all' && r.clientId !== clientFilter) return false
    return true
  })

  const activeClients = clients.filter((c) => c.status === 'active')

  const statusCounts = STAKEHOLDER_FILTERS.slice(1).reduce<Record<string, number>>((acc, f) => {
    acc[f.value] = runs.filter((r) => r.reviewStatus === f.value).length
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
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
                {pending > 0 && <p className="text-[10px] text-orange-600 font-medium">{pending} pending</p>}
                {pending === 0 && <p className="text-[10px] text-muted-foreground">Up to date</p>}
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
                filter === f.value
                  ? 'border-blue-400 bg-blue-600 text-white'
                  : 'border-border bg-white text-muted-foreground hover:border-blue-300 hover:text-foreground',
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
                const statusColor: Record<string, string> = {
                  completed: 'text-emerald-600',
                  running: 'text-blue-600',
                  failed: 'text-red-600',
                  pending: 'text-amber-600',
                }
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
                    <td className={cn('px-4 py-3 capitalize font-medium', statusColor[run.status] ?? 'text-muted-foreground')}>
                      {run.status}
                    </td>
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
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function ClientPortalDashboard() {
  const [view, setView]       = useState<'executive' | 'stakeholder'>('executive')
  const [clients, setClients] = useState<Client[]>([])
  const [runs, setRuns]       = useState<Run[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/v1/clients').then((r) => r.json()),
      apiFetch('/api/v1/runs?limit=100').then((r) => r.json()),
    ])
      .then(([clientRes, runRes]) => {
        setClients((clientRes.data ?? []).filter((c: Client) => c.status === 'active' || c.status === undefined))
        setRuns(runRes.data ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

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
                view === 'executive'
                  ? 'bg-white shadow-sm text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icons.LayoutDashboard className="h-3.5 w-3.5" />
              Executive View
            </button>
            <button
              onClick={() => setView('stakeholder')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                view === 'stakeholder'
                  ? 'bg-white shadow-sm text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground',
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
          <ExecutiveView clients={clients} runs={runs} />
        ) : (
          <StakeholderView clients={clients} runs={runs} />
        )}
      </div>
    </div>
  )
}
