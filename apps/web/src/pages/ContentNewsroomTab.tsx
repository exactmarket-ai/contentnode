import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  vertical: { id: string; name: string } | null
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
  vertical: { id: string; name: string } | null
}

interface VerticalOption {
  id: string
  name: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_TYPE_META: Record<string, { label: string; icon: keyof typeof Icons; color: string }> = {
  web_scrape:      { label: 'Web Scrape',      icon: 'Globe',       color: 'text-blue-500' },
  review_miner:    { label: 'Review Miner',    icon: 'Star',        color: 'text-amber-500' },
  audience_signal: { label: 'Audience Signal', icon: 'Users',       color: 'text-green-500' },
  seo_intent:      { label: 'SEO Intent',      icon: 'TrendingUp',  color: 'text-purple-500' },
  research_brief:  { label: 'Research Brief',  icon: 'FileText',    color: 'text-indigo-500' },
}

const VERTICAL_DOT_COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#6366f1']

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
              <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 8px', backgroundColor: '#ede9fe', color: '#6d28d9', fontWeight: 500, flexShrink: 0 }}>
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

  // Group by vertical (null = client-level)
  const groups = new Map<string, { label: string; color: string; tasks: TaskRow[] }>()
  let colorIdx = 0
  for (const t of tasks) {
    const key = t.vertical?.id ?? '__client__'
    if (!groups.has(key)) {
      groups.set(key, {
        label: t.vertical?.name ?? 'Client-level',
        color: VERTICAL_DOT_COLORS[colorIdx++ % VERTICAL_DOT_COLORS.length],
        tasks: [],
      })
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

// ── Research Topic Flow (blogPILOT-style stepped form) ────────────────────────

type RecencyWindow = '7d' | '30d' | '90d'

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
  const [running, setRunning] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-skip step 2 if only one vertical
  useEffect(() => {
    if (step === 2 && verticals.length === 1) {
      setSelectedVertical(verticals[0].id)
      setStep(3)
    }
  }, [step, verticals])

  const reset = () => {
    setStep(1)
    setUserInput('')
    setSelectedVertical(null)
    setRecency('7d')
    setError(null)
  }

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await apiFetch('/api/v1/topic-queue/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, verticalId: selectedVertical, userInput, recencyWindow: recency }),
      })
      const { data, error: err } = await res.json()
      if (!res.ok) { setError(err ?? 'Research failed'); return }
      const ids = (data?.newTopicIds ?? []) as string[]
      onTopicsAdded(ids)
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
      }, 3000)
    } catch {
      setError('Network error — try again')
    } finally {
      setRunning(false)
    }
  }

  const PILL_BTN = (active: boolean) => ({
    fontSize: 12, fontWeight: 500, borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
    border: active ? '1.5px solid #534AB7' : '1px solid #e5e7eb',
    backgroundColor: active ? '#EEEDFE' : '#f9fafb',
    color: active ? '#534AB7' : '#6b7280',
  } as React.CSSProperties)

  return (
    <div ref={flowRef} style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {/* Section header */}
      <div style={{ padding: '12px 14px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#111827', margin: 0 }}>Research Topic</p>
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>Run a one-off research pass to find topic angles</p>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Completed step summaries ─────────────────────────────── */}
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

        {/* ── Step 1 ───────────────────────────────────────────────── */}
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
              disabled={userInput.trim().length < 10}
              style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '7px 16px', border: 'none', backgroundColor: userInput.trim().length < 10 ? '#e5e7eb' : '#534AB7', color: userInput.trim().length < 10 ? '#9ca3af' : '#ffffff', cursor: userInput.trim().length < 10 ? 'not-allowed' : 'pointer' }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 2 — vertical picker ─────────────────────────────── */}
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

        {/* ── Step 3 — recency + run ────────────────────────────────── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: '#374151', margin: 0 }}>How recent should the research be?</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['7d', 'This week'], ['30d', 'This month'], ['90d', 'Last 90 days']] as [RecencyWindow, string][]).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setRecency(val)} style={PILL_BTN(recency === val)}>{label}</button>
              ))}
            </div>

            {error && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>
                {error} — <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#534AB7', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: 0 }}>Try again</button>
              </p>
            )}

            {success ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <Icons.CheckCircle className="h-4 w-4 text-green-600" />
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Topics added to queue</span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={run}
                  disabled={running}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', backgroundColor: '#534AB7', color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.75 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {running ? <Icons.Loader2 className="h-4 w-4 animate-spin" /> : <Icons.Sparkles className="h-4 w-4" />}
                  {running ? 'Researching…' : 'Find topics'}
                </button>
                {running && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                    <span style={{ display: 'flex', gap: 3 }}>
                      {[0, 150, 300].map((d) => (
                        <span key={d} style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#534AB7', display: 'inline-block', animation: `bounce 1s ${d}ms infinite` }} />
                      ))}
                    </span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Researching — this usually takes about 30 seconds</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
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

      // collect verticals from topics + any already known
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

  // Load verticals independently so right sidebar has them even before topics
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

  const generateBlogs = async () => {
    const approvedIds = topics.filter((t) => selected.has(t.id) && t.status === 'approved').map((t) => t.id)
    if (approvedIds.length === 0) return
    setGenerating(true)
    try {
      const res = await apiFetch('/api/v1/topic-queue/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: approvedIds }),
      })
      if (!res.ok) throw new Error('Failed to generate')
      clearSelection()
      load()
    } catch { /* ignore */ }
    finally { setGenerating(false) }
  }

  const handleTopicsAdded = (ids: string[]) => {
    setNewTopicIds(new Set(ids))
    load()
    // Clear new highlights after 8 seconds
    setTimeout(() => setNewTopicIds(new Set()), 8000)
  }

  const scrollToPilot = () => {
    pilotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const pendingTopics = topics.filter((t) => t.status === 'pending')
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
            {verticals.map((v) => (
              <button key={v.id} type="button" onClick={() => setActiveVertical(activeVertical === v.id ? null : v.id)}
                style={{ fontSize: 11, fontWeight: 500, borderRadius: 20, padding: '4px 12px', border: activeVertical === v.id ? '1.5px solid #a200ee' : '1px solid #e5e7eb', backgroundColor: activeVertical === v.id ? '#fdf5ff' : '#f9fafb', color: activeVertical === v.id ? '#7c00cc' : '#6b7280', cursor: 'pointer' }}>
                {v.name}
              </button>
            ))}
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
              <button type="button" onClick={generateBlogs} disabled={generating}
                style={{ fontSize: 12, fontWeight: 600, borderRadius: 6, padding: '5px 14px', cursor: generating ? 'not-allowed' : 'pointer', border: 'none', backgroundColor: '#a200ee', color: '#ffffff', opacity: generating ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {generating ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Sparkles className="h-3 w-3" />}
                Generate {selectedApproved.length} blog{selectedApproved.length !== 1 ? 's' : ''}
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
                onSelect={toggleSelect} onApprove={(id) => updateStatus(id, 'approved')} onReject={(id) => updateStatus(id, 'rejected')}
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

        {/* Section 1: Research Tasks */}
        <ResearchTasksSidebar
          clientId={clientId}
          onAddTask={onAddTask}
          onToggleNewsroom={async () => { /* state update handled inside component */ }}
          onRunTask={() => { /* could refresh topics after a delay */ }}
        />

        {/* Section 2: Research Topic flow */}
        <ResearchTopicFlow
          clientId={clientId}
          verticals={verticals}
          onTopicsAdded={handleTopicsAdded}
          flowRef={pilotRef}
        />
      </div>
    </div>
  )
}
