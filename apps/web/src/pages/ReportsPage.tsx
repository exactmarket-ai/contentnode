import * as Icons from 'lucide-react'
import { ReportsDashboard } from './ReportsDashboard'

export function ReportsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-2">
          <Icons.BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Reports</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <ReportsDashboard showFilters={true} />
      </div>
    </div>
  )
}
