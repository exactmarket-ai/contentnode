import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import {
  type Client, type Member, type PipelineRun, type PipelineRevision, type CardItem, type ColKey,
  type PipelineView,
  COLUMNS, runToCol, revToCol, isItemOverdue, dueDateChip, timeAgo,
  RUN_COL_TO_STATUS, REV_COL_TO_STATUS,
} from '../components/pm/types'
import { AssigneePicker } from '../components/pm/shared'
import { TaskDetailPanel } from '../components/pm/TaskDetailPanel'
import { TimelineView }    from '../components/pm/TimelineView'
import { PMTableView }     from '../components/pm/PMTableView'
import { DashboardView }   from '../components/pm/DashboardView'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLiveRun(run: PipelineRun) {
  return ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)
}

// ── Run card ──────────────────────────────────────────────────────────────────

function RunCard({
  run, members, onDragStart, onClick, onAssign,
}: {
  run: PipelineRun; members: Member[]
  onDragStart: () => void; onClick: () => void; onAssign: (m: Member | null) => void
}) {
  const isLive   = isLiveRun(run)
  const isFailed = run.status === 'failed' || run.status === 'cancelled'
  const due      = dueDateChip(run.dueDate)
  const title    = run.itemName || run.workflow?.name || 'Untitled'
  const client   = run.workflow?.client
  const overdue  = run.dueDate && new Date(run.dueDate).getTime() < Date.now()

  return (
    <div
      draggable={!isLive}
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'group rounded-xl border bg-white p-3 cursor-pointer select-none transition-all',
        'hover:shadow-md hover:-translate-y-px active:opacity-70',
        isFailed && 'border-red-200/60 opacity-70',
        overdue  && !isFailed && 'border-l-[3px] border-l-red-400',
        !isFailed && !overdue && 'border-border',
        isLive && 'cursor-default',
      )}
    >
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
      <p className="text-[12px] font-semibold leading-snug line-clamp-2 mb-1">{title}</p>
      {run.itemName && run.workflow?.name && run.itemName !== run.workflow.name && (
        <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{run.workflow.name}</p>
      )}
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
  rev, members, onDragStart, onClick, onAssign,
}: {
  rev: PipelineRevision; members: Member[]
  onDragStart: () => void; onClick: () => void; onAssign: (m: Member | null) => void
}) {
  const assignee = members.find((m) => m.id === rev.assigneeId) ?? null
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group rounded-xl border border-border bg-white p-3 cursor-pointer select-none transition-all hover:shadow-md hover:-translate-y-px active:opacity-70"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-600 truncate max-w-[120px]">
          {rev.client.name}
        </span>
        <span className="rounded-full bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600">GTM</span>
      </div>
      <p className="text-[12px] font-semibold leading-snug line-clamp-2 mb-1">GTM Framework — {rev.vertical.name}</p>
      <p className="text-[10px] text-muted-foreground mb-1.5 truncate capitalize">{rev.revisionType.replace('_', ' ')} export</p>
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

// ── Kanban column ─────────────────────────────────────────────────────────────

function PipelineColumn({
  col, items, members, dragOverKey,
  onDragStart, onDragOver, onDrop, onCardClick, onAssignRun, onAssignRevision,
}: {
  col: typeof COLUMNS[number]; items: CardItem[]; members: Member[]; dragOverKey: ColKey | null
  onDragStart: (item: CardItem) => void; onDragOver: (key: ColKey) => void; onDrop: (key: ColKey) => void
  onCardClick: (item: CardItem) => void; onAssignRun: (id: string, m: Member | null) => void
  onAssignRevision: (id: string, m: Member | null) => void
}) {
  const Icon    = Icons[col.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>
  const isOver  = dragOverKey === col.key
  const overdue = items.filter((i) => isItemOverdue(i)).length

  return (
    <div
      className={cn('flex flex-col min-w-[230px] w-[230px] shrink-0 rounded-xl border transition-all', col.headerCls, isOver && 'ring-2 ring-blue-400 ring-offset-1 scale-[1.01]')}
      onDragOver={(e) => { e.preventDefault(); onDragOver(col.key) }}
      onDrop={(e)     => { e.preventDefault(); onDrop(col.key) }}
    >
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
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">{overdue} late</span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto max-h-[calc(100vh-220px)] scrollbar-thin">
        {items.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground/40 select-none">Drop here</div>
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

// ── View switcher ─────────────────────────────────────────────────────────────

const VIEW_OPTIONS: { key: PipelineView; label: string; icon: keyof typeof Icons }[] = [
  { key: 'board',     label: 'Board',     icon: 'Kanban' },
  { key: 'timeline',  label: 'Timeline',  icon: 'CalendarRange' },
  { key: 'table',     label: 'Table',     icon: 'Table' },
  { key: 'dashboard', label: 'Dashboard', icon: 'BarChart2' },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export function PipelinePage() {
  const navigate                        = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [runs,      setRuns]      = useState<PipelineRun[]>([])
  const [revisions, setRevisions] = useState<PipelineRevision[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [members,   setMembers]   = useState<Member[]>([])
  const [loading,   setLoading]   = useState(true)

  const [view,          setView]          = useState<PipelineView>('board')
  const [selectedItem,  setSelectedItem]  = useState<CardItem | null>(null)
  const [filterClient,  setFilterClient]  = useState(searchParams.get('clientId') ?? '')
  const [filterAssignee,setFilterAssignee]= useState(searchParams.get('assigneeId') ?? '')
  const [filterType,    setFilterType]    = useState<'all' | 'run' | 'revision'>('all')
  const [overdueOnly,   setOverdueOnly]   = useState(false)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [dragItem,      setDragItem]      = useState<CardItem | null>(null)
  const [dragOverKey,   setDragOverKey]   = useState<ColKey | null>(null)

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

  // ── Filtered items ───────────────────────────────────────────────────────

  const allItems: CardItem[] = [
    ...(filterType !== 'revision' ? runs.map((r): CardItem => ({ _type: 'run',      data: r })) : []),
    ...(filterType !== 'run'      ? revisions.map((r): CardItem => ({ _type: 'revision', data: r })) : []),
  ].filter((item) => {
    if (overdueOnly && !isItemOverdue(item)) return false
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

  // ── Stage change (shared by drag-drop and detail panel) ──────────────────

  const handleStageChange = useCallback(async (item: CardItem, colKey: ColKey) => {
    if (item._type === 'run') {
      const newStatus = RUN_COL_TO_STATUS[colKey]
      if (!newStatus || colKey === 'in_production') return
      setRuns((prev) => prev.map((r) => r.id === item.data.id ? { ...r, reviewStatus: newStatus } : r))
      await apiFetch(`/api/v1/pipeline/runs/${item.data.id}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: newStatus }),
      }).catch(() => load())
    } else {
      const newStatus = REV_COL_TO_STATUS[colKey]
      if (!newStatus) return
      setRevisions((prev) => prev.map((r) => r.id === item.data.id ? { ...r, reviewStatus: newStatus } : r))
      await apiFetch(`/api/v1/pipeline/revisions/${item.data.id}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: newStatus }),
      }).catch(() => load())
    }
  }, [load])

  const handleDrop = useCallback(async (colKey: ColKey) => {
    setDragOverKey(null)
    if (!dragItem) return
    setDragItem(null)
    await handleStageChange(dragItem, colKey)
  }, [dragItem, handleStageChange])

  // ── Assign ───────────────────────────────────────────────────────────────

  const assignRun = useCallback(async (id: string, member: Member | null) => {
    setRuns((prev) => prev.map((r) => r.id === id
      ? { ...r, assigneeId: member?.id ?? null, assignee: member ? { id: member.id, name: member.name, avatarStorageKey: member.avatarStorageKey } : null }
      : r))
    await apiFetch(`/api/v1/runs/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { assigneeId: member?.id ?? null } }),
    }).catch(() => {})
  }, [])

  const assignRevision = useCallback(async (id: string, member: Member | null) => {
    setRevisions((prev) => prev.map((r) => r.id === id ? { ...r, assigneeId: member?.id ?? null } : r))
    const rev = revisions.find((r) => r.id === id)
    if (!rev) return
    await apiFetch(`/api/v1/clients/${rev.clientId}/framework/${rev.verticalId}/revisions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId: member?.id ?? null }),
    }).catch(() => {})
  }, [revisions])

  // ── Card click → open detail panel ──────────────────────────────────────

  const handleCardClick = useCallback((item: CardItem) => {
    setSelectedItem(item)
  }, [])

  const handleNavigate = useCallback((item: CardItem) => {
    setSelectedItem(null)
    if (item._type === 'run') navigate(`/review/${item.data.id}`)
    else navigate(`/clients/${item.data.clientId}?tab=framework&verticalId=${item.data.verticalId}`)
  }, [navigate])

  // ── Filter URL sync ──────────────────────────────────────────────────────

  const updateClientFilter = (id: string) => {
    setFilterClient(id)
    const p = new URLSearchParams(searchParams)
    if (id) p.set('clientId', id); else p.delete('clientId')
    setSearchParams(p)
  }

  const totalOverdue = allItems.filter(isItemOverdue).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-background shrink-0 flex-wrap">
        {/* Title + view switcher */}
        <div className="flex items-center gap-2 mr-1">
          <Icons.Kanban className="h-4 w-4 text-foreground shrink-0" />
          <h1 className="text-sm font-semibold whitespace-nowrap">Pipeline</h1>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/20 p-0.5">
          {VIEW_OPTIONS.map(({ key, label, icon }) => {
            const Icon = Icons[icon] as React.ComponentType<{ className?: string }>
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[10px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap',
                  view === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            )
          })}
        </div>

        {/* Filters (hidden in dashboard) */}
        {view !== 'dashboard' && (
          <>
            <div className="relative">
              <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-7 w-40 rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <select
              value={filterClient}
              onChange={(e) => updateClientFilter(e.target.value)}
              className="h-7 rounded-lg border border-border bg-muted/30 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {/* Assignee avatars */}
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
                      ? <img src={m.avatarStorageKey} alt="" className="h-full w-full rounded-full object-cover" />
                      : <span className="bg-primary/10 text-primary h-full w-full rounded-full flex items-center justify-center text-[9px]">{initials}</span>}
                  </button>
                )
              })}
              {filterAssignee && (
                <button onClick={() => setFilterAssignee('')} className="ml-1 text-muted-foreground hover:text-foreground">
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
                  className={cn('rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                    filterType === t ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {t === 'all' ? 'All' : t === 'run' ? 'Runs' : 'GTM'}
                </button>
              ))}
            </div>

            {/* Overdue toggle */}
            <button
              onClick={() => setOverdueOnly((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-colors',
                overdueOnly ? 'border-red-300 bg-red-50 text-red-600' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Icons.Clock className="h-3 w-3" />
              {overdueOnly ? `${totalOverdue} overdue` : 'Overdue'}
            </button>
          </>
        )}

        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {allItems.length} item{allItems.length !== 1 ? 's' : ''}
        </span>
        <button onClick={load} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <Icons.RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      {loading && !runs.length && !revisions.length ? (
        <div className="flex flex-1 items-center justify-center">
          <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Board view */}
          {view === 'board' && (
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

          {/* Timeline view */}
          {view === 'timeline' && (
            <TimelineView
              items={allItems}
              members={members}
              onCardClick={handleCardClick}
            />
          )}

          {/* Table view */}
          {view === 'table' && (
            <PMTableView
              items={allItems}
              members={members}
              onCardClick={handleCardClick}
              onAssignRun={assignRun}
              onAssignRevision={assignRevision}
            />
          )}

          {/* Dashboard view */}
          {view === 'dashboard' && (
            <DashboardView
              items={allItems}
              members={members}
              onCardClick={handleCardClick}
            />
          )}
        </>
      )}

      {/* ── Task detail panel ───────────────────────────────────────────── */}
      <TaskDetailPanel
        item={selectedItem}
        members={members}
        onClose={() => setSelectedItem(null)}
        onAssignRun={assignRun}
        onAssignRevision={assignRevision}
        onStageChange={handleStageChange}
        onNavigate={handleNavigate}
      />
    </div>
  )
}
