import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

// ── NotificationBell ──────────────────────────────────────────────────────────

interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  resourceId: string | null
  resourceType: string | null
  clientId: string | null
  read: boolean
  createdAt: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [open, setOpen]                   = useState(false)
  const [coords, setCoords]               = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(() => {
    apiFetch('/api/v1/notifications')
      .then((r) => r.json())
      .then(({ data, unreadCount: count }) => {
        setNotifications(data ?? [])
        setUnreadCount(count ?? 0)
      })
      .catch(() => {})
  }, [])

  // Poll every 30s + on window focus
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    window.addEventListener('focus', fetchNotifications)
    return () => { clearInterval(interval); window.removeEventListener('focus', fetchNotifications) }
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const openBell = () => {
    if (open) { setOpen(false); return }
    const rect = btnRef.current!.getBoundingClientRect()
    const vh = window.innerHeight
    const POPUP_WIDTH = 320  // w-80
    const GAP = 8
    const PADDING = 16
    const left = Math.min(rect.right + GAP, vh - POPUP_WIDTH - PADDING)
    // Open upward if less than 40% of viewport remains below the button
    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top
    if (spaceBelow < vh * 0.4 && spaceAbove > spaceBelow) {
      setCoords({ bottom: vh - rect.top, left, maxHeight: Math.max(200, spaceAbove - PADDING) })
    } else {
      setCoords({ top: rect.top, left, maxHeight: Math.max(200, spaceBelow - PADDING) })
    }
    setOpen(true)
  }

  const markRead = async (n: AppNotification) => {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))
      setUnreadCount((c) => Math.max(0, c - 1))
      await apiFetch(`/api/v1/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {})
    }
    setOpen(false)
    if (n.clientId) navigate(`/clients/${n.clientId}?tab=board`)
  }

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })))
    setUnreadCount(0)
    await apiFetch('/api/v1/notifications/read-all', { method: 'POST' }).catch(() => {})
  }

  const dropdown = open && coords
    ? createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: coords.top, bottom: coords.bottom, left: coords.left, zIndex: 9999 }}
          className="w-80 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-[13px] font-semibold text-gray-800">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-blue-600 hover:text-blue-700 font-medium">
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto divide-y divide-gray-50" style={{ maxHeight: coords.maxHeight - 56 }}>
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Icons.BellOff className="h-6 w-6 text-gray-300" />
                <p className="text-[12px] text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50',
                    !n.read && 'bg-blue-50/60',
                  )}
                >
                  <div className={cn(
                    'mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                    n.type === 'assignment' ? 'bg-violet-100' : 'bg-gray-100',
                  )}>
                    {n.type === 'assignment'
                      ? <Icons.UserCheck className="h-4 w-4 text-violet-600" />
                      : <Icons.Bell className="h-4 w-4 text-gray-500" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-[12px] leading-snug', n.read ? 'text-gray-600' : 'text-gray-900 font-medium')}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{n.body}</p>}
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={btnRef}
        onClick={openBell}
        title={collapsed ? `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}` : undefined}
        className={cn(
          'relative flex w-full items-center rounded-md px-2 py-2 text-sm transition-colors text-muted-foreground hover:bg-accent hover:text-foreground',
          collapsed ? 'justify-center' : 'gap-3',
          open && 'bg-accent text-foreground',
        )}
      >
        <div className="relative shrink-0">
          <Icons.Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        {!collapsed && <span>Notifications</span>}
      </button>
      {dropdown}
    </>
  )
}

// ── UserAvatar ────────────────────────────────────────────────────────────────

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
  { to: '/workflows', icon: Icons.Workflow, label: 'Workflows', ...ACTIVE },
  { to: '/clients',   icon: Icons.Users,    label: 'Clients',   ...ACTIVE },
]

const BOTTOM_NAV_ITEMS = [
  { to: '/access',   icon: Icons.ShieldCheck, label: 'Access',   ...ACTIVE, adminOnly: true },
  { to: '/team',     icon: Icons.UserCog,     label: 'Team',     ...ACTIVE, adminOnly: true },
  { to: '/settings', icon: Icons.Settings2,   label: 'Settings', ...ACTIVE, adminOnly: true },
  { to: '/theme',    icon: Icons.Palette,     label: 'Theme',    activeBg: '#fdf5ff', activeText: '#a200ee', activeBorder: '#e9c8ff', ownerOnly: true },
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
  const { user, isAdmin, isOwner, isLead } = useCurrentUser()

  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', collapsed ? '56px' : '192px')
  }, [collapsed])
  const role = user?.role ?? ''
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
        'relative flex shrink-0 flex-col gap-1 border-r border-border bg-background py-3 px-2 transition-all duration-200',
        collapsed ? 'w-14' : 'w-48',
      )}
    >
      {/* Right-edge collapse/expand handle — same pattern as Node Config panel */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute right-0 top-[30%] z-10 flex h-12 w-3 items-center justify-center rounded-l-sm border border-r-0 border-border bg-background hover:bg-muted transition-colors"
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

      {/* My Work — Manager and above, plus Client Manager */}
      {(isLead || role === 'client_manager') && (
        <NavItem to="/my-work" collapsed={collapsed} icon={Icons.House} label="My Work" {...ACTIVE} />
      )}

      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} {...item} collapsed={collapsed} />
      ))}

      {/* researchNODE — Lead, Manager, Admin, Strategist */}
      {(isLead || role === 'strategist') && (
        <NavItem
          to="/research"
          collapsed={collapsed}
          icon={Icons.Telescope}
          label="researchNODE"
          activeBg="#f5f0ff"
          activeText="#7c3aed"
          activeBorder="#ddd6fe"
        />
      )}

      <div className="mt-auto pt-2">
        <div className="my-1 h-px w-full bg-border" />

        {/* Client Dashboard — Admin only */}
        {isAdmin && (
          <>
            <NavItem
              to="/client-dashboard"
              collapsed={collapsed}
              icon={Icons.LayoutDashboard}
              label="Client Dashboard"
              {...ACTIVE}
            />
            {!collapsed && (
              <div className="pl-4">
                <NavItem to="/pipeline"    collapsed={collapsed} icon={Icons.Kanban}          label="Pipeline"         {...ACTIVE} />
                <NavItem to="/deliverables" collapsed={collapsed} icon={Icons.TableProperties} label="Deliverables"     {...ACTIVE} />
                <NavItem to="/reviews"     collapsed={collapsed} icon={Icons.ClipboardEdit}   label="Reviews & Runs"   {...ACTIVE} />
                <NavItem to="/quality"     collapsed={collapsed} icon={Icons.TrendingUp}      label="Quality & Reports" {...ACTIVE} />
                <NavItem to="/usage"       collapsed={collapsed} icon={Icons.BarChart2}       label="Usage"            {...ACTIVE} />
                <NavItem to="/calendar"    collapsed={collapsed} icon={Icons.CalendarDays}    label="Calendar"         {...ACTIVE} />
                <NavItem to="/humanizer"   collapsed={collapsed} icon={Icons.BrainCircuit}    label="cnHumanizer"      {...ACTIVE} />
              </div>
            )}
          </>
        )}
        {BOTTOM_NAV_ITEMS.filter((item) => (!('ownerOnly' in item) || isOwner) && (!('adminOnly' in item) || isAdmin)).map((item) => (
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
        <NotificationBell collapsed={collapsed} />

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
