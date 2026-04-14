import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { ReviewsDashboard } from './ReviewsDashboard'
import { RunsDashboard } from './RunsDashboard'

type Tab = 'reviews' | 'runs'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'reviews', label: 'Reviews',  icon: Icons.ClipboardEdit },
  { id: 'runs',    label: 'Runs',     icon: Icons.Play },
]

export function ReviewsAndRunsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('runs')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-4">
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

      {/* Content — each dashboard fills the remaining height */}
      <div className="flex-1 overflow-hidden">
        <div className={cn('h-full', activeTab !== 'reviews' && 'hidden')}>
          <ReviewsDashboard />
        </div>
        <div className={cn('h-full', activeTab !== 'runs' && 'hidden')}>
          <RunsDashboard />
        </div>
      </div>
    </div>
  )
}
