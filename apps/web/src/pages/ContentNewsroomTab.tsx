import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

// AssignmentPanel types
interface LeadershipTarget {
  id: string
  name: string
  role: string
  defaultContentPackId: string | null
  mondayBoardId: string | null
  boxFolderId: string | null
}

interface VerticalTarget {
  id: string
  name: string
  color: string | null
  defaultContentPackId: string | null
  mondayBoardId: string | null
  boxFolderId: string | null
}

interface PromptItem {
  id: string
  name: string
  category: string | null
  body: string
}

interface ContentPackItem {
  id: string
  packId: string
  promptTemplateId: string
  promptName: string
  promptCategory: string
  promptDescription: string | null
  order: number
}

interface ContentPack {
  id: string
  name: string
  description: string | null
  itemCount: number
  items?: ContentPackItem[]
}

interface TopicSource {
  title: string
  publication: string
  url: string
  publish_date: string
}

interface TopicItem {
  id: string
  title: string
  summary: string
  score: number
  scoreRationale: string | null
  sources: TopicSource[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  vertical: { id: string; name: string; color: string | null } | null
}

interface NewsroomMeta {
  totalDecisions: number
  verticalCount: number
  hasPreferenceProfile: boolean
}

interface TaskRow {
  id: string
  label: string
  type: string
  frequency: string
  enabled: boolean
  lastStatus: string
  contentMode: string
  autoGenerate: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  vertical: { id: string; name: string; color: string | null } | null
}

interface VerticalOption {
  id: string
  name: string
  color: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_TYPE_META: Record<string, { label: string; icon: keyof typeof Icons; color: string }> = {
  web_scrape:      { label: 'Web Scrape',      icon: 'Globe',       color: 'text-blue-500' },
  review_miner:    { label: 'Review Miner',    icon: 'Star',        color: 'text-amber-500' },
  audience_signal: { label: 'Audience Signal', icon: 'Users',       color: 'text-green-500' },
  seo_intent:      { label: 'SEO Intent',      icon: 'TrendingUp',  color: 'text-purple-500' },
  research_brief:  { label: 'Research Brief',  icon: 'FileText',    color: 'text-indigo-500' },
}

const FALLBACK_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#6366f1']

function verticalColor(id: string, stored: string | null | undefined): string {
  if (stored) return stored
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#d97706'
  return '#dc2626'
}

function scoreBg(score: number): string {
  if (score >= 80) return '#f0fdf4'
  if (score >= 60) return '#fffbeb'
  return '#fef2f2'
}

function relTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function lsKey(clientId: string) { return `newsroom_research_durations:${clientId}` }

function loadDurations(clientId: string): number[] {
  try { return JSON.parse(localStorage.getItem(lsKey(clientId)) ?? '[]') } catch { return [] }
}

function saveDuration(clientId: string, secs: number) {
  const prev = loadDurations(clientId)
  const next = [...prev, secs].slice(-10)
  try { localStorage.setItem(lsKey(clientId), JSON.stringify(next)) } catch {}
}

// ── Topic Card ─────────────────────────────────────────────────────────────────

function TopicCard({
  topic,
  selected,
  isNew,
  onSelect,
  onApprove,
  onReject,
  loading,
}: {
  topic: TopicItem
  selected: boolean
  isNew: boolean
  onSelect: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [highlight, setHighlight] = useState(isNew)

  useEffect(() => {
    if (!isNew) return
    const t = setTimeout(() => setHighlight(false), 5000)
    return () => clearTimeout(t)
  }, [isNew])

  const vColor = topic.vertical ? verticalColor(topic.vertical.id, topic.vertical.color) : null

  return (
    <div
      style={{
        border: selected ? '1.5px solid #a200ee' : highlight ? '1.5px solid #a5b4fc' : '1px solid #e5e7eb',
        borderRadius: 10,
        backgroundColor: selected ? '#fdf5ff' : highlight ? '#EEEDFE' : '#ffffff',
        padding: '14px 16px',
        transition: 'border-color 0.5s, background-color 2s',
      }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onSelect(topic.id)}
          style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
            border: selected ? '1.5px solid #a200ee' : '1.5px solid #d1d5db',
            backgroundColor: selected ? '#a200ee' : '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {selected && <Icons.Check className="h-3 w-3 text-white" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '1px 7px', color: scoreColor(topic.score), backgroundColor: scoreBg(topic.score), flexShrink: 0 }}>
              {topic.score}
            </span>
            {topic.vertical && (
              <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 8px', backgroundColor: vColor ? `${vColor}22` : '#ede9fe', color: vColor ?? '#6d28d9', fontWeight: 500, flexShrink: 0 }}>
                {topic.vertical.name}
              </span>
            )}
            {isNew && (
              <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 8px', backgroundColor: '#EEEDFE', color: '#534AB7', fontWeight: 600, flexShrink: 0 }}>
                Just added
              </span>
            )}
            <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1, minWidth: 0, margin: 0 }}>
              {topic.title}
            </p>
          </div>

          <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0', lineHeight: 1.5 }}>
            {topic.summary}
          </p>

          {topic.scoreRationale && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 0', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              <Icons.ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
              Why this score?
            </button>
          )}
          {expanded && topic.scoreRationale && (
            <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0', lineHeight: 1.5, backgroundColor: '#f9fafb', borderRadius: 6, padding: '8px 10px' }}>
              {topic.scoreRationale}
            </p>
          )}

          {topic.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {topic.sources.map((s, i) => {
                let host = ''
                try { host = new URL(s.url).hostname } catch { host = s.publication }
                return (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, borderRadius: 6, padding: '2px 8px', backgroundColor: '#f3f4f6', color: '#374151', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Icons.ExternalLink className="h-2.5 w-2.5" />
                    {s.publication || host}
                  </a>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => onReject(topic.id)} disabled={loading} title="Reject"
            style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #fee2e2', backgroundColor: '#fff7f7', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
            <Icons.X className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onApprove(topic.id)} disabled={loading} title="Approve"
            style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
            <Icons.Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── NewsroomToggle ─────────────────────────────────────────────────────────────

function NewsroomToggle({ task, onToggle }: { task: TaskRow; onToggle: (id: string, feed: boolean) => Promise<void> }) {
  const isFeeding = task.contentMode === 'evaluate_and_queue'
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const handle = async () => {
    setBusy(true)
    await onToggle(task.id, !isFeeding)
    setBusy(false)
    setConfirmation(!isFeeding ? 'Now feeding Newsroom' : 'Removed from Newsroom')
    setTimeout(() => setConfirmation(null), 2000)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={handle} disabled={busy}
        style={{
          width: 34, height: 18, borderRadius: 9, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
          backgroundColor: isFeeding ? '#534AB7' : '#d1d5db',
          position: 'relative', flexShrink: 0, opacity: busy ? 0.6 : 1, transition: 'background-color 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 1, width: 16, height: 16, borderRadius: '50%', backgroundColor: '#ffffff',
          left: isFeeding ? 16 : 1, transition: 'left 0.2s', display: 'block',
        }} />
      </button>
      {confirmation && (
        <span style={{ fontSize: 10, color: isFeeding ? '#534AB7' : '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {confirmation}
        </span>
      )}
      {!confirmation && (
        <span style={{ fontSize: 10, color: isFeeding ? '#534AB7' : '#9ca3af' }}>
          {isFeeding ? 'Feeding Newsroom' : 'Not feeding'}
        </span>
      )}
    </div>
  )
}

// ── Research Tasks Sidebar ─────────────────────────────────────────────────────

function ResearchTasksSidebar({
  clientId,
  onAddTask,
  onToggleNewsroom,
  onRunTask,
}: {
  clientId: string
  onAddTask?: () => void
  onToggleNewsroom: (id: string, feed: boolean) => Promise<void>
  onRunTask: (id: string) => void
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState<Set<string>>(new Set())

  useEffect(() => {
    apiFetch(`/api/v1/scheduled-tasks?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setTasks(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  const handleToggle = async (id: string, feed: boolean) => {
    await apiFetch(`/api/v1/scheduled-tasks/${id}/newsroom-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedNewsroom: feed }),
    }).catch(() => {})
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, contentMode: feed ? 'evaluate_and_queue' : 'auto_generate' } : t))
    onToggleNewsroom(id, feed)
  }

  const runNow = async (id: string) => {
    setRunning((prev) => new Set([...prev, id]))
    await apiFetch(`/api/v1/scheduled-tasks/${id}/run-now`, { method: 'POST' }).catch(() => {})
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, lastStatus: 'running' } : t))
    onRunTask(id)
    setTimeout(() => setRunning((prev) => { const s = new Set(prev); s.delete(id); return s }), 3000)
  }

  // Group by vertical (null = client-level), using stored color
  const groups = new Map<string, { label: string; color: string; tasks: TaskRow[] }>()
  for (const t of tasks) {
    const key = t.vertical?.id ?? '__client__'
    if (!groups.has(key)) {
      const color = t.vertical ? verticalColor(t.vertical.id, t.vertical.color) : '#9ca3af'
      groups.set(key, { label: t.vertical?.name ?? 'Client-level', color, tasks: [] })
    }
    groups.get(key)!.tasks.push(t)
  }

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', margin: 0 }}>Research Tasks</p>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>Tasks feeding the Newsroom are marked active</p>
        </div>
        {onAddTask && (
          <button type="button" onClick={onAddTask}
            style={{ fontSize: 11, fontWeight: 500, borderRadius: 6, padding: '4px 10px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icons.Plus className="h-3 w-3" />
            Add task
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2].map((i) => <div key={i} style={{ height: 60, borderRadius: 8, backgroundColor: '#f3f4f6' }} />)}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div style={{ borderRadius: 8, border: '1px dashed #e5e7eb', padding: '24px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>No research tasks yet.</p>
          {onAddTask && (
            <button type="button" onClick={onAddTask}
              style={{ marginTop: 8, fontSize: 12, color: '#534AB7', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>
              Add a task →
            </button>
          )}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from(groups.entries()).map(([key, group]) => {
            const isOpen = !collapsed.has(key)
            return (
              <div key={key} style={{ borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleCollapse(key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: '#f9fafb', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: group.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#374151', flex: 1 }}>{group.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 10, padding: '1px 7px', backgroundColor: '#e5e7eb', color: '#6b7280' }}>{group.tasks.length}</span>
                  <Icons.ChevronRight className={cn('h-3 w-3 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                </button>

                {/* Task rows */}
                {isOpen && (
                  <div>
                    {group.tasks.map((task, idx) => {
                      const meta = TASK_TYPE_META[task.type] ?? { label: task.type, icon: 'FileText' as keyof typeof Icons, color: 'text-gray-500' }
                      const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
                      return (
                        <div key={task.id}
                          style={{ padding: '10px 12px', borderTop: idx === 0 ? '1px solid #f3f4f6' : '1px solid #f3f4f6', backgroundColor: '#ffffff' }}>
                          <div className="flex items-start gap-2">
                            <div style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                              <Icon className={cn('h-3 w-3', meta.color)} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p style={{ fontSize: 12, fontWeight: 500, color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {task.label}
                              </p>
                              <div className="flex items-center flex-wrap gap-1 mt-1">
                                <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 6px', backgroundColor: '#f3f4f6', color: '#6b7280' }}>{meta.label}</span>
                                <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 6px', backgroundColor: '#f3f4f6', color: '#6b7280', textTransform: 'capitalize' }}>{task.frequency}</span>
                                <span className={cn('text-[10px] rounded-full px-1.5 py-0.5 font-medium', {
                                  'bg-muted text-muted-foreground': task.lastStatus === 'idle' || !task.lastStatus,
                                  'bg-blue-500/10 text-blue-600': task.lastStatus === 'running',
                                  'bg-green-500/10 text-green-600': task.lastStatus === 'success',
                                  'bg-red-500/10 text-red-500': task.lastStatus === 'failed',
                                })}>{task.lastStatus || 'idle'}</span>
                              </div>
                              <p style={{ fontSize: 10, color: '#9ca3af', margin: '3px 0 0' }}>
                                Last: {relTime(task.lastRunAt)}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <NewsroomToggle task={task} onToggle={handleToggle} />
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => runNow(task.id)} disabled={running.has(task.id) || task.lastStatus === 'running'}
                                  title="Run now"
                                  style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', color: '#6b7280', cursor: 'pointer', opacity: (running.has(task.id) || task.lastStatus === 'running') ? 0.4 : 1 }}>
                                  {running.has(task.id) ? '…' : '▶'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Research Topic Flow (async with polling + elapsed timer) ──────────────────

type RecencyWindow = '7d' | '30d' | '90d'

type ResearchPhase =
  | { kind: 'idle' }
  | { kind: 'polling'; jobId: string; startMs: number }
  | { kind: 'done'; elapsed: number }
  | { kind: 'error'; message: string; preservedInput: string }

function ResearchTopicFlow({
  clientId,
  verticals,
  onTopicsAdded,
  flowRef,
}: {
  clientId: string
  verticals: VerticalOption[]
  onTopicsAdded: (ids: string[]) => void
  flowRef: React.RefObject<HTMLDivElement>
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [userInput, setUserInput] = useState('')
  const [selectedVertical, setSelectedVertical] = useState<string | null>(null)
  const [recency, setRecency] = useState<RecencyWindow>('7d')
  const [phase, setPhase] = useState<ResearchPhase>({ kind: 'idle' })
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)

  // Auto-skip step 2 if only one vertical
  useEffect(() => {
    if (step === 2 && verticals.length === 1) {
      setSelectedVertical(verticals[0].id)
      setStep(3)
    }
  }, [step, verticals])

  // Live elapsed timer — ticks every second while polling
  useEffect(() => {
    if (phase.kind !== 'polling') return
    const interval = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - phase.startMs) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [phase])

  // Polling loop
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => {
    return () => stopPolling() // cleanup on unmount / navigation away
  }, [])

  const startPolling = (jobId: string, startMs: number) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/topic-queue/research/${jobId}`)
        if (!res.ok) return
        const { data } = await res.json()
        if (!data) return

        setCurrentStep(data.currentStep ?? null)

        if (data.status === 'complete') {
          stopPolling()
          const elapsed = Math.floor((Date.now() - startMs) / 1000)
          saveDuration(clientId, elapsed)
          setPhase({ kind: 'done', elapsed })
          onTopicsAdded(Array.isArray(data.newTopicIds) ? data.newTopicIds : [])
          // Reset form after 4s
          setTimeout(() => {
            setPhase({ kind: 'idle' })
            setStep(1)
            setUserInput('')
            setSelectedVertical(null)
            setRecency('7d')
            setCurrentStep(null)
          }, 4000)
        } else if (data.status === 'failed') {
          stopPolling()
          setPhase({ kind: 'error', message: data.errorMessage ?? 'Research failed', preservedInput: userInput })
        }
      } catch { /* ignore poll errors */ }
    }, 3000)
  }

  const handleStart = async () => {
    setPhase({ kind: 'polling', jobId: '', startMs: Date.now() })
    setElapsedSecs(0)
    setCurrentStep('Building your research brief')
    try {
      const res = await apiFetch('/api/v1/topic-queue/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, verticalId: selectedVertical, userInput, recencyWindow: recency }),
      })
      const { data, error: err } = await res.json()
      if (!res.ok || !data?.jobId) {
        setPhase({ kind: 'error', message: err ?? 'Failed to start research', preservedInput: userInput })
        return
      }
      const startMs = Date.now()
      setPhase({ kind: 'polling', jobId: data.jobId, startMs })
      setElapsedSecs(0)
      startPolling(data.jobId, startMs)
    } catch {
      setPhase({ kind: 'error', message: 'Network error — try again', preservedInput: userInput })
    }
  }

  const durations = loadDurations(clientId)
  const showAvg = durations.length >= 2
  const avgSecs = showAvg ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  const PILL_BTN = (active: boolean) => ({
    fontSize: 12, fontWeight: 500, borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
    border: active ? '1.5px solid #534AB7' : '1px solid #e5e7eb',
    backgroundColor: active ? '#EEEDFE' : '#f9fafb',
    color: active ? '#534AB7' : '#6b7280',
  } as React.CSSProperties)

  const isPolling = phase.kind === 'polling'
  const isDone    = phase.kind === 'done'
  const isError   = phase.kind === 'error'

  return (
    <div ref={flowRef} style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {/* Section header */}
      <div style={{ padding: '12px 14px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#111827', margin: 0 }}>Research Topic</p>
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>Run a one-off research pass to find topic angles</p>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Polling / running state ───────────────────────────────── */}
        {(isPolling || isDone) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isDone ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <Icons.CheckCircle className="h-4 w-4 text-green-600" />
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Done in {fmtElapsed(phase.elapsed)}</span>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
                  We're on it. Feel free to keep working — we'll notify you when topics are ready.
                </p>
                {currentStep && (
                  <p style={{ fontSize: 12, color: '#534AB7', fontWeight: 500, margin: 0 }}>
                    {currentStep}…
                  </p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Animated dots */}
                  <span style={{ display: 'flex', gap: 3 }}>
                    {[0, 150, 300].map((d) => (
                      <span key={d} style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#534AB7', display: 'inline-block', animation: `bounce 1s ${d}ms infinite` }} />
                    ))}
                  </span>
                  {/* Live elapsed timer */}
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#374151', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
                    {fmtElapsed(elapsedSecs)}
                  </span>
                </div>
                {showAvg && (
                  <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>
                    Your last {durations.length} run{durations.length !== 1 ? 's' : ''} averaged {avgSecs}s
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Error state ───────────────────────────────────────────── */}
        {isError && (
          <div style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
            <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 6px', fontWeight: 500 }}>Research failed</p>
            <p style={{ fontSize: 11, color: '#991b1b', margin: '0 0 8px' }}>{phase.message}</p>
            <button type="button"
              onClick={() => { setPhase({ kind: 'idle' }); setUserInput(phase.preservedInput); setStep(3) }}
              style={{ fontSize: 12, fontWeight: 600, color: '#534AB7', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Try again →
            </button>
          </div>
        )}

        {/* ── Form steps (hidden while polling) ───────────────────── */}
        {!isPolling && !isDone && !isError && (
          <>
            {/* Completed step summaries */}
            {step >= 2 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, backgroundColor: '#f9fafb', border: '1px solid #f3f4f6' }}>
                <Icons.CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>
                  {userInput.length > 60 ? userInput.slice(0, 60) + '…' : userInput}
                </span>
                <button type="button" onClick={() => setStep(1)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <Icons.Pencil className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
            )}

            {step >= 3 && verticals.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, backgroundColor: '#f9fafb', border: '1px solid #f3f4f6' }}>
                <Icons.CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>
                  {verticals.find((v) => v.id === selectedVertical)?.name ?? 'All verticals'}
                </span>
                <button type="button" onClick={() => setStep(2)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <Icons.Pencil className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
            )}

            {/* Step 1 */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#374151', margin: 0 }}>What do you want to write about?</p>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="e.g. what the new EU AI Act means for enterprise software buyers"
                  rows={3}
                  style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '10px 12px', fontSize: 12, color: '#111827', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
                  onFocus={(e) => e.target.style.borderColor = '#534AB7'}
                  onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                />
                <button
                  type="button"
                  onClick={() => { if (verticals.length <= 1) { setSelectedVertical(verticals[0]?.id ?? null); setStep(3) } else { setStep(2) } }}
                  disabled={userInput.trim().length < 3}
                  style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '7px 16px', border: 'none', backgroundColor: userInput.trim().length < 3 ? '#e5e7eb' : '#534AB7', color: userInput.trim().length < 3 ? '#9ca3af' : '#ffffff', cursor: userInput.trim().length < 3 ? 'not-allowed' : 'pointer' }}
                >
                  Continue →
                </button>
              </div>
            )}

            {/* Step 2 — vertical picker */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#374151', margin: 0 }}>Who is this for?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {verticals.map((v) => (
                    <button key={v.id} type="button" onClick={() => setSelectedVertical(v.id === selectedVertical ? null : v.id)}
                      style={PILL_BTN(selectedVertical === v.id)}>
                      {v.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!selectedVertical}
                  style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '7px 16px', border: 'none', backgroundColor: !selectedVertical ? '#e5e7eb' : '#534AB7', color: !selectedVertical ? '#9ca3af' : '#ffffff', cursor: !selectedVertical ? 'not-allowed' : 'pointer' }}
                >
                  Continue →
                </button>
              </div>
            )}

            {/* Step 3 — recency + run */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#374151', margin: 0 }}>How recent should the research be?</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['7d', 'This week'], ['30d', 'This month'], ['90d', 'Last 90 days']] as [RecencyWindow, string][]).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setRecency(val)} style={PILL_BTN(recency === val)}>{label}</button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleStart}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', backgroundColor: '#534AB7', color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Icons.Sparkles className="h-4 w-4" />
                  Find topics
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── AssignmentPanel — right-side drawer for content generation ─────────────────

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

function avatarBgColor(name: string): string {
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#6366f1']
  const idx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  return colors[idx]
}

const CATEGORY_COLORS_AP: Record<string, string> = {
  Copy:      'bg-blue-500/10 text-blue-600',
  Creative:  'bg-purple-500/10 text-purple-600',
  Strategy:  'bg-amber-500/10 text-amber-600',
  Marketing: 'bg-green-500/10 text-green-600',
  Design:    'bg-pink-500/10 text-pink-600',
  Business:  'bg-slate-500/10 text-slate-600',
}

interface CheckedItem {
  promptTemplateId: string
  promptName: string
  packId: string
}

function AssignmentPanel({
  clientId,
  selectedTopics,
  onClose,
  onGenerated,
}: {
  clientId: string
  selectedTopics: TopicItem[]
  onClose: () => void
  onGenerated: () => void
}) {
  const [members, setMembers] = useState<LeadershipTarget[]>([])
  const [verticals, setVerticals] = useState<VerticalTarget[]>([])
  const [packs, setPacks] = useState<ContentPack[]>([])
  const [loadingTargets, setLoadingTargets] = useState(true)

  type TargetType = 'member' | 'vertical' | 'company'
  const [targetType, setTargetType] = useState<TargetType | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const [defaultPackItems, setDefaultPackItems] = useState<ContentPackItem[]>([])
  const [loadingPackItems, setLoadingPackItems] = useState(false)
  const [defaultPackId, setDefaultPackId] = useState<string | null>(null)
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set())
  const [expandedPackItems, setExpandedPackItems] = useState<Record<string, ContentPackItem[]>>({})
  const [loadingExpandedPack, setLoadingExpandedPack] = useState<string | null>(null)
  const [checkedItems, setCheckedItems] = useState<Map<string, CheckedItem>>(new Map())
  const [generating, setGenerating] = useState(false)
  const [successMsg, setSuccessMsg] = useState(false)
  const [contentTabView, setContentTabView] = useState<'packs' | 'prompts'>('packs')
  const [promptSearch, setPromptSearch] = useState('')
  const [allPrompts, setAllPrompts] = useState<PromptItem[]>([])
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [promptsLoaded, setPromptsLoaded] = useState(false)

  // Load leadership members, verticals, and all packs
  useEffect(() => {
    setLoadingTargets(true)
    Promise.all([
      apiFetch(`/api/v1/leadership?clientId=${clientId}`).then((r) => r.json()),
      apiFetch(`/api/v1/clients/${clientId}/verticals`).then((r) => r.json()),
      apiFetch(`/api/v1/content-packs?clientId=${clientId}`).then((r) => r.json()),
    ])
      .then(([membersRes, verticalsRes, packsRes]) => {
        setMembers(membersRes.data ?? [])
        setVerticals(verticalsRes.data ?? [])
        setPacks(packsRes.data ?? [])
      })
      .catch(console.error)
      .finally(() => setLoadingTargets(false))
  }, [clientId])

  // When target changes, load its default pack items
  useEffect(() => {
    if (!targetType || (targetType !== 'company' && !targetId)) {
      setDefaultPackItems([])
      setDefaultPackId(null)
      setCheckedItems(new Map())
      return
    }

    // Find the defaultContentPackId for the selected target
    let packId: string | null = null
    if (targetType === 'member') {
      packId = members.find((m) => m.id === targetId)?.defaultContentPackId ?? null
    } else if (targetType === 'vertical') {
      packId = verticals.find((v) => v.id === targetId)?.defaultContentPackId ?? null
    }
    // company: no default pack

    setDefaultPackId(packId)
    setDefaultPackItems([])
    setCheckedItems(new Map())

    if (packId) {
      setLoadingPackItems(true)
      apiFetch(`/api/v1/content-packs/${packId}/items`)
        .then((r) => r.json())
        .then(({ data }) => {
          const items: ContentPackItem[] = data ?? []
          setDefaultPackItems(items)
          // Pre-check all items
          const map = new Map<string, CheckedItem>()
          for (const item of items) {
            map.set(`${packId}:${item.promptTemplateId}`, {
              promptTemplateId: item.promptTemplateId,
              promptName: item.promptName,
              packId: packId!,
            })
          }
          setCheckedItems(map)
        })
        .catch(console.error)
        .finally(() => setLoadingPackItems(false))
    }
  }, [targetType, targetId, members, verticals])

  const toggleItem = (key: string, item: CheckedItem) => {
    setCheckedItems((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, item)
      return next
    })
  }

  const toggleExpandPack = async (pack: ContentPack) => {
    const isOpen = expandedPacks.has(pack.id)
    if (isOpen) {
      // Remove this pack's items from the generate list
      setCheckedItems((prev) => {
        const next = new Map(prev)
        for (const key of Array.from(next.keys())) {
          if (key.startsWith(`${pack.id}:`)) next.delete(key)
        }
        return next
      })
      setExpandedPacks((prev) => { const n = new Set(prev); n.delete(pack.id); return n })
      return
    }

    // Load items for this pack if not yet loaded
    if (!expandedPackItems[pack.id]) {
      setLoadingExpandedPack(pack.id)
      try {
        const res = await apiFetch(`/api/v1/content-packs/${pack.id}/items`)
        const { data } = await res.json()
        const items: ContentPackItem[] = data ?? []
        setExpandedPackItems((prev) => ({ ...prev, [pack.id]: items }))
        // Pre-check all items of this newly expanded pack
        setCheckedItems((prev) => {
          const next = new Map(prev)
          for (const item of items) {
            const key = `${pack.id}:${item.promptTemplateId}`
            if (!next.has(key)) {
              next.set(key, { promptTemplateId: item.promptTemplateId, promptName: item.promptName, packId: pack.id })
            }
          }
          return next
        })
      } catch { /* ignore */ }
      finally { setLoadingExpandedPack(null) }
    } else {
      // If already loaded but not checked, pre-check them
      const items = expandedPackItems[pack.id] ?? []
      setCheckedItems((prev) => {
        const next = new Map(prev)
        for (const item of items) {
          const key = `${pack.id}:${item.promptTemplateId}`
          if (!next.has(key)) {
            next.set(key, { promptTemplateId: item.promptTemplateId, promptName: item.promptName, packId: pack.id })
          }
        }
        return next
      })
    }
    setExpandedPacks((prev) => { const n = new Set(prev); n.add(pack.id); return n })
  }

  const removeFromGenerate = (key: string) => {
    setCheckedItems((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  const addIndividualPrompt = (prompt: PromptItem) => {
    setCheckedItems((prev) => {
      const next = new Map(prev)
      next.set(`individual:${prompt.id}`, {
        promptTemplateId: prompt.id,
        promptName: prompt.name,
        packId: '',
      })
      return next
    })
  }

  const handleContentTabChange = (tab: 'packs' | 'prompts') => {
    setContentTabView(tab)
    if (tab === 'prompts' && !promptsLoaded) {
      setLoadingPrompts(true)
      apiFetch(`/api/v1/template-library?clientId=${clientId}`)
        .then((r) => r.json())
        .then(({ data }) => { setAllPrompts(data ?? []); setPromptsLoaded(true) })
        .catch(console.error)
        .finally(() => setLoadingPrompts(false))
    }
  }

  const handleGenerate = async () => {
    if (!targetType || checkedItems.size === 0) return
    const topicIds = selectedTopics.filter((t) => t.status === 'approved').map((t) => t.id)
    if (topicIds.length === 0) return

    setGenerating(true)
    try {
      const items = Array.from(checkedItems.values())
      let anySucceeded = false
      for (const topicId of topicIds) {
        const res = await apiFetch('/api/v1/content-packs/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            topicId,
            targetType,
            ...(targetType !== 'company' && { targetId }),
            checkedItems: items,
          }),
        })
        if (res.ok) anySucceeded = true
        else {
          const err = await res.json().catch(() => ({})) as { error?: string }
          console.error('[generate] failed:', res.status, err)
        }
      }
      if (!anySucceeded) return
      setSuccessMsg(true)
      setTimeout(() => {
        onGenerated()
        onClose()
      }, 1200)
    } finally {
      setGenerating(false)
    }
  }

  const approvedSelected = selectedTopics.filter((t) => t.status === 'approved')
  const checkedCount = checkedItems.size
  const generateCount = approvedSelected.length * checkedCount

  // Non-default packs (for "More packs" section)
  const morePacks = packs.filter((p) => p.id !== defaultPackId)

  const selectedTarget =
    targetType === 'member' ? members.find((m) => m.id === targetId)?.name
    : targetType === 'vertical' ? verticals.find((v) => v.id === targetId)?.name
    : targetType === 'company' ? 'Company / Brand'
    : null

  const selectedTargetObj =
    targetType === 'member' ? (members.find((m) => m.id === targetId) ?? null)
    : targetType === 'vertical' ? (verticals.find((v) => v.id === targetId) ?? null)
    : null

  const destMonday = selectedTargetObj?.mondayBoardId ?? null
  const destBox = selectedTargetObj?.boxFolderId ?? null

  const filteredPrompts = promptSearch.trim()
    ? allPrompts.filter((p) =>
        p.name.toLowerCase().includes(promptSearch.toLowerCase()) ||
        (p.category ?? '').toLowerCase().includes(promptSearch.toLowerCase())
      )
    : allPrompts

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-md flex-col bg-white border-l border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-sm font-semibold">Generate content for {approvedSelected.length} topic{approvedSelected.length !== 1 ? 's' : ''}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Choose who it's for, then pick what to generate</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Selected topics pills */}
        <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b border-border shrink-0">
          {selectedTopics.filter((t) => t.status === 'approved').map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-medium text-green-700 max-w-[200px]"
            >
              <Icons.Check className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{t.title}</span>
            </span>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

          {/* ── Section 1: Who is this for? ── */}
          <div>
            <p className="text-xs font-semibold mb-2.5">Who is this for?</p>

            {loadingTargets ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Icons.Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Loading…</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* People group */}
                {members.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">People</p>
                    <div className="flex flex-col gap-1.5">
                      {members.map((m) => {
                        const isSelected = targetType === 'member' && targetId === m.id
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setTargetType('member'); setTargetId(m.id) }}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                              isSelected ? 'border-purple-500 bg-purple-500/8' : 'border-border hover:border-purple-300 hover:bg-muted/30',
                            )}
                          >
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold"
                              style={{ backgroundColor: avatarBgColor(m.name) }}
                            >
                              {getInitials(m.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-[13px] font-medium truncate', isSelected ? 'text-purple-700' : '')}>{m.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{m.role}</p>
                            </div>
                            {isSelected && <Icons.CheckCircle className="h-4 w-4 text-purple-500 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Verticals group */}
                {verticals.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Verticals</p>
                    <div className="flex flex-col gap-1.5">
                      {verticals.map((v) => {
                        const isSelected = targetType === 'vertical' && targetId === v.id
                        const color = v.color ?? '#8b5cf6'
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => { setTargetType('vertical'); setTargetId(v.id) }}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                              isSelected ? 'border-purple-500 bg-purple-500/8' : 'border-border hover:border-purple-300 hover:bg-muted/30',
                            )}
                          >
                            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <p className={cn('text-[13px] font-medium flex-1', isSelected ? 'text-purple-700' : '')}>{v.name}</p>
                            {isSelected && <Icons.CheckCircle className="h-4 w-4 text-purple-500 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Company group */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Company</p>
                  <button
                    type="button"
                    onClick={() => { setTargetType('company'); setTargetId(null) }}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      targetType === 'company' ? 'border-purple-500 bg-purple-500/8' : 'border-border hover:border-purple-300 hover:bg-muted/30',
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icons.Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className={cn('text-[13px] font-medium flex-1', targetType === 'company' ? 'text-purple-700' : '')}>Company / Brand</p>
                    {targetType === 'company' && <Icons.CheckCircle className="h-4 w-4 text-purple-500 shrink-0" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Section 2: What to generate ── */}
          {targetType && (
            <div>
              <p className="text-xs font-semibold mb-2.5">What to generate</p>

              {/* Generate list */}
              {checkedItems.size > 0 ? (
                <div className="flex flex-col gap-1 mb-3">
                  {Array.from(checkedItems.entries()).map(([key, item]) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 bg-muted/20"
                    >
                      <Icons.FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-[12px] truncate">{item.promptName}</span>
                      <button
                        type="button"
                        onClick={() => removeFromGenerate(key)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <Icons.X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mb-3 px-1">
                  Nothing selected yet — add packs or prompts below.
                </p>
              )}

              {/* Tab toggle */}
              <div className="flex border-b border-border mb-3">
                <button
                  type="button"
                  onClick={() => handleContentTabChange('packs')}
                  className={cn(
                    'px-3 py-1.5 text-[12px] font-medium border-b-2 -mb-px transition-colors',
                    contentTabView === 'packs'
                      ? 'border-purple-500 text-purple-700'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  Packs
                </button>
                <button
                  type="button"
                  onClick={() => handleContentTabChange('prompts')}
                  className={cn(
                    'px-3 py-1.5 text-[12px] font-medium border-b-2 -mb-px transition-colors',
                    contentTabView === 'prompts'
                      ? 'border-purple-500 text-purple-700'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  Prompts
                </button>
              </div>

              {/* Packs tab */}
              {contentTabView === 'packs' && (
                <>
                  {loadingPackItems ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Icons.Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Loading pack…</span>
                    </div>
                  ) : defaultPackItems.length === 0 && !defaultPackId ? (
                    <p className="text-xs text-muted-foreground mb-3">
                      No default pack set for {selectedTarget ?? 'this target'}. Add packs below or set a default in their profile.
                    </p>
                  ) : (
                    <>
                      {defaultPackItems.length > 0 && (
                        <div className="flex flex-col gap-1.5 mb-3">
                          {defaultPackItems.map((item) => {
                            const key = `${defaultPackId}:${item.promptTemplateId}`
                            const checked = checkedItems.has(key)
                            return (
                              <label
                                key={item.id}
                                className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleItem(key, { promptTemplateId: item.promptTemplateId, promptName: item.promptName, packId: defaultPackId! })}
                                  className="h-3.5 w-3.5 accent-purple-600 shrink-0 mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <span className="text-[13px] font-medium block truncate">{item.promptName}</span>
                                  {item.promptDescription && (
                                    <span className="text-[11px] text-muted-foreground block truncate">{item.promptDescription}</span>
                                  )}
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* More packs */}
                  {morePacks.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground mb-2">
                        {defaultPackItems.length > 0 ? 'More packs' : 'Available packs'}
                      </p>
                      <div className="flex flex-col gap-2">
                        {morePacks.map((pack) => {
                          const isExpanded = expandedPacks.has(pack.id)
                          const isLoading = loadingExpandedPack === pack.id
                          const packItems = expandedPackItems[pack.id] ?? []
                          return (
                            <div key={pack.id} className="rounded-lg border border-border overflow-hidden">
                              <button
                                type="button"
                                onClick={() => toggleExpandPack(pack)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                              >
                                <Icons.Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-[12px] font-medium flex-1">{pack.name}</span>
                                <span className="text-[11px] text-muted-foreground shrink-0">{pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}</span>
                                {isLoading
                                  ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                                  : isExpanded
                                    ? <span className="text-[11px] text-muted-foreground font-medium shrink-0 ml-1">Remove</span>
                                    : <span className="text-[11px] text-blue-600 font-medium shrink-0 ml-1">Add</span>
                                }
                              </button>
                              {isExpanded && packItems.length > 0 && (
                                <div className="flex flex-col divide-y divide-border">
                                  {packItems.map((item) => (
                                    <div key={item.id} className="px-3 py-2">
                                      <p className="text-[12px] font-medium truncate">{item.promptName}</p>
                                      {item.promptDescription && (
                                        <p className="text-[11px] text-muted-foreground truncate">{item.promptDescription}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {isExpanded && packItems.length === 0 && !isLoading && (
                                <p className="text-[11px] text-muted-foreground px-3 py-2">No prompts in this pack.</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Prompts tab */}
              {contentTabView === 'prompts' && (
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={promptSearch}
                      onChange={(e) => setPromptSearch(e.target.value)}
                      placeholder="Search prompts…"
                      className="w-full rounded-lg border border-border pl-8 pr-3 py-1.5 text-[12px] outline-none focus:border-purple-400"
                    />
                  </div>
                  {loadingPrompts ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Icons.Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Loading prompts…</span>
                    </div>
                  ) : filteredPrompts.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-3 text-center">
                      {promptSearch ? 'No prompts match your search.' : 'No prompts in this client\'s library.'}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                      {filteredPrompts.map((prompt) => {
                        const key = `individual:${prompt.id}`
                        const isAdded = checkedItems.has(key)
                        return (
                          <div
                            key={prompt.id}
                            className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium truncate">{prompt.name}</p>
                              {prompt.category && (
                                <p className="text-[11px] text-muted-foreground truncate">{prompt.category}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => isAdded ? removeFromGenerate(key) : addIndividualPrompt(prompt)}
                              className={cn(
                                'shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border transition-colors',
                                isAdded
                                  ? 'border-border text-muted-foreground hover:text-foreground'
                                  : 'border-blue-400 text-blue-600 hover:bg-blue-50',
                              )}
                            >
                              {isAdded ? 'Added' : 'Add'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Section 3: Destinations ── */}
          {targetType && (
            <div>
              <p className="text-xs font-semibold mb-2.5">Destinations</p>
              <div className="flex flex-col gap-2">
                {/* monday.com row */}
                <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
                  <div className="h-6 w-6 shrink-0 flex items-center justify-center rounded bg-orange-100">
                    <span className="text-[10px] font-bold text-orange-600">M</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">monday.com</p>
                    <p className="text-[11px] text-muted-foreground">
                      {destMonday ? 'Tasks will be created on completion' : 'Not configured — set up in target profile'}
                    </p>
                  </div>
                  {destMonday
                    ? <Icons.CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <Icons.Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  }
                </div>

                {/* Box row */}
                <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
                  <div className="h-6 w-6 shrink-0 flex items-center justify-center rounded bg-blue-100">
                    <span className="text-[10px] font-bold text-blue-600">B</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium">Box</p>
                    <p className="text-[11px] text-muted-foreground">
                      {destBox ? 'Files will be exported on completion' : 'Not configured — set up in target profile'}
                    </p>
                  </div>
                  {destBox
                    ? <Icons.CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <Icons.Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  }
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer — Generate button */}
        <div className="border-t border-border px-5 py-4 shrink-0">
          {successMsg ? (
            <div className="flex items-center gap-2 justify-center py-2 text-green-600">
              <Icons.CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Generation started!</span>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={generating || checkedCount === 0 || !targetType || approvedSelected.length === 0}
              onClick={handleGenerate}
              style={{ backgroundColor: checkedCount > 0 && targetType ? '#a200ee' : undefined }}
            >
              {generating
                ? <><Icons.Loader2 className="h-4 w-4 animate-spin mr-2" />Generating…</>
                : generateCount > 0
                  ? `Generate ${generateCount} piece${generateCount !== 1 ? 's' : ''}`
                  : 'Select prompts to generate'
              }
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ContentNewsroomTab({ clientId, onAddTask }: { clientId: string; onAddTask?: () => void }) {
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [meta, setMeta] = useState<NewsroomMeta | null>(null)
  const [verticals, setVerticals] = useState<VerticalOption[]>([])
  const [activeVertical, setActiveVertical] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [newTopicIds, setNewTopicIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(false)
  const [panelTopics, setPanelTopics] = useState<TopicItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const pilotRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = activeVertical ? `?verticalId=${activeVertical}` : ''
      const res = await apiFetch(`/api/v1/topic-queue/${clientId}${params}`)
      if (!res.ok) throw new Error('Failed to load topics')
      const { data, meta: m } = await res.json()
      setTopics(data ?? [])
      setMeta(m ?? null)

      // Merge verticals from topics
      const seen = new Map<string, VerticalOption>()
      for (const t of (data ?? []) as TopicItem[]) {
        if (t.vertical) seen.set(t.vertical.id, t.vertical)
      }
      if (seen.size > 0) setVerticals((prev) => {
        const merged = new Map(prev.map((v) => [v.id, v]))
        seen.forEach((v, k) => merged.set(k, v))
        return Array.from(merged.values())
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [clientId, activeVertical])

  // Load verticals independently (includes color field)
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (Array.isArray(data) && data.length > 0) {
          setVerticals((prev) => {
            const merged = new Map(prev.map((v) => [v.id, v]))
            for (const v of data as VerticalOption[]) merged.set(v.id, v)
            return Array.from(merged.values())
          })
        }
      })
      .catch(() => {})
  }, [clientId])

  useEffect(() => { load() }, [load])

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    setActionLoading(id)
    try {
      const res = await apiFetch(`/api/v1/topic-queue/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setTopics((prev) => prev.filter((t) => t.id !== id))
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    } catch { /* silently ignore */ }
    finally { setActionLoading(null) }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const clearSelection = () => setSelected(new Set())
  const selectAll = () => setSelected(new Set(topics.map((t) => t.id)))

  const bulkAction = async (status: 'approved' | 'rejected') => {
    for (const id of Array.from(selected)) await updateStatus(id, status)
    clearSelection()
  }

  const openGeneratePanel = () => {
    const approvedTopics = topics.filter((t) => selected.has(t.id) && t.status === 'approved')
    if (approvedTopics.length === 0) return
    setPanelTopics(approvedTopics)
    setShowAssignmentPanel(true)
  }

  // Single-card approve: snapshot the topic as 'approved' for the panel only.
  // topics state is NOT mutated — the topic stays pending in the queue until
  // the user confirms generation. Closing the panel needs no cleanup.
  const handleApproveSingle = (id: string) => {
    const topic = topics.find((t) => t.id === id)
    if (!topic) return
    setPanelTopics([{ ...topic, status: 'approved' as const }])
    setShowAssignmentPanel(true)
  }

  const handleTopicsAdded = (ids: string[]) => {
    setNewTopicIds(new Set(ids))
    load()
    setTimeout(() => setNewTopicIds(new Set()), 8000)
  }

  const scrollToPilot = () => {
    pilotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const pendingTopics  = topics.filter((t) => t.status === 'pending')
  const approvedTopics = topics.filter((t) => t.status === 'approved')
  const selectedApproved = approvedTopics.filter((t) => selected.has(t.id))

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

      {/* ── Left column — topic queue ──────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Icons.Newspaper className="h-5 w-5 text-violet-500" />
              <h2 className="text-[15px] font-semibold">Content Newsroom</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review AI-scored topics. Approve to generate blogs, reject to train your preference profile.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={scrollToPilot}>
              <Icons.Search className="h-3.5 w-3.5 mr-1.5" />
              Research topic
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <Icons.RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Brain status bar */}
        {meta && (
          <div style={{ borderRadius: 8, padding: '10px 14px', backgroundColor: meta.hasPreferenceProfile ? '#fdf5ff' : '#f9fafb', border: `1px solid ${meta.hasPreferenceProfile ? '#e9d5ff' : '#e5e7eb'}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icons.Brain className={cn('h-4 w-4 shrink-0', meta.hasPreferenceProfile ? 'text-violet-500' : 'text-gray-400')} />
            <p style={{ fontSize: 12, color: meta.hasPreferenceProfile ? '#7c00cc' : '#6b7280', margin: 0 }}>
              {meta.hasPreferenceProfile
                ? `Preference profile active — ${meta.totalDecisions} decision${meta.totalDecisions !== 1 ? 's' : ''} recorded${meta.verticalCount > 1 ? ` across ${meta.verticalCount} verticals` : ''}. Topic scoring is personalized.`
                : 'No preference profile yet. Approve and reject topics to train the system — a profile is built after every 10 decisions.'}
            </p>
          </div>
        )}

        {/* Vertical filter pills */}
        {verticals.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setActiveVertical(null)}
              style={{ fontSize: 11, fontWeight: 500, borderRadius: 20, padding: '4px 12px', border: activeVertical === null ? '1.5px solid #a200ee' : '1px solid #e5e7eb', backgroundColor: activeVertical === null ? '#fdf5ff' : '#f9fafb', color: activeVertical === null ? '#7c00cc' : '#6b7280', cursor: 'pointer' }}>
              All verticals
            </button>
            {verticals.map((v) => {
              const color = verticalColor(v.id, v.color)
              return (
                <button key={v.id} type="button" onClick={() => setActiveVertical(activeVertical === v.id ? null : v.id)}
                  style={{ fontSize: 11, fontWeight: 500, borderRadius: 20, padding: '4px 12px', border: activeVertical === v.id ? `1.5px solid ${color}` : '1px solid #e5e7eb', backgroundColor: activeVertical === v.id ? `${color}18` : '#f9fafb', color: activeVertical === v.id ? color : '#6b7280', cursor: 'pointer' }}>
                  {v.name}
                </button>
              )
            })}
          </div>
        )}

        {/* Selection bar */}
        {selected.size > 0 && (
          <div style={{ borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#fdf5ff', border: '1.5px solid #e9d5ff' }}>
            <span style={{ fontSize: 12, color: '#7c00cc', fontWeight: 600, flex: 1 }}>{selected.size} selected</span>
            <button type="button" onClick={() => bulkAction('rejected')} style={{ fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', border: '1px solid #fee2e2', backgroundColor: '#fff7f7', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icons.X className="h-3 w-3" /> Reject all
            </button>
            <button type="button" onClick={() => bulkAction('approved')} style={{ fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icons.Check className="h-3 w-3" /> Approve all
            </button>
            {selectedApproved.length > 0 && (
              <button type="button" onClick={openGeneratePanel} disabled={generating}
                style={{ fontSize: 12, fontWeight: 600, borderRadius: 6, padding: '5px 14px', cursor: generating ? 'not-allowed' : 'pointer', border: 'none', backgroundColor: '#a200ee', color: '#ffffff', opacity: generating ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {generating ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Sparkles className="h-3 w-3" />}
                Generate {selectedApproved.length}
              </button>
            )}
            <button type="button" onClick={clearSelection} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} style={{ height: 90, borderRadius: 10, backgroundColor: '#f3f4f6' }} />)}
          </div>
        )}

        {/* Pending topics */}
        {!loading && pendingTopics.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                Pending review — {pendingTopics.length}
              </p>
              <button type="button" onClick={selected.size === pendingTopics.length ? clearSelection : selectAll}
                style={{ fontSize: 11, color: '#a200ee', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                {selected.size === pendingTopics.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            {pendingTopics.map((t) => (
              <TopicCard key={t.id} topic={t} selected={selected.has(t.id)} isNew={newTopicIds.has(t.id)}
                onSelect={toggleSelect} onApprove={handleApproveSingle} onReject={(id) => updateStatus(id, 'rejected')}
                loading={actionLoading === t.id} />
            ))}
          </div>
        )}

        {/* Approved topics */}
        {!loading && approvedTopics.length > 0 && (
          <div className="space-y-3">
            <p style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Approved — ready to generate
            </p>
            {approvedTopics.map((t) => (
              <TopicCard key={t.id} topic={t} selected={selected.has(t.id)} isNew={newTopicIds.has(t.id)}
                onSelect={toggleSelect} onApprove={(id) => updateStatus(id, 'approved')} onReject={(id) => updateStatus(id, 'rejected')}
                loading={actionLoading === t.id} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && pendingTopics.length === 0 && approvedTopics.length === 0 && (
          <div style={{ borderRadius: 12, border: '1px dashed #e5e7eb', padding: '48px 24px', textAlign: 'center' }}>
            <Icons.Newspaper className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No topics waiting for review</p>
            <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, maxWidth: 360, marginInline: 'auto' }}>
              Use "Research topic" on the right to run a one-off research pass, or configure a scheduled task with "Evaluate and queue" mode.
            </p>
          </div>
        )}
      </div>

      {/* ── Right column — sidebar ─────────────────────────────────── */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: '0.5px solid var(--border)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Section 1: Research Topic flow */}
        <ResearchTopicFlow
          clientId={clientId}
          verticals={verticals}
          onTopicsAdded={handleTopicsAdded}
          flowRef={pilotRef}
        />

        {/* Section 2: Research Tasks */}
        <ResearchTasksSidebar
          clientId={clientId}
          onAddTask={onAddTask}
          onToggleNewsroom={async () => { /* state update handled inside component */ }}
          onRunTask={() => { /* could refresh topics after a delay */ }}
        />
      </div>

      {/* ── Assignment panel ───────────────────────────────────────── */}
      {showAssignmentPanel && (
        <AssignmentPanel
          clientId={clientId}
          selectedTopics={panelTopics}
          onClose={() => {
            // topics state was never mutated — just close, no cleanup needed
            setPanelTopics([])
            setShowAssignmentPanel(false)
          }}
          onGenerated={async () => {
            // Persist approved status for confirmed topics then reload
            for (const t of panelTopics) {
              await apiFetch(`/api/v1/topic-queue/${t.id}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'approved' }),
              }).catch(console.error)
            }
            setPanelTopics([])
            setGenerating(true)
            setShowAssignmentPanel(false)
            clearSelection()
            setTimeout(() => { setGenerating(false); load() }, 1500)
          }}
        />
      )}
    </div>
  )
}
