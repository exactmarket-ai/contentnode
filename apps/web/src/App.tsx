import { ClerkProvider, SignIn, SignedIn, SignedOut } from '@clerk/clerk-react'
import { WorkflowEditor } from '@/pages/WorkflowEditor'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

// If no Clerk key is set (e.g. local dev without auth), render the editor directly.
function AppContent() {
  if (!PUBLISHABLE_KEY) {
    return <WorkflowEditor />
  }
  return (
    <>
      <SignedIn>
        <WorkflowEditor />
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
  if (!PUBLISHABLE_KEY) {
    return <AppContent />
  }
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <AppContent />
    </ClerkProvider>
  )
}
