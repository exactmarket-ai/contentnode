/**
 * ResearchNodePage.tsx
 *
 * researchNODE — Market Positioning & Competitive Assessment tool.
 * Assessments are persisted to the database via /api/v1/prospect-assessments.
 */

import { useState, useEffect, useCallback } from 'react'
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
}: {
  assessments: Assessment[]
  onNew: () => void
  onDelete: (id: string) => void
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
        return (
          <div key={a.id} className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icons.Telescope className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
              {a.url && <p className="text-[11px] text-muted-foreground truncate">{a.url}</p>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-muted-foreground">{relTime(a.createdAt)}</span>
              {a.totalScore != null && (
                <span className="text-[10px] font-semibold text-foreground">{a.totalScore.toFixed(1)}</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sc.color}`}>
                {sc.label}
              </span>
              <button
                onClick={() => onDelete(a.id)}
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
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showNew,     setShowNew]     = useState(false)

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

  const handleCreate = (a: Assessment) => setAssessments((prev) => [a, ...prev])

  const handleDelete = async (id: string) => {
    setAssessments((prev) => prev.filter((a) => a.id !== id))
    await apiFetch(`/api/v1/prospect-assessments/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const activeAssessment = assessments[0] ?? null

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
        {assessments.length > 0 && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Icons.Plus className="h-3.5 w-3.5" />
            New Assessment
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : assessments.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : (
          <AssessmentList
            assessments={assessments}
            onNew={() => setShowNew(true)}
            onDelete={handleDelete}
          />
        )}
      </div>

      {/* researchPILOT — bottom anchored */}
      <ResearchPilot
        prospectName={activeAssessment?.name}
        prospectUrl={activeAssessment?.url}
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
