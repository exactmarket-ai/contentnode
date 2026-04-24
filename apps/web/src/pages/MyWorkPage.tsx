import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import {
  type PipelineRun, type CardItem, type Member, type ColKey,
  COL_BY_KEY, runToCol, dueDateChip, timeAgo, isItemOverdue,
  RUN_COL_TO_STATUS,
} from '../components/pm/types'
import { TaskDetailPanel } from '../components/pm/TaskDetailPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecentComment {
  id: string
  body: string
  createdAt: string
  user: { id: string; name: string | null; avatarStorageKey: string | null }
  workflowRun: {
    id: string
    itemName: string | null
    workflow: { name: string; client: { name: string } | null } | null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function groupRuns(runs: PipelineRun[]): {
  overdue: PipelineRun[]
  today: PipelineRun[]
  thisWeek: PipelineRun[]
  later: PipelineRun[]
  noDue: PipelineRun[]
} {
  const now  = Date.now()
  const endOfDay  = new Date(); endOfDay.setHours(23, 59, 59, 999)
  const endOfWeek = new Date(); endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay())); endOfWeek.setHours(23, 59, 59, 999)

  const overdue: PipelineRun[]  = []
  const today: PipelineRun[]    = []
  const thisWeek: PipelineRun[] = []
  const later: PipelineRun[]    = []
  const noDue: PipelineRun[]    = []

  for (const r of runs) {
    if (!r.dueDate) { noDue.push(r); continue }
    const d = new Date(r.dueDate).getTime()
    if (d < now) { overdue.push(r); continue }
    if (d <= endOfDay.getTime()) { today.push(r); continue }
    if (d <= endOfWeek.getTime()) { thisWeek.push(r); continue }
    later.push(r)
  }
  return { overdue, today, thisWeek, later, noDue }
}

function renderMentionBody(body: string): React.ReactNode {
  const parts = body.split(/(@\w+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^@\w+/.test(part)
          ? <span key={i} className="font-semibold text-blue-600">{part}</span>
          : part,
      )}
    </>
  )
}

// ── Queue item card ────────────────────────────────────────────────────────────

function QueueCard({ run, onClick }: { run: PipelineRun; onClick: () => void }) {
  const stage = runToCol(run)
  const col   = COL_BY_KEY[stage]
  const due   = dueDateChip(run.dueDate)
  const isLive = ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)
  const title  = run.itemName || run.workflow?.name || 'Untitled'
  const client = run.workflow?.client?.name ?? ''

  return (
    <button
      onClick={onClick}
      className="w-full flex items-stretch gap-0 rounded-xl border border-border bg-white hover:shadow-md hover:-translate-y-px transition-all text-left group overflow-hidden"
    >
      {/* Stage color bar */}
      <div className="w-1 shrink-0" style={{ backgroundColor: col.barColor }} />

      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-foreground group-hover:text-blue-600 transition-colors leading-snug truncate">{title}</p>
            {client && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{client}</p>}
          </div>
          {isLive && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1" />}
        </div>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold border', col.color, col.headerCls)}>
            {col.label}
          </span>
          {due && <span className={cn('rounded-md border px-1.5 py-0.5 text-[9px] font-medium', due.cls)}>{due.text}</span>}
          {run._count.comments > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto">
              <Icons.MessageCircle className="h-3 w-3" />{run._count.comments}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Queue section ─────────────────────────────────────────────────────────────

function QueueSection({
  label, runs, icon: Icon, color, onClick,
}: {
  label: string; runs: PipelineRun[]; icon: React.ComponentType<{ className?: string }>; color: string
  onClick: (r: PipelineRun) => void
}) {
  if (runs.length === 0) return null
  return (
    <div>
      <div className={cn('flex items-center gap-1.5 mb-2')}>
        <Icon className={cn('h-3.5 w-3.5', color)} />
        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', color)}>{label}</p>
        <span className="text-[10px] text-muted-foreground">({runs.length})</span>
      </div>
      <div className="space-y-2">
        {runs.map((r) => <QueueCard key={r.id} run={r} onClick={() => onClick(r)} />)}
      </div>
    </div>
  )
}

// ── Comment card ───────────────────────────────────────────────────────────────

function CommentCard({ comment, currentUserId, onClick }: { comment: RecentComment; currentUserId: string; onClick: () => void }) {
  const isMine = comment.user.id === currentUserId
  const runName = comment.workflowRun.itemName || comment.workflowRun.workflow?.name || 'Untitled'
  const client  = comment.workflowRun.workflow?.client?.name ?? ''
  const initials = comment.user.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2.5 p-3 rounded-xl border border-border bg-white hover:shadow-sm hover:border-blue-200 transition-all text-left group"
    >
      {comment.user.avatarStorageKey
        ? <img src={comment.user.avatarStorageKey} alt="" className="h-7 w-7 rounded-full object-cover shrink-0 border border-border" />
        : <div className="h-7 w-7 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-[9px] font-semibold shrink-0">{initials}</div>
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="text-[11px] font-semibold text-foreground">
            {isMine ? 'You' : (comment.user.name ?? 'Unknown')}
          </span>
          <span className="text-[9px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-1 truncate">
          {runName}{client ? ` · ${client}` : ''}
        </p>
        <p className="text-[11px] text-foreground leading-relaxed line-clamp-2">
          {renderMentionBody(comment.body)}
        </p>
      </div>
      <Icons.ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-1 group-hover:text-muted-foreground transition-colors" />
    </button>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function Stat({ n, label, icon: Icon, color, sub }: { n: number; label: string; icon: React.ComponentType<{ className?: string }>; color: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 flex items-center gap-3">
      <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none text-foreground">{n}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function MyWorkPage() {
  const navigate            = useNavigate()
  const { user }            = useCurrentUser()

  const [runs,           setRuns]           = useState<PipelineRun[]>([])
  const [comments,       setComments]       = useState<RecentComment[]>([])
  const [members,        setMembers]        = useState<Member[]>([])
  const [myUserId,       setMyUserId]       = useState<string>('')
  const [loading,        setLoading]        = useState(true)
  const [selectedItem,   setSelectedItem]   = useState<CardItem | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/v1/my-work')
      .then((r) => r.json())
      .then(({ data }) => {
        setRuns(data.runs ?? [])
        setComments(data.recentComments ?? [])
        setMembers(data.members ?? [])
        setMyUserId(data.userId ?? '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const groups = groupRuns(runs)

  const stats = {
    total:    runs.length,
    overdue:  groups.overdue.length,
    dueToday: groups.today.length,
    comments: comments.length,
  }

  const handleRunClick = useCallback((run: PipelineRun) => {
    setSelectedItem({ _type: 'run', data: run })
  }, [])

  const handleCommentClick = useCallback((comment: RecentComment) => {
    const run = runs.find((r) => r.id === comment.workflowRun.id)
    if (run) setSelectedItem({ _type: 'run', data: run })
  }, [runs])

  const assignRun = useCallback(async (id: string, member: Member | null) => {
    setRuns((prev) => prev.map((r) => r.id === id
      ? { ...r, assigneeId: member?.id ?? null, assignee: member ? { id: member.id, name: member.name, avatarStorageKey: member.avatarStorageKey } : null }
      : r))
    await apiFetch(`/api/v1/runs/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { assigneeId: member?.id ?? null } }),
    }).catch(() => {})
  }, [])

  const handleStageChange = useCallback(async (item: CardItem, colKey: ColKey) => {
    if (item._type !== 'run') return
    const newStatus = RUN_COL_TO_STATUS[colKey]
    if (!newStatus || colKey === 'in_production') return
    setRuns((prev) => prev.map((r) => r.id === item.data.id ? { ...r, reviewStatus: newStatus } : r))
    await apiFetch(`/api/v1/pipeline/runs/${item.data.id}/stage`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: newStatus }),
    }).catch(() => {})
  }, [])

  const handleNavigate = useCallback((item: CardItem) => {
    setSelectedItem(null)
    if (item._type === 'run') navigate(`/review/${item.data.id}`)
    else navigate(`/clients/${item.data.clientId}?tab=framework&verticalId=${item.data.verticalId}`)
  }, [navigate])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 px-6 py-5 border-b border-border bg-background">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">
              {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Here's your work queue</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">{today}</p>
            <button onClick={load} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <Icons.RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat n={stats.total}    label="Assigned to me"   icon={Icons.ClipboardList}  color="bg-blue-50 text-blue-600" />
          <Stat n={stats.overdue}  label="Overdue"          icon={Icons.AlertTriangle}  color="bg-red-50 text-red-600"   sub={stats.overdue > 0 ? 'needs attention' : 'all good!'} />
          <Stat n={stats.dueToday} label="Due today"        icon={Icons.CalendarClock}  color="bg-amber-50 text-amber-600" />
          <Stat n={stats.comments} label="Recent comments"  icon={Icons.MessageCircle}  color="bg-violet-50 text-violet-600" />
        </div>
      </div>

      {/* ── Main content ── */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden gap-0">
          {/* My Queue */}
          <div className="flex-1 overflow-y-auto p-6 border-r border-border">
            <div className="max-w-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground">My Queue</h2>
                <span className="text-[11px] text-muted-foreground">{runs.length} item{runs.length !== 1 ? 's' : ''}</span>
              </div>

              {runs.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
                  <Icons.CheckCircle2 className="h-12 w-12 opacity-20" />
                  <p className="text-sm font-medium">You're all caught up!</p>
                  <p className="text-xs text-center">No items assigned to you right now.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <QueueSection label="Overdue"     runs={groups.overdue}   icon={Icons.AlertCircle}  color="text-red-500"    onClick={handleRunClick} />
                  <QueueSection label="Due Today"   runs={groups.today}     icon={Icons.Sun}          color="text-amber-500"  onClick={handleRunClick} />
                  <QueueSection label="This Week"   runs={groups.thisWeek}  icon={Icons.Calendar}     color="text-blue-500"   onClick={handleRunClick} />
                  <QueueSection label="Upcoming"    runs={groups.later}     icon={Icons.CalendarDays} color="text-slate-500"  onClick={handleRunClick} />
                  <QueueSection label="No Due Date" runs={groups.noDue}     icon={Icons.Minus}        color="text-slate-400"  onClick={handleRunClick} />
                </div>
              )}
            </div>
          </div>

          {/* Comments & activity */}
          <div className="w-[380px] shrink-0 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Comments on my work</h2>
              <span className="text-[11px] text-muted-foreground">{comments.length} recent</span>
            </div>

            {comments.length === 0 ? (
              <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
                <Icons.MessageSquare className="h-10 w-10 opacity-20" />
                <p className="text-sm">No comments yet on your items.</p>
                <p className="text-xs text-center text-muted-foreground/60">Comments left on your assigned runs will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {comments.map((c) => (
                  <CommentCard
                    key={c.id}
                    comment={c}
                    currentUserId={myUserId}
                    onClick={() => handleCommentClick(c)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task detail panel */}
      <TaskDetailPanel
        item={selectedItem}
        members={members}
        currentUserId={myUserId}
        onClose={() => setSelectedItem(null)}
        onAssignRun={assignRun}
        onAssignRevision={() => {}}
        onStageChange={handleStageChange}
        onNavigate={handleNavigate}
      />
    </div>
  )
}
