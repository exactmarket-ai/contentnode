/**
 * ProgramsTab.tsx
 *
 * Standing content programs (Thought Leadership, SEO Content, etc.) with a
 * programsPILOT guided-setup chat interface.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProgramType =
  | 'thought_leadership'
  | 'seo_content'
  | 'competitive_intel'
  | 'newsletter'
  | 'customer_story'
  | 'event_content'

type ProgramStatus = 'active' | 'paused' | 'archived'

interface ScheduledTask {
  id: string
  label: string
}

interface Program {
  id: string
  clientId: string
  type: ProgramType
  name: string
  status: ProgramStatus
  scheduledTask?: ScheduledTask | null
  contentConfig?: {
    blogs?: number
    platforms?: string[]
    images?: boolean
    [key: string]: unknown
  } | null
  lastRunAt?: string | null
  runCount?: number
  createdAt: string
}

interface PilotMessage {
  role: 'user' | 'assistant'
  content: string
}

interface PilotApiResponse {
  message: string
  program?: Program
}

// ─── Program type config ──────────────────────────────────────────────────────

const PROGRAM_TYPES: Record<
  ProgramType,
  {
    label: string
    color: string
    bg: string
    icon: React.ComponentType<{ className?: string }>
    description: string
  }
> = {
  thought_leadership: {
    label: 'Thought Leadership',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    icon: Icons.BookOpen,
    description:
      'Research → blogs + social posts + images. Keeps client visible as authority.',
  },
  seo_content: {
    label: 'SEO Content Engine',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    icon: Icons.Search,
    description: 'Keyword-driven content generation with structured publishing cadence.',
  },
  competitive_intel: {
    label: 'Competitive Intel',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    icon: Icons.Target,
    description: 'Monitor competitors and surface insights for positioning and messaging.',
  },
  newsletter: {
    label: 'Newsletter',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    icon: Icons.Mail,
    description: 'Regular newsletter generation from curated sources and client content.',
  },
  customer_story: {
    label: 'Customer Story',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    icon: Icons.Users,
    description: 'Turn customer wins and feedback into compelling story-driven content.',
  },
  event_content: {
    label: 'Event Content',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    icon: Icons.Calendar,
    description: 'Pre, during, and post-event content for conferences and webinars.',
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never run'
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

function buildContentSummary(
  config: Program['contentConfig'],
): string {
  if (!config) return ''
  const parts: string[] = []
  if (config.blogs && config.blogs > 0) parts.push(`${config.blogs} blog${config.blogs !== 1 ? 's' : ''}`)
  if (Array.isArray(config.platforms) && config.platforms.length > 0) {
    parts.push(...(config.platforms as string[]))
  }
  if (config.images) parts.push('Images')
  return parts.join(' · ')
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProgramStatus }) {
  const map: Record<ProgramStatus, { dot: string; label: string; text: string }> = {
    active: { dot: 'bg-emerald-400', label: 'Active', text: 'text-emerald-400' },
    paused: { dot: 'bg-amber-400', label: 'Paused', text: 'text-amber-400' },
    archived: { dot: 'bg-slate-500', label: 'Archived', text: 'text-slate-400' },
  }
  const s = map[status]
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

// ─── TypeBadge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ProgramType }) {
  const cfg = PROGRAM_TYPES[type]
  if (!cfg) return null
  const TypeIcon = cfg.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        cfg.bg,
        cfg.color,
      )}
    >
      <TypeIcon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

// ─── ProgramCard ─────────────────────────────────────────────────────────────

function ProgramCard({
  program,
  onPauseResume,
  onEdit,
  onDelete,
}: {
  program: Program
  onPauseResume: (program: Program) => void
  onEdit: (program: Program) => void
  onDelete: (program: Program) => void
}) {
  const contentSummary = buildContentSummary(program.contentConfig)

  return (
    <div className="rounded-xl border border-border bg-transparent p-4">
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <TypeBadge type={program.type} />
            <StatusBadge status={program.status} />
          </div>
          <p className="text-sm font-bold text-foreground leading-snug">{program.name}</p>
        </div>
        {(program.runCount ?? 0) > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {program.runCount} run{program.runCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Meta rows */}
      <div className="mb-3 space-y-1.5">
        {/* Research source */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <Icons.Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          {program.scheduledTask ? (
            <span className="text-foreground/80">{program.scheduledTask.label}</span>
          ) : (
            <span className="text-muted-foreground">No research source</span>
          )}
        </div>

        {/* Content config summary */}
        {contentSummary && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Icons.FileText className="h-3 w-3 shrink-0" />
            <span>{contentSummary}</span>
          </div>
        )}

        {/* Last run */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icons.Clock className="h-3 w-3 shrink-0" />
          <span>{relativeTime(program.lastRunAt)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <button
          onClick={() => onPauseResume(program)}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          {program.status === 'active' ? (
            <>
              <Icons.PauseCircle className="h-3 w-3" />
              Pause
            </>
          ) : (
            <>
              <Icons.PlayCircle className="h-3 w-3" />
              Resume
            </>
          )}
        </button>

        <button
          onClick={() => onEdit(program)}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Icons.Pencil className="h-3 w-3" />
          Edit
        </button>

        <button
          onClick={() => onDelete(program)}
          className="ml-auto flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-red-400"
        >
          <Icons.Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  )
}

// ─── LoadingDots ─────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

// ─── PilotModal ───────────────────────────────────────────────────────────────

function PilotModal({
  clientId,
  editingProgram,
  onClose,
  onProgramSaved,
}: {
  clientId: string
  editingProgram: Program | null
  onClose: () => void
  onProgramSaved: (program: Program) => void
}) {
  const [messages, setMessages] = useState<PilotMessage[]>([])
  const [input, setInput] = useState('')
  const [pilotLoading, setPilotLoading] = useState(false)
  const [createdProgram, setCreatedProgram] = useState<Program | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pilotLoading])

  // On mount: fetch opening question from pilot API
  const initSession = useCallback(async () => {
    setPilotLoading(true)
    try {
      const res = await apiFetch('/api/v1/programs/pilot', {
        method: 'POST',
        body: JSON.stringify({
          messages: [],
          clientId,
          currentProgramId: editingProgram?.id ?? undefined,
        }),
      })
      if (!res.ok) return
      const body: PilotApiResponse = await res.json()
      setMessages([{ role: 'assistant', content: body.message }])
      if (body.program) {
        setCreatedProgram(body.program)
      }
    } catch {
      // ignore
    } finally {
      setPilotLoading(false)
    }
  }, [clientId, editingProgram?.id])

  useEffect(() => {
    initSession()
  }, [initSession])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || pilotLoading) return

    const newMessages: PilotMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setPilotLoading(true)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const res = await apiFetch('/api/v1/programs/pilot', {
        method: 'POST',
        body: JSON.stringify({
          messages: newMessages,
          clientId,
          currentProgramId: editingProgram?.id ?? undefined,
        }),
      })
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Something went wrong. Please try again.' },
        ])
        return
      }
      const body: PilotApiResponse = await res.json()
      setMessages((prev) => [...prev, { role: 'assistant', content: body.message }])
      if (body.program) {
        setCreatedProgram(body.program)
        onProgramSaved(body.program)
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Network error — please try again.' },
      ])
    } finally {
      setPilotLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-grow textarea up to 4 lines
    const el = e.target
    el.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * 4 + 16 // 4 lines + padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icons.Sparkles className="h-4 w-4 text-violet-400" />
            <div>
              <p className="text-sm font-bold text-foreground">programsPILOT</p>
              <p className="text-[11px] text-muted-foreground">Set up your content program</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Editing context banner */}
        {editingProgram && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-5 py-2.5">
            <Icons.Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground">Editing:</span>
            <span className="text-[11px] font-semibold text-foreground">{editingProgram.name}</span>
            <TypeBadge type={editingProgram.type} />
          </div>
        )}

        {/* Success state */}
        {createdProgram ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Icons.CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-foreground">
                {editingProgram ? 'Program updated!' : 'Program created!'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{createdProgram.name}</p>
              <div className="mt-2 flex justify-center">
                <TypeBadge type={createdProgram.type} />
              </div>
            </div>
            <Button onClick={onClose} size="sm">
              Close
            </Button>
          </div>
        ) : (
          <>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ maxHeight: '420px' }}>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-muted/40 border border-border text-foreground rounded-bl-sm',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {pilotLoading && messages.length > 0 && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm border border-border bg-muted/40 px-3.5 py-2.5">
                    <LoadingDots />
                  </div>
                </div>
              )}

              {/* Initial loading state (no messages yet) */}
              {pilotLoading && messages.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                    Starting session…
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your answer…"
                  rows={1}
                  disabled={pilotLoading && messages.length === 0}
                  className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 leading-5"
                  style={{ minHeight: '36px' }}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || pilotLoading}
                  size="sm"
                  className="shrink-0"
                >
                  {pilotLoading ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Icons.Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Press Enter to send · Shift+Enter for new line
              </p>
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
  const [loading, setLoading] = useState(true)
  const [showPilot, setShowPilot] = useState(false)
  const [editingProgram, setEditingProgram] = useState<Program | null>(null)

  const fetchPrograms = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/programs?clientId=${clientId}`)
      if (!res.ok) return
      const body = await res.json()
      setPrograms(body.data ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchPrograms()
  }, [fetchPrograms])

  const openNewProgram = () => {
    setEditingProgram(null)
    setShowPilot(true)
  }

  const openEditProgram = (program: Program) => {
    setEditingProgram(program)
    setShowPilot(true)
  }

  const closePilot = () => {
    setShowPilot(false)
    setEditingProgram(null)
    fetchPrograms()
  }

  const handleProgramSaved = (program: Program) => {
    setPrograms((prev) => {
      const exists = prev.find((p) => p.id === program.id)
      if (exists) {
        return prev.map((p) => (p.id === program.id ? program : p))
      }
      return [program, ...prev]
    })
  }

  const handlePauseResume = async (program: Program) => {
    const newStatus: ProgramStatus = program.status === 'active' ? 'paused' : 'active'
    // Optimistic update
    setPrograms((prev) =>
      prev.map((p) => (p.id === program.id ? { ...p, status: newStatus } : p)),
    )
    try {
      const res = await apiFetch(`/api/v1/programs/${program.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        // Revert on failure
        setPrograms((prev) =>
          prev.map((p) => (p.id === program.id ? { ...p, status: program.status } : p)),
        )
      }
    } catch {
      // Revert on error
      setPrograms((prev) =>
        prev.map((p) => (p.id === program.id ? { ...p, status: program.status } : p)),
      )
    }
  }

  const handleDelete = async (program: Program) => {
    if (!confirm(`Delete program "${program.name}"? This cannot be undone.`)) return
    setPrograms((prev) => prev.filter((p) => p.id !== program.id))
    try {
      await apiFetch(`/api/v1/programs/${program.id}`, { method: 'DELETE' })
    } catch {
      // Re-fetch to restore accurate state if delete failed
      fetchPrograms()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-base font-bold text-foreground">Content Programs</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Standing programs that generate content on a recurring schedule.
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
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          </div>
        ) : programs.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {/* Illustration */}
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-violet-500/10">
              <Icons.Sparkles className="h-8 w-8 text-violet-400" />
            </div>
            <p className="text-base font-bold text-foreground">No programs yet</p>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Programs are standing content engines — set one up and it runs on a schedule,
              generating blogs, social posts, newsletters, and more.
            </p>
            <Button onClick={openNewProgram} className="mt-6">
              <Icons.Sparkles className="mr-1.5 h-4 w-4" />
              Set up your first program
            </Button>
          </div>
        ) : (
          /* Programs grid */
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {programs.map((program) => (
              <ProgramCard
                key={program.id}
                program={program}
                onPauseResume={handlePauseResume}
                onEdit={openEditProgram}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* programsPILOT modal */}
      {showPilot && (
        <PilotModal
          clientId={clientId}
          editingProgram={editingProgram}
          onClose={closePilot}
          onProgramSaved={handleProgramSaved}
        />
      )}
    </div>
  )
}
