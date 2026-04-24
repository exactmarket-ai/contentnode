// Sortable table view for pipeline items.
import { useState, useMemo } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type CardItem, type Member, type ColKey,
  COL_BY_KEY,
  getItemTitle, getItemClient, getItemStage, getItemDueDate, getItemCreatedAt,
  isItemOverdue, dueDateChip, timeAgo,
} from './types'
import { AssigneePicker } from './shared'

type SortKey = 'title' | 'client' | 'stage' | 'dueDate' | 'createdAt'
type SortDir = 'asc' | 'desc'

function sortItems(items: CardItem[], key: SortKey, dir: SortDir): CardItem[] {
  const sorted = [...items].sort((a, b) => {
    let va = '', vb = ''
    switch (key) {
      case 'title':     va = getItemTitle(a);     vb = getItemTitle(b);     break
      case 'client':    va = getItemClient(a);    vb = getItemClient(b);    break
      case 'stage':     va = getItemStage(a);     vb = getItemStage(b);     break
      case 'dueDate':   va = getItemDueDate(a) ?? '9999'; vb = getItemDueDate(b) ?? '9999'; break
      case 'createdAt': va = getItemCreatedAt(a); vb = getItemCreatedAt(b); break
    }
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
  })
  return sorted
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <Icons.ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
  return dir === 'asc'
    ? <Icons.ArrowUp className="h-3 w-3 text-blue-500" />
    : <Icons.ArrowDown className="h-3 w-3 text-blue-500" />
}

export function PMTableView({
  items,
  members,
  onCardClick,
  onAssignRun,
  onAssignRevision,
}: {
  items: CardItem[]
  members: Member[]
  onCardClick: (item: CardItem) => void
  onAssignRun: (id: string, m: Member | null) => void
  onAssignRevision: (id: string, m: Member | null) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('dueDate')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sorted = useMemo(() => sortItems(items, sortKey, sortDir), [items, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  function ThCell({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    return (
      <th
        onClick={() => toggleSort(k)}
        className={cn('cursor-pointer select-none px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap', className)}
      >
        <div className="flex items-center gap-1.5">
          {label}
          <SortIcon active={sortKey === k} dir={sortDir} />
        </div>
      </th>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 text-muted-foreground">
        <Icons.Table className="h-10 w-10 opacity-20" />
        <p className="text-sm">No items match your filters</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background border-b border-border">
          <tr>
            <th className="w-8 px-3 py-2.5" />
            <ThCell label="Title"   k="title"     className="min-w-[200px]" />
            <ThCell label="Client"  k="client"    className="w-36" />
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-20">Type</th>
            <ThCell label="Stage"   k="stage"     className="w-36" />
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-24">Assignee</th>
            <ThCell label="Due"     k="dueDate"   className="w-28" />
            <ThCell label="Created" k="createdAt" className="w-24" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, idx) => {
            const col      = COL_BY_KEY[getItemStage(item)]
            const due      = dueDateChip(getItemDueDate(item))
            const overdue  = isItemOverdue(item)
            const isRun    = item._type === 'run'
            const isLive   = isRun && ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(item.data.status)

            const assigneeId = item._type === 'run' ? item.data.assigneeId : item.data.assigneeId
            const assignee   = members.find((m) => m.id === assigneeId) ?? null
            const assigneeObj = assignee ? { id: assignee.id, name: assignee.name, avatarStorageKey: assignee.avatarStorageKey } : null

            return (
              <tr
                key={item.data.id}
                className={cn(
                  'border-b border-border/40 cursor-pointer transition-colors hover:bg-muted/30 group',
                  idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30',
                  overdue && 'bg-red-50/30',
                )}
                onClick={() => onCardClick(item)}
              >
                {/* Stage color strip */}
                <td className="w-8 px-0 py-0">
                  <div className="h-full w-1 rounded-r" style={{ backgroundColor: col.barColor, minHeight: 40 }} />
                </td>

                {/* Title */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {isLive && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
                    <span className="font-medium text-foreground text-[12px] leading-snug group-hover:text-blue-600 transition-colors">
                      {getItemTitle(item)}
                    </span>
                    {item._type === 'run' && item.data._count.comments > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                        <Icons.MessageCircle className="h-3 w-3" />
                        {item.data._count.comments}
                      </span>
                    )}
                  </div>
                </td>

                {/* Client */}
                <td className="px-3 py-2.5">
                  <span className="text-[11px] text-muted-foreground truncate block max-w-[130px]">{getItemClient(item)}</span>
                </td>

                {/* Type */}
                <td className="px-3 py-2.5">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                    isRun ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700',
                  )}>
                    {isRun ? 'Run' : 'GTM'}
                  </span>
                </td>

                {/* Stage */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border', col.color, col.headerCls)}>
                    {col.label}
                  </span>
                </td>

                {/* Assignee */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <AssigneePicker
                    current={assigneeObj}
                    members={members}
                    onAssign={(m) => {
                      if (item._type === 'run') onAssignRun(item.data.id, m)
                      else onAssignRevision(item.data.id, m)
                    }}
                  />
                </td>

                {/* Due date */}
                <td className="px-3 py-2.5">
                  {due
                    ? <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap', due.cls)}>{due.text}</span>
                    : <span className="text-[10px] text-muted-foreground/40">—</span>}
                </td>

                {/* Created */}
                <td className="px-3 py-2.5">
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(getItemCreatedAt(item))}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
