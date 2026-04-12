import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { ReportsDashboard } from './ReportsDashboard'

// downloadCSV - inline utility (avoids re-export dependency)
function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => {
        const v = String(r[h] ?? '')
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
      }).join(',')
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

const SENTIMENT_COLORS: Record<string, string> = {
  approved: '#10b981',
  approved_with_changes: '#3b82f6',
  needs_revision: '#f59e0b',
  rejected: '#ef4444',
  no_decision: '#6b7280',
}

interface StakeholderStat {
  id: string
  name: string
  email: string
  role: string | null
  seniority: string
  totalFeedback: number
  totalCorrections: number
  avgRating: number | null
  decisions: Record<string, number>
  tones: Record<string, number>
  tags: Record<string, number>
  lastActive: string | null
}

function Section({ title, icon: Icon, onDownload, children, defaultCollapsed = false }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  onDownload?: () => void
  children: React.ReactNode
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {onDownload && !collapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              onClick={(e) => { e.stopPropagation(); onDownload() }}
            >
              <Icons.Download className="h-3 w-3" />
              CSV
            </Button>
          )}
          <Icons.ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>
      {!collapsed && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map((i) => (
        <Icons.Star key={i} className={`h-3 w-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground'}`} />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{rating}</span>
    </div>
  )
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function ClientReportsTab({ clientId }: { clientId: string }) {
  const today = new Date()
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30)
  const [startDate, setStartDate] = useState(toISODate(thirtyDaysAgo))
  const [endDate, setEndDate] = useState(toISODate(today))
  const [stakeholderStats, setStakeholderStats] = useState<StakeholderStat[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<'name' | 'totalFeedback' | 'totalCorrections' | 'avgRating' | 'lastActive'>('totalFeedback')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // days between start and end for components that take a days param
  const days = String(Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)))

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/v1/clients/${clientId}/stakeholder-stats?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => r.json())
      .then(({ data }) => { setStakeholderStats(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, startDate, endDate])

  const csvRows = stakeholderStats.map((s) => ({
    name: s.name,
    email: s.email,
    role: s.role ?? '',
    seniority: s.seniority,
    totalFeedback: s.totalFeedback,
    totalCorrections: s.totalCorrections,
    avgRating: s.avgRating ?? '',
    approved: s.decisions['approved'] ?? 0,
    approved_with_changes: s.decisions['approved_with_changes'] ?? 0,
    needs_revision: s.decisions['needs_revision'] ?? 0,
    rejected: s.decisions['rejected'] ?? 0,
    lastActive: s.lastActive ? new Date(s.lastActive).toLocaleDateString() : '',
  }))

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex items-center justify-end gap-2">
        <Icons.Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => setStartDate(e.target.value)}

          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={endDate}
          min={startDate}
          max={toISODate(new Date())}
          onChange={(e) => setEndDate(e.target.value)}

          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Stakeholder Activity */}
      <Section
        title="Stakeholder Activity"
        icon={Icons.Users}
        onDownload={() => downloadCSV('stakeholder-activity.csv', csvRows)}
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : stakeholderStats.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No stakeholder feedback yet</p>
        ) : (
          <div className="space-y-2">
            {/* Sort bar */}
            <div className="flex items-center gap-1 pb-1 text-[10px] text-muted-foreground">
              <span className="mr-1">Sort:</span>
              {([['name', 'Name'], ['totalFeedback', 'Reviews'], ['totalCorrections', 'Corrections'], ['avgRating', 'Rating'], ['lastActive', 'Last Active']] as const).map(([col, label]) => (
                <button
                  key={col}
                  onClick={() => { setSortCol(col); setSortDir(sortCol === col && sortDir === 'desc' ? 'asc' : 'desc') }}
                  className={`inline-flex items-center gap-0.5 rounded px-2 py-0.5 transition-colors ${sortCol === col ? 'bg-blue-100 text-blue-700' : 'hover:bg-muted'}`}
                >
                  {label}
                  {sortCol === col && (sortDir === 'desc' ? <Icons.ChevronDown className="h-2.5 w-2.5" /> : <Icons.ChevronUp className="h-2.5 w-2.5" />)}
                </button>
              ))}
            </div>
            {[...stakeholderStats].sort((a, b) => {
              let cmp = 0
              if (sortCol === 'name') cmp = a.name.localeCompare(b.name)
              else if (sortCol === 'totalFeedback') cmp = a.totalFeedback - b.totalFeedback
              else if (sortCol === 'totalCorrections') cmp = a.totalCorrections - b.totalCorrections
              else if (sortCol === 'avgRating') cmp = (a.avgRating ?? -1) - (b.avgRating ?? -1)
              else if (sortCol === 'lastActive') cmp = (a.lastActive ? new Date(a.lastActive).getTime() : 0) - (b.lastActive ? new Date(b.lastActive).getTime() : 0)
              return sortDir === 'asc' ? cmp : -cmp
            }).map((s) => {
              const isExpanded = expanded === s.id
              const decisionData = Object.entries(s.decisions).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v, key: k }))
              const tagData = Object.entries(s.tags).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v })).sort((a, b) => b.count - a.count)
              const toneData = Object.entries(s.tones).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v }))

              return (
                <div key={s.id} className="rounded-lg border border-border bg-background overflow-hidden">
                  {/* Row header */}
                  <button
                    className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : s.id)}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {s.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.role ? `${s.role} · ` : ''}{s.email}</p>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-center">
                        <p className="text-sm font-semibold">{s.totalFeedback}</p>
                        <p className="text-[10px] text-muted-foreground">reviews</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold">{s.totalCorrections}</p>
                        <p className="text-[10px] text-muted-foreground">corrections</p>
                      </div>
                      <div className="text-center min-w-[80px]">
                        <StarRating rating={s.avgRating} />
                        <p className="text-[10px] text-muted-foreground">avg rating</p>
                      </div>
                      <div className="text-[10px] text-muted-foreground min-w-[60px] text-right">
                        {s.lastActive ? new Date(s.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}
                      </div>
                      <Icons.ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/20">
                      {/* Decisions */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Decisions</p>
                        {decisionData.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No decisions yet</p>
                        ) : (
                          <div className="space-y-1.5">
                            {decisionData.map(({ label, count, key }) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: SENTIMENT_COLORS[key] ?? '#6b7280' }} />
                                  <span className="text-xs capitalize truncate">{label}</span>
                                </div>
                                <span className="text-xs font-semibold shrink-0">{count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Tone preferences */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tone Feedback</p>
                        {toneData.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No tone feedback yet</p>
                        ) : (
                          <ResponsiveContainer width="100%" height={100}>
                            <BarChart data={toneData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                              <XAxis type="number" hide />
                              <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: '#71717a' }} width={80} />
                              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', fontSize: 10, borderRadius: 6 }} />
                              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                                {toneData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>

                      {/* Content tags */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Content Tags</p>
                        {tagData.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No content tags yet</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {tagData.map(({ label, count }) => (
                              <span key={label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
                                {label}
                                <span className="font-semibold text-muted-foreground">x{count}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Reuse the full dashboard filtered to this client */}
      <ReportsDashboard clientId={clientId} startDate={startDate} endDate={endDate} showFilters={false} />
    </div>
  )
}
