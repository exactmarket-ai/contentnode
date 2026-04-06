import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
  seniority: 'owner' | 'senior' | 'member' | 'junior'
  magicLinkToken: string | null
  magicLinkExpiresAt: string | null
  createdAt: string
  _count?: { feedbacks: number }
}

interface Workflow {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  connectivityMode: string
  createdAt: string
  updatedAt: string
  _count: { runs: number }
}

interface Insight {
  id: string
  type: string
  title: string
  body: string
  confidence: number | null
  status: string
  isCollective: boolean
  instanceCount: number
  createdAt: string
}

interface Client {
  id: string
  name: string
  slug: string
  industry: string | null
  createdAt: string
  stakeholders: Stakeholder[]
  workflows: Workflow[]
  insights: Insight[]
  _count: { stakeholders: number; workflows: number }
}

// ── Seniority config ──────────────────────────────────────────────────────────

const SENIORITY_CONFIG: Record<string, { label: string; description: string; color: string }> = {
  owner:  { label: 'Owner',  description: 'Maximum, this person has final say',       color: 'text-yellow-400 bg-yellow-950 border-yellow-800' },
  senior: { label: 'Senior', description: 'High influence',                            color: 'text-blue-400 bg-blue-950 border-blue-800'     },
  member: { label: 'Member', description: 'Standard weight (default)',                 color: 'text-slate-300 bg-slate-800 border-slate-700'  },
  junior: { label: 'Junior', description: 'Low influence on pattern scoring',          color: 'text-slate-400 bg-slate-900 border-slate-700'  },
}

function SeniorityBadge({ seniority }: { seniority: string }) {
  const cfg = SENIORITY_CONFIG[seniority] ?? SENIORITY_CONFIG.member
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium', cfg.color)}>
      {cfg.label}
    </span>
  )
}

// ── Modals ────────────────────────────────────────────────────────────────────

function AddStakeholderModal({ clientId, onClose, onCreate }: {
  clientId: string
  onClose: () => void
  onCreate: (s: Stakeholder) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [seniority, setSeniority] = useState<'owner' | 'senior' | 'member' | 'junior'>('member')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/v1/clients/${clientId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role: role.trim() || undefined, seniority }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to add stakeholder')
      }
      const { data } = await res.json()
      onCreate(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Add Stakeholder</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoFocus className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email *</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="jane@example.com" className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Role / Title</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of Marketing" className="h-8 text-sm" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Seniority</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['owner', 'senior', 'member', 'junior'] as const).map((s) => {
                const cfg = SENIORITY_CONFIG[s]
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeniority(s)}
                    className={cn(
                      'flex flex-col items-start rounded-lg border p-3 text-left transition-all',
                      seniority === s
                        ? 'border-blue-500 bg-blue-950/40'
                        : 'border-border hover:border-border/80 hover:bg-accent/30',
                    )}
                  >
                    <span className="text-xs font-medium">{cfg.label}</span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">{cfg.description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !email.trim()} className="h-8 text-xs">
              {loading && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Add Stakeholder
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditStakeholderModal({ stakeholder, clientId, onClose, onUpdate }: {
  stakeholder: Stakeholder
  clientId: string
  onClose: () => void
  onUpdate: (s: Stakeholder) => void
}) {
  const [name, setName] = useState(stakeholder.name)
  const [role, setRole] = useState(stakeholder.role ?? '')
  const [seniority, setSeniority] = useState<'owner' | 'senior' | 'member' | 'junior'>(stakeholder.seniority)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/v1/clients/${clientId}/stakeholders/${stakeholder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), role: role.trim() || undefined, seniority }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to update stakeholder')
      }
      const { data } = await res.json()
      onUpdate(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Edit Stakeholder</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Email (cannot be changed)</Label>
            <Input value={stakeholder.email} disabled className="h-8 text-sm opacity-50" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Role / Title</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of Marketing" className="h-8 text-sm" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Seniority</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['owner', 'senior', 'member', 'junior'] as const).map((s) => {
                const cfg = SENIORITY_CONFIG[s]
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeniority(s)}
                    className={cn(
                      'flex flex-col items-start rounded-lg border p-3 text-left transition-all',
                      seniority === s
                        ? 'border-blue-500 bg-blue-950/40'
                        : 'border-border hover:border-border/80 hover:bg-accent/30',
                    )}
                  >
                    <span className="text-xs font-medium">{cfg.label}</span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">{cfg.description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim()} className="h-8 text-xs">
              {loading && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignWorkflowModal({ clientId, existingIds, onClose, onAssign }: {
  clientId: string
  existingIds: string[]
  onClose: () => void
  onAssign: (wf: Workflow) => void
}) {
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; clientId: string | null }>>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/v1/workflows`)
      .then((r) => r.json())
      .then(({ data }) => {
        // Show workflows not already assigned to this client
        setWorkflows((data ?? []).filter((w: { id: string }) => !existingIds.includes(w.id)))
      })
      .catch(console.error)
      .finally(() => setFetching(false))
  }, [existingIds])

  const handleAssign = async () => {
    if (!selected) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/v1/workflows/${selected}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      if (!res.ok) throw new Error('Failed to assign workflow')
      const { data } = await res.json()
      onAssign(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[440px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Assign Workflow</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {fetching ? (
            <div className="flex justify-center py-6">
              <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : workflows.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No unassigned workflows available</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {workflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => setSelected(wf.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all text-sm',
                    selected === wf.id
                      ? 'border-blue-500 bg-blue-950/40'
                      : 'border-border hover:bg-accent/30',
                  )}
                >
                  <Icons.Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {wf.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
            <Button size="sm" onClick={handleAssign} disabled={!selected || loading} className="h-8 text-xs">
              {loading && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Assign
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Invite result popup ───────────────────────────────────────────────────────

function InviteResult({ data, onClose }: { data: { portalUrl: string; expiresAt: string; stakeholder: { name: string; email: string } }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(data.portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[500px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icons.CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Portal Invite Generated</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-muted/40 p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Stakeholder</p>
            <p className="text-sm font-medium">{data.stakeholder.name}</p>
            <p className="text-xs text-muted-foreground">{data.stakeholder.email}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Portal Link (valid 30 days)</Label>
            <div className="flex gap-2">
              <Input value={data.portalUrl} readOnly className="h-8 text-xs font-mono" />
              <Button variant="outline" size="sm" onClick={copy} className="h-8 shrink-0 text-xs">
                {copied ? <Icons.Check className="h-3.5 w-3.5 text-emerald-400" /> : <Icons.Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              In production, this link would be emailed automatically. Expires {new Date(data.expiresAt).toLocaleDateString()}.
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onClose} className="h-8 text-xs">Done</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab components ────────────────────────────────────────────────────────────

function OverviewTab({ client }: { client: Client }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Icons.Users, value: client._count.stakeholders, label: 'Stakeholders' },
          { icon: Icons.Workflow, value: client._count.workflows, label: 'Workflows' },
          { icon: Icons.Lightbulb, value: client.insights.length, label: 'Active Insights' },
          { icon: Icons.Calendar, value: new Date(client.createdAt).toLocaleDateString(), label: 'Client Since' },
        ].map(({ icon: Icon, value, label }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {client.industry && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Industry</p>
          <p className="text-sm font-medium">{client.industry}</p>
        </div>
      )}
    </div>
  )
}

function StakeholdersTab({ client, onUpdate }: { client: Client; onUpdate: (updated: Client) => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Stakeholder | null>(null)
  const [inviteResult, setInviteResult] = useState<null | { portalUrl: string; expiresAt: string; stakeholder: { name: string; email: string } }>(null)
  const [sendingInvite, setSendingInvite] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const sendInvite = async (stakeholder: Stakeholder) => {
    setSendingInvite(stakeholder.id)
    try {
      const res = await fetch(`${API}/api/v1/clients/${client.id}/stakeholders/${stakeholder.id}/send-invite`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to generate invite')
      const { data } = await res.json()
      setInviteResult(data)
    } catch (err) {
      console.error(err)
    } finally {
      setSendingInvite(null)
    }
  }

  const deleteStakeholder = async (id: string) => {
    if (!confirm('Remove this stakeholder? Their feedback history will be preserved.')) return
    setDeleting(id)
    try {
      await fetch(`${API}/api/v1/clients/${client.id}/stakeholders/${id}`, { method: 'DELETE' })
      onUpdate({ ...client, stakeholders: client.stakeholders.filter((s) => s.id !== id) })
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(null)
    }
  }

  const hasPortalAccess = (s: Stakeholder) =>
    s.magicLinkToken && s.magicLinkExpiresAt && new Date(s.magicLinkExpiresAt) > new Date()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{client.stakeholders.length} stakeholders</p>
        <Button size="sm" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
          <Icons.UserPlus className="mr-1.5 h-3 w-3" />
          Add Stakeholder
        </Button>
      </div>

      {client.stakeholders.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Icons.Users className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No stakeholders yet</p>
          <Button size="sm" className="mt-3 h-7 text-xs" onClick={() => setShowAdd(true)}>
            <Icons.UserPlus className="mr-1.5 h-3 w-3" />
            Add first stakeholder
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {client.stakeholders.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
            >
              {/* Avatar */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {s.name.slice(0, 2).toUpperCase()}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <SeniorityBadge seniority={s.seniority} />
                  {hasPortalAccess(s) && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      <Icons.Globe className="h-2.5 w-2.5" />
                      Portal
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {s.role ? `${s.role} · ` : ''}{s.email}
                </p>
              </div>

              {/* Feedback count */}
              {s._count && (
                <div className="text-center">
                  <p className="text-sm font-semibold">{s._count.feedbacks}</p>
                  <p className="text-[10px] text-muted-foreground">feedback</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => sendInvite(s)}
                  disabled={sendingInvite === s.id}
                  title={hasPortalAccess(s) ? 'Resend portal invite' : 'Invite to portal'}
                >
                  {sendingInvite === s.id
                    ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                    : <><Icons.Mail className="mr-1 h-3 w-3" />{hasPortalAccess(s) ? 'Resend' : 'Invite'}</>
                  }
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditing(s)}
                  title="Edit"
                >
                  <Icons.Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                  onClick={() => deleteStakeholder(s.id)}
                  disabled={deleting === s.id}
                  title="Remove"
                >
                  {deleting === s.id
                    ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                    : <Icons.Trash2 className="h-3 w-3" />
                  }
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddStakeholderModal
          clientId={client.id}
          onClose={() => setShowAdd(false)}
          onCreate={(s) => {
            onUpdate({ ...client, stakeholders: [...client.stakeholders, s] })
            setShowAdd(false)
          }}
        />
      )}

      {editing && (
        <EditStakeholderModal
          stakeholder={editing}
          clientId={client.id}
          onClose={() => setEditing(null)}
          onUpdate={(updated) => {
            onUpdate({
              ...client,
              stakeholders: client.stakeholders.map((s) => (s.id === updated.id ? updated : s)),
            })
            setEditing(null)
          }}
        />
      )}

      {inviteResult && (
        <InviteResult
          data={inviteResult}
          onClose={() => setInviteResult(null)}
        />
      )}
    </div>
  )
}

function WorkflowsTab({ client, onUpdate }: { client: Client; onUpdate: (updated: Client) => void }) {
  const navigate = useNavigate()
  const [showAssign, setShowAssign] = useState(false)

  const STATUS_COLORS: Record<string, string> = {
    draft:    'text-slate-400 bg-slate-800 border-slate-700',
    active:   'text-emerald-400 bg-emerald-950 border-emerald-800',
    archived: 'text-slate-500 bg-slate-900 border-slate-800',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{client.workflows.length} workflows</p>
        <Button size="sm" className="h-7 text-xs" onClick={() => setShowAssign(true)}>
          <Icons.Link className="mr-1.5 h-3 w-3" />
          Assign Workflow
        </Button>
      </div>

      {client.workflows.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Icons.Workflow className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No workflows assigned</p>
          <Button size="sm" className="mt-3 h-7 text-xs" onClick={() => setShowAssign(true)}>
            <Icons.Link className="mr-1.5 h-3 w-3" />
            Assign a workflow
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {client.workflows.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
            >
              <Icons.Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{wf.name}</p>
                  <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[wf.status])}>
                    {wf.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">{wf.connectivityMode}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {wf._count.runs} runs · Updated {new Date(wf.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/workflows')}
              >
                <Icons.ExternalLink className="mr-1 h-3 w-3" />
                Open
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAssign && (
        <AssignWorkflowModal
          clientId={client.id}
          existingIds={client.workflows.map((w) => w.id)}
          onClose={() => setShowAssign(false)}
          onAssign={(wf) => {
            onUpdate({ ...client, workflows: [...client.workflows, wf] })
            setShowAssign(false)
          }}
        />
      )}
    </div>
  )
}

function InsightsTab({ insights }: { insights: Insight[] }) {
  const TYPE_COLORS: Record<string, string> = {
    tone:           'text-purple-400 bg-purple-950 border-purple-800',
    forbidden_term: 'text-red-400 bg-red-950 border-red-800',
    structure:      'text-blue-400 bg-blue-950 border-blue-800',
    length:         'text-amber-400 bg-amber-950 border-amber-800',
    claims:         'text-emerald-400 bg-emerald-950 border-emerald-800',
  }

  const STATUS_COLORS: Record<string, string> = {
    pending:   'text-amber-400',
    applied:   'text-blue-400',
    confirmed: 'text-emerald-400',
    dismissed: 'text-muted-foreground',
  }

  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <Icons.Lightbulb className="mb-2 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No active insights</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Insights are generated as stakeholder feedback accumulates</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <div key={insight.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize', TYPE_COLORS[insight.type] ?? 'text-slate-300 bg-slate-800 border-slate-700')}>
                {insight.type.replace('_', ' ')}
              </span>
              {insight.isCollective && (
                <span className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                  <Icons.Users className="h-2.5 w-2.5" />
                  collective
                </span>
              )}
              <span className={cn('text-[10px] font-medium', STATUS_COLORS[insight.status])}>
                {insight.status}
              </span>
            </div>
            {insight.confidence != null && (
              <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                {Math.round(insight.confidence * 100)}%
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{insight.title}</p>
          <p className="text-xs text-muted-foreground line-clamp-2">{insight.body}</p>
          <p className="text-[10px] text-muted-foreground">
            {insight.instanceCount} instance{insight.instanceCount !== 1 ? 's' : ''} ·{' '}
            {new Date(insight.createdAt).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = ['overview', 'workflows', 'stakeholders', 'insights'] as const
type Tab = (typeof TABS)[number]

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const loadClient = useCallback(() => {
    if (!id) return
    setLoading(true)
    fetch(`${API}/api/v1/clients/${id}`)
      .then((r) => r.json())
      .then(({ data }) => setClient(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { loadClient() }, [loadClient])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-muted-foreground">Client not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/clients')} className="h-8 text-xs">
          <Icons.ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Clients
        </Button>
      </div>
    )
  }

  const TAB_LABELS: Record<Tab, string> = {
    overview:     'Overview',
    workflows:    `Workflows (${client.workflows.length})`,
    stakeholders: `Stakeholders (${client.stakeholders.length})`,
    insights:     `Insights (${client.insights.length})`,
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
        <button
          onClick={() => navigate('/clients')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.ChevronLeft className="h-4 w-4" />
        </button>
        <div className="h-5 w-px bg-border" />
        <div>
          <h1 className="text-sm font-semibold leading-tight">{client.name}</h1>
          {client.industry && (
            <p className="text-[11px] text-muted-foreground">{client.industry}</p>
          )}
        </div>
        {client.industry && (
          <Badge variant="outline" className="text-xs">{client.industry}</Badge>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border bg-card px-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && <OverviewTab client={client} />}
        {activeTab === 'workflows' && <WorkflowsTab client={client} onUpdate={setClient} />}
        {activeTab === 'stakeholders' && <StakeholdersTab client={client} onUpdate={setClient} />}
        {activeTab === 'insights' && <InsightsTab insights={client.insights} />}
      </div>
    </div>
  )
}
