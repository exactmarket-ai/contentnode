import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiFetch } from '@/lib/api'

interface Workflow {
  id: string
  name: string
  status: string
  connectivityMode: string
  updatedAt: string
  isTemplate: boolean
  templateCategory: string | null
  templateDescription: string | null
  client: { id: string; name: string } | null
  _count: { runs: number }
}

const TEMPLATE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'blog', label: 'Blog' },
  { value: 'social', label: 'Social Media' },
  { value: 'email', label: 'Email' },
  { value: 'seo', label: 'SEO' },
  { value: 'reporting', label: 'Reporting' },
  { value: 'review', label: 'Review & Approval' },
]

const STATUS_STYLES: Record<string, string> = {
  draft:    'bg-zinc-100 text-zinc-600',
  active:   'bg-emerald-100 text-emerald-700',
  archived: 'bg-zinc-100 text-zinc-500',
}

interface PromoteModal {
  workflowId: string
  workflowName: string
  category: string
  description: string
  isCurrentlyTemplate: boolean
}

export function WorkflowListPage() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [promoteModal, setPromoteModal] = useState<PromoteModal | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    apiFetch('/api/v1/workflows')
      .then((r) => r.json())
      .then(({ data }) => { setWorkflows(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === workflows.length ? new Set() : new Set(workflows.map((w) => w.id))
    )
  }

  async function handleDeleteSelected() {
    if (!confirm(`Delete ${selected.size} workflow${selected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await Promise.all([...selected].map((id) => apiFetch(`/api/v1/workflows/${id}`, { method: 'DELETE' })))
      setWorkflows((prev) => prev.filter((w) => !selected.has(w.id)))
      setSelected(new Set())
    } catch {
      alert('Failed to delete some workflows')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteOne(wf: Workflow) {
    if (!confirm(`Delete "${wf.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await apiFetch(`/api/v1/workflows/${wf.id}`, { method: 'DELETE' })
      setWorkflows((prev) => prev.filter((w) => w.id !== wf.id))
      setSelected((prev) => { const next = new Set(prev); next.delete(wf.id); return next })
    } catch {
      alert('Failed to delete workflow')
    } finally {
      setDeleting(false)
    }
  }

  function startRename(wf: Workflow) {
    setRenamingId(wf.id)
    setRenameValue(wf.name)
  }

  async function commitRename(id: string) {
    const trimmed = renameValue.trim()
    setRenamingId(null)
    if (!trimmed) return
    const current = workflows.find((w) => w.id === id)
    if (!current || trimmed === current.name) return
    setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, name: trimmed } : w))
    try {
      await apiFetch(`/api/v1/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      })
    } catch {
      // Revert on failure
      setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, name: current.name } : w))
    }
  }

  function openPromoteModal(wf: Workflow) {
    setPromoteModal({
      workflowId: wf.id,
      workflowName: wf.name,
      category: wf.templateCategory ?? 'general',
      description: wf.templateDescription ?? '',
      isCurrentlyTemplate: wf.isTemplate,
    })
  }

  async function handlePromote() {
    if (!promoteModal) return
    setPromoting(true)
    try {
      const res = await apiFetch(`/api/v1/workflows/${promoteModal.workflowId}/promote-template`, {
        method: 'POST',
        body: JSON.stringify({
          isTemplate: !promoteModal.isCurrentlyTemplate,
          templateCategory: promoteModal.category,
          templateDescription: promoteModal.description || undefined,
        }),
      })
      if (!res.ok) { alert('Failed to update template status'); return }
      const { data } = await res.json()
      setWorkflows((prev) => prev.map((w) => w.id === data.id ? { ...w, isTemplate: data.isTemplate, templateCategory: data.templateCategory, templateDescription: data.templateDescription } : w))
      setPromoteModal(null)
    } catch {
      alert('Network error')
    } finally {
      setPromoting(false)
    }
  }

  const allSelected = workflows.length > 0 && selected.size === workflows.length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Promote-to-Template Modal */}
      {promoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[440px] rounded-xl border border-border bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-5 flex items-center gap-2" style={{ backgroundColor: '#a200ee' }}>
              <Icons.Bookmark className="h-5 w-5 text-white/80" />
              <h2 className="text-base font-semibold text-white">
                {promoteModal.isCurrentlyTemplate ? 'Remove Template' : 'Save as Template'}
              </h2>
              <button onClick={() => setPromoteModal(null)} className="ml-auto rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors">
                <Icons.X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {promoteModal.isCurrentlyTemplate ? (
                <p className="text-sm text-muted-foreground">
                  Remove <strong>{promoteModal.workflowName}</strong> from your organization's templates? It will still exist as a regular workflow.
                </p>
              ) : (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    Make <strong>{promoteModal.workflowName}</strong> available as a starting template when creating new workflows across your organization.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Category</Label>
                    <Select value={promoteModal.category} onValueChange={(v) => setPromoteModal((m) => m ? { ...m, category: v } : m)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Description <span className="text-muted-foreground/50">(optional)</span></Label>
                    <Input
                      placeholder="Short description shown in the template picker…"
                      value={promoteModal.description}
                      onChange={(e) => setPromoteModal((m) => m ? { ...m, description: e.target.value } : m)}
                      className="text-xs"
                      maxLength={300}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button onClick={() => setPromoteModal(null)} className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent transition-colors">
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={promoting}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: promoteModal.isCurrentlyTemplate ? '#dc2626' : '#a200ee' }}
              >
                {promoting
                  ? 'Saving…'
                  : promoteModal.isCurrentlyTemplate ? 'Remove from Templates' : 'Save as Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <h1 className="text-sm font-semibold">Workflows</h1>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 text-xs gap-1.5"
              disabled={deleting}
              onClick={handleDeleteSelected}
            >
              {deleting
                ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Icons.Trash2 className="h-3.5 w-3.5" />
              }
              Delete {selected.size}
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate('/workflows/new')}>
            <Icons.Plus className="h-3.5 w-3.5" />
            New workflow
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
            <Icons.Workflow className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No workflows yet</p>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate('/workflows/new')}>
              Create your first workflow
            </Button>
          </div>
        ) : (
          <>
            {/* Select all row */}
            <div className="flex items-center gap-2 mb-2 px-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                checked={allSelected}
                onChange={toggleSelectAll}
              />
              <span className="text-[11px] text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
              </span>
            </div>

            <div className="space-y-2">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className={`flex items-center justify-between rounded-lg border bg-card px-4 py-3 transition-colors ${
                    selected.has(wf.id) ? 'border-blue-400 bg-blue-50' : 'border-border hover:border-border/80'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer shrink-0"
                      checked={selected.has(wf.id)}
                      onChange={() => toggleSelect(wf.id)}
                    />
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600">
                      <Icons.Workflow className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      {renamingId === wf.id ? (
                        <input
                          autoFocus
                          className="h-6 rounded border border-input bg-background px-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring w-48"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(wf.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(wf.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p className="text-sm font-medium truncate">{wf.name}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {wf.client?.name ?? 'No client'} · {wf._count.runs} run{wf._count.runs !== 1 ? 's' : ''} · updated {new Date(wf.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {wf.isTemplate && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1"
                        style={{ backgroundColor: '#f5e6ff', border: '1px solid #e0c0ff', color: '#7a00b4' }}
                      >
                        <Icons.Bookmark className="h-2.5 w-2.5" />
                        Template
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[wf.status] ?? STATUS_STYLES.draft}`}>
                      {wf.status}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={wf.connectivityMode === 'offline'
                        ? { backgroundColor: '#fff8e6', border: '1px solid #ffbc44', color: '#7a5200' }
                        : { backgroundColor: '#d0e8b0', border: '1px solid #3b6d11', color: '#3b6d11' }
                      }
                    >
                      {wf.connectivityMode}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Rename"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => startRename(wf)}
                    >
                      <Icons.Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-3"
                      onClick={() => navigate(`/workflows/${wf.id}`)}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={wf.isTemplate ? 'Manage template' : 'Save as template'}
                      className="h-7 w-7 p-0 transition-colors"
                      style={wf.isTemplate ? { color: '#a200ee' } : { color: 'var(--muted-foreground)' }}
                      onClick={() => openPromoteModal(wf)}
                    >
                      <Icons.Bookmark className="h-3.5 w-3.5" style={wf.isTemplate ? { fill: '#a200ee' } : {}} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={deleting}
                      onClick={() => handleDeleteOne(wf)}
                    >
                      <Icons.Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
