/**
 * ProductPilot.tsx
 *
 * productPILOT — AI Product Marketing skill guide.
 * Opens as a modal chat, guided by multi-directional questioning.
 * Produces a synthesis stored in the client Brain.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillSuggestion {
  key: string
  categoryKey: string
  name: string
  reason: string
}

interface PilotMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: SkillSuggestion[]
  synthesis?: string
}

interface SessionTemplate {
  id: string
  name: string
  skillKey: string
  categoryKey: string
  useCount: number
}

export interface ProductPilotProps {
  clientId: string
  clientName: string
  categoryKey: string
  skillKey: string
  skillName: string
  verticalId?: string | null
  onClose: () => void
  onSkillSuggestionClick: (categoryKey: string, skillKey: string) => void
  onSynthesisSaved?: (skillKey: string) => void
}

// ─── Bold renderer ────────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b>
      : part,
  )
}

function renderContent(text: string): React.ReactNode {
  return text.split('\n').map((line, i, arr) => (
    <span key={i}>
      {renderInline(line)}
      {i < arr.length - 1 && <br />}
    </span>
  ))
}

// ─── Synthesis block ──────────────────────────────────────────────────────────

function SynthesisBlock({
  content,
  clientId,
  categoryKey,
  skillKey,
  onSaved,
  onSaveTemplate,
}: {
  content: string
  clientId: string
  categoryKey: string
  skillKey: string
  onSaved?: () => void
  onSaveTemplate?: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [copied, setCopied] = useState(false)

  const download = (ext: 'md' | 'txt') => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${skillKey}-synthesis.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/productpilot/save-synthesis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, categoryKey, skillKey, synthesis: content }),
      })
      if (res.ok) {
        setSaved(true)
        onSaved?.()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] font-semibold text-emerald-800">Session complete — synthesis ready</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              navigator.clipboard.writeText(content)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            {copied ? <><Icons.Check className="h-3 w-3" /> Copied</> : <><Icons.Copy className="h-3 w-3" /> Copy</>}
          </button>
          <button
            onClick={() => download('md')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <Icons.Download className="h-3 w-3" /> .md
          </button>
          <button
            onClick={() => download('txt')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <Icons.Download className="h-3 w-3" /> .txt
          </button>
          {saved ? (
            <span className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-100">
              <Icons.Brain className="h-3 w-3" /> Saved to Brain
            </span>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <Icons.Brain className="h-3 w-3" />
              {saving ? 'Saving…' : 'Save to Brain'}
            </button>
          )}
          {onSaveTemplate && (
            <button
              onClick={onSaveTemplate}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors border border-emerald-200"
            >
              <Icons.BookmarkPlus className="h-3 w-3" /> Save path as template
            </button>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-white p-3 max-h-48 overflow-y-auto">
        <pre className="text-[11px] text-foreground whitespace-pre-wrap font-sans leading-relaxed">{content}</pre>
      </div>
    </div>
  )
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SkillSuggestionCard({
  suggestion,
  onSelect,
}: {
  suggestion: SkillSuggestion
  onSelect: (categoryKey: string, skillKey: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3 space-y-1.5 hover:border-purple-300 transition-colors">
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-semibold text-foreground leading-snug">{suggestion.name}</span>
        <Icons.ArrowRight className="h-3 w-3 text-purple-400 shrink-0 mt-0.5" />
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{suggestion.reason}</p>
      <button
        onClick={() => onSelect(suggestion.categoryKey, suggestion.key)}
        className="w-full rounded-md text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
        style={{ backgroundColor: '#a200ee' }}
      >
        Start this skill <Icons.ArrowRight className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  clientId,
  categoryKey,
  skillKey,
  onSkillSuggestionClick,
  onSynthesisSaved,
  onSaveTemplate,
}: {
  msg: PilotMessage
  clientId: string
  categoryKey: string
  skillKey: string
  onSkillSuggestionClick: (categoryKey: string, skillKey: string) => void
  onSynthesisSaved?: () => void
  onSaveTemplate?: () => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5" style={{ backgroundColor: '#a200ee' }}>
          <Icons.Zap className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        {msg.content && (
          <div
            className={cn(
              'rounded-xl px-3 py-2 text-[12px] leading-relaxed',
              isUser
                ? 'text-white rounded-tr-sm'
                : 'bg-zinc-100 text-foreground rounded-tl-sm',
            )}
            style={isUser ? { backgroundColor: '#a200ee' } : {}}
          >
            {renderContent(msg.content)}
          </div>
        )}
        {msg.synthesis && (
          <SynthesisBlock
            content={msg.synthesis}
            clientId={clientId}
            categoryKey={categoryKey}
            skillKey={skillKey}
            onSaved={onSynthesisSaved}
            onSaveTemplate={onSaveTemplate}
          />
        )}
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            {msg.suggestions.map((s) => (
              <SkillSuggestionCard
                key={`${s.categoryKey}/${s.key}`}
                suggestion={s}
                onSelect={onSkillSuggestionClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Starter prompts ──────────────────────────────────────────────────────────

const STARTERS: Record<string, string[]> = {
  'product-vision':       ["Let's build our product vision", "What makes a great vision for our stage?"],
  'value-proposition':    ["Help me define our value proposition", "Who is our customer really?"],
  'competitive-battlecard': ["Let's map our competitive position", "What do we win on and lose on?"],
  'ideal-customer-profile': ["Help me define our ICP", "Who is our best customer type?"],
  'gtm-strategy':         ["Let's build our GTM strategy", "What channels should we focus on?"],
  'pricing-strategy':     ["Help me think through pricing", "Are we priced correctly for our market?"],
  'north-star-metric':    ["Help me define our North Star", "What metric should drive everything?"],
}

function getStarters(skillKey: string): string[] {
  return STARTERS[skillKey] ?? ["Let's get started", "What should I know before we begin?"]
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProductPilot({
  clientId,
  clientName,
  categoryKey,
  skillKey,
  skillName,
  verticalId,
  onClose,
  onSkillSuggestionClick,
  onSynthesisSaved,
}: ProductPilotProps) {
  const [messages, setMessages] = useState<PilotMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [input, setInput]       = useState('')
  const [synthesisDone, setSynthesisDone] = useState(false)

  // Templates
  const [templates, setTemplates]           = useState<SessionTemplate[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  // Save-template modal
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName]         = useState('')
  const [savingTemplate, setSavingTemplate]     = useState(false)
  const [templateSaved, setTemplateSaved]       = useState(false)

  const lastMsgRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, loading])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  useEffect(() => {
    apiFetch(`/api/v1/productpilot/session-templates?skillKey=${encodeURIComponent(skillKey)}`)
      .then((r) => r.json())
      .then((body: { data: SessionTemplate[] }) => setTemplates(body.data ?? []))
      .catch(() => {/* non-fatal */})
  }, [skillKey])

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || savingTemplate) return
    setSavingTemplate(true)
    try {
      const res = await apiFetch('/api/v1/productpilot/save-session-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillKey,
          categoryKey,
          name: templateName.trim(),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      if (res.ok) {
        const { data } = await res.json() as { data: SessionTemplate }
        setTemplates((prev) => [data, ...prev])
        setTemplateSaved(true)
        setTimeout(() => setShowSaveTemplate(false), 1200)
      }
    } finally {
      setSavingTemplate(false)
    }
  }

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    if (!overrideText) setInput('')

    const userMsg: PilotMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
      const res = await apiFetch('/api/v1/productpilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages:    history.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          categoryKey,
          skillKey,
          ...(activeTemplateId ? { templateId: activeTemplateId } : {}),
          ...(verticalId ? { verticalId } : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${(err as { error?: string }).error ?? res.status}` }])
        return
      }

      const { data } = await res.json() as {
        data: { reply: string; suggestions: SkillSuggestion[]; synthesis: string | null }
      }

      const assistantMsg: PilotMessage = {
        role:        'assistant',
        content:     data.reply ?? '',
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        synthesis:   data.synthesis ?? undefined,
      }
      setMessages((prev) => [...prev, assistantMsg])
      if (data.synthesis) setSynthesisDone(true)
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — check your connection.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, categoryKey, skillKey, activeTemplateId, verticalId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  const starters = getStarters(skillKey)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" style={{ height: '80vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: '#a200ee' }}>
            <Icons.Zap className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wide" style={{ color: '#a200ee' }}>productPILOT</span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[11px] font-medium text-foreground truncate">{skillName}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Client: {clientName}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setSynthesisDone(false) }}
                title="Clear conversation"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Icons.Trash2 className="h-3.5 w-3.5" />
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

        {/* Messages */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center select-none">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: '#f3e8ff' }}>
                <Icons.Zap className="h-5 w-5" style={{ color: '#a200ee' }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Ready to run: {skillName}</p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px]">
                  I'll ask multi-directional questions to help you think through every dimension — and surface things you might have missed.
                </p>
              </div>

              {/* Saved templates */}
              {templates.length > 0 && (
                <div className="w-full max-w-xs">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 text-left">
                    Saved paths
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setActiveTemplateId((prev) => prev === t.id ? null : t.id)}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors',
                          activeTemplateId === t.id
                            ? 'border-purple-400 bg-purple-50 text-purple-900'
                            : 'border-border bg-zinc-50 text-foreground hover:border-purple-300 hover:bg-purple-50',
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Icons.Bookmark className={cn('h-3 w-3 shrink-0', activeTemplateId === t.id ? 'text-purple-600' : 'text-muted-foreground')} />
                          <span className="font-medium truncate">{t.name}</span>
                        </div>
                        {activeTemplateId === t.id && (
                          <span className="text-[10px] font-semibold text-purple-600 shrink-0">Active</span>
                        )}
                        {t.useCount > 0 && activeTemplateId !== t.id && (
                          <span className="text-[10px] text-muted-foreground shrink-0">×{t.useCount}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {activeTemplateId && (
                    <p className="text-[10px] text-purple-600 mt-1.5">
                      Claude will follow this path — adapting to your answers.
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 w-full max-w-xs">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => void sendMessage(s)}
                    className="rounded-xl border border-border bg-zinc-50 px-4 py-2.5 text-[11px] font-medium text-foreground hover:border-purple-300 hover:bg-purple-50 transition-colors text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
              <MessageBubble
                msg={msg}
                clientId={clientId}
                categoryKey={categoryKey}
                skillKey={skillKey}
                onSkillSuggestionClick={onSkillSuggestionClick}
                onSynthesisSaved={() => onSynthesisSaved?.(skillKey)}
                onSaveTemplate={msg.synthesis ? () => { setTemplateName(''); setTemplateSaved(false); setShowSaveTemplate(true) } : undefined}
              />
            </div>
          ))}

          {loading && (
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

        {/* Input */}
        {!synthesisDone && (
          <div className="flex items-end gap-2 border-t border-border px-3 py-2.5 shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Reply to productPILOT… (Shift+Enter for new line)`}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-white px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 min-h-[34px] max-h-[80px] overflow-y-auto"
              style={{ lineHeight: '1.4', '--tw-ring-color': '#a200ee' } as React.CSSProperties}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              style={{ backgroundColor: '#a200ee' }}
            >
              <Icons.SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {synthesisDone && (
          <div className="border-t border-border px-4 py-2.5 shrink-0 flex items-center justify-between bg-emerald-50">
            <span className="text-[11px] text-emerald-700 font-medium">Session complete</span>
            <button
              onClick={() => { setMessages([]); setSynthesisDone(false); setActiveTemplateId(null) }}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Icons.RefreshCw className="h-3 w-3" /> Start fresh
            </button>
          </div>
        )}
      </div>

      {/* Save-template modal */}
      {showSaveTemplate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-white shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Icons.BookmarkPlus className="h-4 w-4 shrink-0" style={{ color: '#a200ee' }} />
              <h3 className="text-sm font-semibold text-foreground">Save this path as a template</h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The question sequence from this session will be saved so you or your team can use it as a guided scaffold for future {skillName} sessions.
            </p>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-foreground">Template name</label>
              <input
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveTemplate() }}
                placeholder={`e.g. Deep ${skillName} — B2B SaaS`}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1"
                style={{ '--tw-ring-color': '#a200ee' } as React.CSSProperties}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowSaveTemplate(false)}
                className="rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              {templateSaved ? (
                <span className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100">
                  <Icons.Check className="h-3.5 w-3.5" /> Saved!
                </span>
              ) : (
                <button
                  onClick={() => void handleSaveTemplate()}
                  disabled={!templateName.trim() || savingTemplate}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40 transition-colors"
                  style={{ backgroundColor: '#a200ee' }}
                >
                  <Icons.BookmarkPlus className="h-3.5 w-3.5" />
                  {savingTemplate ? 'Saving…' : 'Save template'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
