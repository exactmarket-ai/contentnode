import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import { ClerkProvider, SignIn, SignedIn, useAuth, useClerk } from '@clerk/clerk-react'
import { AppNav } from '@/components/layout/AppNav'
import { WorkflowEditor } from '@/pages/WorkflowEditor'
import { WorkflowListPage } from '@/pages/WorkflowListPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { ClientListPage } from '@/pages/ClientListPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { UsagePage } from '@/pages/UsagePage'
import { QualityPage } from '@/pages/QualityPage'
import { HumanizerDashboard } from '@/pages/HumanizerDashboard'
import { RunsDashboard } from '@/pages/RunsDashboard'
import { CalendarPage } from '@/pages/CalendarPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { ReviewsDashboard } from '@/pages/ReviewsDashboard'
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
  { path: 'reviews', element: <ReviewsDashboard /> },
  { path: 'workflows/new', element: <WorkflowEditor /> },
  { path: 'workflows/:workflowId', element: <WorkflowEditor /> },
  { path: 'clients', element: <ClientListPage /> },
  { path: 'clients/:id', element: <ClientDetailPage /> },
  { path: 'runs', element: <RunsDashboard /> },
  { path: 'calendar', element: <CalendarPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'usage', element: <UsagePage /> },
  { path: 'quality', element: <QualityPage /> },
  { path: 'humanizer', element: <HumanizerDashboard /> },
  { path: 'team', element: <TeamPage /> },
  { path: 'team/invite', element: <InvitePage /> },
  { path: 'access', element: <AccessPage /> },
  { path: 'settings', element: <SettingsPage /> },
  { path: 'profile', element: <UserProfilePage /> },
]

// ── Router ────────────────────────────────────────────────────────────────────
// Uses createBrowserRouter (data router) so that useBlocker works in WorkflowEditor.
const router = createBrowserRouter([
  // Always-public routes — no auth required, no shell
  { path: '/writer', element: <WriterPortalPage /> },
  { path: '/portal', element: <PortalPage /> },
  { path: '/portal/review/:runId', element: <PortalReviewPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/review/:runId', element: <ReviewPage /> },

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
