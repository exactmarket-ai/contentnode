import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface QualitySummary {
  totalTracked: number
  avgDetectionScore: number | null
  passRate: number | null
  avgRetries: number | null
  avgStakeholderRating: number | null
}

interface TrendPoint {
  date: string
  avgDetectionScore: number | null
  avgRating: number | null
  runCount: number
}

interface ServiceStat {
  service: string
  runs: number
  totalWordsProcessed: number
  avgDetectionScore: number | null
  avgStakeholderRating: number | null
}

interface ModelStat {
  model: string
  runs: number
  totalTokens: number
  avgTokensPerRun: number
  avgStakeholderRating: number | null
}

interface Recommendation {
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground'
  if (score <= 20) return 'text-green-400'
  if (score <= 50) return 'text-amber-400'
  return 'text-red-400'
}

function ratingColor(rating: number | null): string {
  if (rating === null) return 'text-muted-foreground'
  if (rating >= 4) return 'text-green-400'
  if (rating >= 3) return 'text-amber-400'
  return 'text-red-400'
}

function pct(n: number | null, decimals = 0): string {
  if (n === null) return '—'
  return `${(n * 100).toFixed(decimals)}%`
}

function fmt(n: number | null, decimals = 1): string {
  if (n === null) return '—'
  return n.toFixed(decimals)
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const SERVICE_LABELS: Record<string, string> = {
  undetectable: 'Undetectable.ai',
  bypassgpt: 'BypassGPT',
  humanizeai: 'HumanizeAI',
  claude: 'Claude (fallback)',
  stealthgpt: 'StealthGPT',
  unknown: 'Unknown',
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  valueClass = 'text-foreground',
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  valueClass?: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-semibold', valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const maxScore = 100
  const hasData = data.some((d) => d.avgDetectionScore !== null)

  if (!hasData) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
        No detection data in the last 30 days
      </div>
    )
  }

  return (
    <div className="flex items-end gap-0.5 w-full px-1" style={{ height: 80 }}>
      {data.map((d) => {
        const score = d.avgDetectionScore
        const height = score !== null ? (score / maxScore) * 100 : 0
        const color = score === null ? 'bg-muted'
          : score <= 20 ? 'bg-green-600'
          : score <= 50 ? 'bg-amber-500'
          : 'bg-red-500'

        return (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center gap-0.5">
            {score !== null && (
              <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-card border border-border px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 z-10">
                {score.toFixed(0)}% — {d.date.slice(5)}
              </div>
            )}
            <div className="flex w-full items-end" style={{ height: 64 }}>
              <div
                className={cn('w-full rounded-t transition-all', color)}
                style={{ height: `${Math.max(height, score !== null ? 3 : 0)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const colors = {
    info: { border: 'border-blue-200', bg: 'bg-blue-50', icon: 'text-blue-600', Icon: Icons.Info },
    warning: { border: 'border-amber-200', bg: 'bg-amber-50', icon: 'text-amber-600', Icon: Icons.AlertTriangle },
    critical: { border: 'border-red-200', bg: 'bg-red-50', icon: 'text-red-600', Icon: Icons.AlertCircle },
  }
  const { border, bg, icon, Icon } = colors[rec.severity]

  return (
    <div className={cn('rounded-xl border p-4', border, bg)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', icon)} />
        <div>
          <p className="text-sm font-medium">{rec.title}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{rec.body}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function QualityPage() {
  const [summary, setSummary] = useState<QualitySummary | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [services, setServices] = useState<ServiceStat[]>([])
  const [models, setModels] = useState<ModelStat[]>([])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [sumRes, trendRes, svcRes, modelRes, recRes] = await Promise.all([
          apiFetch('/api/v1/quality/summary').then((r) => r.json()),
          apiFetch('/api/v1/quality/trends').then((r) => r.json()),
          apiFetch('/api/v1/quality/services').then((r) => r.json()),
          apiFetch('/api/v1/quality/models').then((r) => r.json()),
          apiFetch('/api/v1/quality/recommendations').then((r) => r.json()),
        ])
        setSummary(sumRes.data)
        setTrends(trendRes.data)
        setServices(svcRes.data)
        setModels(modelRes.data)
        setRecommendations(recRes.data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const hasData = summary && summary.totalTracked > 0

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Content Quality</h1>
        </div>
        <p className="text-xs text-muted-foreground">Last 30 days</p>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icons.TrendingUp className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No quality data yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Run workflows with Detection and AI Generate nodes to start collecting quality signals
            </p>
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl">
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                icon={Icons.Activity}
                label="Avg Detection Score"
                value={summary!.avgDetectionScore !== null ? `${summary!.avgDetectionScore.toFixed(0)}%` : '—'}
                valueClass={scoreColor(summary!.avgDetectionScore)}
                sub="lower is better"
              />
              <StatCard
                icon={Icons.ShieldCheck}
                label="Detection Pass Rate"
                value={pct(summary!.passRate)}
                valueClass={summary!.passRate !== null && summary!.passRate >= 0.7 ? 'text-green-400' : 'text-amber-400'}
                sub="score ≤ threshold"
              />
              <StatCard
                icon={Icons.RefreshCw}
                label="Avg Retries"
                value={fmt(summary!.avgRetries)}
                valueClass={summary!.avgRetries !== null && summary!.avgRetries > 2 ? 'text-amber-400' : 'text-foreground'}
                sub="humanization loops"
              />
              <StatCard
                icon={Icons.Star}
                label="Avg Stakeholder Rating"
                value={summary!.avgStakeholderRating !== null ? `${fmt(summary!.avgStakeholderRating)}/5` : '—'}
                valueClass={ratingColor(summary!.avgStakeholderRating)}
                sub={summary!.totalTracked ? `${summary!.totalTracked} runs tracked` : undefined}
              />
            </div>

            {/* Recommendations */}
            {recommendations.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">RECOMMENDATIONS</p>
                {recommendations.map((rec, i) => (
                  <RecommendationCard key={i} rec={rec} />
                ))}
              </div>
            )}

            {/* Detection score trend */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-1 text-xs font-medium text-muted-foreground">DETECTION SCORE TREND — LAST 30 DAYS</p>
              <p className="mb-4 text-[10px] text-muted-foreground/60">Daily average AI detection score (lower = better humanization)</p>
              <TrendChart data={trends} />
              <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-600 inline-block" /> ≤20% (passing)</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> 21–50% (borderline)</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> &gt;50% (failing)</span>
              </div>
            </div>

            {/* Humanizer service comparison */}
            {services.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="mb-4 text-xs font-medium text-muted-foreground">HUMANIZER SERVICE COMPARISON</p>
                <div className="space-y-0 divide-y divide-border">
                  {services.map((svc) => (
                    <div key={svc.service} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium">{SERVICE_LABELS[svc.service] ?? svc.service}</p>
                        <p className="text-xs text-muted-foreground">{svc.runs} runs · {formatK(svc.totalWordsProcessed)} words</p>
                      </div>
                      <div className="flex items-center gap-6 text-right">
                        <div>
                          <p className={cn('text-sm font-semibold', scoreColor(svc.avgDetectionScore))}>
                            {svc.avgDetectionScore !== null ? `${svc.avgDetectionScore.toFixed(0)}%` : '—'}
                          </p>
                          <p className="text-[10px] text-muted-foreground">avg detection</p>
                        </div>
                        {svc.avgStakeholderRating !== null && (
                          <div>
                            <p className={cn('text-sm font-semibold', ratingColor(svc.avgStakeholderRating))}>
                              {svc.avgStakeholderRating.toFixed(1)}/5
                            </p>
                            <p className="text-[10px] text-muted-foreground">avg rating</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI model comparison */}
            {models.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="mb-4 text-xs font-medium text-muted-foreground">AI MODEL COMPARISON</p>
                <div className="space-y-0 divide-y divide-border">
                  {models.map((m) => (
                    <div key={m.model} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium font-mono">{m.model}</p>
                        <p className="text-xs text-muted-foreground">{m.runs} runs · {formatK(m.totalTokens)} tokens total</p>
                      </div>
                      <div className="flex items-center gap-6 text-right">
                        <div>
                          <p className="text-sm font-semibold">{formatK(m.avgTokensPerRun)}</p>
                          <p className="text-[10px] text-muted-foreground">tokens/run</p>
                        </div>
                        {m.avgStakeholderRating !== null && (
                          <div>
                            <p className={cn('text-sm font-semibold', ratingColor(m.avgStakeholderRating))}>
                              {m.avgStakeholderRating.toFixed(1)}/5
                            </p>
                            <p className="text-[10px] text-muted-foreground">avg rating</p>
                          </div>
                        )}
                      </div>
                    </div>
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
