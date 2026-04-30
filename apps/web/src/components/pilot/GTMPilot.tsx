/**
 * GTMPilot.tsx
 *
 * gtmPILOT — AI GTM Framework strategist anchored to the bottom of the GTM Framework tab.
 * Expands to 40% of the viewport height.
 * Accesses client brain → organization brain → industry GTM standards.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GtmSuggestion {
  id: string
  title: string
  description: string
  sectionNum: string   // e.g. "01", "08"
  action: 'navigate'
}

interface GtmMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: GtmSuggestion[]
}

export interface ConflictEntry {
  sectionNum: string
  field?: string
  clientClaim: string
  researchFinds: string
  recommendation?: string
}

interface PriorSession {
  id: string
  messageCount: number
  createdAt: string
  summarizedAt: string | null
  summary: {
    decisions: string[]
    rejected: string[]
    openQuestions: string[]
  } | null
}

export interface GTMPilotProps {
  clientId: string
  verticalId: string | null
  verticalName: string | null
  filledSections: string[]
  emptySections: string[]
  onNavigateToSection: (sectionNum: string) => void
  // Controlled open state
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Research context
  activeSection?: string | null
  researchRun?: { sectionResults: Record<string, string | null> | null } | null
  conflictLog?: ConflictEntry[] | null
  sectionStatus?: Record<string, string>
  onSectionStatusChange?: (sectionNum: string, status: string) => void
  // Company brief
  companyBrief?: string | null
  onBriefSaved?: (brief: string) => void
  // Section skip (e.g. §17 "no regulations apply" → mark complete)
  onSectionSkipped?: (sectionNum: string) => void
}

// ─── Section display names ────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  '01': 'Vertical Overview',
  '02': 'Customer Definition',
  '03': 'Market Pressures',
  '04': 'Core Challenges',
  '05': 'Solutions + Stack',
  '06': 'Why [Client]',
  '07': 'Segments + Buyers',
  '08': 'Messaging Framework',
  '09': 'Proof Points',
  '10': 'Objection Handling',
  '11': 'Brand Voice',
  '12': 'Competitive Diff',
  '13': 'Customer Quotes',
  '14': 'Campaign Themes',
  '15': 'FAQs',
  '16': 'Content Funnel',
  '17': 'Regulatory',
  '18': 'CTAs + Next Steps',
}

const SECTION_NUMS = Object.keys(SECTION_LABELS)

// ─── Status dot ───────────────────────────────────────────────────────────────

function PilotStatusDot({ status }: { status: string }) {
  if (status === 'complete') return <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
  if (status === 'ai-draft') return <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
  if (status === 'in-progress') return <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
  return <span className="h-2 w-2 rounded-full border border-muted-foreground/40 shrink-0" />
}

// ─── Bold renderer ────────────────────────────────────────────────────────────

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b>
      : part,
  )
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onNavigateToSection,
  onSendMessage,
}: {
  suggestion: GtmSuggestion
  onNavigateToSection: (num: string) => void
  onSendMessage: (text: string) => void
}) {
  const handleNavigate = () => {
    onNavigateToSection(suggestion.sectionNum)
    onSendMessage(`I'm in section ${suggestion.sectionNum} — ${SECTION_LABELS[suggestion.sectionNum] ?? suggestion.title}. What should I focus on here?`)
  }

  return (
    <div className="rounded-xl border border-border bg-background hover:border-blue-300 p-3 flex flex-col gap-1.5 transition-colors">
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-semibold text-foreground leading-snug">
          <span className="mr-1.5 inline-flex items-center justify-center rounded bg-blue-100 px-1 py-0.5 text-[9px] font-bold text-blue-600">
            §{suggestion.sectionNum}
          </span>
          {suggestion.title}
        </span>
        <Icons.Compass className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{suggestion.description}</p>
      <button
        onClick={handleNavigate}
        className="w-full rounded-md bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
      >
        Go to section <Icons.ArrowRight className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onNavigateToSection,
  onSendMessage,
}: {
  msg: GtmMessage
  onNavigateToSection: (num: string) => void
  onSendMessage: (text: string) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 mt-0.5">
          <Icons.Compass className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        <div
          className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
            isUser
              ? 'bg-blue-500 text-white rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          }`}
        >
          {msg.content.split('\n').map((line, i, arr) => (
            <span key={i}>
              {renderBold(line)}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </div>
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            {msg.suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onNavigateToSection={onNavigateToSection}
                onSendMessage={onSendMessage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GTMPilot({
  clientId,
  verticalId,
  verticalName,
  filledSections,
  emptySections,
  onNavigateToSection,
  open: openProp,
  onOpenChange,
  activeSection,
  researchRun,
  conflictLog,
  sectionStatus = {},
  onSectionStatusChange,
  companyBrief,
  onBriefSaved,
  onSectionSkipped,
}: GTMPilotProps) {
  const [openInternal, setOpenInternal] = useState(false)
  const [messages, setMessages]         = useState<GtmMessage[]>([])
  const [loading, setLoading]           = useState(false)
  const [input, setInput]               = useState('')
  const [researchPanelOpen, setResearchPanelOpen] = useState(true)
  const [historyOpen, setHistoryOpen]   = useState(false)
  const [priorSessions, setPriorSessions] = useState<PriorSession[]>([])

  const scrollRef    = useRef<HTMLDivElement>(null)
  const lastMsgRef   = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLTextAreaElement>(null)
  // Stable session ID for this PILOT opening — generated once on mount
  const sessionIdRef = useRef<string>(crypto.randomUUID())

  // Controlled vs uncontrolled open state
  const open = openProp !== undefined ? openProp : openInternal
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v)
    else setOpenInternal(v)
  }

  // When openProp flips to true from parent (Launch PILOT button), open
  useEffect(() => {
    if (openProp === true) setOpenInternal(true)
  }, [openProp])

  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // Load prior session summaries when PILOT opens and verticalId is set
  useEffect(() => {
    if (!open || !verticalId) return
    apiFetch(`/api/v1/gtm-pilot/sessions?clientId=${clientId}&verticalId=${verticalId}`)
      .then((res) => res.json())
      .then((json) => { if (Array.isArray(json.data)) setPriorSessions(json.data as PriorSession[]) })
      .catch(() => {})
  }, [open, clientId, verticalId])

  // Clear conversation when vertical changes
  useEffect(() => {
    setMessages([])
  }, [verticalId])

  // Research findings for active section
  const activeSectionResearch = activeSection && researchRun?.sectionResults
    ? researchRun.sectionResults[activeSection] ?? null
    : null

  // Conflicts for active section
  const activeSectionConflicts = activeSection && conflictLog
    ? conflictLog.filter((c) => c.sectionNum === activeSection)
    : []

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading || !verticalId) return

    if (!overrideText) setInput('')

    const userMsg: GtmMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]

      // Build research context for active section
      const researchBySection: Record<string, string> | undefined = (activeSection && activeSectionResearch)
        ? { [activeSection]: activeSectionResearch }
        : undefined

      const res = await apiFetch('/api/v1/gtm-pilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          verticalId: verticalId!,
          verticalName,
          filledSections,
          emptySections,
          activeSection: activeSection ?? undefined,
          researchBySection,
          conflictLog: activeSectionConflicts.length > 0 ? activeSectionConflicts : undefined,
          companyBrief: companyBrief ?? undefined,
          sessionId:    sessionIdRef.current,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, { role: 'assistant', content: `Something went wrong: ${(err as { error?: string }).error ?? res.status}` }])
        return
      }

      const { data: respData } = await res.json() as { data: { reply: string; suggestions: GtmSuggestion[] } }
      const suggestions: GtmSuggestion[] = Array.isArray(respData.suggestions) ? respData.suggestions : []
      let replyContent = (respData.reply ?? '').trim()

      // Parse BRIEF_SAVE: marker — PILOT built a brief during intake
      const briefMatch = replyContent.match(/BRIEF_SAVE:\s*(.+?)(?:\n|$)/s)
      if (briefMatch && onBriefSaved) {
        const savedBrief = briefMatch[1].trim()
        onBriefSaved(savedBrief)
        replyContent = replyContent.replace(/BRIEF_SAVE:\s*.+?(?:\n|$)/s, '').trim()
      }

      // Parse SECTION_SKIP: marker — PILOT determined section should be skipped (e.g. §17 no regulations)
      const skipMatch = replyContent.match(/^SECTION_SKIP:\s*(\d+)\s*$/m)
      if (skipMatch && onSectionSkipped) {
        onSectionSkipped(skipMatch[1].padStart(2, '0'))
        replyContent = replyContent.replace(/^SECTION_SKIP:\s*\d+\s*\n?/m, '').trim()
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: replyContent, suggestions }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — check your connection and try again.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, verticalId, verticalName, filledSections, emptySections, activeSection, activeSectionResearch, activeSectionConflicts, companyBrief, onBriefSaved, onSectionSkipped])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const handleSendMessage = useCallback((text: string) => {
    void sendMessage(text)
  }, [sendMessage])

  const handleNavToSection = (num: string) => {
    onNavigateToSection(num)
    void sendMessage(`I'm looking at section ${num} — ${SECTION_LABELS[num] ?? num}. What should I focus on here?`)
  }

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!open) {
    const lastMsg = [...messages].reverse().find((m) => m.role === 'assistant')
    const conflictCount = conflictLog?.length ?? 0
    return (
      <div
        className="relative flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 cursor-pointer hover:bg-muted/40 transition-colors"
        style={{ height: 44 }}
        onClick={() => setOpen(true)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true) }}
          title="Open gtmPILOT"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
        >
          <Icons.ChevronUp className="h-2 w-2 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1.5 text-blue-600 shrink-0">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">gtmPILOT</span>
        </div>

        {conflictCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
          </span>
        )}

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {!verticalId
            ? 'Select a vertical above to start your GTM Framework…'
            : lastMsg
              ? lastMsg.content.replace(/\n/g, ' ').slice(0, 90)
              : 'Ask me to help complete your GTM Framework sections…'
          }
        </span>

        <span className="text-[10px] text-blue-500 font-medium shrink-0 select-none">
          Click to open ↑
        </span>
      </div>
    )
  }

  // ── Expanded — 40% viewport height ────────────────────────────────────────
  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: '40vh' }}
    >
      <button
        onClick={() => setOpen(false)}
        title="Collapse gtmPILOT"
        className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
      >
        <Icons.ChevronDown className="h-2 w-2 text-muted-foreground" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1.5 text-blue-600">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">gtmPILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI GTM Framework strategist</span>
        {verticalName && (
          <span className="ml-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[9px] font-medium text-blue-700">
            {verticalName}
          </span>
        )}
        {activeSection && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
            §{activeSection} {SECTION_LABELS[activeSection] ?? ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {emptySections.length > 0 && (
            <span className="text-[9px] text-muted-foreground">
              {emptySections.length} section{emptySections.length !== 1 ? 's' : ''} to fill
            </span>
          )}
          {priorSessions.length > 0 && (
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              title="Session history"
              className={cn(
                'flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors',
                historyOpen
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icons.History className="h-3 w-3" />
              {priorSessions.length} prior
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([])
                // Generate a new session ID so the next conversation is a fresh session
                sessionIdRef.current = crypto.randomUUID()
              }}
              title="Clear conversation"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Icons.Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Session history panel */}
      {historyOpen && priorSessions.length > 0 && (
        <div className="border-b border-border bg-muted/40 shrink-0 max-h-48 overflow-y-auto">
          <div className="px-4 py-2 space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Prior sessions — injected into PILOT context</p>
            {priorSessions.map((s) => {
              const date = new Date(s.summarizedAt ?? s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              return (
                <div key={s.id} className="rounded-lg border border-border bg-background p-3 text-[11px] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{date} · {s.messageCount} messages</span>
                    <button
                      onClick={async () => {
                        await apiFetch(`/api/v1/gtm-pilot/sessions/${s.id}`, { method: 'DELETE' })
                        setPriorSessions((prev) => prev.filter((x) => x.id !== s.id))
                      }}
                      className="text-[10px] text-red-500 hover:text-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                  {s.summary?.decisions && s.summary.decisions.length > 0 && (
                    <div>
                      <span className="text-[10px] font-medium text-green-700 uppercase tracking-wide">Decided</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {s.summary.decisions.map((d, i) => <li key={i} className="text-muted-foreground pl-2 border-l-2 border-green-200">{d}</li>)}
                      </ul>
                    </div>
                  )}
                  {s.summary?.rejected && s.summary.rejected.length > 0 && (
                    <div>
                      <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">Rejected</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {s.summary.rejected.map((r, i) => <li key={i} className="text-muted-foreground pl-2 border-l-2 border-amber-200">{r}</li>)}
                      </ul>
                    </div>
                  )}
                  {s.summary?.openQuestions && s.summary.openQuestions.length > 0 && (
                    <div>
                      <span className="text-[10px] font-medium text-blue-700 uppercase tracking-wide">Open</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {s.summary.openQuestions.map((q, i) => <li key={i} className="text-muted-foreground pl-2 border-l-2 border-blue-200">{q}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Research context banner — active section findings */}
      {activeSectionResearch && (
        <div className="border-b border-blue-100 bg-blue-50/60 shrink-0">
          <button
            onClick={() => setResearchPanelOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-1.5 text-left"
          >
            <Icons.BookOpen className="h-3 w-3 text-blue-500 shrink-0" />
            <span className="flex-1 text-[10px] font-semibold text-blue-700">Research findings for §{activeSection}</span>
            {researchPanelOpen
              ? <Icons.ChevronUp className="h-3 w-3 text-blue-400 shrink-0" />
              : <Icons.ChevronDown className="h-3 w-3 text-blue-400 shrink-0" />
            }
          </button>
          {researchPanelOpen && (
            <div className="max-h-20 overflow-y-auto px-4 pb-2">
              <p className="text-[10px] text-blue-800 leading-relaxed whitespace-pre-wrap">{activeSectionResearch}</p>
            </div>
          )}
        </div>
      )}

      {/* Conflict banner — conflicts for active section */}
      {activeSectionConflicts.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50/80 px-4 py-2 shrink-0 space-y-1.5">
          {activeSectionConflicts.map((c, i) => (
            <div key={i} className="text-[10px]">
              <span className="font-semibold text-amber-800">Client says:</span>{' '}
              <span className="text-amber-700">{c.clientClaim}</span>
              {c.researchFinds && (
                <>
                  {' · '}
                  <span className="font-semibold text-amber-800">Research shows:</span>{' '}
                  <span className="text-amber-700">{c.researchFinds}</span>
                </>
              )}
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => void sendMessage(`On §${c.sectionNum}, I accept the client's version: "${c.clientClaim}"`)}
                  className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 hover:bg-amber-300 transition-colors"
                >
                  Accept client
                </button>
                <button
                  onClick={() => void sendMessage(`On §${c.sectionNum}, I'll go with what the research shows: "${c.researchFinds}"`)}
                  className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 hover:bg-amber-300 transition-colors"
                >
                  Accept research
                </button>
                <button
                  onClick={() => void sendMessage(`Let's discuss the conflict in §${c.sectionNum}: the client says "${c.clientClaim}" but research shows "${c.researchFinds}". Help me decide.`)}
                  className="rounded bg-transparent px-1.5 py-0.5 text-[9px] font-medium text-amber-700 hover:text-amber-900 transition-colors"
                >
                  Discuss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Body: section nav rail + chat */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Section nav rail */}
        <div className="w-40 shrink-0 overflow-y-auto border-r border-border py-1">
          {SECTION_NUMS.map((num) => {
            const status = sectionStatus[num] ?? (filledSections.includes(num) ? 'complete' : (emptySections.includes(num) ? 'not-started' : 'not-started'))
            const isActive = activeSection === num
            return (
              <button
                key={num}
                onClick={() => handleNavToSection(num)}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <span className="shrink-0 w-4 font-mono text-[9px] text-muted-foreground">{num}</span>
                <PilotStatusDot status={status} />
                <span className="truncate">{SECTION_LABELS[num]}</span>
              </button>
            )
          })}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center select-none">
              <Icons.Compass className="h-6 w-6 text-blue-300" />
              <p className="text-xs font-medium text-muted-foreground">I'm your GTM Framework strategist.</p>
              <p className="text-[10px] text-muted-foreground/60 max-w-[240px]">
                {activeSection
                  ? `I can see you're on §${activeSection} — ${SECTION_LABELS[activeSection] ?? ''}. Ask me anything about this section.`
                  : 'I\'ll use the client brain, vertical knowledge, and GTM best practices to guide you through all 18 sections.'
                }
              </p>
              <button
                onClick={() => void sendMessage(
                  activeSection
                    ? `Help me fill in §${activeSection} — ${SECTION_LABELS[activeSection] ?? ''}`
                    : "Which sections should we focus on first?"
                )}
                className="mt-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-600 hover:bg-blue-100 transition-colors"
              >
                {activeSection ? `Help me with §${activeSection}` : 'Which sections should we focus on first?'}
              </button>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
              <MessageBubble
                msg={msg}
                onNavigateToSection={onNavigateToSection}
                onSendMessage={handleSendMessage}
              />
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 items-start">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500">
                <Icons.Compass className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border px-3 py-2 shrink-0">
        {activeSection && onSectionStatusChange && (
          <button
            onClick={() => void onSectionStatusChange(activeSection, 'complete')}
            title="Mark section complete"
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-2 text-[10px] font-medium text-green-700 hover:bg-green-100 transition-colors whitespace-nowrap"
          >
            <Icons.CheckCircle2 className="h-3.5 w-3.5" />
            Mark §{activeSection} done
          </button>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything about this GTM Framework… (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[32px] max-h-[80px] overflow-y-auto"
          style={{ lineHeight: '1.4' }}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={!input.trim() || loading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Icons.SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
