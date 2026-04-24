import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { QualityPage } from './QualityPage'
import { ReportsPage } from './ReportsPage'

type Tab = 'quality' | 'reports'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'quality',  label: 'Quality',  icon: Icons.TrendingUp },
  { id: 'reports',  label: 'Reports',  icon: Icons.PieChart },
]

export function QualityAndReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('quality')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-medium transition-colors',
              activeTab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className={cn('h-full', activeTab !== 'quality' && 'hidden')}>
          <QualityPage />
        </div>
        <div className={cn('h-full', activeTab !== 'reports' && 'hidden')}>
          <ReportsPage />
        </div>
      </div>
    </div>
  )
}
