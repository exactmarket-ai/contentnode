/**
 * TaskPilot.tsx
 *
 * taskPILOT — AI research task strategist anchored to the bottom of the Scheduled Tasks tab.
 * Expands to 40% of the viewport height.
 * Knows existing tasks, recent outputs, and client brain context.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskDraft {
  label?: string
  frequency?: 'daily' | 'weekly' | 'monthly'
  config?: Record<string, unknown>
}

export interface TaskSuggestion {
  id: string
  title: string
  description: string
  action: 'add_task' | 'run_task' | 'view_output' | 'schedule_task'
  taskId: string | null
  taskType: string | null
  taskLabel: string
  taskDraft?: TaskDraft
}

interface TaskMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: TaskSuggestion[]
}

export interface ScheduledTaskSummary {
  id: string
  type: string
  label: string
  frequency: string
  enabled: boolean
  lastStatus: string
  lastRunAt: string | null
  nextRunAt: string | null
  changeDetected?: boolean
  lastChangeSummary?: string | null
  vertical?: { id: string; name: string } | null
}

export interface TaskPilotProps {
  clientId: string
  clientName: string
  tasks: ScheduledTaskSummary[]
  onAddTask: (taskType: string, draft?: TaskDraft) => void
  onRunTask: (taskId: string) => void
  onViewOutput: (taskId: string) => void
  onScheduleTask: (taskId: string) => void
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

// ─── Action icons ─────────────────────────────────────────────────────────────

const ACTION_META: Record<TaskSuggestion['action'], { icon: keyof typeof Icons; color: string; label: string }> = {
  add_task:      { icon: 'Plus',        color: 'text-green-500',  label: 'Add task' },
  run_task:      { icon: 'Play',        color: 'text-blue-500',   label: 'Run now' },
  view_output:   { icon: 'FileText',    color: 'text-primary/60', label: 'View output' },
  schedule_task: { icon: 'CalendarClock', color: 'text-amber-500', label: 'Set schedule' },
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onAddTask,
  onRunTask,
  onViewOutput,
  onScheduleTask,
  onSendMessage,
}: {
  suggestion: TaskSuggestion
  onAddTask: (type: string, draft?: TaskDraft) => void
  onRunTask: (id: string) => void
  onViewOutput: (id: string) => void
  onScheduleTask: (id: string) => void
  onSendMessage: (text: string) => void
}) {
  const meta = ACTION_META[suggestion.action]
  const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>

  const handleAction = () => {
    if (suggestion.action === 'add_task' && suggestion.taskType) {
      onAddTask(suggestion.taskType, suggestion.taskDraft)
      const autoMsg = suggestion.taskDraft?.label
        ? `I've pre-filled "${suggestion.taskDraft.label}" — review and save when ready.`
        : `I'm setting up a new ${suggestion.taskLabel} task. What config do you recommend?`
      onSendMessage(autoMsg)
    } else if (suggestion.action === 'run_task' && suggestion.taskId) {
      onRunTask(suggestion.taskId)
      onSendMessage(`I ran "${suggestion.taskLabel}" now. What should I look for in the output?`)
    } else if (suggestion.action === 'view_output' && suggestion.taskId) {
      onViewOutput(suggestion.taskId)
      onSendMessage(`I'm viewing the output of "${suggestion.taskLabel}". Help me interpret what's interesting here.`)
    } else if (suggestion.action === 'schedule_task' && suggestion.taskId) {
      onScheduleTask(suggestion.taskId)
      onSendMessage(`I'm adjusting the schedule for "${suggestion.taskLabel}".`)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background hover:border-primary/30 p-3 flex flex-col gap-1.5 transition-colors">
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-semibold text-foreground leading-snug">
          <span className={cn('mr-1.5 inline-flex items-center justify-center rounded px-1 py-0.5', meta.color)}>
            <Icon className="h-3 w-3" />
          </span>
          {suggestion.title}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{suggestion.description}</p>
      <button
        onClick={handleAction}
        className="w-full rounded-md bg-primary hover:bg-primary/90 text-white text-[10px] font-semibold py-1.5 transition-colors flex items-center justify-center gap-1"
      >
        {meta.label} <Icons.ArrowRight className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onAddTask,
  onRunTask,
  onViewOutput,
  onScheduleTask,
  onSendMessage,
}: {
  msg: TaskMessage
  onAddTask: (type: string, draft?: TaskDraft) => void
  onRunTask: (id: string) => void
  onViewOutput: (id: string) => void
  onScheduleTask: (id: string) => void
  onSendMessage: (text: string) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
          <Icons.Radar className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[88%]">
        <div
          className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
            isUser
              ? 'bg-primary text-white rounded-tr-sm'
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
                onAddTask={onAddTask}
                onRunTask={onRunTask}
                onViewOutput={onViewOutput}
                onScheduleTask={onScheduleTask}
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

export function TaskPilot({
  clientId,
  clientName,
  tasks,
  onAddTask,
  onRunTask,
  onViewOutput,
  onScheduleTask,
}: TaskPilotProps) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [input, setInput]       = useState('')

  const lastMsgRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // Clear conversation when task list changes significantly
  useEffect(() => {
    setMessages([])
  }, [clientId])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    if (!overrideText) setInput('')

    const userMsg: TaskMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...messages, userMsg]
      const res = await apiFetch('/api/v1/task-pilot/chat', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          clientId,
          tasks: tasks.map((t) => ({
            id:                t.id,
            type:              t.type,
            label:             t.label,
            frequency:         t.frequency,
            enabled:           t.enabled,
            lastStatus:        t.lastStatus,
            lastRunAt:         t.lastRunAt ?? null,
            nextRunAt:         t.nextRunAt ?? null,
            changeDetected:    t.changeDetected ?? false,
            lastChangeSummary: t.lastChangeSummary ?? null,
            vertical:          t.vertical ?? null,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Something went wrong: ${(err as { error?: string }).error ?? res.status}`,
        }])
        return
      }

      const { data: respData } = await res.json() as { data: { reply: string; suggestions: TaskSuggestion[] } }
      const suggestions: TaskSuggestion[] = Array.isArray(respData.suggestions) ? respData.suggestions : []
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: (respData.reply ?? '').trim(),
        suggestions,
      }])
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Network error — check your connection and try again.',
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, clientId, tasks])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const handleSendMessage = useCallback((text: string) => void sendMessage(text), [sendMessage])

  const changedTasks = tasks.filter((t) => t.changeDetected)

  // ── Collapsed ───────────────────────────────────────────────────────────────
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
          title="Open taskPILOT"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
        >
          <Icons.ChevronUp className="h-2 w-2 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1.5 text-primary shrink-0">
          <Icons.Radar className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">taskPILOT</span>
        </div>

        {changedTasks.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-300 px-2 py-0.5 text-[9px] font-semibold text-amber-600">
            {changedTasks.length} update{changedTasks.length !== 1 ? 's' : ''} detected
          </span>
        )}

        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {lastMsg
            ? lastMsg.content.replace(/\n/g, ' ').slice(0, 90)
            : `Ask me how to optimise research for ${clientName}…`}
        </span>

        <span className="text-[10px] text-primary/60 font-medium shrink-0 select-none">
          Click to open ↑
        </span>
      </div>
    )
  }

  // ── Expanded ────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: '40vh' }}
    >
      <button
        onClick={() => setOpen(false)}
        title="Collapse taskPILOT"
        className="absolute top-0 left-1/2 z-10 -translate-x-1/2 flex w-12 h-3 items-center justify-center rounded-b-sm border border-t-0 border-border bg-card hover:bg-muted transition-colors"
      >
        <Icons.ChevronDown className="h-2 w-2 text-muted-foreground" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1.5 text-primary">
          <Icons.Radar className="h-4 w-4" />
          <span className="text-xs font-bold tracking-wide">taskPILOT</span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-0.5">AI research task strategist</span>
        <span className="ml-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[9px] font-medium text-primary">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
        {changedTasks.length > 0 && (
          <span className="rounded-full bg-amber-500/10 border border-amber-300 px-2 py-0.5 text-[9px] font-semibold text-amber-600">
            {changedTasks.length} update{changedTasks.length !== 1 ? 's' : ''} detected
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
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center select-none">
            <Icons.Radar className="h-6 w-6 text-primary/30" />
            <p className="text-xs font-medium text-muted-foreground">I'm your research task strategist.</p>
            <p className="text-[10px] text-muted-foreground/60 max-w-[260px]">
              I'll help you plan the right research cadence, interpret results, and fill gaps in your intelligence stack.
            </p>
            <div className="flex flex-col gap-1.5 mt-1 w-full max-w-[280px]">
              <button
                onClick={() => void sendMessage("What research am I missing for this client?")}
                className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
              >
                What research am I missing?
              </button>
              {changedTasks.length > 0 && (
                <button
                  onClick={() => void sendMessage(`${changedTasks.map((t) => t.label).join(', ')} detected changes. What should I do with these updates?`)}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-100 transition-colors"
                >
                  Interpret the {changedTasks.length} change{changedTasks.length !== 1 ? 's' : ''} detected →
                </button>
              )}
              {tasks.length === 0 && (
                <button
                  onClick={() => void sendMessage("I haven't set up any tasks yet. Where should I start?")}
                  className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
                >
                  Where should I start?
                </button>
              )}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
            <MessageBubble
              msg={msg}
              onAddTask={onAddTask}
              onRunTask={onRunTask}
              onViewOutput={onViewOutput}
              onScheduleTask={onScheduleTask}
              onSendMessage={handleSendMessage}
            />
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
              <Icons.Radar className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
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
          placeholder="Ask about your research strategy… (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[32px] max-h-[80px] overflow-y-auto"
          style={{ lineHeight: '1.4' }}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={!input.trim() || loading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Icons.SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
