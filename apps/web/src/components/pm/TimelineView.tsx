// Gantt-style timeline view for pipeline items.
// Left panel: client groups + task names (scroll-synced).
// Right panel: scrollable time grid with bars, today line, and week columns.
import { useRef, useMemo, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type CardItem, type Member,
  COLUMNS, COL_BY_KEY, getItemTitle, getItemClient, getItemClientId,
  getItemStage, getItemDueDate, getItemCreatedAt,
} from './types'

const WEEK_WIDTH  = 128  // px per week column
const ROW_HEIGHT  = 36   // px per task row
const GROUP_H     = 30   // px per client group header
const HEADER_H    = 58   // px — month row (26) + week row (32)
const NUM_WEEKS   = 14   // total weeks shown (2 back + 12 forward)
const LABEL_WIDTH = 210  // px — left panel width

interface ClientGroup {
  clientId: string
  clientName: string
  items: CardItem[]
}

function buildGroups(items: CardItem[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>()
  for (const item of items) {
    const id   = getItemClientId(item)
    const name = getItemClient(item)
    if (!map.has(id)) map.set(id, { clientId: id, clientName: name, items: [] })
    map.get(id)!.items.push(item)
  }
  return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName))
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day)
  const out = new Date(d)
  out.setDate(d.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}

function useTimelineRange() {
  return useMemo(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)

    const rangeStart = startOfWeekMonday(new Date(today))
    rangeStart.setDate(rangeStart.getDate() - 14) // 2 weeks back

    const weeks = Array.from({ length: NUM_WEEKS }, (_, i) => {
      const d = new Date(rangeStart)
      d.setDate(d.getDate() + i * 7)
      return {
        index: i,
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isCurrentWeek: Math.abs(d.getTime() - today.getTime()) < 7 * 86400000,
      }
    })

    // Month spans for the top header row
    const months: { label: string; span: number; weekIndex: number }[] = []
    let curMonth = ''
    let curStart = 0
    weeks.forEach((w, i) => {
      const m = w.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (m !== curMonth) {
        if (curMonth) months.push({ label: curMonth, span: i - curStart, weekIndex: curStart })
        curMonth = m
        curStart = i
      }
    })
    if (curMonth) months.push({ label: curMonth, span: NUM_WEEKS - curStart, weekIndex: curStart })

    const todayDays = (today.getTime() - rangeStart.getTime()) / 86400000
    const todayX    = todayDays * (WEEK_WIDTH / 7)
    const totalWidth = NUM_WEEKS * WEEK_WIDTH

    return { rangeStart, weeks, months, todayX, totalWidth }
  }, [])
}

function barGeometry(item: CardItem, rangeStart: Date, totalWidth: number) {
  const startDate = new Date(getItemCreatedAt(item))
  const dueDate   = getItemDueDate(item)
  const endDate   = dueDate ? new Date(dueDate) : null

  const startDays = (startDate.getTime() - rangeStart.getTime()) / 86400000
  const endDays   = endDate ? (endDate.getTime() - rangeStart.getTime()) / 86400000 : startDays + 1

  const pxPerDay = WEEK_WIDTH / 7
  const rawLeft  = startDays * pxPerDay
  const rawRight = Math.max(endDays, startDays + 1) * pxPerDay

  const left  = Math.max(0, rawLeft)
  const right = Math.min(totalWidth, rawRight)
  const width = Math.max(20, right - left)

  const outOfRange = rawRight < 0 || rawLeft > totalWidth
  const truncLeft  = rawLeft < 0
  const truncRight = rawRight > totalWidth

  return { left, width, outOfRange, truncLeft, truncRight, hasDueDate: !!dueDate }
}

export function TimelineView({
  items,
  members: _members,
  onCardClick,
}: {
  items: CardItem[]
  members: Member[]
  onCardClick: (item: CardItem) => void
}) {
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  const { rangeStart, weeks, months, todayX, totalWidth } = useTimelineRange()
  const groups = useMemo(() => buildGroups(items), [items])

  const totalContentHeight = useMemo(
    () => groups.reduce((h, g) => h + GROUP_H + g.items.length * ROW_HEIGHT, 0),
    [groups],
  )

  const onScroll = useCallback(() => {
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop
    }
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 text-muted-foreground">
        <Icons.CalendarRange className="h-10 w-10 opacity-20" />
        <p className="text-sm">No items to display on timeline</p>
      </div>
    )
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderBar(item: CardItem) {
    const col = COL_BY_KEY[getItemStage(item)]
    const geo = barGeometry(item, rangeStart, totalWidth)
    if (geo.outOfRange) return null

    const title = getItemTitle(item)

    return (
      <div
        key={item.data.id}
        className="absolute top-1.5 h-[22px] flex items-center cursor-pointer group/bar select-none transition-opacity hover:opacity-80"
        style={{ left: geo.left, width: geo.width }}
        onClick={(e) => { e.stopPropagation(); onCardClick(item) }}
        title={title}
      >
        {/* Bar */}
        <div
          className={cn(
            'absolute inset-0 rounded-full flex items-center px-2 overflow-hidden',
            geo.truncLeft  ? 'rounded-l-none' : '',
            geo.truncRight ? 'rounded-r-none' : '',
          )}
          style={{ backgroundColor: col.barColor }}
        >
          <span className="text-[10px] font-medium text-white truncate leading-none">
            {geo.hasDueDate ? title : '●'}
          </span>
        </div>
        {/* Truncation indicators */}
        {geo.truncLeft  && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-r from-black/30 to-transparent rounded-l pointer-events-none" />}
        {geo.truncRight && <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-gradient-to-l from-black/30 to-transparent rounded-r pointer-events-none" />}
      </div>
    )
  }

  function renderRows() {
    return groups.map((group) => (
      <div key={group.clientId}>
        {/* Group header */}
        <div className="relative border-b border-border/30" style={{ height: GROUP_H, backgroundColor: '#f8fafc' }}>
          {/* Week lines behind group header */}
          {weeks.map((w) => (
            <div key={w.index} className={cn('absolute top-0 bottom-0 border-l pointer-events-none', w.isCurrentWeek ? 'border-blue-200/60' : 'border-border/20')}
              style={{ left: w.index * WEEK_WIDTH }} />
          ))}
        </div>
        {/* Item rows */}
        {group.items.map((item, rowIdx) => (
          <div
            key={item.data.id}
            className={cn('relative border-b border-border/10 cursor-default', rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}
            style={{ height: ROW_HEIGHT }}
          >
            {/* Week background lines */}
            {weeks.map((w) => (
              <div
                key={w.index}
                className={cn('absolute top-0 bottom-0 border-l pointer-events-none', w.isCurrentWeek ? 'bg-blue-50/30' : '')}
                style={{ left: w.index * WEEK_WIDTH, width: w.isCurrentWeek ? WEEK_WIDTH : 0, borderColor: w.isCurrentWeek ? 'transparent' : 'rgba(0,0,0,0.05)' }}
              />
            ))}
            {/* Vertical separator per week */}
            {weeks.map((w) => (
              <div key={`line-${w.index}`} className="absolute top-0 bottom-0 w-px bg-border/20 pointer-events-none"
                style={{ left: w.index * WEEK_WIDTH }} />
            ))}
            {/* Task bar */}
            {renderBar(item)}
          </div>
        ))}
      </div>
    ))
  }

  // ── Left panel content ──────────────────────────────────────────────────────

  function renderLeftRows() {
    return groups.map((group) => (
      <div key={group.clientId}>
        {/* Group header label */}
        <div
          className="flex items-center gap-2 px-3 border-b border-border/30 shrink-0"
          style={{ height: GROUP_H, backgroundColor: '#f8fafc' }}
        >
          <Icons.Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground truncate">{group.clientName}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/60 shrink-0">{group.items.length}</span>
        </div>
        {/* Item labels */}
        {group.items.map((item, rowIdx) => (
          <div
            key={item.data.id}
            className={cn(
              'flex items-center px-3 border-b border-border/10 cursor-pointer hover:bg-blue-50/40 transition-colors group',
              rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40',
            )}
            style={{ height: ROW_HEIGHT }}
            onClick={() => onCardClick(item)}
          >
            {/* Stage dot */}
            <div className="h-1.5 w-1.5 rounded-full shrink-0 mr-2" style={{ backgroundColor: COL_BY_KEY[getItemStage(item)].barColor }} />
            <span className="text-[11px] text-foreground truncate group-hover:text-blue-600 transition-colors leading-tight">
              {getItemTitle(item)}
            </span>
          </div>
        ))}
      </div>
    ))
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left label panel ── */}
      <div className="shrink-0 flex flex-col border-r border-border bg-background" style={{ width: LABEL_WIDTH }}>
        {/* Header spacer — aligns with right panel's sticky header */}
        <div className="shrink-0 border-b border-border bg-background" style={{ height: HEADER_H }}>
          <div className="flex items-center gap-2 px-3 h-full">
            <Icons.Rows className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground">Deliverable</span>
          </div>
        </div>
        {/* Scrollable rows — synced with right panel via JS scrollTop */}
        <div
          ref={leftRef}
          className="flex-1"
          style={{ overflow: 'hidden', minHeight: 0 }}
        >
          <div style={{ minHeight: totalContentHeight }}>
            {renderLeftRows()}
          </div>
        </div>
      </div>

      {/* ── Right time grid ── */}
      <div
        ref={rightRef}
        className="flex-1 overflow-auto"
        onScroll={onScroll}
      >
        <div style={{ width: totalWidth, minHeight: totalContentHeight + HEADER_H }}>
          {/* Sticky header */}
          <div className="sticky top-0 z-20 bg-background border-b border-border" style={{ height: HEADER_H }}>
            {/* Month row */}
            <div className="flex border-b border-border/40" style={{ height: 26 }}>
              {months.map((m) => (
                <div
                  key={m.weekIndex}
                  className="flex items-center px-3 text-[10px] font-semibold text-muted-foreground border-r border-border/30 shrink-0"
                  style={{ width: m.span * WEEK_WIDTH }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            {/* Week row */}
            <div className="flex" style={{ height: 32 }}>
              {weeks.map((w) => (
                <div
                  key={w.index}
                  className={cn(
                    'flex items-center justify-center text-[10px] font-medium border-r border-border/30 shrink-0',
                    w.isCurrentWeek ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-muted-foreground',
                  )}
                  style={{ width: WEEK_WIDTH }}
                >
                  {w.label}
                </div>
              ))}
            </div>
          </div>

          {/* Content area */}
          <div className="relative" style={{ minHeight: totalContentHeight }}>
            {/* Today line */}
            <div
              className="absolute top-0 bottom-0 z-10 pointer-events-none"
              style={{ left: todayX, width: 2 }}
            >
              <div className="w-full h-full bg-red-400 opacity-70" />
              <div className="absolute -top-0 -translate-x-1/2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-b whitespace-nowrap shadow-sm">
                Today
              </div>
            </div>

            {/* Rows */}
            {renderRows()}
          </div>
        </div>
      </div>
    </div>
  )
}
