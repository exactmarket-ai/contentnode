import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface Schedule {
  id: string
  name: string | null
  cronExpr: string
  timezone: string
  status: string
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
}

const PRESETS = [
  { label: 'Every hour',           cron: '0 * * * *' },
  { label: 'Every day at 9am',     cron: '0 9 * * *' },
  { label: 'Every day at noon',    cron: '0 12 * * *' },
  { label: 'Mon–Fri at 9am',       cron: '0 9 * * 1-5' },
  { label: 'Every Monday 9am',     cron: '0 9 * * 1' },
  { label: 'Every Sunday midnight',cron: '0 0 * * 0' },
  { label: '1st of every month',   cron: '0 9 1 * *' },
  { label: 'Custom…',              cron: '' },
]

function formatNextRun(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

interface ScheduleModalProps {
  workflowId: string
  onClose: () => void
}

export function ScheduleModal({ workflowId, onClose }: ScheduleModalProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[1].cron)
  const [customCron, setCustomCron] = useState('')
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [name, setName] = useState('')

  const timezones = Intl.supportedValuesOf('timeZone')
  const isCustom = selectedPreset === ''
  const cronExpr = isCustom ? customCron : selectedPreset

  useEffect(() => {
    apiFetch(`/api/v1/workflows/${workflowId}/schedules`)
      .then((r) => r.json())
      .then(({ data }) => setSchedules(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workflowId])

  const handleCreate = async () => {
    if (!cronExpr.trim()) { setError('Please select or enter a cron expression'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflowId}/schedules`, {
        method: 'POST',
        body: JSON.stringify({ cronExpr: cronExpr.trim(), timezone, name: name.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to create schedule')
        return
      }
      const { data } = await res.json()
      setSchedules((prev) => [data, ...prev])
      setName('')
      setSelectedPreset(PRESETS[1].cron)
      setCustomCron('')
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (sched: Schedule) => {
    const newStatus = sched.status === 'active' ? 'paused' : 'active'
    try {
      const res = await apiFetch(`/api/v1/workflows/${workflowId}/schedules/${sched.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setSchedules((prev) => prev.map((s) => s.id === sched.id ? data : s))
      }
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/v1/workflows/${workflowId}/schedules/${id}`, { method: 'DELETE' })
      setSchedules((prev) => prev.filter((s) => s.id !== id))
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icons.Clock className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold">Scheduled Runs</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Create form */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Schedule</p>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Frequency</label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PRESETS.map((p) => (
                  <option key={p.label} value={p.cron}>{p.label}</option>
                ))}
              </select>
            </div>

            {isCustom && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Cron Expression</label>
                <input
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">Format: minute hour day month weekday</p>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Label (optional)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekly blog post"
                className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <Button size="sm" onClick={handleCreate} disabled={saving} className="h-7 text-xs">
              {saving
                ? <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                : <Icons.Plus className="mr-1.5 h-3 w-3" />}
              Add Schedule
            </Button>
          </div>

          {/* Existing schedules */}
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : schedules.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-4">No schedules yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Schedules</p>
              {schedules.map((sched) => (
                <div key={sched.id} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium truncate">
                        {sched.name ?? sched.cronExpr}
                      </span>
                      {sched.name && (
                        <span className="text-[10px] font-mono text-muted-foreground">{sched.cronExpr}</span>
                      )}
                      <span className={cn(
                        'ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        sched.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-muted text-muted-foreground'
                      )}>
                        {sched.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{sched.timezone}</span>
                      {sched.nextRunAt && (
                        <span className="flex items-center gap-1">
                          <Icons.Clock className="h-2.5 w-2.5" />
                          Next: {formatNextRun(sched.nextRunAt)}
                        </span>
                      )}
                      {sched.lastRunAt && (
                        <span>Last: {formatNextRun(sched.lastRunAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(sched)}
                      title={sched.status === 'active' ? 'Pause' : 'Resume'}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {sched.status === 'active'
                        ? <Icons.Pause className="h-3.5 w-3.5" />
                        : <Icons.Play className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDelete(sched.id)}
                      title="Delete"
                      className="rounded p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50/60 transition-colors"
                    >
                      <Icons.Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
