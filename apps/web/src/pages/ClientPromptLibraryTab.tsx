import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PromptTemplate {
  id: string
  clientId: string | null
  name: string
  body: string
  category: string
  description: string | null
  source: 'user' | 'ai' | 'global'
  isStale: boolean
  useCount: number
  createdAt: string
  updatedAt: string
}

const CATEGORIES = ['All', 'Copy', 'Creative', 'Strategy', 'Marketing', 'Design', 'Business'] as const
const SOURCES    = ['all', 'user', 'ai', 'global'] as const

const CATEGORY_COLORS: Record<string, string> = {
  Copy:       'bg-blue-500/10 text-blue-600',
  Creative:   'bg-purple-500/10 text-purple-600',
  Strategy:   'bg-amber-500/10 text-amber-600',
  Marketing:  'bg-green-500/10 text-green-600',
  Design:     'bg-pink-500/10 text-pink-600',
  Business:   'bg-slate-500/10 text-slate-600',
}

const SOURCE_LABELS: Record<string, string> = { user: 'Custom', ai: 'AI', global: 'Global' }
const SOURCE_COLORS: Record<string, string> = {
  user:   'bg-muted text-muted-foreground',
  ai:     'bg-violet-500/10 text-violet-600',
  global: 'bg-sky-500/10 text-sky-600',
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateDrawer — slide-in panel for viewing / editing a template
// ─────────────────────────────────────────────────────────────────────────────

interface DrawerProps {
  template: PromptTemplate
  canEdit: boolean
  onClose: () => void
  onSaved: (updated: PromptTemplate) => void
  onUse: (id: string) => void
}

function TemplateDrawer({ template, canEdit, onClose, onSaved, onUse }: DrawerProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(template.name)
  const [body, setBody] = useState(template.body)
  const [description, setDescription] = useState(template.description ?? '')
  const [category, setCategory] = useState(template.category)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/template-library/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, body, description: description || null, category }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Failed to save')
        return
      }
      const { data } = await res.json()
      onSaved(data)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(template.body).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex w-full max-w-xl flex-col bg-card border-l border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 text-sm font-semibold"
              />
            ) : (
              <h2 className="truncate text-sm font-semibold">{template.name}</h2>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={handleCopy}
              title="Copy prompt text"
            >
              {copied ? <Icons.Check className="h-3.5 w-3.5 text-green-500" /> : <Icons.Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={onClose}
            >
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          {editing ? (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-6 rounded border border-border bg-background text-xs px-2"
            >
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CATEGORY_COLORS[template.category] ?? 'bg-muted text-muted-foreground')}>
              {template.category}
            </span>
          )}
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', SOURCE_COLORS[template.source])}>
            {SOURCE_LABELS[template.source]}
          </span>
          {template.isStale && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              <Icons.AlertTriangle className="h-2.5 w-2.5" />
              Stale
            </span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">Used {template.useCount}×</span>
        </div>

        {/* Description */}
        {(template.description || editing) && (
          <div className="border-b border-border px-5 py-3">
            {editing ? (
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description (optional)"
                className="h-7 text-xs"
              />
            ) : (
              <p className="text-xs text-muted-foreground">{template.description}</p>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {editing ? (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[300px] resize-none font-mono text-xs leading-relaxed"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-sans">{template.body}</pre>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Save
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
                  <Icons.Pencil className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => { onUse(template.id); onClose() }}>
                Use template
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CopyToGlobalModal
// ─────────────────────────────────────────────────────────────────────────────

function CopyToGlobalModal({
  template,
  onClose,
  onDone,
}: {
  template: PromptTemplate
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/template-library/suggested-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: template.name }),
    })
      .then((r) => r.json())
      .then(({ data }) => setName(data.suggestedName ?? ''))
      .catch(() => setName(template.name))
      .finally(() => setLoading(false))
  }, [template.name])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/template-library/${template.id}/copy-to-global`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (res.status === 409) {
        alert('A global template with this name already exists. Choose a different name.')
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Failed to copy to Global Library')
        return
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1">Copy to Global Library</h3>
        <p className="text-xs text-muted-foreground mb-4">This template will be available to all clients.</p>
        <label className="block text-xs font-medium mb-1.5">Global template name</label>
        {loading ? (
          <div className="h-8 flex items-center"><Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs mb-4" autoFocus />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={saving || loading || !name.trim()}>
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Copy
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateCard
// ─────────────────────────────────────────────────────────────────────────────

interface CardProps {
  template: PromptTemplate
  isAdmin: boolean
  onOpen: (t: PromptTemplate) => void
  onDelete: (t: PromptTemplate) => void
  onCopyToGlobal: (t: PromptTemplate) => void
  onUse: (id: string) => void
}

function TemplateCard({ template, isAdmin, onOpen, onDelete, onCopyToGlobal, onUse }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const canEdit = isAdmin || template.source === 'user'

  return (
    <div
      className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:border-blue-400/50 transition-colors cursor-pointer"
      onClick={() => onOpen(template)}
    >
      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CATEGORY_COLORS[template.category] ?? 'bg-muted text-muted-foreground')}>
          {template.category}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', SOURCE_COLORS[template.source])}>
          {SOURCE_LABELS[template.source]}
        </span>
        {template.isStale && (
          <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
            <Icons.AlertTriangle className="h-2.5 w-2.5" />
            Stale
          </span>
        )}
      </div>

      {/* Name */}
      <p className="text-[13px] font-medium leading-snug line-clamp-2">{template.name}</p>

      {/* Description */}
      {template.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{template.description}</p>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground">
          {template.useCount > 0 ? `Used ${template.useCount}×` : 'Unused'}
        </span>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-[11px] font-medium"
            onClick={(e) => { e.stopPropagation(); onUse(template.id) }}
            title="Mark as used"
          >
            Use
          </button>
          {/* More menu */}
          <div className="relative" ref={menuRef}>
            <button
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            >
              <Icons.MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-7 z-20 w-44 rounded-md border border-border bg-card shadow-lg py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpen(template) }}
                >
                  <Icons.Eye className="h-3.5 w-3.5" /> View / Edit
                </button>
                {isAdmin && template.clientId !== null && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCopyToGlobal(template) }}
                  >
                    <Icons.Globe className="h-3.5 w-3.5" /> Copy to Global Library
                  </button>
                )}
                {(isAdmin || template.source === 'user') && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(template) }}
                  >
                    <Icons.Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NewTemplateModal — create a custom (user-source) template
// ─────────────────────────────────────────────────────────────────────────────

function NewTemplateModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string
  onClose: () => void
  onCreated: (t: PromptTemplate) => void
}) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Business')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !body.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/template-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, name: name.trim(), body: body.trim(), description: description.trim() || undefined, category, source: 'user' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Failed to create template')
        return
      }
      const { data } = await res.json()
      onCreated(data)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl flex flex-col gap-3.5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">New Prompt Template</h3>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" autoFocus placeholder="e.g. Homepage hero copy" />
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 w-full rounded border border-border bg-background text-xs px-2"
            >
              {CATEGORIES.filter((c) => c !== 'All').map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-8 text-xs" placeholder="One-line summary" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Prompt body *</label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[180px] resize-none text-xs leading-relaxed"
            placeholder="You are a... Write a..."
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={saving || !name.trim() || !body.trim()}>
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save template
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ClientPromptLibraryTab — main export
// ─────────────────────────────────────────────────────────────────────────────

export function ClientPromptLibraryTab({ clientId }: { clientId: string }) {
  const { isAdmin } = useCurrentUser()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [activeCategory, setActiveCategory] = useState<(typeof CATEGORIES)[number]>('All')
  const [activeSource, setActiveSource] = useState<(typeof SOURCES)[number]>('all')
  const [search, setSearch] = useState('')
  const [openTemplate, setOpenTemplate] = useState<PromptTemplate | null>(null)
  const [copyToGlobalTemplate, setCopyToGlobalTemplate] = useState<PromptTemplate | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/v1/template-library?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setTemplates(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    const aiCount = templates.filter((t) => t.source === 'ai').length
    if (aiCount > 0 && !confirm(`This will replace the ${aiCount} existing AI-generated prompt${aiCount !== 1 ? 's' : ''} with fresh ones. Continue?`)) return

    setGenerating(true)
    try {
      // Delete existing AI templates first
      if (aiCount > 0) {
        await Promise.all(
          templates
            .filter((t) => t.source === 'ai')
            .map((t) => apiFetch(`/api/v1/template-library/${t.id}`, { method: 'DELETE' }))
        )
      }
      const res = await apiFetch('/api/v1/template-library/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Generation failed')
        return
      }
      load()
    } finally {
      setGenerating(false)
    }
  }

  const handleUse = async (id: string) => {
    await apiFetch(`/api/v1/template-library/${id}/use`, { method: 'POST' })
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, useCount: t.useCount + 1 } : t))
  }

  const handleDelete = (template: PromptTemplate) => {
    const warn = template.useCount > 0 ? ` This template has been used ${template.useCount} time${template.useCount !== 1 ? 's' : ''}.` : ''
    if (!confirm(`Delete "${template.name}"?${warn}`)) return
    apiFetch(`/api/v1/template-library/${template.id}`, { method: 'DELETE' })
      .then((r) => {
        if (r.ok) setTemplates((prev) => prev.filter((t) => t.id !== template.id))
        else r.json().then(({ error }) => alert(error ?? 'Delete failed'))
      })
  }

  const handleSaved = (updated: PromptTemplate) => {
    setTemplates((prev) => prev.map((t) => t.id === updated.id ? updated : t))
    setOpenTemplate(updated)
  }

  // Filter
  const visible = templates.filter((t) => {
    if (activeCategory !== 'All' && t.category !== activeCategory) return false
    if (activeSource !== 'all' && t.source !== activeSource) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const hasAI = templates.some((t) => t.source === 'ai')

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="h-8 w-56 rounded border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Source filter */}
        <div className="flex rounded border border-border overflow-hidden text-xs">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSource(s)}
              className={cn(
                'px-2.5 py-1.5 font-medium transition-colors',
                activeSource === s ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'all' ? 'All sources' : SOURCE_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowNewModal(true)}>
            <Icons.Plus className="h-3.5 w-3.5 mr-1" />
            New template
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={handleGenerate}
            disabled={generating}
            title="Generate AI templates from Brain data"
          >
            {generating
              ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Generating…</>
              : <><Icons.Sparkles className="h-3.5 w-3.5 mr-1" />{hasAI ? 'Regenerate from Brain' : 'Generate from Brain'}</>
            }
          </Button>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => {
          const count = cat === 'All' ? templates.length : templates.filter((t) => t.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                activeCategory === cat
                  ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {cat}
              {count > 0 && <span className="text-[10px] opacity-60">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Stale banner */}
      {templates.some((t) => t.isStale) && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700">
          <Icons.AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Some AI templates are stale — the Brain has been updated since they were generated.</span>
          {isAdmin && (
            <button className="ml-auto font-medium underline underline-offset-2" onClick={handleGenerate}>
              Regenerate now
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Icons.FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {templates.length === 0
              ? 'No templates yet. Create one manually or generate from the Brain.'
              : 'No templates match this filter.'}
          </p>
          {templates.length === 0 && (
            <Button size="sm" className="h-7 text-xs mt-1" onClick={handleGenerate} disabled={generating}>
              <Icons.Sparkles className="h-3.5 w-3.5 mr-1" />
              Generate from Brain
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isAdmin={isAdmin}
              onOpen={setOpenTemplate}
              onDelete={handleDelete}
              onCopyToGlobal={setCopyToGlobalTemplate}
              onUse={handleUse}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {openTemplate && (
        <TemplateDrawer
          template={openTemplate}
          canEdit={isAdmin || openTemplate.source === 'user'}
          onClose={() => setOpenTemplate(null)}
          onSaved={handleSaved}
          onUse={handleUse}
        />
      )}

      {/* Copy to Global modal */}
      {copyToGlobalTemplate && (
        <CopyToGlobalModal
          template={copyToGlobalTemplate}
          onClose={() => setCopyToGlobalTemplate(null)}
          onDone={() => { setCopyToGlobalTemplate(null); load() }}
        />
      )}

      {/* New template modal */}
      {showNewModal && (
        <NewTemplateModal
          clientId={clientId}
          onClose={() => setShowNewModal(false)}
          onCreated={(t) => { setTemplates((prev) => [t, ...prev]); setShowNewModal(false) }}
        />
      )}
    </div>
  )
}
