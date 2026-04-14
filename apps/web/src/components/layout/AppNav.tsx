import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useWorkflowStore } from '@/store/workflowStore'

function UserAvatar({ avatarUrl, name, email, size = 'sm' }: { avatarUrl: string | null; name: string | null; email: string; size?: 'sm' | 'md' }) {
  const dims = size === 'md' ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs'
  const initials = (() => {
    if (name) {
      const parts = name.trim().split(/\s+/).filter(Boolean)
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      if (parts[0]?.length) return parts[0].slice(0, 2).toUpperCase()
    }
    return email.slice(0, 2).toUpperCase()
  })()
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? email} className={cn(dims, 'rounded-full object-cover border border-border shrink-0')} />
  }
  return (
    <div className={cn(dims, 'rounded-full flex items-center justify-center font-semibold shrink-0 bg-primary/10 text-primary border border-primary/20')}>
      {initials}
    </div>
  )
}

const ACTIVE = { activeBg: '#f0f6fd', activeText: '#185fa5', activeBorder: '#b8d8f5' }

const NAV_ITEMS = [
  { to: '/workflows', icon: Icons.Workflow,      label: 'Workflows',   ...ACTIVE },
  { to: '/clients',   icon: Icons.Users,         label: 'Clients',     ...ACTIVE },
  { to: '/reviews',   icon: Icons.ClipboardEdit, label: 'Reviews & Runs', ...ACTIVE },
  { to: '/calendar',  icon: Icons.CalendarDays, label: 'Calendar',    ...ACTIVE },
  { to: '/quality',   icon: Icons.TrendingUp,   label: 'Quality & Reports', ...ACTIVE },
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
  const { user, isAdmin, isOwner } = useCurrentUser()
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
        'relative flex shrink-0 flex-col gap-1 border-r border-border bg-card py-3 px-2 transition-all duration-200',
        collapsed ? 'w-14' : 'w-48',
      )}
    >
      {/* Right-edge collapse/expand handle — same pattern as Node Config panel */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute right-0 top-1/2 z-10 -translate-y-1/2 flex h-12 w-3 items-center justify-center rounded-l-sm border border-r-0 border-border bg-card hover:bg-muted transition-colors"
      >
        {collapsed
          ? <Icons.ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
          : <Icons.ChevronLeft  className="h-2.5 w-2.5 text-muted-foreground" />}
      </button>

      {/* Logo */}
      {collapsed ? (
        <div className="mb-2 flex items-center justify-center">
          <img src="/logo-icon.png" alt="ContentNode AI" className="h-8 w-auto object-contain" />
        </div>
      ) : (
        <div className="mb-2 px-1">
          <img src="/logo-full.png" alt="ContentNode AI" className="w-full max-w-[152px] h-auto object-contain" />
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

        {/* User identity — links to /profile */}
        {user && (
          <div className="mt-1 pt-2 border-t border-border">
            <Link
              to="/profile"
              title={collapsed ? (user.name ?? user.email) : undefined}
              className={cn(
                'flex items-center rounded-md px-2 py-1.5 transition-colors hover:bg-accent',
                collapsed ? 'justify-center' : 'gap-2.5',
              )}
            >
              <UserAvatar avatarUrl={user.avatarUrl} name={user.name} email={user.email} />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{user.name ?? user.email}</p>
                  {user.title && <p className="text-[10px] text-muted-foreground truncate">{user.title}</p>}
                  {!user.title && <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>}
                </div>
              )}
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
