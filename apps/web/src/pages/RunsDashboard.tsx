import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Run {
  id: string
  workflowId: string
  workflowName: string
  projectName: string | null
  itemName: string | null
  clientId: string | null
  clientName: string | null
  status: string
  triggeredBy: string | null
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  createdAt: string
  finalOutput: unknown
  batchId: string | null
  batchIndex: number | null
  reviewStatus: string
}

interface Meta {
  total: number
  stats: Record<string, number>
}

interface Client {
  id: string
  name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  pending:          { label: 'Pending',          icon: Icons.Clock,         color: 'text-slate-600',   bg: 'bg-slate-100 border-slate-300'   },
  running:          { label: 'Running',           icon: Icons.Loader2,       color: 'text-blue-700',    bg: 'bg-blue-100 border-blue-300'     },
  completed:        { label: 'Completed',         icon: Icons.CheckCircle2,  color: 'text-[#3b6d11]',   bg: 'bg-[#d0e8b0] border-[#3b6d11]'  },
  failed:           { label: 'Failed',            icon: Icons.XCircle,       color: 'text-red-700',     bg: 'bg-red-100 border-red-300'       },
  waiting_feedback: { label: 'Waiting feedback',  icon: Icons.MessageSquare, color: 'text-amber-700',   bg: 'bg-amber-100 border-amber-300'   },
  waiting_review:   { label: 'Waiting review',    icon: Icons.Eye,           color: 'text-purple-700',  bg: 'bg-purple-100 border-purple-300' },
  awaiting_assignment: { label: 'Awaiting assign',icon: Icons.UserCheck,     color: 'text-cyan-700',    bg: 'bg-cyan-100 border-cyan-300'     },
  cancelled:        { label: 'Cancelled',         icon: Icons.Ban,           color: 'text-slate-500',   bg: 'bg-slate-100 border-slate-300'   },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, icon: Icons.Circle, color: 'text-muted-foreground', bg: 'bg-muted border-border' }
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium', cfg.bg, cfg.color)}>
      <Icon className={cn('h-2.5 w-2.5', status === 'running' && 'animate-spin')} />
      {cfg.label}
    </span>
  )
}

function duration(start: string | null, end: string | null): string {
  if (!start) return '—'
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  if (ms < 1000) return '<1s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function extractPreview(output: unknown): string {
  if (!output) return ''
  if (typeof output === 'string') return output.slice(0, 300)
  const o = output as Record<string, unknown>
  if (typeof o.content === 'string') return o.content.slice(0, 300)
  if (typeof o.text === 'string') return o.text.slice(0, 300)
  return ''
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color, onClick, active,
}: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>
  color: string; onClick: () => void; active: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-xl border p-4 text-left transition-all',
        active ? 'border-blue-400 bg-blue-50' : 'border-border bg-card hover:border-border/60 hover:bg-card/80',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
    </button>
  )
}

// ── Review status dot ─────────────────────────────────────────────────────────

const REVIEW_DOTS: Record<string, { color: string; label: string }> = {
  pending:          { color: 'bg-blue-400',    label: 'Agency reviewed' },
  sent_to_client:   { color: 'bg-purple-400',  label: 'Sent to client' },
  client_responded: { color: 'bg-emerald-400', label: 'Client responded' },
  closed:           { color: 'bg-slate-500',   label: 'Closed' },
}

function ReviewStatusDot({ status }: { status: string }) {
  const cfg = REVIEW_DOTS[status]
  if (!cfg) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.color)} />
      {cfg.label}
    </span>
  )
}

// ── Run row ───────────────────────────────────────────────────────────────────

function RunRow({
  run, expanded, onToggle, onCancel, onRerun, cancelling, rerunning,
}: {
  run: Run
  expanded: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onRerun: (id: string) => void
  cancelling: string | null
  rerunning: string | null
}) {
  const navigate = useNavigate()
  const preview = extractPreview(run.finalOutput)
  const isActive = ['pending', 'running'].includes(run.status)
  const canCancel = ['pending', 'running', 'waiting_feedback'].includes(run.status)
  const canRerun = ['completed', 'failed', 'cancelled'].includes(run.status)
  const canReview = run.status === 'completed'
  const reviewStatus = run.reviewStatus ?? 'none'

  return (
    <div className={cn('border-b border-border last:border-0', expanded && 'bg-muted/10')}>
      {/* Main row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-muted/20 transition-colors"
      >
        {/* Status */}
        <div className="w-36 shrink-0">
          <StatusBadge status={run.status} />
        </div>

        {/* Workflow + client */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{run.workflowName}</p>
          <div className="flex items-center gap-2">
            {run.clientName && (
              <p className="text-xs text-muted-foreground truncate">{run.clientName}</p>
            )}
            {canReview && reviewStatus !== 'none' && (
              <ReviewStatusDot status={reviewStatus} />
            )}
          </div>
        </div>

        {/* Duration */}
        <div className="w-20 shrink-0 text-right">
          <p className="text-xs font-mono text-muted-foreground">
            {isActive ? <span className="text-blue-400">{duration(run.startedAt, null)}</span> : duration(run.startedAt, run.completedAt)}
          </p>
        </div>

        {/* Time */}
        <div className="w-24 shrink-0 text-right text-xs text-muted-foreground">
          {timeAgo(run.createdAt)}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canReview && (
            <Button
              variant="ghost" size="sm"
              className={cn(
                'h-7 w-7 p-0',
                reviewStatus !== 'none' ? 'text-purple-600 hover:text-purple-700' : 'text-muted-foreground hover:text-purple-600',
              )}
              title={reviewStatus !== 'none' ? 'View review' : 'Review outputs'}
              onClick={() => navigate(`/review/${run.id}`)}
            >
              <Icons.ClipboardEdit className="h-3.5 w-3.5" />
            </Button>
          )}
          {canRerun && (
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-400"
              title="Re-run workflow"
              disabled={rerunning === run.id}
              onClick={() => onRerun(run.id)}
            >
              {rerunning === run.id
                ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Icons.RotateCcw className="h-3.5 w-3.5" />}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
              title="Cancel run"
              disabled={cancelling === run.id}
              onClick={() => onCancel(run.id)}
            >
              {cancelling === run.id
                ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Icons.Square className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="Open workflow"
            onClick={() => navigate(`/workflows/${run.workflowId}`)}
          >
            <Icons.ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Icons.ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/50 px-5 py-4 space-y-3">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground mb-0.5">Run ID</p>
              <p className="font-mono text-[11px] text-foreground/70 truncate">{run.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Started</p>
              <p>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Completed</p>
              <p>{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Triggered by</p>
              <p className="capitalize">{run.triggeredBy ?? 'manual'}</p>
            </div>
          </div>

          {run.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700 font-medium mb-0.5">Error</p>
              <p className="text-xs text-red-600">{run.errorMessage}</p>
            </div>
          )}

          {preview ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Output Preview</p>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap line-clamp-6">{preview}</p>
            </div>
          ) : !run.errorMessage && (
            <p className="text-xs text-muted-foreground italic">No output content yet</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Batch group ───────────────────────────────────────────────────────────────

function batchSummaryStatus(runs: Run[]): string {
  if (runs.some((r) => r.status === 'running')) return 'running'
  if (runs.some((r) => r.status === 'pending')) return 'pending'
  if (runs.some((r) => r.status === 'failed')) return 'failed'
  if (runs.every((r) => r.status === 'completed')) return 'completed'
  return runs[0]?.status ?? 'pending'
}

function BatchGroup({
  batchId, runs, expanded, onToggle, onCancel, onRerun, cancelling, rerunning,
}: {
  batchId: string
  runs: Run[]
  expanded: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onRerun: (id: string) => void
  cancelling: string | null
  rerunning: string | null
}) {
  const completedCount = runs.filter((r) => r.status === 'completed').length
  const runningCount = runs.filter((r) => ['running', 'pending'].includes(r.status)).length
  const failedCount = runs.filter((r) => r.status === 'failed').length
  const summaryStatus = batchSummaryStatus(runs)

  const parts: string[] = []
  if (completedCount > 0) parts.push(`${completedCount} completed`)
  if (runningCount > 0) parts.push(`${runningCount} running`)
  if (failedCount > 0) parts.push(`${failedCount} failed`)
  const summary = parts.join(', ')

  return (
    <div className="border-b border-border last:border-0">
      {/* Batch header row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-muted/20 transition-colors bg-muted/5"
      >
        <div className="w-36 shrink-0">
          <StatusBadge status={summaryStatus} />
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <Icons.Layers className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <span className="text-sm font-medium">
            Batch · {runs.length} run{runs.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-muted-foreground truncate">· {summary}</span>
          <span className="ml-1 font-mono text-[10px] text-muted-foreground/50">{batchId.slice(0, 8)}…</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Icons.ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {/* Indented child runs */}
      {expanded && (
        <div className="border-t border-border/40 pl-6">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={false}
              onToggle={() => {}}
              onCancel={onCancel}
              onRerun={onRerun}
              cancelling={cancelling}
              rerunning={rerunning}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Status tabs ───────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: 'all',              label: 'All' },
  { value: 'running',          label: 'Running' },
  { value: 'pending',          label: 'Pending' },
  { value: 'waiting_feedback', label: 'Waiting' },
  { value: 'completed',        label: 'Completed' },
  { value: 'failed',           label: 'Failed' },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export function RunsDashboard() {
  const [runs, setRuns] = useState<Run[]>([])
  const [meta, setMeta] = useState<Meta>({ total: 0, stats: {} })
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchRuns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (clientFilter !== 'all') params.set('clientId', clientFilter)
      const res = await apiFetch(`/api/v1/runs?${params}`)
      const { data, meta: m } = await res.json()
      setRuns(data ?? [])
      setMeta(m ?? { total: 0, stats: {} })
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false)
    }
  }, [statusFilter, clientFilter])

  // Load clients for filter dropdown
  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then((json) => {
        const list = json?.data ?? []
        setClients(list.filter((c: { status?: string }) => c.status !== 'archived'))
      })
      .catch(console.error)
  }, [])

  // Fetch runs when filters change
  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  // Auto-refresh while active runs exist
  useEffect(() => {
    const hasActive = runs.some((r) => ['pending', 'running'].includes(r.status))
    if (hasActive) {
      pollRef.current = setInterval(() => fetchRuns(true), 4000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [runs, fetchRuns])

  const handleCancel = async (id: string) => {
    setCancelling(id)
    try {
      await apiFetch(`/api/v1/runs/${id}/cancel`, { method: 'POST' })
      await fetchRuns(true)
    } catch {
      // ignore
    } finally {
      setCancelling(null)
    }
  }

  const handleRerun = async (id: string) => {
    setRerunning(id)
    try {
      const run = runs.find((r) => r.id === id)
      if (!run) return
      const res = await apiFetch('/api/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: run.workflowId }),
      })
      if (res.ok) await fetchRuns(true)
    } catch {
      // ignore
    } finally {
      setRerunning(null)
    }
  }

  const stats = meta.stats
  const activeCount = (stats.running ?? 0) + (stats.pending ?? 0)
  const waitingCount = (stats.waiting_feedback ?? 0) + (stats.waiting_review ?? 0) + (stats.awaiting_assignment ?? 0)
  const failedCount = stats.failed ?? 0
  const completedCount = stats.completed ?? 0

  const filteredRuns = runs.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.workflowName.toLowerCase().includes(q) ||
      (r.clientName ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.ClipboardEdit className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Reviews</h1>
          <Badge variant="outline" className="text-xs">{meta.total}</Badge>
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <Icons.Loader2 className="h-3 w-3 animate-spin" />
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fetchRuns()}>
            <Icons.RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-3 px-6 pt-5 pb-4">
          <StatCard label="Active now" value={activeCount} icon={Icons.Loader2} color="text-blue-400"
            active={statusFilter === 'running'} onClick={() => setStatusFilter(statusFilter === 'running' ? 'all' : 'running')} />
          <StatCard label="Waiting" value={waitingCount} icon={Icons.MessageSquare} color="text-amber-400"
            active={statusFilter === 'waiting_feedback'} onClick={() => setStatusFilter(statusFilter === 'waiting_feedback' ? 'all' : 'waiting_feedback')} />
          <StatCard label="Failed" value={failedCount} icon={Icons.XCircle} color="text-red-400"
            active={statusFilter === 'failed'} onClick={() => setStatusFilter(statusFilter === 'failed' ? 'all' : 'failed')} />
          <StatCard label="Completed" value={completedCount} icon={Icons.CheckCircle2} color="text-emerald-400"
            active={statusFilter === 'completed'} onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')} />
        </div>

        {/* Filters bar */}
        <div className="flex items-center gap-3 border-b border-border px-6 pb-3">
          {/* Status tabs */}
          <div className="flex gap-0 rounded-lg border border-border bg-muted/30 p-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  statusFilter === tab.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {tab.value !== 'all' && stats[tab.value] != null && stats[tab.value] > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                    {stats[tab.value]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Client filter */}
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="h-7 rounded-md border border-border bg-muted/30 px-2 text-xs text-foreground focus:outline-none"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <span className="ml-auto text-xs text-muted-foreground">{filteredRuns.length} review{filteredRuns.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Run list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icons.Play className="mb-3 h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">
              {statusFilter !== 'all' || clientFilter !== 'all' || search
                ? 'No runs match your filters'
                : 'No runs yet — trigger a workflow to get started'}
            </p>
          </div>
        ) : (
          <div className="mx-6 mt-4 rounded-xl border border-border bg-card overflow-hidden">
            {/* Table header */}
            <div className="flex items-center gap-4 border-b border-border bg-muted/20 px-5 py-2">
              <div className="w-36 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Status</div>
              <div className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Workflow / Client</div>
              <div className="w-20 shrink-0 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Duration</div>
              <div className="w-24 shrink-0 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Created</div>
              <div className="w-24 shrink-0" />
            </div>

            {(() => {
              // Group runs by batchId; standalone runs (no batchId) render normally
              const batchMap = new Map<string, Run[]>()
              const renderedBatches = new Set<string>()
              const rows: React.ReactNode[] = []

              for (const run of filteredRuns) {
                if (run.batchId) {
                  if (!batchMap.has(run.batchId)) batchMap.set(run.batchId, [])
                  batchMap.get(run.batchId)!.push(run)
                }
              }

              for (const run of filteredRuns) {
                if (run.batchId) {
                  if (renderedBatches.has(run.batchId)) continue
                  renderedBatches.add(run.batchId)
                  const batchRuns = (batchMap.get(run.batchId) ?? []).sort(
                    (a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0),
                  )
                  rows.push(
                    <BatchGroup
                      key={`batch-${run.batchId}`}
                      batchId={run.batchId}
                      runs={batchRuns}
                      expanded={expandedBatches.has(run.batchId)}
                      onToggle={() =>
                        setExpandedBatches((prev) => {
                          const next = new Set(prev)
                          if (next.has(run.batchId!)) next.delete(run.batchId!)
                          else next.add(run.batchId!)
                          return next
                        })
                      }
                      onCancel={handleCancel}
                      onRerun={handleRerun}
                      cancelling={cancelling}
                      rerunning={rerunning}
                    />,
                  )
                } else {
                  rows.push(
                    <RunRow
                      key={run.id}
                      run={run}
                      expanded={expanded === run.id}
                      onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
                      onCancel={handleCancel}
                      onRerun={handleRerun}
                      cancelling={cancelling}
                      rerunning={rerunning}
                    />,
                  )
                }
              }
              return rows
            })()}
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  )
}
