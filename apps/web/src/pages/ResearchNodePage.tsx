/**
 * ResearchNodePage.tsx
 *
 * researchNODE — Market Positioning & Competitive Assessment tool.
 * Assessments are persisted to the database via /api/v1/prospect-assessments.
 *
 * Views:
 *   LIST   — all assessments, create / delete
 *   DETAIL — scoring UI for a single assessment (6 dimensions)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { ResearchPilot } from '@/components/pilot/ResearchPilot'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assessment {
  id: string
  name: string
  url: string | null
  industry: string | null
  status: string
  scores: Record<string, number> | null
  findings: Record<string, string> | null
  notes: string | null
  totalScore: number | null
  createdAt: string
  updatedAt: string
}

// ─── Dimension metadata ───────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: 'website_messaging',     label: 'Website & Messaging Audit',       weight: 20, icon: Icons.Globe },
  { key: 'social_outbound',       label: 'Social Media & Outbound Content', weight: 10, icon: Icons.Share2 },
  { key: 'positioning_segment',   label: 'Positioning & Segment Analysis',  weight: 20, icon: Icons.Target },
  { key: 'analyst_context',       label: 'Industry & Analyst Context',      weight: 15, icon: Icons.BarChart3 },
  { key: 'competitive_landscape', label: 'Competitive Landscape',           weight: 15, icon: Icons.Swords },
  { key: 'growth_signals',        label: 'Growth Opportunity Signals',      weight: 20, icon: Icons.TrendingUp },
]

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'researching',  label: 'Researching' },
  { value: 'scoring',      label: 'Scoring' },
  { value: 'complete',     label: 'Complete' },
  { value: 'archived',     label: 'Archived' },
]

// Score tier labels
const TIER_LABELS: Array<{ min: number; label: string; color: string }> = [
  { min: 4.5, label: 'Category Leader',    color: 'text-emerald-700' },
  { min: 3.5, label: 'Strong Performer',   color: 'text-blue-700' },
  { min: 2.5, label: 'Developing',         color: 'text-amber-700' },
  { min: 1.5, label: 'Weak Positioning',   color: 'text-orange-700' },
  { min: 0,   label: 'At Risk',            color: 'text-red-700' },
]

function tierFor(score: number | null) {
  if (score == null) return null
  return TIER_LABELS.find((t) => score >= t.min) ?? TIER_LABELS[TIER_LABELS.length - 1]
}

const WEIGHTS: Record<string, number> = {
  website_messaging:     0.20,
  social_outbound:       0.10,
  positioning_segment:   0.20,
  analyst_context:       0.15,
  competitive_landscape: 0.15,
  growth_signals:        0.20,
}

function calcTotal(scores: Record<string, number>): number {
  let total = 0
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (scores[key] != null) total += scores[key] * weight
  }
  return Math.round(total * 10) / 10
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Not started', color: 'bg-zinc-100 text-zinc-600' },
  researching:  { label: 'Researching', color: 'bg-blue-100 text-blue-700' },
  scoring:      { label: 'Scoring',     color: 'bg-amber-100 text-amber-700' },
  complete:     { label: 'Complete',    color: 'bg-emerald-100 text-emerald-700' },
  archived:     { label: 'Archived',    color: 'bg-zinc-100 text-zinc-500' },
}

// ─── Score input (1-5 stars / numeric selector) ───────────────────────────────

function ScoreSelector({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? null : n)}
          title={`Score ${n}`}
          className={`h-7 w-7 rounded-md border text-xs font-semibold transition-colors ${
            value != null && value >= n
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-border bg-white text-muted-foreground hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          {n}
        </button>
      ))}
      {value != null && (
        <button
          onClick={() => onChange(null)}
          className="ml-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Clear score"
        >
          clear
        </button>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-border">
        <Icons.Telescope className="h-7 w-7 text-muted-foreground/40" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-sm font-semibold text-foreground">No assessments yet</p>
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
          Start a new prospect assessment to gather market positioning intelligence across 6 weighted dimensions and generate a capabilities deck.
        </p>
      </div>
      <Button size="sm" className="gap-1.5" onClick={onNew}>
        <Icons.Plus className="h-3.5 w-3.5" />
        New Assessment
      </Button>
      <div className="w-full max-w-sm space-y-1.5">
        {DIMENSIONS.map((d) => (
          <div key={d.key} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
            <d.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-foreground">{d.label}</span>
            <span className="ml-auto text-xs font-medium text-muted-foreground">{d.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Assessment list ──────────────────────────────────────────────────────────

function AssessmentList({
  assessments,
  onNew,
  onDelete,
  onOpen,
}: {
  assessments: Assessment[]
  onNew: () => void
  onDelete: (id: string) => void
  onOpen: (a: Assessment) => void
}) {
  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">
          {assessments.length} assessment{assessments.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" className="gap-1.5" onClick={onNew}>
          <Icons.Plus className="h-3.5 w-3.5" />
          New Assessment
        </Button>
      </div>

      {assessments.map((a) => {
        const sc = STATUS_CONFIG[a.status] ?? STATUS_CONFIG.not_started
        const tier = tierFor(a.totalScore)
        return (
          <div
            key={a.id}
            className="flex items-center gap-4 rounded-xl border border-border px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => onOpen(a)}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icons.Telescope className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{a.name}</p>
              {a.url && <p className="text-[11px] text-muted-foreground truncate">{a.url}</p>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-muted-foreground">{relTime(a.createdAt)}</span>
              {a.totalScore != null && (
                <div className="text-right">
                  <span className="text-[13px] font-bold text-foreground">{a.totalScore.toFixed(1)}</span>
                  {tier && <p className={`text-[9px] font-medium ${tier.color}`}>{tier.label}</p>}
                </div>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sc.color}`}>
                {sc.label}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(a.id) }}
                title="Delete assessment"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <Icons.Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Assessment detail (scoring UI) ──────────────────────────────────────────

function AssessmentDetail({
  initial,
  onBack,
  onUpdated,
}: {
  initial: Assessment
  onBack: () => void
  onUpdated: (a: Assessment) => void
}) {
  const [assessment, setAssessment] = useState<Assessment>(initial)
  const [scores,     setScores]     = useState<Record<string, number>>(initial.scores ?? {})
  const [findings,   setFindings]   = useState<Record<string, string>>(initial.findings ?? {})
  const [notes,      setNotes]      = useState(initial.notes ?? '')
  const [status,     setStatus]     = useState(initial.status)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live weighted total from current scores state
  const liveTotal = Object.keys(scores).length > 0 ? calcTotal(scores) : null
  const tier = tierFor(liveTotal)

  const save = useCallback(async (
    nextScores: Record<string, number>,
    nextFindings: Record<string, string>,
    nextNotes: string,
    nextStatus: string,
  ) => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/prospect-assessments/${assessment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scores: Object.keys(nextScores).length > 0 ? nextScores : null,
          findings: Object.keys(nextFindings).some(k => nextFindings[k]) ? nextFindings : null,
          notes: nextNotes.trim() || null,
          status: nextStatus,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setAssessment(json.data)
        onUpdated(json.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }, [assessment.id, onUpdated])

  // Debounced auto-save on any change
  const scheduleAutoSave = useCallback((
    nextScores: Record<string, number>,
    nextFindings: Record<string, string>,
    nextNotes: string,
    nextStatus: string,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void save(nextScores, nextFindings, nextNotes, nextStatus)
    }, 1200)
  }, [save])

  const handleScoreChange = (key: string, val: number | null) => {
    const next = { ...scores }
    if (val == null) delete next[key]
    else next[key] = val
    setScores(next)
    scheduleAutoSave(next, findings, notes, status)
  }

  const handleFindingChange = (key: string, val: string) => {
    const next = { ...findings, [key]: val }
    setFindings(next)
    scheduleAutoSave(scores, next, notes, status)
  }

  const handleNotesChange = (val: string) => {
    setNotes(val)
    scheduleAutoSave(scores, findings, val, status)
  }

  const handleStatusChange = (val: string) => {
    setStatus(val)
    scheduleAutoSave(scores, findings, notes, val)
  }

  const handleSaveNow = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void save(scores, findings, notes, status)
  }

  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-4 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.ChevronLeft className="h-3.5 w-3.5" />
          All assessments
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{assessment.name}</h2>
          {assessment.url && (
            <p className="text-[11px] text-muted-foreground truncate">{assessment.url}</p>
          )}
        </div>
        {/* Live score */}
        {liveTotal != null && (
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-foreground leading-none">{liveTotal.toFixed(1)}</p>
            {tier && <p className={`text-[10px] font-medium ${tier.color}`}>{tier.label}</p>}
          </div>
        )}
        {/* Status selector */}
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium border-0 outline-none cursor-pointer ${sc.color}`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Save indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!saving && saved && <span className="text-[11px] text-emerald-600 font-medium">Saved</span>}
          <Button size="sm" variant="outline" onClick={handleSaveNow} disabled={saving}>
            Save
          </Button>
        </div>
      </div>

      {/* Dimension cards */}
      <div className="flex-1 overflow-auto min-h-0 p-6 space-y-4">
        {/* Score summary bar */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-zinc-50 px-4 py-3">
          <Icons.BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 flex flex-wrap gap-x-4 gap-y-1">
            {DIMENSIONS.map((d) => (
              <div key={d.key} className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">{d.label.split(' ')[0]}</span>
                {scores[d.key] != null ? (
                  <span className="text-[11px] font-semibold text-foreground">{scores[d.key]}/5</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50">—</span>
                )}
                <span className="text-[10px] text-muted-foreground/40">{d.weight}%</span>
              </div>
            ))}
          </div>
          {liveTotal != null && (
            <div className="shrink-0 text-right">
              <span className="text-sm font-bold text-foreground">{liveTotal.toFixed(1)}</span>
              {tier && <p className={`text-[10px] font-medium ${tier.color}`}>{tier.label}</p>}
            </div>
          )}
        </div>

        {/* 6 dimension cards */}
        {DIMENSIONS.map((d) => (
          <div key={d.key} className="rounded-xl border border-border bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <d.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{d.label}</span>
                <span className="text-[11px] text-muted-foreground font-medium">{d.weight}%</span>
              </div>
              <ScoreSelector
                value={scores[d.key] ?? null}
                onChange={(v) => handleScoreChange(d.key, v)}
              />
            </div>
            <textarea
              value={findings[d.key] ?? ''}
              onChange={(e) => handleFindingChange(d.key, e.target.value)}
              placeholder={`Add your findings for ${d.label.toLowerCase()}…`}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-zinc-50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-400 focus:bg-white transition-colors"
            />
          </div>
        ))}

        {/* Notes */}
        <div className="rounded-xl border border-border bg-white p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Icons.StickyNote className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Notes</span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="General notes, next steps, context…"
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-zinc-50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-400 focus:bg-white transition-colors"
          />
        </div>
      </div>
    </div>
  )
}

// ─── New Assessment modal ─────────────────────────────────────────────────────

function NewAssessmentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (a: Assessment) => void
}) {
  const [name,    setName]    = useState('')
  const [url,     setUrl]     = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/v1/prospect-assessments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)
      onCreate(json.data)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assessment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icons.Telescope className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">New Prospect Assessment</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Prospect / Company name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
              placeholder="e.g. Thrive NextGen"
              autoFocus
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Website URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] text-zinc-600 leading-relaxed">
          Use <strong className="text-zinc-800">researchPILOT</strong> to guide your research across the 6 dimensions once the assessment is created.
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || saving} onClick={() => void handleCreate()}>
            {saving ? 'Creating…' : 'Create Assessment'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ResearchNodePage() {
  const [assessments,  setAssessments]  = useState<Assessment[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showNew,      setShowNew]      = useState(false)
  const [activeDetail, setActiveDetail] = useState<Assessment | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/prospect-assessments')
      const { data } = await res.json()
      setAssessments(data ?? [])
    } catch (_) {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleCreate = (a: Assessment) => {
    setAssessments((prev) => [a, ...prev])
    // Open detail view immediately after creation
    setActiveDetail(a)
  }

  const handleDelete = async (id: string) => {
    if (activeDetail?.id === id) setActiveDetail(null)
    setAssessments((prev) => prev.filter((a) => a.id !== id))
    await apiFetch(`/api/v1/prospect-assessments/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const handleUpdated = (updated: Assessment) => {
    setAssessments((prev) => prev.map((a) => a.id === updated.id ? updated : a))
    setActiveDetail(updated)
  }

  const pilotAssessment = activeDetail ?? assessments[0] ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Icons.Telescope className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-none">researchNODE</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Market positioning & competitive intelligence</p>
          </div>
        </div>
        {!activeDetail && assessments.length > 0 && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Icons.Plus className="h-3.5 w-3.5" />
            New Assessment
          </Button>
        )}
        {activeDetail && (
          <button
            onClick={() => void handleDelete(activeDetail.id)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors"
          >
            <Icons.Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : activeDetail ? (
          <AssessmentDetail
            initial={activeDetail}
            onBack={() => setActiveDetail(null)}
            onUpdated={handleUpdated}
          />
        ) : assessments.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : (
          <AssessmentList
            assessments={assessments}
            onNew={() => setShowNew(true)}
            onDelete={handleDelete}
            onOpen={setActiveDetail}
          />
        )}
      </div>

      {/* researchPILOT — bottom anchored */}
      <ResearchPilot
        prospectName={pilotAssessment?.name}
        prospectUrl={pilotAssessment?.url}
      />

      {/* New assessment modal */}
      {showNew && (
        <NewAssessmentModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
