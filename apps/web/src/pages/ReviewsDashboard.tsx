import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReviewRun {
  id: string
  workflowName: string
  projectName: string | null
  itemName: string | null
  clientName: string | null
  reviewStatus: string
  completedAt: string | null
  createdAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  none:             { label: 'Needs review',     color: 'text-orange-600',  dot: 'bg-orange-400',   bg: 'bg-orange-50 border-orange-200' },
  pending:          { label: 'In review',        color: 'text-blue-600',    dot: 'bg-blue-500',     bg: 'bg-blue-50 border-blue-200' },
  sent_to_client:   { label: 'Sent to client',   color: 'text-purple-600',  dot: 'bg-purple-500',   bg: 'bg-purple-50 border-purple-200' },
  client_responded: { label: 'Client responded', color: 'text-emerald-600', dot: 'bg-emerald-500',  bg: 'bg-emerald-50 border-emerald-200' },
  closed:           { label: 'Closed',           color: 'text-slate-500',   dot: 'bg-slate-400',    bg: 'bg-slate-50 border-slate-200' },
}

const FILTERS = [
  { value: 'all',             label: 'All' },
  { value: 'none',            label: 'Needs review' },
  { value: 'pending',         label: 'In review' },
  { value: 'sent_to_client',  label: 'Sent to client' },
  { value: 'client_responded',label: 'Client responded' },
  { value: 'closed',          label: 'Closed' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReviewsDashboard() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ReviewRun[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    apiFetch('/api/v1/runs?status=completed&limit=200')
      .then((r) => r.json())
      .then(({ data }) => { setRuns(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = runs.filter((r) => {
    if (filter !== 'all' && r.reviewStatus !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      const name = [r.clientName, r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' ').toLowerCase()
      if (!name.includes(q)) return false
    }
    return true
  })

  // Stat counts
  const counts: Record<string, number> = {}
  for (const r of runs) counts[r.reviewStatus] = (counts[r.reviewStatus] ?? 0) + 1

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.ClipboardEdit className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Reviews</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{runs.length}</span>
        </div>
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 w-48 rounded-md border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {/* Stat cards */}
        <div className="grid grid-cols-5 gap-3 px-6 pt-5 pb-4">
          {(['none', 'pending', 'sent_to_client', 'client_responded', 'closed'] as const).map((s) => {
            const cfg = STATUS_CONFIG[s]
            const count = counts[s] ?? 0
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? 'all' : s)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  filter === s ? cfg.bg : 'border-border bg-card hover:border-blue-300/60',
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                  <span className="text-[11px] text-muted-foreground">{cfg.label}</span>
                </div>
                <p className={cn('text-xl font-semibold', filter === s ? cfg.color : 'text-foreground')}>{count}</p>
              </button>
            )
          })}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 border-b border-border px-6 pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
              )}
            >
              {f.label}
              {f.value !== 'all' && (counts[f.value] ?? 0) > 0 && (
                <span className="ml-1.5 opacity-70">{counts[f.value]}</span>
              )}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} review{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Icons.ClipboardEdit className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No reviews match your search.' : filter !== 'all' ? 'No reviews in this stage.' : 'No completed runs to review yet.'}
            </p>
          </div>
        ) : (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Review</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Completed</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtered.map((r) => {
                    const cfg = STATUS_CONFIG[r.reviewStatus] ?? STATUS_CONFIG.none
                    const title = [r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' — ')
                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate(`/review/${r.id}`)}
                        className="cursor-pointer hover:bg-accent/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-foreground/90 max-w-xs truncate">{title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.clientName ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1.5 font-medium', cfg.color)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.completedAt ? formatDate(r.completedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-muted-foreground/50 group-hover:text-muted-foreground">
                            <Icons.ChevronRight className="h-3.5 w-3.5 inline" />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
