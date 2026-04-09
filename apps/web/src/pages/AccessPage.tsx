/**
 * AccessPage — global org-wide external access management
 * Admin + Owner: see and manage all DeliverableAccess grants across the org
 */
import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccessGrant {
  id: string
  stakeholder: {
    id: string
    name: string
    email: string
    role: string | null
    clientId: string
  }
  run: {
    id: string
    status: string
    workflowName: string
    client: { id: string; name: string }
    createdAt: string
  }
  status: 'active' | 'expired' | 'revoked'
  expiresAt: string | null
  revokedAt: string | null
  grantedBy: string | null
  createdAt: string
}

type Filter = 'all' | 'active' | 'expired' | 'revoked'

// ─── Grant Access Modal ────────────────────────────────────────────────────────

function GrantAccessModal({ onClose, onGranted }: { onClose: () => void; onGranted: () => void }) {
  const [clients, setClients]   = useState<{ id: string; name: string }[]>([])
  const [runs, setRuns]         = useState<{ id: string; workflowName: string; createdAt: string }[]>([])
  const [stakeholders, setStakeholders] = useState<{ id: string; name: string; email: string }[]>([])

  const [clientId, setClientId]       = useState('')
  const [runId, setRunId]             = useState('')
  const [stakeholderId, setSH]        = useState('')
  const [sendEmail, setSendEmail]     = useState(true)

  const [step, setStep]   = useState<'client' | 'run' | 'stakeholder'>('client')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Load clients
  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then(({ data }) => setClients((data ?? []).filter((c: { status: string }) => c.status !== 'archived')))
      .catch(console.error)
  }, [])

  // Load runs when client chosen
  useEffect(() => {
    if (!clientId) return
    apiFetch(`/api/v1/runs?clientId=${clientId}&status=completed&limit=50`)
      .then((r) => r.json())
      .then(({ data }) => setRuns(data ?? []))
      .catch(console.error)
  }, [clientId])

  // Load stakeholders when client chosen
  useEffect(() => {
    if (!clientId) return
    apiFetch(`/api/v1/clients/${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setStakeholders((data?.stakeholders ?? []).filter((s: { archivedAt: string | null }) => !s.archivedAt)))
      .catch(console.error)
  }, [clientId])

  const handleSelectClient = (id: string) => {
    setClientId(id)
    setRunId('')
    setSH('')
    setStep('run')
  }

  const handleSelectRun = (id: string) => {
    setRunId(id)
    setSH('')
    setStep('stakeholder')
  }

  const handleGrant = async () => {
    if (!runId || !stakeholderId) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/access/runs/${runId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stakeholderId, sendEmail }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to grant access'); return }
      onGranted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const selectedClient = clients.find((c) => c.id === clientId)
  const selectedRun    = runs.find((r) => r.id === runId)
  const selectedSH     = stakeholders.find((s) => s.id === stakeholderId)

  const STEP_LABELS = { client: 'Select a client', run: 'Select a run', stakeholder: 'Select a contact' }
  const STEPS = ['client', 'run', 'stakeholder'] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[540px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl overflow-hidden">

        {/* Header — matches New Workflow */}
        <div className="rounded-t-xl px-6 py-5 flex items-center justify-between" style={{ backgroundColor: '#a200ee' }}>
          <div>
            <div className="flex items-center gap-2">
              <Icons.ShieldCheck className="h-5 w-5 text-white/80" />
              <h2 className="text-base font-semibold text-white">Grant Deliverable Access</h2>
            </div>
            <p className="mt-1 text-sm text-white/70">
              {step === 'client' && 'Choose a client'}
              {step === 'run' && `${selectedClient?.name} — choose a completed run`}
              {step === 'stakeholder' && 'Choose a contact to share with'}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-border px-6 pt-3 pb-0 gap-0">
          {STEPS.map((s, i) => {
            const idx = STEPS.indexOf(step)
            const done = i < idx
            const active = s === step
            return (
              <button
                key={s}
                disabled={i > idx}
                onClick={() => {
                  if (s === 'client') { setStep('client'); setClientId(''); setRunId(''); setSH('') }
                  else if (s === 'run' && idx >= 1) { setStep('run'); setRunId(''); setSH('') }
                }}
                className={`flex items-center gap-1.5 px-0 pb-2.5 mr-6 text-[12px] font-medium border-b-2 transition-colors ${
                  active ? 'border-[#a200ee] text-[#a200ee]' :
                  done  ? 'border-transparent text-[#5c5b52] hover:text-[#a200ee]' :
                  'border-transparent text-[#b4b2a9] cursor-default'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  active ? 'bg-[#a200ee] text-white' :
                  done   ? 'bg-[#d0e8b0] text-[#3b6d11]' :
                  'bg-[#f4f4f2] text-[#b4b2a9]'
                }`}>
                  {done ? '✓' : i + 1}
                </span>
                {STEP_LABELS[s]}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">

          {/* Step: pick client */}
          {step === 'client' && (
            <div className="space-y-2">
              {clients.length === 0
                ? <p className="text-[12px] text-[#b4b2a9] py-6 text-center">No clients found</p>
                : clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectClient(c.id)}
                    className="w-full flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-purple-400 hover:bg-purple-50/60 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff' }}>
                      <Icons.Building2 className="h-4 w-4" style={{ color: '#a200ee' }} />
                    </div>
                    <span className="text-sm font-medium">{c.name}</span>
                  </button>
                ))
              }
            </div>
          )}

          {/* Step: pick run */}
          {step === 'run' && (
            <div className="space-y-2">
              {runs.length === 0
                ? (
                  <div className="flex flex-col items-center py-8 gap-2 text-center">
                    <Icons.Play className="h-7 w-7 text-[#dddcd6]" />
                    <p className="text-[12px] text-[#b4b2a9]">No completed runs for this client</p>
                  </div>
                )
                : runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelectRun(r.id)}
                    className="w-full flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-purple-400 hover:bg-purple-50/60 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff' }}>
                      <Icons.Play className="h-4 w-4" style={{ color: '#a200ee' }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.workflowName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}

          {/* Step: pick stakeholder */}
          {step === 'stakeholder' && (
            <div className="space-y-3">
              {stakeholders.length === 0
                ? (
                  <div className="flex flex-col items-center py-8 gap-2 text-center">
                    <Icons.Users className="h-7 w-7 text-[#dddcd6]" />
                    <p className="text-[12px] text-[#b4b2a9]">No contacts for this client</p>
                  </div>
                )
                : stakeholders.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSH(s.id)}
                    className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      stakeholderId === s.id
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-border bg-background hover:border-purple-400 hover:bg-purple-50/60'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ backgroundColor: '#f5e6ff', color: '#a200ee' }}>
                      {s.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{s.email}</p>
                    </div>
                    {stakeholderId === s.id && <Icons.Check className="h-4 w-4 shrink-0" style={{ color: '#a200ee' }} />}
                  </button>
                ))
              }

              {stakeholderId && (
                <label className="flex items-center gap-2 text-[12px] text-[#5c5b52] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="rounded border-[#dddcd6] accent-purple-600"
                  />
                  Send email notification with portal link
                </label>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
          )}
        </div>

        {/* Footer */}
        {step === 'stakeholder' && (
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-[13px] text-[#5c5b52] hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGrant}
              disabled={!stakeholderId || saving}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors disabled:opacity-60 hover:opacity-90"
              style={{ backgroundColor: '#a200ee' }}
            >
              {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Grant Access
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  const cfg = {
    active:  { bg: '#d0e8b0', border: '#3b6d11', color: '#3b6d11', label: 'Active' },
    expired: { bg: '#fef3c7', border: '#d97706', color: '#d97706', label: 'Expired' },
    revoked: { bg: '#fee2e2', border: '#dc2626', color: '#dc2626', label: 'Revoked' },
  }[status]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function AccessPage() {
  const { isAdmin } = useCurrentUser()
  const [grants, setGrants]         = useState<AccessGrant[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState<Filter>('active')
  const [search, setSearch]         = useState('')
  const [actionLoading, setAL]      = useState<string | null>(null)
  const [showGrant, setShowGrant]   = useState(false)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const loadGrants = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/access')
      const json = await res.json()
      if (res.ok) setGrants(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGrants() }, [loadGrants])

  const filtered = grants.filter((g) => {
    if (filter !== 'all' && g.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        g.stakeholder.name.toLowerCase().includes(q) ||
        g.stakeholder.email.toLowerCase().includes(q) ||
        g.run.client.name.toLowerCase().includes(q) ||
        g.run.workflowName.toLowerCase().includes(q)
      )
    }
    return true
  })

  async function handleRevoke(grantId: string) {
    if (!confirm('Revoke this access? The stakeholder will lose access immediately.')) return
    setAL(grantId)
    try {
      const res = await apiFetch(`/api/v1/access/grants/${grantId}/revoke`, { method: 'POST' })
      if (!res.ok) { const j = await res.json(); showToast(j.error ?? 'Failed to revoke', false); return }
      setGrants((prev) => prev.map((g) => g.id === grantId ? { ...g, status: 'revoked', revokedAt: new Date().toISOString() } : g))
      showToast('Access revoked')
    } finally {
      setAL(null)
    }
  }

  async function handleResend(grantId: string) {
    setAL(grantId)
    try {
      const res = await apiFetch(`/api/v1/access/grants/${grantId}/resend`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { showToast(json.error ?? 'Failed to resend', false); return }
      showToast('Portal link resent')
    } finally {
      setAL(null)
    }
  }

  const counts: Record<Filter, number> = {
    all:     grants.length,
    active:  grants.filter((g) => g.status === 'active').length,
    expired: grants.filter((g) => g.status === 'expired').length,
    revoked: grants.filter((g) => g.status === 'revoked').length,
  }

  return (
    <div className="flex-1 overflow-auto p-6 bg-[#fafaf8]">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#1a1a14]">External Access</h1>
          <p className="mt-0.5 text-[13px] text-[#b4b2a9]">
            Manage stakeholder access to deliverables across all clients.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowGrant(true)}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#a200ee' }}
          >
            <Icons.UserPlus className="h-4 w-4" />
            Grant Access
          </button>
        )}
      </div>

      {/* Filters + search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-[#e8e7e1] bg-white p-1">
          {(['active', 'expired', 'revoked', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors capitalize ${
                filter === f
                  ? 'bg-[#a200ee] text-white shadow-sm'
                  : 'text-[#5c5b52] hover:bg-[#f4f4f2]'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className={`ml-1.5 text-[10px] ${filter === f ? 'text-white/70' : 'text-[#b4b2a9]'}`}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#b4b2a9]" />
          <input
            type="text"
            placeholder="Search by name, email, or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-[#e8e7e1] bg-white pl-8 pr-3 py-1.5 text-[13px] text-[#1a1a14] placeholder:text-[#b4b2a9] outline-none focus:border-purple-300 focus:ring-1 focus:ring-purple-100"
          />
        </div>
        <span className="text-[12px] text-[#b4b2a9] ml-auto">{filtered.length} grant{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#e8e7e1] bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[13px] text-[#b4b2a9]">
            <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading access grants…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Icons.ShieldOff className="h-8 w-8 text-[#dddcd6]" />
            <p className="text-[13px] text-[#b4b2a9]">
              {grants.length === 0 ? 'No access grants yet.' : `No ${filter === 'all' ? '' : filter + ' '}grants match your search.`}
            </p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#e8e7e1] bg-[#fafaf8]">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Contact</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Client</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Deliverable</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Expires</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Granted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => {
                const busy = actionLoading === g.id
                return (
                  <tr
                    key={g.id}
                    className={`border-b border-[#f0efe9] transition-colors hover:bg-[#fafaf8] ${i === filtered.length - 1 ? 'border-b-0' : ''}`}
                  >
                    {/* Contact */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-[#f0f6fd] flex items-center justify-center text-[11px] font-bold text-[#185fa5] shrink-0">
                          {g.stakeholder.name[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-[#1a1a14] truncate">{g.stakeholder.name}</p>
                          <p className="text-[11px] text-[#b4b2a9] truncate">{g.stakeholder.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Client */}
                    <td className="px-4 py-3 text-[#5c5b52]">{g.run.client.name}</td>

                    {/* Deliverable */}
                    <td className="px-4 py-3">
                      <p className="text-[#1a1a14] truncate max-w-[200px]">{g.run.workflowName}</p>
                      <p className="text-[11px] text-[#b4b2a9]">
                        {new Date(g.run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3"><StatusBadge status={g.status} /></td>

                    {/* Expires */}
                    <td className="px-4 py-3 text-[#b4b2a9] text-[12px]">
                      {g.revokedAt
                        ? <span className="text-red-500">Revoked {new Date(g.revokedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        : g.expiresAt
                          ? new Date(g.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                          : '—'
                      }
                    </td>

                    {/* Granted */}
                    <td className="px-4 py-3 text-[#b4b2a9] text-[12px]">
                      {new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {g.status === 'active' && (
                          <button
                            onClick={() => handleResend(g.id)}
                            disabled={busy}
                            className="rounded p-1.5 text-[#b4b2a9] hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:opacity-40"
                            title="Resend portal link"
                          >
                            {busy ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Mail className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {g.status !== 'revoked' && (
                          <button
                            onClick={() => handleRevoke(g.id)}
                            disabled={busy}
                            className="rounded p-1.5 text-[#b4b2a9] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                            title="Revoke access"
                          >
                            {busy ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.ShieldX className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {g.status === 'revoked' && (
                          <span className="text-[11px] text-[#b4b2a9] italic px-1">revoked</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-lg ${
            toast.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Grant modal */}
      {showGrant && (
        <GrantAccessModal
          onClose={() => setShowGrant(false)}
          onGranted={() => {
            setShowGrant(false)
            loadGrants()
            showToast('Access granted successfully')
          }}
        />
      )}
    </div>
  )
}
