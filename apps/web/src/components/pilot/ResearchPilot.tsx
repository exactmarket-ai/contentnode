/**
 * ResearchPilot.tsx
 *
 * researchPILOT — AI research strategist for Market Positioning & Competitive Assessments.
 * Right-side panel with chat interface, anchored to researchNODE page.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResearchMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ResearchPilotProps {
  onClose: () => void
  prospectName?: string | null
  prospectUrl?: string | null
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

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ResearchMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 mt-0.5">
          <Icons.Radar className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[88%] rounded-xl px-3 py-2 text-[12px] leading-relaxed',
          isUser
            ? 'bg-violet-600 text-white rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm',
        )}
      >
        {msg.content.split('\n').map((line, i, arr) => (
          <span key={i}>
            {renderBold(line)}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Starter prompts ──────────────────────────────────────────────────────────

const STARTERS = [
  "How do I score Dimension 1 — Website & Messaging?",
  "What should I look for in a prospect's competitive landscape?",
  "Help me interpret a score of 2.5 on positioning.",
  "Which dimensions matter most for a SaaS company?",
]

// ─── Main component ───────────────────────────────────────────────────────────

export function ResearchPilot({ onClose, prospectName, prospectUrl }: ResearchPilotProps) {
  const [messages, setMessages] = useState<ResearchMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [input, setInput]       = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    if (!overrideText) setInput('')

    const userMsg: ResearchMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
      const res = await apiFetch('/api/v1/research-pilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages:     history.map((m) => ({ role: m.role, content: m.content })),
          prospectName: prospectName ?? null,
          prospectUrl:  prospectUrl  ?? null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Something went wrong: ${(err as { error?: string }).error ?? res.status}` },
        ])
        return
      }

      const { data } = await res.json() as { data: { reply: string } }
      setMessages((prev) => [...prev, { role: 'assistant', content: (data?.reply ?? '').trim() }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Network error — check your connection and try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, prospectName, prospectUrl])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600">
            <Icons.Radar className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold leading-none">researchPILOT</p>
            {prospectName && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[160px]">{prospectName}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                <Icons.Radar className="h-5 w-5 text-violet-600" />
              </div>
              <p className="text-xs font-medium text-foreground">researchPILOT</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[200px]">
                Ask me anything about running assessments, scoring dimensions, or interpreting findings.
              </p>
            </div>
            <div className="space-y-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => void sendMessage(s)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-[11px] text-muted-foreground hover:border-violet-300 hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600">
              <Icons.Radar className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="rounded-xl rounded-tl-sm bg-muted px-3 py-2">
              <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-violet-400 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask researchPILOT…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none leading-relaxed max-h-[120px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icons.ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground text-center">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
