import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface Client {
  id: string
  name: string
  slug: string
  industry: string | null
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

function CreateClientModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (client: Client) => void
}) {
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/v1/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), industry: industry.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to create client')
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
      <div className="w-[440px] rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">New Client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ClientListPage() {
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/v1/clients`)
      .then((r) => r.json())
      .then(({ data }) => setClients(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.industry ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Page header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-3">
          <Icons.Users className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Clients</h1>
          <Badge variant="outline" className="text-xs">{clients.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Icons.Users className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No clients match your search' : 'No clients yet'}
            </p>
            {!search && (
              <Button size="sm" className="mt-4 h-8 text-xs" onClick={() => setShowCreate(true)}>
                <Icons.Plus className="mr-1.5 h-3.5 w-3.5" />
                Add first client
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((client) => (
              <button
                key={client.id}
                onClick={() => navigate(`/clients/${client.id}`)}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-blue-500/50 hover:bg-card/80"
              >
                {/* Name + industry */}
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight group-hover:text-blue-400">
                      {client.name}
                    </p>
                    <Icons.ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  {client.industry && (
                    <p className="text-xs text-muted-foreground">{client.industry}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-2">
                  <StatCell icon={Icons.Users} value={client.stakeholderCount} label="contacts" />
                  <StatCell icon={Icons.Workflow} value={client.workflowCount} label="workflows" />
                  <StatCell icon={Icons.MessageSquare} value={client.feedbackCount} label="feedback" />
                </div>

                {/* Last activity */}
                <p className="text-xs text-muted-foreground">
                  <Icons.Clock className="mr-1 inline h-3 w-3" />
                  {timeAgo(client.lastActivity)}
                </p>
              </button>
            ))}
          </div>
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
    </div>
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
