import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

function fmt(n: number, unit = ''): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${unit}`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K${unit}`
  return `${n}${unit}`
}

interface UsageData {
  period: { start: string; end: string }
  totals: {
    tokens: number
    runs: number
    transcriptionMinutes: number
    detectionCalls: number
    humanizerWords: number
    translationChars: number
    emailsSent: number
  }
  llm: {
    totalTokens: number
    byModel: { model: string; tokens: number }[]
    byProvider: { provider: string; tokens: number }[]
  }
  humanizer: { totalWords: number; byService: { service: string; words: number }[] }
  detection: { totalCalls: number; byService: { service: string; calls: number }[] }
  translation: { totalChars: number; byProvider: { provider: string; chars: number }[] }
  byClient: { clientId: string; clientName: string; tokens: number; translationChars: number }[]
  byWorkflow: { workflowId: string; workflowName: string; clientName: string; tokens: number; translationChars: number }[]
  dailyUsage: { date: string; tokens: number }[]
}

function MiniBar({ value, max, date }: { value: number; max: number; date: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="group relative flex flex-col items-center gap-1" style={{ flex: 1 }}>
      <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-card border border-border px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 z-10">
        {fmt(value)} tokens
      </div>
      <div className="flex w-full items-end" style={{ height: 60 }}>
        <div className="w-full rounded-t bg-blue-600 transition-all group-hover:bg-blue-500" style={{ height: `${Math.max(pct, value > 0 ? 4 : 0)}%` }} />
      </div>
      <span className="text-[9px] text-muted-foreground/60">{date.slice(5)}</span>
    </div>
  )
}

function Section({ title, icon: Icon, color = 'text-muted-foreground', total, children }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  color?: string
  total?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', color)} />
          <span className="text-sm font-semibold">{title}</span>
          {total && <span className="text-xs text-muted-foreground ml-1">— {total}</span>}
        </div>
        <Icons.ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open && <div className="px-5 pb-5 space-y-3">{children}</div>}
    </div>
  )
}

function Bar({ label, sub, value, max, color = 'bg-blue-600' }: { label: string; sub?: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{label}</span>
          {sub && <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>}
        </div>
        <span className="text-sm font-semibold tabular-nums">{fmt(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-foreground' }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-semibold', color)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/v1/usage')
      .then((r) => r.json())
      .then(({ data }) => setData(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const period = data
    ? `${new Date(data.period.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(data.period.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : ''

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Usage</h1>
        </div>
        {period && <p className="text-xs text-muted-foreground">{period}</p>}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground text-center py-20">Failed to load usage data</p>
        ) : (
          <div className="space-y-5 max-w-4xl">

            {/* Top stats */}
            <div className="grid grid-cols-5 gap-3">
              <StatCard icon={Icons.Zap} label="AI Tokens" value={fmt(data.totals.tokens)} sub="this billing period" color="text-blue-400" />
              <StatCard icon={Icons.Play} label="Workflow Runs" value={String(data.totals.runs)} sub="this billing period" />
              <StatCard icon={Icons.Mic} label="Transcription" value={`${data.totals.transcriptionMinutes}m`} sub="minutes processed" />
              <StatCard icon={Icons.ShieldCheck} label="Detection Calls" value={String(data.totals.detectionCalls)} sub="AI detection checks" color="text-amber-400" />
              <StatCard icon={Icons.Languages} label="Translation" value={fmt(data.totals.translationChars, ' chars')} sub="characters translated" color="text-cyan-400" />
            </div>

            {/* Daily chart */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-4 text-xs font-medium text-muted-foreground">TOKEN USAGE — LAST 30 DAYS</p>
              {data.dailyUsage.some((d) => d.tokens > 0) ? (
                <div className="flex items-end gap-0.5 w-full px-1">
                  {data.dailyUsage.map((d) => (
                    <MiniBar key={d.date} value={d.tokens} max={Math.max(...data.dailyUsage.map((x) => x.tokens), 1)} date={d.date} />
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-8">No token usage in the last 30 days</p>
              )}
            </div>

            {/* LLMs */}
            <Section title="AI / LLMs" icon={Icons.Zap} color="text-blue-400" total={fmt(data.llm.totalTokens, ' tokens')}>
              {data.llm.byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground">No LLM usage recorded</p>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">By Model</p>
                  {data.llm.byModel.map((m) => (
                    <Bar key={m.model} label={m.model} value={m.tokens} max={data.llm.totalTokens} color="bg-blue-600" />
                  ))}
                  {data.llm.byProvider.length > 1 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">By Provider</p>
                      {data.llm.byProvider.map((p) => (
                        <Bar key={p.provider} label={p.provider} value={p.tokens} max={data.llm.totalTokens} color="bg-indigo-500" />
                      ))}
                    </>
                  )}
                </>
              )}
            </Section>

            {/* Humanizer */}
            <Section title="Humanizers" icon={Icons.Wand2} color="text-purple-400" total={fmt(data.humanizer.totalWords, ' words')}>
              {data.humanizer.byService.length === 0 ? (
                <p className="text-xs text-muted-foreground">No humanizer usage recorded</p>
              ) : data.humanizer.byService.map((s) => (
                <Bar key={s.service} label={s.service} value={s.words} max={data.humanizer.totalWords} color="bg-purple-600" />
              ))}
            </Section>

            {/* Detection */}
            <Section title="AI Detection" icon={Icons.ShieldCheck} color="text-amber-400" total={`${data.detection.totalCalls} calls`}>
              {data.detection.byService.length === 0 ? (
                <p className="text-xs text-muted-foreground">No detection usage recorded</p>
              ) : data.detection.byService.map((s) => (
                <Bar key={s.service} label={s.service} value={s.calls} max={data.detection.totalCalls} color="bg-amber-500" />
              ))}
            </Section>

            {/* Transcription */}
            <Section title="Transcription" icon={Icons.Mic} color="text-orange-400" total={`${data.totals.transcriptionMinutes} min`}>
              {data.totals.transcriptionMinutes === 0 ? (
                <p className="text-xs text-muted-foreground">No transcription usage recorded</p>
              ) : (
                <p className="text-sm">{data.totals.transcriptionMinutes} minutes processed this period</p>
              )}
            </Section>

            <Section title="Translation" icon={Icons.Languages} color="text-cyan-400" total={fmt(data.translation.totalChars, ' chars')}>
              {data.translation.byProvider.length === 0 ? (
                <p className="text-xs text-muted-foreground">No translation usage recorded</p>
              ) : data.translation.byProvider.map((p) => (
                <Bar key={p.provider} label={p.provider} value={p.chars} max={data.translation.totalChars} color="bg-cyan-600" />
              ))}
            </Section>

            {/* By client */}
            {data.byClient.length > 0 && (
              <Section title="Usage by Client" icon={Icons.Users} total={`${data.byClient.length} clients`}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">AI Tokens</p>
                {data.byClient.slice(0, 10).map((c) => (
                  <Bar key={c.clientId} label={c.clientName} value={c.tokens} max={data.totals.tokens} />
                ))}
                {data.byClient.some((c) => c.translationChars > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Translation Chars</p>
                    {data.byClient.filter((c) => c.translationChars > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.translationChars} max={data.totals.translationChars} color="bg-cyan-600" />
                    ))}
                  </>
                )}
              </Section>
            )}

            {/* By workflow */}
            {data.byWorkflow.length > 0 && (
              <Section title="Usage by Workflow" icon={Icons.Workflow} total={`${data.byWorkflow.length} workflows`}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">AI Tokens</p>
                {data.byWorkflow.slice(0, 10).map((w) => (
                  <Bar key={w.workflowId} label={w.workflowName} sub={w.clientName} value={w.tokens} max={data.totals.tokens} />
                ))}
                {data.byWorkflow.some((w) => w.translationChars > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Translation Chars</p>
                    {data.byWorkflow.filter((w) => w.translationChars > 0).slice(0, 10).map((w) => (
                      <Bar key={w.workflowId} label={w.workflowName} sub={w.clientName} value={w.translationChars} max={data.totals.translationChars} color="bg-cyan-600" />
                    ))}
                  </>
                )}
              </Section>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
