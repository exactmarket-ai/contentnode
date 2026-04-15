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

export interface GTMPilotProps {
  clientId: string
  verticalId: string | null
  verticalName: string | null
  filledSections: string[]
  emptySections: string[]
  onNavigateToSection: (sectionNum: string) => void
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
}: GTMPilotProps) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<GtmMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [input, setInput]       = useState('')

  const scrollRef   = useRef<HTMLDivElement>(null)
  const lastMsgRef  = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // Clear conversation when vertical changes
  useEffect(() => {
    setMessages([])
  }, [verticalId])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading || !verticalId) return

    if (!overrideText) setInput('')

    const userMsg: GtmMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
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
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, { role: 'assistant', content: `Something went wrong: ${(err as { error?: string }).error ?? res.status}` }])
        return
      }

      const { data: respData } = await res.json() as { data: { reply: string; suggestions: GtmSuggestion[] } }
      const suggestions: GtmSuggestion[] = Array.isArray(respData.suggestions) ? respData.suggestions : []
      const replyContent = (respData.reply ?? '').trim()
      setMessages((prev) => [...prev, { role: 'assistant', content: replyContent, suggestions }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — check your connection and try again.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, verticalId, verticalName, filledSections, emptySections])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const handleSendMessage = useCallback((text: string) => {
    void sendMessage(text)
  }, [sendMessage])

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!open) {
    const lastMsg = [...messages].reverse().find((m) => m.role === 'assistant')
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
        <span className="ml-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[9px] font-medium text-blue-700">
          {verticalName}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {emptySections.length > 0 && (
            <span className="text-[9px] text-muted-foreground">
              {emptySections.length} section{emptySections.length !== 1 ? 's' : ''} to fill
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              title="Clear conversation"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Icons.Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center select-none">
            <Icons.Compass className="h-6 w-6 text-blue-300" />
            <p className="text-xs font-medium text-muted-foreground">I'm your GTM Framework strategist.</p>
            <p className="text-[10px] text-muted-foreground/60 max-w-[240px]">
              I'll use the client brain, vertical knowledge, and GTM best practices to guide you through all 18 sections.
            </p>
            <button
              onClick={() => void sendMessage("Which sections should we focus on first?")}
              className="mt-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-600 hover:bg-blue-100 transition-colors"
            >
              Which sections should we focus on first?
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

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border px-3 py-2 shrink-0">
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
