import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// CSV utility (exported so callers can use it too)
// ─────────────────────────────────────────────────────────────────────────────

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

const SENTIMENT_COLORS: Record<string, string> = {
  approved:              '#10b981',
  approved_with_changes: '#3b82f6',
  needs_revision:        '#f59e0b',
  rejected:              '#ef4444',
  no_decision:           '#6b7280',
}

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, onDownload, children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  onDownload: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5" onClick={onDownload}>
          <Icons.Download className="h-3 w-3" />
          CSV
        </Button>
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-xl text-xs">
      {label && <p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-semibold">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = 'text-foreground' }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Overview {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  successRate: number
  waitingFeedback: number
  waitingApproval: number
  totalOutputs: number
  feedbackCount: number
  avgCompletionMins: number
}

interface RunsOverTime { date: string; completed: number; failed: number; total: number }
interface SentimentRow { sentiment: string; count: number }
interface TokenRow { model: string; tokens: number }
interface OutputTypeRow { type: string; count: number }
interface DetectionRow { label: string; count: number }
interface TopWorkflow { id: string; name: string; client: string; totalRuns: number; periodRuns: number; completed: number; failed: number; successRate: number; tokens: number }
interface HumanizerRow { service: string; words: number }

interface Client { id: string; name: string }

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ReportsDashboardProps {
  clientId?: string
  days?: string
  startDate?: string
  endDate?: string
  showFilters?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

function toISODate(d: Date) { return d.toISOString().slice(0, 10) }

export function ReportsDashboard({ clientId: propClientId, days: propDays, startDate: propStart, endDate: propEnd, showFilters = true }: ReportsDashboardProps) {
  const today = new Date()
  const thirtyAgo = new Date(today); thirtyAgo.setDate(today.getDate() - 30)
  const [internalStart, setInternalStart] = useState(toISODate(thirtyAgo))
  const [internalEnd, setInternalEnd] = useState(toISODate(today))
  const [internalClientId, setInternalClientId] = useState('')
  const [clients, setClients] = useState<Client[]>([])

  const startDate = propStart ?? internalStart
  const endDate = propEnd ?? internalEnd
  const clientId = propClientId ?? internalClientId
  // Legacy days param for API compat — compute from date range
  const days = propDays ?? String(Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)))

  const [overview, setOverview] = useState<Overview | null>(null)
  const [runsOverTime, setRunsOverTime] = useState<RunsOverTime[]>([])
  const [sentiment, setSentiment] = useState<SentimentRow[]>([])
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [outputTypes, setOutputTypes] = useState<OutputTypeRow[]>([])
  const [detection, setDetection] = useState<DetectionRow[]>([])
  const [topWorkflows, setTopWorkflows] = useState<TopWorkflow[]>([])
  const [humanizer, setHumanizer] = useState<HumanizerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<keyof TopWorkflow>('periodRuns')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Load client list for filter (only when showing client filter)
  useEffect(() => {
    if (showFilters && !propClientId) {
      apiFetch('/api/v1/clients').then((r) => r.json()).then(({ data }) => setClients(data ?? []))
    }
  }, [showFilters, propClientId])

  const params = `?days=${days}${clientId ? `&clientId=${clientId}` : ''}`

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`/api/v1/reports/overview${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/runs-over-time${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/feedback-sentiment${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/tokens-by-model${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/output-types${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/detection-pass-rate${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/top-workflows${params}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/humanizer-usage${params}`).then((r) => r.json()),
    ]).then(([ov, rot, sent, tok, ot, det, tw, hum]) => {
      setOverview(ov.data)
      setRunsOverTime(rot.data ?? [])
      setSentiment(sent.data ?? [])
      setTokens(tok.data ?? [])
      setOutputTypes(ot.data ?? [])
      setDetection(det.data ?? [])
      setTopWorkflows(tw.data ?? [])
      setHumanizer(hum.data ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [params])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      {/* Filters row — only shown when showFilters=true */}
      {showFilters && (
        <div className="flex items-center justify-end gap-2">
          {/* Client filter — only shown when clientId is not fixed */}
          {!propClientId && (
            <Select value={internalClientId || 'all'} onValueChange={(v) => setInternalClientId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Date range */}
          <Icons.Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="date"
            value={internalStart}
            max={internalEnd}
            onChange={(e) => setInternalStart(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={internalEnd}
            min={internalStart}
            max={toISODate(new Date())}
            onChange={(e) => setInternalEnd(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={load} disabled={loading}>
            <Icons.RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatCard icon={Icons.Play} label="Total Runs" value={overview?.totalRuns ?? '—'} />
        <StatCard icon={Icons.CheckCircle2} label="Completed" value={overview?.completedRuns ?? '—'} color="text-emerald-400" />
        <StatCard icon={Icons.XCircle} label="Failed" value={overview?.failedRuns ?? '—'} color="text-red-400" />
        <StatCard icon={Icons.Percent} label="Success Rate" value={overview ? `${overview.successRate}%` : '—'} color={overview && overview.successRate >= 80 ? 'text-emerald-400' : 'text-amber-400'} />
        <StatCard icon={Icons.FileOutput} label="Outputs" value={overview?.totalOutputs ?? '—'} />
        <StatCard icon={Icons.MessageSquare} label="Feedback" value={overview?.feedbackCount ?? '—'} />
        <StatCard icon={Icons.Clock} label="Waiting Feedback" value={overview?.waitingFeedback ?? '—'} color={overview && overview.waitingFeedback > 0 ? 'text-amber-400' : 'text-foreground'} />
        <StatCard icon={Icons.UserCheck} label="Waiting Approval" value={overview?.waitingApproval ?? '—'} color={overview && overview.waitingApproval > 0 ? 'text-amber-400' : 'text-foreground'} />
      </div>

      {/* ── Runs over time ───────────────────────────────────────────── */}
      <Section
        title="Workflow Runs Over Time"
        icon={Icons.TrendingUp}
        onDownload={() => downloadCSV('runs-over-time.csv', runsOverTime)}
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={runsOverTime} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} fill="url(#gradCompleted)" />
            <Area type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} fill="url(#gradFailed)" />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      {/* ── Middle row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Feedback sentiment */}
        <Section
          title="Feedback Sentiment"
          icon={Icons.MessageSquare}
          onDownload={() => downloadCSV('feedback-sentiment.csv', sentiment)}
        >
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={sentiment}
                dataKey="count"
                nameKey="sentiment"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                strokeWidth={0}
              >
                {sentiment.map((entry) => (
                  <Cell key={entry.sentiment} fill={SENTIMENT_COLORS[entry.sentiment] ?? '#6b7280'} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number, name: string) => [v, name.replace(/_/g, ' ')]}
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 11 }}
              />
              <Legend
                formatter={(v) => v.replace(/_/g, ' ')}
                wrapperStyle={{ fontSize: 10 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        {/* Detection pass rate */}
        <Section
          title="AI Detection Pass Rate"
          icon={Icons.ShieldCheck}
          onDownload={() => downloadCSV('detection-pass-rate.csv', detection)}
        >
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={detection.filter((d) => d.count > 0)}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                strokeWidth={0}
              >
                {detection.map((entry, i) => (
                  <Cell key={entry.label} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        {/* Output types */}
        <Section
          title="Output Types"
          icon={Icons.FileText}
          onDownload={() => downloadCSV('output-types.csv', outputTypes)}
        >
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={outputTypes}
                dataKey="count"
                nameKey="type"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                strokeWidth={0}
              >
                {outputTypes.map((entry, i) => (
                  <Cell key={entry.type} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* ── Bottom charts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tokens by model */}
        <Section
          title="AI Tokens by Model"
          icon={Icons.Cpu}
          onDownload={() => downloadCSV('tokens-by-model.csv', tokens)}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={tokens} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
              <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: '#71717a' }} width={120} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
                {tokens.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>

        {/* Humanizer words by service */}
        <Section
          title="Humanizer Words by Service"
          icon={Icons.Wand2}
          onDownload={() => downloadCSV('humanizer-usage.csv', humanizer)}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={humanizer} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
              <YAxis type="category" dataKey="service" tick={{ fontSize: 10, fill: '#71717a' }} width={100} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="words" radius={[0, 4, 4, 0]}>
                {humanizer.map((_, i) => (
                  <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* ── Top workflows table ──────────────────────────────────────── */}
      {(() => {
        const sorted = [...topWorkflows].sort((a, b) => {
          const av = a[sortCol]
          const bv = b[sortCol]
          const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number)
          return sortDir === 'asc' ? cmp : -cmp
        })

        function SortTh({ col, label, align = 'right' }: { col: keyof TopWorkflow; label: string; align?: 'left' | 'right' }) {
          const active = sortCol === col
          return (
            <th
              className={`pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors text-${align}`}
              onClick={() => { setSortCol(col); setSortDir(active && sortDir === 'desc' ? 'asc' : 'desc') }}
            >
              <span className="inline-flex items-center gap-1">
                {label}
                {active
                  ? sortDir === 'desc'
                    ? <Icons.ChevronDown className="h-3 w-3" />
                    : <Icons.ChevronUp className="h-3 w-3" />
                  : <Icons.ChevronsUpDown className="h-3 w-3 opacity-30" />
                }
              </span>
            </th>
          )
        }

        return (
          <Section
            title="Top Workflows"
            icon={Icons.Workflow}
            onDownload={() => downloadCSV('top-workflows.csv', sorted.map(({ id: _id, ...rest }) => rest))}
          >
            {topWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No workflow runs in this period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <SortTh col="name" label="Workflow" align="left" />
                      <SortTh col="client" label="Client" align="left" />
                      <SortTh col="periodRuns" label="Runs" />
                      <SortTh col="completed" label="Completed" />
                      <SortTh col="failed" label="Failed" />
                      <SortTh col="successRate" label="Success" />
                      <SortTh col="tokens" label="Tokens" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.map((wf) => (
                      <tr key={wf.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium truncate max-w-[200px]">{wf.name}</td>
                        <td className="py-2.5 text-muted-foreground">{wf.client}</td>
                        <td className="py-2.5 text-right">{wf.periodRuns}</td>
                        <td className="py-2.5 text-right text-emerald-400">{wf.completed}</td>
                        <td className="py-2.5 text-right text-red-400">{wf.failed}</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-semibold ${wf.successRate >= 80 ? 'text-emerald-400' : wf.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                            {wf.successRate}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">
                          {wf.tokens >= 1000 ? `${(wf.tokens / 1000).toFixed(1)}K` : wf.tokens}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )
      })()}
    </div>
  )
}
