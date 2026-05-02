/**
 * SeoPilot.tsx — seoPILOT modal PILOT
 *
 * Screen 1: Template picker (9 templates)
 * Screen 2: Chat interface with path buttons
 * Screen 3: Completion view with strategy summary
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SeoPilotMessage {
  role: 'user' | 'assistant'
  content: string
  paths?: string[]
}

interface SeoStrategy {
  templateKey: string
  summary: string
  primaryKeyword: string
  secondaryKeywords: string[]
  topicClusters: Array<{
    pillarTopic: string
    pillarKeyword: string
    clusterTopics: string[]
  }>
  contentPriorities: Array<{
    topic: string
    targetKeyword: string
    funnelStage: string
    urgency: string
    paaQuestions: string[]
    contentFormat: string
    estimatedImpact: string
    brief: string
  }>
  strategicRationale: string
}

export interface SeoPilotProps {
  clientId: string
  clientName: string
  onClose: () => void
  onViewBriefs: () => void
  onStrategyComplete?: () => void
}

// ─── Template registry ─────────────────────────────────────────────────────────

interface TemplateInfo {
  key: string
  name: string
  goal: string
  openingPreview: string
}

const TEMPLATES: TemplateInfo[] = [
  {
    key: 'pillar_strategy',
    name: 'Pillar Content Strategy',
    goal: 'Define a pillar page and cluster content around a topic you can own.',
    openingPreview: 'What is the one topic this client should own completely in search?',
  },
  {
    key: 'competitor_gap',
    name: 'Competitor Gap Audit',
    goal: "Find keywords competitors rank for that this client doesn't.",
    openingPreview: "Who are the 2–3 competitors eating their search share right now?",
  },
  {
    key: 'product_launch',
    name: 'Product Launch SEO',
    goal: 'Build keyword coverage across all funnel stages for a launch.',
    openingPreview: 'Who searches for this before they know this product exists?',
  },
  {
    key: 'awareness_expansion',
    name: 'Brand Awareness Expansion',
    goal: 'Move beyond bottom-funnel into awareness-stage territory.',
    openingPreview: "What does the ICP Google before they know a solution like this exists?",
  },
  {
    key: 'faq_domination',
    name: 'FAQ & Question Domination',
    goal: 'Target question-based queries for featured snippets.',
    openingPreview: "What does the ICP Google at 11pm when they're frustrated with the status quo?",
  },
  {
    key: 'geo_readiness',
    name: 'GEO Readiness Audit',
    goal: 'Improve how AI models describe and recommend this brand.',
    openingPreview: 'If someone asked an AI chatbot "who are the best companies in this category," would this client appear?',
  },
  {
    key: 'seasonal_campaign',
    name: 'Seasonal Campaign',
    goal: 'Capitalize on predictable seasonal search trends.',
    openingPreview: "What time of year does this client's ICP go into buying mode?",
  },
  {
    key: 'new_market',
    name: 'New Market Entry',
    goal: 'Build SEO presence for a new audience or vertical.',
    openingPreview: 'Does this new audience use different language for the same problem?',
  },
  {
    key: 'thought_leadership',
    name: 'Thought Leadership Cluster',
    goal: 'Position an executive as the go-to voice in their category.',
    openingPreview: 'What is the one contrarian position this executive holds that their ICP would search for?',
  },
]

// ─── Hardcoded opening messages ────────────────────────────────────────────────

const SEOPILOT_OPENINGS: Record<string, { message: string; paths: string[] }> = {
  pillar_strategy: {
    message: `Let's build a pillar content strategy for [CLIENT]. Before we get into keyword clusters, I want to understand what owning a topic cluster actually needs to do for them right now. Owning a topic can mean driving qualified trial signups, establishing category credibility, or competing for a specific audience segment — those require very different cluster shapes. Which of these most accurately describes the goal?`,
    paths: [
      'Drive qualified trial signups',
      'Establish category credibility',
      'Compete for a specific audience segment',
    ],
  },
  competitor_gap: {
    message: `Let's find the keyword opportunities [CLIENT]'s competitors are capturing that they're not. Before we dig into gaps, I need to understand who we're benchmarking against. The answer changes everything — a direct product competitor tells a different story than a content-dominant player in the same space. Who are the 2–3 competitors that worry the team most in search right now?`,
    paths: [
      'Named direct product competitors',
      'Content-dominant players in the category',
      "We don't have a clear competitor list yet",
    ],
  },
  product_launch: {
    message: `We're building keyword coverage for a product launch for [CLIENT]. The most common mistake here is starting at the bottom of the funnel — targeting people who already know the product exists. The real opportunity is above that: the searches happening before someone knows they need this. What's the core problem the product solves, and what does the ICP call that problem?`,
    paths: [
      'I can describe the core problem clearly',
      "The problem doesn't have an established name yet",
      'Different ICP segments name it differently',
    ],
  },
  awareness_expansion: {
    message: `We're mapping awareness-stage keyword territory for [CLIENT]. This means the searches happening before the ICP knows a solution like this exists — problem-aware, not solution-aware. The challenge here is always framing: companies want to talk about themselves, but awareness content has to talk about the problem. What does [CLIENT]'s ICP Google at the moment they first realize something isn't working?`,
    paths: [
      'I know the specific problem they search for',
      'We have multiple ICPs with different pain entry points',
      "We haven't mapped problem-stage searches yet",
    ],
  },
  faq_domination: {
    message: `Let's map the question-based queries [CLIENT] should own for featured snippets and AI answers. Question content works when it meets people exactly where they are — frustrated, comparing, deciding. The ICP has a very specific moment when they type a question into Google. What does that moment look like for [CLIENT]'s buyer, and what are they actually asking?`,
    paths: [
      'I know the specific questions they search',
      "They're at the comparison and deciding stage",
      "They're frustrated with the current solution",
    ],
  },
  geo_readiness: {
    message: `We're auditing how [CLIENT] appears in AI-generated answers — GEO, or Generative Engine Optimization. The question is whether AI chatbots like ChatGPT, Perplexity, and Claude describe and recommend [CLIENT] accurately when asked. This starts with a simple check: if someone asked "who are the best companies in this category," would [CLIENT] appear? What category would you expect [CLIENT] to be mentioned in?`,
    paths: [
      "A specific named category (I'll describe it)",
      'Multiple overlapping categories',
      "We don't have a clear category position yet",
    ],
  },
  seasonal_campaign: {
    message: `We're capitalizing on seasonal search patterns for [CLIENT]. Every B2B category has moments in the year when buyers go into evaluation mode — and the searches that happen then look very different from baseline. The goal is to own the category during that window. When does [CLIENT]'s ICP typically move into buying or evaluation mode, and what's the first thing they search when that happens?`,
    paths: [
      'End of fiscal year and Q4 budget season',
      'Industry event or conference season',
      'A product-specific trigger event',
    ],
  },
  new_market: {
    message: `We're building SEO presence for [CLIENT]'s entry into a new audience or vertical. New market SEO usually fails because the content speaks the current ICP's language, not the new audience's. The vocabulary difference is often invisible to the team. Who is the new target audience, and do they use different language to describe the problem [CLIENT] solves?`,
    paths: [
      'Same problem, different industry vertical',
      'Different buyer persona within the same industry',
      'New geography with different search behavior',
    ],
  },
  thought_leadership: {
    message: `We're positioning an executive at [CLIENT] as the go-to voice in their category. Thought leadership SEO works when it's genuinely contrarian — not "AI is changing everything" but a specific, searchable claim that a specific audience would seek out. The question that unlocks this: what is the one position this executive holds that would make peers in their industry uncomfortable? That's the cluster seed.`,
    paths: [
      'I can describe a specific contrarian position',
      "We have a point of view but it's not fully articulated",
      'The executive wants to challenge a specific industry assumption',
    ],
  },
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isLast,
  onPathClick,
}: {
  msg: SeoPilotMessage
  isLast: boolean
  onPathClick: (path: string) => void
}) {
  const isUser = msg.role === 'user'
  const showPaths = !isUser && isLast && Array.isArray(msg.paths) && msg.paths.length > 0

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5 bg-emerald-600">
          <Icons.TrendingUp className="h-3 w-3 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        {msg.content && (
          <div
            className={cn(
              'rounded-xl px-3 py-2 text-[12px] leading-relaxed',
              isUser
                ? 'bg-emerald-600 text-white rounded-tr-sm'
                : 'bg-zinc-100 text-foreground rounded-tl-sm',
            )}
          >
            {renderContent(msg.content)}
          </div>
        )}
        {showPaths && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {msg.paths!.map((path, i) => (
              <button
                key={i}
                onClick={() => onPathClick(path)}
                className="rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-foreground hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-900 transition-colors"
              >
                {path}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Template picker ──────────────────────────────────────────────────────────

function TemplatePicker({
  clientName,
  onStart,
}: {
  clientName: string
  onStart: (templateKey: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const handleStart = async () => {
    if (!selected || starting) return
    setStarting(true)
    try {
      await onStart(selected)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-4 pb-3 shrink-0">
        <p className="text-[11px] text-muted-foreground">
          Choose an SEO strategy template for <span className="font-medium text-foreground">{clientName}</span>
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-1 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => setSelected(t.key)}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-left transition-colors',
                selected === t.key
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-border bg-white hover:border-emerald-300 hover:bg-emerald-50/40',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn(
                    'text-[12px] font-semibold leading-snug',
                    selected === t.key ? 'text-emerald-900' : 'text-foreground',
                  )}>
                    {t.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.goal}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1 italic leading-snug">{t.openingPreview}</p>
                </div>
                {selected === t.key && (
                  <Icons.CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-4 py-3 shrink-0">
        <button
          onClick={() => { void handleStart() }}
          disabled={!selected || starting}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-emerald-700 transition-colors"
        >
          {starting
            ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
            : <><Icons.TrendingUp className="h-3.5 w-3.5" /> Start Session</>}
        </button>
      </div>
    </div>
  )
}

// ─── Completion view ──────────────────────────────────────────────────────────

function CompletionView({
  strategy,
  onViewBriefs,
  onClose,
}: {
  strategy: SeoStrategy
  onViewBriefs: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
        <Icons.CheckCircle2 className="h-6 w-6 text-emerald-600" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Strategy complete</p>
        <p className="text-[12px] text-muted-foreground leading-relaxed max-w-[360px]">
          {strategy.summary}
        </p>
      </div>
      <div className="w-full max-w-[360px] rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left space-y-1">
        <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Primary keyword</p>
        <p className="text-[12px] font-medium text-emerald-900">{strategy.primaryKeyword}</p>
        <p className="text-[10px] text-emerald-700 mt-1">
          {strategy.contentPriorities.length} content brief{strategy.contentPriorities.length !== 1 ? 's' : ''} generated
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[360px]">
        <button
          onClick={onViewBriefs}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          <Icons.FileText className="h-3.5 w-3.5" /> View Content Briefs
        </button>
        <button
          onClick={onClose}
          className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type ModalScreen = 'picker' | 'chat' | 'complete'

export function SeoPilot({ clientId, clientName, onClose, onViewBriefs, onStrategyComplete }: SeoPilotProps) {
  const [screen, setScreen]           = useState<ModalScreen>('picker')
  const [sessionId, setSessionId]     = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState<string | null>(null)
  const [messages, setMessages]       = useState<SeoPilotMessage[]>([])
  const [loading, setLoading]         = useState(false)
  const [input, setInput]             = useState('')
  const [strategy, setStrategy]       = useState<SeoStrategy | null>(null)

  const lastMsgRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)

  // Scroll on messages change
  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, loading])

  // Auto-focus input when chat screen is shown
  useEffect(() => {
    if (screen === 'chat') {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [screen])

  // Handle "Start Session" on template picker — returns Promise so TemplatePicker can reset its loading state
  const handleStart = useCallback(async (key: string): Promise<void> => {
    const res = await apiFetch('/api/v1/seo/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, templateKey: key }),
    })
    if (!res.ok) return

    const { data } = await res.json() as { data: { id: string } }
    const opening = SEOPILOT_OPENINGS[key]
    const greetingMessage = opening?.message.replace(/\[CLIENT\]/g, clientName) ?? ''
    const greetingPaths   = opening?.paths ?? []

    setSessionId(data.id)
    setTemplateKey(key)
    setMessages([{
      role:    'assistant',
      content: greetingMessage,
      paths:   greetingPaths,
    }])
    setScreen('chat')
  }, [clientId, clientName])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading || !sessionId || !templateKey) return
    if (!overrideText) setInput('')

    const userMsg: SeoPilotMessage = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)

    try {
      const apiMessages = nextMessages.map((m) => ({ role: m.role, content: m.content }))
      const res = await apiFetch(`/api/v1/seo/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, clientId, templateKey }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Error: ${(err as { error?: string }).error ?? res.status}`,
        }])
        return
      }

      const { data } = await res.json() as {
        data: { message: string; paths: string[]; strategy?: SeoStrategy }
      }

      const assistantMsg: SeoPilotMessage = {
        role:    'assistant',
        content: data.message ?? '',
        paths:   Array.isArray(data.paths) ? data.paths : [],
      }
      setMessages((prev) => [...prev, assistantMsg])

      if (data.strategy) {
        setStrategy(data.strategy)
        setScreen('complete')
        onStrategyComplete?.()
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Network error — check your connection.',
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, sessionId, templateKey, clientId, onStrategyComplete])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
  }

  const templateInfo = templateKey ? TEMPLATES.find((t) => t.key === templateKey) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <div
        className="flex flex-col w-full max-w-2xl rounded-xl border border-border bg-white shadow-2xl overflow-hidden"
        style={{ height: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 shrink-0">
            <Icons.TrendingUp className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wide text-emerald-600">seoPILOT</span>
              {templateInfo && (
                <>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[11px] font-medium text-foreground truncate">{templateInfo.name}</span>
                </>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Client: {clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Screen: Template picker */}
        {screen === 'picker' && (
          <TemplatePicker clientName={clientName} onStart={handleStart} />
        )}

        {/* Screen: Chat */}
        {screen === 'chat' && (
          <>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0">
              {messages.map((msg, i) => (
                <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
                  <MessageBubble
                    msg={msg}
                    isLast={i === messages.length - 1 && !loading}
                    onPathClick={(path) => void sendMessage(path)}
                  />
                </div>
              ))}

              {loading && (
                <div className="flex gap-2 items-start">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600">
                    <Icons.TrendingUp className="h-3 w-3 text-white" />
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-zinc-100 px-3 py-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-end gap-2 border-t border-border px-3 py-2.5 shrink-0">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Reply to seoPILOT… (Shift+Enter for new line)"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-white px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-emerald-500 min-h-[34px] max-h-[80px] overflow-y-auto"
                style={{ lineHeight: '1.4' }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
              >
                <Icons.SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {/* Screen: Complete */}
        {screen === 'complete' && strategy && (
          <CompletionView
            strategy={strategy}
            onViewBriefs={() => { onViewBriefs(); onClose() }}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}
