/**
 * Template B — TabbedPageLayout
 *
 * Use for: pages that have a top-level tab switcher below a header bar.
 * Each tab owns its own content and scroll behaviour.
 *
 * Examples: Reviews & Runs, Quality & Reports, Client Detail
 *
 * Structure:
 *   <div flex flex-col h-full bg-background>
 *     <header h-14 shrink-0 border-b bg-background px-6>   ← fixed (skip with noHeader)
 *     <div flex shrink-0 border-b bg-background px-4>       ← tab bar, never scrolls
 *       <button ...> tab </button>
 *     <div flex-1 overflow-hidden>                          ← each child manages its scroll
 *
 * Props:
 *   icon          — lucide icon shown left of title in header
 *   title         — page heading
 *   noHeader      — omit the h-14 header (tab bar becomes the top element)
 *   headerActions — right side of header
 *   tabs          — array of { id, label, icon? }
 *   activeTab     — currently selected tab id (controlled)
 *   onTabChange   — called when a tab is clicked
 *   children      — rendered below the tab bar; your component decides what to
 *                   show based on activeTab
 *
 * Tab active style:  border-b-2 border-blue-600 text-blue-600
 * Tab inactive style: border-b-2 border-transparent text-muted-foreground hover:text-foreground
 */

import { cn } from '@/lib/utils'

export interface TabDefinition {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  badge?: string | number
}

interface TabbedPageLayoutProps {
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  noHeader?: boolean
  headerActions?: React.ReactNode
  tabs: TabDefinition[]
  activeTab: string
  onTabChange: (id: string) => void
  children: React.ReactNode
  className?: string
}

export function TabbedPageLayout({
  icon: Icon,
  title,
  noHeader = false,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
}: TabbedPageLayoutProps) {
  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>

      {/* ── Header (optional) ──────────────────────────────────────────────── */}
      {!noHeader && (title || headerActions) && (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            {title && <h1 className="text-sm font-semibold truncate">{title}</h1>}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {headerActions}
            </div>
          )}
        </header>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-4">
        {tabs.map(({ id, label, icon: TabIcon, badge }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-medium transition-colors',
              activeTab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TabIcon && <TabIcon className="h-3.5 w-3.5" />}
            {label}
            {badge !== undefined && (
              <span className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-semibold leading-none',
                activeTab === id
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-muted text-muted-foreground',
              )}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
