import { NavLink } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/workflows', icon: Icons.Workflow, label: 'Workflows' },
  { to: '/clients',   icon: Icons.Users,    label: 'Clients'   },
  { to: '/usage',     icon: Icons.BarChart2, label: 'Usage'    },
]

export function AppNav() {
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {/* Logo */}
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
        <Icons.Workflow className="h-4 w-4 text-white" />
      </div>

      <div className="my-1 h-px w-8 bg-border" />

      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) =>
            cn(
              'flex h-10 w-10 items-center justify-center rounded-md transition-colors',
              isActive
                ? 'bg-blue-600 text-white'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          <Icon className="h-4.5 w-4.5" />
        </NavLink>
      ))}
    </aside>
  )
}
