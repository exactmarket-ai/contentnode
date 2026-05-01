import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ContentPack {
  id: string
  clientId: string
  name: string
  description: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
}

interface PackItem {
  id: string
  packId: string
  promptTemplateId: string
  promptName: string
  promptCategory: string
  promptDescription: string | null
  order: number
}

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

const CATEGORY_COLORS: Record<string, string> = {
  Copy:       'bg-blue-500/10 text-blue-600',
  Creative:   'bg-purple-500/10 text-purple-600',
  Strategy:   'bg-amber-500/10 text-amber-600',
  Marketing:  'bg-green-500/10 text-green-600',
  Design:     'bg-pink-500/10 text-pink-600',
  Business:   'bg-slate-500/10 text-slate-600',
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptPickerSubModal — search and select prompts to add to a pack
// ─────────────────────────────────────────────────────────────────────────────

function PromptPickerSubModal({
  clientId,
  existingIds,
  onAdd,
  onClose,
}: {
  clientId: string
  existingIds: Set<string>
  onAdd: (template: PromptTemplate) => void
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/v1/template-library?clientId=${clientId}`).then((r) => r.json()),
      apiFetch('/api/v1/template-library?global=true').then((r) => r.json()),
    ])
      .then(([clientRes, globalRes]) => {
        const clientTemplates: PromptTemplate[] = clientRes.data ?? []
        const globalTemplates: PromptTemplate[] = globalRes.data ?? []
        const seen = new Set(clientTemplates.map((t) => t.id))
        setTemplates([...clientTemplates, ...globalTemplates.filter((t) => !seen.has(t.id))])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  const filtered = templates.filter((t) => {
    if (search.trim()) {
      const q = search.toLowerCase()
      return t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white border border-border rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h4 className="text-sm font-semibold">Add prompt</h4>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts…"
              autoFocus
              className="h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <p className="text-xs text-muted-foreground">No prompts found.</p>
            </div>
          )}
          {!loading && filtered.map((t) => {
            const already = existingIds.has(t.id)
            return (
              <button
                key={t.id}
                disabled={already}
                onClick={() => { if (!already) { onAdd(t); onClose() } }}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 text-left border-b border-border last:border-0 transition-colors',
                  already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/50 cursor-pointer',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0', CATEGORY_COLORS[t.category] ?? 'bg-muted text-muted-foreground')}>
                      {t.category}
                    </span>
                    <p className="text-[13px] font-medium truncate">{t.name}</p>
                  </div>
                  {t.description && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{t.description}</p>
                  )}
                </div>
                {already && <Icons.Check className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContentPackModal — create / edit a pack and manage its items
// ─────────────────────────────────────────────────────────────────────────────

interface PackModalProps {
  clientId: string
  pack?: ContentPack
  onClose: () => void
  onSaved: (pack: ContentPack) => void
}

function ContentPackModal({ clientId, pack, onClose, onSaved }: PackModalProps) {
  const isEdit = !!pack

  const [name, setName] = useState(pack?.name ?? '')
  const [description, setDescription] = useState(pack?.description ?? '')
  const [items, setItems] = useState<PackItem[]>([])
  const [loadingItems, setLoadingItems] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pendingAdds, setPendingAdds] = useState<PromptTemplate[]>([])

  // Load existing items when editing
  useEffect(() => {
    if (!isEdit || !pack) return
    apiFetch(`/api/v1/content-packs/${pack.id}/items`)
      .then((r) => r.json())
      .then(({ data }) => setItems(data ?? []))
      .catch(console.error)
      .finally(() => setLoadingItems(false))
  }, [isEdit, pack])

  const handleAddPrompt = (template: PromptTemplate) => {
    setPendingAdds((prev) => [...prev, template])
  }

  const handleRemoveItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
  }

  const handleRemovePending = (templateId: string) => {
    setPendingAdds((prev) => prev.filter((t) => t.id !== templateId))
  }

  const moveItem = (index: number, direction: 'up' | 'down') => {
    setItems((prev) => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((item, i) => ({ ...item, order: i }))
    })
  }

  const existingTemplateIds = new Set([
    ...items.map((i) => i.promptTemplateId),
    ...pendingAdds.map((t) => t.id),
  ])

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let savedPack: ContentPack

      if (isEdit) {
        // Update name/description
        const res = await apiFetch(`/api/v1/content-packs/${pack!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          alert(j.error ?? 'Failed to save pack')
          return
        }
        const { data } = await res.json()
        savedPack = data

        // Reorder existing items if needed
        if (items.length > 0) {
          await apiFetch(`/api/v1/content-packs/${pack!.id}/items/reorder`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items.map((item, i) => ({ id: item.id, order: i })) }),
          }).catch(console.error)
        }

        // Add pending prompts
        for (const template of pendingAdds) {
          await apiFetch(`/api/v1/content-packs/${pack!.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptTemplateId: template.id }),
          }).catch(console.error)
        }

        onSaved({ ...savedPack, itemCount: items.length + pendingAdds.length })
      } else {
        // Create pack
        const res = await apiFetch('/api/v1/content-packs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, name: name.trim(), description: description.trim() || null }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          alert(j.error ?? 'Failed to create pack')
          return
        }
        const { data } = await res.json()
        savedPack = data

        // Add pending prompts
        for (const template of pendingAdds) {
          await apiFetch(`/api/v1/content-packs/${savedPack.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptTemplateId: template.id }),
          }).catch(console.error)
        }

        onSaved({ ...savedPack, itemCount: pendingAdds.length })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div
          className="w-full max-w-lg bg-white border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold">{isEdit ? 'Edit content pack' : 'New content pack'}</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <Icons.X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium mb-1">Pack name *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
                placeholder="e.g. LinkedIn Thought Leadership Pack"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-xs"
                placeholder="What this pack is used for"
              />
            </div>

            {/* Items section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium">Prompts in this pack</label>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-1 text-[11px] text-blue-600 font-medium hover:text-blue-700 transition-colors"
                >
                  <Icons.Plus className="h-3 w-3" />
                  Add prompt
                </button>
              </div>

              {loadingItems && (
                <div className="flex items-center justify-center py-6">
                  <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loadingItems && items.length === 0 && pendingAdds.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground">No prompts yet. Add prompts from your library to define what gets generated.</p>
                </div>
              )}

              {!loadingItems && (
                <div className="flex flex-col gap-2">
                  {/* Existing items */}
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2.5"
                    >
                      <span className="text-[11px] font-semibold text-muted-foreground w-5 shrink-0 text-right">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{item.promptName}</p>
                        {item.promptCategory && (
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_COLORS[item.promptCategory] ?? 'bg-muted text-muted-foreground')}>
                            {item.promptCategory}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveItem(idx, 'up')}
                          disabled={idx === 0}
                          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                          title="Move up"
                        >
                          <Icons.ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(idx, 'down')}
                          disabled={idx === items.length - 1 && pendingAdds.length === 0}
                          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30"
                          title="Move down"
                        >
                          <Icons.ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/v1/content-packs/${item.packId}/items/${item.id}`, { method: 'DELETE' }).catch(console.error)
                            handleRemoveItem(item.id)
                          }}
                          className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Remove"
                        >
                          <Icons.X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Pending adds (not yet saved) */}
                  {pendingAdds.map((template, idx) => (
                    <div
                      key={template.id}
                      className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-500/5 px-3 py-2.5"
                    >
                      <span className="text-[11px] font-semibold text-muted-foreground w-5 shrink-0 text-right">{items.length + idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{template.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {template.category && (
                            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_COLORS[template.category] ?? 'bg-muted text-muted-foreground')}>
                              {template.category}
                            </span>
                          )}
                          <span className="text-[10px] text-blue-600 font-medium">New</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePending(template.id)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                        title="Remove"
                      >
                        <Icons.X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {isEdit ? 'Save changes' : 'Create pack'}
            </Button>
          </div>
        </div>
      </div>

      {/* Prompt picker sub-modal */}
      {showPicker && (
        <PromptPickerSubModal
          clientId={clientId}
          existingIds={existingTemplateIds}
          onAdd={handleAddPrompt}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PackCard
// ─────────────────────────────────────────────────────────────────────────────

function PackCard({
  pack,
  onEdit,
  onDelete,
}: {
  pack: ContentPack
  onEdit: (pack: ContentPack) => void
  onDelete: (pack: ContentPack) => void
}) {
  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border border-border bg-white p-4 hover:border-blue-400/50 transition-colors">
      {/* Name + item count */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug">{pack.name}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {pack.itemCount} {pack.itemCount === 1 ? 'prompt' : 'prompts'}
        </span>
      </div>

      {/* Description */}
      {pack.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{pack.description}</p>
      )}

      {/* Footer actions */}
      <div className="mt-auto flex items-center justify-end gap-1 pt-2" onClick={(e) => e.stopPropagation()}>
        <button
          className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={() => onEdit(pack)}
          title="Edit pack"
        >
          <Icons.Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={() => onDelete(pack)}
          title="Delete pack"
        >
          <Icons.Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ContentPacksTab — main export
// ─────────────────────────────────────────────────────────────────────────────

export function ContentPacksTab({ clientId }: { clientId: string }) {
  const [packs, setPacks] = useState<ContentPack[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editPack, setEditPack] = useState<ContentPack | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/v1/content-packs?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setPacks(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSaved = (pack: ContentPack) => {
    setPacks((prev) => {
      const idx = prev.findIndex((p) => p.id === pack.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = pack
        return next
      }
      return [...prev, pack]
    })
    setShowModal(false)
    setEditPack(null)
  }

  const handleDelete = (pack: ContentPack) => {
    if (!confirm(`Delete "${pack.name}"? This cannot be undone.`)) return
    apiFetch(`/api/v1/content-packs/${pack.id}`, { method: 'DELETE' })
      .then((r) => {
        if (r.ok) setPacks((prev) => prev.filter((p) => p.id !== pack.id))
        else r.json().then(({ error }) => alert(error ?? 'Delete failed')).catch(() => alert('Delete failed'))
      })
      .catch(() => alert('Delete failed'))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Content Packs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Group prompts into reusable packs that define what gets generated when a topic is approved.
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowModal(true)}>
          <Icons.Plus className="h-3.5 w-3.5 mr-1" />
          New pack
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl border border-dashed border-border">
          <Icons.Package className="h-8 w-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground/80">No content packs yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Create a pack to define what gets generated when a topic is approved.
            </p>
          </div>
          <Button size="sm" className="h-7 text-xs mt-1" onClick={() => setShowModal(true)}>
            <Icons.Plus className="h-3.5 w-3.5 mr-1" />
            New pack
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              onEdit={(p) => { setEditPack(p); setShowModal(false) }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <ContentPackModal
          clientId={clientId}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Edit modal */}
      {editPack && (
        <ContentPackModal
          clientId={clientId}
          pack={editPack}
          onClose={() => setEditPack(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
