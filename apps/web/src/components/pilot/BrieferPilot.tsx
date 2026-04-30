/**
 * BrieferPilot.tsx
 *
 * A focused PILOT session for building or refining a company/product/solution brief.
 * Runs five probes (what/who/problem/outcome/differentiator), drafts the brief,
 * and hands off to Section 01 of the GTM Framework on approval.
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// Strip JSON objects/arrays and code fences from LLM replies before displaying
function stripJsonBlocks(raw: string): string {
  let text = raw.replace(/```[a-z]*\n?[\s\S]*?```/gi, '').trim()
  let result = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const preview = text.slice(i + 1, i + 200)
      if (/^\s*(?:"[^"]*"\s*:|[\[\{])/.test(preview)) {
        let depth = 1, inStr = false, esc = false, j = i + 1
        while (j < text.length && depth > 0) {
          const c = text[j]
          if (esc)                      { esc = false }
          else if (c === '\\' && inStr) { esc = true }
          else if (c === '"')           { inStr = !inStr }
          else if (!inStr) {
            if (c === '{' || c === '[') depth++
            else if (c === '}' || c === ']') depth--
          }
          j++
        }
        i = j; continue
      }
    }
    result += ch; i++
  }
  return result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

interface BriefMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClientBrief {
  id: string
  name: string
  type: string
  status: string
  source: string
  content: string | null
  extractedData: Record<string, string> | null
}

interface BrieferPilotProps {
  clientId: string
  verticalId: string
  verticalName?: string | null
  brief: ClientBrief
  onBriefSaved?: (brief: ClientBrief) => void
  onClose: () => void
  onGoToSection01?: () => void
}

const TYPE_LABELS: Record<string, string> = {
  company: 'Company Brief',
  product: 'Product Brief',
  solution: 'Solution Brief',
  service_line: 'Service Line Brief',
}

export function BrieferPilot({
  clientId,
  verticalId,
  verticalName,
  brief,
  onBriefSaved,
  onClose,
  onGoToSection01,
}: BrieferPilotProps) {
  const [messages, setMessages] = useState<BriefMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [briefSaved, setBriefSaved] = useState(false)
  const [showSection01Offer, setShowSection01Offer] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasStarted = useRef(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-start: inject opening directly for new/blank briefs; use API for refinement
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    if (brief.content) {
      // Has existing content — inject opening synchronously, same as new brief path.
      // Never make an API call here: messages is [] at mount so sendMessage would send
      // an empty history and the route would reject it.
      setMessages([{
        role: 'assistant',
        content: `I have your "${brief.name}" brief here. Want to sharpen anything, or are you ready to take this into Section 01?`,
      }])
    } else {
      // New or blank brief — inject opening instantly, no API round-trip
      setMessages([{
        role: 'assistant',
        content: `Tell me what this is. Not the pitch, just what it actually does and who it helps.`,
      }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendMessage = useCallback(async (overrideText?: string, isSystem = false) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    if (!isSystem) setInput('')

    const userMsg: BriefMessage = { role: 'user', content: text }
    const fullMessages = isSystem ? messages : [...messages, userMsg]
    if (!isSystem) setMessages(fullMessages)
    setLoading(true)

    // Truncate before sending — preserve first message + most recent 39 exchanges
    const MAX_SEND = 80
    const sendMessages = fullMessages.length > MAX_SEND
      ? [fullMessages[0], ...fullMessages.slice(-(MAX_SEND - 1))]
      : fullMessages

    try {
      const res = await apiFetch('/api/v1/gtm-pilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: sendMessages.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          verticalId,
          verticalName,
          pilotMode: 'briefer',
          briefId: brief.id,
          // provide these required fields
          filledSections: [],
          emptySections: [],
        }),
      })

      if (!res.ok) throw new Error(`API error ${res.status}`)
      const json = await res.json() as { reply: string; briefSaved?: boolean }

      // Strip any JSON blocks or code fences the LLM may have leaked into the reply
      const cleanReply = stripJsonBlocks(json.reply ?? '')
      const assistantMsg: BriefMessage = { role: 'assistant', content: cleanReply }
      setMessages((prev) => [...(isSystem ? prev : prev), assistantMsg])

      if (json.briefSaved) {
        setBriefSaved(true)
        // Reload brief from API
        const briefRes = await apiFetch(`/api/v1/clients/${clientId}/briefs`)
        if (briefRes.ok) {
          const data = await briefRes.json() as { data: ClientBrief[] }
          const updated = data.data.find((b) => b.id === brief.id)
          if (updated) onBriefSaved?.(updated)
        }
        // Show Section 01 offer
        setTimeout(() => setShowSection01Offer(true), 800)
      }
    } catch (err) {
      console.error('[BrieferPilot] error:', err)
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, verticalId, verticalName, brief.id, onBriefSaved])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }, [sendMessage])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
              <Icons.Sparkles className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Brief Builder</p>
              <p className="text-[11px] text-muted-foreground">{TYPE_LABELS[brief.type] ?? 'Brief'} — {brief.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {briefSaved && (
              <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                <Icons.Check className="w-3 h-3" />
                Brief saved
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <Icons.X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {messages.length === 0 && loading && (
            <div className="flex items-center justify-center h-32">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                  <Icons.Sparkles className="w-3.5 h-3.5 text-violet-600" />
                </div>
              )}
              <div className={cn(
                'max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-violet-600 text-white rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm',
              )}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                <Icons.Sparkles className="w-3.5 h-3.5 text-violet-600" />
              </div>
              <div className="bg-muted rounded-xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Section 01 offer (shown after brief saved) */}
        {showSection01Offer && onGoToSection01 && (
          <div className="mx-5 mb-3 bg-violet-50 border border-violet-200 rounded-xl p-4 shrink-0">
            <p className="text-[13px] text-violet-900 font-medium mb-2">Brief saved — ready to start your framework?</p>
            <p className="text-[12px] text-violet-700 mb-3">Your positioning statement is implied by what we just built. Want to go straight into Section 01?</p>
            <div className="flex gap-2">
              <button
                onClick={() => { onGoToSection01(); onClose() }}
                className="text-[12px] font-medium bg-violet-600 text-white rounded-lg px-3 py-1.5 hover:bg-violet-700 transition-colors"
              >
                Go to Section 01
              </button>
              <button
                onClick={onClose}
                className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
              >
                Close session
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        {!briefSaved && (
          <div className="px-5 pb-4 shrink-0">
            <div className="flex gap-2 items-end bg-muted rounded-xl border border-border p-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response..."
                rows={2}
                className="flex-1 bg-transparent resize-none text-[13px] text-foreground placeholder:text-muted-foreground outline-none leading-relaxed px-1 py-0.5"
                disabled={loading}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                className="p-2 rounded-lg bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700 transition-colors shrink-0"
              >
                <Icons.Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
