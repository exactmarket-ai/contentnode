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
    imagesGenerated: number
    videosGenerated: number
  }
  llm: {
    totalTokens: number
    byModel: { model: string; tokens: number }[]
    byProvider: { provider: string; tokens: number }[]
  }
  humanizer: { totalWords: number; byService: { service: string; words: number }[] }
  detection: { totalCalls: number; byService: { service: string; calls: number }[] }
  translation: { totalChars: number; byProvider: { provider: string; chars: number }[] }
  imageGeneration?: { totalImages: number; byService: { service: string; count: number }[] }
  videoGeneration?: { totalVideos: number; totalSecondGenerated: number; byService: { service: string; count: number }[] }
  byClient: { clientId: string; clientName: string; tokens: number; translationChars: number }[]
  byWorkflow: { workflowId: string; workflowName: string; clientName: string; tokens: number; translationChars: number }[]
  byUser: { userId: string; userName: string; tokens: number; humanizerWords: number; imagesGenerated: number; videosGenerated: number; translationChars: number }[]
  dailyUsage: { date: string; tokens: number }[]
}

// ── Service definitions with pricing ─────────────────────────────────────────

interface ImageServiceDef { name: string; rateLabel: string }
interface VideoServiceDef { name: string; rateLabel: string }

const IMAGE_SERVICE_DEFS: ImageServiceDef[] = [
  { name: 'DALL-E 3',        rateLabel: '$0.04–0.12/img' },
  { name: 'Stability SDXL',  rateLabel: '$0.002/img' },
  { name: 'FAL FLUX Dev',    rateLabel: '$0.025/img' },
  { name: 'ComfyUI',         rateLabel: 'self-hosted' },
  { name: 'AUTOMATIC1111',   rateLabel: 'self-hosted' },
]

const VIDEO_SERVICE_DEFS: VideoServiceDef[] = [
  { name: 'Runway Gen-3 Turbo',  rateLabel: '$0.025/sec' },
  { name: 'Kling v1.6',          rateLabel: '$0.040/sec' },
  { name: 'Luma Dream Machine',  rateLabel: '$0.032/sec' },
  { name: 'Pika 1.5',            rateLabel: '$0.030/sec' },
  { name: 'Stability SVD',       rateLabel: '$0.010/sec' },
  { name: 'Google Veo 2',        rateLabel: '$0.035/sec' },
  { name: 'ComfyUI AnimateDiff', rateLabel: 'self-hosted' },
  { name: 'CogVideoX',           rateLabel: 'self-hosted' },
  { name: 'Wan2.1',              rateLabel: 'self-hosted' },
]

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
            <div className="grid grid-cols-7 gap-3">
              <StatCard icon={Icons.Zap} label="AI Tokens" value={fmt(data.totals.tokens)} sub="this billing period" color="text-blue-400" />
              <StatCard icon={Icons.Play} label="Workflow Runs" value={String(data.totals.runs)} sub="this billing period" />
              <StatCard icon={Icons.Mic} label="Transcription" value={`${data.totals.transcriptionMinutes}m`} sub="minutes processed" />
              <StatCard icon={Icons.ShieldCheck} label="Detection Calls" value={String(data.totals.detectionCalls)} sub="AI detection checks" color="text-amber-400" />
              <StatCard icon={Icons.Languages} label="Translation" value={fmt(data.totals.translationChars, ' chars')} sub="characters translated" color="text-cyan-400" />
              <StatCard icon={Icons.Image} label="Images Generated" value={fmt(data.totals.imagesGenerated ?? 0)} sub="this billing period" color="text-pink-400" />
              <StatCard icon={Icons.Video} label="Videos Generated" value={fmt(data.totals.videosGenerated ?? 0)} sub="this billing period" color="text-violet-400" />
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

            {/* Image Generation */}
            <Section title="Image Generation" icon={Icons.Image} color="text-pink-400" total={fmt(data.imageGeneration?.totalImages ?? 0, ' images')}>
              <div className="grid grid-cols-3 gap-2">
                {IMAGE_SERVICE_DEFS.map((svc) => {
                  const usage = data.imageGeneration?.byService.find((s) => s.service === svc.name)
                  const count = usage?.count ?? 0
                  return (
                    <div key={svc.name} className={cn('rounded-lg border p-3 space-y-1', count > 0 ? 'border-pink-500/40 bg-pink-950/20' : 'border-border bg-muted/20')}>
                      <p className="text-xs font-medium truncate">{svc.name}</p>
                      <p className={cn('text-xl font-semibold tabular-nums', count > 0 ? 'text-pink-400' : 'text-muted-foreground/50')}>{fmt(count)}</p>
                      <p className="text-[10px] text-muted-foreground">{svc.rateLabel}</p>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* Video Generation */}
            <Section
              title="Video Generation"
              icon={Icons.Video}
              color="text-violet-400"
              total={data.videoGeneration ? `${fmt(data.videoGeneration.totalVideos)} videos · ${fmt(Math.round((data.videoGeneration.totalSecondGenerated ?? 0) / 60))}m` : '0 videos'}
            >
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_SERVICE_DEFS.map((svc) => {
                  const usage = data.videoGeneration?.byService.find((s) => s.service === svc.name)
                  const count = usage?.count ?? 0
                  return (
                    <div key={svc.name} className={cn('rounded-lg border p-3 space-y-1', count > 0 ? 'border-violet-500/40 bg-violet-950/20' : 'border-border bg-muted/20')}>
                      <p className="text-xs font-medium truncate">{svc.name}</p>
                      <p className={cn('text-xl font-semibold tabular-nums', count > 0 ? 'text-violet-400' : 'text-muted-foreground/50')}>{fmt(count)}</p>
                      <p className="text-[10px] text-muted-foreground">{svc.rateLabel}</p>
                    </div>
                  )
                })}
              </div>
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

            {/* By user */}
            {data.byUser?.length > 0 && (
              <Section title="Usage by User" icon={Icons.User} total={`${data.byUser.length} users`}>
                {data.totals.tokens > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">AI Tokens</p>
                    {data.byUser.filter((u) => u.tokens > 0).slice(0, 15).map((u) => (
                      <Bar key={u.userId} label={u.userName} value={u.tokens} max={data.totals.tokens} color="bg-blue-600" />
                    ))}
                  </>
                )}
                {data.byUser.some((u) => u.imagesGenerated > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Images Generated</p>
                    {data.byUser.filter((u) => u.imagesGenerated > 0).slice(0, 15).map((u) => (
                      <Bar key={u.userId} label={u.userName} value={u.imagesGenerated} max={data.totals.imagesGenerated} color="bg-pink-600" />
                    ))}
                  </>
                )}
                {data.byUser.some((u) => u.videosGenerated > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Videos Generated</p>
                    {data.byUser.filter((u) => u.videosGenerated > 0).slice(0, 15).map((u) => (
                      <Bar key={u.userId} label={u.userName} value={u.videosGenerated} max={data.totals.videosGenerated} color="bg-violet-600" />
                    ))}
                  </>
                )}
                {data.byUser.some((u) => u.humanizerWords > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Humanizer Words</p>
                    {data.byUser.filter((u) => u.humanizerWords > 0).slice(0, 15).map((u) => (
                      <Bar key={u.userId} label={u.userName} value={u.humanizerWords} max={data.totals.humanizerWords} color="bg-purple-600" />
                    ))}
                  </>
                )}
                {data.byUser.some((u) => u.translationChars > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Translation Chars</p>
                    {data.byUser.filter((u) => u.translationChars > 0).slice(0, 15).map((u) => (
                      <Bar key={u.userId} label={u.userName} value={u.translationChars} max={data.totals.translationChars} color="bg-cyan-600" />
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
