import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useWorkflowStore } from '@/store/workflowStore'

const ACTIVE = { activeBg: '#f0f6fd', activeText: '#185fa5', activeBorder: '#b8d8f5' }

const NAV_ITEMS = [
  { to: '/workflows', icon: Icons.Workflow,     label: 'Workflows',   ...ACTIVE },
  { to: '/clients',   icon: Icons.Users,        label: 'Clients',     ...ACTIVE },
  { to: '/runs',      icon: Icons.Play,         label: 'Runs',        ...ACTIVE },
  { to: '/calendar',  icon: Icons.CalendarDays, label: 'Calendar',    ...ACTIVE },
  { to: '/reports',   icon: Icons.PieChart,     label: 'Reports',     ...ACTIVE },
  { to: '/quality',   icon: Icons.TrendingUp,   label: 'Quality',     ...ACTIVE },
  { to: '/usage',     icon: Icons.BarChart2,    label: 'Usage',       ...ACTIVE },
  { to: '/humanizer', icon: Icons.BrainCircuit, label: 'cnHumanizer', ...ACTIVE },
]

const BOTTOM_NAV_ITEMS = [
  { to: '/access',   icon: Icons.ShieldCheck, label: 'Access',   ...ACTIVE },
  { to: '/team',     icon: Icons.UserCog,     label: 'Team',     ...ACTIVE },
  { to: '/settings', icon: Icons.Settings2,   label: 'Settings', ...ACTIVE },
]

interface AppNavProps {
  onSignOut?: () => void
}

// Custom nav link that fully owns click handling so we can intercept
// navigation when the workflow editor has unsaved changes.
function NavItem({
  to,
  collapsed,
  icon: Icon,
  label,
  activeBg,
  activeText,
  activeBorder,
}: {
  to: string
  collapsed: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  activeBg?: string
  activeText?: string
  activeBorder?: string
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const setPendingNavAction = useWorkflowStore((s) => s.setPendingNavAction)
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/')

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    const onEditor = /^\/workflows\/(new|[^/]+)/.test(location.pathname)
    if (onEditor) {
      const { workflow: wf, nodes: n, graphDirty: dirty } = useWorkflowStore.getState()
      const hasChanges = wf.id ? dirty : n.length > 0
      if (hasChanges) {
        setPendingNavAction(() => navigate(to))
        return
      }
    }
    navigate(to)
  }

  return (
    <a
      href={to}
      onClick={handleClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md px-2 py-2 text-sm transition-colors',
        collapsed ? 'justify-center gap-0' : 'gap-3',
        !isActive && 'text-muted-foreground hover:bg-accent hover:text-foreground',
        isActive && !activeBg && 'bg-blue-600 text-white',
      )}
      style={isActive && activeBg ? { backgroundColor: activeBg, color: activeText, border: `1px solid ${activeBorder}` } : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </a>
  )
}

export function AppNav({ onSignOut }: AppNavProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { isAdmin, isOwner } = useCurrentUser()
  const location = useLocation()
  const setPendingNavAction = useWorkflowStore((s) => s.setPendingNavAction)

  function handleSignOut() {
    if (!onSignOut) return
    const onEditor = /^\/workflows\/(new|[^/]+)/.test(location.pathname)
    if (onEditor) {
      const { workflow: wf, nodes: n, graphDirty: dirty } = useWorkflowStore.getState()
      const hasChanges = wf.id ? dirty : n.length > 0
      if (hasChanges) {
        setPendingNavAction(onSignOut)
        return
      }
    }
    onSignOut()
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col gap-1 border-r border-border bg-card py-3 px-2 transition-all duration-200',
        collapsed ? 'w-14' : 'w-48',
      )}
    >
      {/* Logo */}
      {collapsed ? (
        <div className="mb-2 flex flex-col items-center gap-1">
          <img src="/logo-icon.png" alt="ContentNode AI" className="h-8 w-auto object-contain" />
          <button
            onClick={() => setCollapsed(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Expand sidebar"
          >
            <Icons.PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mb-2 flex flex-col items-center gap-1 px-1">
          <img src="/logo-full.png" alt="ContentNode AI" className="w-full max-w-[152px] h-auto object-contain" />
          <div className="flex w-full justify-end">
            <button
              onClick={() => setCollapsed(true)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="Collapse sidebar"
            >
              <Icons.PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="my-1 h-px w-full bg-border" />

      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} {...item} collapsed={collapsed} />
      ))}

      <div className="mt-auto pt-2">
        <div className="my-1 h-px w-full bg-border" />
        {BOTTOM_NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
        {/* Invite — admin/owner only */}
        {(isAdmin || isOwner) && (
          <NavItem
            to="/team/invite"
            collapsed={collapsed}
            icon={Icons.UserPlus}
            label="Invite"
            activeBg="#fdf5ff"
            activeText="#a200ee"
            activeBorder="#e9c8ff"
          />
        )}
        {onSignOut && <button
          onClick={handleSignOut}
          title={collapsed ? 'Sign out' : undefined}
          className={cn(
            'flex w-full items-center rounded-md px-2 py-2 text-sm transition-colors text-muted-foreground hover:bg-accent hover:text-foreground',
            collapsed ? 'justify-center gap-0' : 'gap-3',
          )}
        >
          <Icons.LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>}
      </div>
    </aside>
  )
}
