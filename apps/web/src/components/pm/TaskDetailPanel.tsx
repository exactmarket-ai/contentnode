// Slide-over detail panel for pipeline items — replaces full-page navigation for quick edits.
import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import {
  type CardItem, type ColKey, type Member,
  COLUMNS, COL_BY_KEY, getItemTitle, getItemClient, getItemStage,
  getItemDueDate, getItemCreatedAt, dueDateChip, timeAgo,
  RUN_COL_TO_STATUS, REV_COL_TO_STATUS,
} from './types'
import { AssigneePicker } from './shared'
import { CommentsPanel } from './CommentsPanel'

interface Props {
  item: CardItem | null
  members: Member[]
  currentUserId?: string
  onClose: () => void
  onAssignRun: (id: string, m: Member | null) => void
  onAssignRevision: (id: string, m: Member | null) => void
  onStageChange: (item: CardItem, col: ColKey) => void
  onNavigate: (item: CardItem) => void
}

export function TaskDetailPanel({ item, members, currentUserId, onClose, onAssignRun, onAssignRevision, onStageChange, onNavigate }: Props) {
  const [tab,         setTab]         = useState<'details' | 'comments'>('details')
  const [dueDateEdit, setDueDateEdit] = useState<string>('')
  const [savingDate,  setSavingDate]  = useState(false)

  // Reset to details tab + sync due date when item changes
  useEffect(() => {
    setTab('details')
    if (item?._type === 'run' && item.data.dueDate) {
      setDueDateEdit(item.data.dueDate.slice(0, 10))
    } else {
      setDueDateEdit('')
    }
  }, [item?.data.id])

  // Close on Escape
  useEffect(() => {
    if (!item) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [item, onClose])

  const handleDueDateSave = async () => {
    if (!item || item._type !== 'run') return
    setSavingDate(true)
    await apiFetch(`/api/v1/runs/${item.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { dueDate: dueDateEdit ? new Date(dueDateEdit).toISOString() : null } }),
    }).catch(() => {})
    setSavingDate(false)
    onClose()
  }

  const stage = item ? getItemStage(item) : null
  const col   = stage ? COL_BY_KEY[stage] : null
  const due   = item ? dueDateChip(getItemDueDate(item)) : null
  const isRun = item?._type === 'run'
  const isLive = isRun && ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(item!.data.status)

  const currentAssignee = (() => {
    if (!item) return null
    const id = item._type === 'run' ? item.data.assigneeId : item.data.assigneeId
    const m  = members.find((m) => m.id === id)
    return m ? { id: m.id, name: m.name, avatarStorageKey: m.avatarStorageKey } : null
  })()

  return (
    <>
      {/* Backdrop click to close */}
      {item && (
        <div className="fixed inset-0 z-40" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-[400px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ease-in-out',
          item ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {!item ? null : (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-border shrink-0">
              <div className="flex-1 min-w-0">
                {/* Type + stage badges */}
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border',
                    isRun ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200',
                  )}>
                    {isRun ? <Icons.Workflow className="h-2.5 w-2.5" /> : <Icons.FileText className="h-2.5 w-2.5" />}
                    {isRun ? 'Run' : 'GTM'}
                  </span>
                  {col && (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border', col.color, col.headerCls)}>
                      {col.label}
                    </span>
                  )}
                  {isLive && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-500 text-white border-0 animate-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      Live
                    </span>
                  )}
                </div>
                {/* Title */}
                <h2 className="text-sm font-bold leading-snug text-foreground">{getItemTitle(item)}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{getItemClient(item)}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors shrink-0">
                <Icons.X className="h-4 w-4" />
              </button>
            </div>

            {/* Tab switcher (only for runs which have comments) */}
            {isRun && (
              <div className="flex border-b border-border shrink-0">
                {(['details', 'comments'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'flex-1 py-2 text-[11px] font-medium transition-colors',
                      tab === t
                        ? 'border-b-2 border-blue-500 text-blue-600'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'details' ? 'Details' : (
                      <span className="flex items-center justify-center gap-1">
                        Comments
                        {(item as { _type: 'run'; data: { _count: { comments: number } } }).data._count.comments > 0 && (
                          <span className="rounded-full bg-blue-100 text-blue-600 px-1.5 py-0.5 text-[9px] font-bold">
                            {(item as { _type: 'run'; data: { _count: { comments: number } } }).data._count.comments}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Comments tab */}
            {isRun && tab === 'comments' && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <CommentsPanel
                  runId={item!.data.id}
                  members={members}
                  currentUserId={currentUserId ?? ''}
                />
              </div>
            )}

            {/* Details tab (or full body for revisions) */}
            {(tab === 'details' || !isRun) && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Stage picker */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Stage</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLUMNS.filter((c) => c.key !== 'in_production').map((c) => (
                    <button
                      key={c.key}
                      disabled={isLive}
                      onClick={() => {
                        if (isLive) return
                        onStageChange(item, c.key)
                        onClose()
                      }}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[10px] font-semibold border transition-all',
                        stage === c.key
                          ? `${c.color} border-current bg-current/10`
                          : 'text-muted-foreground border-border hover:border-gray-400 hover:text-foreground',
                        isLive && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assignee */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Assignee</p>
                <div className="flex items-center gap-2">
                  <AssigneePicker
                    current={currentAssignee}
                    members={members}
                    size="md"
                    onAssign={(m) => {
                      if (item._type === 'run')      onAssignRun(item.data.id, m)
                      else                            onAssignRevision(item.data.id, m)
                    }}
                  />
                  {currentAssignee
                    ? <span className="text-xs text-foreground">{currentAssignee.name}</span>
                    : <span className="text-xs text-muted-foreground italic">Unassigned</span>}
                </div>
              </div>

              {/* Due date (runs only) */}
              {isRun && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Due Date</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dueDateEdit}
                      onChange={(e) => setDueDateEdit(e.target.value)}
                      className="h-7 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {dueDateEdit !== (item.data.dueDate?.slice(0, 10) ?? '') && (
                      <button
                        onClick={handleDueDateSave}
                        disabled={savingDate}
                        className="h-7 rounded-lg bg-blue-500 text-white px-3 text-[11px] font-medium hover:bg-blue-600 transition-colors disabled:opacity-60"
                      >
                        {savingDate ? 'Saving…' : 'Save'}
                      </button>
                    )}
                    {due && (
                      <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', due.cls)}>
                        {due.text}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Comments / stats row */}
              {isRun && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icons.MessageCircle className="h-3.5 w-3.5" />
                    <span>{item.data._count.comments} comment{item.data._count.comments !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icons.Clock className="h-3.5 w-3.5" />
                    <span>Created {timeAgo(getItemCreatedAt(item))}</span>
                  </div>
                </div>
              )}

              {/* Notes (revisions) */}
              {!isRun && item._type === 'revision' && item.data.notes && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Notes</p>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/30 p-3 border border-border">
                    {item.data.notes}
                  </p>
                </div>
              )}

              {/* Run status info */}
              {isRun && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Details</p>
                  <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium capitalize">{item.data.status.replace(/_/g, ' ')}</span>
                    </div>
                    {item.data.completedAt && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Completed</span>
                        <span className="font-medium">{timeAgo(item.data.completedAt)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Workflow</span>
                      <span className="font-medium truncate max-w-[180px]">{item.data.workflow?.name ?? '—'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Footer actions */}
            <div className="shrink-0 border-t border-border px-5 py-4">
              <button
                onClick={() => onNavigate(item)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                {isRun
                  ? <><Icons.ExternalLink className="h-4 w-4" /> Open Full Review</>
                  : <><Icons.ExternalLink className="h-4 w-4" /> View Framework</>}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
