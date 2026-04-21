import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client   { id: string; name: string }
interface Member   { id: string; name: string | null; email: string; avatarStorageKey: string | null }

interface PipelineRun {
  id:           string
  status:       string
  reviewStatus: string
  itemName:     string | null
  createdAt:    string
  completedAt:  string | null
  dueDate:      string | null
  assigneeId:   string | null
  assignee:     { id: string; name: string | null; avatarStorageKey: string | null } | null
  workflow:     { id: string; name: string; client: { id: string; name: string } | null } | null
  _count:       { comments: number }
}

interface PipelineRevision {
  id:           string
  clientId:     string
  verticalId:   string
  reviewStatus: string
  revisionType: string
  exportedAt:   string | null
  createdAt:    string
  assigneeId:   string | null
  notes:        string | null
  client:       { id: string; name: string }
  vertical:     { id: string; name: string }
}

type CardItem =
  | { _type: 'run';      data: PipelineRun }
  | { _type: 'revision'; data: PipelineRevision }

// ── Column definitions ────────────────────────────────────────────────────────

type ColKey = 'in_production' | 'last_mile' | 'ready_for_client' | 'client_review' | 'client_responded' | 'closed'

const COLUMNS: { key: ColKey; label: string; sublabel: string; icon: keyof typeof Icons; color: string; headerCls: string }[] = [
  {
    key:       'in_production',
    label:     'In Production',
    sublabel:  'Generating',
    icon:      'Zap',
    color:     'text-blue-500',
    headerCls: 'border-blue-500/40 bg-blue-500/5',
  },
  {
    key:       'last_mile',
    label:     'Last Mile',
    sublabel:  'Internal QA',
    icon:      'Eye',
    color:     'text-amber-500',
    headerCls: 'border-amber-500/40 bg-amber-500/5',
  },
  {
    key:       'ready_for_client',
    label:     'Ready for Client',
    sublabel:  'Agency approved',
    icon:      'CheckCircle',
    color:     'text-emerald-500',
    headerCls: 'border-emerald-500/40 bg-emerald-500/5',
  },
  {
    key:       'client_review',
    label:     'Client Review',
    sublabel:  'With client',
    icon:      'Users',
    color:     'text-violet-500',
    headerCls: 'border-violet-500/40 bg-violet-500/5',
  },
  {
    key:       'client_responded',
    label:     'Client Responded',
    sublabel:  'Awaiting action',
    icon:      'MessageSquare',
    color:     'text-purple-500',
    headerCls: 'border-purple-500/40 bg-purple-500/5',
  },
  {
    key:       'closed',
    label:     'Closed',
    sublabel:  'Published / done',
    icon:      'Archive',
    color:     'text-slate-400',
    headerCls: 'border-slate-400/40 bg-slate-400/5',
  },
]

// ── Column mapping helpers ────────────────────────────────────────────────────

function runToCol(run: PipelineRun): ColKey {
  if (['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)) return 'in_production'
  if (run.status === 'failed' || run.status === 'cancelled') return 'closed'
  if (run.reviewStatus === 'closed')            return 'closed'
  if (run.reviewStatus === 'client_responded')  return 'client_responded'
  if (run.reviewStatus === 'sent_to_client')    return 'client_review'
  if (run.reviewStatus === 'pending')           return 'ready_for_client'
  return 'last_mile'
}

function revToCol(rev: PipelineRevision): ColKey {
  if (rev.reviewStatus === 'closed')            return 'closed'
  if (rev.reviewStatus === 'client_responded')  return 'client_responded'
  if (rev.reviewStatus === 'sent_to_client')    return 'client_review'
  if (rev.reviewStatus === 'agency_review')     return 'ready_for_client'
  return 'last_mile'
}

// When a run is dragged to a column, this is the new reviewStatus
const RUN_COL_TO_STATUS: Partial<Record<ColKey, string>> = {
  last_mile:        'none',
  ready_for_client: 'pending',
  client_review:    'sent_to_client',
  client_responded: 'client_responded',
  closed:           'closed',
}

const REV_COL_TO_STATUS: Partial<Record<ColKey, string>> = {
  last_mile:        'draft',
  ready_for_client: 'agency_review',
  client_review:    'sent_to_client',
  client_responded: 'client_responded',
  closed:           'closed',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function dueDateChip(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0)  return { text: `${Math.abs(days)}d overdue`, cls: 'bg-red-500/10 text-red-600 border-red-200' }
  if (days === 0) return { text: 'Due today',                  cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  if (days <= 3)  return { text: `Due in ${days}d`,            cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  return { text: new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'bg-muted text-muted-foreground border-border' }
}

function isOverdue(item: CardItem): boolean {
  const d = item._type === 'run' ? item.data.dueDate : null
  if (!d) return false
  return new Date(d).getTime() < Date.now()
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: { name: string | null; avatarStorageKey: string | null } | null }) {
  if (!user) return null
  const initials = user.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  if (user.avatarStorageKey) {
    return <img src={(user.avatarStorageKey)} alt={user.name ?? ''} className="h-5 w-5 rounded-full object-cover border border-border shrink-0" title={user.name ?? ''} />
  }
  return (
    <div className="h-5 w-5 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-[9px] font-semibold shrink-0" title={user.name ?? ''}>
      {initials}
    </div>
  )
}

// ── Assignee picker ───────────────────────────────────────────────────────────

function AssigneePicker({
  current,
  members,
  onAssign,
}: {
  current: { id: string; name: string | null; avatarStorageKey: string | null } | null
  members: Member[]
  onAssign: (m: Member | null) => void
}) {
  const [open, setOpen]     = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current!.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const initials = (name: string | null) => name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  const dropdown = open && coords
    ? createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 }}
          className="w-52 rounded-xl border border-gray-200 bg-white shadow-2xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assign to</p>
          {current && (
            <button onClick={() => { onAssign(null); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50">
              <Icons.UserMinus className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          <div className="max-h-52 overflow-y-auto">
            {members.map((m) => (
              <button key={m.id} onClick={() => { onAssign(m); setOpen(false) }}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors', current?.id === m.id ? 'bg-blue-50' : 'hover:bg-gray-50')}>
                <div className={cn('h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold', current?.id === m.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600')}>
                  {m.avatarStorageKey ? <img src={(m.avatarStorageKey)} alt="" className="h-full w-full rounded-full object-cover" /> : initials(m.name)}
                </div>
                <span className="text-[11px] font-medium truncate">{m.name ?? m.email}</span>
                {current?.id === m.id && <Icons.Check className="h-3 w-3 text-blue-500 ml-auto" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      ) : null

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        title={current ? `${current.name ?? 'Assigned'} — click to change` : 'Assign someone'}
        className={cn('flex items-center justify-center rounded-full border transition-all shrink-0 hover:ring-2 hover:ring-blue-400 hover:ring-offset-1',
          current ? 'h-5 w-5 bg-blue-500 border-blue-500 text-white' : 'h-5 w-5 border-dashed border-gray-300 text-gray-400 hover:border-blue-400')}>
        {current
          ? (current.avatarStorageKey
            ? <img src={(current.avatarStorageKey)} alt="" className="h-full w-full rounded-full object-cover" />
            : <span className="text-[9px] font-bold">{initials(current.name)}</span>)
          : <Icons.Plus className="h-2.5 w-2.5" />}
      </button>
      {dropdown}
    </>
  )
}

// ── Run card ──────────────────────────────────────────────────────────────────

function RunCard({
  run,
  members,
  onDragStart,
  onClick,
  onAssign,
}: {
  run: PipelineRun
  members: Member[]
  onDragStart: () => void
  onClick:     () => void
  onAssign:    (m: Member | null) => void
}) {
  const isLive   = ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)
  const isFailed = run.status === 'failed' || run.status === 'cancelled'
  const due      = dueDateChip(run.dueDate)
  const title    = run.itemName || run.workflow?.name || 'Untitled'
  const client   = run.workflow?.client

  return (
    <div
      draggable={!isLive}
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'group rounded-xl border bg-white p-3 cursor-pointer select-none transition-all',
        'hover:shadow-sm hover:border-border/80 active:opacity-70',
        isFailed && 'border-red-200/60 opacity-70',
        !isFailed && 'border-border',
        isLive && 'cursor-default',
      )}
    >
      {/* Client badge + live dot */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {client && (
          <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-600 truncate max-w-[120px]">
            {client.name}
          </span>
        )}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">Copy</span>
        <div className="flex-1" />
        {isFailed && <Icons.AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
        {isLive    && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
      </div>

      {/* Title */}
      <p className="text-[12px] font-semibold leading-snug line-clamp-2 mb-1">{title}</p>

      {/* Workflow name if different */}
      {run.itemName && run.workflow?.name && run.itemName !== run.workflow.name && (
        <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{run.workflow.name}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        {due && <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', due.cls)}>{due.text}</span>}
        <div className="flex-1" />
        {run._count.comments > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Icons.MessageCircle className="h-3 w-3" />{run._count.comments}
          </span>
        )}
        <AssigneePicker current={run.assignee} members={members} onAssign={onAssign} />
        <span className="text-[10px] text-muted-foreground">{timeAgo(run.createdAt)}</span>
      </div>
    </div>
  )
}

// ── Revision card ─────────────────────────────────────────────────────────────

function RevisionCard({
  rev,
  members,
  onDragStart,
  onClick,
  onAssign,
}: {
  rev:         PipelineRevision
  members:     Member[]
  onDragStart: () => void
  onClick:     () => void
  onAssign:    (m: Member | null) => void
}) {
  const assignee = members.find((m) => m.id === rev.assigneeId) ?? null

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group rounded-xl border border-border bg-white p-3 cursor-pointer select-none transition-all hover:shadow-sm hover:border-border/80 active:opacity-70"
    >
      {/* Client badge + GTM tag */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-600 truncate max-w-[120px]">
          {rev.client.name}
        </span>
        <span className="rounded-full bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600">GTM</span>
      </div>

      {/* Title */}
      <p className="text-[12px] font-semibold leading-snug line-clamp-2 mb-1">
        GTM Framework — {rev.vertical.name}
      </p>
      <p className="text-[10px] text-muted-foreground mb-1.5 truncate capitalize">{rev.revisionType.replace('_', ' ')} export</p>

      {/* Footer */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <div className="flex-1" />
        <AssigneePicker
          current={assignee ? { id: assignee.id, name: assignee.name, avatarStorageKey: assignee.avatarStorageKey } : null}
          members={members}
          onAssign={onAssign}
        />
        <span className="text-[10px] text-muted-foreground">{timeAgo(rev.exportedAt ?? rev.createdAt)}</span>
      </div>
    </div>
  )
}

// ── Column component ──────────────────────────────────────────────────────────

function PipelineColumn({
  col,
  items,
  members,
  dragOverKey,
  onDragStart,
  onDragOver,
  onDrop,
  onCardClick,
  onAssignRun,
  onAssignRevision,
}: {
  col:               typeof COLUMNS[number]
  items:             CardItem[]
  members:           Member[]
  dragOverKey:       ColKey | null
  onDragStart:       (item: CardItem) => void
  onDragOver:        (key: ColKey) => void
  onDrop:            (key: ColKey) => void
  onCardClick:       (item: CardItem) => void
  onAssignRun:       (id: string, m: Member | null) => void
  onAssignRevision:  (id: string, m: Member | null) => void
}) {
  const Icon     = Icons[col.icon] as React.ComponentType<{ className?: string }>
  const isOver   = dragOverKey === col.key
  const overdue  = items.filter(isOverdue).length

  return (
    <div
      className={cn('flex flex-col min-w-[230px] w-[230px] shrink-0 rounded-xl border transition-colors', col.headerCls, isOver && 'ring-2 ring-blue-400 ring-offset-1')}
      onDragOver={(e) => { e.preventDefault(); onDragOver(col.key) }}
      onDrop={(e)     => { e.preventDefault(); onDrop(col.key) }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-inherit">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', col.color)} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-[11px] font-semibold truncate', col.color)}>{col.label}</p>
          <p className="text-[9px] text-muted-foreground">{col.sublabel}</p>
        </div>
        <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-inherit">
          {items.length}
        </span>
        {overdue > 0 && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
            {overdue} late
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto max-h-[calc(100vh-220px)] scrollbar-thin">
        {items.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground/40 select-none">
            Drop here
          </div>
        )}
        {items.map((item) =>
          item._type === 'run' ? (
            <RunCard
              key={item.data.id}
              run={item.data}
              members={members}
              onDragStart={() => onDragStart(item)}
              onClick={() => onCardClick(item)}
              onAssign={(m) => onAssignRun(item.data.id, m)}
            />
          ) : (
            <RevisionCard
              key={item.data.id}
              rev={item.data}
              members={members}
              onDragStart={() => onDragStart(item)}
              onClick={() => onCardClick(item)}
              onAssign={(m) => onAssignRevision(item.data.id, m)}
            />
          ),
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PipelinePage() {
  const navigate                          = useNavigate()
  const [searchParams, setSearchParams]   = useSearchParams()

  const [runs,      setRuns]      = useState<PipelineRun[]>([])
  const [revisions, setRevisions] = useState<PipelineRevision[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [members,   setMembers]   = useState<Member[]>([])
  const [loading,   setLoading]   = useState(true)

  const [filterClient,   setFilterClient]   = useState(searchParams.get('clientId') ?? '')
  const [filterAssignee, setFilterAssignee] = useState(searchParams.get('assigneeId') ?? '')
  const [filterType,     setFilterType]     = useState<'all' | 'run' | 'revision'>('all')
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [searchQuery,    setSearchQuery]    = useState('')

  const [dragItem,    setDragItem]    = useState<CardItem | null>(null)
  const [dragOverKey, setDragOverKey] = useState<ColKey | null>(null)

  // ── Fetch ────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterClient)   params.set('clientId',   filterClient)
    if (filterAssignee) params.set('assigneeId', filterAssignee)

    apiFetch(`/api/v1/pipeline?${params}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRuns(data.runs ?? [])
        setRevisions(data.revisions ?? [])
        setClients(data.clients ?? [])
        setMembers(data.members ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filterClient, filterAssignee])

  useEffect(() => { load() }, [load])

  // ── Build card list ──────────────────────────────────────────────────────

  const allItems: CardItem[] = [
    ...(filterType !== 'revision' ? runs.map((r): CardItem => ({ _type: 'run',      data: r })) : []),
    ...(filterType !== 'run'      ? revisions.map((r): CardItem => ({ _type: 'revision', data: r })) : []),
  ].filter((item) => {
    if (overdueOnly && !isOverdue(item)) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (item._type === 'run') {
        return (item.data.itemName ?? item.data.workflow?.name ?? '').toLowerCase().includes(q)
          || (item.data.workflow?.client?.name ?? '').toLowerCase().includes(q)
      }
      return item.data.client.name.toLowerCase().includes(q) || item.data.vertical.name.toLowerCase().includes(q)
    }
    return true
  })

  const byCol = (key: ColKey) =>
    allItems.filter((item) => (item._type === 'run' ? runToCol(item.data) : revToCol(item.data)) === key)

  // ── Drag handlers ────────────────────────────────────────────────────────

  const handleDrop = useCallback(async (colKey: ColKey) => {
    setDragOverKey(null)
    if (!dragItem) return
    setDragItem(null)

    if (dragItem._type === 'run') {
      const newStatus = RUN_COL_TO_STATUS[colKey]
      if (!newStatus || colKey === 'in_production') return
      setRuns((prev) => prev.map((r) => r.id === dragItem.data.id ? { ...r, reviewStatus: newStatus } : r))
      await apiFetch(`/api/v1/pipeline/runs/${dragItem.data.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: newStatus }),
      }).catch(() => load())
    } else {
      const newStatus = REV_COL_TO_STATUS[colKey]
      if (!newStatus) return
      setRevisions((prev) => prev.map((r) => r.id === dragItem.data.id ? { ...r, reviewStatus: newStatus } : r))
      await apiFetch(`/api/v1/pipeline/revisions/${dragItem.data.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: newStatus }),
      }).catch(() => load())
    }
  }, [dragItem, load])

  // ── Assign handlers ──────────────────────────────────────────────────────

  const assignRun = useCallback(async (id: string, member: Member | null) => {
    setRuns((prev) => prev.map((r) => r.id === id ? { ...r, assigneeId: member?.id ?? null, assignee: member ? { id: member.id, name: member.name, avatarStorageKey: member.avatarStorageKey } : null } : r))
    await apiFetch(`/api/v1/runs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { assigneeId: member?.id ?? null } }),
    }).catch(() => {})
  }, [])

  const assignRevision = useCallback(async (id: string, member: Member | null) => {
    setRevisions((prev) => prev.map((r) => r.id === id ? { ...r, assigneeId: member?.id ?? null } : r))
    const rev = revisions.find((r) => r.id === id)
    if (!rev) return
    await apiFetch(`/api/v1/clients/${rev.clientId}/framework/${rev.verticalId}/revisions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId: member?.id ?? null }),
    }).catch(() => {})
  }, [revisions])

  // ── Card click ───────────────────────────────────────────────────────────

  const handleCardClick = useCallback((item: CardItem) => {
    if (item._type === 'run') {
      navigate(`/review/${item.data.id}`)
    } else {
      navigate(`/clients/${item.data.clientId}?tab=framework&verticalId=${item.data.verticalId}`)
    }
  }, [navigate])

  // ── Filter URL sync ──────────────────────────────────────────────────────

  const updateClientFilter = (id: string) => {
    setFilterClient(id)
    const p = new URLSearchParams(searchParams)
    if (id) p.set('clientId', id); else p.delete('clientId')
    setSearchParams(p)
  }

  const totalOverdue = allItems.filter(isOverdue).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-2 mr-2">
          <Icons.Kanban className="h-4.5 w-4.5 text-foreground" />
          <h1 className="text-sm font-semibold">Pipeline</h1>
        </div>

        {/* Search */}
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="h-7 w-44 rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Client filter */}
        <select
          value={filterClient}
          onChange={(e) => updateClientFilter(e.target.value)}
          className="h-7 rounded-lg border border-border bg-muted/30 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Assignee filter */}
        <div className="flex items-center gap-1">
          {members.slice(0, 8).map((m) => {
            const selected = filterAssignee === m.id
            const initials = m.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
            return (
              <button
                key={m.id}
                title={m.name ?? m.email}
                onClick={() => setFilterAssignee(selected ? '' : m.id)}
                className={cn(
                  'h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-semibold border transition-all',
                  selected ? 'ring-2 ring-blue-400 ring-offset-1 border-blue-400' : 'border-border opacity-60 hover:opacity-100',
                )}
              >
                {m.avatarStorageKey
                  ? <img src={(m.avatarStorageKey)} alt="" className="h-full w-full rounded-full object-cover" />
                  : <span className="bg-primary/10 text-primary h-full w-full rounded-full flex items-center justify-center text-[9px]">{initials}</span>}
              </button>
            )
          })}
          {filterAssignee && (
            <button onClick={() => setFilterAssignee('')} className="ml-1 text-[10px] text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/20 p-0.5">
          {(['all', 'run', 'revision'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn('rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors', filterType === t ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t === 'all' ? 'All' : t === 'run' ? 'Runs' : 'GTM'}
            </button>
          ))}
        </div>

        {/* Overdue toggle */}
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-colors', overdueOnly ? 'border-red-300 bg-red-50 text-red-600' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          <Icons.Clock className="h-3 w-3" />
          {overdueOnly ? `${totalOverdue} overdue` : 'Overdue'}
        </button>

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-[11px] text-muted-foreground">
          {allItems.length} item{allItems.length !== 1 ? 's' : ''}
        </span>

        <button onClick={load} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <Icons.RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Board */}
      {loading && !runs.length && !revisions.length ? (
        <div className="flex flex-1 items-center justify-center">
          <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          className="flex gap-3 p-4 overflow-x-auto flex-1"
          onDragEnd={() => { setDragItem(null); setDragOverKey(null) }}
        >
          {COLUMNS.map((col) => (
            <PipelineColumn
              key={col.key}
              col={col}
              items={byCol(col.key)}
              members={members}
              dragOverKey={dragOverKey}
              onDragStart={setDragItem}
              onDragOver={setDragOverKey}
              onDrop={handleDrop}
              onCardClick={handleCardClick}
              onAssignRun={assignRun}
              onAssignRevision={assignRevision}
            />
          ))}
        </div>
      )}
    </div>
  )
}
