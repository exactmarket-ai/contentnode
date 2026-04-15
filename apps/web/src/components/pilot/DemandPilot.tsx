/**
 * DemandPilot.tsx
 *
 * demandPILOT — AI demand gen strategist anchored to the bottom of the Demand Gen tab.
 * Expands to 40% of the viewport height.
 * Accesses client brain → organization brain → industry standards.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DpSuggestion {
  id: string
  title: string
  description: string
  sectionNum: string   // e.g. "B1", "01"
  sectionKey: string   // e.g. "b1", "s1"
  action: 'fill' | 'navigate'
}

interface DpMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: DpSuggestion[]
}

export interface DemandPilotProps {
  clientId: string
  selectedVertical: { id: string; name: string } | null
  data: Record<string, unknown> | null
  filledSections: string[]
  emptySections: string[]
  onApplySection: (sectionKey: string, filled: Record<string, unknown>) => void
  onScrollToSection: (sectionNum: string) => void
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
  '00': 'Feed the Brain', B1: 'Revenue & Goals', B2: 'Sales Process',
  B3: 'Budget & Resources', '01': 'Current Reality', '02': 'Offer Clarity',
  '03': 'ICP + Psychology', '04': 'Revenue Goals', '05': 'Sales Alignment',
  '06': 'Hidden Gold', '07': 'External Intel',
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  clientId,
  selectedVertical,
  sectionData,
  onApplySection,
  onScrollToSection,
  onSendMessage,
}: {
  suggestion: DpSuggestion
  clientId: string
  selectedVertical: { id: string; name: string } | null
  sectionData: Record<string, unknown> | null
  onApplySection: (key: string, data: Record<string, unknown>) => void
  onScrollToSection: (num: string) => void
  onSendMessage: (text: string) => void
}) {
  const [filling, setFilling] = useState(false)
  const [filled, setFilled] = useState(false)

  const handleFill = async () => {
    setFilling(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/demand-gen/ai-fill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          section: suggestion.sectionKey,
          current: sectionData ?? {},
          verticalId: selectedVertical?.id,
          verticalName: selectedVertical?.name,
        }),
      })
      if (!res.ok) return
      const { data } = await res.json() as { data: { suggestion: Record<string, unknown> } }
      if (!data?.suggestion) return
      onApplySection(suggestion.sectionKey, data.suggestion)
      setFilled(true)
      onSendMessage(
        `I just filled in "${SECTION_LABELS[suggestion.sectionNum] ?? suggestion.title}". What should we work on next?`
      )
    } catch { /* ignore */ } finally {
      setFilling(false)
    }
  }

  const handleNavigate = () => {
    onScrollToSection(suggestion.sectionNum)
    onSendMessage(`I'm looking at the "${SECTION_LABELS[suggestion.sectionNum] ?? suggestion.title}" section now. What should I focus on?`)
  }

  return (
    <div className={cn(
      'rounded-xl border p-3 flex flex-col gap-1.5 transition-colors',
      filled
        ? 'border-green-200 bg-green-50/50'
        : 'border-border bg-background hover:border-orange-300',
    )}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-semibold text-foreground leading-snug">
          <span className="mr-1.5 inline-flex items-center justify-center rounded bg-orange-100 px-1 py-0.5 text-[9px] font-bold text-orange-600">
            {suggestion.sectionNum}
          </span>
          {suggestion.title}
        </span>
        {filled
          ? <Icons.CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
          : <Icons.Sparkles className="h-3 w-3 text-orange-400 shrink-0 mt-0.5" />
        }
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{suggestion.description}</p>
      {!filled && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {suggestion.action === 'fill' && (
            <button
              onClick={handleFill}
              disabled={filling}
              className="flex-1 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {filling
                ? <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Filling…</>
                : <><Icons.Sparkles className="h-3 w-3" /> Fill with AI</>
              }
            </button>
          )}
          <button
            onClick={handleNavigate}
            className="flex-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-foreground text-[10px] font-medium py-1.5 transition-colors flex items-center justify-center gap-1"
          >
            Go there <Icons.ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
      {filled && (
        <p className="text-[10px] text-green-600 font-medium">Section filled ✓</p>
      )}
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  clientId,
  selectedVertical,
  sectionData,
  onApplySection,
  onScrollToSection,
  onSendMessage,
}: {
  msg: DpMessage
  clientId: string
  selectedVertical: { id: string; name: string } | null
  sectionData: Record<string, unknown> | null
  onApplySection: (key: string, data: Record<string, unknown>) => void
  onScrollToSection: (num: string) => void
  onSendMessage: (text: string) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 mt-0.5">
          <Icons.TrendingUp className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        <div
          className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
            isUser
              ? 'bg-orange-500 text-white rounded-tr-sm'
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
                clientId={clientId}
                selectedVertical={selectedVertical}
                sectionData={sectionData ? (sectionData[s.sectionKey] as Record<string, unknown>) : null}
                onApplySection={onApplySection}
                onScrollToSection={onScrollToSection}
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

export function DemandPilot({
  clientId,
  selectedVertical,
  data,
  filledSections,
  emptySections,
  onApplySection,
  onScrollToSection,
}: DemandPilotProps) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<DpMessage[]>([])
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

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    if (!overrideText) setInput('')

    const userMsg: DpMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
      const res = await apiFetch('/api/v1/demand-pilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          verticalId: selectedVertical?.id ?? null,
          verticalName: selectedVertical?.name ?? null,
          level: selectedVertical ? selectedVertical.name : 'Company',
          filledSections,
          emptySections,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, { role: 'assistant', content: `Something went wrong: ${(err as {error?: string}).error ?? res.status}` }])
        return
      }

      const { data: respData } = await res.json() as { data: { reply: string; suggestions: DpSuggestion[] } }
      const suggestions: DpSuggestion[] = Array.isArray(respData.suggestions) ? respData.suggestions : []
      const replyContent = (respData.reply ?? '').trim()
      setMessages((prev) => [...prev, { role: 'assistant', content: replyContent, suggestions }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — check your connection and try again.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, selectedVertical, filledSections, emptySections])

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
          title="Open demandPILOT"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
        >
          <Icons.ChevronUp className="h-2 w-2 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1.5 text-orange-600 shrink-0">
          <Icons.TrendingUp className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">demandPILOT</span>
        </div>

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {lastMsg
            ? lastMsg.content.replace(/\n/g, ' ').slice(0, 90)
            : 'Ask me to help fill in your demand gen form…'
          }
        </span>

        <span className="text-[10px] text-orange-500 font-medium shrink-0 select-none">
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
        title="Collapse demandPILOT"
        className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
      >
        <Icons.ChevronDown className="h-2 w-2 text-muted-foreground" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1.5 text-orange-600">
          <Icons.TrendingUp className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">demandPILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI demand gen strategist</span>
        {selectedVertical && (
          <span className="ml-1 rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-[9px] font-medium text-orange-700">
            {selectedVertical.name}
          </span>
        )}
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
            <Icons.TrendingUp className="h-6 w-6 text-orange-300" />
            <p className="text-xs font-medium text-muted-foreground">I'm your demand gen strategist.</p>
            <p className="text-[10px] text-muted-foreground/60 max-w-[240px]">
              I'll access your client brain, vertical knowledge, and industry standards to help you complete every section.
            </p>
            <button
              onClick={() => void sendMessage("What should we fill in first?")}
              className="mt-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] font-medium text-orange-600 hover:bg-orange-100 transition-colors"
            >
              What should we fill in first?
            </button>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
            <MessageBubble
              msg={msg}
              clientId={clientId}
              selectedVertical={selectedVertical}
              sectionData={data}
              onApplySection={onApplySection}
              onScrollToSection={onScrollToSection}
              onSendMessage={handleSendMessage}
            />
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500">
              <Icons.TrendingUp className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:300ms]" />
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
          placeholder="Ask me anything about this client's demand gen… (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-orange-400 min-h-[32px] max-h-[80px] overflow-y-auto"
          style={{ lineHeight: '1.4' }}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={!input.trim() || loading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Icons.SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
