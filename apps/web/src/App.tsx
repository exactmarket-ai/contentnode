import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import { ClerkProvider, SignIn, SignedIn, useAuth, useClerk } from '@clerk/clerk-react'
import { apiFetch } from '@/lib/api'
import { useSettingsStore } from '@/store/settingsStore'
import { AppNav } from '@/components/layout/AppNav'
import { WorkflowEditor } from '@/pages/WorkflowEditor'
import { WorkflowListPage } from '@/pages/WorkflowListPage'
import { QualityAndReportsPage } from '@/pages/QualityAndReportsPage'
import { ClientListPage } from '@/pages/ClientListPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { UsagePage } from '@/pages/UsagePage'
import { HumanizerDashboard } from '@/pages/HumanizerDashboard'
import { ResearchNodePage } from '@/pages/ResearchNodePage'
import { ReviewsAndRunsPage } from '@/pages/ReviewsAndRunsPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { TeamPage } from '@/pages/TeamPage'
import { InvitePage } from '@/pages/InvitePage'
import { AccessPage } from '@/pages/AccessPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UserProfilePage } from '@/pages/UserProfilePage'
import { AcceptInvitePage } from '@/pages/AcceptInvitePage'
import { LandingPage } from '@/pages/LandingPage'
import { PortalPage } from '@/pages/portal/PortalPage'
import { PortalReviewPage } from '@/pages/portal/PortalReviewPage'
import { WriterPortalPage } from '@/pages/writer/WriterPortalPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// ── Shell layout (uses Outlet for data-router child rendering) ────────────────
function AppShell({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppNav onSignOut={onSignOut} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

// ── Standalone sign-in page (public) ─────────────────────────────────────────
function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4" style={{ backgroundColor: '#fafaf8' }}>
      <img src="/logo.png" alt="ContentNode AI" className="h-12 w-auto object-contain" />
      <SignIn routing="hash" afterSignInUrl="/reviews" afterSignUpUrl="/reviews" />
      <a
        href="/"
        className="text-xs transition-colors"
        style={{ color: '#b4b2a9' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#5c5b52')}
        onMouseLeave={e => (e.currentTarget.style.color = '#b4b2a9')}
      >
        ← Back to home
      </a>
    </div>
  )
}

// ── Auth-protected layout (only used when Clerk is configured) ────────────────
function ProtectedLayout() {
  const { isLoaded, isSignedIn } = useAuth()
  const { signOut } = useClerk()
  const setOllamaModels = useSettingsStore((s) => s.setOllamaModels)
  const setLocalMediaServices = useSettingsStore((s) => s.setLocalMediaServices)

  useEffect(() => {
    if (!isSignedIn) return
    apiFetch('/api/v1/team/me')
      .then((r) => r.json())
      .then(({ data }) => {
        if (Array.isArray(data?.ollamaModels)) setOllamaModels(data.ollamaModels)
        if (Array.isArray(data?.localMediaServices)) setLocalMediaServices(data.localMediaServices)
      })
      .catch(() => {/* profile load failure is non-fatal */})
  }, [isSignedIn, setOllamaModels, setLocalMediaServices])

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
      </div>
    )
  }

  if (!isSignedIn) {
    return <SignInPage />
  }

  return (
    <SignedIn>
      <AppShell onSignOut={() => signOut()} />
    </SignedIn>
  )
}

// ── App routes (protected content) ───────────────────────────────────────────
const protectedChildren = [
  { index: true, element: <Navigate to="/reviews" replace /> },
  { path: 'workflows', element: <WorkflowListPage /> },
  { path: 'reviews', element: <ReviewsAndRunsPage /> },
  { path: 'runs', element: <Navigate to="/reviews" replace /> },
  { path: 'workflows/new', element: <WorkflowEditor /> },
  { path: 'workflows/:workflowId', element: <WorkflowEditor /> },
  { path: 'clients', element: <ClientListPage /> },
  { path: 'clients/:id', element: <ClientDetailPage /> },
  { path: 'calendar', element: <CalendarPage /> },
  { path: 'quality', element: <QualityAndReportsPage /> },
  { path: 'reports', element: <Navigate to="/quality" replace /> },
  { path: 'usage', element: <UsagePage /> },
  { path: 'humanizer', element: <HumanizerDashboard /> },
  { path: 'research',  element: <ResearchNodePage /> },
  { path: 'team', element: <TeamPage /> },
  { path: 'team/invite', element: <InvitePage /> },
  { path: 'access', element: <AccessPage /> },
  { path: 'settings', element: <SettingsPage /> },
  { path: 'profile', element: <UserProfilePage /> },
  { path: 'review/:runId', element: <ReviewPage /> },
]

// ── Router ────────────────────────────────────────────────────────────────────
// Uses createBrowserRouter (data router) so that useBlocker works in WorkflowEditor.
const router = createBrowserRouter([
  // Always-public routes — no auth required, no shell
  { path: '/writer', element: <WriterPortalPage /> },
  { path: '/portal', element: <PortalPage /> },
  { path: '/portal/review/:runId', element: <PortalReviewPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },

  // Landing + sign-in (public, only when Clerk is configured)
  ...(PUBLISHABLE_KEY
    ? [
        { path: '/', element: <LandingPage /> },
        { path: '/sign-in', element: <SignInPage /> },
      ]
    : []),

  // App shell — auth-gated when Clerk is configured, open in dev
  {
    element: PUBLISHABLE_KEY ? <ProtectedLayout /> : <AppShell />,
    children: protectedChildren,
  },
])

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  if (PUBLISHABLE_KEY) {
    return (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <RouterProvider router={router} />
      </ClerkProvider>
    )
  }
  return <RouterProvider router={router} />
}
