import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useClerk, useUser, SignIn } from '@clerk/clerk-react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'

interface InviteDetails {
  email: string
  name: string | null
  role: string
  agencyName: string
  expiresAt: string | null
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', member: 'Member',
}

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const navigate  = useNavigate()
  const token     = params.get('token') ?? ''

  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()

  const [invite, setInvite]   = useState<InviteDetails | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone]       = useState(false)

  // 1. Load invite details (public — no auth needed)
  useEffect(() => {
    if (!token) { setError('Invalid invite link — no token found.'); return }
    fetch(`/api/v1/team/accept-invite/${token}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) { setError(json.error ?? 'Invalid invite link.'); return }
        setInvite(json.data)
      })
      .catch(() => setError('Could not reach the server. Please try again.'))
  }, [token])

  // 2. Auto-accept when user is already signed in with the correct email
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !invite || done || accepting || error) return
    const signedInEmail = user?.primaryEmailAddress?.emailAddress ?? ''
    if (signedInEmail.toLowerCase() !== invite.email.toLowerCase()) return
    handleAccept()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, invite])

  async function handleAccept() {
    setAccepting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/team/accept-invite/${token}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Could not accept invite.'); return }
      setDone(true)
      setTimeout(() => navigate('/workflows'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAccepting(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!token || (!invite && !error)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
        <Icons.Loader2 className="h-6 w-6 animate-spin text-[#b4b2a9]" />
      </div>
    )
  }

  // ── Error loading invite ──────────────────────────────────────────────────
  if (error && !invite) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
        <div className="w-[400px] rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <Icons.XCircle className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <h2 className="text-[16px] font-semibold text-[#1a1a14] mb-2">Invite unavailable</h2>
          <p className="text-[13px] text-[#5c5b52]">{error}</p>
        </div>
      </div>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
        <div className="w-[400px] rounded-xl border border-[#d0e8b0] bg-white p-8 text-center shadow-sm">
          <Icons.CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[#3b6d11]" />
          <h2 className="text-[16px] font-semibold text-[#1a1a14] mb-2">You're in!</h2>
          <p className="text-[13px] text-[#5c5b52]">Redirecting you to {invite!.agencyName}…</p>
        </div>
      </div>
    )
  }

  const roleLabel = ROLE_LABEL[invite!.role] ?? invite!.role

  // ── Wrong user is signed in ───────────────────────────────────────────────
  if (isLoaded && isSignedIn && user) {
    const signedInEmail = user.primaryEmailAddress?.emailAddress ?? ''
    const isCorrectUser = signedInEmail.toLowerCase() === invite!.email.toLowerCase()

    if (!isCorrectUser) {
      return (
        <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
          <div className="w-[440px] rounded-xl bg-white shadow-lg overflow-hidden">
            <div className="px-6 py-5" style={{ backgroundColor: '#a200ee' }}>
              <p className="text-[13px] font-semibold text-white tracking-wide">CONTENTNODE</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-amber-800 mb-1">Wrong account</p>
                <p className="text-[12px] text-amber-700">
                  You're signed in as <strong>{signedInEmail}</strong>, but this invite is for{' '}
                  <strong>{invite!.email}</strong>.
                </p>
              </div>
              <p className="text-[13px] text-[#5c5b52]">
                Sign out and sign in with the correct account to accept this invitation.
              </p>
              <button
                onClick={() => signOut()}
                className="w-full rounded-md py-2.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: '#a200ee' }}
              >
                Sign out and switch accounts
              </button>
            </div>
          </div>
        </div>
      )
    }

    // ── Correct user — show accept button ────────────────────────────────────
    return (
      <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
        <div className="w-[440px] rounded-xl bg-white shadow-lg overflow-hidden">
          <div className="px-6 py-5" style={{ backgroundColor: '#a200ee' }}>
            <p className="text-[13px] font-semibold text-white tracking-wide">CONTENTNODE</p>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold text-[#1a1a14] mb-1">You've been invited</h2>
              <p className="text-[13px] text-[#5c5b52]">
                Join <strong className="text-[#1a1a14]">{invite!.agencyName}</strong> as a{' '}
                <span className="font-semibold" style={{ color: '#a200ee' }}>{roleLabel}</span>.
              </p>
            </div>

            <div className="rounded-lg border border-[#e8e7e1] bg-[#fafaf8] px-4 py-3 space-y-1">
              <p className="text-[12px] text-[#b4b2a9]">Signing in as</p>
              <p className="text-[13px] font-medium text-[#1a1a14]">{user.fullName ?? invite!.name}</p>
              <p className="text-[12px] text-[#5c5b52]">{signedInEmail}</p>
            </div>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
            )}

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: '#a200ee' }}
            >
              {accepting && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Accept invitation
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Not signed in — show Clerk sign-in ───────────────────────────────────
  const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

  return (
    <div className="flex h-screen items-center justify-center bg-[#fafaf8]">
      <div className="w-[440px] rounded-xl bg-white shadow-lg overflow-hidden">
        <div className="px-6 py-5" style={{ backgroundColor: '#a200ee' }}>
          <p className="text-[13px] font-semibold text-white tracking-wide">CONTENTNODE</p>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-[18px] font-semibold text-[#1a1a14] mb-1">You've been invited</h2>
            <p className="text-[13px] text-[#5c5b52]">
              Sign in as <strong className="text-[#1a1a14]">{invite!.email}</strong> to join{' '}
              <strong className="text-[#1a1a14]">{invite!.agencyName}</strong> as a{' '}
              <span className="font-semibold" style={{ color: '#a200ee' }}>{roleLabel}</span>.
            </p>
          </div>

          {PUBLISHABLE_KEY ? (
            <SignIn
              routing="hash"
              initialValues={{ emailAddress: invite!.email }}
              forceRedirectUrl={`/accept-invite?token=${token}`}
            />
          ) : (
            <p className="text-[12px] text-[#b4b2a9] text-center">
              Clerk auth not configured — sign in via the main app then return to this link.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
