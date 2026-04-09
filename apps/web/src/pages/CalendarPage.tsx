import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarRun {
  id: string
  workflowId: string
  workflowName: string
  clientId: string | null
  clientName: string | null
  status: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  feedback: { decision: string | null; starRating: number | null } | null
  detectionScore: number | null
}

interface ScheduledRun {
  id: string
  workflowId: string
  workflowName: string
  clientId: string | null
  clientName: string | null
  nextRunAt: string
  cronExpr: string
  timezone: string
  status: string
}

interface Client { id: string; name: string }
interface Workflow { id: string; name: string; clientId: string | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function buildGrid(year: number, month: number): Date[] {
  const firstDay   = new Date(year, month - 1, 1)
  const startOffset = firstDay.getDay()
  const gridStart  = new Date(year, month - 1, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function toLocalDateKey(iso: string): string {
  // Keep the UTC date string from the ISO — e.g. "2026-04-07T09:00:00.000Z" → "2026-04-07"
  return iso.slice(0, 10)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function statusPill(status: string): string {
  switch (status) {
    case 'completed': return 'bg-[#d0e8b0] text-[#3b6d11] border-[#3b6d11]'
    case 'failed':    return 'bg-red-100 text-red-700 border-red-300/50'
    default:          return 'bg-amber-100 text-amber-700 border-amber-300/50'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <Icons.CheckCircle2 className="h-3 w-3 shrink-0" />
    case 'failed':    return <Icons.XCircle className="h-3 w-3 shrink-0" />
    default:          return <Icons.Clock className="h-3 w-3 shrink-0" />
  }
}

function detectionColor(score: number): string {
  if (score < 15) return 'text-emerald-600'
  if (score <= 35) return 'text-amber-600'
  return 'text-red-600'
}

// ─── Day Cell ─────────────────────────────────────────────────────────────────

function DayCell({
  date, inMonth, isToday, isSelected, runs, schedules, onClick,
}: {
  date: Date
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  runs: CalendarRun[]
  schedules: ScheduledRun[]
  onClick: () => void
}) {
  const total = runs.length + schedules.length
  const MAX_PILLS = 3
  const overflow = total - MAX_PILLS

  const pills: { label: string; cls: string; key: string }[] = []
  for (const r of runs) {
    if (pills.length >= MAX_PILLS) break
    pills.push({ key: r.id, label: r.workflowName, cls: statusPill(r.status) })
  }
  for (const s of schedules) {
    if (pills.length >= MAX_PILLS) break
    pills.push({ key: s.id, label: `${formatTime(s.nextRunAt)} ${s.workflowName}`, cls: 'bg-violet-100 text-violet-700 border-violet-300/50' })
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col gap-0.5 rounded-lg border p-1.5 text-left transition-colors min-h-[80px]',
        inMonth ? 'bg-card hover:bg-accent/40' : 'bg-background/40 hover:bg-accent/20',
        isSelected ? 'border-blue-500 bg-blue-50/60' : 'border-border',
        isToday && !isSelected && 'border-blue-500/50',
      )}
    >
      <span className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium self-end mb-0.5',
        isToday ? 'bg-blue-500 text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground/40',
      )}>
        {date.getDate()}
      </span>

      {pills.map((p) => (
        <span key={p.key} className={cn('inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] font-medium truncate w-full', p.cls)}>
          <span className="truncate">{p.label}</span>
        </span>
      ))}

      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground/60 pl-0.5">+{overflow} more</span>
      )}
    </button>
  )
}

// ─── Schedule Form ────────────────────────────────────────────────────────────

function ScheduleForm({
  date,
  onScheduled,
  onCancel,
}: {
  date: Date
  onScheduled: () => void
  onCancel: () => void
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [time, setTime] = useState('09:00')
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/workflows')
      .then((r) => r.json())
      .then(({ data }) => {
        const active = (data ?? []).filter((w: Workflow & { status: string }) => w.status !== 'archived')
        setWorkflows(active)
        if (active.length > 0) setWorkflowId(active[0].id)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!workflowId) return
    setSaving(true)
    setError(null)
    const [h, m] = time.split(':').map(Number)
    const day   = date.getDate()
    const month = date.getMonth() + 1
    // Cron: "M H D Mo *" — fires on this specific calendar date each year
    const cronExpr = `${m} ${h} ${day} ${month} *`
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflowId}/schedules`, {
        method: 'POST',
        body: JSON.stringify({ cronExpr, timezone, name: `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} run` }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to create schedule')
        return
      }
      onScheduled()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }, [workflowId, time, date, timezone, onScheduled])

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-violet-700">Schedule a Run</p>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Workflow</label>
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {workflows.length === 0 && <option value="">No workflows</option>}
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Time ({timezone})</label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={handleSubmit}
          disabled={saving || !workflowId}
          className="flex-1 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-xs py-1.5 font-medium transition-colors"
        >
          {saving ? 'Scheduling…' : 'Schedule'}
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-border px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Side Panel ───────────────────────────────────────────────────────────────

function SidePanel({
  date, runs, schedules, onClose, onScheduled,
}: {
  date: Date
  runs: CalendarRun[]
  schedules: ScheduledRun[]
  onClose: () => void
  onScheduled: () => void
}) {
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)

  const isFuture = date >= new Date(new Date().setHours(0, 0, 0, 0))
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const isEmpty = runs.length === 0 && schedules.length === 0

  return (
    <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-xs font-semibold">{label}</p>
          <p className="text-[11px] text-muted-foreground">{runs.length} run{runs.length !== 1 ? 's' : ''} · {schedules.length} scheduled</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Schedule button — future dates only */}
        {isFuture && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-300/50 py-2 text-xs text-violet-600 hover:bg-violet-50/60 hover:border-violet-400 transition-colors"
          >
            <Icons.Plus className="h-3.5 w-3.5" />
            Schedule a Run
          </button>
        )}

        {showForm && (
          <ScheduleForm
            date={date}
            onScheduled={() => { setShowForm(false); onScheduled() }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {isEmpty && !showForm && (
          <p className="text-center text-xs text-muted-foreground py-6">Nothing on this day.</p>
        )}

        {/* Scheduled */}
        {schedules.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Scheduled</p>
            <div className="space-y-1.5">
              {schedules.map((s) => (
                <div key={s.id} className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icons.Clock className="h-3 w-3 text-violet-600 shrink-0" />
                    <p className="text-xs font-medium text-violet-700 truncate">{s.workflowName}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{formatTime(s.nextRunAt)} · {s.timezone}</p>
                  {s.clientName && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{s.clientName}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Runs */}
        {runs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Runs</p>
            <div className="space-y-1.5">
              {runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/review/${r.id}`)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left hover:bg-accent/40 transition-colors',
                    r.status === 'completed' ? 'border-emerald-200 bg-emerald-50/60'
                    : r.status === 'failed'   ? 'border-red-200 bg-red-50/60'
                    : 'border-amber-200 bg-amber-50/60'
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={cn(r.status === 'completed' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-600' : 'text-amber-600')}>
                      {statusIcon(r.status)}
                    </span>
                    <p className="text-xs font-medium truncate">{r.workflowName}</p>
                    <Icons.ChevronRight className="h-3 w-3 shrink-0 ml-auto text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <span className={cn('text-[10px] font-medium rounded-full px-1.5 py-px border', statusPill(r.status))}>
                      {r.status}
                    </span>
                    {r.detectionScore !== null && (
                      <span className={cn('text-[10px] font-medium', detectionColor(r.detectionScore))}>
                        AI {r.detectionScore}%
                      </span>
                    )}
                    {r.feedback?.decision && (
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {r.feedback.decision.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {r.clientName && <span>{r.clientName}</span>}
                    <span>{formatTime(r.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CalendarPage() {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [clientFilter, setClientFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [runs, setRuns] = useState<CalendarRun[]>([])
  const [scheduledRuns, setScheduledRuns] = useState<ScheduledRun[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [calendarKey, setCalendarKey] = useState(0)

  // Load clients once
  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then(({ data }) => setClients((data ?? []).filter((c: Client & { status: string }) => c.status !== 'archived')))
      .catch(() => {})
  }, [])

  // Load calendar data when month/filter changes (or after a schedule is created)
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ year: String(year), month: String(month) })
    if (clientFilter !== 'all') params.set('clientId', clientFilter)
    apiFetch(`/api/v1/calendar?${params}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRuns(data?.runs ?? [])
        setScheduledRuns(data?.scheduledRuns ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, month, clientFilter, calendarKey])

  const grid = useMemo(() => buildGrid(year, month), [year, month])
  const todayKey = toDateKey(now)

  const runsByDate = useMemo(() => {
    const map = new Map<string, CalendarRun[]>()
    runs.forEach((r) => {
      const key = toLocalDateKey(r.createdAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    })
    return map
  }, [runs])

  const schedulesByDate = useMemo(() => {
    const map = new Map<string, ScheduledRun[]>()
    scheduledRuns.forEach((s) => {
      const key = toLocalDateKey(s.nextRunAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    })
    return map
  }, [scheduledRuns])

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
    setSelectedDate(null)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
    setSelectedDate(null)
  }
  const goToday = () => {
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
    setSelectedDate(null)
  }

  const selectedKey = selectedDate ? toDateKey(selectedDate) : null
  const selectedRuns      = selectedKey ? (runsByDate.get(selectedKey) ?? [])      : []
  const selectedSchedules = selectedKey ? (schedulesByDate.get(selectedKey) ?? []) : []

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-5 py-3 shrink-0">
        <Icons.CalendarDays className="h-4 w-4 text-blue-600" />
        <h1 className="text-sm font-semibold">Content Calendar</h1>

        <div className="flex items-center gap-1 ml-2">
          <button onClick={prevMonth} className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <Icons.ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium min-w-[140px] text-center">{MONTH_NAMES[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <Icons.ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button onClick={goToday} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          Today
        </button>

        <div className="flex-1" />

        {loading && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

        {/* Client filter */}
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />Completed</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" />Pending</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />Failed</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-violet-500" />Scheduled</span>
        </div>
      </div>

      {/* Calendar + side panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-auto px-4 py-3">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-1 flex-1">
            {grid.map((date) => {
              const key     = toDateKey(date)
              const inMonth = date.getMonth() === month - 1
              const isToday = key === todayKey
              const isSelected = key === selectedKey
              return (
                <DayCell
                  key={key}
                  date={date}
                  inMonth={inMonth}
                  isToday={isToday}
                  isSelected={isSelected}
                  runs={runsByDate.get(key) ?? []}
                  schedules={schedulesByDate.get(key) ?? []}
                  onClick={() => setSelectedDate(isSelected ? null : date)}
                />
              )
            })}
          </div>

          {/* Empty state */}
          {!loading && runs.length === 0 && scheduledRuns.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <Icons.CalendarDays className="h-8 w-8 text-muted-foreground/20 mb-2" />
              <p className="text-sm text-muted-foreground">No activity this month</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Runs and scheduled workflows will appear here</p>
            </div>
          )}
        </div>

        {/* Side panel */}
        {selectedDate && (
          <SidePanel
            date={selectedDate}
            runs={selectedRuns}
            schedules={selectedSchedules}
            onClose={() => setSelectedDate(null)}
            onScheduled={() => setCalendarKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  )
}
