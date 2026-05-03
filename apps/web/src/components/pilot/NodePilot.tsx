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

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttachedImage {
  base64: string
  mediaType: string
  previewUrl: string
  fileName: string
}

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

// ─── HTML block renderer — splits content on ```html fences ─────────────────

function renderContentWithHtmlBlocks(
  content: string,
  onApplyHtml?: (html: string) => void,
): React.ReactNode {
  const htmlFenceRe = /```html\n([\s\S]*?)```/g
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = htmlFenceRe.exec(content)) !== null) {
    // text before fence
    if (match.index > last) {
      const pre = content.slice(last, match.index)
      parts.push(
        <span key={`t-${last}`}>
          {pre.split('\n').map((line, i, arr) => (
            <span key={i}>{renderBold(line)}{i < arr.length - 1 && <br />}</span>
          ))}
        </span>
      )
    }
    // HTML block
    const html = match[1].trim()
    parts.push(
      <div key={`h-${match.index}`} className="mt-2 mb-1 rounded-lg border border-border bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700">
          <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">HTML</span>
          {onApplyHtml && (
            <button
              onClick={() => onApplyHtml(html)}
              className="flex items-center gap-1 rounded-md bg-primary hover:bg-primary/90 text-white text-[9px] font-semibold px-2 py-0.5 transition-colors"
            >
              <Icons.Check className="h-2.5 w-2.5" />
              Apply to page
            </button>
          )}
        </div>
        <pre className="px-3 py-2 text-[9px] text-zinc-300 font-mono overflow-x-auto max-h-[120px] whitespace-pre-wrap leading-relaxed">
          {html.slice(0, 400)}{html.length > 400 ? '\n…' : ''}
        </pre>
      </div>
    )
    last = match.index + match[0].length
  }

  // trailing text
  if (last < content.length) {
    const tail = content.slice(last)
    parts.push(
      <span key={`t-end`}>
        {tail.split('\n').map((line, i, arr) => (
          <span key={i}>{renderBold(line)}{i < arr.length - 1 && <br />}</span>
        ))}
      </span>
    )
  }

  return parts.length > 0 ? parts : content.split('\n').map((line, i, arr) => (
    <span key={i}>{renderBold(line)}{i < arr.length - 1 && <br />}</span>
  ))
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  role,
  content,
  imagePreview,
  suggestions,
  onChoose,
  onApply,
  onApplyHtml,
}: {
  role: 'user' | 'assistant'
  content: string
  imagePreview?: string
  suggestions?: PilotSuggestion[]
  onChoose?: (s: PilotSuggestion) => void
  onApply?: (s: PilotSuggestion) => void
  onApplyHtml?: (html: string) => void
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
          <Icons.Compass className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        {/* Attached image thumbnail (user messages only) */}
        {imagePreview && (
          <div className="self-end">
            <img src={imagePreview} alt="Attached" className="rounded-lg max-h-[80px] max-w-[140px] object-cover border border-primary/30" />
          </div>
        )}
        <div
          className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
            isUser
              ? 'bg-primary text-white rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          }`}
        >
          {isUser
            ? content.split('\n').map((line, i, arr) => (
                <span key={i}>{renderBold(line)}{i < arr.length - 1 && <br />}</span>
              ))
            : renderContentWithHtmlBlocks(content, onApplyHtml)
          }
        </div>
        {/* Inline suggestion cards */}
        {suggestions && suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            {suggestions.map((s, idx) => (
              <div
                key={s.id}
                className="rounded-xl border border-border bg-background p-3 flex flex-col gap-1.5 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[11px] font-semibold text-foreground leading-snug">
                    <span className="mr-1.5 text-primary/60">{idx + 1}.</span>{s.title}
                  </span>
                  <Icons.Workflow className="h-3 w-3 text-primary/40 shrink-0 mt-0.5" />
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{s.description}</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {s.nodes.slice(0, 5).map((n) => (
                    <span
                      key={n.id}
                      className="rounded-full bg-primary/10 border border-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
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
                    className="flex-1 rounded-md bg-primary hover:bg-primary/90 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    Choose this <Icons.ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onApply?.(s)}
                    className="flex-1 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
                  >
                    Add workflow
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
  const nodeRunStatuses  = useWorkflowStore((s) => s.nodeRunStatuses)

  const setPilotOpen         = useWorkflowStore((s) => s.setPilotOpen)
  const addPilotMessage      = useWorkflowStore((s) => s.addPilotMessage)
  const setPilotSuggestions  = useWorkflowStore((s) => s.setPilotSuggestions)
  const setPilotLoading      = useWorkflowStore((s) => s.setPilotLoading)
  const clearPilot           = useWorkflowStore((s) => s.clearPilot)
  const applyPilotSuggestion = useWorkflowStore((s) => s.applyPilotSuggestion)
  const setNodeRunStatuses   = useWorkflowStore((s) => s.setNodeRunStatuses)

  const [inputValue,    setInputValue]    = useState('')
  const [attachment,    setAttachment]    = useState<AttachedImage | null>(null)
  const scrollRef      = useRef<HTMLDivElement>(null)
  const lastMsgRef     = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)

  // Collect current HTML outputs from html-page nodes
  const htmlOutputs = nodes
    .filter((n) => (n.data.subtype as string) === 'html-page')
    .map((n) => {
      const status = nodeRunStatuses[n.id]
      const html = (status?.output as { html?: string } | undefined)?.html
      return html ? { nodeId: n.id, label: (n.data.label as string) || 'HTML Page', html } : null
    })
    .filter(Boolean) as { nodeId: string; label: string; html: string }[]

  // Apply HTML from pilot response to the matching html-page node output
  const handleApplyHtml = useCallback((html: string) => {
    if (htmlOutputs.length === 0) return
    // Apply to the first HTML page node (most common case)
    const target = htmlOutputs[0]
    setNodeRunStatuses({
      [target.nodeId]: {
        ...(nodeRunStatuses[target.nodeId] ?? { status: 'passed' }),
        output: { html },
      },
    })
  }, [htmlOutputs, nodeRunStatuses, setNodeRunStatuses])

  // Handle image file selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(',')[1]
      setAttachment({
        base64,
        mediaType: file.type,
        previewUrl: dataUrl,
        fileName: file.name,
      })
    }
    reader.readAsDataURL(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [])

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

    const currentAttachment = attachment
    if (!overrideText) {
      setInputValue('')
      setAttachment(null)
    }

    addPilotMessage({ role: 'user', content: text, imagePreview: currentAttachment?.previewUrl })
    setPilotLoading(true)
    setPilotSuggestions([])

    try {
      const history = useWorkflowStore.getState().pilotMessages
      const userMsg: { role: 'user'; content: string; image?: { base64: string; mediaType: string } } = {
        role: 'user',
        content: overrideText ?? text,
        ...(currentAttachment ? { image: { base64: currentAttachment.base64, mediaType: currentAttachment.mediaType } } : {}),
      }

      const res = await apiFetch('/api/v1/nodepilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            userMsg,
          ],
          workflowContext: {
            workflowName: workflow.name ?? undefined,
            clientId:     workflow.clientId,
            clientName:   workflow.clientName,
            nodes: nodes
              .filter((n) => n.type !== 'group')
              .map((n) => ({ subtype: (n.data.subtype as string) ?? n.type, label: n.data.label as string }))
              .slice(0, 20),
            ...(htmlOutputs.length > 0 ? { htmlOutputs } : {}),
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

        <div className="flex items-center gap-1.5 text-primary shrink-0">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">nodePILOT</span>
        </div>

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {lastMsg ? lastMsg.content.replace(/\n/g, ' ').slice(0, 90) : 'Ask me to build a workflow…'}
        </span>

        <span className="text-[10px] text-primary/60 font-medium shrink-0 select-none">
          Click to open ↑
        </span>
      </div>
    )
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: '70vh' }}
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
        <div className="flex items-center gap-1.5 text-primary">
          <Icons.Compass className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">nodePILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI workflow co-pilot</span>
        {workflow.clientName && (
          <span className="ml-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[9px] font-medium text-primary">
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
            <Icons.Compass className="h-6 w-6 text-primary/30" />
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
              imagePreview={msg.imagePreview}
              suggestions={msg.suggestions}
              onChoose={handleChoose}
              onApply={handleApply}
              onApplyHtml={msg.role === 'assistant' ? handleApplyHtml : undefined}
            />
          </div>
        ))}
        {pilotLoading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
              <Icons.Compass className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Attachment preview */}
      {attachment && (
        <div className="flex items-center gap-2 border-t border-border px-3 pt-2 shrink-0">
          <img src={attachment.previewUrl} alt="Attachment" className="h-10 w-10 rounded-md object-cover border border-border" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-foreground truncate">{attachment.fileName}</p>
            <p className="text-[9px] text-muted-foreground">Image attached</p>
          </div>
          <button onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-end gap-2 border-t border-border px-3 py-2 shrink-0">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        {/* Attach image button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach image for visual reference"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
            attachment
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/30 hover:text-primary'
          }`}
        >
          <Icons.Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={attachment ? 'Describe the style changes…' : 'What do you want to build? (Shift+Enter for new line)'}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[32px] max-h-[80px] overflow-y-auto"
          style={{ lineHeight: '1.4' }}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={(!inputValue.trim() && !attachment) || pilotLoading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Icons.SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
