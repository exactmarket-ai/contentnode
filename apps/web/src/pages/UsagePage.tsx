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
    videoIntelligenceCalls?: number
    videoIntelligenceCostUsd?: number
    voiceChars?: number
    voiceGenerationSecs?: number
    charAnimSecs?: number
    musicSecs?: number
    videoCompSecs?: number
    videoCompCostUsd?: number
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
  voiceGeneration?: { totalChars: number; totalSecs: number; byProvider: { provider: string; chars: number; secs: number; costUsd: number }[] }
  characterAnimation?: { totalSecs: number; byProvider: { provider: string; secs: number; costUsd: number }[] }
  musicGeneration?: { totalSecs: number; byProvider: { provider: string; secs: number; costUsd: number }[] }
  videoComposition?: { totalSecs: number; totalCostUsd: number }
  byClient: { clientId: string; clientName: string; tokens: number; translationChars: number; videoIntelligenceCalls?: number; videosGenerated?: number; imagesGenerated?: number }[]
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

interface VoiceServiceDef { key: string; displayName: string; rateLabel: string }
interface CharAnimServiceDef { key: string; displayName: string; rateLabel: string }
interface MusicServiceDef { key: string; displayName: string; rateLabel: string }

const VOICE_SERVICE_DEFS: VoiceServiceDef[] = [
  { key: 'elevenlabs', displayName: 'ElevenLabs',   rateLabel: '$0.33/1k chars' },
  { key: 'openai',     displayName: 'OpenAI TTS',   rateLabel: '$0.015–0.030/1k chars' },
  { key: 'local',      displayName: 'Local TTS',    rateLabel: 'self-hosted' },
]

const CHAR_ANIM_SERVICE_DEFS: CharAnimServiceDef[] = [
  { key: 'd-id',       displayName: 'D-ID',          rateLabel: '$0.0033/sec' },
  { key: 'heygen',     displayName: 'HeyGen',         rateLabel: '$0.005/sec' },
  { key: 'sadtalker',  displayName: 'SadTalker',      rateLabel: 'self-hosted' },
]

const MUSIC_SERVICE_DEFS: MusicServiceDef[] = [
  { key: 'elevenlabs', displayName: 'ElevenLabs Music/SFX', rateLabel: '$0.05/sec' },
  { key: 'local',      displayName: 'Local MusicGen',       rateLabel: 'self-hosted' },
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

// ── Team efficiency types ────────────────────────────────────────────────────

interface TeamUser {
  userId: string
  name: string | null
  email: string
  completedRuns: number
  totalRuns: number
  tokens: number
  tokenCostUsd: number
  byModel: Record<string, number>
  humanizerWords: number
  humanizerCostUsd: number
  detectionCalls: number
  detectionCostUsd: number
  translationChars: number
  translationCostUsd: number
  mediaCostUsd: number
  mediaBreakdown: Record<string, number>
  totalCostUsd: number
  efficiencyScore: number | null
  tokensPerRun: number | null
}

interface TeamData {
  users: TeamUser[]
  grandTotalCostUsd: number
  days: number
}

function efficiencyLabel(score: number | null, avg: number): { label: string; color: string } {
  if (score === null) return { label: 'No runs', color: 'text-muted-foreground' }
  if (avg === 0) return { label: 'Active', color: 'text-blue-400' }
  const ratio = score / avg
  if (ratio < 0.75) return { label: 'Efficient', color: 'text-emerald-400' }
  if (ratio < 1.25) return { label: 'Average', color: 'text-yellow-400' }
  if (ratio < 2)    return { label: 'Above Avg', color: 'text-orange-400' }
  return { label: 'High Usage', color: 'text-red-400' }
}

function UserEfficiencyCard({ user, avgScore }: { user: TeamUser; avgScore: number }) {
  const [open, setOpen] = useState(false)
  const { label, color } = efficiencyLabel(user.efficiencyScore, avgScore)
  const displayName = user.name ?? user.email.split('@')[0]
  const models = Object.entries(user.byModel).sort((a, b) => b[1] - a[1])

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 pt-4 pb-3 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
              {displayName.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <span className={cn('shrink-0 text-xs font-medium', color)}>{label}</span>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-base font-semibold tabular-nums">${user.totalCostUsd.toFixed(2)}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Total Cost</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-base font-semibold tabular-nums">{user.completedRuns}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Completed</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className={cn('text-base font-semibold tabular-nums', color)}>
              {user.efficiencyScore !== null ? `$${user.efficiencyScore.toFixed(2)}` : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Cost/Run</p>
          </div>
        </div>

        {/* Token bar */}
        {user.tokens > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>AI Tokens</span>
              <span>{fmt(user.tokens)}{user.tokensPerRun !== null ? ` · ${fmt(user.tokensPerRun)}/run` : ''}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-blue-600" style={{ width: '100%' }} />
            </div>
          </div>
        )}
      </div>

      {/* Expandable model breakdown */}
      {models.length > 0 && (
        <>
          <button
            className="flex w-full items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground hover:bg-muted/20 transition-colors"
            onClick={() => setOpen(!open)}
          >
            <span>{models.length} model{models.length !== 1 ? 's' : ''} used</span>
            <Icons.ChevronDown className={cn('h-3 w-3 transition-transform', open ? 'rotate-180' : '')} />
          </button>
          {open && (
            <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-1.5">
              {models.map(([model, tokens]) => (
                <div key={model} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground truncate">{model}</span>
                  <span className="font-medium tabular-nums ml-2">{fmt(tokens)}</span>
                </div>
              ))}
              {user.humanizerWords > 0 && (
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/50">
                  <span className="text-purple-400">Humanizer</span>
                  <span className="font-medium tabular-nums">{fmt(user.humanizerWords)} words</span>
                </div>
              )}
              {user.mediaCostUsd > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-teal-400">Media (voice/video)</span>
                  <span className="font-medium tabular-nums">~${user.mediaCostUsd.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [teamData, setTeamData] = useState<TeamData | null>(null)
  const [teamLoading, setTeamLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/v1/usage')
      .then((r) => r.json())
      .then(({ data }) => setData(data))
      .catch(console.error)
      .finally(() => setLoading(false))

    apiFetch('/api/v1/reports/usage-by-user?days=30')
      .then((r) => r.json())
      .then(({ data }) => setTeamData(data))
      .catch(console.error)
      .finally(() => setTeamLoading(false))
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
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Icons.Zap} label="AI Tokens" value={fmt(data.totals.tokens)} sub="this billing period" color="text-blue-400" />
              <StatCard icon={Icons.Play} label="Workflow Runs" value={String(data.totals.runs)} sub="this billing period" />
              <StatCard icon={Icons.Mic} label="Transcription" value={`${data.totals.transcriptionMinutes}m`} sub="minutes processed" />
              <StatCard icon={Icons.ShieldCheck} label="Detection Calls" value={String(data.totals.detectionCalls)} sub="AI detection checks" color="text-amber-400" />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Icons.Languages} label="Translation" value={fmt(data.totals.translationChars, ' chars')} sub="characters translated" color="text-cyan-400" />
              <StatCard icon={Icons.Image} label="Images Generated" value={fmt(data.totals.imagesGenerated ?? 0)} sub="this billing period" color="text-pink-400" />
              <StatCard icon={Icons.Video} label="Videos Generated" value={fmt(data.totals.videosGenerated ?? 0)} sub="this billing period" color="text-violet-400" />
              <StatCard icon={Icons.ScanSearch} label="Video Intelligence" value={fmt(data.totals.videoIntelligenceCalls ?? 0)} sub={`~$${((data.totals.videoIntelligenceCostUsd ?? 0)).toFixed(2)} est.`} color="text-purple-400" />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Icons.Mic2} label="Voice Generation" value={fmt(data.totals.voiceChars ?? 0, ' chars')} sub={`${Math.round(data.totals.voiceGenerationSecs ?? 0)}s audio`} color="text-teal-400" />
              <StatCard icon={Icons.PersonStanding} label="Character Animation" value={`${Math.round(data.totals.charAnimSecs ?? 0)}s`} sub="video generated" color="text-sky-400" />
              <StatCard icon={Icons.Music} label="Music Generation" value={`${Math.round(data.totals.musicSecs ?? 0)}s`} sub="audio generated" color="text-emerald-400" />
              <StatCard icon={Icons.Film} label="Video Composition" value={`${Math.round(data.totals.videoCompSecs ?? 0)}s`} sub={`~$${((data.totals.videoCompCostUsd ?? 0)).toFixed(2)} est.`} color="text-orange-400" />
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

            {/* Voice Generation */}
            <Section
              title="Voice Generation (TTS)"
              icon={Icons.Mic2}
              color="text-teal-400"
              total={(data.totals.voiceChars ?? 0) > 0 ? `${fmt(data.totals.voiceChars ?? 0, ' chars')} · ${Math.round(data.totals.voiceGenerationSecs ?? 0)}s` : '0 chars'}
            >
              {(data.voiceGeneration?.totalChars ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No voice generation usage recorded</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {VOICE_SERVICE_DEFS.map((svc) => {
                    const usage = data.voiceGeneration?.byProvider.find((p) => p.provider === svc.key)
                    const chars = usage?.chars ?? 0
                    const secs  = usage?.secs ?? 0
                    const cost  = usage?.costUsd ?? 0
                    return (
                      <div key={svc.key} className={cn('rounded-lg border p-3 space-y-1', chars > 0 ? 'border-teal-500/40 bg-teal-950/20' : 'border-border bg-muted/20')}>
                        <p className="text-xs font-medium truncate">{svc.displayName}</p>
                        <p className={cn('text-xl font-semibold tabular-nums', chars > 0 ? 'text-teal-400' : 'text-muted-foreground/50')}>{fmt(chars)}</p>
                        <p className="text-[10px] text-muted-foreground">{chars > 0 ? `${Math.round(secs)}s · ~$${cost.toFixed(2)}` : svc.rateLabel}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Character Animation */}
            <Section
              title="Character Animation"
              icon={Icons.PersonStanding}
              color="text-sky-400"
              total={(data.totals.charAnimSecs ?? 0) > 0 ? `${Math.round(data.totals.charAnimSecs ?? 0)}s video` : '0s'}
            >
              {(data.characterAnimation?.totalSecs ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No character animation usage recorded</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {CHAR_ANIM_SERVICE_DEFS.map((svc) => {
                    const usage = data.characterAnimation?.byProvider.find((p) => p.provider === svc.key)
                    const secs  = usage?.secs ?? 0
                    const cost  = usage?.costUsd ?? 0
                    return (
                      <div key={svc.key} className={cn('rounded-lg border p-3 space-y-1', secs > 0 ? 'border-sky-500/40 bg-sky-950/20' : 'border-border bg-muted/20')}>
                        <p className="text-xs font-medium truncate">{svc.displayName}</p>
                        <p className={cn('text-xl font-semibold tabular-nums', secs > 0 ? 'text-sky-400' : 'text-muted-foreground/50')}>{Math.round(secs)}s</p>
                        <p className="text-[10px] text-muted-foreground">{secs > 0 ? `~$${cost.toFixed(2)}` : svc.rateLabel}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Music Generation */}
            <Section
              title="Music Generation"
              icon={Icons.Music}
              color="text-emerald-400"
              total={(data.totals.musicSecs ?? 0) > 0 ? `${Math.round(data.totals.musicSecs ?? 0)}s audio` : '0s'}
            >
              {(data.musicGeneration?.totalSecs ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No music generation usage recorded</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {MUSIC_SERVICE_DEFS.map((svc) => {
                    const usage = data.musicGeneration?.byProvider.find((p) => p.provider === svc.key)
                    const secs  = usage?.secs ?? 0
                    const cost  = usage?.costUsd ?? 0
                    return (
                      <div key={svc.key} className={cn('rounded-lg border p-3 space-y-1', secs > 0 ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-border bg-muted/20')}>
                        <p className="text-xs font-medium truncate">{svc.displayName}</p>
                        <p className={cn('text-xl font-semibold tabular-nums', secs > 0 ? 'text-emerald-400' : 'text-muted-foreground/50')}>{Math.round(secs)}s</p>
                        <p className="text-[10px] text-muted-foreground">{secs > 0 ? `~$${cost.toFixed(2)}` : svc.rateLabel}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Video Composition */}
            {(data.totals.videoCompSecs ?? 0) > 0 && (
              <Section
                title="Video Composition (Shotstack)"
                icon={Icons.Film}
                color="text-orange-400"
                total={`${Math.round(data.totals.videoCompSecs ?? 0)}s · ~$${((data.totals.videoCompCostUsd ?? 0)).toFixed(2)}`}
              >
                <div className="flex items-center justify-between rounded-lg border border-orange-500/40 bg-orange-950/20 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">Shotstack Cloud</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">$0.005/sec · cloud render</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold tabular-nums text-orange-400">{Math.round(data.videoComposition?.totalSecs ?? 0)}s</p>
                    <p className="text-[10px] text-muted-foreground">~${(data.videoComposition?.totalCostUsd ?? 0).toFixed(2)} est.</p>
                  </div>
                </div>
              </Section>
            )}

            {/* By client */}
            {data.byClient.length > 0 && (
              <Section title="Usage by Client" icon={Icons.Users} total={`${data.byClient.length} clients`}>
                {data.totals.tokens > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">AI Tokens</p>
                    {data.byClient.filter((c) => c.tokens > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.tokens} max={data.totals.tokens} />
                    ))}
                  </>
                )}
                {data.byClient.some((c) => c.translationChars > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Translation Chars</p>
                    {data.byClient.filter((c) => c.translationChars > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.translationChars} max={data.totals.translationChars} color="bg-cyan-600" />
                    ))}
                  </>
                )}
                {data.byClient.some((c) => (c.videosGenerated ?? 0) > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Videos Generated</p>
                    {data.byClient.filter((c) => (c.videosGenerated ?? 0) > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.videosGenerated ?? 0} max={Math.max(...data.byClient.map((x) => x.videosGenerated ?? 0))} color="bg-orange-500" />
                    ))}
                  </>
                )}
                {data.byClient.some((c) => (c.imagesGenerated ?? 0) > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Images Generated</p>
                    {data.byClient.filter((c) => (c.imagesGenerated ?? 0) > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.imagesGenerated ?? 0} max={Math.max(...data.byClient.map((x) => x.imagesGenerated ?? 0))} color="bg-pink-500" />
                    ))}
                  </>
                )}
                {data.byClient.some((c) => (c.videoIntelligenceCalls ?? 0) > 0) && (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium pt-2">Video Intelligence Runs</p>
                    {data.byClient.filter((c) => (c.videoIntelligenceCalls ?? 0) > 0).slice(0, 10).map((c) => (
                      <Bar key={c.clientId} label={c.clientName} value={c.videoIntelligenceCalls ?? 0} max={Math.max(...data.byClient.map((x) => x.videoIntelligenceCalls ?? 0))} color="bg-purple-600" />
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

            {/* Usage by User — simple bar view from existing records */}
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

            {/* Team Efficiency */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Icons.Users className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-semibold">Team Efficiency</span>
                  {teamData && (
                    <span className="text-xs text-muted-foreground ml-1">
                      — {teamData.users.length} user{teamData.users.length !== 1 ? 's' : ''} · ${teamData.grandTotalCostUsd.toFixed(2)} total
                    </span>
                  )}
                </div>
                {teamData && teamData.users.length > 0 && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Efficient</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" /> Average</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> High Usage</span>
                  </div>
                )}
              </div>

              <div className="p-5">
                {teamLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : !teamData || teamData.users.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No per-user data yet. Usage will appear here as team members run workflows.
                  </p>
                ) : (() => {
                  const usersWithRuns = teamData.users.filter((u) => u.efficiencyScore !== null)
                  const avgScore = usersWithRuns.length > 0
                    ? usersWithRuns.reduce((s, u) => s + u.efficiencyScore!, 0) / usersWithRuns.length
                    : 0

                  return (
                    <>
                      {/* Summary row */}
                      <div className="grid grid-cols-4 gap-3 mb-5">
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-lg font-semibold">${teamData.grandTotalCostUsd.toFixed(2)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Team Total Cost</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-lg font-semibold">{teamData.users.reduce((s, u) => s + u.completedRuns, 0)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Total Completed Runs</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-lg font-semibold">${avgScore.toFixed(2)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Avg Cost / Run</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-lg font-semibold">{teamData.users.length}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Active Users</p>
                        </div>
                      </div>

                      {/* User cards */}
                      <div className="grid grid-cols-2 gap-3">
                        {teamData.users.map((u) => (
                          <UserEfficiencyCard key={u.userId} user={u} avgScore={avgScore} />
                        ))}
                      </div>

                      <p className="mt-4 text-[10px] text-muted-foreground text-center">
                        Efficiency score = estimated cost per completed workflow run. Lower is better.
                        New usage records are attributed to users going forward.
                      </p>
                    </>
                  )
                })()}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
