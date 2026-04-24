// Overview dashboard: stage distribution, client breakdown, team workload, and summary stats.
import { useMemo } from 'react'
import * as Icons from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  type CardItem, type Member,
  COLUMNS, getItemClient, getItemClientId, getItemStage,
  isItemOverdue, getItemDueDate, getItemCreatedAt,
} from './types'

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string
  value: number | string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 flex items-start gap-3">
      <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const CHART_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#a855f7', '#94a3b8']

export function DashboardView({
  items,
  members,
  onCardClick,
}: {
  items: CardItem[]
  members: Member[]
  onCardClick: (item: CardItem) => void
}) {
  const stats = useMemo(() => {
    const now   = Date.now()
    const week  = 7 * 86400000

    const overdue      = items.filter(isItemOverdue)
    const dueThisWeek  = items.filter((i) => {
      const d = getItemDueDate(i)
      if (!d) return false
      const ms = new Date(d).getTime()
      return ms >= now && ms <= now + week
    })
    const liveRuns = items.filter(
      (i) => i._type === 'run' && ['queued', 'running', 'waiting_feedback', 'awaiting_assignment'].includes(i.data.status),
    )
    const closedThisWeek = items.filter((i) => {
      if (i._type !== 'run' || i.data.reviewStatus !== 'closed') return false
      if (!i.data.completedAt) return false
      return Date.now() - new Date(i.data.completedAt).getTime() < week
    })

    return { total: items.length, overdue: overdue.length, dueThisWeek: dueThisWeek.length, live: liveRuns.length, closedWeek: closedThisWeek.length }
  }, [items])

  const stageData = useMemo(() =>
    COLUMNS.map((col) => ({
      name: col.label,
      shortName: col.label.replace('for Client', 'Client').replace('Responded', 'Resp.'),
      count: items.filter((i) => getItemStage(i) === col.key).length,
      color: col.barColor,
    })).filter((d) => d.count > 0),
  [items])

  const clientData = useMemo(() => {
    const map = new Map<string, { name: string; count: number; overdue: number }>()
    for (const item of items) {
      const id   = getItemClientId(item)
      const name = getItemClient(item)
      if (!map.has(id)) map.set(id, { name, count: 0, overdue: 0 })
      const entry = map.get(id)!
      entry.count++
      if (isItemOverdue(item)) entry.overdue++
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [items])

  const workloadData = useMemo(() => {
    const map = new Map<string, { name: string; count: number; overdue: number }>()
    const unassigned = { name: 'Unassigned', count: 0, overdue: 0 }
    for (const item of items) {
      const assigneeId = item._type === 'run' ? item.data.assigneeId : item.data.assigneeId
      if (!assigneeId) { unassigned.count++; if (isItemOverdue(item)) unassigned.overdue++; continue }
      if (!map.has(assigneeId)) {
        const m = members.find((m) => m.id === assigneeId)
        map.set(assigneeId, { name: m?.name ?? m?.email ?? 'Unknown', count: 0, overdue: 0 })
      }
      const entry = map.get(assigneeId)!
      entry.count++
      if (isItemOverdue(item)) entry.overdue++
    }
    const result = Array.from(map.values()).sort((a, b) => b.count - a.count)
    if (unassigned.count > 0) result.push(unassigned)
    return result
  }, [items, members])

  // Recent activity: last 10 items by createdAt
  const recentItems = useMemo(
    () => [...items].sort((a, b) => new Date(getItemCreatedAt(b)).getTime() - new Date(getItemCreatedAt(a)).getTime()).slice(0, 8),
    [items],
  )

  // Completion trend: last 14 days
  const trendData = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (13 - i))
      d.setHours(0, 0, 0, 0)
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)
      const created = items.filter((item) => {
        const t = new Date(getItemCreatedAt(item)).getTime()
        return t >= d.getTime() && t <= dayEnd.getTime()
      }).length
      const closed = items.filter((item) => {
        if (item._type !== 'run' || !item.data.completedAt) return false
        const t = new Date(item.data.completedAt).getTime()
        return t >= d.getTime() && t <= dayEnd.getTime()
      }).length
      return {
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        created,
        closed,
      }
    })
  }, [items])

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-3 text-muted-foreground">
        <Icons.BarChart2 className="h-10 w-10 opacity-20" />
        <p className="text-sm">No data to display</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total items"    value={stats.total}      icon={Icons.LayoutGrid}   color="bg-blue-50 text-blue-600" />
          <StatCard label="Overdue"        value={stats.overdue}    icon={Icons.AlertTriangle} color="bg-red-50 text-red-600"   sub={stats.overdue > 0 ? 'needs attention' : 'all on track'} />
          <StatCard label="Due this week"  value={stats.dueThisWeek}icon={Icons.CalendarClock} color="bg-amber-50 text-amber-600" />
          <StatCard label="Live now"       value={stats.live}       icon={Icons.Zap}           color="bg-emerald-50 text-emerald-600" sub={`${stats.closedWeek} closed this week`} />
        </div>

        {/* ── Two-column charts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Stage distribution */}
          <div className="rounded-xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold mb-4">Stage Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stageData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="shortName" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)' }}
                  formatter={(v) => [v as number, 'Items']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {stageData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 14-day activity */}
          <div className="rounded-xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold mb-1">14-Day Activity</h3>
            <p className="text-[10px] text-muted-foreground mb-4">Items created vs closed per day</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="created" name="Created" fill="#93c5fd" radius={[2, 2, 0, 0]} maxBarSize={14} />
                <Bar dataKey="closed"  name="Closed"  fill="#6ee7b7" radius={[2, 2, 0, 0]} maxBarSize={14} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Bottom row: clients + workload + recent ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Client breakdown */}
          <div className="rounded-xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold mb-4">By Client</h3>
            <div className="space-y-2">
              {clientData.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-[11px] text-muted-foreground truncate flex-1">{c.name}</span>
                  <div className="flex items-center gap-1.5">
                    {c.overdue > 0 && (
                      <span className="text-[9px] font-semibold text-red-500">{c.overdue} late</span>
                    )}
                    <span className="text-[11px] font-semibold text-foreground w-6 text-right">{c.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team workload */}
          <div className="rounded-xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold mb-4">Team Workload</h3>
            <div className="space-y-2.5">
              {workloadData.map((w) => {
                const pct = Math.round((w.count / stats.total) * 100)
                return (
                  <div key={w.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-foreground font-medium truncate flex-1 mr-2">{w.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{w.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-400 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recent items */}
          <div className="rounded-xl border border-border bg-white p-5">
            <h3 className="text-sm font-semibold mb-4">Recently Added</h3>
            <div className="space-y-1">
              {recentItems.map((item) => {
                const col = COLUMNS.find((c) => c.key === getItemStage(item))
                return (
                  <button
                    key={item.data.id}
                    onClick={() => onCardClick(item)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/30 transition-colors text-left group"
                  >
                    <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: col?.barColor ?? '#94a3b8' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate group-hover:text-blue-600 transition-colors">
                        {item._type === 'run' ? item.data.itemName || item.data.workflow?.name || 'Untitled' : `GTM — ${item.data.vertical.name}`}
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate">{getItemClient(item)}</p>
                    </div>
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {new Date(getItemCreatedAt(item)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
