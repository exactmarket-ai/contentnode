/**
 * ProgramsTab.tsx — Programs v2
 *
 * Matches productPILOT layout: DimensionBar top, left nav categories, right skill/type grid.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import { DimensionBar, type DimensionItem } from '@/components/layout/DimensionBar'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'
import { checkFilenames, type FilenameIssue } from '@/lib/filename'
import { FilenameWarning } from '@/components/ui/FilenameWarning'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vertical extends DimensionItem { id: string; name: string; dimensionType: string }

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
  cadenceCronExpr?: string | null
  autoPublish?: boolean
  nextRunAt?: string | null
  lastRunAt?: string | null
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

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  storageKey: string
  summaryStatus: 'pending' | 'processing' | 'ready' | 'failed'
  summary: string | null
}

// ─── Program type config ──────────────────────────────────────────────────────

interface ProgramTypeMeta {
  label: string
  description: string
  color: string
  bg: string
  icon: React.ComponentType<{ className?: string }>
  executionModel: 'recurring' | 'one_time'
  templateItems: string[]
}

const PROGRAM_TYPE_META: Record<string, ProgramTypeMeta> = {
  thought_leadership: {
    label: 'Thought Leadership', description: 'Build authority with original insights, articles, and LinkedIn posts.',
    color: 'text-violet-500', bg: 'bg-violet-500/10', icon: Icons.BookOpen, executionModel: 'recurring',
    templateItems: ['Program Brief', 'Article Template', 'LinkedIn Post Formula', 'Image Prompt Formula'],
  },
  seo_content: {
    label: 'SEO Content', description: 'Rank for target keywords with optimised blog content.',
    color: 'text-blue-500', bg: 'bg-blue-500/10', icon: Icons.Search, executionModel: 'recurring',
    templateItems: ['Program Brief', 'SEO Blog Template', 'Target Keyword Clusters'],
  },
  newsletter: {
    label: 'Newsletter', description: 'Nurture your audience with regular email issues.',
    color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: Icons.Mail, executionModel: 'recurring',
    templateItems: ['Program Brief', 'Newsletter Issue Template'],
  },
  social_media: {
    label: 'Social Media', description: 'Stay top-of-mind across LinkedIn, Instagram, and X.',
    color: 'text-sky-500', bg: 'bg-sky-500/10', icon: Icons.Share2, executionModel: 'recurring',
    templateItems: ['Program Brief', 'LinkedIn Post Formula', 'Instagram Caption Formula', 'X Post Formula'],
  },
  outbound_email_sequence: {
    label: 'Outbound Email Sequence', description: '5-touch cold email sequence with voicemail and objection handling.',
    color: 'text-orange-500', bg: 'bg-orange-500/10', icon: Icons.Send, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Email 1 — Cold Intro', 'Email 2 — Value Add', 'Email 3 — Social Proof', 'Email 4 — Different Angle', 'Email 5 — Break-up', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide'],
  },
  linkedin_outreach_sequence: {
    label: 'LinkedIn Outreach', description: '4-message LinkedIn sequence from connection to soft ask.',
    color: 'text-blue-500', bg: 'bg-blue-500/10', icon: Icons.Link2, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Connection Request Message', 'Message 1 — Post-Connect Intro', 'Message 2 — Value / Resource', 'Message 3 — Soft Ask', 'Message 4 — Break-up'],
  },
  cold_calling_program: {
    label: 'Cold Calling Program', description: 'Full calling kit with opener, discovery questions, and objections.',
    color: 'text-green-500', bg: 'bg-green-500/10', icon: Icons.Phone, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Opener Script', '3-Minute Pitch Script', 'Discovery Question Bank', 'Voicemail Script A', 'Voicemail Script B', 'Objection Handling Guide', 'Call Wrap-up Script'],
  },
  email_nurture_sequence: {
    label: 'Email Nurture Sequence', description: 'Welcome, nurture, and convert with a structured email journey.',
    color: 'text-teal-500', bg: 'bg-teal-500/10', icon: Icons.Mail, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Delivery Email', 'Nurture Email 1 — Welcome', 'Nurture Emails 2–5', 'Re-engagement Email', 'Conversion Email'],
  },
  lead_magnet_program: {
    label: 'Lead Magnet Program', description: 'Lead magnet doc, landing page, thank-you page, and delivery email.',
    color: 'text-purple-500', bg: 'bg-purple-500/10', icon: Icons.Download, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Lead Magnet Document', 'Landing Page Copy', 'Thank-you Page Copy', 'Delivery Email'],
  },
  webinar_event_program: {
    label: 'Webinar / Event Program', description: 'End-to-end invite and follow-up sequence for events.',
    color: 'text-red-500', bg: 'bg-red-500/10', icon: Icons.Monitor, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Invite Email 1', 'Invite Email 2 — Reminder', 'Invite Email 3 — Day-of', 'Post-Event Email 1 — Replay', 'Post-Event Email 2 — Follow-up', 'Social Promotion Posts', 'Event Page Copy'],
  },
  abm_program: {
    label: 'ABM Program', description: 'Account-based outreach with personalised messaging and one-pagers.',
    color: 'text-indigo-500', bg: 'bg-indigo-500/10', icon: Icons.Crosshair, executionModel: 'one_time',
    templateItems: ['Program Brief', 'ICP & Account Profile Template', 'Personalised Outreach Email', 'LinkedIn Message Template', 'Account One-Pager Structure', 'Account Research Guide'],
  },
  customer_onboarding_program: {
    label: 'Customer Onboarding', description: 'Welcome, milestone, and success emails with onboarding checklist.',
    color: 'text-emerald-600', bg: 'bg-emerald-600/10', icon: Icons.UserCheck, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Welcome Email', 'Day 3 Check-in Email', 'Day 7 Milestone Email', 'Day 30 Success Review Email', 'Onboarding Checklist', 'FAQ Document'],
  },
  reengagement_program: {
    label: 'Re-engagement Program', description: 'Win back lapsed customers with a 3-touch sequence.',
    color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Icons.RefreshCw, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Win-back Email 1', 'Win-back Email 2', 'Win-back Email 3 — Offer', 'Sunset Email'],
  },
  partner_enablement_program: {
    label: 'Partner Enablement', description: 'Welcome, co-marketing, and joint press release templates.',
    color: 'text-violet-600', bg: 'bg-violet-600/10', icon: Icons.GitBranch, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Partner Welcome Email', 'Co-Marketing Email Template', 'Co-Sell Introduction Email', 'Partner Newsletter Template', 'Joint Press Release Template'],
  },
  product_launch_program: {
    label: 'Product Launch', description: 'Pre-launch teaser through launch day and post-launch follow-up.',
    color: 'text-rose-500', bg: 'bg-rose-500/10', icon: Icons.Rocket, executionModel: 'one_time',
    templateItems: ['Program Brief', 'Pre-launch Teaser Email', 'Launch Day Announcement Email', 'Launch Blog Post', 'Press Release', 'Social Announcement Posts', 'Sales One-Pager Structure', 'Internal FAQ'],
  },
}

// ─── Program categories ───────────────────────────────────────────────────────

interface ProgramCategory {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  types: string[]
}

const PROGRAM_CATEGORIES: ProgramCategory[] = [
  { key: 'content-recurring',  label: 'Content & Recurring',   icon: Icons.BookOpen,  types: ['thought_leadership', 'seo_content', 'newsletter', 'social_media'] },
  { key: 'outbound',           label: 'Outbound / Demand Gen', icon: Icons.Send,      types: ['outbound_email_sequence', 'linkedin_outreach_sequence', 'cold_calling_program'] },
  { key: 'nurture-inbound',    label: 'Nurture & Inbound',     icon: Icons.Users,     types: ['email_nurture_sequence', 'lead_magnet_program', 'webinar_event_program'] },
  { key: 'abm',                label: 'ABM',                   icon: Icons.Crosshair, types: ['abm_program'] },
  { key: 'retention',          label: 'Retention',             icon: Icons.Heart,     types: ['customer_onboarding_program', 'reengagement_program'] },
  { key: 'partner-launch',     label: 'Partner & Launch',      icon: Icons.Rocket,    types: ['partner_enablement_program', 'product_launch_program'] },
]

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

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📝'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  return '📎'
}

function renderSummaryMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+?)\s+—\s+(High|Medium|Low) importance$/i)
    if (sectionMatch) {
      nodes.push(
        <div key={key++} className="mt-3 mb-1 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">{sectionMatch[1]}</span>
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
            sectionMatch[2].toLowerCase() === 'high'   && 'bg-blue-100 text-blue-700',
            sectionMatch[2].toLowerCase() === 'medium' && 'bg-amber-100 text-amber-700',
            sectionMatch[2].toLowerCase() === 'low'    && 'bg-zinc-100 text-muted-foreground',
          )}>{sectionMatch[2]}</span>
        </div>
      )
    } else if (line.startsWith('- ')) {
      nodes.push(
        <div key={key++} className="flex gap-1.5 text-[11px] text-foreground/80 leading-relaxed">
          <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
          <span>{line.slice(2)}</span>
        </div>
      )
    } else if (line.trim()) {
      nodes.push(<p key={key++} className="text-[11px] text-muted-foreground">{line}</p>)
    }
  }
  return <div>{nodes}</div>
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
    setup: { label: 'Setup needed',         color: 'text-zinc-500',   bg: 'bg-zinc-500/10',   icon: Icons.AlertCircle },
    think: { label: 'Strategy in progress', color: 'text-amber-600',  bg: 'bg-amber-500/10',  icon: Icons.Brain },
    build: { label: 'Building templates',   color: 'text-blue-600',   bg: 'bg-blue-500/10',   icon: Icons.Hammer },
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

// ─── TemplateCard ─────────────────────────────────────────────────────────────

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
  const meta = PROGRAM_TYPE_META[program.type]

  return (
    <div
      onClick={() => isComplete && onSelect(program)}
      className={cn(
        'rounded-xl border bg-transparent overflow-hidden transition-all',
        isComplete ? 'cursor-pointer' : '',
        isSelected ? 'border-purple-400 shadow-md' : 'border-border hover:border-foreground/20',
      )}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={program.type} />
          {!isComplete && <PhaseBadge pilotPhase={program.pilotPhase} />}
          {isComplete && <StatusBadge status={program.status} />}
          <ExecModelBadge executionModel={program.executionModel} />
        </div>
        <p className="text-[13px] font-bold text-foreground leading-snug">{program.name}</p>
        {program.cadence && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{program.cadence}</p>
        )}
        {program.vertical && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icons.Layers className="h-3 w-3 shrink-0" />
            <span className="truncate">{program.vertical.name}</span>
          </div>
        )}
        {isComplete && program.scheduledTask && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
            <Icons.Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{program.scheduledTask.label}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
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

// ─── DeliverableRow ───────────────────────────────────────────────────────────

function DeliverableRow({
  programId,
  packId,
  item,
  label,
  onUpdate,
}: {
  programId: string
  packId: string | null
  item: (ProgramContentItem & { packId: string }) | undefined
  label: string
  onUpdate: (itemId: string, editedContent: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editValue, setEditValue] = useState(item?.editedContent ?? item?.content ?? '')
  const [saving, setSaving]     = useState(false)
  const [copied, setCopied]     = useState(false)

  const content = item?.editedContent ?? item?.content ?? ''

  const handleSave = async () => {
    if (!item || !packId) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/programs/${programId}/packs/${packId}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ editedContent: editValue }),
      })
      if (res.ok) {
        onUpdate(item.id, editValue)
        setEditing(false)
      }
    } finally { setSaving(false) }
  }

  if (!item) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/50 border-dashed px-4 py-3 opacity-50">
        <Icons.Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Not built yet</span>
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl border overflow-hidden transition-colors', expanded ? 'border-purple-300' : 'border-border')}>
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors"
        onClick={() => { setExpanded((v) => !v); if (!expanded) setEditing(false) }}
      >
        <Icons.CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <span className="text-[12px] font-medium text-foreground flex-1">{label}</span>
        {item.editedContent && (
          <span className="text-[10px] text-blue-500 font-medium shrink-0">edited</span>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {editing ? (
            <div className="p-4 space-y-3">
              <textarea
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400 leading-relaxed"
                rows={12}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#a200ee' }}
                >
                  {saving ? <><span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Saving…</> : <><Icons.Check className="h-3 w-3" /> Save</>}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditValue(item.editedContent ?? item.content) }}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => { setEditValue(content); setEditing(true) }}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Icons.Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {copied ? <><Icons.Check className="h-3 w-3 text-emerald-500" /> Copied</> : <><Icons.Copy className="h-3 w-3" /> Copy</>}
                </button>
              </div>
              <div className="rounded-lg bg-muted/10 px-4 py-3 max-h-[400px] overflow-y-auto">
                {renderMarkdown(content)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Cadence helpers ──────────────────────────────────────────────────────────

const CADENCE_OPTIONS = ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Quarterly'] as const
type CadenceOption = typeof CADENCE_OPTIONS[number]

function computeNextDates(startDate: Date, cadence: CadenceOption, count = 6): Date[] {
  const dates: Date[] = []
  const cur = new Date(startDate)
  for (let i = 0; i < count; i++) {
    dates.push(new Date(cur))
    if (cadence === 'Daily')     cur.setDate(cur.getDate() + 1)
    else if (cadence === 'Weekly')    cur.setDate(cur.getDate() + 7)
    else if (cadence === 'Bi-weekly') cur.setDate(cur.getDate() + 14)
    else if (cadence === 'Monthly')   cur.setMonth(cur.getMonth() + 1)
    else if (cadence === 'Quarterly') cur.setMonth(cur.getMonth() + 3)
  }
  return dates
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [activeTab, setActiveTab] = useState<'brief' | 'deliverables' | 'schedule' | 'packs'>('brief')
  const [packs, setPacks] = useState<ProgramContentPack[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [selectedPack, setSelectedPack] = useState<ProgramContentPack | null>(null)
  const [packLoading, setPackLoading] = useState(false)

  // Schedule state
  const [scheduleStartDate, setScheduleStartDate] = useState('')
  const [scheduleCadence, setScheduleCadence] = useState<CadenceOption>('Weekly')
  const [scheduleAutoPublish, setScheduleAutoPublish] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [runNowLoading, setRunNowLoading] = useState(false)
  const [runNowResult, setRunNowResult] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/v1/programs/${programId}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) {
          const p: Program = body.data
          setProgram(p)
          if (p.cadence) setScheduleCadence(p.cadence as CadenceOption)
          if (p.nextRunAt) setScheduleStartDate(p.nextRunAt.slice(0, 10))
          setScheduleAutoPublish(p.autoPublish ?? false)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [programId])

  const fetchPacks = useCallback(async () => {
    setPacksLoading(true)
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/packs?includeItems=true`)
      if (r.ok) { const b = await r.json(); setPacks(b.data ?? []) }
    } finally { setPacksLoading(false) }
  }, [programId])

  // Load packs with items on mount so deliverables tab works immediately
  useEffect(() => { void fetchPacks() }, [fetchPacks])

  useEffect(() => {
    if (activeTab === 'packs') void fetchPacks()
  }, [activeTab, fetchPacks])

  const openPack = async (pack: ProgramContentPack) => {
    setPackLoading(true)
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/packs/${pack.id}`)
      if (r.ok) { const b = await r.json(); setSelectedPack(b.data) }
    } finally { setPackLoading(false) }
  }

  const saveSchedule = async () => {
    setScheduleSaving(true)
    try {
      const body: Record<string, unknown> = {
        cadence: scheduleCadence,
        autoPublish: scheduleAutoPublish,
        nextRunAt: scheduleStartDate ? new Date(scheduleStartDate).toISOString() : null,
      }
      const r = await apiFetch(`/api/v1/programs/${programId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        const b = await r.json()
        setProgram(b.data)
      }
    } finally { setScheduleSaving(false) }
  }

  const runNow = async () => {
    setRunNowLoading(true)
    setRunNowResult(null)
    try {
      const r = await apiFetch(`/api/v1/programs/${programId}/run`, { method: 'POST' })
      setRunNowResult(r.ok ? 'success' : 'error')
      if (r.ok) setTimeout(() => setRunNowResult(null), 4000)
    } catch { setRunNowResult('error') }
    finally { setRunNowLoading(false) }
  }

  const handleDeliverableUpdate = (itemId: string, editedContent: string) => {
    setPacks((prev) => prev.map((pack) => ({
      ...pack,
      items: pack.items?.map((item) => item.id === itemId ? { ...item, editedContent } : item),
    })))
  }

  const isComplete = program?.pilotPhase === 'complete'
  const isRecurring = program?.executionModel === 'recurring'
  const meta = program ? PROGRAM_TYPE_META[program.type] : null

  const allItems = packs.flatMap((p) => (p.items ?? []).map((i) => ({ ...i, packId: p.id })))

  const tabs = [
    { id: 'brief',        label: 'Brief' },
    { id: 'deliverables', label: 'Deliverables' },
    ...(isRecurring ? [{ id: 'schedule', label: 'Schedule' }] : []),
    ...(isRecurring ? [{ id: 'packs',    label: 'Content Packs' }] : []),
  ] as { id: 'brief' | 'deliverables' | 'schedule' | 'packs'; label: string }[]

  const upcomingDates = scheduleStartDate
    ? computeNextDates(new Date(scheduleStartDate), scheduleCadence, 6)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" style={{ height: '82vh' }}>
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4 shrink-0">
          <div className="flex-1 min-w-0">
            {program ? (
              <>
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={program.type} />
                  {!isComplete && <PhaseBadge pilotPhase={program.pilotPhase} />}
                  {isComplete && <StatusBadge status={program.status} />}
                </div>
                <p className="text-sm font-bold text-foreground leading-snug">{program.name}</p>
                {program.cadence && <p className="mt-0.5 text-[11px] text-muted-foreground">{program.cadence}</p>}
              </>
            ) : (
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {program && !isComplete && (
              <button
                onClick={() => { onClose(); onContinueSetup(program) }}
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
        <div className="flex border-b border-border px-5 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-1 py-3 mr-5 text-[12px] font-medium border-b-2 transition-colors',
                activeTab === tab.id ? 'border-current text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
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
              {/* Brief */}
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
                      <p className="mt-1 text-[12px] text-muted-foreground">Complete Phase 1 to generate the program strategy brief.</p>
                      {program && !isComplete && (
                        <button
                          onClick={() => { onClose(); onContinueSetup(program) }}
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

              {/* Deliverables */}
              {activeTab === 'deliverables' && (
                <div className="px-5 py-5">
                  {packsLoading ? (
                    <div className="flex justify-center py-8"><div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" /></div>
                  ) : meta ? (
                    <div className="space-y-2">
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {meta.templateItems.filter((label) => allItems.some((i) => i.label === label && i.isTemplate)).length} / {meta.templateItems.length} built
                      </p>
                      {meta.templateItems.map((label, i) => {
                        const item = allItems.find((ci) => ci.label === label && ci.isTemplate)
                        return (
                          <DeliverableRow
                            key={i}
                            programId={programId}
                            packId={item?.packId ?? null}
                            item={item}
                            label={label}
                            onUpdate={handleDeliverableUpdate}
                          />
                        )
                      })}
                      {!isComplete && (
                        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                          <p className="text-[12px] text-amber-700 font-medium">Templates are built during Phase 2 of programsPILOT.</p>
                          {program && (
                            <button
                              onClick={() => { onClose(); onContinueSetup(program) }}
                              className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors"
                            >
                              <Icons.Zap className="h-3 w-3" />
                              {program.pilotPhase === 'build' ? 'Continue Building Templates' : 'Start Phase 2'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground py-8 text-center">No deliverable templates configured for this program type.</p>
                  )}
                </div>
              )}

              {/* Schedule (recurring only) */}
              {activeTab === 'schedule' && (
                <div className="px-5 py-6 space-y-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Start Date</label>
                      <input
                        type="date"
                        value={scheduleStartDate}
                        onChange={(e) => setScheduleStartDate(e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Cadence</label>
                      <div className="flex flex-wrap gap-2">
                        {CADENCE_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setScheduleCadence(opt)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors',
                              scheduleCadence === opt
                                ? 'border-purple-400 bg-purple-50 text-purple-700'
                                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                      <div>
                        <p className="text-[13px] font-medium text-foreground">Auto-publish</p>
                        <p className="text-[11px] text-muted-foreground">Publish content packs automatically when ready</p>
                      </div>
                      <button
                        onClick={() => setScheduleAutoPublish((v) => !v)}
                        className={cn(
                          'relative h-5 w-9 rounded-full transition-colors',
                          scheduleAutoPublish ? 'bg-purple-500' : 'bg-zinc-200',
                        )}
                      >
                        <span className={cn(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                          scheduleAutoPublish ? 'translate-x-4' : 'translate-x-0.5',
                        )} />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={saveSchedule}
                        disabled={scheduleSaving}
                        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: '#a200ee' }}
                      >
                        {scheduleSaving
                          ? <><span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Saving…</>
                          : <><Icons.Check className="h-3.5 w-3.5" /> Save Schedule</>}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-border pt-5">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Run Now</p>
                    <p className="mb-3 text-[12px] text-muted-foreground">Trigger a manual content pack cycle immediately, outside of the schedule.</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={runNow}
                        disabled={runNowLoading}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-foreground hover:border-foreground/30 hover:bg-muted/20 disabled:opacity-50 transition-colors"
                      >
                        {runNowLoading
                          ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Running…</>
                          : <><Icons.Play className="h-3.5 w-3.5" /> Run Now</>}
                      </button>
                      {runNowResult === 'success' && (
                        <span className="flex items-center gap-1 text-[12px] text-emerald-600 font-medium">
                          <Icons.CheckCircle2 className="h-3.5 w-3.5" /> Run started
                        </span>
                      )}
                      {runNowResult === 'error' && (
                        <span className="flex items-center gap-1 text-[12px] text-red-500 font-medium">
                          <Icons.AlertCircle className="h-3.5 w-3.5" /> Failed to start
                        </span>
                      )}
                    </div>
                  </div>

                  {upcomingDates.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Upcoming Runs</p>
                      <div className="space-y-1">
                        {upcomingDates.map((d, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shrink-0" />
                            <span className="text-[12px] text-foreground">{formatDateShort(d)}</span>
                            {i === 0 && <span className="ml-auto text-[10px] text-purple-500 font-medium">Next run</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Content Packs (recurring only) */}
              {activeTab === 'packs' && (
                <div className="px-5 py-5">
                  {selectedPack ? (
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
                          <div className="flex justify-end">
                            <button
                              onClick={async () => {
                                const children: Paragraph[] = []
                                for (const item of selectedPack.items!) {
                                  children.push(new Paragraph({ text: item.label, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }))
                                  const body = (item.editedContent ?? item.content ?? '').trim()
                                  for (const line of body.split('\n')) {
                                    const clean = line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '').trim()
                                    if (!clean) { children.push(new Paragraph('')); continue }
                                    const isHeading = /^#{1,6}\s/.test(line)
                                    children.push(new Paragraph({
                                      ...(isHeading ? { heading: HeadingLevel.HEADING_2 } : {}),
                                      children: [new TextRun({ text: clean })],
                                      spacing: { after: 160 },
                                    }))
                                  }
                                }
                                const doc = new Document({ sections: [{ children }] })
                                const blob = await Packer.toBlob(doc)
                                const a = document.createElement('a')
                                a.href = URL.createObjectURL(blob)
                                a.download = `${selectedPack.cycleLabel}.docx`
                                a.click()
                              }}
                              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                            >
                              <Icons.Download className="h-3 w-3" />
                              Download all
                            </button>
                          </div>
                          {selectedPack.items.map((item) => (
                            <div key={item.id} className="rounded-xl border border-border overflow-hidden">
                              <div className="flex items-center gap-2 border-b border-border/60 bg-zinc-50 px-4 py-2">
                                <Icons.FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="flex-1 text-[11px] font-semibold text-foreground">{item.label}</span>
                                <button
                                  onClick={() => navigator.clipboard.writeText(item.editedContent ?? item.content ?? '')}
                                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                  title="Copy to clipboard"
                                >
                                  <Icons.Copy className="h-3.5 w-3.5" />
                                </button>
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
                          <p className="mt-1 text-[12px] text-muted-foreground max-w-[240px] mx-auto">Content packs are generated each cycle when the program runs.</p>
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
    </div>
  )
}

// ─── AttachmentRow ────────────────────────────────────────────────────────────

function AttachmentRow({ attachment: a, base, deletingId, onDelete, onSummaryUpdated }: {
  attachment: Attachment
  base: string
  deletingId: string | null
  onDelete: (a: Attachment) => void
  onSummaryUpdated: (id: string, summary: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(a.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [showText, setShowText] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`${base}/${a.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: editValue }),
      })
      if (res.ok) { onSummaryUpdated(a.id, editValue); setEditing(false) }
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleViewText = async () => {
    if (rawText !== null) { setShowText(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(`${base}/${a.id}/text`)
      if (res.ok) { const { data } = await res.json(); setRawText(data.text ?? '') }
    } catch { /* ignore */ } finally { setLoadingText(false); setShowText(true) }
  }

  const statusBadge = () => {
    if (a.summaryStatus === 'processing' || a.summaryStatus === 'pending') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-blue-500">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-400 border-t-transparent" />
          Processing…
        </span>
      )
    }
    if (a.summaryStatus === 'ready')  return <span className="text-[10px] text-green-600 font-medium">✓ Interpreted</span>
    if (a.summaryStatus === 'failed') return <span className="text-[10px] text-red-500">Failed to process</span>
    return null
  }

  return (
    <div className="rounded-lg border border-border bg-transparent overflow-hidden">
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[11px] text-muted-foreground shrink-0 w-3">{expanded ? '▼' : '▶'}</span>
        <span className="text-lg shrink-0">{fileIcon(a.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">{formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
            {statusBadge()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(a) }}
          disabled={deletingId === a.id}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 disabled:opacity-40"
          title="Delete"
        >
          {deletingId === a.id
            ? <span className="h-3.5 w-3.5 block animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          }
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {(a.summaryStatus === 'pending' || a.summaryStatus === 'processing') && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              Claude is reading and interpreting this file…
            </div>
          )}
          {a.summaryStatus === 'failed' && (
            <p className="py-2 text-sm text-red-500">Could not extract readable content from this file.</p>
          )}
          {a.summaryStatus === 'ready' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">programsPILOT Read</p>
                  {!editing && (
                    <div className="flex items-center gap-3">
                      <button onClick={handleViewText} disabled={loadingText} className="text-[10px] text-muted-foreground underline hover:text-foreground">
                        {loadingText ? 'Loading…' : 'View original text'}
                      </button>
                      <button onClick={() => { setEditValue(a.summary ?? ''); setEditing(true) }} className="text-[10px] text-blue-500 underline hover:text-blue-700">Edit</button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edit Claude's Interpretation</p>
                    <textarea
                      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      rows={14}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={handleSave} disabled={saving} className="rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => { setEditing(false); setEditValue(a.summary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/20 px-3 py-2">
                    {a.summary ? renderSummaryMarkdown(a.summary) : <p className="text-[11px] text-muted-foreground italic">No interpretation yet</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {showText && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" style={{ maxHeight: '80vh' }}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-foreground truncate">{a.filename} — Raw Text</p>
                  <button onClick={() => setShowText(false)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="overflow-y-auto p-4">
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-foreground">{rawText ?? 'No extracted text available.'}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── BrainSection ─────────────────────────────────────────────────────────────

function BrainSection({ clientId, verticalId, websiteStatus, onScrapeWebsite, onReadyChange }: {
  clientId: string
  verticalId: string | null
  websiteStatus: 'none' | 'pending' | 'running' | 'ready' | 'failed'
  onScrapeWebsite: (websiteUrl: string) => Promise<void>
  onReadyChange: (hasReady: boolean) => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingCount, setUploadingCount] = useState(0)
  const uploading = uploadingCount > 0
  const [dragging, setDragging] = useState(false)
  const [filenameIssues, setFilenameIssues] = useState<FilenameIssue[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')

  const base = verticalId
    ? `/api/v1/clients/${clientId}/framework/${verticalId}/attachments`
    : `/api/v1/clients/${clientId}/brand-profile/attachments`

  const fetchAttachments = useCallback(() => {
    return apiFetch(base).then((r) => r.json()).then(({ data }) => setAttachments(data ?? [])).catch(() => {})
  }, [base])

  useEffect(() => {
    setLoading(true)
    fetchAttachments().finally(() => setLoading(false))
  }, [fetchAttachments])

  useEffect(() => {
    const hasInProgress = attachments.some((a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing')
    if (!hasInProgress) return
    const t = setTimeout(() => { fetchAttachments() }, 4000)
    return () => clearTimeout(t)
  }, [attachments, fetchAttachments])

  useEffect(() => {
    onReadyChange(attachments.some((a) => a.summaryStatus === 'ready'))
  }, [attachments, onReadyChange])

  const uploadFile = async (file: File) => {
    setUploadingCount((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(base, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Upload failed'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 8000)
        return
      }
      setUploadError(null)
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error — upload failed'
      setUploadError(msg)
      setTimeout(() => setUploadError(null), 8000)
    } finally {
      setUploadingCount((n) => n - 1)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const fileArr = Array.from(files)
    setFilenameIssues(checkFilenames(fileArr))
    fileArr.forEach(uploadFile)
  }

  const handleDelete = async (a: Attachment) => {
    if (!confirm(`Delete "${a.filename}"?`)) return
    setDeletingId(a.id)
    try {
      await apiFetch(`${base}/${a.id}`, { method: 'DELETE' })
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch { /* ignore */ } finally { setDeletingId(null) }
  }

  return (
    <div className="pb-5">
      <div className="mb-4">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Brain</div>
        <h2 className="text-xl font-bold text-foreground">Research & Supporting Files</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {verticalId
            ? 'Upload anything relevant to this vertical — meeting notes, capability decks, audio recordings, strategy docs. Used as research context during programsPILOT sessions.'
            : 'Upload company-wide research — positioning docs, sales decks, strategy notes. These feed into the client brain and inform all verticals.'
          }
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
        {(() => {
          const ready      = attachments.filter((a) => a.summaryStatus === 'ready').length
          const processing = attachments.filter((a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing').length
          const failed     = attachments.filter((a) => a.summaryStatus === 'failed').length
          if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
          if (attachments.length === 0) {
            return (
              <div>
                <p className="text-sm font-semibold text-foreground">No files in brain yet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Upload files below — each is automatically read and interpreted by Claude. Interpreted files feed into every programsPILOT session.</p>
              </div>
            )
          }
          return (
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {ready > 0 ? `✓ ${ready} file${ready !== 1 ? 's' : ''} in brain` : 'Files processing…'}
                  {processing > 0 && ` · ${processing} processing`}
                  {failed > 0 && ` · ${failed} failed`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ready > 0 ? 'Files are active — programsPILOT sessions will draw on them.' : 'Files are being read and interpreted — they will activate once ready.'}
                </p>
              </div>
              {ready > 0 && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Brain active</span>}
            </div>
          )
        })()}
      </div>

      {verticalId && (
        <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Website context <span className="text-[10px] font-normal text-muted-foreground ml-1">optional</span></p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {websiteStatus === 'none' && 'Scrape the client\'s website to add it to the brain.'}
                {(websiteStatus === 'pending' || websiteStatus === 'running') && 'Scraping website…'}
                {websiteStatus === 'ready' && '✓ Website scraped and in brain. Re-scrape anytime to refresh.'}
                {websiteStatus === 'failed' && 'Scrape failed — check the URL and try again.'}
              </p>
            </div>
            {(websiteStatus === 'running' || websiteStatus === 'pending') && (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://clientwebsite.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
            <button
              disabled={!websiteUrl.trim() || websiteStatus === 'running' || websiteStatus === 'pending'}
              onClick={() => onScrapeWebsite(websiteUrl.trim())}
              className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {websiteStatus === 'ready' ? 'Re-scrape' : 'Scrape Website'}
            </button>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors',
          dragging ? 'border-blue-400 bg-blue-50/40' : 'border-border hover:border-blue-300 hover:bg-muted/20',
        )}
      >
        <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.mp4,.mov,.mp3,.m4a,.wav,.webm" onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            Uploading{uploadingCount > 1 ? ` ${uploadingCount} files` : ''}…
          </div>
        ) : (
          <>
            <div className="text-2xl">📎</div>
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-[11px] text-muted-foreground">Notes, PDFs, Word docs, audio recordings, slide decks — any format</p>
          </>
        )}
      </div>

      {filenameIssues.length > 0 && <FilenameWarning issues={filenameIssues} />}
      {uploadError && (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600 mb-3">
          <span>⚠</span> {uploadError}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No files yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Uploaded files will appear here and feed into programsPILOT sessions</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              base={base}
              deletingId={deletingId}
              onDelete={handleDelete}
              onSummaryUpdated={(id, summary) =>
                setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary, summaryStatus: 'ready' } : x))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ProgramTypeCard ──────────────────────────────────────────────────────────

function ProgramTypeCard({
  typeKey,
  meta,
  existingCount,
  onLaunch,
}: {
  typeKey: string
  meta: ProgramTypeMeta
  existingCount: number
  onLaunch: () => void
}) {
  const Icon = meta.icon
  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border bg-transparent p-3.5 transition-all hover:border-purple-300 hover:shadow-sm">
      {existingCount > 0 && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5">
          <Icons.CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
          <span className="text-[9px] font-medium text-emerald-700">{existingCount} active</span>
        </div>
      )}
      <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', meta.bg)}>
        <Icon className={cn('h-4 w-4', meta.color)} />
      </div>
      <p className="text-[12px] font-semibold text-foreground pr-14 leading-snug">{meta.label}</p>
      <p className="text-[11px] text-muted-foreground leading-snug flex-1">{meta.description}</p>
      <p className="text-[10px] text-muted-foreground">{meta.executionModel === 'recurring' ? 'Recurring' : 'One-time'} · {meta.templateItems.length} deliverables</p>
      <button
        onClick={onLaunch}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold text-white transition-colors opacity-0 group-hover:opacity-100"
        style={{ backgroundColor: '#a200ee' }}
      >
        <Icons.Zap className="h-3 w-3" />
        {existingCount > 0 ? 'Build another' : 'Build program'}
      </button>
    </div>
  )
}

// ─── PilotModal ───────────────────────────────────────────────────────────────

function PilotModal({
  clientId,
  editingProgram,
  verticals,
  initialMessage,
  onClose,
  onProgramSaved,
}: {
  clientId: string
  editingProgram: Program | null
  verticals: Vertical[]
  initialMessage?: string
  onClose: () => void
  onProgramSaved: (program: Program) => void
}) {
  const resumingBuild = editingProgram?.pilotPhase === 'build'

  const [selectedVerticalId, setSelectedVerticalId] = useState<string | null>(editingProgram?.verticalId ?? null)
  const [localPilotPhase, setLocalPilotPhase] = useState<'think' | 'build'>(resumingBuild ? 'build' : 'think')
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(editingProgram?.id ?? null)
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
  const autoSentRef = useRef(false)

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

      if (body.program && localPilotPhase === 'think') {
        setCurrentProgramId(body.program.id)
        setLocalPilotPhase('build')
        onProgramSaved(body.program)
      }

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

  // Auto-send initial message when launched from a type card
  useEffect(() => {
    if (!initialMessage || editingProgram || autoSentRef.current) return
    autoSentRef.current = true
    const timer = setTimeout(() => void sendMessage(initialMessage), 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

        {/* Vertical picker */}
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
                              isUser ? 'text-white rounded-tr-sm' : 'bg-zinc-100 text-foreground rounded-tl-sm',
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
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: '#a200ee' }}>
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

export function ProgramsTab({ clientId }: ProgramsTabProps) {
  const verticalTerm = useVerticalTerm()

  // Programs state
  const [programs, setPrograms] = useState<Program[]>([])
  const [programsLoading, setProgramsLoading] = useState(true)

  // Layout state
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showPilot, setShowPilot] = useState(false)
  const [editingProgram, setEditingProgram] = useState<Program | null>(null)
  const [pilotInitialMessage, setPilotInitialMessage] = useState<string | undefined>()
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)

  // Verticals + dimension selection
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [verticalsLoading, setVerticalsLoading] = useState(true)
  const [selectedDimensions, setSelectedDimensions] = useState<Record<string, string>>({})
  const selectedVertical = verticals.find((v) => Object.values(selectedDimensions).includes(v.id)) ?? null

  // Website scrape state
  const [websiteStatus, setWebsiteStatus] = useState<'none' | 'pending' | 'running' | 'ready' | 'failed'>('none')
  const websitePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        const list: Vertical[] = [...(data ?? [])].sort((a: Vertical, b: Vertical) => a.name.localeCompare(b.name))
        setVerticals(list)
      })
      .catch(() => {})
      .finally(() => setVerticalsLoading(false))
  }, [clientId])

  useEffect(() => {
    if (!selectedVertical) { setWebsiteStatus('none'); return }
    const endpoint = `/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`
    apiFetch(endpoint).then((r) => r.json()).then(({ data }) => {
      setWebsiteStatus((data?.status ?? 'none') as typeof websiteStatus)
    }).catch(() => {})
    return () => { if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null } }
  }, [clientId, selectedVertical])

  const startWebsitePolling = useCallback(() => {
    if (websitePollRef.current) clearInterval(websitePollRef.current)
    websitePollRef.current = setInterval(() => {
      if (!selectedVertical) return
      apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`)
        .then((r) => r.json()).then(({ data }) => {
          const s = (data?.status ?? 'none') as typeof websiteStatus
          setWebsiteStatus(s)
          if (s !== 'running' && s !== 'pending') {
            if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null }
          }
        }).catch(() => {})
    }, 4000)
  }, [clientId, selectedVertical])

  const scrapeWebsite = useCallback(async (websiteUrl: string) => {
    if (!selectedVertical || !websiteUrl) return
    setWebsiteStatus('pending')
    await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    })
    startWebsitePolling()
  }, [clientId, selectedVertical, startWebsitePolling])

  const fetchPrograms = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/programs?clientId=${clientId}`)
      if (!res.ok) return
      const body = await res.json()
      setPrograms(body.data ?? [])
    } catch { /* ignore */ } finally { setProgramsLoading(false) }
  }, [clientId])

  useEffect(() => { fetchPrograms() }, [fetchPrograms])

  const openNewProgram = (typeName?: string) => {
    setEditingProgram(null)
    setPilotInitialMessage(typeName ? `I want to build a ${typeName} program` : undefined)
    setShowPilot(true)
  }

  const openContinueSetup = (program: Program) => {
    setEditingProgram(program)
    setPilotInitialMessage(undefined)
    setShowPilot(true)
  }

  const closePilot = () => {
    setShowPilot(false)
    setEditingProgram(null)
    setPilotInitialMessage(undefined)
    fetchPrograms()
  }

  const handleProgramSaved = (program: Program) => {
    setPrograms((prev) => {
      const exists = prev.find((p) => p.id === program.id)
      return exists ? prev.map((p) => (p.id === program.id ? program : p)) : [program, ...prev]
    })
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

  const activeCat = activeCategory ? (PROGRAM_CATEGORIES.find((c) => c.key === activeCategory) ?? null) : null

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Dimension selector bar */}
      <DimensionBar
        items={verticals}
        selected={selectedDimensions}
        onChange={(type, id) => setSelectedDimensions(id ? { [type]: id } : {})}
        loading={verticalsLoading}
        verticalTerm={verticalTerm}
      />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left sidebar */}
        <div className="flex w-52 shrink-0 flex-col border-r border-border overflow-y-auto">

          {/* programsPILOT header — click to return to Brain view */}
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-left transition-colors border-b border-border',
              activeCategory === null ? 'bg-muted/20' : 'hover:bg-muted/20',
            )}
          >
            <Icons.Zap className="h-3.5 w-3.5 shrink-0" style={{ color: '#a200ee' }} />
            <div>
              <p className="text-[11px] font-bold tracking-wide" style={{ color: '#a200ee' }}>programsPILOT</p>
              <p className="text-[10px] text-muted-foreground">Brain & Overview</p>
            </div>
          </button>

          {/* Category navigation */}
          <div className="flex flex-col gap-0.5 p-2 flex-1">
            {PROGRAM_CATEGORIES.map((cat) => {
              const CatIcon = cat.icon
              const isActive = cat.key === activeCategory
              const activeCount = programs.filter((p) => cat.types.includes(p.type) && p.pilotPhase === 'complete').length
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    isActive ? 'text-white' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                  )}
                  style={isActive ? { backgroundColor: '#a200ee' } : {}}
                >
                  <CatIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-[11px] font-medium flex-1">{cat.label}</span>
                  {activeCount > 0 && (
                    <span className={cn(
                      'text-[9px] font-semibold rounded-full px-1.5 py-0.5',
                      isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
                    )}>{activeCount}</span>
                  )}
                </button>
              )
            })}

            {/* My Programs — quick access list */}
            {!programsLoading && programs.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <p className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">My Programs</p>
                {programs.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProgramId(p.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
                  >
                    <span className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      p.pilotPhase === 'complete' && p.status === 'active' ? 'bg-emerald-400' :
                      p.pilotPhase === 'complete' ? 'bg-zinc-400' : 'bg-amber-400',
                    )} />
                    <span className="text-[11px] truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right content area */}
        <div className="flex-1 overflow-y-auto">
          {activeCategory === null ? (
            /* Brain + overview — default landing */
            <div className="p-6 max-w-3xl">
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Icons.Zap className="h-4 w-4" style={{ color: '#a200ee' }} />
                  <h2 className="text-base font-semibold text-foreground">programsPILOT</h2>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  AI-guided program builder for demand gen and content marketers. Each session walks through strategy first, then builds every template and deliverable you need — from outbound sequences to thought leadership to launch campaigns.
                </p>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Select a program category from the left navigation to browse types and start building.
                  {selectedVertical && <> Sessions will draw on the <span className="font-medium text-foreground">{selectedVertical.name}</span> vertical brain.</>}
                </p>
              </div>
              <BrainSection
                clientId={clientId}
                verticalId={selectedVertical?.id ?? null}
                websiteStatus={websiteStatus}
                onScrapeWebsite={scrapeWebsite}
                onReadyChange={() => {}}
              />
            </div>
          ) : activeCat ? (
            /* Program type grid — shown when category selected */
            <div className="p-6">
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  {(() => { const CatIcon = activeCat.icon; return <CatIcon className="h-4 w-4 text-muted-foreground" /> })()}
                  <h2 className="text-base font-semibold text-foreground">{activeCat.label}</h2>
                  <span className="text-[11px] text-muted-foreground">{activeCat.types.length} program type{activeCat.types.length !== 1 ? 's' : ''}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click any program type to launch a guided programsPILOT session. Completed programs save a strategy brief to the client Brain.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {activeCat.types.map((typeKey) => {
                  const meta = PROGRAM_TYPE_META[typeKey]
                  if (!meta) return null
                  const existingCount = programs.filter((p) => p.type === typeKey && p.pilotPhase === 'complete').length
                  return (
                    <ProgramTypeCard
                      key={typeKey}
                      typeKey={typeKey}
                      meta={meta}
                      existingCount={existingCount}
                      onLaunch={() => openNewProgram(meta.label)}
                    />
                  )
                })}
              </div>

              {/* Existing programs in this category */}
              {(() => {
                const catPrograms = programs.filter((p) => activeCat.types.includes(p.type))
                if (catPrograms.length === 0) return null
                return (
                  <div className="mt-8">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Existing Programs</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {catPrograms.map((program) => (
                        <ProgramCard
                          key={program.id}
                          program={program}
                          isSelected={selectedProgramId === program.id}
                          onSelect={(p) => setSelectedProgramId(p.id)}
                          onContinueSetup={openContinueSetup}
                          onPauseResume={handlePauseResume}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          ) : null}
        </div>
      </div>

      {/* Program detail modal */}
      {selectedProgramId && (
        <ProgramDetailPanel
          key={selectedProgramId}
          programId={selectedProgramId}
          onClose={() => setSelectedProgramId(null)}
          onContinueSetup={(p) => { setSelectedProgramId(null); openContinueSetup(p) }}
        />
      )}

      {/* programsPILOT modal */}
      {showPilot && (
        <PilotModal
          clientId={clientId}
          editingProgram={editingProgram}
          verticals={verticals}
          initialMessage={pilotInitialMessage}
          onClose={closePilot}
          onProgramSaved={handleProgramSaved}
        />
      )}
    </div>
  )
}
