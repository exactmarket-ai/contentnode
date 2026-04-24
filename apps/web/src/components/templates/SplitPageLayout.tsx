/**
 * Template C — SplitPageLayout
 *
 * Use for: pages that need a persistent side panel alongside the main content.
 * Both panes scroll independently.
 *
 * Examples: My Work (main list + right detail panel),
 *           Review page (editor + sidebar),
 *           any detail page with a contextual action panel
 *
 * Structure:
 *   <div flex flex-col h-full overflow-hidden>
 *     <header h-14 shrink-0 border-b bg-background px-6>
 *     <div flex flex-1 overflow-hidden>
 *       <main flex-1 overflow-y-auto p-6>               ← left / main
 *       <aside w-80 shrink-0 border-l overflow-y-auto>  ← right sidebar
 *                                                          (or left if sidebarSide="left")
 *
 * Props:
 *   icon          — lucide icon in header
 *   title         — page heading
 *   headerActions — right side of header
 *   sidebar       — content for the side panel
 *   sidebarWidth  — Tailwind width class, default "w-80" (320px)
 *   sidebarSide   — "right" (default) or "left"
 *   sidebarPadding — padding on the sidebar, default "p-4"
 *   noPadding     — skip p-6 on main content area
 *   children      — main content
 */

import { cn } from '@/lib/utils'

interface SplitPageLayoutProps {
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  headerActions?: React.ReactNode
  sidebar: React.ReactNode
  sidebarWidth?: string
  sidebarSide?: 'left' | 'right'
  sidebarPadding?: string
  noPadding?: boolean
  children: React.ReactNode
  className?: string
}

export function SplitPageLayout({
  icon: Icon,
  title,
  headerActions,
  sidebar,
  sidebarWidth = 'w-80',
  sidebarSide = 'right',
  sidebarPadding = 'p-4',
  noPadding = false,
  children,
  className,
}: SplitPageLayoutProps) {
  const sidebarEl = (
    <aside className={cn(
      sidebarWidth,
      'shrink-0 border-border overflow-y-auto bg-background',
      sidebarSide === 'right' ? 'border-l' : 'border-r',
      sidebarPadding,
    )}>
      {sidebar}
    </aside>
  )

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {(title || headerActions) && (
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

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {sidebarSide === 'left' && sidebarEl}

        <main className={cn('flex-1 overflow-y-auto', !noPadding && 'p-6')}>
          {children}
        </main>

        {sidebarSide === 'right' && sidebarEl}
      </div>
    </div>
  )
}
