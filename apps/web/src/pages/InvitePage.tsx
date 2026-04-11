import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'

interface PendingMember {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'manager' | 'lead' | 'member'
  createdAt: string
  inviteExpiresAt?: string | null
  inviteExpired: boolean
}

const ROLE_INFO: Record<string, { label: string; description: string; color: string; bg: string; border: string }> = {
  member: {
    label: 'Member',
    description: 'Can view and run workflows. No admin or access management.',
    color: '#5c5b52', bg: '#f4f4f2', border: '#dddcd6',
  },
  lead: {
    label: 'Lead',
    description: 'All Member permissions plus client-level access management and external portal grants.',
    color: '#166534', bg: '#f0fdf4', border: '#86efac',
  },
  manager: {
    label: 'Manager',
    description: 'Manages client workflows and team members. Can invite leads and members. Cannot change org settings.',
    color: '#b45309', bg: '#fffbeb', border: '#fde68a',
  },
  admin: {
    label: 'Admin',
    description: 'Full access: create and manage workflows, clients, team members, and org settings.',
    color: '#185fa5', bg: '#f0f6fd', border: '#b8d8f5',
  },
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function expiryLabel(isoExpiry: string | null | undefined, expired: boolean) {
  if (expired) return { label: 'Expired', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  if (!isoExpiry) return { label: 'Pending', color: '#d97706', bg: '#fffbeb', border: '#fde68a' }
  const daysLeft = Math.ceil((new Date(isoExpiry).getTime() - Date.now()) / 86_400_000)
  if (daysLeft <= 0) return { label: 'Expired', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  return {
    label: `Expires in ${daysLeft}d`,
    color: '#d97706', bg: '#fffbeb', border: '#fde68a',
  }
}

export function InvitePage() {
  const { isAdmin, isOwner, loading: roleLoading } = useCurrentUser()
  const canInvite = isAdmin || isOwner

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState<'admin' | 'manager' | 'lead' | 'member'>('member')
  const [sending, setSending]   = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent]         = useState<string | null>(null)

  const [pending, setPending]   = useState<PendingMember[]>([])
  const [loadingPending, setLoadingPending] = useState(true)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [removingId, setRemovingId]   = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/team')
      .then(r => r.json())
      .then(({ data }) => {
        const members: PendingMember[] = (data ?? []).filter((m: PendingMember) => m.inviteExpired !== undefined)
        setPending(members.filter((m) => m.inviteExpired || (m as unknown as Record<string,unknown>).pending))
      })
      .catch(() => {})
      .finally(() => setLoadingPending(false))
  }, [])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setSendError(null)
    setSending(true)
    setSent(null)
    try {
      const res = await apiFetch('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      })
      const json = await res.json()
      if (!res.ok) { setSendError(json.error ?? 'Invite failed'); return }
      setSent(email.trim())
      setPending(prev => [json.data as PendingMember, ...prev])
      setName(''); setEmail('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Network error — please try again.')
    } finally {
      setSending(false)
    }
  }

  async function handleResend(id: string) {
    setResendingId(id)
    try {
      await apiFetch(`/api/v1/team/${id}/resend-invite`, { method: 'POST' })
      // Mark as no longer expired
      setPending(prev => prev.map(m => m.id === id ? { ...m, inviteExpired: false } : m))
    } catch {
      // silent — user can try again
    } finally {
      setResendingId(null)
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id)
    try {
      await apiFetch(`/api/v1/team/${id}`, { method: 'DELETE' })
      setPending(prev => prev.filter(m => m.id !== id))
    } catch {
      // silent
    } finally {
      setRemovingId(null)
    }
  }

  if (roleLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
      </div>
    )
  }

  if (!canInvite) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: '#fdf5ff' }}>
          <Icons.ShieldOff className="h-6 w-6" style={{ color: '#a200ee' }} />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: '#1a1a14' }}>Admin access required</p>
          <p className="mt-1 text-xs" style={{ color: '#b4b2a9' }}>Only admins and owners can invite team members.</p>
        </div>
        <Link to="/team" className="text-xs underline" style={{ color: '#a200ee' }}>← Back to team</Link>
      </div>
    )
  }

  const selectedRoleInfo = ROLE_INFO[role]

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ backgroundColor: '#f5f4ef' }}>

      {/* Page header */}
      <div className="shrink-0 border-b px-8 py-5" style={{ borderColor: '#e8e7e1', backgroundColor: '#fafaf8' }}>
        <div className="flex items-center gap-3">
          <Link
            to="/team"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
            style={{ color: '#b4b2a9' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#5c5b52')}
            onMouseLeave={e => (e.currentTarget.style.color = '#b4b2a9')}
          >
            <Icons.ChevronLeft className="h-3 w-3" />
            Team
          </Link>
          <span style={{ color: '#dddcd6' }}>/</span>
          <span className="text-sm font-semibold" style={{ color: '#1a1a14' }}>Invite Members</span>
        </div>
        <p className="mt-1 text-xs" style={{ color: '#b4b2a9' }}>
          Invites are sent by email and expire after 7 days.
        </p>
      </div>

      <div className="flex flex-1 gap-8 overflow-auto px-8 py-8">

        {/* ── Invite form ────────────────────────────────────────────── */}
        <div className="w-full max-w-md shrink-0">
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: '#e8e7e1', backgroundColor: '#ffffff' }}
          >
            <div className="px-6 py-4 border-b" style={{ borderColor: '#e8e7e1' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Send an invite</h2>
              <p className="mt-0.5 text-xs" style={{ color: '#b4b2a9' }}>
                The invitee will receive an email with a link to create their account.
              </p>
            </div>

            <form onSubmit={handleSend} className="space-y-4 p-6">
              {/* Name */}
              <div>
                <label className="mb-1 block text-[12px] font-medium" style={{ color: '#5c5b52' }}>
                  Full name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ borderColor: '#dddcd6', color: '#1a1a14' }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#a200ee')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#dddcd6')}
                />
              </div>

              {/* Email */}
              <div>
                <label className="mb-1 block text-[12px] font-medium" style={{ color: '#5c5b52' }}>
                  Work email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="jane@agency.com"
                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ borderColor: '#dddcd6', color: '#1a1a14' }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#a200ee')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#dddcd6')}
                />
              </div>

              {/* Role */}
              <div>
                <label className="mb-1 block text-[12px] font-medium" style={{ color: '#5c5b52' }}>
                  Role
                </label>
                <div className="space-y-2">
                  {(['member', 'lead', 'manager', 'admin'] as const).map((r) => {
                    const info = ROLE_INFO[r]
                    const selected = role === r
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className="flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
                        style={selected
                          ? { borderColor: info.border, backgroundColor: info.bg }
                          : { borderColor: '#e8e7e1', backgroundColor: '#fafaf8' }
                        }
                      >
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
                          style={selected
                            ? { borderColor: info.color, backgroundColor: info.color }
                            : { borderColor: '#dddcd6' }
                          }
                        >
                          {selected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: selected ? info.color : '#1a1a14' }}>
                            {info.label}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: '#5c5b52' }}>
                            {info.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {sendError && (
                <div
                  className="rounded-lg border px-3 py-2.5 text-[12px]"
                  style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2', color: '#dc2626' }}
                >
                  {sendError}
                </div>
              )}

              {sent && (
                <div
                  className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12px]"
                  style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4', color: '#166534' }}
                >
                  <Icons.CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Invite sent to <strong>{sent}</strong>
                </div>
              )}

              <button
                type="submit"
                disabled={sending}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-60 hover:opacity-90"
                style={{ backgroundColor: '#a200ee' }}
              >
                {sending
                  ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />Sending…</>
                  : <><Icons.Send className="h-3.5 w-3.5" />Send invite</>
                }
              </button>
            </form>
          </div>
        </div>

        {/* ── Pending invites ────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: '#e8e7e1', backgroundColor: '#ffffff' }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#e8e7e1' }}>
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Pending invites</h2>
                <p className="mt-0.5 text-xs" style={{ color: '#b4b2a9' }}>
                  Invites that haven't been accepted yet.
                </p>
              </div>
              {pending.length > 0 && (
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb', color: '#d97706' }}
                >
                  {pending.length}
                </span>
              )}
            </div>

            {loadingPending ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
              </div>
            ) : pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14">
                <Icons.MailCheck className="h-8 w-8" style={{ color: '#dddcd6' }} />
                <p className="text-sm font-medium" style={{ color: '#b4b2a9' }}>No pending invites</p>
                <p className="text-xs" style={{ color: '#b4b2a9' }}>All team members have accepted their invites.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#f4f4f2' }}>
                {pending.map((m) => {
                  const expiry = expiryLabel(m.inviteExpiresAt, m.inviteExpired)
                  const roleInfo = ROLE_INFO[m.role] ?? ROLE_INFO.member
                  const initials = (m.name ?? m.email).split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-4 px-6 py-4"
                      style={{ borderColor: '#f4f4f2' }}
                    >
                      {/* Avatar */}
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        style={{ backgroundColor: '#f4f4f2', color: '#5c5b52' }}
                      >
                        {initials}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-medium" style={{ color: '#1a1a14' }}>
                            {m.name ?? <span style={{ color: '#b4b2a9' }}>No name</span>}
                          </p>
                          <span
                            className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold"
                            style={{ backgroundColor: roleInfo.bg, borderColor: roleInfo.border, color: roleInfo.color }}
                          >
                            {roleInfo.label}
                          </span>
                        </div>
                        <p className="truncate text-[11px]" style={{ color: '#b4b2a9' }}>
                          {m.email} · Invited {timeAgo(m.createdAt)}
                        </p>
                      </div>

                      {/* Status */}
                      <span
                        className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: expiry.bg, borderColor: expiry.border, color: expiry.color }}
                      >
                        {expiry.label}
                      </span>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => handleResend(m.id)}
                          disabled={resendingId === m.id}
                          title="Resend invite"
                          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
                          style={{ color: '#b4b2a9' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#185fa5')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#b4b2a9')}
                        >
                          {resendingId === m.id
                            ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Icons.RotateCcw className="h-3.5 w-3.5" />
                          }
                        </button>
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          title="Remove invite"
                          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
                          style={{ color: '#b4b2a9' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#b4b2a9')}
                        >
                          {removingId === m.id
                            ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Icons.Trash2 className="h-3.5 w-3.5" />
                          }
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Role definitions reference */}
          <div
            className="mt-4 rounded-xl border p-5"
            style={{ borderColor: '#e8e7e1', backgroundColor: '#fafaf8' }}
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>
              Role reference
            </p>
            <div className="space-y-2">
              {Object.entries(ROLE_INFO).map(([key, info]) => (
                <div key={key} className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold"
                    style={{ backgroundColor: info.bg, borderColor: info.border, color: info.color }}
                  >
                    {info.label}
                  </span>
                  <p className="text-[11px] leading-relaxed" style={{ color: '#5c5b52' }}>{info.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
