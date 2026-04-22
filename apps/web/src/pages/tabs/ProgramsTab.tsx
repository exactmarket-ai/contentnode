/**
 * ProgramsTab.tsx — Programs v2
 *
 * Two-phase PILOT (Think → Build), vertical support, content packs, detail panel.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vertical { id: string; name: string }

interface Program {
  id: string
  clientId: string
  verticalId?: string | null
  type: string
  name: string
  status: 'active' | 'paused' | 'archived'
  executionModel: 'recurring' | 'one_time'
  pilotPhase: string
  brief?: string | null
  cadence?: string | null
  scheduledTask?: { id: string; label: string; lastStatus: string; lastRunAt?: string | null } | null
  vertical?: { id: string; name: string } | null
  _count?: { contentPacks: number; workflowRuns: number }
  contentPacks?: ProgramContentPack[]
  createdAt: string
}

interface ProgramContentPack {
  id: string
  cycleLabel: string
  status: string
  reviewStatus: string
  dueDate?: string | null
  notes?: string | null
  createdAt: string
  _count?: { items: number }
  items?: ProgramContentItem[]
}

interface ProgramContentItem {
  id: string
  packId: string
  itemType: string
  label: string
  content: string
  editedContent?: string | null
  sortOrder: number
  isTemplate: boolean
  createdAt: string
}

interface PilotMessage {
  role: 'user' | 'assistant'
  content: string
  paths?: string[]
}

interface PilotApiResponse {
  message: string
  paths?: string[]
  program?: Program
  phaseComplete?: boolean
}

// ─── Program type config ──────────────────────────────────────────────────────

interface ProgramTypeMeta {
  label: string
  color: string
  bg: string
  icon: React.ComponentType<{ className?: string }>
  executionModel: 'recurring' | 'one_time'
  templateItems: string[]
}

const PROGRAM_TYPE_META: Record<string, ProgramTypeMeta> = {
  // Content (Recurring)
  thought_leadership: { label: 'Thought Leadership', color: 'text-violet-500', bg: 'bg-violet-500/10', icon: Icons.BookOpen, executionModel: 'recurring', templateItems: ['Program Brief', 'Article Template', 'LinkedIn Post Formula', 'Image Prompt Formula'] },
  seo_content:        { label: 'SEO Content',        color: 'text-blue-500',   bg: 'bg-blue-500/10',   icon: Icons.Search,   executionModel: 'recurring', templateItems: ['Program Brief', 'SEO Blog Template', 'Target Keyword Clusters'] },
  newsletter:         { label: 'Newsletter',         color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: Icons.Mail,   executionModel: 'recurring', templateItems: ['Program Brief', 'Newsletter Issue Template'] },
  social_media:       { label: 'Social Media',       color: 'text-sky-500',    bg: 'bg-sky-500/10',    icon: Icons.Share2,   executionModel: 'recurring', templateItems: ['Program Brief', 'LinkedIn Post Formula', 'Instagram Caption Formula', 'X Post Formula'] },
  // Outbound
  outbound_email_sequence:    { label: 'Outbound Email Sequence',   color: 'text-orange-500', bg: 'bg-orange-500/10', icon: Icons.Send,       executionModel: 'one_time', templateItems: ['Program Brief', 'Email 1 — Cold Intro', 'Email 2 — Value Add', 'Email 3 — Social Proof', 'Email 4 — Different Angle', 'Email 5 — Break-up', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide'] },
  linkedin_outreach_sequence: { label: 'LinkedIn Outreach Sequence', color: 'text-blue-500',  bg: 'bg-blue-500/10',   icon: Icons.Link2,      executionModel: 'one_time', templateItems: ['Program Brief', 'Connection Request Message', 'Message 1 — Post-Connect Intro', 'Message 2 — Value / Resource', 'Message 3 — Soft Ask', 'Message 4 — Break-up'] },
  cold_calling_program:       { label: 'Cold Calling Program',        color: 'text-green-500', bg: 'bg-green-500/10',  icon: Icons.Phone,      executionModel: 'one_time', templateItems: ['Program Brief', 'Opener Script', '3-Minute Pitch Script', 'Discovery Question Bank', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide', 'Call Wrap-up Script'] },
  // Nurture / inbound
  email_nurture_sequence: { label: 'Email Nurture Sequence', color: 'text-teal-500',   bg: 'bg-teal-500/10',   icon: Icons.Mail,     executionModel: 'one_time', templateItems: ['Program Brief', 'Delivery Email', 'Nurture Email 1 — Welcome', 'Nurture Emails 2–5', 'Re-engagement Email', 'Conversion Email'] },
  lead_magnet_program:    { label: 'Lead Magnet Program',    color: 'text-purple-500', bg: 'bg-purple-500/10', icon: Icons.Download, executionModel: 'one_time', templateItems: ['Program Brief', 'Lead Magnet Document', 'Landing Page Copy', 'Thank-you Page Copy', 'Delivery Email'] },
  webinar_event_program:  { label: 'Webinar / Event Program', color: 'text-red-500',   bg: 'bg-red-500/10',    icon: Icons.Monitor,  executionModel: 'one_time', templateItems: ['Program Brief', 'Invite Email 1', 'Invite Email 2 — Reminder', 'Invite Email 3 — Day-of', 'Post-Event Email 1 — Replay', 'Post-Event Email 2 — Follow-up', 'Social Promotion Posts', 'Event Page Copy'] },
  // ABM
  abm_program: { label: 'ABM Program', color: 'text-indigo-500', bg: 'bg-indigo-500/10', icon: Icons.Crosshair, executionModel: 'one_time', templateItems: ['Program Brief', 'ICP & Account Profile Template', 'Personalised Outreach Email', 'LinkedIn Message Template', 'Account One-Pager Structure', 'Account Research Guide'] },
  // Retention
  customer_onboarding_program: { label: 'Customer Onboarding', color: 'text-emerald-600', bg: 'bg-emerald-600/10', icon: Icons.UserCheck, executionModel: 'one_time', templateItems: ['Program Brief', 'Welcome Email', 'Day 3 Check-in Email', 'Day 7 Milestone Email', 'Day 30 Success Review Email', 'Onboarding Checklist', 'FAQ Document'] },
  reengagement_program:        { label: 'Re-engagement Program', color: 'text-amber-500', bg: 'bg-amber-500/10',   icon: Icons.RefreshCw, executionModel: 'one_time', templateItems: ['Program Brief', 'Win-back Email 1', 'Win-back Email 2', 'Win-back Email 3 — Offer', 'Sunset Email'] },
  // Partner / Launch
  partner_enablement_program: { label: 'Partner Enablement', color: 'text-violet-600', bg: 'bg-violet-600/10', icon: Icons.GitBranch, executionModel: 'one_time', templateItems: ['Program Brief', 'Partner Welcome Email', 'Co-Marketing Email Template', 'Co-Sell Introduction Email', 'Partner Newsletter Template', 'Joint Press Release Template'] },
  product_launch_program:     { label: 'Product Launch',     color: 'text-rose-500',   bg: 'bg-rose-500/10',   icon: Icons.Rocket,    executionModel: 'one_time', templateItems: ['Program Brief', 'Pre-launch Teaser Email', 'Launch Day Announcement Email', 'Launch Blog Post', 'Press Release', 'Social Announcement Posts', 'Sales One-Pager Structure', 'Internal FAQ'] },
  // Legacy
  competitive_intel: { label: 'Competitive Intel', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Icons.Target,   executionModel: 'recurring', templateItems: ['Program Brief', 'Intelligence Brief Template'] },
  customer_story:    { label: 'Customer Story',    color: 'text-pink-400',  bg: 'bg-pink-500/10',  icon: Icons.Users,    executionModel: 'recurring', templateItems: ['Program Brief', 'Case Study Template'] },
  event_content:     { label: 'Event Content',     color: 'text-orange-400', bg: 'bg-orange-500/10', icon: Icons.Calendar, executionModel: 'recurring', templateItems: ['Program Brief', 'Event Content Template'] },
}

const OPENING_GREETING =
  "Hey! I'm programsPILOT. I help you build complete marketing programs — strategy first, then every template and deliverable you need.\n\nWhat marketing challenge are you trying to solve for this client right now?"

const OPENING_PATHS = [
  'Build awareness & thought leadership',
  'Generate outbound pipeline',
  'Nurture inbound leads',
  'Launch a product or campaign',
  'Help me choose the right program',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return <>{parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <b key={i} className="font-semibold">{p.slice(2, -2)}</b>
      : <span key={i}>{p}</span>
  )}</>
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <div key={i} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-3 mb-0.5">{line.slice(4)}</div>
        if (line.startsWith('## '))  return <h3 key={i} className="text-[12px] font-bold text-foreground mt-2 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# '))   return <h2 key={i} className="text-[13px] font-bold text-foreground mt-3 mb-1">{line.slice(2)}</h2>
        if (/^---+$/.test(line.trim())) return <hr key={i} className="border-border my-2" />
        if (line.startsWith('- ') || line.startsWith('• '))
          return <div key={i} className="flex gap-1.5 text-[12px] leading-relaxed"><span className="shrink-0 text-muted-foreground mt-0.5">•</span><span>{renderInline(line.slice(2))}</span></div>
        if (line.trim() === '') return <div key={i} className="h-2" />
        return <p key={i} className="text-[12px] leading-relaxed mb-0">{renderInline(line)}</p>
      })}
    </>
  )
}

// ─── Badges ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Program['status'] }) {
  const map = {
    active:   { dot: 'bg-emerald-400', label: 'Active',   text: 'text-emerald-500' },
    paused:   { dot: 'bg-amber-400',   label: 'Paused',   text: 'text-amber-500' },
    archived: { dot: 'bg-zinc-400',    label: 'Archived', text: 'text-zinc-400' },
  }
  const s = map[status]
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const cfg = PROGRAM_TYPE_META[type]
  if (!cfg) return <span className="text-[10px] text-muted-foreground">{type}</span>
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.bg, cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function PhaseBadge({ pilotPhase }: { pilotPhase: string }) {
  if (pilotPhase === 'complete') return null
  const map: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{className?: string}> }> = {
    setup:  { label: 'Setup needed',       color: 'text-zinc-500',   bg: 'bg-zinc-500/10',   icon: Icons.AlertCircle },
    think:  { label: 'Strategy in progress', color: 'text-amber-600', bg: 'bg-amber-500/10',  icon: Icons.Brain },
    build:  { label: 'Building templates', color: 'text-blue-600',   bg: 'bg-blue-500/10',   icon: Icons.Hammer },
  }
  const p = map[pilotPhase] ?? map.setup
  const Icon = p.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', p.bg, p.color)}>
      <Icon className="h-2.5 w-2.5" />
      {p.label}
    </span>
  )
}

function ExecModelBadge({ executionModel }: { executionModel: string }) {
  return executionModel === 'one_time'
    ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500"><Icons.Square className="h-2.5 w-2.5" />One-time</span>
    : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500"><Icons.Repeat className="h-2.5 w-2.5" />Recurring</span>
}

// ─── TemplateCard (Phase 2 document-style rendering) ─────────────────────────

function TemplateCard({ content }: { content: string }) {
  const titleMatch = content.match(/^(?:Let'?s write|Writing)\s+(.+?)[.!]\s*/i)
  const title = titleMatch?.[1]
  const body = titleMatch ? content.slice(titleMatch[0].length).trim() : content
  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      {title && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-zinc-50 px-4 py-2">
          <Icons.FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-semibold text-foreground">{title}</span>
        </div>
      )}
      <div className="px-4 py-3 max-h-[350px] overflow-y-auto">
        {renderMarkdown(body)}
      </div>
    </div>
  )
}

// ─── ProgramCard ─────────────────────────────────────────────────────────────

function ProgramCard({
  program,
  isSelected,
  onSelect,
  onContinueSetup,
  onPauseResume,
  onDelete,
}: {
  program: Program
  isSelected: boolean
  onSelect: (p: Program) => void
  onContinueSetup: (p: Program) => void
  onPauseResume: (p: Program) => void
  onDelete: (p: Program) => void
}) {
  const isComplete = program.pilotPhase === 'complete'
  const packCount = program._count?.contentPacks ?? 0

  return (
    <div
      className={cn(
        'rounded-xl border transition-all cursor-pointer',
        isSelected ? 'border-purple-400 bg-purple-50/30' : 'border-border bg-transparent hover:border-foreground/20',
      )}
      onClick={() => onSelect(program)}
    >
      <div className="p-4">
        {/* Badges row */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={program.type} />
          <ExecModelBadge executionModel={program.executionModel} />
          {!isComplete && <PhaseBadge pilotPhase={program.pilotPhase} />}
          {isComplete && <StatusBadge status={program.status} />}
        </div>

        {/* Name */}
        <p className="text-sm font-bold text-foreground leading-snug mb-2">{program.name}</p>

        {/* Meta */}
        <div className="space-y-1">
          {program.vertical && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Layers className="h-3 w-3 shrink-0" />
              <span>{program.vertical.name}</span>
            </div>
          )}
          {program.cadence && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Repeat className="h-3 w-3 shrink-0" />
              <span>{program.cadence}</span>
            </div>
          )}
          {isComplete && packCount > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Package className="h-3 w-3 shrink-0" />
              <span>{packCount} content pack{packCount !== 1 ? 's' : ''}</span>
            </div>
          )}
          {isComplete && program.scheduledTask && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{program.scheduledTask.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-2 border-t border-border px-4 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        {!isComplete ? (
          <button
            onClick={() => onContinueSetup(program)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition-colors"
            style={{ backgroundColor: '#a200ee' }}
          >
            <Icons.Zap className="h-3 w-3" />
            {program.pilotPhase === 'build' ? 'Continue Building' : 'Start Setup'}
          </button>
        ) : (
          <>
            <button
              onClick={() => onPauseResume(program)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {program.status === 'active'
                ? <><Icons.PauseCircle className="h-3 w-3" />Pause</>
                : <><Icons.PlayCircle className="h-3 w-3" />Resume</>}
            </button>
            <button
              onClick={() => onSelect(program)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <Icons.Eye className="h-3 w-3" />
              View
            </button>
          </>
        )}
        <button
          onClick={() => onDelete(program)}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-red-400"
        >
          <Icons.Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ─── ProgramDetailPanel ───────────────────────────────────────────────────────

function ProgramDetailPanel({
  programId,
  onClose,
  onContinueSetup,
}: {
  programId: string
  onClose: () => void
  onContinueSetup: (p: Program) => void
}) {
  const [program, setProgram] = useState<Program | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'brief' | 'templates' | 'packs'>('brief')
  const [packs, setPacks] = useState<ProgramContentPack[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [selectedPack, setSelectedPack] = useState<ProgramContentPack | null>(null)
  const [packLoading, setPackLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/v1/programs/${programId}`)
      .then((r) => r.json())
      .then((body) => { if (!cancelled) setProgram(body.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [programId])

  const fetchPacks = useCallback(async () => {
    setPacksLoading(true)
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/packs`)
      if (r.ok) { const b = await r.json(); setPacks(b.data ?? []) }
    } finally { setPacksLoading(false) }
  }, [programId])

  useEffect(() => {
    if (activeTab === 'packs' || activeTab === 'templates') fetchPacks()
  }, [activeTab, fetchPacks])

  const openPack = async (pack: ProgramContentPack) => {
    setPackLoading(true)
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/packs/${pack.id}`)
      if (r.ok) { const b = await r.json(); setSelectedPack(b.data) }
    } finally { setPackLoading(false) }
  }

  const isComplete = program?.pilotPhase === 'complete'
  const meta = program ? PROGRAM_TYPE_META[program.type] : null

  const tabs = [
    { id: 'brief',     label: 'Brief' },
    { id: 'templates', label: 'Templates' },
    ...(program?.executionModel === 'recurring' ? [{ id: 'packs', label: 'Content Packs' }] : []),
  ] as { id: 'brief' | 'templates' | 'packs'; label: string }[]

  return (
    <div className="flex h-full flex-col border-l border-border bg-white">
      {/* Panel header */}
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex-1 min-w-0">
          {program ? (
            <>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={program.type} />
                {!isComplete && <PhaseBadge pilotPhase={program.pilotPhase} />}
                {isComplete && <StatusBadge status={program.status} />}
              </div>
              <p className="text-sm font-bold text-foreground leading-snug">{program.name}</p>
              {program.cadence && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{program.cadence}</p>
              )}
            </>
          ) : (
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {program && !isComplete && (
            <button
              onClick={() => onContinueSetup(program)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: '#a200ee' }}
            >
              <Icons.Zap className="h-3 w-3" />
              {program.pilotPhase === 'build' ? 'Continue' : 'Setup'}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-1 py-3 mr-5 text-[12px] font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-current text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            style={activeTab === tab.id ? { borderColor: '#a200ee', color: '#a200ee' } : {}}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* BRIEF TAB */}
            {activeTab === 'brief' && (
              <div className="px-5 py-5">
                {program?.brief ? (
                  <div className="text-foreground">{renderMarkdown(program.brief)}</div>
                ) : (
                  <div className="py-10 text-center">
                    <div className="mb-3 flex justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100">
                        <Icons.FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                    <p className="text-sm font-medium text-foreground">No brief yet</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Complete Phase 1 to generate the program strategy brief.
                    </p>
                    {program && (
                      <button
                        onClick={() => onContinueSetup(program)}
                        className="mt-4 flex items-center gap-1.5 mx-auto rounded-lg px-4 py-2 text-[12px] font-semibold text-white"
                        style={{ backgroundColor: '#a200ee' }}
                      >
                        <Icons.Zap className="h-3.5 w-3.5" />
                        Start programsPILOT
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TEMPLATES TAB */}
            {activeTab === 'templates' && (
              <div className="px-5 py-5">
                {/* Template items from packs */}
                {packsLoading ? (
                  <div className="flex justify-center py-8"><div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" /></div>
                ) : (
                  <>
                    {/* Template checklist from type meta */}
                    {meta && (
                      <div className="space-y-2">
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Template Deliverables
                        </p>
                        {meta.templateItems.map((item, i) => {
                          const allItems = packs.flatMap((p) => p.items ?? [])
                          const exists = allItems.some((ci) => ci.label === item && ci.isTemplate)
                          return (
                            <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                              {exists
                                ? <Icons.CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                : <Icons.Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                              <span className={cn('text-[12px]', exists ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                                {item}
                              </span>
                            </div>
                          )
                        })}
                        {!isComplete && (
                          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                            <p className="text-[12px] text-amber-700 font-medium">Templates are built during Phase 2 of programsPILOT.</p>
                            {program && (
                              <button
                                onClick={() => onContinueSetup(program)}
                                className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors"
                              >
                                <Icons.Zap className="h-3 w-3" />
                                {program.pilotPhase === 'build' ? 'Continue Building Templates' : 'Start Phase 2'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* CONTENT PACKS TAB */}
            {activeTab === 'packs' && (
              <div className="px-5 py-5">
                {selectedPack ? (
                  /* Pack detail view */
                  <div>
                    <button
                      onClick={() => setSelectedPack(null)}
                      className="mb-4 flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Icons.ChevronLeft className="h-3.5 w-3.5" />
                      All Packs
                    </button>
                    <div className="mb-4">
                      <p className="text-sm font-bold text-foreground">{selectedPack.cycleLabel}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="capitalize">{selectedPack.status}</span>
                        <span>·</span>
                        <span>{relativeTime(selectedPack.createdAt)}</span>
                      </div>
                    </div>
                    {selectedPack.items && selectedPack.items.length > 0 ? (
                      <div className="space-y-3">
                        {selectedPack.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-border overflow-hidden">
                            <div className="flex items-center gap-2 border-b border-border/60 bg-zinc-50 px-4 py-2">
                              <Icons.FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-[11px] font-semibold text-foreground">{item.label}</span>
                            </div>
                            <div className="px-4 py-3 max-h-[300px] overflow-y-auto">
                              {renderMarkdown(item.editedContent ?? item.content)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">No items in this pack.</p>
                    )}
                  </div>
                ) : (
                  /* Pack list */
                  <>
                    {packsLoading ? (
                      <div className="flex justify-center py-8"><div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" /></div>
                    ) : packs.length === 0 ? (
                      <div className="py-10 text-center">
                        <div className="mb-3 flex justify-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100">
                            <Icons.Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-foreground">No content packs yet</p>
                        <p className="mt-1 text-[12px] text-muted-foreground max-w-[240px] mx-auto">
                          Content packs are generated each cycle when the program runs.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {packs.map((pack) => (
                          <button
                            key={pack.id}
                            onClick={() => { setPackLoading(true); void openPack(pack) }}
                            className="w-full rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-zinc-50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-foreground">{pack.cycleLabel}</span>
                              <span className={cn(
                                'text-[10px] font-medium rounded-full px-2 py-0.5 capitalize',
                                pack.status === 'published' ? 'bg-emerald-100 text-emerald-700' :
                                pack.status === 'review' ? 'bg-amber-100 text-amber-700' :
                                'bg-zinc-100 text-zinc-500'
                              )}>{pack.status}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span>{pack._count?.items ?? 0} items</span>
                              <span>·</span>
                              <span>{relativeTime(pack.createdAt)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {packLoading && (
                      <div className="mt-4 flex justify-center">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── PilotModal ───────────────────────────────────────────────────────────────

function PilotModal({
  clientId,
  editingProgram,
  verticals,
  onClose,
  onProgramSaved,
}: {
  clientId: string
  editingProgram: Program | null
  verticals: Vertical[]
  onClose: () => void
  onProgramSaved: (program: Program) => void
}) {
  const resumingBuild = editingProgram?.pilotPhase === 'build'

  const [selectedVerticalId, setSelectedVerticalId] = useState<string | null>(
    editingProgram?.verticalId ?? null,
  )
  const [localPilotPhase, setLocalPilotPhase] = useState<'think' | 'build'>(
    resumingBuild ? 'build' : 'think',
  )
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(
    editingProgram?.id ?? null,
  )
  const [isComplete, setIsComplete] = useState(false)
  const [completedProgram, setCompletedProgram] = useState<Program | null>(null)
  const [messages, setMessages] = useState<PilotMessage[]>(() => {
    if (resumingBuild) {
      return [{
        role: 'assistant',
        content: `Welcome back! The strategy for **${editingProgram!.name}** is locked.\n\nNow let's build out every template you need. Just say "go" and I'll start with the first deliverable — or tell me anything you'd like to adjust first.`,
        paths: ['Go — start the first template', 'Show me what templates are planned', 'I want to adjust the strategy first'],
      }]
    }
    return [{ role: 'assistant', content: OPENING_GREETING, paths: OPENING_PATHS }]
  })
  const [input, setInput] = useState('')
  const [pilotLoading, setPilotLoading] = useState(false)
  const lastMsgRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, pilotLoading])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || pilotLoading) return
    if (!overrideText) setInput('')

    const userMsg: PilotMessage = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setPilotLoading(true)

    try {
      const res = await apiFetch('/api/v1/programs/pilot', {
        method: 'POST',
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          verticalId:       selectedVerticalId ?? undefined,
          currentProgramId: currentProgramId ?? undefined,
          pilotPhase:       localPilotPhase,
        }),
      })
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
        return
      }
      const body: PilotApiResponse = await res.json()

      // Phase 1 → 2 transition
      if (body.program && localPilotPhase === 'think') {
        setCurrentProgramId(body.program.id)
        setLocalPilotPhase('build')
        onProgramSaved(body.program)
      }

      // Phase 2 complete
      if (body.phaseComplete) {
        setIsComplete(true)
        setCompletedProgram(body.program ?? (editingProgram as Program))
        if (body.program) onProgramSaved(body.program)
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: body.message, paths: body.paths },
      ])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — please try again.' }])
    } finally {
      setPilotLoading(false)
    }
  }, [input, pilotLoading, messages, clientId, selectedVerticalId, currentProgramId, localPilotPhase, editingProgram, onProgramSaved])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  const phaseLabel = localPilotPhase === 'build' ? 'Phase 2 — Building Templates' : 'Phase 1 — Strategy'
  const phaseColor = localPilotPhase === 'build' ? '#2563eb' : '#d97706'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden"
        style={{ height: '82vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: '#a200ee' }}>
            <Icons.Zap className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold tracking-wide" style={{ color: '#a200ee' }}>programsPILOT</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: `${phaseColor}18`, color: phaseColor }}
              >
                {phaseLabel}
              </span>
              {currentProgramId && editingProgram && (
                <>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{editingProgram.name}</span>
                </>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Build a complete marketing program</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Vertical picker — shown before first user message in think phase */}
        {localPilotPhase === 'think' && !messages.some((m) => m.role === 'user') && verticals.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-zinc-50/70 shrink-0">
            <Icons.Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground shrink-0">Vertical:</span>
            <select
              value={selectedVerticalId ?? ''}
              onChange={(e) => setSelectedVerticalId(e.target.value || null)}
              className="text-[11px] bg-transparent border-0 outline-none text-foreground cursor-pointer"
            >
              <option value="">No vertical</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Success state */}
        {isComplete ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <Icons.CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-foreground">Program complete!</p>
              {completedProgram && (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">{completedProgram.name}</p>
                  <div className="mt-2 flex justify-center">
                    <TypeBadge type={completedProgram.type} />
                  </div>
                </>
              )}
              <p className="mt-3 text-[12px] text-muted-foreground max-w-[280px] mx-auto">
                All templates are built. View the program to review and edit each deliverable.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl px-5 py-2 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: '#a200ee' }}
            >
              View Program
            </button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0">
              {messages.map((msg, i) => {
                const isUser = msg.role === 'user'
                const isLast = i === messages.length - 1 && !pilotLoading
                const isTemplateMsg = localPilotPhase === 'build' && !isUser && msg.content.length > 250

                return (
                  <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
                    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
                      {!isUser && (
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5"
                          style={{ backgroundColor: '#a200ee' }}
                        >
                          <Icons.Zap className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div className={cn('flex flex-col gap-2', isTemplateMsg ? 'w-full' : 'max-w-[88%]')}>
                        {isTemplateMsg ? (
                          <TemplateCard content={msg.content} />
                        ) : (
                          <div
                            className={cn(
                              'rounded-xl px-3 py-2 text-[12px] leading-relaxed',
                              isUser
                                ? 'text-white rounded-tr-sm'
                                : 'bg-zinc-100 text-foreground rounded-tl-sm',
                            )}
                            style={isUser ? { backgroundColor: '#a200ee' } : {}}
                          >
                            {renderMarkdown(msg.content)}
                          </div>
                        )}
                        {isLast && Array.isArray(msg.paths) && msg.paths.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-0.5 ml-0">
                            {msg.paths.map((path, pi) => (
                              <button
                                key={pi}
                                onClick={() => void sendMessage(path)}
                                className="rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-foreground hover:border-purple-400 hover:bg-purple-50 hover:text-purple-900 transition-colors"
                              >
                                {path}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

              {pilotLoading && (
                <div className="flex gap-2 items-start">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: '#a200ee' }}
                  >
                    <Icons.Zap className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-zinc-100 px-3 py-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex items-end gap-2 border-t border-border px-3 py-2.5 shrink-0">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Reply to programsPILOT… (Shift+Enter for new line)"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-white px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 min-h-[34px] max-h-[80px] overflow-y-auto"
                style={{ lineHeight: '1.4', '--tw-ring-color': '#a200ee' } as React.CSSProperties}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || pilotLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                style={{ backgroundColor: '#a200ee' }}
              >
                <Icons.SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── ProgramsTab ──────────────────────────────────────────────────────────────

export interface ProgramsTabProps {
  clientId: string
  clientName: string
}

export function ProgramsTab({ clientId, clientName: _clientName }: ProgramsTabProps) {
  const [programs, setPrograms] = useState<Program[]>([])
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [loading, setLoading] = useState(true)
  const [showPilot, setShowPilot] = useState(false)
  const [editingProgram, setEditingProgram] = useState<Program | null>(null)
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)

  const fetchPrograms = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/programs?clientId=${clientId}`)
      if (!res.ok) return
      const body = await res.json()
      setPrograms(body.data ?? [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [clientId])

  useEffect(() => {
    fetchPrograms()
    // Fetch verticals for picker
    apiFetch('/api/v1/verticals')
      .then((r) => r.json())
      .then((b) => setVerticals(b.data ?? []))
      .catch(() => {})
  }, [fetchPrograms])

  const openNewProgram = () => { setEditingProgram(null); setShowPilot(true) }
  const openContinueSetup = (program: Program) => { setEditingProgram(program); setShowPilot(true) }
  const closePilot = () => { setShowPilot(false); setEditingProgram(null); fetchPrograms() }

  const handleProgramSaved = (program: Program) => {
    setPrograms((prev) => {
      const exists = prev.find((p) => p.id === program.id)
      return exists ? prev.map((p) => (p.id === program.id ? program : p)) : [program, ...prev]
    })
    setSelectedProgramId(program.id)
  }

  const handleSelectProgram = (program: Program) => {
    setSelectedProgramId((prev) => prev === program.id ? null : program.id)
  }

  const handlePauseResume = async (program: Program) => {
    const newStatus: Program['status'] = program.status === 'active' ? 'paused' : 'active'
    setPrograms((prev) => prev.map((p) => (p.id === program.id ? { ...p, status: newStatus } : p)))
    try {
      const res = await apiFetch(`/api/v1/programs/${program.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) setPrograms((prev) => prev.map((p) => (p.id === program.id ? { ...p, status: program.status } : p)))
    } catch {
      setPrograms((prev) => prev.map((p) => (p.id === program.id ? { ...p, status: program.status } : p)))
    }
  }

  const handleDelete = async (program: Program) => {
    if (!confirm(`Delete program "${program.name}"? This cannot be undone.`)) return
    setPrograms((prev) => prev.filter((p) => p.id !== program.id))
    if (selectedProgramId === program.id) setSelectedProgramId(null)
    try {
      await apiFetch(`/api/v1/programs/${program.id}`, { method: 'DELETE' })
    } catch { fetchPrograms() }
  }

  const panelOpen = !!selectedProgramId

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div>
          <h2 className="text-base font-bold text-foreground">Content Programs</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Strategy-backed marketing programs with deliverables and content packs.
          </p>
        </div>
        {programs.length > 0 && (
          <Button onClick={openNewProgram} size="sm">
            <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
            New Program
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Program list */}
        <div
          className={cn(
            'overflow-y-auto transition-all duration-200',
            panelOpen ? 'w-[320px] shrink-0 border-r border-border px-4 py-4' : 'flex-1 px-6 py-5',
          )}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
            </div>
          ) : programs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-violet-500/10">
                <Icons.Sparkles className="h-8 w-8 text-violet-400" />
              </div>
              <p className="text-base font-bold text-foreground">No programs yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-muted-foreground leading-relaxed">
                Programs are complete marketing systems — strategy, templates, and content packs all in one place.
              </p>
              <Button onClick={openNewProgram} className="mt-6">
                <Icons.Sparkles className="mr-1.5 h-4 w-4" />
                Build your first program
              </Button>
            </div>
          ) : (
            <div className={cn('grid gap-3', panelOpen ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3')}>
              {programs.map((program) => (
                <ProgramCard
                  key={program.id}
                  program={program}
                  isSelected={selectedProgramId === program.id}
                  onSelect={handleSelectProgram}
                  onContinueSetup={openContinueSetup}
                  onPauseResume={handlePauseResume}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {panelOpen && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <ProgramDetailPanel
              key={selectedProgramId}
              programId={selectedProgramId}
              onClose={() => setSelectedProgramId(null)}
              onContinueSetup={openContinueSetup}
            />
          </div>
        )}
      </div>

      {/* programsPILOT modal */}
      {showPilot && (
        <PilotModal
          clientId={clientId}
          editingProgram={editingProgram}
          verticals={verticals}
          onClose={closePilot}
          onProgramSaved={handleProgramSaved}
        />
      )}
    </div>
  )
}
