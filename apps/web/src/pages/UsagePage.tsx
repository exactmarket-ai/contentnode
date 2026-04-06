import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface DailyBucket {
  date: string
  tokens: number
}

interface UsageData {
  period: { start: string; end: string }
  totals: {
    tokens: number
    runs: number
    transcriptionMinutes: number
    detectionApiCalls: number
  }
  byClient: Array<{ clientId: string; clientName: string; tokens: number }>
  byWorkflow: Array<{ workflowId: string; workflowName: string; clientName: string; tokens: number }>
  dailyUsage: DailyBucket[]
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── Simple bar chart ──────────────────────────────────────────────────────────

function MiniBar({ value, max, date }: { value: number; max: number; date: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const label = date.slice(5) // MM-DD

  return (
    <div className="group relative flex flex-col items-center gap-1" style={{ flex: 1 }}>
      {/* Tooltip */}
      <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-card border border-border px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 z-10">
        {formatTokens(value)} tokens
      </div>
      {/* Bar */}
      <div className="flex w-full items-end" style={{ height: 60 }}>
        <div
          className="w-full rounded-t bg-blue-600 transition-all group-hover:bg-blue-500"
          style={{ height: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        />
      </div>
      {/* Label — only show every 5th */}
      <span className="text-[9px] text-muted-foreground/60">{label}</span>
    </div>
  )
}

function BarChart({ data }: { data: DailyBucket[] }) {
  const max = Math.max(...data.map((d) => d.tokens), 1)

  return (
    <div className="flex items-end gap-0.5 w-full px-1">
      {data.map((d, i) => (
        <MiniBar key={d.date} value={d.tokens} max={max} date={d.date} />
      ))}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-foreground',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-semibold', color)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Progress bar row ──────────────────────────────────────────────────────────

function ProgressRow({
  label,
  sub,
  value,
  total,
}: {
  label: string
  sub?: string
  value: number
  total: number
}) {
  const pct = total > 0 ? (value / total) * 100 : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className="text-sm font-semibold">{formatTokens(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyUsage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Icons.BarChart2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">No usage data yet</p>
      <p className="mt-1 text-xs text-muted-foreground/70">Run some workflows to see token consumption</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/v1/usage`)
      .then((r) => r.json())
      .then(({ data }) => setData(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const hasActivity = data && (
    data.totals.tokens > 0 ||
    data.totals.runs > 0 ||
    data.totals.transcriptionMinutes > 0
  )

  const periodLabel = data
    ? `${new Date(data.period.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(data.period.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : ''

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Usage</h1>
        </div>
        {periodLabel && (
          <p className="text-xs text-muted-foreground">{periodLabel}</p>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasActivity ? (
          <EmptyUsage />
        ) : (
          <div className="space-y-6 max-w-4xl">
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                icon={Icons.Zap}
                label="AI Tokens"
                value={formatTokens(data!.totals.tokens)}
                sub="this billing period"
                color="text-blue-400"
              />
              <StatCard
                icon={Icons.Play}
                label="Workflow Runs"
                value={String(data!.totals.runs)}
                sub="this billing period"
              />
              <StatCard
                icon={Icons.Mic}
                label="Transcription"
                value={`${data!.totals.transcriptionMinutes}m`}
                sub="minutes processed"
              />
              <StatCard
                icon={Icons.ShieldCheck}
                label="Detection Calls"
                value={String(data!.totals.detectionApiCalls)}
                sub="AI detection checks"
              />
            </div>

            {/* Daily usage chart */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-4 text-xs font-medium text-muted-foreground">TOKEN USAGE — LAST 30 DAYS</p>
              {data!.dailyUsage.some((d) => d.tokens > 0) ? (
                <BarChart data={data!.dailyUsage} />
              ) : (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  No token usage in the last 30 days
                </div>
              )}
            </div>

            {/* By client */}
            {data!.byClient.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <p className="text-xs font-medium text-muted-foreground">TOKENS BY CLIENT</p>
                <div className="space-y-4">
                  {data!.byClient.slice(0, 10).map((c) => (
                    <ProgressRow
                      key={c.clientId}
                      label={c.clientName}
                      value={c.tokens}
                      total={data!.totals.tokens}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* By workflow */}
            {data!.byWorkflow.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <p className="text-xs font-medium text-muted-foreground">TOKENS BY WORKFLOW</p>
                <div className="space-y-4">
                  {data!.byWorkflow.slice(0, 10).map((w) => (
                    <ProgressRow
                      key={w.workflowId}
                      label={w.workflowName}
                      sub={w.clientName}
                      value={w.tokens}
                      total={data!.totals.tokens}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
