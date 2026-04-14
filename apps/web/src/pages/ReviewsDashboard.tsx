import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReviewRun {
  id: string
  workflowName: string
  projectName: string | null
  itemName: string | null
  clientName: string | null
  reviewStatus: string
  completedAt: string | null
  createdAt: string
  dueDate: string | null
  assigneeId: string | null
  assignee: { id: string; name: string | null; avatarStorageKey: string | null } | null
  triggeredByUser: { name: string | null; email: string } | null
}

interface TeamMember {
  id: string
  name: string | null
  email: string
  avatarStorageKey?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  none:             { label: 'Needs review',     color: 'text-orange-600',  dot: 'bg-orange-400',   bg: 'bg-orange-50 border-orange-200' },
  pending:          { label: 'In review',        color: 'text-blue-600',    dot: 'bg-blue-500',     bg: 'bg-blue-50 border-blue-200' },
  sent_to_client:   { label: 'Sent to client',   color: 'text-purple-600',  dot: 'bg-purple-500',   bg: 'bg-purple-50 border-purple-200' },
  client_responded: { label: 'Client responded', color: 'text-emerald-600', dot: 'bg-emerald-500',  bg: 'bg-emerald-50 border-emerald-200' },
  closed:           { label: 'Closed',           color: 'text-slate-500',   dot: 'bg-slate-400',    bg: 'bg-slate-50 border-slate-200' },
}

const FILTERS = [
  { value: 'all',             label: 'All' },
  { value: 'none',            label: 'Needs review' },
  { value: 'pending',         label: 'In review' },
  { value: 'sent_to_client',  label: 'Sent to client' },
  { value: 'client_responded',label: 'Client responded' },
  { value: 'closed',          label: 'Closed' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isDue(iso: string) {
  return new Date(iso) < new Date()
}

function userInitials(name: string | null | undefined, email: string) {
  if (name) {
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

// ── Inline Assignee Picker ────────────────────────────────────────────────────

function AssigneePicker({
  runId,
  current,
  teamMembers,
  onAssigned,
}: {
  runId: string
  current: ReviewRun['assignee']
  teamMembers: TeamMember[]
  onAssigned: (assignee: ReviewRun['assignee']) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  async function assign(memberId: string | null) {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: memberId }),
      })
      if (res.ok) {
        const member = memberId ? (teamMembers.find((m) => m.id === memberId) ?? null) : null
        onAssigned(member ? { id: member.id, name: member.name ?? null, avatarStorageKey: member.avatarStorageKey ?? null } : null)
      }
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  const label = current?.name ?? current?.id?.slice(0, 6) ?? 'Unassigned'

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
          current ? 'text-foreground hover:bg-accent' : 'text-muted-foreground hover:bg-accent/60',
        )}
        title="Reassign"
      >
        {saving ? (
          <Icons.Loader2 className="h-3 w-3 animate-spin" />
        ) : current ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
            {userInitials(current.name, current.id)}
          </span>
        ) : (
          <Icons.UserCircle2 className="h-4 w-4 text-muted-foreground/60" />
        )}
        <span className="max-w-[80px] truncate">{current ? label : '—'}</span>
        <Icons.ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-white shadow-lg"  style={{ opacity: 1 }}>
          <div className="p-1">
            <button
              onClick={() => assign(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <Icons.UserCircle2 className="h-3.5 w-3.5" />
              Unassigned
            </button>
            {teamMembers.map((m) => (
              <button
                key={m.id}
                onClick={() => assign(m.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent',
                  current?.id === m.id ? 'text-blue-600 font-medium' : 'text-foreground',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                  {userInitials(m.name, m.email)}
                </span>
                <span className="truncate">{m.name ?? m.email}</span>
                {current?.id === m.id && <Icons.Check className="ml-auto h-3 w-3 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline Status Picker ──────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  'none', 'pending', 'sent_to_client', 'client_responded', 'closed',
] as const

function StatusPicker({
  runId,
  status,
  onUpdated,
}: {
  runId: string
  status: string
  onUpdated: (status: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  async function pick(next: string) {
    if (next === status) { setOpen(false); return }
    setSaving(true)
    setOpen(false)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: next }),
      })
      if (res.ok) onUpdated(next)
    } finally {
      setSaving(false)
    }
  }

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.none

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:ring-1 hover:ring-border',
          cfg.color,
        )}
      >
        {saving ? (
          <Icons.Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
        )}
        {cfg.label}
        <Icons.ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-white shadow-lg" style={{ opacity: 1 }}>
          <div className="p-1">
            {STATUS_OPTIONS.map((s) => {
              const c = STATUS_CONFIG[s]
              return (
                <button
                  key={s}
                  onClick={() => pick(s)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    s === status ? 'font-medium' : '',
                    c.color,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
                  {c.label}
                  {s === status && <Icons.Check className="ml-auto h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline Due Date Picker ────────────────────────────────────────────────────

function DueDateCell({
  runId,
  dueDate,
  onUpdated,
}: {
  runId: string
  dueDate: string | null
  onUpdated: (date: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [editing])

  async function saveDate(value: string) {
    setSaving(true)
    setEditing(false)
    try {
      const iso = value ? new Date(value).toISOString() : null
      const res = await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: iso }),
      })
      if (res.ok) onUpdated(iso)
    } finally {
      setSaving(false)
    }
  }

  const overdue = dueDate && isDue(dueDate)

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <input
          autoFocus
          type="date"
          defaultValue={dueDate ? dueDate.slice(0, 10) : ''}
          onChange={(e) => saveDate(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          className="h-7 w-32 rounded border border-blue-400 bg-background px-2 text-xs focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent/60',
            overdue ? 'text-red-500 font-medium' : dueDate ? 'text-foreground' : 'text-muted-foreground',
          )}
          title="Set due date"
        >
          {saving ? (
            <Icons.Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Icons.CalendarDays className="h-3 w-3 shrink-0" />
          )}
          {dueDate ? formatDateShort(dueDate) : '—'}
        </button>
      )}
    </div>
  )
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortKey = 'completedAt' | 'review' | 'clientName' | 'reviewStatus' | 'createdBy' | 'assignee' | 'dueDate'
type SortDir = 'asc' | 'desc'

const STATUS_ORDER: Record<string, number> = {
  none: 0, pending: 1, sent_to_client: 2, client_responded: 3, closed: 4,
}

function getSortValue(r: ReviewRun, key: SortKey): string | number {
  switch (key) {
    case 'completedAt': return r.completedAt ? new Date(r.completedAt).getTime() : Infinity
    case 'review':      return [r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' ').toLowerCase()
    case 'clientName':  return (r.clientName ?? '').toLowerCase()
    case 'reviewStatus': return STATUS_ORDER[r.reviewStatus] ?? 99
    case 'createdBy':   return (r.triggeredByUser?.name ?? r.triggeredByUser?.email ?? '').toLowerCase()
    case 'assignee':    return (r.assignee?.name ?? '').toLowerCase()
    case 'dueDate':     return r.dueDate ? new Date(r.dueDate).getTime() : Infinity
  }
}

function SortableHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active ? 'text-foreground' : '',
        )}
      >
        {label}
        <span className="flex flex-col leading-none">
          <Icons.ChevronUp className={cn('h-2.5 w-2.5', active && dir === 'asc' ? 'text-blue-500' : 'opacity-30')} />
          <Icons.ChevronDown className={cn('h-2.5 w-2.5 -mt-0.5', active && dir === 'desc' ? 'text-blue-500' : 'opacity-30')} />
        </span>
      </button>
    </th>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReviewsDashboard() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ReviewRun[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('completedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/v1/runs?status=completed&limit=200').then((r) => r.json()),
      apiFetch('/api/v1/team').then((r) => r.json()),
    ])
      .then(([runsRes, teamRes]) => {
        setRuns(runsRes.data ?? [])
        setTeamMembers(teamRes.data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = runs
    .filter((r) => {
      if (filter !== 'all' && r.reviewStatus !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        const name = [r.clientName, r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' ').toLowerCase()
        if (!name.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      const av = getSortValue(a, sortKey)
      const bv = getSortValue(b, sortKey)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })

  // Stat counts
  const counts: Record<string, number> = {}
  for (const r of runs) counts[r.reviewStatus] = (counts[r.reviewStatus] ?? 0) + 1

  function updateRun(id: string, patch: Partial<ReviewRun>) {
    setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  // Selection helpers
  const allFilteredIds = filtered.map((r) => r.id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id))
  const someSelected = !allSelected && allFilteredIds.some((id) => selectedIds.has(id))

  function toggleRow(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allFilteredIds))
    }
  }

  async function applyBulkStatus(status: string) {
    const ids = [...selectedIds]
    setBulkSaving(true)
    try {
      await Promise.all(
        ids.map((id) =>
          apiFetch(`/api/v1/runs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewStatus: status }),
          }),
        ),
      )
      setRuns((prev) => prev.map((r) => (selectedIds.has(r.id) ? { ...r, reviewStatus: status } : r)))
      setSelectedIds(new Set())
    } finally {
      setBulkSaving(false)
    }
  }

  const numSelected = selectedIds.size

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.ClipboardEdit className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Reviews</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{runs.length}</span>
        </div>
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 w-48 rounded-md border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {/* Stat cards */}
        <div className="grid grid-cols-5 gap-3 px-6 pt-5 pb-4">
          {(['none', 'pending', 'sent_to_client', 'client_responded', 'closed'] as const).map((s) => {
            const cfg = STATUS_CONFIG[s]
            const count = counts[s] ?? 0
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? 'all' : s)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  filter === s ? cfg.bg : 'border-border bg-card hover:border-blue-300/60',
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                  <span className="text-[11px] text-muted-foreground">{cfg.label}</span>
                </div>
                <p className={cn('text-xl font-semibold', filter === s ? cfg.color : 'text-foreground')}>{count}</p>
              </button>
            )
          })}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 border-b border-border px-6 pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
              )}
            >
              {f.label}
              {f.value !== 'all' && (counts[f.value] ?? 0) > 0 && (
                <span className="ml-1.5 opacity-70">{counts[f.value]}</span>
              )}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} review{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Icons.ClipboardEdit className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No reviews match your search.' : filter !== 'all' ? 'No reviews in this stage.' : 'No completed runs to review yet.'}
            </p>
          </div>
        ) : (
          <div className="px-6 pt-4 pb-8">
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {/* Select-all checkbox */}
                    <th className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected }}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                      />
                    </th>
                    <SortableHeader label="Date"        sortKey="completedAt"  current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Review"      sortKey="review"       current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Client"      sortKey="clientName"   current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Status"      sortKey="reviewStatus" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Created by"  sortKey="createdBy"    current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Assigned to" sortKey="assignee"     current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Due date"    sortKey="dueDate"      current={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtered.map((r) => {
                    const title = [r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' — ')
                    const createdBy = r.triggeredByUser
                      ? (r.triggeredByUser.name ?? r.triggeredByUser.email)
                      : null
                    const isSelected = selectedIds.has(r.id)
                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate(`/review/${r.id}`)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          isSelected ? 'bg-blue-50/60 hover:bg-blue-50/80' : 'hover:bg-accent/30',
                        )}
                      >
                        <td className="w-10 px-3 py-2.5" onClick={(e) => toggleRow(r.id, e)}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-blue-600"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          {r.completedAt ? formatDate(r.completedAt) : '—'}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-foreground/90 max-w-[200px] truncate">{title}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.clientName ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <StatusPicker
                            runId={r.id}
                            status={r.reviewStatus}
                            onUpdated={(s) => updateRun(r.id, { reviewStatus: s })}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {createdBy ? (
                            <span className="flex items-center gap-1.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                                {userInitials(r.triggeredByUser?.name, r.triggeredByUser?.email ?? '')}
                              </span>
                              <span className="max-w-[80px] truncate">{createdBy}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <AssigneePicker
                            runId={r.id}
                            current={r.assignee}
                            teamMembers={teamMembers}
                            onAssigned={(assignee) => updateRun(r.id, { assignee, assigneeId: assignee?.id ?? null })}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <DueDateCell
                            runId={r.id}
                            dueDate={r.dueDate}
                            onUpdated={(date) => updateRun(r.id, { dueDate: date })}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Icons.ChevronRight className="h-3.5 w-3.5 inline text-muted-foreground/50" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {numSelected > 0 && (
        <div className="shrink-0 border-t border-border bg-card px-6 py-3 flex items-center gap-3">
          <span className="text-xs font-medium text-foreground">
            {numSelected} selected
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">Set status:</span>
          <div className="flex items-center gap-1.5">
            {STATUS_OPTIONS.map((s) => {
              const c = STATUS_CONFIG[s]
              return (
                <button
                  key={s}
                  disabled={bulkSaving}
                  onClick={() => applyBulkStatus(s)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    'border-border bg-background hover:bg-accent disabled:opacity-50',
                    c.color,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
                  {c.label}
                </button>
              )
            })}
          </div>
          {bulkSaving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
