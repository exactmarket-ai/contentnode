import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ClerkProvider, SignIn, SignedIn, SignedOut } from '@clerk/clerk-react'
import { AppNav } from '@/components/layout/AppNav'
import { WorkflowEditor } from '@/pages/WorkflowEditor'
import { ClientListPage } from '@/pages/ClientListPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { UsagePage } from '@/pages/UsagePage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// Shell layout: side nav + main content
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppNav />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        <Route path="/workflows" element={<WorkflowEditor />} />
        <Route path="/clients" element={<ClientListPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/usage" element={<UsagePage />} />
      </Routes>
    </AppShell>
  )
}

function AppContent() {
  if (!PUBLISHABLE_KEY) {
    return <AppRoutes />
  }
  return (
    <>
      <SignedIn>
        <AppRoutes />
      </SignedIn>
      <SignedOut>
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center gap-2">
              <svg className="h-7 w-7 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
              <span className="text-lg font-semibold">ContentNode</span>
            </div>
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>
    </>
  )
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
