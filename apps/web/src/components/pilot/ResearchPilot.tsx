/**
 * ResearchPilot.tsx
 *
 * researchPILOT — bottom-anchored chat panel, same pattern as GTMPilot.
 * Collapses to a 44px bar, expands to 40vh.
 * Supports .docx and .pdf attachments — extracted server-side and injected into the message.
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

interface Attachment {
  filename: string
  text: string
  charCount: number
  truncated: boolean
}

export interface ResearchPilotProps {
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

  // Strip the document block from the displayed user message — show just the question
  const displayContent = isUser
    ? msg.content.replace(/^\[Attached document:.*?\n\n[\s\S]*?\n---\n\n/m, '').trim() || msg.content
    : msg.content

  // Check if message had an attachment
  const hasAttachment = isUser && /^\[Attached document:/.test(msg.content)
  const attachedName  = hasAttachment
    ? msg.content.match(/^\[Attached document: (.+?)\]/)?.[1] ?? 'file'
    : null

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 mt-0.5">
          <Icons.Radar className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className={cn('max-w-[80%] space-y-1.5', isUser ? 'items-end flex flex-col' : '')}>
        {attachedName && (
          <div className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 self-end">
            <Icons.FileText className="h-3 w-3 text-violet-600 shrink-0" />
            <span className="text-[10px] font-medium text-violet-700 max-w-[180px] truncate">{attachedName}</span>
          </div>
        )}
        <div
          className={cn(
            'rounded-xl px-3 py-2 text-[12px] leading-relaxed',
            isUser
              ? 'bg-violet-600 text-white rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm',
          )}
        >
          {displayContent.split('\n').map((line, i, arr) => (
            <span key={i}>
              {renderBold(line)}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResearchPilot({ prospectName, prospectUrl }: ResearchPilotProps) {
  const [open,       setOpen]       = useState(false)
  const [messages,   setMessages]   = useState<ResearchMessage[]>([])
  const [loading,    setLoading]    = useState(false)
  const [input,      setInput]      = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [uploading,  setUploading]  = useState(false)
  const [uploadErr,  setUploadErr]  = useState<string | null>(null)

  const scrollRef       = useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLTextAreaElement>(null)
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const newAssistantRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  useEffect(() => {
    if (loading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [loading])

  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    if (!loading && lastMsg?.role === 'assistant' && messages.length > prevMsgCountRef.current) {
      newAssistantRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    prevMsgCountRef.current = messages.length
  }, [messages, loading])

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset so same file can be re-selected

    setUploading(true)
    setUploadErr(null)
    setAttachment(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await apiFetch('/api/v1/research-pilot/upload', {
        method: 'POST',
        body:   formData,
        // Don't set Content-Type — browser sets multipart/form-data with boundary automatically
      })
      const json = await res.json()
      if (!res.ok) {
        setUploadErr(json?.error ?? 'Upload failed')
        return
      }
      setAttachment(json.data as Attachment)
      inputRef.current?.focus()
    } catch {
      setUploadErr('Upload failed — check your connection')
    } finally {
      setUploading(false)
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if ((!text && !attachment) || loading) return
    if (!overrideText) setInput('')

    // Build the message content — prepend document text if attached
    let content = text
    if (attachment) {
      const docBlock = `[Attached document: ${attachment.filename}]\n\n${attachment.text}${attachment.truncated ? '\n…[document truncated at 20,000 characters]' : ''}\n\n---\n\n`
      content = docBlock + (text || 'Please read this document and extract any signals relevant to the prospect assessment.')
      setAttachment(null)
    }

    const userMsg: ResearchMessage = { role: 'user', content }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
      const trimmedHistory = history.map((m, i) => {
        const isRecent = i >= history.length - 4
        if (isRecent || m.role === 'user' || m.content.length <= 2000) return m
        return { ...m, content: m.content.slice(0, 2000) + '\n…[truncated for context]' }
      })

      const res = await apiFetch('/api/v1/research-pilot/chat', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          messages:     trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
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
  }, [input, attachment, loading, messages, prospectName, prospectUrl])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const canSend = (input.trim().length > 0 || attachment !== null) && !loading

  // ── Collapsed bar ───────────────────────────────────────────────────────────
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
          title="Open researchPILOT"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
        >
          <Icons.ChevronUp className="h-2 w-2 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1.5 text-violet-600 shrink-0">
          <Icons.Radar className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">researchPILOT</span>
        </div>

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {lastMsg
            ? lastMsg.content.replace(/\n/g, ' ').slice(0, 100)
            : prospectName
              ? `Ask me about assessing ${prospectName}…`
              : 'Ask me about the assessment framework, scoring, or interpreting findings…'
          }
        </span>

        <span className="text-[10px] text-violet-500 font-medium shrink-0 select-none">
          Click to open ↑
        </span>
      </div>
    )
  }

  // ── Expanded panel — 40vh ───────────────────────────────────────────────────
  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: '40vh' }}
    >
      {/* Collapse handle */}
      <button
        onClick={() => setOpen(false)}
        title="Collapse researchPILOT"
        className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
      >
        <Icons.ChevronDown className="h-2 w-2 text-muted-foreground" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1.5 text-violet-600">
          <Icons.Radar className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">researchPILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI research strategist</span>
        {prospectName && (
          <span className="ml-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[9px] font-medium text-violet-700">
            {prospectName}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
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
            <Icons.Radar className="h-6 w-6 text-violet-300" />
            <p className="text-xs font-medium text-muted-foreground">I'm your research strategist.</p>
            <p className="text-[10px] text-muted-foreground/60 max-w-[260px]">
              Ask me how to score any dimension, interpret findings, or attach a document for analysis.
            </p>
            <button
              onClick={() => void sendMessage('How do I get started with a prospect assessment?')}
              className="mt-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-600 hover:bg-violet-100 transition-colors"
            >
              How do I get started with a prospect assessment?
            </button>
          </div>
        )}
        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1
          return (
            <div key={i} ref={isLastAssistant ? newAssistantRef : null}>
              <MessageBubble msg={msg} />
            </div>
          )
        })}
        {loading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600">
              <Icons.Radar className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0 space-y-2">

        {/* Attachment chip */}
        {attachment && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5">
            <Icons.FileText className="h-3.5 w-3.5 text-violet-600 shrink-0" />
            <span className="text-[11px] font-medium text-violet-700 flex-1 truncate">{attachment.filename}</span>
            <span className="text-[10px] text-violet-500 shrink-0">
              {(attachment.charCount / 1000).toFixed(1)}k chars{attachment.truncated ? ' (truncated)' : ''}
            </span>
            <button
              onClick={() => setAttachment(null)}
              className="text-violet-400 hover:text-violet-700 transition-colors shrink-0"
              title="Remove attachment"
            >
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Upload error */}
        {uploadErr && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
            <Icons.AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
            <span className="text-[11px] text-red-700 flex-1">{uploadErr}</span>
            <button onClick={() => setUploadErr(null)} className="text-red-400 hover:text-red-600 shrink-0">
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-violet-400 transition-colors">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />

          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || loading}
            title="Attach .docx or .pdf"
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
              uploading
                ? 'text-violet-400 cursor-wait'
                : 'text-muted-foreground hover:text-violet-600 hover:bg-violet-50',
            )}
          >
            {uploading
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Icons.Paperclip className="h-3.5 w-3.5" />
            }
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachment ? 'Add a question, or send to analyse the document…' : 'Ask researchPILOT… (Enter to send)'}
            rows={1}
            className="flex-1 resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none leading-relaxed max-h-[80px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />

          <button
            onClick={() => void sendMessage()}
            disabled={!canSend}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icons.ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
