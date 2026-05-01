import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Stats {
  total: number
  approved: number
  readyForTraining: number
  bySource: Record<string, number>
  byService: Record<string, number>
  avgScoreBefore: number | null
  avgScoreAfter: number | null
  avgImprovement: number | null
}

interface Example {
  id: string
  source: string
  service: string
  wordCountBefore: number | null
  wordCountAfter: number
  detectionScoreBefore: number | null
  detectionScoreAfter: number | null
  approved: boolean
  createdAt: string
  workflowRunId: string | null
  contentBeforePreview: string | null
  contentAfterPreview: string
  contentBefore: string | null
}

interface ExampleFull extends Example {
  contentBefore: string | null
  contentAfter: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>
  const color = score < 15 ? 'text-emerald-700' : score <= 35 ? 'text-amber-700' : 'text-red-700'
  const bg    = score < 15 ? 'bg-emerald-100' : score <= 35 ? 'bg-amber-100' : 'bg-red-100'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', color, bg)}>
      {score}%
    </span>
  )
}

function SourceBadge({ source }: { source: string }) {
  const isWriter = source === 'writer'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
      isWriter ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
    )}>
      {isWriter ? <Icons.PenLine className="h-2.5 w-2.5" /> : <Icons.Bot className="h-2.5 w-2.5" />}
      {isWriter ? 'Writer' : 'Auto'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded example modal
// ─────────────────────────────────────────────────────────────────────────────

function ExampleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [example, setExample] = useState<ExampleFull | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/v1/humanizer-examples/${id}`)
      .then((r) => r.json())
      .then(({ data }) => setExample(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Training Example</h2>
            {example && <SourceBadge source={example.source} />}
            {example && <span className="text-xs text-muted-foreground">{example.service}</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : example ? (
          <div className="flex flex-1 overflow-hidden divide-x divide-border">
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                Before
                {example.detectionScoreBefore != null && <ScorePill score={example.detectionScoreBefore} />}
                {example.wordCountBefore != null && <span className="text-muted-foreground/60">{example.wordCountBefore}w</span>}
              </p>
              <div className="flex-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {example.contentBefore ?? <span className="italic text-muted-foreground/40">Not recorded</span>}
              </div>
            </div>
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                After
                {example.detectionScoreAfter != null && <ScorePill score={example.detectionScoreAfter} />}
                <span className="text-muted-foreground/60">{example.wordCountAfter}w</span>
              </p>
              <div className="flex-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {example.contentAfter}
              </div>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Failed to load example.</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  stealthgpt: 'StealthGPT',
  bypassgpt: 'BypassGPT',
  undetectable: 'Undetectable',
  cnHumanizer: 'cnHumanizer',
  writer: 'Writer',
  auto: 'Auto',
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Layer types
// ─────────────────────────────────────────────────────────────────────────────

interface HumanizerProfile {
  id: string
  scope: 'agency' | 'client' | 'content_type'
  scopeId: string | null
  profile: string | null
  signalCount: number
  lastSynthesisAt: string | null
  updatedAt: string
}

interface EditSignal {
  id: string
  clientId: string
  clientName: string | null
  contentType: string | null
  assignmentType: string | null
  editSummary: string | null
  originalExcerpt: string | null
  approvedExcerpt: string | null
  createdAt: string
}

interface ContentTypeRow {
  contentType: string
  signalCount: number
  lastSignalAt: string | null
  hasProfile: boolean
  profileSignalCount: number
  lastSynthesisAt: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Layer — profile card
// ─────────────────────────────────────────────────────────────────────────────

function ProfileCard({
  scope, scopeId, profile, signalCount, lastSynthesisAt,
  onResynthesize, synthesizing,
}: {
  scope: string; scopeId: string | null; profile: string | null
  signalCount: number; lastSynthesisAt: string | null
  onResynthesize: () => void; synthesizing: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const label = scope === 'agency' ? 'Agency-wide' : scope === 'client' ? `Client: ${scopeId ?? ''}` : `Type: ${scopeId ?? ''}`

  return (
    <div className="rounded-xl border border-border bg-transparent p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {signalCount} signal{signalCount !== 1 ? 's' : ''}
            {lastSynthesisAt ? ` · synthesized ${new Date(lastSynthesisAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ' · never synthesized'}
          </p>
        </div>
        <button
          onClick={onResynthesize}
          disabled={synthesizing}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          {synthesizing ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.RefreshCw className="h-3 w-3" />}
          Synthesize
        </button>
      </div>
      {profile ? (
        <div>
          <p className={cn('text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap', !expanded && 'line-clamp-4')}>
            {profile}
          </p>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 text-[11px] text-blue-600 hover:underline"
          >
            {expanded ? 'Show less' : 'Show full profile'}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground italic">No profile yet — needs {Math.max(0, 5 - signalCount)} more edit signal{5 - signalCount !== 1 ? 's' : ''} to synthesize.</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Layer — signal row
// ─────────────────────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: EditSignal }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-border/50 last:border-0 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {signal.contentType && (
              <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                {signal.contentType}
              </span>
            )}
            {signal.clientName && (
              <span className="text-[11px] text-muted-foreground">{signal.clientName}</span>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {new Date(signal.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <p className={cn('text-[12px] text-foreground leading-relaxed', !expanded && 'line-clamp-2')}>
            {signal.editSummary ?? 'No summary available'}
          </p>
          {expanded && signal.originalExcerpt && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Original</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{signal.originalExcerpt}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Approved</p>
                <p className="text-[11px] text-foreground leading-relaxed">{signal.approvedExcerpt}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Layer tab
// ─────────────────────────────────────────────────────────────────────────────

function IntelligenceLayer() {
  const [profiles, setProfiles]             = useState<HumanizerProfile[]>([])
  const [signals, setSignals]               = useState<EditSignal[]>([])
  const [contentTypes, setContentTypes]     = useState<ContentTypeRow[]>([])
  const [loading, setLoading]               = useState(true)
  const [signalPage, setSignalPage]         = useState(1)
  const [signalTotal, setSignalTotal]       = useState(0)
  const [synthesizing, setSynthesizing]     = useState<string | null>(null)
  const [clientFilter, setClientFilter]     = useState('')

  const fetchAll = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (clientFilter) params.set('clientId', clientFilter)

      const [profRes, sigRes, ctRes] = await Promise.all([
        apiFetch('/api/v1/cn-humanizer-intelligence/profiles').then((r) => r.json()),
        apiFetch(`/api/v1/cn-humanizer-intelligence/signals?${params}`).then((r) => r.json()),
        apiFetch('/api/v1/cn-humanizer-intelligence/content-types').then((r) => r.json()),
      ])
      setProfiles(profRes.data ?? [])
      setSignals(sigRes.data ?? [])
      setSignalTotal(sigRes.pagination?.total ?? 0)
      setContentTypes(ctRes.data ?? [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientFilter])

  useEffect(() => { void fetchAll(1) }, [fetchAll])

  const handleResynthesize = async (scope: string, scopeId: string | null) => {
    const key = `${scope}-${scopeId ?? 'agency'}`
    setSynthesizing(key)
    try {
      await apiFetch(`/api/v1/cn-humanizer-intelligence/profiles/${scope}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeId }),
      })
    } catch { /* ignore */ }
    finally { setSynthesizing(null) }
  }

  const agencyProfile = profiles.find((p) => p.scope === 'agency')
  const clientProfiles = profiles.filter((p) => p.scope === 'client')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
        <Icons.Loader2 className="h-4 w-4 animate-spin" />Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Agency profile */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
            <Icons.Globe className="h-3.5 w-3.5 text-violet-400" />
            Agency-wide Style Profile
          </h3>
          <button onClick={() => void fetchAll(1)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Icons.RefreshCw className="h-3 w-3" />Refresh
          </button>
        </div>
        {agencyProfile ? (
          <ProfileCard
            scope="agency"
            scopeId={null}
            profile={agencyProfile.profile}
            signalCount={agencyProfile.signalCount}
            lastSynthesisAt={agencyProfile.lastSynthesisAt}
            onResynthesize={() => void handleResynthesize('agency', null)}
            synthesizing={synthesizing === 'agency-agency'}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <Icons.BrainCircuit className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No agency profile yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Profiles are compiled automatically after 5 edit signals. Approve edited content to start accumulating signal.</p>
          </div>
        )}
      </section>

      {/* Client profiles */}
      {clientProfiles.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5 mb-3">
            <Icons.Users className="h-3.5 w-3.5 text-blue-400" />
            Client-level Profiles
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {clientProfiles.map((p) => (
              <ProfileCard
                key={p.id}
                scope="client"
                scopeId={p.scopeId}
                profile={p.profile}
                signalCount={p.signalCount}
                lastSynthesisAt={p.lastSynthesisAt}
                onResynthesize={() => void handleResynthesize('client', p.scopeId)}
                synthesizing={synthesizing === `client-${p.scopeId}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Content type breakdown */}
      {contentTypes.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5 mb-3">
            <Icons.Tag className="h-3.5 w-3.5 text-amber-400" />
            Content Type Breakdown
          </h3>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Content Type</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Signals</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Profile</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Last Synthesized</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contentTypes.map((ct) => (
                  <tr key={ct.contentType} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{ct.contentType}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{ct.signalCount}</td>
                    <td className="px-4 py-2.5">
                      {ct.hasProfile ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          <Icons.Check className="h-2.5 w-2.5" />Active
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/50">
                          {ct.signalCount < 5 ? `${5 - ct.signalCount} more needed` : 'Pending'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ct.lastSynthesisAt ? new Date(ct.lastSynthesisAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {ct.signalCount >= 5 && (
                        <button
                          onClick={() => void handleResynthesize('content_type', ct.contentType)}
                          disabled={synthesizing === `content_type-${ct.contentType}`}
                          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          {synthesizing === `content_type-${ct.contentType}`
                            ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                            : <Icons.RefreshCw className="h-3 w-3" />
                          }
                          Synthesize
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Edit signal feed */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
            <Icons.Activity className="h-3.5 w-3.5 text-emerald-400" />
            Edit Signal Feed
            <span className="text-[11px] font-normal text-muted-foreground">{signalTotal} total</span>
          </h3>
        </div>
        {signals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <Icons.Activity className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No edit signals yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Signals are captured when content is edited before being approved in the Content Library.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-transparent px-4 py-2">
            {signals.map((s) => <SignalRow key={s.id} signal={s} />)}
          </div>
        )}
        {signalTotal > 25 && (
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              disabled={signalPage <= 1}
              onClick={() => { setSignalPage((p) => p - 1); void fetchAll(signalPage - 1) }}
              className="h-7 px-2.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {signalPage}</span>
            <button
              disabled={signalPage * 25 >= signalTotal}
              onClick={() => { setSignalPage((p) => p + 1); void fetchAll(signalPage + 1) }}
              className="h-7 px-2.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function HumanizerDashboard() {
  const [activeTab, setActiveTab]   = useState<'training' | 'intelligence'>('training')
  const [stats, setStats] = useState<Stats | null>(null)
  const [examples, setExamples] = useState<Example[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [filterSource, setFilterSource] = useState('all')
  const [filterService, setFilterService] = useState('all')
  const [filterApproved, setFilterApproved] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/humanizer-examples/stats')
      .then((r) => r.json())
      .then(({ data }) => setStats(data))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  const fetchExamples = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '50' })
    if (filterSource !== 'all') params.set('source', filterSource)
    if (filterService !== 'all') params.set('service', filterService)
    if (filterApproved !== 'all') params.set('approved', filterApproved)
    try {
      const res = await apiFetch(`/api/v1/humanizer-examples?${params}`)
      const { data, meta } = await res.json()
      setExamples(data ?? [])
      setTotal(meta?.total ?? 0)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filterSource, filterService, filterApproved])

  useEffect(() => { void fetchExamples() }, [fetchExamples])

  const handleToggleApproved = async (example: Example) => {
    setTogglingId(example.id)
    try {
      const res = await apiFetch(`/api/v1/humanizer-examples/${example.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ approved: !example.approved }),
      })
      if (res.ok) {
        setExamples((prev) => prev.map((e) => e.id === example.id ? { ...e, approved: !e.approved } : e))
        setStats((prev) => prev ? {
          ...prev,
          approved: prev.approved + (example.approved ? -1 : 1),
        } : prev)
      }
    } catch { /* ignore */ }
    finally { setTogglingId(null) }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await apiFetch(`/api/v1/humanizer-examples/${id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        setExamples((prev) => prev.filter((e) => e.id !== id))
        setTotal((t) => t - 1)
        setStats((prev) => prev ? { ...prev, total: prev.total - 1 } : prev)
      }
    } catch { /* ignore */ }
    finally { setDeletingId(null) }
  }

  const services = stats ? Object.keys(stats.byService) : []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {expandedId && <ExampleModal id={expandedId} onClose={() => setExpandedId(null)} />}

      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Icons.BrainCircuit className="h-4 w-4 text-violet-400" />
              cnHumanizer
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Style intelligence built from real human editorial decisions.
            </p>
          </div>
          {activeTab === 'training' && (
            <button onClick={fetchExamples} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Icons.RefreshCw className="h-3 w-3" />Refresh
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {([
            { key: 'training', label: 'Training Data', icon: Icons.Database },
            { key: 'intelligence', label: 'Style Intelligence', icon: Icons.Sparkles },
          ] as const).map(({ key, label, icon: Ic }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                activeTab === key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              <Ic className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Intelligence Layer tab */}
        {activeTab === 'intelligence' && <IntelligenceLayer />}

        {/* Training data tab */}
        {activeTab === 'training' && <>

        {/* Stats cards */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total Examples', value: statsLoading ? '—' : (stats?.total ?? 0), icon: Icons.Database, color: 'text-blue-400' },
            { label: 'Approved', value: statsLoading ? '—' : (stats?.approved ?? 0), icon: Icons.CheckCircle2, color: 'text-emerald-400' },
            { label: 'Ready for Few-Shot', value: statsLoading ? '—' : (stats?.readyForTraining ?? 0), icon: Icons.Sparkles, color: 'text-amber-400', tooltip: 'Approved examples with before/after pairs — actively used to train cnHumanizer' },
            { label: 'Avg Score Before', value: statsLoading ? '—' : (stats?.avgScoreBefore != null ? `${stats.avgScoreBefore.toFixed(0)}%` : '—'), icon: Icons.TrendingDown, color: 'text-red-400' },
            { label: 'Avg Score After', value: statsLoading ? '—' : (stats?.avgScoreAfter != null ? `${stats.avgScoreAfter.toFixed(0)}%` : '—'), icon: Icons.TrendingUp, color: 'text-emerald-400' },
          ].map(({ label, value, icon: Icon, color, tooltip }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4" title={tooltip}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn('h-3.5 w-3.5', color)} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
              <p className="text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* By service breakdown */}
        {stats && services.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">By Service</p>
            <div className="flex flex-wrap gap-3">
              {services.map((svc) => (
                <div key={svc} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="text-xs font-medium">{SERVICE_LABELS[svc] ?? svc}</span>
                  <span className="text-xs text-muted-foreground">{stats.byService[svc]} examples</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="all">All sources</option>
            <option value="third-party">Auto (third-party)</option>
            <option value="writer">Writer submissions</option>
          </select>
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="all">All services</option>
            {services.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s] ?? s}</option>)}
          </select>
          <select value={filterApproved} onChange={(e) => setFilterApproved(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="all">All statuses</option>
            <option value="true">Approved only</option>
            <option value="false">Unapproved only</option>
          </select>
          <span className="ml-auto text-xs text-muted-foreground">{total} examples</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : examples.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Icons.BrainCircuit className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No training examples yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Examples are collected automatically from humanizer runs and writer submissions.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Service</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Words</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Score Before</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Score After</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Preview</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Approved</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Training</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {examples.map((ex) => (
                  <tr key={ex.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(ex.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </td>
                    <td className="px-4 py-3"><SourceBadge source={ex.source} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{SERVICE_LABELS[ex.service] ?? ex.service}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ex.wordCountBefore != null ? `${ex.wordCountBefore}→` : ''}{ex.wordCountAfter}
                    </td>
                    <td className="px-4 py-3"><ScorePill score={ex.detectionScoreBefore} /></td>
                    <td className="px-4 py-3"><ScorePill score={ex.detectionScoreAfter} /></td>
                    <td className="px-4 py-3 max-w-[240px]">
                      <button
                        onClick={() => setExpandedId(ex.id)}
                        className="text-left text-muted-foreground hover:text-foreground line-clamp-2 transition-colors"
                        title="Click to view full content"
                      >
                        {ex.contentAfterPreview}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleApproved(ex)}
                        disabled={togglingId === ex.id}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                          ex.approved
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700'
                            : 'bg-red-100 text-red-700 hover:bg-emerald-100 hover:text-emerald-700'
                        )}
                      >
                        {togglingId === ex.id
                          ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
                          : ex.approved
                            ? <><Icons.Check className="h-2.5 w-2.5" />Approved</>
                            : <><Icons.X className="h-2.5 w-2.5" />Excluded</>
                        }
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {ex.approved && ex.contentBefore ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="This example is actively used in cnHumanizer few-shot prompts">
                          <Icons.Sparkles className="h-2.5 w-2.5" />Active
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40" title={!ex.contentBefore ? 'No original content — submit a draft to enable' : 'Not approved'}>
                          {!ex.contentBefore ? 'No before' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(ex.id)}
                        disabled={deletingId === ex.id}
                        className="rounded p-1 text-muted-foreground/40 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete example"
                      >
                        {deletingId === ex.id
                          ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                          : <Icons.Trash2 className="h-3 w-3" />
                        }
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        </> /* end training tab */}
      </div>
    </div>
  )
}
