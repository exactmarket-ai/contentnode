import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export function portalFetch(token: string, path: string, options?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
}

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
  client: { id: string; name: string; slug: string }
}

interface Deliverable {
  id: string
  workflowName: string
  status: string
  finalOutput: unknown
  createdAt: string
  completedAt: string | null
}

function extractPreview(output: unknown): string {
  if (!output) return ''
  if (typeof output === 'string') return output.slice(0, 200)
  const o = output as Record<string, unknown>
  if (o.content && typeof o.content === 'string') return o.content.slice(0, 200)
  return ''
}

export function PortalPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [stakeholder, setStakeholder] = useState<Stakeholder | null>(null)
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('No access token provided. Please use the link from your email.')
      setLoading(false)
      return
    }

    Promise.all([
      portalFetch(token, '/portal/auth/verify'),
      portalFetch(token, '/portal/deliverables'),
    ])
      .then(async ([verifyRes, delivRes]) => {
        if (!verifyRes.ok) throw new Error('Invalid or expired link. Please request a new one.')
        const { data: sh } = await verifyRes.json()
        const { data: dels } = await delivRes.json()
        setStakeholder(sh.stakeholder)
        setDeliverables(dels)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [token])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Icons.Link2Off className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Icons.FileText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">{stakeholder?.client.name}</p>
              <p className="text-[11px] text-muted-foreground">Content Review Portal</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium">{stakeholder?.name}</p>
            <p className="text-[11px] text-muted-foreground">{stakeholder?.email}</p>
          </div>
        </div>
      </header>

      {/* Deliverables list */}
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-6 text-base font-semibold">
          {deliverables.length === 0 ? 'No deliverables yet' : `${deliverables.length} deliverable${deliverables.length !== 1 ? 's' : ''} ready for review`}
        </h1>

        <div className="space-y-3">
          {deliverables.map((d) => {
            const preview = extractPreview(d.finalOutput)
            return (
              <div
                key={d.id}
                className="rounded-xl border border-border bg-card p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{d.workflowName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.completedAt
                        ? new Date(d.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      }
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    d.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {d.status === 'completed' ? 'Ready' : 'Awaiting feedback'}
                  </span>
                </div>

                {preview && (
                  <p className="line-clamp-3 text-xs text-muted-foreground leading-relaxed">
                    {preview}{preview.length === 200 ? '…' : ''}
                  </p>
                )}

                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => navigate(`/portal/review/${d.id}?token=${token}`)}
                >
                  <Icons.ClipboardEdit className="mr-1.5 h-3.5 w-3.5" />
                  Review &amp; give feedback
                </Button>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
