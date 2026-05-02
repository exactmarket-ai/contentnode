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
  source: 'user' | 'ai' | 'global' | 'agency'
  agencyTemplateId: string | null
  isStale: boolean
  useCount: number
  packUsageCount: number
  packNames: string[]
  createdAt: string
  updatedAt: string
}

const CATEGORIES = ['All', 'Copy', 'Creative', 'Strategy', 'Marketing', 'Design', 'Business'] as const
const SOURCES    = ['all', 'user', 'ai', 'global', 'agency'] as const

const CATEGORY_COLORS: Record<string, string> = {
  Copy:       'bg-blue-500/10 text-blue-600',
  Creative:   'bg-purple-500/10 text-purple-600',
  Strategy:   'bg-amber-500/10 text-amber-600',
  Marketing:  'bg-green-500/10 text-green-600',
  Design:     'bg-pink-500/10 text-pink-600',
  Business:   'bg-slate-500/10 text-slate-600',
}

const SOURCE_LABELS: Record<string, string> = { user: 'Custom', ai: 'AI', global: 'Global', agency: 'Agency' }
const SOURCE_COLORS: Record<string, string> = {
  user:   'bg-muted text-muted-foreground',
  ai:     'bg-violet-500/10 text-violet-600',
  global: 'bg-sky-500/10 text-sky-600',
  agency: 'bg-purple-500/10 text-purple-700',
}

// ─────────────────────────────────────────────────────────────────────────────
// PackUsageBadge — shows how many packs use this prompt, with inline tooltip
// ─────────────────────────────────────────────────────────────────────────────

function PackUsageBadge({ packUsageCount, packNames }: { packUsageCount: number; packNames: string[] }) {
  const [showTip, setShowTip] = useState(false)

  if (packUsageCount === 0) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        0 packs
      </span>
    )
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowTip((v) => !v) }}
        className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-600 hover:bg-purple-500/20 transition-colors"
      >
        {packUsageCount} {packUsageCount === 1 ? 'pack' : 'packs'}
      </button>
      {showTip && (
        <div
          className="absolute bottom-full left-0 mb-1 z-20 w-max max-w-[220px] rounded-md border border-border bg-white shadow-lg px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Used in:</p>
          <p className="text-[11px] text-foreground leading-snug">{packNames.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateDrawer — slide-in panel for viewing / editing a template
// ─────────────────────────────────────────────────────────────────────────────

interface DrawerProps {
  template: PromptTemplate
  onClose: () => void
  onSaved: (updated: PromptTemplate) => void
  onUse: (id: string) => void
  onFork: (template: PromptTemplate) => void
}

function TemplateDrawer({ template, onClose, onSaved, onUse: _onUse, onFork }: DrawerProps) {
  const [copied, setCopied] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState(template.name)
  const [editBody, setEditBody] = useState(template.body)
  const [editDescription, setEditDescription] = useState(template.description ?? '')
  const [saving, setSaving] = useState(false)
  const [showPackConfirm, setShowPackConfirm] = useState(false)
  const editBodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editMode && editBodyRef.current) editBodyRef.current.scrollTop = 0
  }, [editMode, template.id])

  const handleCopy = () => {
    navigator.clipboard.writeText(template.body).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const doSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/template-library/${template.id}?confirmPackUpdate=true`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          body: editBody.trim(),
          description: editDescription.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Save failed')
        return
      }
      const { data } = await res.json()
      onSaved(data)
      setEditMode(false)
      setShowPackConfirm(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveChanges = async () => {
    if (template.packUsageCount > 0) {
      setShowPackConfirm(true)
    } else {
      await doSave()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-transparent" onClick={onClose}>
      <div
        className="relative flex w-full max-w-xl flex-col bg-white border-l border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <div className="flex-1 min-w-0">
            {editMode ? (
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 text-sm font-semibold"
                autoFocus
              />
            ) : (
              <h2 className="truncate text-sm font-semibold">{template.name}</h2>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!editMode && (
              <button
                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={handleCopy}
                title="Copy prompt text"
              >
                {copied ? <Icons.Check className="h-3.5 w-3.5 text-green-500" /> : <Icons.Copy className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={onClose}
            >
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5 flex-wrap">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CATEGORY_COLORS[template.category] ?? 'bg-muted text-muted-foreground')}>
            {template.category}
          </span>
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
          <PackUsageBadge packUsageCount={template.packUsageCount} packNames={template.packNames} />
        </div>

        {/* Description */}
        {!editMode && template.description && (
          <div className="border-b border-border px-5 py-3">
            <p className="text-xs text-muted-foreground">{template.description}</p>
          </div>
        )}

        {/* Edit description */}
        {editMode && (
          <div className="border-b border-border px-5 py-3">
            <label className="block text-[11px] font-medium mb-1 text-muted-foreground">Description (optional)</label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="h-7 text-xs"
              placeholder="One-line summary"
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {editMode ? (
            <Textarea
              ref={editBodyRef}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="min-h-[60vh] resize-none text-xs leading-relaxed w-full"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-sans">{template.body}</pre>
          )}
        </div>

        {/* Pack update confirmation */}
        {showPackConfirm && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-4 flex flex-col gap-3">
            <p className="text-xs text-amber-800 leading-relaxed">
              This prompt is used in <strong>{template.packUsageCount} content pack{template.packUsageCount !== 1 ? 's' : ''}</strong>
              {template.packNames.length > 0 ? ` (${template.packNames.join(', ')})` : ''}. Your changes will apply to all future runs using those packs.
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={doSave} disabled={saving}>
                {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Save changes
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowPackConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        {!showPackConfirm && (
          <div className="flex items-center gap-2 border-t border-border px-5 py-3">
            {editMode ? (
              <>
                <Button size="sm" className="h-7 text-xs" onClick={handleSaveChanges} disabled={saving || !editName.trim() || !editBody.trim()}>
                  {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Save changes
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditMode(false); setEditName(template.name); setEditBody(template.body); setEditDescription(template.description ?? '') }}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {template.source !== 'agency' && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditMode(true)}>
                    <Icons.Pencil className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { onFork(template); onClose() }}>
                  <Icons.Copy className="h-3 w-3 mr-1" />
                  Save as new
                </Button>
              </>
            )}
          </div>
        )}
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-transparent" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
// ReplaceInPacksDialog — after save-as-new, offer to swap packs to new template
// ─────────────────────────────────────────────────────────────────────────────

function ReplaceInPacksDialog({
  originalTemplate,
  newTemplateId,
  onDone,
}: {
  originalTemplate: PromptTemplate
  newTemplateId: string
  onDone: () => void
}) {
  const [loading, setLoading] = useState(false)

  const handleReplace = async () => {
    setLoading(true)
    try {
      await apiFetch(`/api/v1/template-library/${originalTemplate.id}/replace-in-packs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPromptTemplateId: newTemplateId }),
      }).catch(console.error)
    } finally {
      setLoading(false)
      onDone()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-5 shadow-2xl flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Update packs?</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Do you want to update the <strong>{originalTemplate.packUsageCount} pack{originalTemplate.packUsageCount !== 1 ? 's' : ''}</strong>
          {originalTemplate.packNames.length > 0 ? ` (${originalTemplate.packNames.join(', ')})` : ''} using the original to use this new version instead?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDone} disabled={loading}>
            Keep original
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleReplace} disabled={loading}>
            {loading ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Update packs
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
  onRemoveFromGlobal: (agencyTemplateId: string) => void
  onUse: (id: string) => void
  onFork: (t: PromptTemplate) => void
}

function TemplateCard({ template, isAdmin, onOpen, onDelete, onCopyToGlobal, onRemoveFromGlobal, onUse: _onUse, onFork }: CardProps) {
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

  return (
    <div
      className="group relative flex flex-col gap-2 rounded-lg border border-border bg-white p-4 hover:border-blue-400/50 transition-colors cursor-pointer"
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
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {template.useCount > 0 ? `Used ${template.useCount}×` : 'Unused'}
          </span>
          <PackUsageBadge packUsageCount={template.packUsageCount} packNames={template.packNames} />
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {/* More menu */}
          <div className="relative" ref={menuRef}>
            <button
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            >
              <Icons.MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-7 z-20 w-48 rounded-md border border-border bg-white shadow-lg py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onOpen(template) }}
                >
                  <Icons.Eye className="h-3.5 w-3.5" />
                  {template.source === 'agency' ? 'View' : 'View / Edit'}
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onFork(template) }}
                >
                  <Icons.Copy className="h-3.5 w-3.5" /> Save as new
                </button>
                {isAdmin && template.clientId !== null && (
                  template.source === 'agency' && template.agencyTemplateId ? (
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRemoveFromGlobal(template.agencyTemplateId!) }}
                    >
                      <Icons.MinusCircle className="h-3.5 w-3.5" /> Remove from Global Library
                    </button>
                  ) : (
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCopyToGlobal(template) }}
                    >
                      <Icons.Globe className="h-3.5 w-3.5" /> Copy to Global Library
                    </button>
                  )
                )}
                {(isAdmin || template.source === 'user') && template.source !== 'agency' && (
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
  initialValues,
  originalTemplate,
}: {
  clientId: string
  onClose: () => void
  onCreated: (t: PromptTemplate) => void
  initialValues?: { name: string; body: string; description: string; category: string }
  originalTemplate?: PromptTemplate
}) {
  const [name, setName] = useState(initialValues ? `Copy of ${initialValues.name}` : '')
  const [body, setBody] = useState(initialValues?.body ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [category, setCategory] = useState(initialValues?.category ?? 'Business')
  const [saving, setSaving] = useState(false)
  const [createdTemplate, setCreatedTemplate] = useState<PromptTemplate | null>(null)
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)

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

      // If forked from a template that's in packs, offer to swap
      if (originalTemplate && originalTemplate.packUsageCount > 0) {
        setCreatedTemplate(data)
        setShowReplaceDialog(true)
      } else {
        onCreated(data)
      }
    } finally {
      setSaving(false)
    }
  }

  if (showReplaceDialog && createdTemplate && originalTemplate) {
    return (
      <ReplaceInPacksDialog
        originalTemplate={originalTemplate}
        newTemplateId={createdTemplate.id}
        onDone={() => {
          setShowReplaceDialog(false)
          onCreated(createdTemplate)
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-transparent" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-white p-5 shadow-2xl flex flex-col gap-3.5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold">{initialValues ? 'Save as New Template' : 'New Prompt Template'}</h3>
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
  const [forkTemplate, setForkTemplate] = useState<PromptTemplate | null>(null)
  const [deleteBlockMsg, setDeleteBlockMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch(`/api/v1/template-library?clientId=${clientId}`).then((r) => r.json()),
      apiFetch('/api/v1/template-library?global=true').then((r) => r.json()),
    ])
      .then(([clientRes, globalRes]) => {
        const clientTemplates: PromptTemplate[] = (clientRes.data ?? []).map((t: PromptTemplate) => ({
          ...t,
          packUsageCount: t.packUsageCount ?? 0,
          packNames: t.packNames ?? [],
        }))
        const globalTemplates: PromptTemplate[] = (globalRes.data ?? []).map((t: PromptTemplate) => ({
          ...t,
          packUsageCount: t.packUsageCount ?? 0,
          packNames: t.packNames ?? [],
        }))
        const seen = new Set(clientTemplates.map((t) => t.id))
        setTemplates([...clientTemplates, ...globalTemplates.filter((t) => !seen.has(t.id))])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  // Seed global blog templates first, then load so they appear for blank clients
  useEffect(() => {
    apiFetch('/api/v1/prompts/seed', { method: 'POST' })
      .catch(() => {})
      .finally(() => load())
  }, [load])

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
    // Block deletion if template is in packs
    if (template.packUsageCount > 0) {
      const packList = template.packNames.length > 0 ? `: ${template.packNames.join(', ')}` : ''
      setDeleteBlockMsg(`This prompt is used in ${template.packUsageCount} content pack${template.packUsageCount !== 1 ? 's' : ''}${packList}. Remove it from all packs before deleting.`)
      return
    }

    const warn = template.useCount > 0 ? ` This template has been used ${template.useCount} time${template.useCount !== 1 ? 's' : ''}.` : ''
    if (!confirm(`Delete "${template.name}"?${warn}`)) return
    apiFetch(`/api/v1/template-library/${template.id}`, { method: 'DELETE' })
      .then((r) => {
        if (r.ok) setTemplates((prev) => prev.filter((t) => t.id !== template.id))
        else r.json().then(({ error }) => alert(error ?? 'Delete failed'))
      })
  }

  const handleRemoveFromGlobal = (agencyTemplateId: string) => {
    if (!confirm('Remove this template from the Global Library? It will stay in all client libraries where it currently exists but will no longer be managed at the agency level.')) return
    apiFetch(`/api/v1/agency/prompt-templates/${agencyTemplateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyLevel: false, visibleToClients: false }),
    }).then((r) => {
      if (r.ok) setTemplates((prev) => prev.map((t) =>
        t.agencyTemplateId === agencyTemplateId ? { ...t, source: 'user' as const, agencyTemplateId: null } : t
      ))
      else r.json().then(({ error }) => alert(error ?? 'Failed to remove from Global Library'))
    })
  }

  const handleSaved = (updated: PromptTemplate) => {
    setTemplates((prev) => prev.map((t) => t.id === updated.id ? { ...t, ...updated } : t))
    setOpenTemplate({ ...updated, packUsageCount: updated.packUsageCount ?? 0, packNames: updated.packNames ?? [] })
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
      {/* Delete block message */}
      {deleteBlockMsg && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{deleteBlockMsg}</span>
          <button onClick={() => setDeleteBlockMsg(null)} className="shrink-0 hover:opacity-70">
            <Icons.X className="h-3 w-3" />
          </button>
        </div>
      )}

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
              onRemoveFromGlobal={handleRemoveFromGlobal}
              onUse={handleUse}
              onFork={(tmpl) => { setOpenTemplate(null); setForkTemplate(tmpl) }}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {openTemplate && (
        <TemplateDrawer
          template={openTemplate}
          onClose={() => setOpenTemplate(null)}
          onSaved={handleSaved}
          onUse={handleUse}
          onFork={(t) => { setOpenTemplate(null); setForkTemplate(t) }}
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

      {/* New template modal (blank or forked) */}
      {(showNewModal || forkTemplate) && (
        <NewTemplateModal
          clientId={clientId}
          onClose={() => { setShowNewModal(false); setForkTemplate(null) }}
          onCreated={(t) => { setTemplates((prev) => [t, ...prev]); setShowNewModal(false); setForkTemplate(null) }}
          initialValues={forkTemplate ? {
            name: forkTemplate.name,
            body: forkTemplate.body,
            description: forkTemplate.description ?? '',
            category: forkTemplate.category,
          } : undefined}
          originalTemplate={forkTemplate ?? undefined}
        />
      )}
    </div>
  )
}
