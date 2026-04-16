/**
 * ResearchNodePage.tsx
 *
 * researchNODE — Market Positioning & Competitive Assessment tool.
 * Accessible from the primary left navigation (super admin gated).
 * Includes researchPILOT chat panel on the right.
 */

import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { ResearchPilot } from '@/components/pilot/ResearchPilot'

// ─── Dimension metadata ───────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: 'website_messaging',    label: 'Website & Messaging Audit',        weight: 20, icon: Icons.Globe },
  { key: 'social_outbound',      label: 'Social Media & Outbound Content',  weight: 10, icon: Icons.Share2 },
  { key: 'positioning_segment',  label: 'Positioning & Segment Analysis',   weight: 20, icon: Icons.Target },
  { key: 'analyst_context',      label: 'Industry & Analyst Context',       weight: 15, icon: Icons.BarChart3 },
  { key: 'competitive_landscape',label: 'Competitive Landscape',            weight: 15, icon: Icons.Swords },
  { key: 'growth_signals',       label: 'Growth Opportunity Signals',       weight: 20, icon: Icons.TrendingUp },
]

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const tier =
    score >= 4.5 ? { label: 'Category Leader',         color: 'bg-emerald-100 text-emerald-700' } :
    score >= 3.5 ? { label: 'Strong Performer',         color: 'bg-blue-100 text-blue-700' } :
    score >= 2.5 ? { label: 'Developing',               color: 'bg-amber-100 text-amber-700' } :
    score >= 1.5 ? { label: 'Weak Positioning',         color: 'bg-orange-100 text-orange-700' } :
                   { label: 'At Risk',                  color: 'bg-red-100 text-red-700' }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', tier.color)}>
      {score.toFixed(1)} — {tier.label}
    </span>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-border">
        <Icons.Telescope className="h-7 w-7 text-muted-foreground/40" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">No assessments yet</p>
        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
          Start a new prospect assessment to gather market positioning intelligence across 6 weighted dimensions and generate a capabilities deck.
        </p>
      </div>
      <div className="space-y-2 w-full max-w-xs">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-700 transition-colors"
        >
          <Icons.Plus className="h-3.5 w-3.5" />
          New Assessment
        </button>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
          {DIMENSIONS.map((d) => (
            <div key={d.key} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
              <d.icon className="h-3 w-3 shrink-0 text-violet-500" />
              <span className="truncate">{d.label.split(' ')[0]} {d.label.split(' ')[1]}</span>
              <span className="ml-auto shrink-0 font-medium text-foreground">{d.weight}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── New Assessment modal (placeholder) ──────────────────────────────────────

function NewAssessmentModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [url,  setUrl]  = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icons.Telescope className="h-4 w-4 text-violet-600" />
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
              placeholder="e.g. Thrive NextGen"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Website URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-[11px] text-violet-700 leading-relaxed">
          Assessment workflows are coming soon. For now, use <strong>researchPILOT</strong> to guide your research manually across the 6 dimensions.
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={onClose}
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create Assessment
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ResearchNodePage() {
  const [pilotOpen,  setPilotOpen]  = useState(false)
  const [showNew,    setShowNew]    = useState(false)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
              <Icons.Telescope className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none">researchNODE</h1>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Market positioning & competitive intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPilotOpen((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                pilotOpen
                  ? 'border-violet-400 bg-violet-50 text-violet-700'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-violet-300',
              )}
            >
              <Icons.Radar className="h-3.5 w-3.5" />
              researchPILOT
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 transition-colors"
            >
              <Icons.Plus className="h-3.5 w-3.5" />
              New Assessment
            </button>
          </div>
        </div>

        {/* Framework bar */}
        <div className="flex items-center gap-0 border-b border-border bg-muted/30 overflow-x-auto shrink-0">
          {DIMENSIONS.map((d, i) => (
            <div
              key={d.key}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[11px] text-muted-foreground border-r border-border shrink-0',
                i === DIMENSIONS.length - 1 && 'border-r-0',
              )}
            >
              <d.icon className="h-3 w-3 shrink-0 text-violet-400" />
              <span className="hidden lg:inline">{d.label}</span>
              <span className="font-semibold text-foreground">{d.weight}%</span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <EmptyState onNew={() => setShowNew(true)} />
        </div>
      </div>

      {/* ── researchPILOT panel ───────────────────────────────────────────────── */}
      {pilotOpen && (
        <ResearchPilot onClose={() => setPilotOpen(false)} />
      )}

      {/* ── New assessment modal ──────────────────────────────────────────────── */}
      {showNew && <NewAssessmentModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
