/**
 * Template A — StandardPageLayout
 *
 * Use for: any page that is a full-height flex column with a fixed top header
 * and a single scrollable content area below it.
 *
 * Examples: Clients, Calendar, Usage, Team, Access, Settings, Deliverables,
 *           Workflows, Humanizer, researchNODE
 *
 * Structure:
 *   <div flex flex-col h-full bg-background>
 *     <header h-14 shrink-0 border-b bg-background px-6>   ← fixed, never scrolls
 *     <main flex-1 overflow-y-auto p-6>                     ← scrolls
 *
 * Props:
 *   icon          — lucide icon shown left of title
 *   title         — page heading (required)
 *   subtitle      — small grey line under title (optional)
 *   headerActions — React node rendered on the right side of the header (optional)
 *   noPadding     — skip the default p-6 on the content area (use when you need
 *                   full-bleed content like a table that manages its own spacing)
 *   children      — the page body
 */

import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

interface StandardPageLayoutProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  headerActions?: React.ReactNode
  noPadding?: boolean
  children: React.ReactNode
  className?: string
}

export function StandardPageLayout({
  icon: Icon,
  title,
  subtitle,
  headerActions,
  noPadding = false,
  children,
  className,
}: StandardPageLayoutProps) {
  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{title}</h1>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {headerActions && (
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {headerActions}
          </div>
        )}
      </header>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <main className={cn('flex-1 overflow-y-auto', !noPadding && 'p-6')}>
        {children}
      </main>
    </div>
  )
}
