import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'
import { downloadBrandProfileDocx, downloadCompanyProfileDocx } from '@/lib/downloadDocx'
import { ClientBillingReportsTab } from './ClientBillingReportsTab'
import { ClientDemandGenTab } from './ClientDemandGenTab'
import { ClientFrameworkTab } from './ClientFrameworkTab'
import { ClientBrandingTab } from './ClientBrandingTab'
import { ClientPromptLibraryTab } from './ClientPromptLibraryTab'
import { ClientDocStyleTab } from './ClientDocStyleTab'
import { ClientDeliverablesTab } from './ClientDeliverablesTab'
import { CampaignsTab } from './CampaignsTab'
import { ClientBrainTab } from './ClientBrainTab'
import { ClientGTMAssessmentTab } from './ClientGTMAssessmentTab'
import { useCurrentUser } from '@/hooks/useCurrentUser'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
  seniority: 'owner' | 'senior' | 'member' | 'junior'
  source?: string        // 'manual' | 'deliverable_share'
  expiresAt?: string | null
  archivedAt: string | null
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
  logoUrl?: string | null
  status: string
  archivedAt: string | null
  createdAt: string
  requireOffline: boolean
  stakeholders: Stakeholder[]
  workflows: Workflow[]
  insights: Insight[]
  _count: { stakeholders: number; workflows: number }
}

// ── Seniority config ──────────────────────────────────────────────────────────

const SENIORITY_CONFIG: Record<string, { label: string; description: string; color: string }> = {
  owner:  { label: 'Owner',  description: 'Maximum, this person has final say',       color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  senior: { label: 'Senior', description: 'High influence',                            color: 'text-blue-600 bg-blue-50 border-blue-200'     },
  member: { label: 'Member', description: 'Standard weight (default)',                 color: 'text-slate-600 bg-slate-100 border-slate-200'  },
  junior: { label: 'Junior', description: 'Low influence on pattern scoring',          color: 'text-slate-500 bg-slate-50 border-slate-200'  },
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
      const res = await apiFetch(`/api/v1/clients/${clientId}/stakeholders`, {
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
          <h2 className="text-sm font-semibold">Add Contact</h2>
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
                        ? 'border-blue-500 bg-blue-50'
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

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !email.trim()} className="h-8 text-xs">
              {loading && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Add Contact
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
      const res = await apiFetch(`/api/v1/clients/${clientId}/stakeholders/${stakeholder.id}`, {
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
          <h2 className="text-sm font-semibold">Edit Contact</h2>
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
                        ? 'border-blue-500 bg-blue-50'
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

          {error && <p className="text-xs text-red-600">{error}</p>}

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
    apiFetch('/api/v1/workflows')
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
      const res = await apiFetch(`/api/v1/workflows/${selected}`, {
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
                      ? 'border-blue-500 bg-blue-50'
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

// ── Move Stakeholder Modal ────────────────────────────────────────────────────

function MoveStakeholderModal({ stakeholder, currentClientId, onClose, onMoved }: {
  stakeholder: Stakeholder
  currentClientId: string
  onClose: () => void
  onMoved: (action: 'moved' | 'copied') => void
}) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [selected, setSelected] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [loading, setLoading] = useState<'move' | 'copy' | null>(null)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then(({ data }) => {
        setClients((data ?? []).filter((c: { id: string; status: string }) => c.id !== currentClientId && c.status !== 'archived'))
      })
      .catch(console.error)
      .finally(() => setFetching(false))
  }, [currentClientId])

  const handleMove = async () => {
    if (!selected) return
    setLoading('move')
    setError('')
    try {
      const res = await apiFetch(`/api/v1/clients/${currentClientId}/stakeholders/${stakeholder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selected }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      onMoved('moved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  const handleCopy = async () => {
    if (!selected) return
    setLoading('copy')
    setError('')
    try {
      const res = await apiFetch(`/api/v1/clients/${currentClientId}/stakeholders/${stakeholder.id}/copy-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetClientId: selected }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      onMoved('copied')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{stakeholder.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Select a client, then choose Move or Copy</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {fetching ? (
            <div className="flex justify-center py-6">
              <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No other active clients available</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setSelected(c.id); setSelectedName(c.name) }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all',
                    selected === c.id ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-accent/30',
                  )}
                >
                  {selected === c.id
                    ? <Icons.CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />
                    : <Icons.Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  }
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Action explanation */}
          {selected && (
            <div className="rounded-lg bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">Move</span> — transfers {stakeholder.name} to {selectedName}. Their full history (feedback, preferences, patterns) moves with them.</p>
              <p><span className="font-medium text-foreground">Copy</span> — adds {stakeholder.name} to {selectedName} as a new contact. Both clients keep their own records of how they work with her.</p>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!selected || loading !== null}
              className="h-8 text-xs"
            >
              {loading === 'copy' && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              <Icons.Copy className="mr-1.5 h-3 w-3" />
              Copy to {selectedName || 'Client'}
            </Button>
            <Button
              size="sm"
              onClick={handleMove}
              disabled={!selected || loading !== null}
              className="h-8 text-xs"
            >
              {loading === 'move' && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              <Icons.ArrowRightLeft className="mr-1.5 h-3 w-3" />
              Move to {selectedName || 'Client'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Logo components (shared in this page) ────────────────────────────────────

function ClientLogoAvatar({ logoUrl, name, size = 'md' }: { logoUrl?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-7 w-7 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-14 w-14 text-sm' }[size]
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  if (logoUrl) {
    const src = logoUrl.startsWith('/') ? assetUrl(logoUrl) : logoUrl
    return <img src={src} alt={name} className={`${dims} rounded-lg object-contain border border-border bg-white shrink-0`} />
  }
  return (
    <div className={`${dims} rounded-lg flex items-center justify-center font-semibold shrink-0`} style={{ backgroundColor: '#f3e8ff', color: '#a200ee' }}>
      {initials || <Icons.Building2 className="h-1/2 w-1/2" />}
    </div>
  )
}

// ── Edit Client Modal (detail page) ──────────────────────────────────────────

function EditClientModal({ client, onClose, onUpdate }: {
  client: Client
  onClose: () => void
  onUpdate: (updated: Partial<Client>) => void
}) {
  const [name, setName] = useState(client.name)
  const [industry, setIndustry] = useState(client.industry ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), industry: industry.trim() || null }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to update client')
      }
      const { data } = await res.json()

      let logoUrl = client.logoUrl
      if (logoFile) {
        const form = new FormData()
        form.append('file', logoFile)
        await apiFetch(`/api/v1/clients/${client.id}/logo`, { method: 'POST', body: form })
        logoUrl = `/api/v1/clients/${client.id}/logo?t=${Date.now()}`
      }

      onUpdate({ ...data, logoUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[440px] rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between rounded-t-xl px-5 py-4" style={{ backgroundColor: '#a200ee' }}>
          <h2 className="text-sm font-semibold text-white">Edit Client</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <ClientLogoAvatar logoUrl={logoPreview ?? client.logoUrl} name={name || client.name} size="lg" />
            <label className="cursor-pointer">
              <span className="text-xs font-medium text-purple-600 hover:underline">
                {(logoPreview ?? client.logoUrl) ? 'Change logo' : 'Upload logo'}
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">PNG, JPG, SVG, WebP</p>
              <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg" className="hidden" onChange={handleLogoChange} />
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Client Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Industry</Label>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. SaaS, Healthcare, Finance" className="h-8 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
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
            <Icons.CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold">Portal Invite Generated</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-muted/40 p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Contact</p>
            <p className="text-sm font-medium">{data.stakeholder.name}</p>
            <p className="text-xs text-muted-foreground">{data.stakeholder.email}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Portal Link (valid 30 days)</Label>
            <div className="flex gap-2">
              <Input value={data.portalUrl} readOnly className="h-8 text-xs font-mono" />
              <Button variant="outline" size="sm" onClick={copy} className="h-8 shrink-0 text-xs">
                {copied ? <Icons.Check className="h-3.5 w-3.5 text-emerald-600" /> : <Icons.Copy className="h-3.5 w-3.5" />}
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

function OverviewReviewsCard({ clientId, onTabChange }: { clientId: string; onTabChange: (tab: Tab) => void }) {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ReviewRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/v1/runs?clientId=${clientId}&status=completed&limit=5`)
      .then((r) => r.json())
      .then(({ data }) => { setRuns(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId])

  const pendingCount = runs.filter((r) => r.reviewStatus === 'none' || r.reviewStatus === 'pending').length

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Icons.ClipboardEdit className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Recent Reviews</span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {pendingCount} pending
            </span>
          )}
        </div>
        <button
          onClick={() => onTabChange('reviews')}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No completed runs to review yet.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {runs.map((r) => {
            const rsCfg = REVIEW_STATUS_CONFIG[r.reviewStatus] ?? REVIEW_STATUS_CONFIG.none
            const title = [r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' — ')
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/review/${r.id}`)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rsCfg.dot}`} />
                <span className="flex-1 min-w-0 text-xs text-foreground/80 truncate">{title}</span>
                <span className={`shrink-0 text-[11px] font-medium ${rsCfg.color}`}>{rsCfg.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Module-level timestamp helper ─────────────────────────────────────────────

function relTimestamp(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

// ── Brain Entries card ─────────────────────────────────────────────────────────

type BrainFeedItem =
  | { kind: 'brain'; id: string; filename: string; source: string; sourceLabel: string; summary: string | null; createdAt: string }
  | { kind: 'research'; id: string; label: string; taskType: string; summary: string | null; runAt: string }

const BRAIN_ENTRY_SOURCE_COLORS: Record<string, string> = {
  client:        'bg-blue-100 text-blue-700',
  campaign:      'bg-purple-100 text-purple-700',
  gtm_framework: 'bg-green-100 text-green-700',
  demand_gen:    'bg-orange-100 text-orange-700',
  branding:      'bg-pink-100 text-pink-700',
}

const RESEARCH_TYPE_LABELS: Record<string, string> = {
  web_scrape:      'Web Scrape',
  review_miner:    'Review Miner',
  audience_signal: 'Audience Signal',
  seo_intent:      'SEO Intent',
}

function BrainEntriesCard({ clientId, onTabChange }: { clientId: string; onTabChange: (tab: Tab) => void }) {
  const [items, setItems] = useState<BrainFeedItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [brainRes, tasksRes] = await Promise.all([
        apiFetch(`/api/v1/clients/${clientId}/brain/all`),
        apiFetch(`/api/v1/scheduled-tasks?clientId=${clientId}`),
      ])
      const { data: brainData } = await brainRes.json()
      const { data: tasksData } = await tasksRes.json()

      const brainItems: BrainFeedItem[] = (brainData ?? []).map((d: any) => ({
        kind: 'brain' as const,
        id: `${d.table}-${d.id}`,
        filename: d.filename,
        source: d.source,
        sourceLabel: d.sourceLabel,
        summary: d.summary,
        createdAt: d.createdAt,
      }))

      const researchItems: BrainFeedItem[] = (tasksData ?? [])
        .filter((t: any) => t.changeDetected)
        .map((t: any) => ({
          kind: 'research' as const,
          id: t.id,
          label: t.label,
          taskType: t.type,
          summary: t.lastChangeSummary,
          runAt: t.lastRunAt ?? new Date().toISOString(),
        }))

      const all = [...brainItems, ...researchItems].sort((a, b) => {
        const ta = new Date(a.kind === 'brain' ? a.createdAt : a.runAt).getTime()
        const tb = new Date(b.kind === 'brain' ? b.createdAt : b.runAt).getTime()
        return tb - ta
      })
      setItems(all)
    } catch (_) {
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const dismiss = async (id: string) => {
    await apiFetch(`/api/v1/scheduled-tasks/${id}/dismiss`, { method: 'POST' }).catch(() => {})
    setItems((prev) => prev.filter((i) => !(i.kind === 'research' && i.id === id)))
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <Icons.Brain className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Brain Entries</span>
        </div>
        <button
          onClick={() => onTabChange('brain')}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No brain entries yet.</p>
      ) : (
        <div className="divide-y divide-border/40 overflow-y-auto">
          {items.map((item) =>
            item.kind === 'brain' ? (
              <div key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <Icons.FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-foreground/80 truncate">{item.filename}</span>
                    <span className={cn(
                      'shrink-0 inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide',
                      BRAIN_ENTRY_SOURCE_COLORS[item.source] ?? 'bg-muted text-muted-foreground'
                    )}>
                      {item.sourceLabel}
                    </span>
                  </div>
                  {item.summary && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{item.summary}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/60 ml-1">{relTimestamp(item.createdAt)}</span>
              </div>
            ) : (
              <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 bg-amber-500/5">
                <Icons.Bell className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {RESEARCH_TYPE_LABELS[item.taskType] ?? item.taskType}
                    {' — '}{item.label}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{item.summary}</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2 ml-1">
                  <span className="text-[10px] text-muted-foreground/60">{relTimestamp(item.runAt)}</span>
                  <button onClick={() => dismiss(item.id)} className="text-xs text-muted-foreground hover:text-foreground leading-none">×</button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

function OverviewTab({ client, onTabChange }: { client: Client; onTabChange: (tab: Tab) => void; onUpdate: (updated: Partial<Client>) => void }) {
  const { isAdmin, loading: roleLoading } = useCurrentUser()

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Icons.Users, value: client._count.stakeholders, label: 'Contacts', tab: 'stakeholders' as Tab },
          { icon: Icons.Workflow, value: client._count.workflows, label: 'Workflows', tab: 'workflows' as Tab },
          { icon: Icons.Lightbulb, value: client.insights.length, label: 'Active Insights', tab: 'insights' as Tab },
          { icon: Icons.BarChart2, value: 'Usage', label: 'View Usage', tab: 'reports' as Tab },
        ].map(({ icon: Icon, value, label, tab }) => (
          <button
            key={label}
            onClick={() => onTabChange(tab)}
            className="rounded-xl border border-border bg-card p-4 text-left hover:border-blue-500/50 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-lg font-semibold group-hover:text-blue-600 transition-colors">{value}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <OverviewReviewsCard clientId={client.id} onTabChange={onTabChange} />
        <BrainEntriesCard clientId={client.id} onTabChange={onTabChange} />
      </div>
    </div>
  )
}

function ScheduledTaskAlerts({ clientId }: { clientId: string }) {
  const [alerts, setAlerts] = useState<Array<{ id: string; label: string; lastChangeSummary: string | null; type: string }>>([])

  useEffect(() => {
    apiFetch(`/api/v1/scheduled-tasks?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setAlerts((data ?? []).filter((t: { changeDetected: boolean }) => t.changeDetected))
      })
      .catch(() => {})
  }, [clientId])

  const dismiss = async (id: string) => {
    await apiFetch(`/api/v1/scheduled-tasks/${id}/dismiss`, { method: 'POST' }).catch(() => {})
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  if (alerts.length === 0) return null

  const typeLabel: Record<string, string> = {
    web_scrape: 'Web Scrape', review_miner: 'Review Miner',
    audience_signal: 'Audience Signal', seo_intent: 'SEO Intent',
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Icons.Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">
              Research update · <span className="text-muted-foreground">{typeLabel[alert.type] ?? alert.type}</span>
              {' — '}{alert.label}
            </p>
            {alert.lastChangeSummary && (
              <p className="mt-0.5 text-xs text-muted-foreground">{alert.lastChangeSummary}</p>
            )}
          </div>
          <button
            onClick={() => dismiss(alert.id)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}

function StakeholdersTab({ client, onUpdate }: { client: Client; onUpdate: (updated: Client) => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Stakeholder | null>(null)
  const [moving, setMoving] = useState<Stakeholder | null>(null)
  const [inviteResult, setInviteResult] = useState<null | { portalUrl: string; expiresAt: string; stakeholder: { name: string; email: string } }>(null)
  const [sendingInvite, setSendingInvite] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const activeStakeholders = client.stakeholders.filter((s) => !s.archivedAt)
  const archivedStakeholders = client.stakeholders.filter((s) => !!s.archivedAt)

  const sendInvite = async (stakeholder: Stakeholder) => {
    setSendingInvite(stakeholder.id)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}/stakeholders/${stakeholder.id}/send-invite`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      setInviteResult(json.data)
    } catch (err) {
      alert(`Invite failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingInvite(null)
    }
  }

  const deleteStakeholder = async (id: string) => {
    if (!confirm('Remove this contact? Their feedback history will be preserved.')) return
    setDeleting(id)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}/stakeholders/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Failed to remove contact: ${body.error ?? res.status}`)
        return
      }
      onUpdate({ ...client, stakeholders: client.stakeholders.filter((s) => s.id !== id) })
    } catch (err) {
      console.error(err)
      alert('Failed to remove contact. Please try again.')
    } finally {
      setDeleting(null)
    }
  }

  const archiveToggle = async (s: Stakeholder) => {
    setArchiving(s.id)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}/stakeholders/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !s.archivedAt }),
      })
      if (!res.ok) throw new Error('Failed')
      const { data } = await res.json()
      onUpdate({
        ...client,
        stakeholders: client.stakeholders.map((st) => (st.id === s.id ? { ...st, archivedAt: data.archivedAt } : st)),
      })
      if (!s.archivedAt) setShowArchived(true)
    } catch (err) {
      console.error(err)
    } finally {
      setArchiving(null)
    }
  }

  const hasPortalAccess = (s: Stakeholder) =>
    s.magicLinkToken && s.magicLinkExpiresAt && new Date(s.magicLinkExpiresAt) > new Date()

  const StakeholderRow = ({ s }: { s: Stakeholder }) => (
    <div
      key={s.id}
      className={cn('flex items-center gap-4 rounded-xl border border-border bg-card p-4', s.archivedAt && 'opacity-60')}
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
          {s.source === 'deliverable_share' && !s.archivedAt && (
            <span className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: '#e0c0ff', backgroundColor: '#fdf5ff', color: '#7a00b4' }}>
              <Icons.Share2 className="h-2.5 w-2.5" />
              external
            </span>
          )}
          {s.archivedAt && (
            <span className="text-[10px] text-amber-500/80">archived</span>
          )}
          {hasPortalAccess(s) && !s.archivedAt && (
            <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">
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
        {!s.archivedAt && (
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
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(s)}
          title="Edit"
        >
          <Icons.Pencil className="h-3 w-3" />
        </Button>
        {!s.archivedAt && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-600"
            onClick={() => setMoving(s)}
            title="Move to different client"
          >
            <Icons.ArrowRightLeft className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-600"
          onClick={() => archiveToggle(s)}
          disabled={archiving === s.id}
          title={s.archivedAt ? 'Unarchive contact' : 'Archive contact'}
        >
          {archiving === s.id
            ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
            : s.archivedAt
              ? <Icons.ArchiveRestore className="h-3 w-3" />
              : <Icons.Archive className="h-3 w-3" />
          }
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
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
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{activeStakeholders.length} contacts</p>
        <Button size="sm" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
          <Icons.UserPlus className="mr-1.5 h-3 w-3" />
          Add Contact
        </Button>
      </div>

      {activeStakeholders.length === 0 && archivedStakeholders.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Icons.Users className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No contacts yet</p>
          <Button size="sm" className="mt-3 h-7 text-xs" onClick={() => setShowAdd(true)}>
            <Icons.UserPlus className="mr-1.5 h-3 w-3" />
            Add first contact
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {activeStakeholders.map((s) => <StakeholderRow key={s.id} s={s} />)}
        </div>
      )}

      {/* Archived contacts */}
      {archivedStakeholders.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <Icons.Archive className="h-3.5 w-3.5" />
            <span>Archived contacts ({archivedStakeholders.length})</span>
            <Icons.ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showArchived && 'rotate-180')} />
          </button>
          {showArchived && (
            <div className="space-y-2">
              {archivedStakeholders.map((s) => <StakeholderRow key={s.id} s={s} />)}
            </div>
          )}
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
              stakeholders: client.stakeholders.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
            })
            setEditing(null)
          }}
        />
      )}

      {moving && (
        <MoveStakeholderModal
          stakeholder={moving}
          currentClientId={client.id}
          onClose={() => setMoving(null)}
          onMoved={(action) => {
            if (action === 'moved') {
              // Remove from this client's list — they're at the new client now
              onUpdate({ ...client, stakeholders: client.stakeholders.filter((s) => s.id !== moving.id) })
            }
            // Copy: contact stays here, a new one was created at the target — nothing to change locally
            setMoving(null)
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/v1/workflows/${id}`, { method: 'DELETE' })
      if (res.ok) {
        onUpdate({ ...client, workflows: client.workflows.filter((w) => w.id !== id) })
      }
    } catch { /* ignore */ } finally {
      setDeleting(false)
      setConfirmDeleteId(null)
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    draft:    'text-slate-500 bg-slate-100 border-slate-200',
    active:   'text-emerald-600 bg-emerald-50 border-emerald-200',
    archived: 'text-slate-400 bg-slate-50 border-slate-200',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{client.workflows.length} workflows</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/workflows/new?clientId=${client.id}`)}>
            <Icons.Plus className="mr-1.5 h-3 w-3" />
            New
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => setShowAssign(true)}>
            <Icons.Link className="mr-1.5 h-3 w-3" />
            Assign
          </Button>
        </div>
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
              className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left hover:border-blue-500/50 transition-colors group"
            >
              <Icons.Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/workflows/${wf.id}`)}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate group-hover:text-blue-600">{wf.name}</p>
                  <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[wf.status])}>
                    {wf.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">{wf.connectivityMode}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {wf._count?.runs ?? 0} runs · Updated {new Date(wf.updatedAt).toLocaleDateString()}
                </p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <Icons.ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(wf.id) }}
                  className="ml-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50/60 transition-colors"
                  title="Delete workflow"
                >
                  <Icons.Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
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

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-96 rounded-xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border px-5 py-4 flex items-center gap-2">
              <Icons.Trash2 className="h-4 w-4 text-red-600" />
              <h2 className="text-sm font-semibold">Delete Workflow</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete <span className="font-medium text-foreground">
                  {client.workflows.find((w) => w.id === confirmDeleteId)?.name ?? 'this workflow'}
                </span>? This will also delete all associated runs and cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleDelete(confirmDeleteId)} disabled={deleting}>
                {deleting && <Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InsightsTab({ insights }: { insights: Insight[] }) {
  const TYPE_COLORS: Record<string, string> = {
    tone:           'text-purple-600 bg-purple-50 border-purple-200',
    forbidden_term: 'text-red-600 bg-red-50 border-red-200',
    structure:      'text-blue-600 bg-blue-50 border-blue-200',
    length:         'text-amber-600 bg-amber-50 border-amber-200',
    claims:         'text-emerald-600 bg-emerald-50 border-emerald-200',
  }

  const STATUS_COLORS: Record<string, string> = {
    pending:   'text-amber-600',
    applied:   'text-blue-600',
    confirmed: 'text-emerald-600',
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
              <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize', TYPE_COLORS[insight.type] ?? 'text-slate-600 bg-slate-100 border-slate-200')}>
                {insight.type.replace('_', ' ')}
              </span>
              {insight.isCollective && (
                <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
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

// ── Reviews Tab ───────────────────────────────────────────────────────────────

interface ReviewRun {
  id: string
  workflowName: string
  projectName: string | null
  itemName: string | null
  clientName: string | null
  status: string
  reviewStatus: string
  reviewerIds: string[]
  completedAt: string | null
  createdAt: string
  assignee: { id: string; name: string | null } | null
}

const REVIEW_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  none:             { label: 'Not reviewed',    color: 'text-slate-400',    dot: 'bg-slate-600' },
  pending:          { label: 'Agency reviewed', color: 'text-blue-600',     dot: 'bg-blue-500' },
  sent_to_client:   { label: 'Sent to client',  color: 'text-purple-600',   dot: 'bg-purple-500' },
  client_responded: { label: 'Client responded',color: 'text-emerald-600',  dot: 'bg-emerald-500' },
  closed:           { label: 'Closed',          color: 'text-slate-500',    dot: 'bg-slate-700' },
}

function ReviewsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<ReviewRun[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    apiFetch(`/api/v1/runs?clientId=${clientId}&status=completed&limit=100`)
      .then((r) => r.json())
      .then(({ data }) => { setRuns(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId])

  const filtered = filter === 'all' ? runs : runs.filter((r) => r.reviewStatus === filter)

  const reviewName = (r: ReviewRun) =>
    [clientName, r.projectName, r.workflowName, r.itemName].filter(Boolean).join(' — ')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(['all', 'none', 'pending', 'sent_to_client', 'client_responded', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === f ? 'bg-blue-600 text-white' : 'bg-muted/40 text-muted-foreground hover:bg-muted/60',
            )}
          >
            {f === 'all' ? 'All' : (REVIEW_STATUS_CONFIG[f]?.label ?? f)}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} review{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Icons.ClipboardEdit className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {filter === 'all' ? 'No completed runs to review yet.' : `No reviews with status "${filter}".`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Review</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-36">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-32">Assignee</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-32">Completed</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const rsCfg = REVIEW_STATUS_CONFIG[r.reviewStatus] ?? REVIEW_STATUS_CONFIG.none
                return (
                  <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground/90 truncate max-w-xs">{reviewName(r)}</p>
                      <p className="text-muted-foreground/60 text-[11px] font-mono">{r.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5', rsCfg.color)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', rsCfg.dot)} />
                        {rsCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {r.assignee?.name ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.completedAt
                        ? new Date(r.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={r.reviewStatus === 'none' ? 'default' : 'outline'}
                        className="h-7 text-xs gap-1.5"
                        onClick={() => navigate(`/review/${r.id}`)}
                      >
                        <Icons.ClipboardEdit className="h-3 w-3" />
                        {r.reviewStatus === 'none' ? 'Review' : 'View'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Runs Intelligence Tab ─────────────────────────────────────────────────────

interface RunIntelligence {
  id: string
  status: string
  createdAt: string
  completedAt: string | null
  contentHash: string | null
  sourceLabel: string | null
  workflow: { id: string; name: string } | null
  llms: { model: string; provider: string; tokens?: number }[]
  humanizers: { service: string; wordsBefore?: number; wordsAfter?: number }[]
  detections: { service: string; scoreBefore?: number; scoreAfter?: number }[]
  translations: { provider: string; targetLanguage: string; chars?: number }[]
  finalWordCount: number | null
  feedback: { decision: string; starRating: number | null; comment: string | null } | null
  writerExampleId: string | null
}

function ScoreBadge({ score }: { score: number }) {
  const color = score <= 20 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : score <= 50 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200'
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {score.toFixed(0)}%
    </span>
  )
}

function RunRow({ run, onUpload, onAssign, indent = false }: { run: RunIntelligence; onUpload: (id: string) => void; onAssign: (id: string) => void; indent?: boolean }) {
  return (
    <tr className={cn('hover:bg-muted/20 transition-colors', indent && 'bg-muted/10')}>
      <td className="px-4 py-3 text-muted-foreground">
        {indent && <span className="mr-1.5 text-muted-foreground/40">↳</span>}
        {new Date(run.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
      </td>
      <td className="px-4 py-3">
        <span className="font-medium break-words">{run.workflow?.name ?? '—'}</span>
      </td>
      <td className="px-4 py-3">
        {run.sourceLabel
          ? <span className="text-muted-foreground break-words">{run.sourceLabel}</span>
          : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3">
        {run.llms.length === 0 ? <span className="text-muted-foreground">—</span> : (
          <div className="flex flex-col gap-0.5">
            {run.llms.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-blue-600">
                <Icons.Zap className="h-3 w-3 shrink-0" />
                <span className="break-words">{l.model.replace('claude-', '').replace('gpt-', '')}</span>
                {l.tokens && <span className="text-muted-foreground">({(l.tokens/1000).toFixed(1)}k)</span>}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {run.humanizers.length === 0 ? <span className="text-muted-foreground">—</span> : (
          <div className="flex flex-col gap-0.5">
            {run.humanizers.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-purple-600">
                <Icons.Wand2 className="h-3 w-3 shrink-0" />
                <span>{h.service}</span>
                {h.wordsBefore && h.wordsAfter && (
                  <span className="text-muted-foreground">{h.wordsBefore}→{h.wordsAfter}w</span>
                )}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {run.detections.length === 0 ? <span className="text-muted-foreground">—</span> : (
          <div className="flex flex-col gap-0.5">
            {run.detections.map((d, i) => (
              <div key={i} className="flex items-center gap-1">
                {d.scoreBefore != null && <><ScoreBadge score={d.scoreBefore} /><Icons.ArrowRight className="h-3 w-3 text-muted-foreground" /></>}
                {d.scoreAfter != null && <ScoreBadge score={d.scoreAfter} />}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {run.translations.length === 0 ? <span className="text-muted-foreground">—</span> : (
          <div className="flex flex-col gap-0.5">
            {run.translations.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-cyan-400">
                <Icons.Languages className="h-3 w-3 shrink-0" />
                <span>{t.targetLanguage} · {t.provider}</span>
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{run.finalWordCount ?? '—'}</td>
      <td className="px-4 py-3">
        {!run.feedback ? <span className="text-muted-foreground">—</span> : (
          <div className="flex items-center gap-1">
            {run.feedback.starRating && <span className="text-amber-600">{run.feedback.starRating}★</span>}
            <span className={cn('capitalize text-[10px]',
              run.feedback.decision === 'approved' ? 'text-emerald-600' :
              run.feedback.decision === 'rejected' ? 'text-red-600' : 'text-amber-600'
            )}>{run.feedback.decision?.replace(/_/g, ' ')}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {run.writerExampleId ? (
          <div className="flex items-center gap-1.5">
            <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <button onClick={() => onUpload(run.id)} className="text-muted-foreground hover:text-foreground text-[10px]">replace</button>
          </div>
        ) : (
          <button
            onClick={() => onUpload(run.id)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] hover:border-blue-500/50 hover:text-blue-600 transition-colors"
          >
            <Icons.Upload className="h-3 w-3" />Upload
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onAssign(run.id)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] hover:border-violet-500/50 hover:text-violet-600 transition-colors"
        >
          <Icons.UserPlus className="h-3 w-3" />Assign
        </button>
      </td>
    </tr>
  )
}

function RunsTable({ runs, onUpload, onAssign }: { runs: RunIntelligence[]; onUpload: (id: string) => void; onAssign: (id: string) => void }) {
  // Group by contentHash — runs without a hash each get their own group
  const groups: RunIntelligence[][] = []
  const hashMap = new Map<string, RunIntelligence[]>()
  for (const run of runs) {
    if (!run.contentHash) {
      groups.push([run])
    } else {
      if (!hashMap.has(run.contentHash)) {
        hashMap.set(run.contentHash, [])
        groups.push(hashMap.get(run.contentHash)!)
      }
      hashMap.get(run.contentHash)!.push(run)
    }
  }

  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs table-fixed" style={{ minWidth: 900 }}>
        <colgroup>
          <col style={{ width: 80 }} />   {/* Date */}
          <col style={{ width: 140 }} />  {/* Workflow */}
          <col style={{ width: 180 }} />  {/* Source */}
          <col style={{ width: 120 }} />  {/* LLMs */}
          <col style={{ width: 110 }} />  {/* Humanizer */}
          <col style={{ width: 90 }} />   {/* Detection */}
          <col style={{ width: 90 }} />   {/* Translation */}
          <col style={{ width: 55 }} />   {/* Words */}
          <col style={{ width: 80 }} />   {/* Feedback */}
          <col style={{ width: 65 }} />   {/* Writer */}
          <col style={{ width: 60 }} />   {/* Assign */}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Workflow</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Source</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">LLMs</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Humanizer</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Detection</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Translation</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Words</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Feedback</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Writer</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Assign</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((group, gi) => (
            <>
              {group.length > 1 && (
                <tr key={`group-${gi}`} className="bg-muted/5 border-t-2 border-border">
                  <td colSpan={11} className="px-4 py-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Content group · {group.length} runs · {group[0].workflow?.name}
                    </span>
                  </td>
                </tr>
              )}
              {group.map((run, ri) => (
                <RunRow key={run.id} run={run} onUpload={onUpload} onAssign={onAssign} indent={group.length > 1 && ri > 0} />
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WriterUploadModal({ runId, clientId, onClose, onSaved }: {
  runId: string; clientId: string; onClose: () => void; onSaved: () => void
}) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wordCount = content.trim() ? content.trim().split(/\s+/).filter(Boolean).length : 0

  const handleSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/writer-examples`, {
        method: 'POST',
        body: JSON.stringify({ workflowRunId: runId, contentAfter: content }),
      })
      if (!res.ok) throw new Error('Failed to save')
      onSaved()
      onClose()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Upload Writer Version</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Paste the writer-polished content. This will be used to train cnHumanizer.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the writer-polished version here..."
            rows={14}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{wordCount > 0 ? `${wordCount} words` : ''}</span>
            {error && <span className="text-xs text-red-600">{error}</span>}
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving || !content.trim()}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save as Training Example'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssignWriterModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [writerEmail, setWriterEmail] = useState('')
  const [writerName, setWriterName] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleAssign = async () => {
    if (!writerEmail.trim()) return
    setAssigning(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}/writer/assign`, {
        method: 'POST',
        body: JSON.stringify({ writerEmail: writerEmail.trim(), writerName: writerName.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to assign.')
        return
      }
      const { data } = await res.json()
      setLink(data.link)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setAssigning(false)
    }
  }

  const handleCopy = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Assign to Writer</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Generate a magic link for a writer to polish this run's AI draft.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {!link ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Writer Email *</label>
                <input
                  type="email"
                  value={writerEmail}
                  onChange={(e) => setWriterEmail(e.target.value)}
                  placeholder="writer@example.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Writer Name (optional)</label>
                <input
                  type="text"
                  value={writerName}
                  onChange={(e) => setWriterName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
                <button
                  onClick={handleAssign}
                  disabled={assigning || !writerEmail.trim()}
                  className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {assigning ? 'Generating…' : 'Generate Link'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                Magic link generated! Share this link with the writer — it expires in 30 days.
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link}
                  className="flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-xs text-foreground select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted flex items-center gap-1"
                >
                  {copied ? <Icons.Check className="h-3 w-3 text-emerald-600" /> : <Icons.Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex justify-end">
                <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RunsIntelligenceTab({ clientId }: { clientId: string }) {
  const [runs, setRuns] = useState<RunIntelligence[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [uploadRunId, setUploadRunId] = useState<string | null>(null)
  const [assignRunId, setAssignRunId] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const fetchRuns = async (q = '') => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/run-intelligence?search=${encodeURIComponent(q)}&limit=50`)
      const { data, meta } = await res.json()
      setRuns(data ?? [])
      setTotal(meta?.total ?? 0)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { void fetchRuns() }, [clientId])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    void fetchRuns(e.target.value)
  }

  return (
    <div className="space-y-4">
      {uploadRunId && (
        <WriterUploadModal
          runId={uploadRunId}
          clientId={clientId}
          onClose={() => setUploadRunId(null)}
          onSaved={() => void fetchRuns(search)}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="relative w-64">
          <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={handleSearch}
            placeholder="Search workflows…"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <span className="text-xs text-muted-foreground">{total} runs</span>
      </div>

      {assignRunId && (
        <AssignWriterModal runId={assignRunId} onClose={() => setAssignRunId(null)} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No completed runs yet</p>
      ) : (
        <RunsTable runs={runs} onUpload={setUploadRunId} onAssign={setAssignRunId} />
      )}
    </div>
  )
}

// ── Access Tab ────────────────────────────────────────────────────────────────

interface AccessGrant {
  id: string
  stakeholder: { id: string; name: string; email: string; role: string | null }
  run: { id: string; status: string; workflowName: string; client: { id: string; name: string }; createdAt: string }
  status: 'active' | 'expired' | 'revoked'
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

function AccessStatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  const cfg = {
    active:  { bg: '#d0e8b0', border: '#3b6d11', color: '#3b6d11', label: 'Active' },
    expired: { bg: '#fef3c7', border: '#d97706', color: '#d97706', label: 'Expired' },
    revoked: { bg: '#fee2e2', border: '#dc2626', color: '#dc2626', label: 'Revoked' },
  }[status]
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

function GrantRunModal({ client, onClose, onGranted }: { client: Client; onClose: () => void; onGranted: () => void }) {
  const [runs, setRuns] = useState<{ id: string; workflowName: string; createdAt: string }[]>([])
  const [runId, setRunId] = useState('')
  const [step, setStep] = useState<'run' | 'contacts'>('run')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Contact selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adHoc, setAdHoc] = useState<{ name: string; email: string }[]>([])
  const [extName, setExtName] = useState('')
  const [extEmail, setExtEmail] = useState('')
  const [extError, setExtError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/api/v1/runs?clientId=${client.id}&status=completed&limit=50`)
      .then((r) => r.json())
      .then(({ data }) => setRuns(data ?? []))
      .catch(console.error)
  }, [client.id])

  const activeStakeholders = client.stakeholders.filter((s) => !s.archivedAt)
  const selectedRun = runs.find((r) => r.id === runId)
  const totalRecipients = selectedIds.size + adHoc.length

  function formatRunLabel(r: { workflowName: string; createdAt: string }) {
    const d = new Date(r.createdAt)
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return { name: r.workflowName, tag: `${date} · ${time}` }
  }

  function toggleContact(id: string) {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function addExternal() {
    const email = extEmail.trim().toLowerCase()
    const name  = extName.trim()
    if (!email) { setExtError('Email is required'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setExtError('Enter a valid email'); return }
    if (adHoc.some((c) => c.email === email)) { setExtError('Already added'); return }
    if (activeStakeholders.some((s) => s.email.toLowerCase() === email && selectedIds.has(s.id))) { setExtError('Already added as contact'); return }
    setAdHoc((prev) => [...prev, { name: name || email, email }])
    setExtName(''); setExtEmail(''); setExtError(null)
  }

  const handleGrant = async () => {
    if (!runId || totalRecipients === 0) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}/send-review`, {
        method: 'POST',
        body: JSON.stringify({
          stakeholderIds: Array.from(selectedIds),
          newContacts: adHoc,
        }),
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

  const STEPS = ['run', 'contacts'] as const
  const STEP_LABELS = { run: 'Select output', contacts: 'Send to' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-h-[85vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="rounded-t-xl px-6 py-5 flex items-center justify-between" style={{ backgroundColor: '#a200ee' }}>
          <div>
            <div className="flex items-center gap-2">
              <Icons.ShieldCheck className="h-5 w-5 text-white/80" />
              <h2 className="text-base font-semibold text-white">Share Deliverable</h2>
            </div>
            <p className="mt-1 text-sm text-white/70">
              {step === 'run'
                ? `${client.name} — choose a completed output to share`
                : selectedRun ? `${formatRunLabel(selectedRun).name} · ${formatRunLabel(selectedRun).tag}` : ''}
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
                onClick={() => { if (s === 'run' && idx >= 1) { setStep('run'); setRunId(''); setSelectedIds(new Set()); setAdHoc([]) } }}
                className={`flex items-center gap-1.5 px-0 pb-2.5 mr-6 text-[12px] font-medium border-b-2 transition-colors ${
                  active ? 'border-[#a200ee] text-[#a200ee]' :
                  done   ? 'border-transparent text-[#5c5b52] hover:text-[#a200ee]' :
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
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">

          {/* Step 1 — pick run */}
          {step === 'run' && (
            runs.length === 0
              ? (
                <div className="flex flex-col items-center py-8 gap-2 text-center">
                  <Icons.Play className="h-7 w-7 text-[#dddcd6]" />
                  <p className="text-[12px] text-[#b4b2a9]">No completed outputs for this client yet</p>
                </div>
              )
              : runs.map((r) => {
                  const { name, tag } = formatRunLabel(r)
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setRunId(r.id); setStep('contacts') }}
                      className="w-full flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-purple-400 hover:bg-purple-50/60 transition-colors"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff' }}>
                        <Icons.FileText className="h-4 w-4" style={{ color: '#a200ee' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground">{tag}</p>
                      </div>
                      <Icons.ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    </button>
                  )
                })
          )}

          {/* Step 2 — pick contacts */}
          {step === 'contacts' && (
            <>
              {/* Existing contacts */}
              {activeStakeholders.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">Client contacts</p>
                  {activeStakeholders.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleContact(s.id)}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        selectedIds.has(s.id) ? 'border-purple-400 bg-purple-50' : 'border-border bg-background hover:border-purple-400 hover:bg-purple-50/60',
                      )}
                    >
                      <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ backgroundColor: '#f5e6ff', color: '#a200ee' }}>
                        {s.name[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                      </div>
                      {selectedIds.has(s.id) && <Icons.Check className="h-4 w-4 shrink-0" style={{ color: '#a200ee' }} />}
                    </button>
                  ))}
                </div>
              )}

              {/* External / ad-hoc contact */}
              <div className="space-y-2 pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">External contact</p>
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      placeholder="Name"
                      value={extName}
                      onChange={(e) => setExtName(e.target.value)}
                      className="h-8 flex-1 rounded-md border border-input bg-transparent px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      placeholder="Email address"
                      type="email"
                      value={extEmail}
                      onChange={(e) => { setExtEmail(e.target.value); setExtError(null) }}
                      onKeyDown={(e) => e.key === 'Enter' && addExternal()}
                      className="h-8 flex-[2] rounded-md border border-input bg-transparent px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={addExternal}
                      className="h-8 px-3 rounded-md text-xs font-medium text-white transition-colors hover:opacity-90"
                      style={{ backgroundColor: '#a200ee' }}
                    >
                      Add
                    </button>
                  </div>
                  {extError && <p className="text-[11px] text-red-600">{extError}</p>}
                </div>

                {/* Added ad-hoc contacts */}
                {adHoc.map((c) => (
                  <div key={c.email} className="flex items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ backgroundColor: '#f5e6ff', color: '#a200ee' }}>
                      {c.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>
                    </div>
                    <span className="text-[9px] font-semibold px-1.5 py-px rounded-full mr-1" style={{ backgroundColor: '#f5e6ff', color: '#7a00b4', border: '1px solid #e0c0ff' }}>external</span>
                    <button onClick={() => setAdHoc((prev) => prev.filter((x) => x.email !== c.email))} className="text-muted-foreground hover:text-destructive">
                      <Icons.X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'contacts' && (
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <p className="text-[12px] text-muted-foreground">
              {totalRecipients === 0 ? 'Select at least one recipient' : `${totalRecipients} recipient${totalRecipients !== 1 ? 's' : ''} · portal link will be emailed`}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-[#5c5b52] hover:bg-accent transition-colors">
                Cancel
              </button>
              <button
                onClick={handleGrant}
                disabled={totalRecipients === 0 || saving}
                className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors disabled:opacity-60 hover:opacity-90"
                style={{ backgroundColor: '#a200ee' }}
              >
                {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Share Access
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AccessTab({ client }: { client: Client }) {
  const { isLead } = useCurrentUser()
  const [grants, setGrants]     = useState<AccessGrant[]>([])
  const [loading, setLoading]   = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [showGrant, setShowGrant] = useState(false)
  const [filter, setFilter]     = useState<'active' | 'all'>('active')
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [copiedId, setCopied]   = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000) }

  const loadGrants = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/access')
      const json = await res.json()
      if (res.ok) {
        // Filter to this client's grants only
        setGrants((json.data ?? []).filter((g: AccessGrant) => g.run.client.id === client.id))
      }
    } finally {
      setLoading(false)
    }
  }, [client.id])

  useEffect(() => { loadGrants() }, [loadGrants])

  const filtered = filter === 'active' ? grants.filter((g) => g.status === 'active') : grants

  async function handleRevoke(grantId: string) {
    if (!confirm('Revoke access? The contact will lose portal access immediately.')) return
    setActionId(grantId)
    try {
      const res = await apiFetch(`/api/v1/access/grants/${grantId}/revoke`, { method: 'POST' })
      if (!res.ok) { const j = await res.json(); showToast(j.error ?? 'Failed to revoke', false); return }
      setGrants((prev) => prev.map((g) => g.id === grantId ? { ...g, status: 'revoked' as const, revokedAt: new Date().toISOString() } : g))
      showToast('Access revoked')
    } finally {
      setActionId(null)
    }
  }

  async function handleResend(grantId: string) {
    setActionId(grantId)
    try {
      const res = await apiFetch(`/api/v1/access/grants/${grantId}/resend`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { showToast(json.error ?? 'Failed to resend', false); return }
      if (json.portalUrl) {
        navigator.clipboard.writeText(json.portalUrl)
        setCopied(grantId)
        setTimeout(() => setCopied(null), 2500)
        showToast('Link resent & copied to clipboard')
      } else {
        showToast('Portal link resent')
      }
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {(['active', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  filter === f ? 'bg-blue-600 text-white shadow-sm' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {f === 'active' ? 'Active' : 'All'}{' '}
                <span className={f === filter ? 'text-white/70' : 'text-muted-foreground/60'}>
                  ({f === 'active' ? grants.filter((g) => g.status === 'active').length : grants.length})
                </span>
              </button>
            ))}
          </div>
        </div>
        {isLead && (
          <Button size="sm" className="h-7 text-xs" onClick={() => setShowGrant(true)}>
            <Icons.UserPlus className="mr-1.5 h-3 w-3" />
            Grant Access
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Icons.ShieldOff className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {grants.length === 0 ? 'No access grants yet for this client.' : 'No active grants.'}
          </p>
          {isLead && grants.length === 0 && (
            <Button size="sm" className="mt-3 h-7 text-xs" onClick={() => setShowGrant(true)}>
              <Icons.UserPlus className="mr-1.5 h-3 w-3" />
              Grant first access
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Deliverable</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-28">Expires</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const busy = actionId === g.id
                return (
                  <tr key={g.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold shrink-0">
                          {g.stakeholder.name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-foreground/90">{g.stakeholder.name}</p>
                          <p className="text-muted-foreground/60">{g.stakeholder.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground/90 truncate max-w-[180px]">{g.run.workflowName}</p>
                      <p className="text-muted-foreground/60">
                        {new Date(g.run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </p>
                    </td>
                    <td className="px-4 py-3"><AccessStatusBadge status={g.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {g.revokedAt
                        ? <span className="text-red-500 text-[11px]">Revoked</span>
                        : g.expiresAt
                          ? new Date(g.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                          : '—'
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {g.status === 'active' && isLead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-600"
                            disabled={busy}
                            onClick={() => handleResend(g.id)}
                            title={copiedId === g.id ? 'Copied!' : 'Resend portal link'}
                          >
                            {busy ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : copiedId === g.id ? <Icons.Check className="h-3 w-3 text-emerald-600" /> : <Icons.Mail className="h-3 w-3" />}
                          </Button>
                        )}
                        {g.status !== 'revoked' && isLead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                            disabled={busy}
                            onClick={() => handleRevoke(g.id)}
                            title="Revoke access"
                          >
                            {busy ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.ShieldX className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg ${
          toast.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {toast.msg}
        </div>
      )}

      {showGrant && (
        <GrantRunModal
          client={client}
          onClose={() => setShowGrant(false)}
          onGranted={() => {
            setShowGrant(false)
            loadGrants()
            showToast('Access granted')
          }}
        />
      )}
    </div>
  )
}

// ── Client Library Tab ────────────────────────────────────────────────────────

interface ClientFile {
  id: string
  originalName: string
  label: string | null
  category: string | null
  sizeBytes: number
  createdAt: string
}

const FILE_CATEGORIES = [
  { value: 'brand-guidelines',  label: 'Brand Guidelines' },
  { value: 'instructions',      label: 'Instructions' },
  { value: 'standards',         label: 'Standards' },
  { value: 'templates',         label: 'Templates' },
  { value: 'approved-examples', label: 'Approved Examples' },
  { value: 'legal',             label: 'Legal' },
  { value: 'other',             label: 'Other' },
]

function formatFileBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ClientPromptTemplate {
  id: string
  name: string
  body: string
  category: string
  description: string | null
  parentId: string | null
  useCount: number
  createdAt: string
}

const PROMPT_CATS = [
  { value: 'general', label: 'General' },
  { value: 'content', label: 'Content' },
  { value: 'seo',     label: 'SEO' },
  { value: 'social',  label: 'Social' },
  { value: 'email',   label: 'Email' },
  { value: 'other',   label: 'Other' },
]

function ClientPromptsSection({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<ClientPromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCategory, setEditCategory] = useState('general')
  const [savingEdit, setSavingEdit] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch(`/api/v1/prompts?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setTemplates(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [clientId])

  const startEdit = (t: ClientPromptTemplate) => {
    setEditingId(t.id); setEditName(t.name); setEditBody(t.body)
    setEditDesc(t.description ?? ''); setEditCategory(t.category)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSavingEdit(true)
    try {
      const res = await apiFetch(`/api/v1/prompts/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, body: editBody, description: editDesc || undefined, category: editCategory }),
      })
      if (res.ok) { setEditingId(null); load() }
    } finally { setSavingEdit(false) }
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this prompt template?')) return
    await apiFetch(`/api/v1/prompts/${id}`, { method: 'DELETE' })
    load()
  }

  const createTemplate = async () => {
    if (!newName.trim() || !newBody.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), body: newBody.trim(), description: newDesc.trim() || undefined, category: newCategory, clientId }),
      })
      if (res.ok) {
        setCreating(false); setNewName(''); setNewBody(''); setNewDesc(''); setNewCategory('general')
        load()
      }
    } finally { setSaving(false) }
  }

  const grouped = templates.reduce<Record<string, ClientPromptTemplate[]>>((acc, t) => {
    ;(acc[t.category] ??= []).push(t)
    return acc
  }, {})

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icons.ScrollText className="h-4 w-4" style={{ color: '#b4b2a9' }} />
          <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Prompt Templates</h2>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
          style={{ color: '#a200ee' }}
        >
          <Icons.Plus className="h-3.5 w-3.5" />New template
        </button>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Prompt templates specific to this client — tailored tone, voice guidelines, or topic-specific instructions.
      </p>

      {creating && (
        <div className="mb-4 rounded-xl p-4 space-y-3" style={{ backgroundColor: '#fff', border: '1px solid #a200ee' }}>
          <p className="text-[12px] font-semibold" style={{ color: '#7a00b4' }}>New Client Template</p>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Template name" className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400" style={{ borderColor: '#e8e7e1' }} />
          <div className="grid grid-cols-2 gap-2">
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-full rounded border px-2 py-1.5 text-xs bg-white outline-none" style={{ borderColor: '#e8e7e1' }}>
              {PROMPT_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" className="w-full rounded border px-2.5 py-1.5 text-xs outline-none" style={{ borderColor: '#e8e7e1' }} />
          </div>
          <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Instructions body…" rows={5} className="w-full rounded border px-2.5 py-1.5 text-xs font-mono outline-none resize-y" style={{ borderColor: '#e8e7e1' }} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
            <button onClick={createTemplate} disabled={saving || !newName.trim() || !newBody.trim()} className="px-3 py-1.5 text-xs font-semibold rounded text-white disabled:opacity-50" style={{ backgroundColor: '#a200ee' }}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e7e1' }}>
        {loading ? (
          <div className="flex justify-center py-8"><Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} /></div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center px-6">
            <Icons.ScrollText className="h-8 w-8" style={{ color: '#e0dfd8' }} />
            <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No client templates yet</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([cat, catTemplates], gi) => (
              <div key={cat}>
                {gi > 0 && <div style={{ borderTop: '1px solid #e8e7e1' }} />}
                <div className="px-4 py-2" style={{ backgroundColor: '#fafaf8' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>
                    {PROMPT_CATS.find((c) => c.value === cat)?.label ?? cat}
                  </p>
                </div>
                {catTemplates.map((t, ti) => (
                  <div key={t.id}>
                    {ti > 0 && <div style={{ borderTop: '1px solid #f0efea' }} />}
                    <div className="px-4 py-3 bg-white">
                      {editingId === t.id ? (
                        <div className="space-y-2">
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded border px-2 py-1 text-xs font-semibold outline-none" style={{ borderColor: '#e8e7e1' }} />
                          <div className="grid grid-cols-2 gap-2">
                            <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="w-full rounded border px-2 py-1 text-xs bg-white outline-none" style={{ borderColor: '#e8e7e1' }}>
                              {PROMPT_CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" className="w-full rounded border px-2 py-1 text-xs outline-none" style={{ borderColor: '#e8e7e1' }} />
                          </div>
                          <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} className="w-full rounded border px-2 py-1 text-xs font-mono outline-none resize-y" style={{ borderColor: '#e8e7e1' }} />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="px-2.5 py-1 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
                            <button onClick={saveEdit} disabled={savingEdit} className="px-2.5 py-1 text-xs font-semibold rounded text-white disabled:opacity-50" style={{ backgroundColor: '#a200ee' }}>{savingEdit ? 'Saving…' : 'Save'}</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <button className="flex items-center gap-1 text-left" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                              <Icons.ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform" style={{ color: '#b4b2a9', transform: expandedId === t.id ? 'rotate(90deg)' : 'none' }} />
                              <span className="text-[13px] font-medium" style={{ color: '#1a1a14' }}>{t.name}</span>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => startEdit(t)} className="rounded p-1 hover:bg-gray-100"><Icons.Pencil className="h-3.5 w-3.5" style={{ color: '#b4b2a9' }} /></button>
                              <button onClick={() => deleteTemplate(t.id)} className="rounded p-1 hover:bg-red-50"><Icons.Trash2 className="h-3.5 w-3.5" style={{ color: '#f87171' }} /></button>
                            </div>
                          </div>
                          {t.description && <p className="text-[11px] mt-0.5 ml-5" style={{ color: '#b4b2a9' }}>{t.description}</p>}
                          {expandedId === t.id && (
                            <pre className="mt-2 ml-5 whitespace-pre-wrap rounded bg-gray-50 px-3 py-2 text-[11px] font-mono leading-relaxed" style={{ color: '#3a3a2e', border: '1px solid #e8e7e1' }}>{t.body}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ClientLibraryTab({ clientId }: { clientId: string }) {
  const [files, setFiles] = useState<ClientFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch(`/api/v1/clients/${clientId}/library`)
      .then((r) => r.json())
      .then(({ data }) => setFiles(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [clientId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('label', file.name.replace(/\.[^/.]+$/, ''))
      const res = await apiFetch(`/api/v1/clients/${clientId}/library`, { method: 'POST', body: fd })
      if (res.ok) load()
    } finally {
      setUploading(false)
    }
  }

  const startEdit = (f: ClientFile) => {
    setEditingId(f.id)
    setEditLabel(f.label ?? '')
    setEditCategory(f.category ?? 'other')
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSavingEdit(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/library/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel, category: editCategory }),
      })
      if (res.ok) { setEditingId(null); load() }
    } finally { setSavingEdit(false) }
  }

  const deleteFile = async (id: string) => {
    if (!confirm('Delete this file from the client library?')) return
    await apiFetch(`/api/v1/clients/${clientId}/library/${id}`, { method: 'DELETE' })
    load()
  }

  const grouped = files.reduce<Record<string, ClientFile[]>>((acc, f) => {
    ;(acc[f.category ?? 'other'] ??= []).push(f)
    return acc
  }, {})

  return (
    <div className="p-6" style={{ maxWidth: 640 }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Client Library</h2>
          <p className="text-[13px] mt-0.5" style={{ color: '#b4b2a9' }}>
            Files specific to this client — brand guidelines, approved examples, tone references.
          </p>
        </div>
        <label
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold text-white cursor-pointer hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#a200ee' }}
        >
          {uploading
            ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading…</>
            : <><Icons.Upload className="h-3.5 w-3.5" />Upload file</>
          }
          <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.html" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e7e1' }}>
        {loading ? (
          <div className="flex justify-center py-10">
            <Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center px-6">
            <Icons.Library className="h-8 w-8" style={{ color: '#e0dfd8' }} />
            <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No files yet</p>
            <p className="text-[12px]" style={{ color: '#c8c7c0' }}>Upload client-specific files above.</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([cat, catFiles], gi) => (
              <div key={cat}>
                {gi > 0 && <div style={{ borderTop: '1px solid #e8e7e1' }} />}
                <div className="px-4 py-2" style={{ backgroundColor: '#fafaf8' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>
                    {FILE_CATEGORIES.find((c) => c.value === cat)?.label ?? cat}
                  </p>
                </div>
                {catFiles.map((f, fi) => (
                  <div key={f.id}>
                    {fi > 0 && <div style={{ borderTop: '1px solid #f0efea' }} />}
                    <div className="px-4 py-3 bg-white">
                      {editingId === f.id ? (
                        <div className="space-y-2">
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-purple-400"
                            style={{ borderColor: '#e8e7e1' }}
                            placeholder="Label"
                          />
                          <div className="flex items-center gap-2">
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="flex-1 rounded border px-2 py-1 text-xs outline-none focus:border-purple-400 bg-white"
                              style={{ borderColor: '#e8e7e1' }}
                            >
                              {FILE_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                            <button
                              onClick={saveEdit}
                              disabled={savingEdit}
                              className="px-2.5 py-1 text-xs font-semibold rounded text-white disabled:opacity-50"
                              style={{ backgroundColor: '#a200ee' }}
                            >
                              {savingEdit ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                              <Icons.X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <Icons.FileText className="h-4 w-4 shrink-0" style={{ color: '#b4b2a9' }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium truncate" style={{ color: '#1a1a14' }}>{f.label ?? f.originalName}</p>
                            {f.label && <p className="text-[11px] truncate" style={{ color: '#b4b2a9' }}>{f.originalName}</p>}
                          </div>
                          <span className="text-[11px] shrink-0" style={{ color: '#b4b2a9' }}>{formatFileBytes(f.sizeBytes)}</span>
                          <button onClick={() => startEdit(f)} className="rounded p-1 hover:bg-gray-100" title="Edit">
                            <Icons.Pencil className="h-3.5 w-3.5" style={{ color: '#b4b2a9' }} />
                          </button>
                          <button onClick={() => deleteFile(f.id)} className="rounded p-1 hover:bg-red-50" title="Delete">
                            <Icons.Trash2 className="h-3.5 w-3.5" style={{ color: '#f87171' }} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <ClientPromptsSection clientId={clientId} />
    </div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

interface ClientProfile {
  id: string
  label: string | null
  status: string
  brandTone: string | null
  formality: string | null
  pov: string | null
  signaturePhrases: string[]
  avoidPhrases: string[]
  primaryBuyer: { title?: string; age_range?: string; pain_points?: string[]; goals?: string[] }
  secondaryBuyer: { title?: string; age_range?: string; pain_points?: string[]; goals?: string[] }
  buyerMotivations: string[]
  buyerFears: string[]
  visualStyle: string | null
  colorTemperature: string | null
  photographyVsIllustration: string | null
  approvedVisualThemes: string[]
  avoidVisual: string[]
  currentPositioning: string | null
  campaignThemesApproved: string[]
  manualOverrides: Array<{ field: string; instruction: string; source: string; confidence: string; date: string; expires?: string | null }>
  confidenceMap: Record<string, string>
  crawledFrom: string | null
  crawledSnapshot: Record<string, unknown>
  sources: Array<{ url: string; label: string; addedAt?: string }>
  updatedAt: string
}

// Returns true if current value meaningfully differs from the crawled snapshot value
function differsFromSnapshot(current: unknown, snapshot: unknown): boolean {
  if (!snapshot || snapshot === '' || (Array.isArray(snapshot) && snapshot.length === 0)) return false
  const cur = typeof current === 'string' ? current.trim() : JSON.stringify(current ?? '')
  const snap = typeof snapshot === 'string' ? snapshot.trim() : JSON.stringify(snapshot ?? '')
  return cur !== snap && snap !== '' && snap !== '{}' && snap !== '[]'
}

function DiffBadge({ label }: { label: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex items-center" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
          backgroundColor: '#1c1c1c', color: '#f0f0f0', border: '1px solid #444',
          borderRadius: 4, padding: '4px 8px', fontSize: 10, whiteSpace: 'nowrap',
          zIndex: 9999, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
        }}>
          Auto-fill said: {label}
        </span>
      )}
    </span>
  )
}

function OverflowTooltip({ value, children }: { value: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const show = (value?.length ?? 0) > 30

  return (
    <div
      className="relative"
      onMouseEnter={() => show && setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            minWidth: '100%',
            maxWidth: 420,
            zIndex: 9999,
            backgroundColor: '#1c1c1c',
            color: '#f0f0f0',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.7)',
          }}
        >
          {value}
        </div>
      )}
    </div>
  )
}

function TagList({ tags, onAdd, onRemove, placeholder }: {
  tags: string[]
  onAdd: (v: string) => void
  onRemove: (i: number) => void
  placeholder?: string
}) {
  const [inputVal, setInputVal] = useState('')
  const commit = () => {
    const v = inputVal.trim()
    if (v && !tags.includes(v)) { onAdd(v); setInputVal('') }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {tags.map((t, i) => (
          <OverflowTooltip key={i} value={t}>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] max-w-[160px]">
              <span className="truncate">{t}</span>
              <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-red-500 shrink-0">
                <Icons.X className="h-2.5 w-2.5" />
              </button>
            </span>
          </OverflowTooltip>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          placeholder={placeholder ?? 'Add…'}
          className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
        <button
          onClick={commit}
          disabled={!inputVal.trim()}
          className="rounded border border-input bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function ProfileSection({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function ProfileField({ label, children, diff }: { label: string; children: React.ReactNode; diff?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-0.5">
        {label}
        {diff && <DiffBadge label={diff} />}
      </label>
      {children}
    </div>
  )
}

function BuyerCard({ label, buyer, onChange }: {
  label: string
  buyer: { title?: string; age_range?: string; pain_points?: string[]; goals?: string[] }
  onChange: (updated: typeof buyer) => void
}) {
  const pains = buyer.pain_points ?? []
  const goals = buyer.goals ?? []
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">Title / Role</label>
          <OverflowTooltip value={buyer.title ?? ''}>
            <input
              value={buyer.title ?? ''}
              onChange={(e) => onChange({ ...buyer, title: e.target.value })}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
              placeholder="e.g. Head of Marketing"
            />
          </OverflowTooltip>
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">Age Range</label>
          <OverflowTooltip value={buyer.age_range ?? ''}>
            <input
              value={buyer.age_range ?? ''}
              onChange={(e) => onChange({ ...buyer, age_range: e.target.value })}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
              placeholder="e.g. 35-50"
            />
          </OverflowTooltip>
        </div>
      </div>
      <div className="space-y-0.5">
        <label className="text-[10px] text-muted-foreground">Pain Points</label>
        <TagList
          tags={pains}
          onAdd={(v) => onChange({ ...buyer, pain_points: [...pains, v] })}
          onRemove={(i) => onChange({ ...buyer, pain_points: pains.filter((_, idx) => idx !== i) })}
          placeholder="Add pain point…"
        />
      </div>
      <div className="space-y-0.5">
        <label className="text-[10px] text-muted-foreground">Goals</label>
        <TagList
          tags={goals}
          onAdd={(v) => onChange({ ...buyer, goals: [...goals, v] })}
          onRemove={(i) => onChange({ ...buyer, goals: goals.filter((_, idx) => idx !== i) })}
          placeholder="Add goal…"
        />
      </div>
    </div>
  )
}

interface ProfileListItem {
  id: string
  label: string | null
  status: string
  crawledFrom: string | null
  updatedAt: string
  createdAt: string
}

function ProfileTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [list, setList] = useState<ProfileListItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState<Partial<ClientProfile>>({})
  const [autofillUrl, setAutofillUrl] = useState('')
  const [autofillStep, setAutofillStep] = useState<'idle' | 'crawling' | 'analyzing' | 'done' | 'error'>('idle')
  const [autofillError, setAutofillError] = useState('')
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/profiles`)
      const { data } = await res.json()
      setList(data ?? [])
      // Auto-select first active
      if (!selectedId && data?.length > 0) {
        const first = (data as ProfileListItem[]).find((p) => p.status === 'active') ?? data[0]
        setSelectedId(first.id)
      }
    } catch { /* ignore */ }
    finally { setListLoading(false) }
  }, [clientId])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (!selectedId) { setProfile(null); setDraft({}); return }
    setLoading(true)
    apiFetch(`/api/v1/clients/${clientId}/profiles/${selectedId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setProfile(data)
        setDraft(data)
        setLabelDraft(data.label ?? '')
        if (data.crawledFrom) setAutofillUrl(data.crawledFrom)
        else setAutofillUrl('')
        setAutofillStep('idle')
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedId, clientId])

  const handleNewResearch = async () => {
    setCreating(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const { data } = await res.json()
      await loadList()
      setSelectedId(data.id)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  const handleArchiveToggle = async () => {
    if (!profile) return
    setArchiving(true)
    try {
      const newStatus = profile.status === 'archived' ? 'active' : 'archived'
      const res = await apiFetch(`/api/v1/clients/${clientId}/profiles/${profile.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const { data } = await res.json()
      setProfile(data); setDraft(data)
      setList((prev) => prev.map((p) => p.id === data.id ? { ...p, status: data.status } : p))
    } catch { /* ignore */ }
    finally { setArchiving(false) }
  }

  const handleDeleteProfile = async () => {
    if (!profile) return
    if (!confirm('Delete this brand profile? This cannot be undone.')) return
    setDeletingProfile(true)
    try {
      await apiFetch(`/api/v1/clients/${clientId}/profiles/${profile.id}`, { method: 'DELETE' })
      const newList = list.filter((p) => p.id !== profile.id)
      setList(newList)
      setSelectedId(newList.length > 0 ? newList[0].id : null)
      setProfile(null); setDraft({})
    } catch { /* ignore */ }
    finally { setDeletingProfile(false) }
  }

  const handleLabelSave = async () => {
    if (!profile) return
    await apiFetch(`/api/v1/clients/${clientId}/profiles/${profile.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: labelDraft.trim() || null }),
    })
    setProfile((p) => p ? { ...p, label: labelDraft.trim() || null } : p)
    setList((prev) => prev.map((p) => p.id === profile.id ? { ...p, label: labelDraft.trim() || null } : p))
    setEditingLabel(false)
  }

  useEffect(() => { void loadList() }, [loadList])

  const handleAutofill = async () => {
    if (!selectedId) return
    const url = autofillUrl.trim()
    if (!url) return
    setAutofillStep('crawling')
    setAutofillError('')
    const stepTimer = setTimeout(() => setAutofillStep('analyzing'), 3000)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/profiles/${selectedId}/autofill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      clearTimeout(stepTimer)
      const json = await res.json()
      if (!res.ok) { setAutofillStep('error'); setAutofillError(json.error ?? 'Auto-fill failed'); return }
      const filled = json.data as ClientProfile
      // Auto-add the crawled URL as a source if not already listed
      const existingSources: Array<{ url: string; label: string; addedAt?: string }> = filled.sources ?? []
      if (url && !existingSources.some((s) => s.url === url)) {
        const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
        filled.sources = [...existingSources, { url, label: hostname, addedAt: new Date().toISOString().slice(0, 10) }]
      }
      setProfile(filled); setDraft(filled); setAutofillStep('done')
      setList((prev) => prev.map((p) => p.id === filled.id ? { ...p, label: filled.label, crawledFrom: filled.crawledFrom } : p))
    } catch {
      clearTimeout(stepTimer); setAutofillStep('error'); setAutofillError('Could not reach server — check your connection')
    }
  }

  const set = <K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/profiles/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error('Save failed')
      const { data } = await res.json()
      setProfile(data); setDraft(data); setSaved(true)
      setList((prev) => prev.map((p) => p.id === data.id ? { ...p, label: data.label, updatedAt: data.updatedAt } : p))
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (listLoading) {
    return <div className="flex items-center justify-center py-16"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  const d = draft as ClientProfile
  const snap = (profile?.crawledSnapshot ?? {}) as Record<string, unknown>
  const sdiff = (key: keyof ClientProfile) => differsFromSnapshot(d[key], snap[key]) ? String(snap[key]) : undefined
  const autofillBusy = autofillStep === 'crawling' || autofillStep === 'analyzing'

  return (
    <div className="flex gap-5 h-full">
      {/* ── Left sidebar: research list ──────────────────────────────────────── */}
      <div className="w-56 shrink-0 space-y-2 print:hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Brand Profiles</span>
          <button
            onClick={handleNewResearch}
            disabled={creating}
            title="New profile"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {creating ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-[11px] text-muted-foreground">No profiles yet</p>
            <button onClick={handleNewResearch} className="mt-2 text-[11px] text-purple-600 hover:underline">Create one</button>
          </div>
        ) : (
          <div className="space-y-1">
            {list.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'w-full rounded-lg border p-2.5 text-left transition-colors',
                  selectedId === item.id
                    ? 'border-purple-500/50 bg-purple-50/10'
                    : 'border-border hover:border-border/80 hover:bg-accent/20',
                )}
              >
                <p className="text-xs font-medium truncate">
                  {item.label ?? item.crawledFrom ?? 'Untitled'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </p>
                {item.status === 'archived' && (
                  <span className="text-[10px] text-amber-500">archived</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: form ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4 print-form-only">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icons.Mic className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Select a profile or create a new one</p>
            <button onClick={handleNewResearch} className="mt-3 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: '#a200ee' }}>
              <Icons.Plus className="h-3.5 w-3.5" /> New Profile
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Profile header: label + action buttons */}
            <div className="flex items-center gap-2 print:hidden">
              {editingLabel ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleLabelSave(); if (e.key === 'Escape') setEditingLabel(false) }}
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                    placeholder="Profile label (e.g. competitor name or website)"
                  />
                  <button onClick={() => void handleLabelSave()} className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80">Save</button>
                  <button onClick={() => setEditingLabel(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setLabelDraft(profile?.label ?? ''); setEditingLabel(true) }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Icons.Pencil className="h-3 w-3" />
                  <span>{profile?.label ?? profile?.crawledFrom ?? 'Untitled profile'}</span>
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => window.print()}
                  title="Print"
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Icons.Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={() => profile && downloadBrandProfileDocx(profile, clientName)}
                  title="Download as Word document"
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Icons.FileDown className="h-3.5 w-3.5" /> .docx
                </button>
                <button
                  onClick={handleArchiveToggle}
                  disabled={archiving}
                  title={profile?.status === 'archived' ? 'Unarchive' : 'Archive'}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-amber-600 hover:border-amber-300"
                >
                  {archiving ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : profile?.status === 'archived' ? <><Icons.ArchiveRestore className="h-3.5 w-3.5" /> Unarchive</> : <><Icons.Archive className="h-3.5 w-3.5" /> Archive</>}
                </button>
                <button
                  onClick={handleDeleteProfile}
                  disabled={deletingProfile}
                  title="Delete profile"
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                >
                  {deletingProfile ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Icons.Trash2 className="h-3.5 w-3.5" /> Delete</>}
                </button>
              </div>
            </div>

            {/* Auto-fill */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3 print:hidden">
              <div className="flex items-center gap-2">
                <Icons.Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold">Auto-fill from Website</h3>
                {profile?.crawledFrom && <span className="text-[10px] text-muted-foreground">{profile.crawledFrom}</span>}
              </div>
              <div className="flex gap-2">
                <input
                  value={autofillUrl}
                  onChange={(e) => { setAutofillUrl(e.target.value); setAutofillStep('idle'); setAutofillError('') }}
                  placeholder="https://example.com"
                  disabled={autofillBusy}
                  className="flex-1 rounded border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-ring disabled:opacity-50"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAutofill() }}
                />
                <button onClick={handleAutofill} disabled={autofillBusy || !autofillUrl.trim()} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: '#a200ee' }}>
                  {autofillStep === 'crawling' && <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Crawling…</>}
                  {autofillStep === 'analyzing' && <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Analyzing…</>}
                  {(autofillStep === 'idle' || autofillStep === 'error') && <><Icons.Sparkles className="h-3 w-3" /> Auto-fill</>}
                  {autofillStep === 'done' && <><Icons.RefreshCw className="h-3 w-3" /> Re-run</>}
                </button>
              </div>
              {autofillStep === 'done' && <p className="text-[11px] text-green-600 flex items-center gap-1"><Icons.CheckCircle2 className="h-3.5 w-3.5" /> Profile filled — review and save.</p>}
              {autofillStep === 'error' && <p className="text-[11px] text-red-500 flex items-center gap-1"><Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />{autofillError}</p>}
            </div>

            {/* Save bar */}
            <div className="flex items-center justify-between print:hidden">
              <p className="text-xs text-muted-foreground">{profile?.updatedAt ? `Last updated ${new Date(profile.updatedAt).toLocaleDateString()}` : 'Not yet saved'}</p>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#a200ee' }}>
                {saving ? <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : saved ? <><Icons.Check className="h-3 w-3" /> Saved</> : <><Icons.Save className="h-3 w-3" /> Save Profile</>}
              </button>
            </div>

      {/* Brand Voice */}
      <ProfileSection title="Brand Voice" icon={Icons.Mic}>
        <div className="grid grid-cols-3 gap-3">
          <ProfileField label="Brand Tone" diff={sdiff('brandTone')}>
            <OverflowTooltip value={d.brandTone ?? ''}>
              <input
                value={d.brandTone ?? ''}
                onChange={(e) => set('brandTone', e.target.value)}
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                placeholder="e.g. Authoritative yet approachable"
              />
            </OverflowTooltip>
          </ProfileField>
          <ProfileField label="Formality" diff={sdiff('formality')}>
            <select
              value={d.formality ?? ''}
              onChange={(e) => set('formality', e.target.value || null)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
            >
              <option value="">— select —</option>
              <option value="formal">Formal</option>
              <option value="semi-formal">Semi-formal</option>
              <option value="casual">Casual</option>
            </select>
          </ProfileField>
          <ProfileField label="Point of View" diff={sdiff('pov')}>
            <select
              value={d.pov ?? ''}
              onChange={(e) => set('pov', e.target.value || null)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
            >
              <option value="">— select —</option>
              <option value="first_person">First Person (We)</option>
              <option value="second_person">Second Person (You)</option>
              <option value="third_person">Third Person</option>
            </select>
          </ProfileField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label="Signature Phrases">
            <TagList
              tags={d.signaturePhrases ?? []}
              onAdd={(v) => set('signaturePhrases', [...(d.signaturePhrases ?? []), v])}
              onRemove={(i) => set('signaturePhrases', (d.signaturePhrases ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add phrase…"
            />
          </ProfileField>
          <ProfileField label="Phrases to Avoid">
            <TagList
              tags={d.avoidPhrases ?? []}
              onAdd={(v) => set('avoidPhrases', [...(d.avoidPhrases ?? []), v])}
              onRemove={(i) => set('avoidPhrases', (d.avoidPhrases ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add phrase to avoid…"
            />
          </ProfileField>
        </div>
      </ProfileSection>

      {/* Audience */}
      <ProfileSection title="Audience" icon={Icons.Users}>
        <div className="grid grid-cols-2 gap-3">
          <BuyerCard
            label="Primary Buyer"
            buyer={d.primaryBuyer ?? {}}
            onChange={(v) => set('primaryBuyer', v)}
          />
          <BuyerCard
            label="Secondary Buyer"
            buyer={d.secondaryBuyer ?? {}}
            onChange={(v) => set('secondaryBuyer', v)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label="Buyer Motivations">
            <TagList
              tags={d.buyerMotivations ?? []}
              onAdd={(v) => set('buyerMotivations', [...(d.buyerMotivations ?? []), v])}
              onRemove={(i) => set('buyerMotivations', (d.buyerMotivations ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add motivation…"
            />
          </ProfileField>
          <ProfileField label="Buyer Fears">
            <TagList
              tags={d.buyerFears ?? []}
              onAdd={(v) => set('buyerFears', [...(d.buyerFears ?? []), v])}
              onRemove={(i) => set('buyerFears', (d.buyerFears ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add fear…"
            />
          </ProfileField>
        </div>
      </ProfileSection>

      {/* Visual Identity */}
      <ProfileSection title="Visual Identity" icon={Icons.Palette}>
        <div className="grid grid-cols-3 gap-3">
          <ProfileField label="Visual Style" diff={sdiff('visualStyle')}>
            <OverflowTooltip value={d.visualStyle ?? ''}>
              <input
                value={d.visualStyle ?? ''}
                onChange={(e) => set('visualStyle', e.target.value || null)}
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                placeholder="e.g. Clean and modern"
              />
            </OverflowTooltip>
          </ProfileField>
          <ProfileField label="Color Temperature">
            <select
              value={d.colorTemperature ?? ''}
              onChange={(e) => set('colorTemperature', e.target.value || null)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
            >
              <option value="">— select —</option>
              <option value="warm">Warm</option>
              <option value="cool">Cool</option>
              <option value="neutral">Neutral</option>
            </select>
          </ProfileField>
          <ProfileField label="Imagery Style">
            <select
              value={d.photographyVsIllustration ?? ''}
              onChange={(e) => set('photographyVsIllustration', e.target.value || null)}
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
            >
              <option value="">— select —</option>
              <option value="photography">Photography</option>
              <option value="illustration">Illustration</option>
              <option value="mixed">Mixed</option>
            </select>
          </ProfileField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label="Approved Visual Themes">
            <TagList
              tags={d.approvedVisualThemes ?? []}
              onAdd={(v) => set('approvedVisualThemes', [...(d.approvedVisualThemes ?? []), v])}
              onRemove={(i) => set('approvedVisualThemes', (d.approvedVisualThemes ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add theme…"
            />
          </ProfileField>
          <ProfileField label="Visual Elements to Avoid">
            <TagList
              tags={d.avoidVisual ?? []}
              onAdd={(v) => set('avoidVisual', [...(d.avoidVisual ?? []), v])}
              onRemove={(i) => set('avoidVisual', (d.avoidVisual ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add element to avoid…"
            />
          </ProfileField>
        </div>
      </ProfileSection>

      {/* Strategic */}
      <ProfileSection title="Strategic Direction" icon={Icons.Target}>
        <ProfileField label="Current Positioning" diff={sdiff('currentPositioning')}>
          <OverflowTooltip value={d.currentPositioning ?? ''}>
            <textarea
              value={d.currentPositioning ?? ''}
              onChange={(e) => set('currentPositioning', e.target.value || null)}
              rows={3}
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring resize-none"
              placeholder="Describe how the client currently positions themselves in the market…"
            />
          </OverflowTooltip>
        </ProfileField>
        <ProfileField label="Approved Campaign Themes">
          <TagList
            tags={d.campaignThemesApproved ?? []}
            onAdd={(v) => set('campaignThemesApproved', [...(d.campaignThemesApproved ?? []), v])}
            onRemove={(i) => set('campaignThemesApproved', (d.campaignThemesApproved ?? []).filter((_, idx) => idx !== i))}
            placeholder="Add campaign theme…"
          />
        </ProfileField>
      </ProfileSection>

      {/* Sources & Citations */}
      <ProfileSourcesSection
        sources={d.sources ?? []}
        onChange={(updated) => set('sources', updated)}
      />

      {/* Manual Overrides */}
      <ProfileSection title="Manual Overrides" icon={Icons.ShieldCheck}>
        <p className="text-[10px] text-muted-foreground">
          Overrides take the highest priority and are injected directly into AI prompts. Use for client-specific rules that must always apply.
        </p>
        <div className="space-y-2">
          {(d.manualOverrides ?? []).map((ov, i) => (
            <div key={i} className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Field</label>
                  <OverflowTooltip value={ov.field}>
                    <input
                      value={ov.field}
                      onChange={(e) => {
                        const updated = [...(d.manualOverrides ?? [])]
                        updated[i] = { ...ov, field: e.target.value }
                        set('manualOverrides', updated)
                      }}
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                      placeholder="e.g. brandTone"
                    />
                  </OverflowTooltip>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Confidence</label>
                  <select
                    value={ov.confidence}
                    onChange={(e) => {
                      const updated = [...(d.manualOverrides ?? [])]
                      updated[i] = { ...ov, confidence: e.target.value }
                      set('manualOverrides', updated)
                    }}
                    className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground">Instruction</label>
                <OverflowTooltip value={ov.instruction}>
                  <textarea
                    value={ov.instruction}
                    onChange={(e) => {
                      const updated = [...(d.manualOverrides ?? [])]
                      updated[i] = { ...ov, instruction: e.target.value }
                      set('manualOverrides', updated)
                    }}
                    rows={2}
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring resize-none"
                    placeholder="The specific instruction to apply…"
                  />
                </OverflowTooltip>
              </div>
              <button
                onClick={() => set('manualOverrides', (d.manualOverrides ?? []).filter((_, idx) => idx !== i))}
                className="text-[10px] text-red-500 hover:text-red-600 flex items-center gap-1"
              >
                <Icons.Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              set('manualOverrides', [
                ...(d.manualOverrides ?? []),
                { field: '', instruction: '', source: 'client_direct', confidence: 'high', date: new Date().toISOString().slice(0, 10), expires: null },
              ])
            }
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Icons.Plus className="h-3.5 w-3.5" /> Add Override
          </button>
        </div>
      </ProfileSection>
          </>
        )}
      </div>
    </div>
  )
}

// ── Company Profile Tab ───────────────────────────────────────────────────────

interface LeadershipMember { name: string; title: string; location: string; linkedin: string }

interface CompanyProfile {
  id: string
  label: string | null
  status: string
  about: string | null
  founded: string | null
  headquarters: string | null
  industry: string | null
  globalReach: string | null
  companyCategory: string | null
  businessType: string | null
  employees: string | null
  coreValues: string[]
  keyAchievements: string[]
  leadershipMessage: string | null
  leadershipTeam: LeadershipMember[]
  whatTheyDo: string | null
  keyOfferings: string[]
  industriesServed: string[]
  partners: string[]
  milestones: string[]
  visionForFuture: string | null
  website: string | null
  generalInquiries: string | null
  phone: string | null
  headquartersAddress: string | null
  crawledFrom: string | null
  crawledSnapshot: Record<string, unknown>
  sources: Array<{ url: string; label: string; addedAt?: string }>
  updatedAt: string
}

interface CompanyListItem {
  id: string
  label: string | null
  status: string
  crawledFrom: string | null
  about: string | null
  industry: string | null
  updatedAt: string
  createdAt: string
}

function CompanyField({ label, children, diff }: { label: string; children: React.ReactNode; diff?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-0.5">
        {label}
        {diff && <DiffBadge label={diff} />}
      </label>
      {children}
    </div>
  )
}

function CompanySection({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  )
}

// ── Shared Sources & Citations section (used by both Profile and Company Profile tabs) ──

type SourceEntry = { url: string; label: string; addedAt?: string }

function ProfileSourcesSection({ sources, onChange }: {
  sources: SourceEntry[]
  onChange: (updated: SourceEntry[]) => void
}) {
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const addSource = () => {
    const url = newUrl.trim()
    if (!url) return
    const label = newLabel.trim() || (() => { try { return new URL(url).hostname } catch { return url } })()
    if (sources.some((s) => s.url === url)) { setNewUrl(''); setNewLabel(''); return }
    onChange([...sources, { url, label, addedAt: new Date().toISOString().slice(0, 10) }])
    setNewUrl('')
    setNewLabel('')
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icons.Link className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold">Sources & Citations</h3>
        <span className="text-[10px] text-muted-foreground ml-1">— included in .docx exports</span>
      </div>
      {sources.length > 0 && (
        <div className="space-y-1.5">
          {sources.map((s, i) => (
            <div key={i} className="flex items-center gap-2 group">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground shrink-0 w-4 text-right">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <input
                    value={s.label}
                    onChange={(e) => {
                      const updated = [...sources]
                      updated[i] = { ...s, label: e.target.value }
                      onChange(updated)
                    }}
                    className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:border-ring"
                    placeholder="Label"
                  />
                </div>
                <div className="w-52 shrink-0">
                  <input
                    value={s.url}
                    onChange={(e) => {
                      const updated = [...sources]
                      updated[i] = { ...s, url: e.target.value }
                      onChange(updated)
                    }}
                    className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:border-ring text-muted-foreground"
                    placeholder="URL"
                  />
                </div>
              </div>
              <button
                onClick={() => onChange(sources.filter((_, idx) => idx !== i))}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 shrink-0 transition-opacity"
              >
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
        <input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addSource() }}
          placeholder="https://…"
          className="w-52 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
        <button
          onClick={addSource}
          disabled={!newUrl.trim()}
          className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
        >
          <Icons.Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  )
}

function CompanyProfileTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [list, setList] = useState<CompanyListItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState<Partial<CompanyProfile>>({})
  const [autofillUrl, setAutofillUrl] = useState('')
  const [autofillStep, setAutofillStep] = useState<'idle' | 'crawling' | 'analyzing' | 'done' | 'error'>('idle')
  const [autofillError, setAutofillError] = useState('')
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const loadList = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/company-profiles`)
      const { data } = await res.json()
      setList(data ?? [])
      if (!selectedId && data?.length > 0) {
        const first = (data as CompanyListItem[]).find((p) => p.status === 'active') ?? data[0]
        setSelectedId(first.id)
      }
    } catch { /* ignore */ }
    finally { setListLoading(false) }
  }, [clientId])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (!selectedId) { setProfile(null); setDraft({}); return }
    setLoading(true)
    apiFetch(`/api/v1/clients/${clientId}/company-profiles/${selectedId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setProfile(data); setDraft(data)
        setLabelDraft(data.label ?? '')
        setAutofillUrl(data.crawledFrom ?? '')
        setAutofillStep('idle')
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedId, clientId])

  const handleNewResearch = async () => {
    setCreating(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/company-profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const { data } = await res.json()
      await loadList()
      setSelectedId(data.id)
    } catch { /* ignore */ }
    finally { setCreating(false) }
  }

  const handleArchiveToggle = async () => {
    if (!profile) return
    setArchiving(true)
    try {
      const newStatus = profile.status === 'archived' ? 'active' : 'archived'
      const res = await apiFetch(`/api/v1/clients/${clientId}/company-profiles/${profile.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const { data } = await res.json()
      setProfile(data); setDraft(data)
      setList((prev) => prev.map((p) => p.id === data.id ? { ...p, status: data.status } : p))
    } catch { /* ignore */ }
    finally { setArchiving(false) }
  }

  const handleDeleteProfile = async () => {
    if (!profile) return
    if (!confirm('Delete this company profile? This cannot be undone.')) return
    setDeletingProfile(true)
    try {
      await apiFetch(`/api/v1/clients/${clientId}/company-profiles/${profile.id}`, { method: 'DELETE' })
      const newList = list.filter((p) => p.id !== profile.id)
      setList(newList)
      setSelectedId(newList.length > 0 ? newList[0].id : null)
      setProfile(null); setDraft({})
    } catch { /* ignore */ }
    finally { setDeletingProfile(false) }
  }

  const handleLabelSave = async () => {
    if (!profile) return
    await apiFetch(`/api/v1/clients/${clientId}/company-profiles/${profile.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: labelDraft.trim() || null }),
    })
    const newLabel = labelDraft.trim() || null
    setProfile((p) => p ? { ...p, label: newLabel } : p)
    setList((prev) => prev.map((p) => p.id === profile.id ? { ...p, label: newLabel } : p))
    setEditingLabel(false)
  }

  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleAutofill = async () => {
    if (!selectedId) return
    const url = autofillUrl.trim()
    if (!url) return
    setAutofillStep('crawling')
    setAutofillError('')
    const t = setTimeout(() => setAutofillStep('analyzing'), 3500)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/company-profiles/${selectedId}/autofill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      clearTimeout(t)
      const json = await res.json()
      if (!res.ok) { setAutofillStep('error'); setAutofillError(json.error ?? 'Auto-fill failed'); return }
      const filled = json.data as CompanyProfile
      // Auto-add the crawled URL as a source if not already listed
      const existingSources: Array<{ url: string; label: string; addedAt?: string }> = filled.sources ?? []
      if (url && !existingSources.some((s) => s.url === url)) {
        const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
        filled.sources = [...existingSources, { url, label: hostname, addedAt: new Date().toISOString().slice(0, 10) }]
      }
      setProfile(filled); setDraft(filled); setAutofillStep('done')
      setList((prev) => prev.map((p) => p.id === filled.id ? { ...p, label: filled.label, crawledFrom: filled.crawledFrom } : p))
    } catch {
      clearTimeout(t); setAutofillStep('error'); setAutofillError('Could not reach server')
    }
  }

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/company-profiles/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error()
      const { data } = await res.json()
      setProfile(data); setDraft(data); setSaved(true)
      setList((prev) => prev.map((p) => p.id === data.id ? { ...p, label: data.label, updatedAt: data.updatedAt } : p))
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  if (listLoading) return <div className="flex items-center justify-center py-16"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const d = draft as CompanyProfile
  const snap = (profile?.crawledSnapshot ?? {}) as Record<string, unknown>
  const cdiff = (key: keyof CompanyProfile) => differsFromSnapshot(d[key], snap[key]) ? String(snap[key]) : undefined
  const autofillBusy = autofillStep === 'crawling' || autofillStep === 'analyzing'

  const editTxt = (key: keyof CompanyProfile, placeholder?: string) => (
    <OverflowTooltip value={(d[key] as string) ?? ''}>
      <div className="relative">
        <input
          value={(d[key] as string) ?? ''}
          onChange={(e) => set(key, e.target.value as CompanyProfile[typeof key])}
          placeholder={placeholder}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
        {cdiff(key) && <span className="absolute right-1.5 top-1/2 -translate-y-1/2"><DiffBadge label={cdiff(key)!} /></span>}
      </div>
    </OverflowTooltip>
  )

  const editArea = (key: keyof CompanyProfile, rows = 3, placeholder?: string) => (
    <OverflowTooltip value={(d[key] as string) ?? ''}>
      <div className="relative">
        <textarea
          value={(d[key] as string) ?? ''}
          onChange={(e) => set(key, e.target.value as CompanyProfile[typeof key])}
          rows={rows}
          placeholder={placeholder}
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring resize-none"
        />
        {cdiff(key) && <span className="absolute right-1.5 top-1.5"><DiffBadge label={cdiff(key)!} /></span>}
      </div>
    </OverflowTooltip>
  )

  return (
    <div className="flex gap-5 h-full">
      {/* ── Left sidebar: research list ─────────────────────────────────────── */}
      <div className="w-56 shrink-0 space-y-2 print:hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Research Library</span>
          <button onClick={handleNewResearch} disabled={creating} title="New research" className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {creating ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-[11px] text-muted-foreground">No research yet</p>
            <button onClick={handleNewResearch} className="mt-2 text-[11px] text-purple-600 hover:underline">Add first</button>
          </div>
        ) : (
          <div className="space-y-1">
            {list.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'w-full rounded-lg border p-2.5 text-left transition-colors',
                  selectedId === item.id
                    ? 'border-purple-500/50 bg-purple-50/10'
                    : 'border-border hover:border-border/80 hover:bg-accent/20',
                )}
              >
                <p className="text-xs font-medium truncate">
                  {item.label ?? item.crawledFrom ?? item.industry ?? 'Untitled'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(item.updatedAt).toLocaleDateString()}</p>
                {item.status === 'archived' && <span className="text-[10px] text-amber-500">archived</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: form ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4 print-form-only">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icons.Building2 className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Select a company or add new research</p>
            <button onClick={handleNewResearch} className="mt-3 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: '#a200ee' }}>
              <Icons.Plus className="h-3.5 w-3.5" /> New Research
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Header: label + actions */}
            <div className="flex items-center gap-2 print:hidden">
              {editingLabel ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <input autoFocus value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleLabelSave(); if (e.key === 'Escape') setEditingLabel(false) }}
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
                    placeholder="Company name (e.g. Acme Corp)" />
                  <button onClick={() => void handleLabelSave()} className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80">Save</button>
                  <button onClick={() => setEditingLabel(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setLabelDraft(profile?.label ?? ''); setEditingLabel(true) }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Icons.Pencil className="h-3 w-3" />
                  <span>{profile?.label ?? profile?.crawledFrom ?? 'Untitled research'}</span>
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => window.print()} title="Print" className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Icons.Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={() => profile && downloadCompanyProfileDocx(profile, clientName)}
                  title="Download as Word document"
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Icons.FileDown className="h-3.5 w-3.5" /> .docx
                </button>
                <button onClick={handleArchiveToggle} disabled={archiving} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-amber-600 hover:border-amber-300">
                  {archiving ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : profile?.status === 'archived' ? <><Icons.ArchiveRestore className="h-3.5 w-3.5" /> Unarchive</> : <><Icons.Archive className="h-3.5 w-3.5" /> Archive</>}
                </button>
                <button onClick={handleDeleteProfile} disabled={deletingProfile} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300">
                  {deletingProfile ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Icons.Trash2 className="h-3.5 w-3.5" /> Delete</>}
                </button>
              </div>
            </div>

            {/* Auto-fill */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3 print:hidden">
              <div className="flex items-center gap-2">
                <Icons.Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold">Auto-fill from Website</h3>
                {profile?.crawledFrom && <span className="text-[10px] text-muted-foreground">{profile.crawledFrom}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">Paste any company website URL — Claude will extract the backgrounder fields automatically.</p>
              <div className="flex gap-2">
                <input value={autofillUrl} onChange={(e) => { setAutofillUrl(e.target.value); setAutofillStep('idle') }}
                  placeholder="https://example.com" disabled={autofillBusy}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAutofill() }}
                  className="flex-1 rounded border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-ring disabled:opacity-50"
                />
                <button onClick={handleAutofill} disabled={autofillBusy || !autofillUrl.trim()} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: '#a200ee' }}>
                  {autofillStep === 'crawling' && <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Crawling…</>}
                  {autofillStep === 'analyzing' && <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Analyzing…</>}
                  {(autofillStep === 'idle' || autofillStep === 'error') && <><Icons.Sparkles className="h-3 w-3" /> Auto-fill</>}
                  {autofillStep === 'done' && <><Icons.RefreshCw className="h-3 w-3" /> Re-run</>}
                </button>
              </div>
              {autofillStep === 'done' && <p className="text-[11px] text-green-600 flex items-center gap-1"><Icons.CheckCircle2 className="h-3.5 w-3.5" /> Fields filled — review and save.</p>}
              {autofillStep === 'error' && <p className="text-[11px] text-red-500 flex items-center gap-1"><Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />{autofillError}</p>}
            </div>

            {/* Save bar */}
            <div className="flex items-center justify-between print:hidden">
              <p className="text-xs text-muted-foreground">{profile?.updatedAt ? `Last updated ${new Date(profile.updatedAt).toLocaleDateString()}` : 'Not yet saved'}</p>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#a200ee' }}>
                {saving ? <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : saved ? <><Icons.Check className="h-3 w-3" /> Saved</> : <><Icons.Save className="h-3 w-3" /> Save</>}
              </button>
            </div>

      {/* About */}
      <CompanySection title="About" icon={Icons.Building2}>
        <CompanyField label="About">{editArea('about', 4, 'Company overview…')}</CompanyField>
        <div className="grid grid-cols-4 gap-3">
          <CompanyField label="Founded">{editTxt('founded', 'e.g. 2005')}</CompanyField>
          <CompanyField label="Headquarters">{editTxt('headquarters', 'City, Country')}</CompanyField>
          <CompanyField label="Employees">{editTxt('employees', 'e.g. 500–1000')}</CompanyField>
          <CompanyField label="Industry">{editTxt('industry', 'e.g. SaaS')}</CompanyField>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <CompanyField label="Global Reach">{editTxt('globalReach', 'e.g. 40+ countries')}</CompanyField>
          <CompanyField label="Company Category">{editTxt('companyCategory', 'e.g. Enterprise Software')}</CompanyField>
          <CompanyField label="Business Type">{editTxt('businessType', 'e.g. B2B')}</CompanyField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CompanyField label="Core Values">
            <TagList
              tags={d.coreValues ?? []}
              onAdd={(v) => set('coreValues', [...(d.coreValues ?? []), v])}
              onRemove={(i) => set('coreValues', (d.coreValues ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add value…"
            />
          </CompanyField>
          <CompanyField label="Key Achievements">
            <TagList
              tags={d.keyAchievements ?? []}
              onAdd={(v) => set('keyAchievements', [...(d.keyAchievements ?? []), v])}
              onRemove={(i) => set('keyAchievements', (d.keyAchievements ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add achievement…"
            />
          </CompanyField>
        </div>
      </CompanySection>

      {/* Leadership */}
      <CompanySection title="Leadership" icon={Icons.UserCheck}>
        <CompanyField label="Leadership Message">{editArea('leadershipMessage', 3, 'Quote or message from leadership…')}</CompanyField>
        <CompanyField label="Leadership Team">
          <div className="space-y-2">
            {(d.leadershipTeam ?? []).map((m, i) => (
              <div key={i} className="rounded-md border border-border p-3 grid grid-cols-2 gap-2 bg-muted/20">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Name</label>
                  <OverflowTooltip value={m.name ?? ''}>
                    <input value={m.name ?? ''} onChange={(e) => { const t = [...(d.leadershipTeam ?? [])]; t[i] = { ...m, name: e.target.value }; set('leadershipTeam', t) }} className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring" placeholder="Full name" />
                  </OverflowTooltip>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Title</label>
                  <OverflowTooltip value={m.title ?? ''}>
                    <input value={m.title ?? ''} onChange={(e) => { const t = [...(d.leadershipTeam ?? [])]; t[i] = { ...m, title: e.target.value }; set('leadershipTeam', t) }} className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring" placeholder="Job title" />
                  </OverflowTooltip>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">Location</label>
                  <OverflowTooltip value={m.location ?? ''}>
                    <input value={m.location ?? ''} onChange={(e) => { const t = [...(d.leadershipTeam ?? [])]; t[i] = { ...m, location: e.target.value }; set('leadershipTeam', t) }} className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring" placeholder="City" />
                  </OverflowTooltip>
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-muted-foreground">LinkedIn</label>
                  <OverflowTooltip value={m.linkedin ?? ''}>
                    <input value={m.linkedin ?? ''} onChange={(e) => { const t = [...(d.leadershipTeam ?? [])]; t[i] = { ...m, linkedin: e.target.value }; set('leadershipTeam', t) }} className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring" placeholder="linkedin.com/in/…" />
                  </OverflowTooltip>
                </div>
                <button onClick={() => set('leadershipTeam', (d.leadershipTeam ?? []).filter((_, idx) => idx !== i))} className="col-span-2 text-[10px] text-red-500 hover:text-red-600 flex items-center gap-1 justify-end">
                  <Icons.Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
            ))}
            <button onClick={() => set('leadershipTeam', [...(d.leadershipTeam ?? []), { name: '', title: '', location: '', linkedin: '' }])} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Icons.Plus className="h-3.5 w-3.5" /> Add Member
            </button>
          </div>
        </CompanyField>
      </CompanySection>

      {/* Products & Services */}
      <CompanySection title="Products & Services" icon={Icons.Package}>
        <CompanyField label="What They Do">{editArea('whatTheyDo', 4, 'Describe their core business and what they offer…')}</CompanyField>
        <div className="grid grid-cols-2 gap-3">
          <CompanyField label="Key Offerings">
            <TagList
              tags={d.keyOfferings ?? []}
              onAdd={(v) => set('keyOfferings', [...(d.keyOfferings ?? []), v])}
              onRemove={(i) => set('keyOfferings', (d.keyOfferings ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add offering…"
            />
          </CompanyField>
          <CompanyField label="Industries Served">
            <TagList
              tags={d.industriesServed ?? []}
              onAdd={(v) => set('industriesServed', [...(d.industriesServed ?? []), v])}
              onRemove={(i) => set('industriesServed', (d.industriesServed ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add industry…"
            />
          </CompanyField>
        </div>
      </CompanySection>

      {/* Partners & Milestones */}
      <CompanySection title="Partners & Milestones" icon={Icons.Handshake}>
        <div className="grid grid-cols-2 gap-3">
          <CompanyField label="Partners">
            <TagList
              tags={d.partners ?? []}
              onAdd={(v) => set('partners', [...(d.partners ?? []), v])}
              onRemove={(i) => set('partners', (d.partners ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add partner…"
            />
          </CompanyField>
          <CompanyField label="Milestones & Success Stories">
            <TagList
              tags={d.milestones ?? []}
              onAdd={(v) => set('milestones', [...(d.milestones ?? []), v])}
              onRemove={(i) => set('milestones', (d.milestones ?? []).filter((_, idx) => idx !== i))}
              placeholder="Add milestone…"
            />
          </CompanyField>
        </div>
      </CompanySection>

      {/* Vision */}
      <CompanySection title="Vision for the Future" icon={Icons.Telescope}>
        <CompanyField label="Their Vision">{editArea('visionForFuture', 3, 'Stated vision or strategic direction…')}</CompanyField>
      </CompanySection>

      {/* Contact */}
      <CompanySection title="Contact Information" icon={Icons.Phone}>
        <div className="grid grid-cols-2 gap-3">
          <CompanyField label="Website">{editTxt('website', 'https://…')}</CompanyField>
          <CompanyField label="General Inquiries">{editTxt('generalInquiries', 'email@company.com')}</CompanyField>
          <CompanyField label="Phone">{editTxt('phone', '+1 555 000 0000')}</CompanyField>
          <CompanyField label="Headquarters Address">
            <OverflowTooltip value={d.headquartersAddress ?? ''}>
              <textarea value={d.headquartersAddress ?? ''} onChange={(e) => set('headquartersAddress', e.target.value)} rows={2} className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring resize-none" placeholder="Full address…" />
            </OverflowTooltip>
          </CompanyField>
        </div>
      </CompanySection>

      {/* Sources & Citations */}
      <ProfileSourcesSection
        sources={d.sources ?? []}
        onChange={(updated) => set('sources', updated)}
      />
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Structure Tab (Divisions & Jobs) ─────────────────────────────────────────

interface DivisionJob {
  id: string
  name: string
  budgetCents: number | null
  createdAt: string
}

interface DivisionData {
  id: string
  name: string
  jobs: DivisionJob[]
  createdAt: string
}

interface VerticalItem { id: string; name: string }

function StructureTab({ client, onUpdate }: { client: Client; onUpdate: (updated: Partial<Client>) => void }) {
  const [divisions, setDivisions] = useState<DivisionData[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [addingDivision, setAddingDivision] = useState(false)
  const [newDivisionName, setNewDivisionName] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null)
  const [editingDivisionName, setEditingDivisionName] = useState('')
  const [deletingDivisionId, setDeletingDivisionId] = useState<string | null>(null)
  const [confirmDeleteDivision, setConfirmDeleteDivision] = useState<DivisionData | null>(null)

  // Verticals state
  const [allVerticals, setAllVerticals] = useState<VerticalItem[]>([])
  const [clientVerticals, setClientVerticals] = useState<VerticalItem[]>([])
  const [newVerticalName, setNewVerticalName] = useState('')
  const [addingVertical, setAddingVertical] = useState(false)
  const [renamingVerticalId, setRenamingVerticalId] = useState<string | null>(null)
  const [renamingVerticalName, setRenamingVerticalName] = useState('')

  // Per-division job add state
  const [addingJobDivisionId, setAddingJobDivisionId] = useState<string | null>(null)
  const [newJobName, setNewJobName] = useState('')
  const [newJobBudget, setNewJobBudget] = useState('')
  const [savingJob, setSavingJob] = useState(false)
  const [editingJob, setEditingJob] = useState<{ divisionId: string; job: DivisionJob } | null>(null)
  const [editJobName, setEditJobName] = useState('')
  const [editJobBudget, setEditJobBudget] = useState('')
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)

  // Local AI Only toggle
  const [togglingOffline, setTogglingOffline] = useState(false)
  const [offlineToggleError, setOfflineToggleError] = useState('')
  const toggleRequireOffline = async () => {
    setTogglingOffline(true)
    setOfflineToggleError('')
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireOffline: !client.requireOffline }),
      })
      if (!res.ok) throw new Error('Failed to update')
      const body = await res.json()
      onUpdate({ requireOffline: body.data.requireOffline })
    } catch {
      setOfflineToggleError('Failed to update setting.')
    } finally {
      setTogglingOffline(false)
    }
  }

  const load = () => {
    setLoading(true)
    Promise.all([
      apiFetch(`/api/v1/clients/${client.id}/divisions`).then((r) => r.json()),
      apiFetch('/api/v1/verticals').then((r) => r.json()),
      apiFetch(`/api/v1/clients/${client.id}/verticals`).then((r) => r.json()),
    ])
      .then(([div, allV, clientV]) => {
        setDivisions(div.data ?? [])
        setAllVerticals(allV.data ?? [])
        setClientVerticals(clientV.data ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [client.id])

  // Vertical handlers
  const handleCreateVertical = async () => {
    const name = newVerticalName.trim()
    if (!name) return
    const res = await apiFetch('/api/v1/verticals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    const { data } = await res.json()
    setAllVerticals((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    // Auto-assign to this client
    await apiFetch(`/api/v1/clients/${client.id}/verticals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verticalId: data.id }),
    })
    setClientVerticals((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewVerticalName('')
    setAddingVertical(false)
  }

  const handleRenameVertical = async (v: VerticalItem) => {
    const name = renamingVerticalName.trim()
    if (!name || name === v.name) { setRenamingVerticalId(null); return }
    const res = await apiFetch(`/api/v1/verticals/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { setRenamingVerticalId(null); return }
    const { data } = await res.json()
    const updateList = (prev: VerticalItem[]) =>
      prev.map((x) => x.id === v.id ? data : x).sort((a, b) => a.name.localeCompare(b.name))
    setAllVerticals(updateList)
    setClientVerticals(updateList)
    setRenamingVerticalId(null)
  }

  const handleDeleteVertical = async (v: VerticalItem) => {
    if (!confirm(`Delete vertical "${v.name}"? All GTM framework data for this vertical across all clients will be lost.`)) return
    await apiFetch(`/api/v1/verticals/${v.id}`, { method: 'DELETE' })
    setAllVerticals((prev) => prev.filter((x) => x.id !== v.id))
    setClientVerticals((prev) => prev.filter((x) => x.id !== v.id))
  }

  const handleAssignVertical = async (v: VerticalItem) => {
    const res = await apiFetch(`/api/v1/clients/${client.id}/verticals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verticalId: v.id }),
    })
    if (!res.ok) return
    setClientVerticals((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const handleUnassignVertical = async (v: VerticalItem) => {
    await apiFetch(`/api/v1/clients/${client.id}/verticals/${v.id}`, { method: 'DELETE' })
    setClientVerticals((prev) => prev.filter((x) => x.id !== v.id))
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Division actions
  const createDivision = async () => {
    if (!newDivisionName.trim()) return
    setSavingDivision(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}/divisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDivisionName.trim() }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setDivisions((prev) => [...prev, data])
        setNewDivisionName('')
        setAddingDivision(false)
        setExpandedIds((prev) => new Set([...prev, data.id]))
      }
    } finally { setSavingDivision(false) }
  }

  const startEditDivision = (d: DivisionData) => {
    setEditingDivisionId(d.id)
    setEditingDivisionName(d.name)
  }

  const saveEditDivision = async (id: string) => {
    if (!editingDivisionName.trim()) return
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}/divisions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingDivisionName.trim() }),
      })
      if (res.ok) {
        setDivisions((prev) => prev.map((d) => d.id === id ? { ...d, name: editingDivisionName.trim() } : d))
        setEditingDivisionId(null)
      }
    } catch { /* ignore */ }
  }

  const deleteDivision = async (id: string) => {
    setDeletingDivisionId(id)
    try {
      await apiFetch(`/api/v1/clients/${client.id}/divisions/${id}`, { method: 'DELETE' })
      setDivisions((prev) => prev.filter((d) => d.id !== id))
      setConfirmDeleteDivision(null)
    } finally {
      setDeletingDivisionId(null)
    }
  }

  // Job actions
  const createJob = async (divisionId: string) => {
    if (!newJobName.trim()) return
    setSavingJob(true)
    try {
      const budgetCents = newJobBudget ? Math.round(parseFloat(newJobBudget) * 100) : undefined
      const res = await apiFetch(`/api/v1/clients/${client.id}/divisions/${divisionId}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newJobName.trim(), budgetCents }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setDivisions((prev) => prev.map((d) =>
          d.id === divisionId ? { ...d, jobs: [...d.jobs, data] } : d,
        ))
        setNewJobName('')
        setNewJobBudget('')
        setAddingJobDivisionId(null)
      }
    } finally { setSavingJob(false) }
  }

  const startEditJob = (divisionId: string, job: DivisionJob) => {
    setEditingJob({ divisionId, job })
    setEditJobName(job.name)
    setEditJobBudget(job.budgetCents != null ? (job.budgetCents / 100).toFixed(2) : '')
  }

  const saveEditJob = async () => {
    if (!editingJob || !editJobName.trim()) return
    const { divisionId, job } = editingJob
    try {
      const budgetCents = editJobBudget ? Math.round(parseFloat(editJobBudget) * 100) : null
      const res = await apiFetch(`/api/v1/clients/${client.id}/divisions/${divisionId}/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editJobName.trim(), budgetCents }),
      })
      if (res.ok) {
        setDivisions((prev) => prev.map((d) =>
          d.id === divisionId
            ? { ...d, jobs: d.jobs.map((j) => j.id === job.id ? { ...j, name: editJobName.trim(), budgetCents } : j) }
            : d,
        ))
        setEditingJob(null)
      }
    } catch { /* ignore */ }
  }

  const deleteJob = async (divisionId: string, jobId: string) => {
    if (!confirm('Delete this job? All associated run tags will be cleared.')) return
    setDeletingJobId(jobId)
    try {
      await apiFetch(`/api/v1/clients/${client.id}/divisions/${divisionId}/jobs/${jobId}`, { method: 'DELETE' })
      setDivisions((prev) => prev.map((d) =>
        d.id === divisionId ? { ...d, jobs: d.jobs.filter((j) => j.id !== jobId) } : d,
      ))
    } finally { setDeletingJobId(null) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── AI Policy ── */}
      <div className={`rounded-xl border p-4 ${client.requireOffline ? 'border-amber-300 bg-amber-50/60' : 'border-border bg-card'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <Icons.ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${client.requireOffline ? 'text-amber-600' : 'text-muted-foreground'}`} />
            <div>
              <p className="text-sm font-medium">Local AI Only</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {client.requireOffline
                  ? 'All workflows for this client are restricted to local Ollama models. Cloud AI providers are blocked.'
                  : 'This client can use any AI provider. Enable this to enforce a local-only policy for this client.'}
              </p>
              {offlineToggleError && <p className="text-[11px] text-red-600 mt-1">{offlineToggleError}</p>}
            </div>
          </div>
          <button
            onClick={toggleRequireOffline}
            disabled={togglingOffline}
            title={client.requireOffline ? 'Disable local-only policy' : 'Enable local-only policy'}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${client.requireOffline ? 'bg-amber-500' : 'bg-border'}`}
          >
            {togglingOffline
              ? <Icons.Loader2 className="h-3 w-3 animate-spin text-white mx-auto" />
              : <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${client.requireOffline ? 'translate-x-4' : 'translate-x-0'}`} />}
          </button>
        </div>
      </div>

    <div className="grid grid-cols-2 gap-4 items-start">

      {/* ── Left card: Divisions & Jobs ── */}
      <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Divisions & Jobs</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organise runs by division and job. Used to tag and filter workflow runs.
          </p>
        </div>
        <Button size="sm" className="h-7 text-xs" onClick={() => { setAddingDivision(true); setNewDivisionName('') }}>
          <Icons.Plus className="mr-1.5 h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Add division inline form */}
      {addingDivision && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
          <Input
            autoFocus
            value={newDivisionName}
            onChange={(e) => setNewDivisionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createDivision(); if (e.key === 'Escape') setAddingDivision(false) }}
            placeholder="Division name…"
            className="h-7 flex-1 text-xs"
          />
          <Button size="sm" className="h-7 text-xs" onClick={createDivision} disabled={savingDivision || !newDivisionName.trim()}>
            {savingDivision ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingDivision(false)}>Cancel</Button>
        </div>
      )}

      {/* Empty state */}
      {divisions.length === 0 && !addingDivision && (
        <div className="flex flex-col items-center py-10 text-center">
          <Icons.FolderOpen className="mb-2 h-7 w-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No divisions yet</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Add a division to organise runs</p>
          <Button size="sm" className="mt-3 h-7 text-xs" onClick={() => setAddingDivision(true)}>
            <Icons.Plus className="mr-1.5 h-3 w-3" />
            Add first division
          </Button>
        </div>
      )}

      {/* Division list */}
      <div className="space-y-3">
        {divisions.map((division) => {
          const isExpanded = expandedIds.has(division.id)
          const isEditingThis = editingDivisionId === division.id

          return (
            <div key={division.id} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Division header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleExpand(division.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Icons.ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                </button>

                {isEditingThis ? (
                  <Input
                    autoFocus
                    value={editingDivisionName}
                    onChange={(e) => setEditingDivisionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditDivision(division.id)
                      if (e.key === 'Escape') setEditingDivisionId(null)
                    }}
                    className="h-6 flex-1 text-xs"
                    onBlur={() => saveEditDivision(division.id)}
                  />
                ) : (
                  <button
                    className="flex-1 text-left text-sm font-medium hover:text-blue-600 transition-colors"
                    onClick={() => toggleExpand(division.id)}
                  >
                    {division.name}
                  </button>
                )}

                <span className="text-xs text-muted-foreground shrink-0">{division.jobs.length} job{division.jobs.length !== 1 ? 's' : ''}</span>

                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => startEditDivision(division)}
                    title="Rename"
                  >
                    <Icons.Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => setConfirmDeleteDivision(division)}
                    title="Delete division"
                  >
                    <Icons.Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Jobs list (expanded) */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/10">
                  {division.jobs.length === 0 && addingJobDivisionId !== division.id && (
                    <div className="px-12 py-3">
                      <p className="text-xs text-muted-foreground/60 italic">No jobs yet</p>
                    </div>
                  )}

                  {division.jobs.map((job) => {
                    const isEditingThisJob = editingJob?.job.id === job.id
                    return (
                      <div key={job.id} className="flex items-center gap-3 border-b border-border/50 last:border-0 px-12 py-2.5">
                        <Icons.Briefcase className="h-3 w-3 text-muted-foreground/60 shrink-0" />

                        {isEditingThisJob ? (
                          <div className="flex flex-1 items-center gap-2">
                            <Input
                              autoFocus
                              value={editJobName}
                              onChange={(e) => setEditJobName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEditJob(); if (e.key === 'Escape') setEditingJob(null) }}
                              placeholder="Job name"
                              className="h-6 flex-1 text-xs"
                            />
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                              <Input
                                value={editJobBudget}
                                onChange={(e) => setEditJobBudget(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEditJob(); if (e.key === 'Escape') setEditingJob(null) }}
                                placeholder="Budget"
                                className="h-6 w-28 pl-5 text-xs"
                                type="number"
                                min="0"
                                step="0.01"
                              />
                            </div>
                            <Button size="sm" className="h-6 text-xs px-2" onClick={saveEditJob}>Save</Button>
                            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditingJob(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <span className="flex-1 text-xs">{job.name}</span>
                            {job.budgetCents != null && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                ${(job.budgetCents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </span>
                            )}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => startEditJob(division.id, job)}
                                title="Edit job"
                              >
                                <Icons.Pencil className="h-2.5 w-2.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 text-muted-foreground hover:text-red-600"
                                onClick={() => deleteJob(division.id, job.id)}
                                disabled={deletingJobId === job.id}
                                title="Delete job"
                              >
                                {deletingJobId === job.id
                                  ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  : <Icons.Trash2 className="h-2.5 w-2.5" />
                                }
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}

                  {/* Add job form */}
                  {addingJobDivisionId === division.id ? (
                    <div className="flex items-center gap-2 px-12 py-2.5 border-t border-border/50">
                      <Icons.Briefcase className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <Input
                        autoFocus
                        value={newJobName}
                        onChange={(e) => setNewJobName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createJob(division.id); if (e.key === 'Escape') setAddingJobDivisionId(null) }}
                        placeholder="Job name…"
                        className="h-6 flex-1 text-xs"
                      />
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input
                          value={newJobBudget}
                          onChange={(e) => setNewJobBudget(e.target.value)}
                          placeholder="Budget"
                          className="h-6 w-28 pl-5 text-xs"
                          type="number"
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <Button size="sm" className="h-6 text-xs px-2" onClick={() => createJob(division.id)} disabled={savingJob || !newJobName.trim()}>
                        {savingJob ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setAddingJobDivisionId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingJobDivisionId(division.id); setNewJobName(''); setNewJobBudget('') }}
                      className="flex w-full items-center gap-2 px-12 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    >
                      <Icons.Plus className="h-3 w-3" />
                      Add job
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>{/* end divisions card */}

      {/* ── Right card: GTM Verticals ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">GTM Verticals</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Markets this client operates in. Each vertical gets its own GTM Framework.</p>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAddingVertical(true)}
          >
            <Icons.Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>

        {/* Add new vertical inline */}
        {addingVertical && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
            <Input
              autoFocus
              value={newVerticalName}
              onChange={(e) => setNewVerticalName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateVertical(); if (e.key === 'Escape') { setAddingVertical(false); setNewVerticalName('') } }}
              placeholder="Vertical name (e.g. Healthcare, Financial Services)"
              className="h-7 flex-1 text-xs"
            />
            <Button size="sm" className="h-7 text-xs px-3" onClick={() => void handleCreateVertical()}>Add</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setAddingVertical(false); setNewVerticalName('') }}>Cancel</Button>
          </div>
        )}

        {/* Assigned verticals */}
        {clientVerticals.length === 0 && !addingVertical && (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">No verticals assigned yet.</p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">Add a vertical to unlock the GTM Framework tab for this client.</p>
          </div>
        )}

        <div className="space-y-1.5">
          {clientVerticals.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <Icons.Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {renamingVerticalId === v.id ? (
                <Input
                  autoFocus
                  value={renamingVerticalName}
                  onChange={(e) => setRenamingVerticalName(e.target.value)}
                  onBlur={() => void handleRenameVertical(v)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameVertical(v); if (e.key === 'Escape') setRenamingVerticalId(null) }}
                  className="h-6 flex-1 text-xs"
                />
              ) : (
                <span className="flex-1 text-sm font-medium">{v.name}</span>
              )}
              {renamingVerticalId !== v.id && (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => { setRenamingVerticalId(v.id); setRenamingVerticalName(v.name) }}
                    title="Rename"
                  >
                    <Icons.Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => void handleUnassignVertical(v)}
                    title="Remove from this client"
                  >
                    <Icons.X className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => void handleDeleteVertical(v)}
                    title="Delete vertical entirely"
                  >
                    <Icons.Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Other available verticals to assign */}
        {allVerticals.filter((v) => !clientVerticals.find((cv) => cv.id === v.id)).length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-muted-foreground">Other verticals — click to assign:</p>
            <div className="flex flex-wrap gap-1.5">
              {allVerticals
                .filter((v) => !clientVerticals.find((cv) => cv.id === v.id))
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => void handleAssignVertical(v)}
                    className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                  >
                    + {v.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>{/* end verticals card */}

    </div>{/* end grid */}

      {/* Delete division confirm dialog */}
      {confirmDeleteDivision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-96 rounded-xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border px-5 py-4 flex items-center gap-2">
              <Icons.Trash2 className="h-4 w-4 text-red-600" />
              <h2 className="text-sm font-semibold">Delete Division</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                Delete <span className="font-medium text-foreground">{confirmDeleteDivision.name}</span>?
              </p>
              {confirmDeleteDivision.jobs.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  This will also delete {confirmDeleteDivision.jobs.length} job{confirmDeleteDivision.jobs.length !== 1 ? 's' : ''} within it.
                  Existing run tags pointing to these jobs will be cleared.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDeleteDivision(null)} disabled={deletingDivisionId != null}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={() => deleteDivision(confirmDeleteDivision.id)}
                disabled={deletingDivisionId != null}
              >
                {deletingDivisionId != null && <Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Scheduled Tasks Tab ───────────────────────────────────────────────────────

type ScheduledTaskType = 'web_scrape' | 'review_miner' | 'audience_signal' | 'seo_intent' | 'research_brief'
type ScheduledTaskFrequency = 'daily' | 'weekly' | 'monthly'
type ScheduledTaskScope = 'client' | 'vertical' | 'company'

interface ScheduledTask {
  id: string; label: string; type: ScheduledTaskType; scope: ScheduledTaskScope
  frequency: ScheduledTaskFrequency; enabled: boolean; lastRunAt: string | null
  nextRunAt: string | null; lastStatus: string; changeDetected: boolean
  lastChangeSummary: string | null; config: Record<string, unknown>
  clientId: string | null; verticalId: string | null
  vertical?: { id: string; name: string } | null
}

const TASK_TYPE_META: Record<ScheduledTaskType, { label: string; icon: keyof typeof Icons; color: string }> = {
  web_scrape:      { label: 'Web Scrape',      icon: 'Globe',       color: 'text-blue-500' },
  review_miner:    { label: 'Review Miner',    icon: 'Star',        color: 'text-amber-500' },
  audience_signal: { label: 'Audience Signal', icon: 'Users',       color: 'text-violet-500' },
  seo_intent:      { label: 'SEO Intent',      icon: 'Search',      color: 'text-green-500' },
  research_brief:  { label: 'Research Brief',  icon: 'FileSearch',  color: 'text-purple-600' },
}

function TaskConfigFields({ type, config, onChange }: {
  type: ScheduledTaskType
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v })
  const inputStyle: React.CSSProperties = { width: '100%', height: 36, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '0 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' }
  const textareaStyle: React.CSSProperties = { width: '100%', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '8px 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }

  const lStyle: React.CSSProperties = { color: '#6b7280', fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }
  const chkLStyle: React.CSSProperties = { color: '#374151', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }

  if (type === 'web_scrape') return (
    <div className="space-y-3">
      <div><label style={lStyle}>Seed URLs (one per line)</label>
        <textarea style={textareaStyle} rows={3} value={(config.seedUrls as string) ?? ''} onChange={(e) => set('seedUrls', e.target.value)} placeholder={'https://example.com/blog\nhttps://competitor.com'} /></div>
      <div><label style={lStyle}>Synthesis Target</label>
        <select style={inputStyle} value={(config.synthesisTarget as string) ?? 'summary'} onChange={(e) => set('synthesisTarget', e.target.value)}>
          <option value="summary">General Summary</option>
          <option value="dg_s7">S7 External Intelligence</option>
          <option value="gtm_12">Competitive Intelligence</option>
          <option value="raw">Raw</option>
        </select></div>
      <label style={chkLStyle}>
        <input type="checkbox" id="stayOnDomain" checked={(config.stayOnDomain as boolean) ?? true} onChange={(e) => set('stayOnDomain', e.target.checked)} />
        Stay on domain
      </label>
      <div><label style={lStyle}>Link filter pattern (optional regex)</label>
        <input style={inputStyle} value={(config.linkPattern as string) ?? ''} onChange={(e) => set('linkPattern', e.target.value)} placeholder="e.g. /blog|/news" /></div>
    </div>
  )

  if (type === 'review_miner') return (
    <div className="space-y-3">
      <div><label style={lStyle}>Company name</label>
        <input style={inputStyle} value={(config.companyName as string) ?? ''} onChange={(e) => set('companyName', e.target.value)} placeholder="Acme Corp" /></div>
      <div><label style={lStyle}>Platforms</label>
        <div className="flex flex-wrap gap-3">
          {(['trustpilot', 'g2', 'capterra'] as const).map((p) => {
            const platforms = (config.platforms as string[]) ?? []
            return (
              <label key={p} style={chkLStyle}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={(e) => set('platforms', e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))} />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            )
          })}
        </div></div>
      <div><label style={lStyle}>Competitors (one per line, optional)</label>
        <textarea style={textareaStyle} rows={2} value={(config.competitors as string) ?? ''} onChange={(e) => set('competitors', e.target.value)} placeholder={'Competitor A\nCompetitor B'} /></div>
      <div><label style={lStyle}>Synthesis type</label>
        <select style={inputStyle} value={(config.synthesis as string) ?? 'full'} onChange={(e) => set('synthesis', e.target.value)}>
          <option value="theme_analysis">Theme Analysis</option>
          <option value="competitive_battlecard">Competitive Battlecard</option>
          <option value="objection_map">Objection Map</option>
          <option value="testimonials">Testimonials</option>
          <option value="full">Full</option>
        </select></div>
    </div>
  )

  if (type === 'audience_signal') return (
    <div className="space-y-3">
      <div><label style={lStyle}>Seed keywords (one per line)</label>
        <textarea style={textareaStyle} rows={3} value={(config.keywords as string) ?? ''} onChange={(e) => set('keywords', e.target.value)} placeholder={'SaaS pricing\nworkflow automation'} /></div>
      <div><label style={lStyle}>Subreddits (one per line, optional)</label>
        <textarea style={textareaStyle} rows={2} value={(config.subreddits as string) ?? ''} onChange={(e) => set('subreddits', e.target.value)} placeholder={'entrepreneur\nsmallbusiness'} /></div>
      <div><label style={lStyle}>Analysis goal</label>
        <select style={inputStyle} value={(config.goal as string) ?? 'full'} onChange={(e) => set('goal', e.target.value)}>
          <option value="pain_points">Pain Points</option>
          <option value="vocabulary_map">Vocabulary Map</option>
          <option value="objection_map">Objection Map</option>
          <option value="question_map">Question Map</option>
          <option value="full">Full</option>
        </select></div>
      <div><label style={lStyle}>Min upvotes</label>
        <input type="number" style={inputStyle} value={(config.minUpvotes as number) ?? 5} onChange={(e) => set('minUpvotes', Number(e.target.value))} min={0} /></div>
    </div>
  )

  if (type === 'seo_intent') return (
    <div className="space-y-3">
      <div><label style={lStyle}>Seed keywords (one per line)</label>
        <textarea style={textareaStyle} rows={3} value={(config.seedKeywords as string) ?? ''} onChange={(e) => set('seedKeywords', e.target.value)} placeholder={'marketing automation\ncontent workflow'} /></div>
      <div><label style={lStyle}>Data source</label>
        <select style={inputStyle} value={(config.dataSource as string) ?? 'claude'} onChange={(e) => set('dataSource', e.target.value)}>
          <option value="claude">Claude inference (no key required)</option>
          <option value="google_autocomplete">Google Autocomplete (free)</option>
          <option value="dataforseo">DataForSEO (paid)</option>
        </select></div>
      <div><label style={lStyle}>Funnel focus</label>
        <select style={inputStyle} value={(config.funnelFocus as string) ?? 'all'} onChange={(e) => set('funnelFocus', e.target.value)}>
          <option value="all">All stages</option>
          <option value="awareness">Awareness</option>
          <option value="consideration">Consideration</option>
          <option value="decision">Decision</option>
        </select></div>
    </div>
  )

  if (type === 'research_brief') {
    const DEFAULT_FORMAT = `Summarize your findings in this format:

1. Top news item (1-2 sentences, include source and date)
2. Emerging risk (specific compliance gap, legal exposure, or timeline pressure)
3. Emerging trend (behavior shift among relevant organizations)
4. Analyst perspective (key claim from a research firm, with source)
5. One strategic question this raises
6. Sources — list every source cited above with article title, publication name, URL, and publish date.`

    return (
      <div className="space-y-3">
        <div>
          <label style={lStyle}>Research prompt</label>
          <textarea
            style={{ ...textareaStyle, minHeight: 120 }}
            rows={6}
            value={(config.prompt as string) ?? ''}
            onChange={(e) => set('prompt', e.target.value)}
            placeholder={'Search the web for [topic] news published in the last 7 days.\n\nFocus on:\n- Key development 1\n- Key development 2\n\nSummarize findings in structured format.'}
          />
          <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>Paste your full research prompt. Be specific about topics, sources, and timeframes.</p>
        </div>
        <div>
          <label style={lStyle}>Recency window</label>
          <select style={inputStyle} value={(config.recencyDays as number) ?? 7} onChange={(e) => set('recencyDays', Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>Filters search results to this time window. Use a longer window for less frequent topics.</p>
        </div>
        <div>
          <label style={lStyle}>Output format <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional — leave blank for default 6-point brief)</span></label>
          <textarea
            style={{ ...textareaStyle, minHeight: 100 }}
            rows={5}
            value={(config.synthesisFormat as string) ?? ''}
            onChange={(e) => set('synthesisFormat', e.target.value)}
            placeholder={DEFAULT_FORMAT}
          />
        </div>
        <div>
          <label style={lStyle}>Tavily API key env var <span style={{ fontWeight: 400, color: '#9ca3af' }}>(defaults to TAVILY_API_KEY)</span></label>
          <input style={inputStyle} value={(config.apiKeyRef as string) ?? ''} onChange={(e) => set('apiKeyRef', e.target.value)} placeholder="TAVILY_API_KEY" />
        </div>
      </div>
    )
  }

  return null
}

function AddTaskModal({ clientId, onClose, onCreated, onUpdated, editTask }: {
  clientId: string
  onClose: () => void
  onCreated?: (t: ScheduledTask) => void
  onUpdated?: (t: ScheduledTask) => void
  editTask?: ScheduledTask
}) {
  const isEdit = !!editTask
  const [type, setType] = useState<ScheduledTaskType>(editTask?.type ?? 'web_scrape')
  const [label, setLabel] = useState(editTask?.label ?? '')
  const [frequency, setFrequency] = useState<ScheduledTaskFrequency>(editTask?.frequency ?? 'weekly')
  const [config, setConfig] = useState<Record<string, unknown>>(editTask?.config ?? {})
  const [verticalId, setVerticalId] = useState<string>(editTask?.verticalId ?? '__client__')
  const [verticals, setVerticals] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => setVerticals(data ?? []))
      .catch(() => {})
  }, [clientId])

  const save = async () => {
    if (!label.trim()) { setError('Label is required'); return }
    setSaving(true); setError(null)
    const isVertical = verticalId !== '__client__'
    try {
      if (isEdit && editTask) {
        // PATCH — type and scope are immutable
        const res = await apiFetch(`/api/v1/scheduled-tasks/${editTask.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: label.trim(),
            frequency,
            config,
            verticalId: isVertical ? verticalId : null,
          }),
        })
        const { data, error: err } = await res.json()
        if (!res.ok) { setError(err ?? 'Failed to update task'); return }
        onUpdated?.(data)
      } else {
        // POST — create new
        const res = await apiFetch('/api/v1/scheduled-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: label.trim(),
            type,
            scope: isVertical ? 'vertical' : 'client',
            frequency,
            clientId,
            ...(isVertical ? { verticalId } : {}),
            config,
          }),
        })
        const { data, error: err } = await res.json()
        if (!res.ok) { setError(err ?? 'Failed to create task'); return }
        onCreated?.(data)
      }
      onClose()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const saveAs = async () => {
    if (!label.trim()) { setError('Label is required'); return }
    setSaving(true); setError(null)
    const isVertical = verticalId !== '__client__'
    const effectiveType = editTask?.type ?? type
    try {
      const res = await apiFetch('/api/v1/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          type: effectiveType,
          scope: isVertical ? 'vertical' : 'client',
          frequency,
          clientId,
          ...(isVertical ? { verticalId } : {}),
          config,
        }),
      })
      const { data, error: err } = await res.json()
      if (!res.ok) { setError(err ?? 'Failed to create task'); return }
      onCreated?.(data)
      onClose()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[520px] max-h-[90vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Purple header — same pattern as WorkflowCreationModal */}
        <div className="rounded-t-xl px-6 py-5" style={{ backgroundColor: '#a200ee' }}>
          <div className="flex items-center gap-2">
            <Icons.CalendarClock className="h-5 w-5 text-white/80" />
            <h2 className="text-base font-semibold text-white">{isEdit ? 'Edit Scheduled Task' : 'Add Scheduled Task'}</h2>
            <button onClick={onClose} className="ml-auto rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors">
              <Icons.X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-white/70 pl-7">Automate recurring research to keep the brain up to date.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5" style={{ backgroundColor: '#ffffff', color: '#111827' }}>
          {/* Vertical / brain destination */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: '#6b7280' }}>Write research to</p>
            <select
              value={verticalId}
              onChange={(e) => setVerticalId(e.target.value)}
              style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '0 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
            >
              <option value="__client__">Client brain (no vertical)</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Type selector — hidden when editing (type is immutable) */}
          {!isEdit && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: '#6b7280' }}>Task type</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(TASK_TYPE_META) as [ScheduledTaskType, typeof TASK_TYPE_META[ScheduledTaskType]][]).map(([t, meta]) => {
                  const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
                  const active = type === t
                  return (
                    <button key={t} onClick={() => { setType(t); setConfig({}) }}
                      style={{
                        border: active ? '1px solid #a200ee' : '1px solid #e5e7eb',
                        backgroundColor: active ? '#fdf5ff' : '#f9fafb',
                        color: active ? '#7c00cc' : '#111827',
                        borderRadius: 8, padding: '10px 12px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        textAlign: 'left', fontSize: 12, cursor: 'pointer',
                        transition: 'border-color 0.15s',
                      }}>
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
                      <span className="font-medium">{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Label + frequency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: '#6b7280' }}>Label</p>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Weekly competitor reviews"
                style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '0 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: '#6b7280' }}>Frequency</p>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduledTaskFrequency)}
                style={{ width: '100%', height: 36, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', padding: '0 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          {/* Type-specific config */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: '#6b7280' }}>Configuration</p>
            <TaskConfigFields type={type} config={config} onChange={setConfig} />
          </div>

          {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid #e5e7eb', backgroundColor: '#ffffff' }}>
          <button onClick={onClose} style={{ height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#ffffff', fontSize: 12, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          {isEdit && (
            <button onClick={saveAs} disabled={saving} style={{ height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #a200ee', backgroundColor: '#ffffff', fontSize: 12, fontWeight: 600, color: '#a200ee', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              {saving ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Copy className="h-3.5 w-3.5" />}
              Save As New
            </button>
          )}
          <button onClick={save} disabled={saving} style={{ height: 32, padding: '0 14px', borderRadius: 6, border: 'none', backgroundColor: '#a200ee', fontSize: 12, fontWeight: 600, color: '#ffffff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Check className="h-3.5 w-3.5" />}
            {isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskOutputModal({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/v1/scheduled-tasks/${task.id}/output`)
      .then((r) => r.json())
      .then(({ data }) => setText(data?.text ?? null))
      .catch(() => setText(null))
      .finally(() => setLoading(false))
  }, [task.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[680px] max-h-[85vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-t-xl px-6 py-4 flex items-center justify-between" style={{ backgroundColor: '#a200ee' }}>
          <div>
            <h2 className="text-sm font-semibold text-white">{task.label}</h2>
            {task.vertical && <p className="text-xs text-white/70 mt-0.5">{task.vertical.name}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ backgroundColor: '#ffffff' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
            </div>
          ) : text ? (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: '#111827', fontFamily: 'inherit' }}>{text}</pre>
          ) : (
            <p className="text-sm text-center py-12" style={{ color: '#6b7280' }}>No output yet — run the task first.</p>
          )}
        </div>
        {text && (
          <div className="px-6 py-3 flex justify-end" style={{ borderTop: '1px solid #e5e7eb', backgroundColor: '#ffffff' }}>
            <button onClick={() => navigator.clipboard.writeText(text ?? '')}
              style={{ height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#ffffff', fontSize: 12, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduledTasksTab({ clientId }: { clientId: string }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [viewingTask, setViewingTask] = useState<ScheduledTask | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    apiFetch(`/api/v1/scheduled-tasks?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setTasks(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId])

  const toggle = async (task: ScheduledTask) => {
    await apiFetch(`/api/v1/scheduled-tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    })
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, enabled: !t.enabled } : t))
  }

  const runNow = async (id: string) => {
    setRunning((prev) => new Set([...prev, id]))
    await apiFetch(`/api/v1/scheduled-tasks/${id}/run-now`, { method: 'POST' }).catch(() => {})
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, lastStatus: 'running' } : t))
    setTimeout(() => setRunning((prev) => { const s = new Set(prev); s.delete(id); return s }), 3000)
  }

  const del = async (id: string) => {
    await apiFetch(`/api/v1/scheduled-tasks/${id}`, { method: 'DELETE' })
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      idle: 'bg-muted text-muted-foreground',
      running: 'bg-blue-500/10 text-blue-500',
      success: 'bg-green-500/10 text-green-600',
      failed: 'bg-red-500/10 text-red-500',
    }
    return (
      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', map[status] ?? map.idle)}>
        {status}
      </span>
    )
  }

  const relTime = (iso: string | null) => {
    if (!iso) return 'Never'
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  const nextIn = (iso: string | null) => {
    if (!iso) return '—'
    const diff = new Date(iso).getTime() - Date.now()
    if (diff <= 0) return 'overdue'
    if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`
    return `in ${Math.floor(diff / 86400000)}d`
  }

  const filteredTasks = tasks
    .filter((t) => t.label.toLowerCase().includes(search.toLowerCase()) || (t.vertical?.name ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Scheduled Tasks</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Research tasks that run automatically and feed results into the client brain.</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          <Icons.Plus className="h-3.5 w-3.5" />
          Add Task
        </button>
      </div>

      <div className="relative">
        <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks..."
          className="w-full rounded-lg border border-border bg-muted/30 py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Icons.Clock className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No scheduled tasks yet</p>
          <p className="max-w-xs text-xs text-muted-foreground/70">Add a task to automatically gather industry signals, competitor reviews, or SEO data on a recurring basis.</p>
          <button onClick={() => setShowAdd(true)} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Add your first task
          </button>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
          <Icons.Search className="h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No tasks match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => {
            const meta = TASK_TYPE_META[task.type]
            const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
            return (
              <div key={task.id} className={cn('rounded-xl border bg-card p-4', task.changeDetected ? 'border-amber-500/40' : 'border-border')}>
                <div className="flex items-start gap-3">
                  <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30')}>
                    <Icon className={cn('h-3.5 w-3.5', meta.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{task.label}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{meta.label}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize">{task.frequency}</span>
                      {task.vertical && (
                        <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">{task.vertical.name}</span>
                      )}
                      {statusBadge(task.lastStatus)}
                      {task.changeDetected && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">update detected</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>Last run: {relTime(task.lastRunAt)}</span>
                      <span>·</span>
                      <span>Next: {nextIn(task.nextRunAt)}</span>
                    </div>
                    {task.changeDetected && task.lastChangeSummary && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{task.lastChangeSummary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Enable/disable toggle */}
                    <button onClick={() => toggle(task)}
                      className={cn('relative h-5 w-9 rounded-full transition-colors', task.enabled ? 'bg-blue-600' : 'bg-muted')}
                      title={task.enabled ? 'Disable' : 'Enable'}>
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', task.enabled ? 'left-4' : 'left-0.5')} />
                    </button>
                    {task.lastStatus === 'success' && (
                      <button onClick={() => setViewingTask(task)}
                        className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="View output">
                        <Icons.FileText className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => runNow(task.id)} disabled={running.has(task.id) || task.lastStatus === 'running'}
                      className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                      title="Run now">
                      {running.has(task.id) ? '…' : '▶'}
                    </button>
                    <button onClick={() => setEditingTask(task)} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Edit">
                      <Icons.Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => del(task.id)} className="rounded p-1 text-muted-foreground hover:text-red-500" title="Delete">
                      <Icons.Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddTaskModal
          clientId={clientId}
          onClose={() => setShowAdd(false)}
          onCreated={(t) => setTasks((prev) => [t, ...prev])}
        />
      )}

      {viewingTask && <TaskOutputModal task={viewingTask} onClose={() => setViewingTask(null)} />}

      {editingTask && (
        <AddTaskModal
          clientId={clientId}
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
          onCreated={(t) => {
            setTasks((prev) => [t, ...prev])
            setEditingTask(null)
          }}
          onUpdated={(t) => {
            setTasks((prev) => prev.map((x) => x.id === t.id ? t : x))
            setEditingTask(null)
          }}
        />
      )}
    </div>
  )
}

// ── End Scheduled Tasks Tab ───────────────────────────────────────────────────

const TABS = ['overview', 'workflows', 'campaigns', 'deliverables', 'library', 'framework', 'demandgen', 'branding', 'brain', 'gtm-assessment', 'stakeholders', 'access', 'reviews', 'insights', 'runs', 'reports', 'profile', 'company', 'structure', 'scheduled-tasks', 'doc-style'] as const
type Tab = (typeof TABS)[number]

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const initialTab = (searchParams.get('tab') as Tab | null)
  const [activeTab, setActiveTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? initialTab as Tab : 'overview')

  // Keep URL in sync so navigate(-1) restores the correct tab
  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setSearchParams({ tab }, { replace: true })
  }, [setSearchParams])
  const [showEditClient, setShowEditClient] = useState(false)
  const [archivingClient, setArchivingClient] = useState(false)
  const { isAdmin } = useCurrentUser()

  const loadClient = useCallback(() => {
    if (!id) return
    setLoading(true)
    apiFetch(`/api/v1/clients/${id}`)
      .then((r) => r.json())
      .then(({ data }) => setClient(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const handleArchiveClient = async () => {
    if (!client) return
    const newStatus = client.status === 'archived' ? 'active' : 'archived'
    if (newStatus === 'archived' && !confirm(`Archive ${client.name}? They will be moved to the archived section.`)) return
    setArchivingClient(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      const { data } = await res.json()
      setClient((prev) => prev ? { ...prev, status: data.status, archivedAt: data.archivedAt } : prev)
    } catch (err) {
      console.error(err)
    } finally {
      setArchivingClient(false)
    }
  }

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
    overview:      'Overview',
    workflows:     'Workflows',
    campaigns:     'Campaigns',
    deliverables:  'Deliverables',
    library:       'Library',
    framework:     'GTM Framework',
    demandgen:     'Demand Gen',
    branding:      'Branding',
    brain:         'Client Brain',
    'gtm-assessment': 'Company Assessment',
    stakeholders:  'Contacts',
    access:        'Access',
    reviews:       'Reviews',
    insights:      'Insights',
    runs:          'Runs',
    reports:       'Reports & Usage',
    profile:       'Company Profiler',
    company:       'Company Research',
    structure:     'Structure',
    'scheduled-tasks': 'Scheduled Tasks',
    'doc-style':       'Doc Style',
  }

  // Tabs that live under the "Demand Gen" group
  const DEMAND_GEN_TABS: Tab[] = ['demandgen', 'campaigns']
  // Tabs that live under the "Research" group
  const RESEARCH_TABS: Tab[] = ['company', 'profile', 'gtm-assessment']
  // Tabs that live under the "Settings" group
  const SETTINGS_TABS: Tab[] = ['brain', 'structure', 'reports', 'access', 'stakeholders', 'runs', 'scheduled-tasks', 'doc-style']
  // Tabs rendered before the Demand Gen group button
  const PRE_DEMAND_GEN_TABS: Tab[] = ['overview', 'library', 'framework', 'branding', 'reviews']
  // Tabs rendered after the Demand Gen group button
  const POST_DEMAND_GEN_TABS: Tab[] = ['workflows', 'deliverables', 'insights']
  const MAIN_TABS: Tab[] = [...PRE_DEMAND_GEN_TABS, ...POST_DEMAND_GEN_TABS]
  const inDemandGen = DEMAND_GEN_TABS.includes(activeTab)
  const inResearch = RESEARCH_TABS.includes(activeTab)
  const inSettings = SETTINGS_TABS.includes(activeTab)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6 print:hidden">
        <button
          onClick={() => navigate('/clients')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.ChevronLeft className="h-4 w-4" />
        </button>
        <div className="h-5 w-px bg-border" />
        <ClientLogoAvatar logoUrl={client.logoUrl} name={client.name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold leading-tight truncate">{client.name}</h1>
            {client.status === 'archived' && (
              <span className="shrink-0 text-[10px] text-amber-500/80">archived</span>
            )}
          </div>
          {client.industry && (
            <p className="text-[11px] text-muted-foreground">{client.industry}</p>
          )}
        </div>
      </header>

      {/* Tabs — primary row */}
      <div className="flex gap-0 border-b border-border bg-card px-6 print:hidden">
        {PRE_DEMAND_GEN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        {/* Demand Gen group entry point */}
        <button
          onClick={() => switchTab('demandgen')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
            inDemandGen
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Icons.TrendingUp className="h-3 w-3" />
          Demand Gen
        </button>
        {POST_DEMAND_GEN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        {/* Settings group entry point */}
        <button
          onClick={() => switchTab('structure')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ml-auto',
            inSettings
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Icons.Settings className="h-3 w-3" />
          Settings
        </button>
        {/* Research group entry point */}
        <button
          onClick={() => switchTab('company')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
            inResearch
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <Icons.Search className="h-3 w-3" />
          Research
        </button>
      </div>

      {/* Demand Gen sub-tab row — only visible when a demand gen tab is active */}
      {inDemandGen && (
        <div className="flex items-center border-b border-border bg-muted/30 px-6 print:hidden">
          <div className="flex gap-0">
            {DEMAND_GEN_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={cn(
                  'px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Research sub-tab row — only visible when a research tab is active */}
      {inResearch && (
        <div className="flex items-center border-b border-border bg-muted/30 px-6 print:hidden">
          <div className="flex gap-0">
            {RESEARCH_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={cn(
                  'px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings sub-tab row — only visible when a settings tab is active */}
      {inSettings && (
        <div className="flex items-center border-b border-border bg-muted/30 px-6 print:hidden">
          <div className="flex gap-0 flex-1">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={cn(
                  'px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 py-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setShowEditClient(true)}
                title="Edit client"
              >
                <Icons.Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-600"
                onClick={handleArchiveClient}
                disabled={archivingClient}
                title={client.status === 'archived' ? 'Unarchive client' : 'Archive client'}
              >
                {archivingClient
                  ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : client.status === 'archived'
                    ? <Icons.ArchiveRestore className="h-3.5 w-3.5" />
                    : <Icons.Archive className="h-3.5 w-3.5" />
                }
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'framework'
        ? <div className="flex-1 overflow-hidden"><ClientFrameworkTab clientId={client.id} clientName={client.name} /></div>
        : activeTab === 'demandgen'
        ? <div className="flex-1 overflow-hidden"><ClientDemandGenTab clientId={client.id} /></div>
        : activeTab === 'branding'
        ? <div className="flex-1 overflow-hidden"><ClientBrandingTab clientId={client.id} clientName={client.name} /></div>
        : <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && <OverviewTab client={client} onTabChange={switchTab} onUpdate={(data) => setClient((prev) => prev ? { ...prev, ...data } : prev)} />}
        {activeTab === 'workflows' && <WorkflowsTab client={client} onUpdate={setClient} />}
        {activeTab === 'campaigns' && <CampaignsTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'deliverables' && <ClientDeliverablesTab clientId={client.id} />}
        {activeTab === 'library' && (
          <div className="space-y-10">
            <ClientLibraryTab clientId={client.id} />
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Icons.Sparkles className="h-4 w-4 text-violet-500" />
                <h2 className="text-[15px] font-semibold">Prompt Library</h2>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600">Brain-powered</span>
              </div>
              <ClientPromptLibraryTab clientId={client.id} />
            </div>
          </div>
        )}
        {activeTab === 'brain' && <ClientBrainTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'gtm-assessment' && <ClientGTMAssessmentTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'stakeholders' && <StakeholdersTab client={client} onUpdate={setClient} />}
        {activeTab === 'access' && <AccessTab client={client} />}
        {activeTab === 'reviews' && <ReviewsTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'insights' && <InsightsTab insights={client.insights} />}
        {activeTab === 'runs' && <RunsIntelligenceTab clientId={client.id} />}
        {activeTab === 'reports' && <ClientBillingReportsTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'profile' && <ProfileTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'company' && <CompanyProfileTab clientId={client.id} clientName={client.name} />}
        {activeTab === 'structure' && <StructureTab client={client} onUpdate={(data) => setClient((prev) => prev ? { ...prev, ...data } : prev)} />}
        {activeTab === 'scheduled-tasks' && <ScheduledTasksTab clientId={client.id} />}
        {activeTab === 'doc-style' && <ClientDocStyleTab clientId={client.id} />}
      </div>}

      {showEditClient && (
        <EditClientModal
          client={client}
          onClose={() => setShowEditClient(false)}
          onUpdate={(data) => {
            setClient((prev) => prev ? { ...prev, ...data } : prev)
            setShowEditClient(false)
          }}
        />
      )}
    </div>
  )
}
