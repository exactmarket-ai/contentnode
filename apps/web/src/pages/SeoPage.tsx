/**
 * SeoPage.tsx — /seo
 *
 * Top-level SEO strategy page.
 * Contains a client selector, Strategy Sessions list, and Content Briefs list.
 * Visible to: owner, strategist, org_admin, admin.
 */

import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SeoPilot } from '@/components/pilot/SeoPilot'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id: string
  name: string
  industry: string | null
}

interface SeoSession {
  id: string
  templateKey: string
  status: string
  clientId: string
  strategyOutput: {
    summary?: string
    primaryKeyword?: string
    contentPriorities?: unknown[]
  } | null
  createdAt: string
  updatedAt: string
}

interface SeoBrief {
  id: string
  topic: string
  targetKeyword: string
  funnelStage: string
  urgency: string
  paaQuestions: string[]
  contentFormat: string | null
  estimatedImpact: string | null
  brief: string | null
  pushedToNewsroom: boolean
  newsroomTopicId: string | null
  createdAt: string
}

// ─── Template name map ─────────────────────────────────────────────────────────

const TEMPLATE_NAMES: Record<string, string> = {
  pillar_strategy:      'Pillar Content Strategy',
  competitor_gap:       'Competitor Gap Audit',
  product_launch:       'Product Launch SEO',
  awareness_expansion:  'Brand Awareness Expansion',
  faq_domination:       'FAQ & Question Domination',
  geo_readiness:        'GEO Readiness Audit',
  seasonal_campaign:    'Seasonal Campaign',
  new_market:           'New Market Entry',
  thought_leadership:   'Thought Leadership Cluster',
}

// ─── Funnel stage badge ────────────────────────────────────────────────────────

function FunnelBadge({ stage }: { stage: string }) {
  const styles: Record<string, string> = {
    awareness:     'bg-blue-100 text-blue-700',
    consideration: 'bg-amber-100 text-amber-700',
    decision:      'bg-green-100 text-green-700',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', styles[stage] ?? 'bg-zinc-100 text-zinc-600')}>
      {stage}
    </span>
  )
}

// ─── Urgency badge ─────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: string }) {
  const styles: Record<string, string> = {
    now:   'bg-red-100 text-red-700',
    next:  'bg-amber-100 text-amber-700',
    later: 'bg-zinc-100 text-zinc-600',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', styles[urgency] ?? 'bg-zinc-100 text-zinc-600')}>
      {urgency}
    </span>
  )
}

// ─── Brief card ────────────────────────────────────────────────────────────────

function BriefCard({
  brief,
  onPush,
  pushing,
}: {
  brief: SeoBrief
  onPush: (id: string) => void
  pushing: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-transparent p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-foreground leading-snug truncate">{brief.topic}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <span className="font-medium text-foreground">{brief.targetKeyword}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <FunnelBadge stage={brief.funnelStage} />
          <UrgencyBadge urgency={brief.urgency} />
        </div>
      </div>

      {brief.brief && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{brief.brief}</p>
      )}

      {Array.isArray(brief.paaQuestions) && brief.paaQuestions.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">People Also Ask</p>
          <div className="flex flex-wrap gap-1">
            {(brief.paaQuestions as string[]).slice(0, 3).map((q, i) => (
              <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">{q}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {brief.contentFormat && (
          <span className="text-[10px] text-muted-foreground">{brief.contentFormat}</span>
        )}
        <div className="ml-auto">
          {brief.pushedToNewsroom ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <Icons.CheckCircle2 className="h-3 w-3" /> In Newsroom
            </span>
          ) : (
            <button
              onClick={() => onPush(brief.id)}
              disabled={pushing}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-900 disabled:opacity-40 transition-colors"
            >
              {pushing
                ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                : <Icons.Newspaper className="h-3 w-3" />}
              Push to Newsroom
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: SeoSession }) {
  const isComplete = session.status === 'complete'
  const templateName = TEMPLATE_NAMES[session.templateKey] ?? session.templateKey

  return (
    <div className="rounded-xl border border-border bg-transparent p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-foreground leading-snug">{templateName}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(session.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0',
          isComplete
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700',
        )}>
          {isComplete ? 'Complete' : 'In Progress'}
        </span>
      </div>
      {isComplete && session.strategyOutput?.summary && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
          {session.strategyOutput.summary}
        </p>
      )}
      {isComplete && session.strategyOutput?.primaryKeyword && (
        <p className="text-[10px] text-muted-foreground">
          Primary keyword: <span className="font-medium text-foreground">{session.strategyOutput.primaryKeyword}</span>
        </p>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SeoPage() {
  const [clients, setClients]         = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [sessions, setSessions]       = useState<SeoSession[]>([])
  const [briefs, setBriefs]           = useState<SeoBrief[]>([])
  const [loading, setLoading]         = useState(false)
  const [showPilot, setShowPilot]     = useState(false)
  const [pushingId, setPushingId]     = useState<string | null>(null)

  // Load clients on mount
  useEffect(() => {
    apiFetch('/api/v1/clients?limit=200')
      .then((r) => r.json())
      .then(({ data }: { data: Client[] }) => setClients(data ?? []))
      .catch(() => {})
  }, [])

  const selectedClient = clients.find((c) => c.id === selectedClientId)

  const loadData = useCallback(() => {
    if (!selectedClientId) return
    setLoading(true)
    Promise.all([
      apiFetch(`/api/v1/seo/sessions?clientId=${selectedClientId}`).then((r) => r.json()),
      apiFetch(`/api/v1/seo/briefs?clientId=${selectedClientId}`).then((r) => r.json()),
    ])
      .then(([sessData, briefData]) => {
        setSessions((sessData as { data: SeoSession[] }).data ?? [])
        setBriefs((briefData as { data: SeoBrief[] }).data ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedClientId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handlePushToNewsroom = async (briefId: string) => {
    setPushingId(briefId)
    try {
      const res = await apiFetch(`/api/v1/seo/briefs/${briefId}/push-to-newsroom`, { method: 'POST' })
      if (res.ok) {
        setBriefs((prev) => prev.map((b) => b.id === briefId
          ? { ...b, pushedToNewsroom: true }
          : b,
        ))
      }
    } finally {
      setPushingId(null)
    }
  }

  const handleStrategyComplete = () => {
    loadData()
  }

  const handleViewBriefs = () => {
    setShowPilot(false)
    // Scroll to briefs section after modal closes
    setTimeout(() => {
      document.getElementById('seo-briefs-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Page header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground">SEO Strategy</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Build and manage SEO content strategies with seoPILOT
            </p>
          </div>
        </div>

        {/* Client selector */}
        <div className="mt-3">
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 min-w-[220px]"
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">

        {!selectedClientId && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <Icons.TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Select a client to get started</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Choose a client above to view their SEO strategy sessions and content briefs.
              </p>
            </div>
          </div>
        )}

        {selectedClientId && (
          <>
            {/* Strategy Sessions */}
            <section>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Strategy Sessions</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Guided seoPILOT sessions for {selectedClient?.name}
                  </p>
                </div>
                <button
                  onClick={() => setShowPilot(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  <Icons.Plus className="h-3.5 w-3.5" /> New Strategy Session
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <Icons.TrendingUp className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-[12px] font-medium text-foreground">No sessions yet</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Click "New Strategy Session" to run seoPILOT.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sessions.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              )}
            </section>

            {/* Content Briefs */}
            <section id="seo-briefs-section">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">Content Briefs</h2>
                <p className="text-[11px] text-muted-foreground">
                  Generated from completed strategy sessions — push to the Newsroom queue to start writing.
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : briefs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <Icons.FileText className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-[12px] font-medium text-foreground">No briefs yet</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Complete a strategy session to generate content briefs.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {briefs.map((b) => (
                    <BriefCard
                      key={b.id}
                      brief={b}
                      onPush={handlePushToNewsroom}
                      pushing={pushingId === b.id}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* seoPILOT modal */}
      {showPilot && selectedClient && (
        <SeoPilot
          clientId={selectedClient.id}
          clientName={selectedClient.name}
          onClose={() => setShowPilot(false)}
          onViewBriefs={handleViewBriefs}
          onStrategyComplete={handleStrategyComplete}
        />
      )}
    </div>
  )
}
