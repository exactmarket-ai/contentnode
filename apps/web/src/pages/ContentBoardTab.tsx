/**
 * ContentBoardTab.tsx
 *
 * Kanban-style content board for a client.
 * Columns: In Production → Draft → In Review → Sent to Client → Closed
 * Cards are draggable between columns. Click to open a detail panel with
 * the comment thread.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type ReviewStatus = 'none' | 'pending' | 'sent_to_client' | 'client_responded' | 'closed'

interface BoardRun {
  id: string
  workflowName: string
  itemName: string | null
  status: string
  reviewStatus: ReviewStatus
  createdAt: string
  completedAt: string | null
  dueDate: string | null
  assigneeId: string | null
  assignee: { id: string; name: string | null; avatarStorageKey: string | null } | null
  internalNotes: string | null
  finalOutput: unknown
  nodeStatuses: Record<string, { output?: unknown; status?: string }> | null
  editedContent: Record<string, string> | null
  workflow?: { nodes?: Array<{ id: string; label: string; type: string }> } | null
  _commentCount?: number
}

interface Comment {
  id: string
  body: string
  createdAt: string
  user: { id: string; name: string | null; avatarStorageKey: string | null }
}

// ── Board column definitions ───────────────────────────────────────────────────

type ColumnKey = 'in_production' | 'draft' | 'in_review' | 'client_review' | 'closed'

const COLUMNS: { key: ColumnKey; label: string; icon: keyof typeof Icons; color: string; headerColor: string }[] = [
  { key: 'in_production', label: 'In Production', icon: 'Zap',         color: 'text-blue-500',   headerColor: 'border-blue-500/40 bg-blue-500/5' },
  { key: 'draft',         label: 'Draft',         icon: 'FileText',    color: 'text-slate-400',  headerColor: 'border-slate-400/40 bg-slate-400/5' },
  { key: 'in_review',     label: 'In Review',     icon: 'Eye',         color: 'text-amber-500',  headerColor: 'border-amber-500/40 bg-amber-500/5' },
  { key: 'client_review', label: 'Client Review', icon: 'Users',       color: 'text-violet-500', headerColor: 'border-violet-500/40 bg-violet-500/5' },
  { key: 'closed',        label: 'Closed',        icon: 'CheckCircle2',color: 'text-green-500',  headerColor: 'border-green-500/40 bg-green-500/5' },
]

function getColumn(run: BoardRun): ColumnKey {
  if (['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)) return 'in_production'
  if (run.status === 'failed' || run.status === 'cancelled') return 'draft' // surface as draft so they're visible
  if (run.reviewStatus === 'closed') return 'closed'
  if (run.reviewStatus === 'sent_to_client' || run.reviewStatus === 'client_responded') return 'client_review'
  if (run.reviewStatus === 'pending') return 'in_review'
  return 'draft'
}

// Dragging a card to a column maps to this reviewStatus PATCH
const COLUMN_TO_REVIEW_STATUS: Partial<Record<ColumnKey, ReviewStatus>> = {
  draft:         'none',
  in_review:     'pending',
  client_review: 'sent_to_client',
  closed:        'closed',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPreview(run: BoardRun): string {
  const edited = run.editedContent ?? {}
  const nodeMap = Object.fromEntries((run.workflow?.nodes ?? []).map((n) => [n.id, n]))
  const outputs = Object.entries(run.nodeStatuses ?? {})
    .filter(([, s]) => s.status === 'passed' && s.output != null)
    .map(([nodeId, s]) => {
      const node = nodeMap[nodeId]
      if (!node || node.type !== 'output') return null
      const raw = edited[nodeId] ?? (typeof s.output === 'string' ? s.output : (s.output as Record<string,unknown>)?.content as string ?? '')
      return raw
    })
    .filter(Boolean) as string[]

  const text = outputs[0] ?? (typeof run.finalOutput === 'string' ? run.finalOutput : '')
  return text.slice(0, 120).replace(/\s+/g, ' ').trim()
}

function dueDateLabel(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.ceil(diff / 86400000)
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: 'bg-red-500/10 text-red-600 border-red-200' }
  if (days === 0) return { text: 'Due today', cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  if (days <= 3) return { text: `Due in ${days}d`, cls: 'bg-amber-500/10 text-amber-600 border-amber-200' }
  return { text: `Due ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, cls: 'bg-muted text-muted-foreground border-border' }
}

function Avatar({ user, size = 'sm' }: { user: { name: string | null; avatarStorageKey: string | null } | null; size?: 'sm' | 'md' }) {
  if (!user) return null
  const sz = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-7 w-7 text-[11px]'
  const initials = user.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  if (user.avatarStorageKey) {
    return <img src={assetUrl(user.avatarStorageKey)} alt={user.name ?? ''} className={cn('rounded-full object-cover border border-border shrink-0', sz)} title={user.name ?? ''} />
  }
  return (
    <div className={cn('rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-semibold shrink-0', sz)} title={user.name ?? ''}>
      {initials}
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

// ── Board card ────────────────────────────────────────────────────────────────

function BoardCard({
  run,
  onDragStart,
  onClick,
}: {
  run: BoardRun
  onDragStart: (runId: string) => void
  onClick: (run: BoardRun) => void
}) {
  const preview = getPreview(run)
  const due = dueDateLabel(run.dueDate)
  const isLive = ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(run.status)
  const isFailed = run.status === 'failed' || run.status === 'cancelled'

  return (
    <div
      draggable={!isLive}
      onDragStart={() => onDragStart(run.id)}
      onClick={() => onClick(run)}
      className={cn(
        'group rounded-xl border bg-card p-3 cursor-pointer select-none transition-all',
        'hover:border-border/80 hover:shadow-sm active:opacity-70',
        isFailed ? 'border-red-200/60 opacity-70' : 'border-border',
        isLive && 'cursor-default',
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[12px] font-semibold leading-snug line-clamp-2 flex-1">
          {run.itemName || run.workflowName}
        </p>
        {isFailed && <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500 mt-0.5" />}
        {isLive && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1" />}
      </div>

      {/* Workflow name (if title differs) */}
      {run.itemName && run.itemName !== run.workflowName && (
        <p className="text-[10px] text-muted-foreground mb-1.5 truncate">{run.workflowName}</p>
      )}

      {/* Preview text */}
      {preview && (
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mb-2">{preview}</p>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {due && (
          <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', due.cls)}>
            {due.text}
          </span>
        )}
        <div className="flex-1" />
        {(run._commentCount ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Icons.MessageCircle className="h-3 w-3" />
            {run._commentCount}
          </span>
        )}
        <Avatar user={run.assignee} size="sm" />
        <span className="text-[10px] text-muted-foreground">{timeAgo(run.createdAt)}</span>
      </div>
    </div>
  )
}

// ── Board column ──────────────────────────────────────────────────────────────

function BoardColumn({
  column,
  runs,
  dragOverKey,
  onDragStart,
  onDragOver,
  onDrop,
  onCardClick,
}: {
  column: typeof COLUMNS[number]
  runs: BoardRun[]
  dragOverKey: ColumnKey | null
  onDragStart: (runId: string) => void
  onDragOver: (key: ColumnKey) => void
  onDrop: (key: ColumnKey) => void
  onCardClick: (run: BoardRun) => void
}) {
  const Icon = Icons[column.icon] as React.ComponentType<{ className?: string }>
  const isOver = dragOverKey === column.key

  return (
    <div
      className={cn('flex flex-col min-w-[220px] w-[220px] shrink-0 rounded-xl border transition-colors', column.headerColor, isOver && 'ring-2 ring-blue-400 ring-offset-1')}
      onDragOver={(e) => { e.preventDefault(); onDragOver(column.key) }}
      onDrop={(e) => { e.preventDefault(); onDrop(column.key) }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', column.color)} />
        <span className="text-[11px] font-semibold">{column.label}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">{runs.length}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto">
        {runs.length === 0 && (
          <div className={cn('rounded-lg border-2 border-dashed p-4 text-center', isOver ? 'border-blue-400 bg-blue-50/30' : 'border-border/30')}>
            <p className="text-[10px] text-muted-foreground/50">Drop here</p>
          </div>
        )}
        {runs.map((run) => (
          <BoardCard key={run.id} run={run} onDragStart={onDragStart} onClick={onCardClick} />
        ))}
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  run,
  onClose,
  onStatusChange,
}: {
  run: BoardRun
  onClose: () => void
  onStatusChange: (id: string, status: ReviewStatus) => void
}) {
  const [comments, setComments]   = useState<Comment[]>([])
  const [loadingCmt, setLoadingCmt] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting]     = useState(false)
  const [status, setStatus]       = useState<ReviewStatus>(run.reviewStatus)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch(`/api/v1/runs/${run.id}/comments`)
      .then((r) => r.json())
      .then(({ data }) => setComments(data ?? []))
      .catch(() => {})
      .finally(() => setLoadingCmt(false))
  }, [run.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

  const postComment = async () => {
    const body = newComment.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const res = await apiFetch(`/api/v1/runs/${run.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const { data } = await res.json()
      if (data) {
        setComments((prev) => [...prev, data])
        setNewComment('')
      }
    } catch { /* noop */ }
    finally { setPosting(false) }
  }

  const handleStatusChange = async (newStatus: ReviewStatus) => {
    setStatus(newStatus)
    onStatusChange(run.id, newStatus)
    await apiFetch(`/api/v1/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: newStatus }),
    }).catch(() => {})
  }

  const preview = getPreview(run)
  const due = dueDateLabel(run.dueDate)

  const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
    { value: 'none',             label: 'Draft' },
    { value: 'pending',          label: 'In Review' },
    { value: 'sent_to_client',   label: 'Sent to Client' },
    { value: 'client_responded', label: 'Client Responded' },
    { value: 'closed',           label: 'Closed' },
  ]

  return (
    <div className="flex flex-col h-full w-[380px] shrink-0 border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight truncate">{run.itemName || run.workflowName}</p>
          {run.itemName && <p className="text-[11px] text-muted-foreground truncate">{run.workflowName}</p>}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        {/* Status selector */}
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value as ReviewStatus)}
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {due && (
          <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', due.cls)}>
            <Icons.Calendar className="h-3 w-3 inline mr-0.5 -mt-px" />
            {due.text}
          </span>
        )}

        {run.assignee && (
          <div className="flex items-center gap-1">
            <Avatar user={run.assignee} size="sm" />
            <span className="text-[10px] text-muted-foreground">{run.assignee.name}</span>
          </div>
        )}
      </div>

      {/* Content preview */}
      {preview && (
        <div className="px-4 py-3 border-b border-border shrink-0">
          <p className="text-[11px] text-muted-foreground font-medium mb-1">Content preview</p>
          <p className="text-[12px] leading-relaxed line-clamp-4">{preview}…</p>
        </div>
      )}

      {/* Comments */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        <p className="text-[11px] font-semibold text-muted-foreground">Team comments</p>
        {loadingCmt ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-6 text-center">
            <Icons.MessageCircle className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1.5" />
            <p className="text-[11px] text-muted-foreground">No comments yet</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar user={c.user} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] font-semibold">{c.user.name ?? 'Team member'}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="text-[12px] leading-relaxed mt-0.5 whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Comment input */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment() } }}
            placeholder="Add a comment… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={postComment}
            disabled={!newComment.trim() || posting}
            className="self-end rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            {posting ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main board ────────────────────────────────────────────────────────────────

export function ContentBoardTab({ clientId }: { clientId: string }) {
  const [runs, setRuns]           = useState<BoardRun[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<BoardRun | null>(null)
  const [dragging, setDragging]   = useState<string | null>(null)
  const [dragOver, setDragOver]   = useState<ColumnKey | null>(null)
  const [search, setSearch]       = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/v1/runs?clientId=${clientId}&limit=200`)
      .then((r) => r.json())
      .then(({ data }) => setRuns(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleDrop = async (targetCol: ColumnKey) => {
    if (!dragging) return
    const newStatus = COLUMN_TO_REVIEW_STATUS[targetCol]
    if (!newStatus) { setDragging(null); setDragOver(null); return } // can't drag into in_production
    const run = runs.find((r) => r.id === dragging)
    if (!run || getColumn(run) === targetCol) { setDragging(null); setDragOver(null); return }

    setRuns((prev) => prev.map((r) => r.id === dragging ? { ...r, reviewStatus: newStatus } : r))
    setDragging(null)
    setDragOver(null)

    await apiFetch(`/api/v1/runs/${dragging}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus: newStatus }),
    }).catch(() => load()) // reload on error to restore state
  }

  const handleStatusChange = (id: string, status: ReviewStatus) => {
    setRuns((prev) => prev.map((r) => r.id === id ? { ...r, reviewStatus: status } : r))
    if (selected?.id === id) setSelected((prev) => prev ? { ...prev, reviewStatus: status } : prev)
  }

  const filtered = search
    ? runs.filter((r) => (r.itemName ?? r.workflowName).toLowerCase().includes(search.toLowerCase()))
    : runs

  const byColumn = Object.fromEntries(
    COLUMNS.map((c) => [c.key, filtered.filter((r) => getColumn(r) === c.key)])
  ) as Record<ColumnKey, BoardRun[]>

  const total = runs.length
  const overdue = runs.filter((r) => r.dueDate && new Date(r.dueDate) < new Date() && r.reviewStatus !== 'closed').length

  return (
    <div className="flex h-full min-h-0">
      {/* Board area */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3 shrink-0">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search content…"
              className="w-56 rounded-lg border border-border bg-muted/30 py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground">
            <span>{total} items</span>
            {overdue > 0 && (
              <span className="flex items-center gap-1 text-red-500 font-medium">
                <Icons.AlertCircle className="h-3.5 w-3.5" />
                {overdue} overdue
              </span>
            )}
            <button onClick={load} className="rounded p-1 hover:bg-muted transition-colors" title="Refresh">
              <Icons.RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Columns */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div
            className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden p-5 min-h-0"
            onDragEnd={() => { setDragging(null); setDragOver(null) }}
          >
            {COLUMNS.map((col) => (
              <BoardColumn
                key={col.key}
                column={col}
                runs={byColumn[col.key]}
                dragOverKey={dragOver}
                onDragStart={(id) => setDragging(id)}
                onDragOver={(key) => setDragOver(key)}
                onDrop={handleDrop}
                onCardClick={(run) => setSelected((prev) => prev?.id === run.id ? null : run)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          run={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  )
}
