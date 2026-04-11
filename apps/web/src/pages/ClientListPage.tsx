import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'

interface Client {
  id: string
  name: string
  slug: string
  industry: string | null
  logoUrl: string | null
  status: string
  archivedAt: string | null
  createdAt: string
  stakeholderCount: number
  workflowCount: number
  feedbackCount: number
  lastActivity: string | null
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return 'No activity'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ── Create Client Modal ───────────────────────────────────────────────────────

function LogoAvatar({
  logoUrl,
  name,
  size = 'md',
}: {
  logoUrl: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dims = { sm: 'h-8 w-8 text-xs', md: 'h-12 w-12 text-sm', lg: 'h-16 w-16 text-lg' }[size]
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  if (logoUrl) {
    return (
      <img
        src={logoUrl.startsWith('/') ? assetUrl(logoUrl) : logoUrl}
        alt={name}
        className={`${dims} rounded-lg object-contain border border-border bg-white`}
      />
    )
  }
  return (
    <div
      className={`${dims} rounded-lg flex items-center justify-center font-semibold shrink-0`}
      style={{ backgroundColor: '#f3e8ff', color: '#a200ee' }}
    >
      {initials || <Icons.Building2 className="h-1/2 w-1/2" />}
    </div>
  )
}

function LogoUpload({
  currentUrl,
  clientName,
  onFile,
}: {
  currentUrl: string | null
  clientName: string
  onFile: (file: File) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onFile(file)
    setPreview(URL.createObjectURL(file))
  }

  return (
    <div className="flex items-center gap-3">
      <LogoAvatar logoUrl={preview ?? currentUrl} name={clientName} size="lg" />
      <label className="cursor-pointer">
        <span className="text-xs font-medium text-purple-600 hover:text-purple-700 hover:underline">
          {(preview ?? currentUrl) ? 'Change logo' : 'Upload logo'}
        </span>
        <p className="text-[11px] text-muted-foreground mt-0.5">PNG, JPG, SVG, WebP</p>
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
          className="hidden"
          onChange={handleChange}
        />
      </label>
    </div>
  )
}

function CreateClientModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (client: Client) => void
}) {
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/v1/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), industry: industry.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to create client')
      }
      const { data } = await res.json()

      // Upload logo if selected
      if (logoFile) {
        const form = new FormData()
        form.append('file', logoFile)
        await apiFetch(`/api/v1/clients/${data.id}/logo`, { method: 'POST', body: form })
        data.logoUrl = `/api/v1/clients/${data.id}/logo`
      }

      onCreate(data)
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
          <h2 className="text-sm font-semibold text-white">New Client</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <LogoUpload currentUrl={null} clientName={name || 'Client'} onFile={setLogoFile} />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Client Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Industry</Label>
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. SaaS, Healthcare, Finance"
              className="h-8 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim()} className="h-8 text-xs">
              {loading ? <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              Create Client
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit Client Modal ─────────────────────────────────────────────────────────

function EditClientModal({ client, onClose, onUpdate }: {
  client: Client
  onClose: () => void
  onUpdate: (updated: Client) => void
}) {
  const [name, setName] = useState(client.name)
  const [industry, setIndustry] = useState(client.industry ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

      onUpdate({ ...client, ...data, logoUrl })
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
          <LogoUpload currentUrl={client.logoUrl} clientName={name || client.name} onFile={setLogoFile} />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Client Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Industry</Label>
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. SaaS, Healthcare, Finance"
              className="h-8 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim()} className="h-8 text-xs">
              {loading ? <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ClientListPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchVal, setSearchVal] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then(({ data }) => setClients(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const activeClients = clients.filter((c) => c.status !== 'archived')
  const archivedClients = clients.filter((c) => c.status === 'archived')

  const filterClients = (list: Client[]) =>
    list.filter(
      (c) =>
        c.name.toLowerCase().includes(searchVal.toLowerCase()) ||
        (c.industry ?? '').toLowerCase().includes(searchVal.toLowerCase()),
    )

  const filteredActive = filterClients(activeClients)
  const filteredArchived = filterClients(archivedClients)

  const handleDelete = async (client: Client, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Permanently delete "${client.name}"? This cannot be undone.`)) return
    setDeleting(client.id)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setClients((prev) => prev.filter((c) => c.id !== client.id))
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(null)
    }
  }

  const handleArchiveToggle = async (client: Client, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const newStatus = client.status === 'archived' ? 'active' : 'archived'
    setArchiving(client.id)
    try {
      const res = await apiFetch(`/api/v1/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      const { data } = await res.json()
      setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, status: data.status, archivedAt: data.archivedAt } : c)))
      if (newStatus === 'archived') setArchivedOpen(true)
    } catch (err) {
      console.error(err)
    } finally {
      setArchiving(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Page header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.Users className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Clients</h1>
          <Badge variant="outline" className="text-xs">{activeClients.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="Search clients…"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={() => setShowCreate(true)}>
            <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
            New Client
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Active clients */}
            {filteredActive.length === 0 && !searchVal ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Icons.Users className="mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No clients yet</p>
                <Button size="sm" className="mt-4 h-8 text-xs" onClick={() => setShowCreate(true)}>
                  <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add first client
                </Button>
              </div>
            ) : filteredActive.length === 0 && searchVal ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No active clients match your search</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredActive.map((client) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    onEdit={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(client) }}
                    onArchive={(e) => handleArchiveToggle(client, e)}
                    onDelete={(e) => handleDelete(client, e)}
                    archiving={archiving === client.id || deleting === client.id}
                  />
                ))}
              </div>
            )}

            {/* Archived clients */}
            {archivedClients.length > 0 && (
              <div>
                <button
                  onClick={() => setArchivedOpen((v) => !v)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
                >
                  <Icons.Archive className="h-3.5 w-3.5" />
                  <span>Archived ({archivedClients.length})</span>
                  <Icons.ChevronDown className={cn('h-3.5 w-3.5 transition-transform', archivedOpen && 'rotate-180')} />
                </button>

                {archivedOpen && (
                  filteredArchived.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No archived clients match your search</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 opacity-70">
                      {filteredArchived.map((client) => (
                        <ClientCard
                          key={client.id}
                          client={client}
                          onEdit={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(client) }}
                          onArchive={(e) => handleArchiveToggle(client, e)}
                          onDelete={(e) => handleDelete(client, e)}
                          archiving={archiving === client.id || deleting === client.id}
                        />
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateClientModal
          onClose={() => setShowCreate(false)}
          onCreate={(c) => {
            setClients((prev) => [c, ...prev])
            setShowCreate(false)
            navigate(`/clients/${c.id}`)
          }}
        />
      )}

      {editing && (
        <EditClientModal
          client={editing}
          onClose={() => setEditing(null)}
          onUpdate={(updated) => {
            setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Client Card ───────────────────────────────────────────────────────────────

function ClientCard({
  client,
  onEdit,
  onArchive,
  onDelete,
  archiving,
}: {
  client: Client
  onEdit: (e: React.MouseEvent) => void
  onArchive: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  archiving: boolean
}) {
  const isArchived = client.status === 'archived'

  return (
    <Link
      to={`/clients/${client.id}`}
      className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-blue-500/50 hover:bg-card/80"
    >
      {/* Action buttons — top right, always visible on hover */}
      <div
        className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        {!isArchived && (
          <button
            onClick={onEdit}
            title="Edit client"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icons.Pencil className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={onArchive}
          disabled={archiving}
          title={isArchived ? 'Unarchive client' : 'Archive client'}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-amber-400 transition-colors"
        >
          {archiving
            ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
            : isArchived
              ? <Icons.ArchiveRestore className="h-3 w-3" />
              : <Icons.Archive className="h-3 w-3" />
          }
        </button>
        {isArchived && (
          <button
            onClick={onDelete}
            title="Permanently delete client"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors"
          >
            <Icons.Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Logo + Name + industry */}
      <div className="flex items-center gap-3 pr-14">
        <LogoAvatar logoUrl={client.logoUrl} name={client.name} size="sm" />
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-tight truncate group-hover:text-blue-400">
              {client.name}
            </p>
            {isArchived && (
              <span className="shrink-0 text-[10px] text-amber-500/80">archived</span>
            )}
          </div>
          {client.industry && (
            <p className="text-xs text-muted-foreground truncate">{client.industry}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-2">
        <StatCell icon={Icons.Users} value={client.stakeholderCount} label="contacts" />
        <StatCell icon={Icons.Workflow} value={client.workflowCount} label="workflows" />
        <StatCell icon={Icons.MessageSquare} value={client.feedbackCount} label="feedback" />
      </div>

      {/* Last activity + research quick links */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <Icons.Clock className="mr-1 inline h-3 w-3" />
          {timeAgo(client.lastActivity)}
        </p>
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <Link
            to={`/clients/${client.id}?tab=profile`}
            title="Brand Profile"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Icons.Mic className="h-3 w-3" /> Profile
          </Link>
          <Link
            to={`/clients/${client.id}?tab=company`}
            title="Company Backgrounder"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Icons.Building2 className="h-3 w-3" /> Company
          </Link>
        </div>
      </div>
    </Link>
  )
}

function StatCell({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  label: string
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-0.5">
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}
