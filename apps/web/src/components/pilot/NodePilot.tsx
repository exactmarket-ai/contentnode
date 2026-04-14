/**
 * NodePilot.tsx
 *
 * nodePILOT — AI co-pilot panel anchored to the bottom of the workflow canvas.
 * Starts expanded. Collapses to a thin status bar.
 * Uses the same edge-handle pattern as the Node Config panel.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore, type PilotSuggestion } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

// ─── Inline bold renderer — converts **text** → <b>text</b> ─────────────────

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

function MessageBubble({
  role,
  content,
  suggestions,
  onChoose,
  onApply,
}: {
  role: 'user' | 'assistant'
  content: string
  suggestions?: PilotSuggestion[]
  onChoose?: (s: PilotSuggestion) => void
  onApply?: (s: PilotSuggestion) => void
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 mt-0.5">
          <Icons.Compass className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        <div
          className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
            isUser
              ? 'bg-violet-600 text-white rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          }`}
        >
          {content.split('\n').map((line, i, arr) => (
            <span key={i}>
              {renderBold(line)}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </div>
        {/* Inline suggestion cards */}
        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            {suggestions.map((s, idx) => (
              <div
                key={s.id}
                className="rounded-xl border border-border bg-background p-3 flex flex-col gap-1.5 hover:border-violet-400 transition-colors"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[11px] font-semibold text-foreground leading-snug">
                    <span className="mr-1.5 text-violet-500">{idx + 1}.</span>{s.title}
                  </span>
                  <Icons.Workflow className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" />
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{s.description}</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {s.nodes.slice(0, 5).map((n) => (
                    <span
                      key={n.id}
                      className="rounded-full bg-violet-50 border border-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700"
                    >
                      {n.label}
                    </span>
                  ))}
                  {s.nodes.length > 5 && (
                    <span className="text-[9px] text-muted-foreground">+{s.nodes.length - 5}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    onClick={() => onChoose?.(s)}
                    className="flex-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    Choose this <Icons.ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onApply?.(s)}
                    className="flex-1 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    Add to Canvas
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NodePilot() {
  const pilotOpen        = useWorkflowStore((s) => s.pilotOpen)
  const pilotMessages    = useWorkflowStore((s) => s.pilotMessages)
  const pilotLoading     = useWorkflowStore((s) => s.pilotLoading)
  const workflow         = useWorkflowStore((s) => s.workflow)
  const nodes            = useWorkflowStore((s) => s.nodes)

  const setPilotOpen         = useWorkflowStore((s) => s.setPilotOpen)
  const addPilotMessage      = useWorkflowStore((s) => s.addPilotMessage)
  const setPilotSuggestions  = useWorkflowStore((s) => s.setPilotSuggestions)
  const setPilotLoading      = useWorkflowStore((s) => s.setPilotLoading)
  const clearPilot           = useWorkflowStore((s) => s.clearPilot)
  const applyPilotSuggestion = useWorkflowStore((s) => s.applyPilotSuggestion)

  const [inputValue, setInputValue] = useState('')
  const scrollRef      = useRef<HTMLDivElement>(null)
  const lastMsgRef     = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  // Scroll the TOP of the last message into view so text is always readable
  // before the suggestion cards below it
  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [pilotMessages, pilotLoading])

  // Focus input when panel opens
  useEffect(() => {
    if (pilotOpen) setTimeout(() => inputRef.current?.focus(), 80)
  }, [pilotOpen])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputValue).trim()
    if (!text || pilotLoading) return

    if (!overrideText) setInputValue('')
    addPilotMessage({ role: 'user', content: text })
    setPilotLoading(true)
    setPilotSuggestions([])

    try {
      const history = useWorkflowStore.getState().pilotMessages
      const res = await apiFetch('/api/v1/nodepilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: overrideText ?? text },
          ],
          workflowContext: {
            workflowName: workflow.name ?? undefined,
            clientId:     workflow.clientId,
            clientName:   workflow.clientName,
            nodes: nodes
              .filter((n) => n.type !== 'group')
              .map((n) => ({ subtype: (n.data.subtype as string) ?? n.type, label: n.data.label as string }))
              .slice(0, 20),
          },
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        addPilotMessage({ role: 'assistant', content: `Something went wrong: ${err.error ?? res.status}` })
        return
      }

      const { data } = await res.json()
      const suggestions: PilotSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : []

      // Strip any leaked <NODEPILOT_SUGGESTIONS> block the server didn't catch
      // Second replace handles truncated blocks missing the closing tag
      const replyContent = (data.reply ?? '')
        .replace(/<NODEPILOT_SUGGESTIONS>[\s\S]*?<\/NODEPILOT_SUGGESTIONS>/gi, '')
        .replace(/<NODEPILOT_SUGGESTIONS>[\s\S]*/gi, '')
        .trim()

      addPilotMessage({ role: 'assistant', content: replyContent, suggestions })
      setPilotSuggestions(suggestions)
    } catch {
      addPilotMessage({ role: 'assistant', content: 'Network error — check your connection and try again.' })
    } finally {
      setPilotLoading(false)
    }
  }, [inputValue, pilotLoading, workflow, nodes, addPilotMessage, setPilotLoading, setPilotSuggestions])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  // "Choose this →" — sends the selection as a message, triggering drill-down questions
  const handleChoose = useCallback((suggestion: PilotSuggestion) => {
    void sendMessage(`I'd like to go with: ${suggestion.title}`)
  }, [sendMessage])

  // "Add to canvas" — applies the workflow then asks what needs to be done manually
  const handleApply = useCallback((suggestion: PilotSuggestion) => {
    applyPilotSuggestion(suggestion)
    setPilotSuggestions([])
    void sendMessage(`I just added "${suggestion.title}" to the canvas. What do I need to set up manually before I can run it?`)
  }, [applyPilotSuggestion, setPilotSuggestions, sendMessage])

  // ── Collapsed status bar ───────────────────────────────────────────────────
  if (!pilotOpen) {
    const lastMsg = [...pilotMessages].reverse().find((m) => m.role === 'assistant')
    return (
      <div
        className="relative flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 cursor-pointer hover:bg-muted/40 transition-colors"
        style={{ height: 44 }}
        onClick={() => setPilotOpen(true)}
      >
        {/* Top-edge expand handle — same pattern as Node Config panel */}
        <button
          onClick={(e) => { e.stopPropagation(); setPilotOpen(true) }}
          title="Open nodePILOT"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
        >
          <Icons.ChevronUp className="h-2 w-2 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1.5 text-violet-700 shrink-0">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">nodePILOT</span>
        </div>

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {lastMsg ? lastMsg.content.replace(/\n/g, ' ').slice(0, 90) : 'Ask me to build a workflow…'}
        </span>

        <span className="text-[10px] text-violet-500 font-medium shrink-0 select-none">
          Click to open ↑
        </span>
      </div>
    )
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: '50vh' }}
    >
      {/* Top-edge collapse handle — same pattern as Node Config panel */}
      <button
        onClick={() => setPilotOpen(false)}
        title="Collapse nodePILOT"
        className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
      >
        <Icons.ChevronDown className="h-2 w-2 text-muted-foreground" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1.5 text-violet-700">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">nodePILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI workflow co-pilot</span>
        {workflow.clientName && (
          <span className="ml-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[9px] font-medium text-violet-700">
            {workflow.clientName}
          </span>
        )}
        {pilotMessages.length > 0 && (
          <button
            onClick={clearPilot}
            title="Clear conversation"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Icons.Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 min-h-0">
        {pilotMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center select-none">
            <Icons.Compass className="h-6 w-6 text-violet-300" />
            <p className="text-xs font-medium text-muted-foreground">Tell me what you want to build.</p>
            <p className="text-[10px] text-muted-foreground/60">
              I'll suggest 2–3 workflow options and add nodes for you.
            </p>
          </div>
        )}
        {pilotMessages.map((msg, i) => (
          <div key={i} ref={i === pilotMessages.length - 1 ? lastMsgRef : undefined}>
            <MessageBubble
              role={msg.role}
              content={msg.content}
              suggestions={msg.suggestions}
              onChoose={handleChoose}
              onApply={handleApply}
            />
          </div>
        ))}
        {pilotLoading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600">
              <Icons.Compass className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex items-end gap-2 border-t border-border px-3 py-2 shrink-0">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to build? (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-violet-500 min-h-[32px] max-h-[80px] overflow-y-auto"
          style={{ lineHeight: '1.4' }}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={!inputValue.trim() || pilotLoading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Icons.SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
