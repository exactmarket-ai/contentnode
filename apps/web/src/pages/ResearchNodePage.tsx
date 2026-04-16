/**
 * ResearchNodePage.tsx
 *
 * researchNODE — Market Positioning & Competitive Assessment tool.
 * Accessible from the primary left navigation (super admin gated).
 * researchPILOT anchored at the bottom, same pattern as GTMPilot.
 */

import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResearchPilot } from '@/components/pilot/ResearchPilot'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assessment {
  id: string
  name: string
  url: string
  createdAt: string
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

function AssessmentList({ assessments, onNew }: { assessments: Assessment[]; onNew: () => void }) {
  const relTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{assessments.length} assessment{assessments.length !== 1 ? 's' : ''}</p>
        <Button size="sm" className="gap-1.5" onClick={onNew}>
          <Icons.Plus className="h-3.5 w-3.5" />
          New Assessment
        </Button>
      </div>
      {assessments.map((a) => (
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
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">In progress</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── New Assessment modal ─────────────────────────────────────────────────────

function NewAssessmentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (a: Assessment) => void }) {
  const [name, setName] = useState('')
  const [url,  setUrl]  = useState('')

  const handleCreate = () => {
    if (!name.trim()) return
    onCreate({
      id: crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      createdAt: new Date().toISOString(),
    })
    onClose()
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
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
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
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] text-zinc-600 leading-relaxed">
          Assessment workflows are coming soon. For now, use <strong className="text-zinc-800">researchPILOT</strong> to guide your research manually across the 6 dimensions.
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name.trim()} onClick={handleCreate}>Create Assessment</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ResearchNodePage() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [showNew, setShowNew]         = useState(false)

  const activeAssessment = assessments[assessments.length - 1] ?? null

  const handleCreate = (a: Assessment) => {
    setAssessments((prev) => [...prev, a])
  }

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
        {assessments.length === 0
          ? <EmptyState onNew={() => setShowNew(true)} />
          : <AssessmentList assessments={assessments} onNew={() => setShowNew(true)} />
        }
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
