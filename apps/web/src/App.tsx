import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ClerkProvider, SignIn, SignedIn, SignedOut, useAuth, useClerk } from '@clerk/clerk-react'
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
import { TeamPage } from '@/pages/TeamPage'
import { AccessPage } from '@/pages/AccessPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AcceptInvitePage } from '@/pages/AcceptInvitePage'
import { PortalPage } from '@/pages/portal/PortalPage'
import { PortalReviewPage } from '@/pages/portal/PortalReviewPage'
import { WriterPortalPage } from '@/pages/writer/WriterPortalPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// Shell layout: side nav + main content
function AppShell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppNav onSignOut={onSignOut} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function AppRoutes({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <Routes>
      <Route path="/review/:runId" element={<ReviewPage />} />
      <Route path="*" element={
        <AppShell onSignOut={onSignOut}>
          <Routes>
            <Route path="/" element={<Navigate to="/workflows" replace />} />
            <Route path="/workflows" element={<WorkflowListPage />} />
            <Route path="/workflows/new" element={<WorkflowEditor />} />
            <Route path="/workflows/:workflowId" element={<WorkflowEditor />} />
            <Route path="/clients" element={<ClientListPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/runs" element={<RunsDashboard />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/quality" element={<QualityPage />} />
            <Route path="/humanizer" element={<HumanizerDashboard />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/access" element={<AccessPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </AppShell>
      } />
    </Routes>
  )
}

// Public routes that must never hit the Clerk auth wall
function PublicRoutes() {
  return (
    <Routes>
      <Route path="/writer" element={<WriterPortalPage />} />
      <Route path="/portal" element={<PortalPage />} />
      <Route path="/portal/review/:runId" element={<PortalReviewPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
    </Routes>
  )
}

function isPublicPath(pathname: string) {
  return pathname === '/writer' || pathname.startsWith('/portal') || pathname.startsWith('/accept-invite')
}

function AuthedApp() {
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
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-6">
          <img src="/logo.png" alt="ContentNode AI" className="h-14 w-auto object-contain" />
          <SignIn routing="hash" />
        </div>
      </div>
    )
  }

  return (
    <SignedIn>
      <AppRoutes onSignOut={() => signOut()} />
    </SignedIn>
  )
}

function AppContent() {
  // Public paths bypass Clerk entirely — no sign-in prompt, no redirect
  if (typeof window !== 'undefined' && isPublicPath(window.location.pathname)) {
    return <PublicRoutes />
  }

  if (!PUBLISHABLE_KEY) {
    return <AppRoutes />
  }

  return <AuthedApp />
}

export default function App() {
  const content = PUBLISHABLE_KEY ? (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <AppContent />
    </ClerkProvider>
  ) : (
    <AppContent />
  )

  return <BrowserRouter>{content}</BrowserRouter>
}
