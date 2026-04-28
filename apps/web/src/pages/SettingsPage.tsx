import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatBytes } from '@/components/layout/config/shared'
import { DocTemplateEditor } from './DocTemplateEditor'

interface AgencySettings {
  id: string
  agencyId: string
  tempContactExpiryDays: number | null
  docLogoStorageKey: string | null
  docPrimaryColor: string
  docSecondaryColor: string
  docHeadingFont: string
  docBodyFont: string
  docAgencyName: string | null
  docCoverPage: boolean
  docPageNumbers: boolean
  docFooterText: string | null
  docApplyToGtm: boolean
  docApplyToDemandGen: boolean
  docApplyToBranding: boolean
}

const FONTS = ['Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Garamond', 'Verdana', 'Helvetica']

// ── DocStyleSection ───────────────────────────────────────────────────────────

function DocStyleSection() {
  const [form, setForm] = useState({
    docPrimaryColor: '#1B1F3B',
    docSecondaryColor: '#4A90D9',
    docHeadingFont: 'Calibri',
    docBodyFont: 'Calibri',
    docAgencyName: '',
    docCoverPage: true,
    docPageNumbers: true,
    docFooterText: '',
    docApplyToGtm: true,
    docApplyToDemandGen: false,
    docApplyToBranding: false,
  })
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch('/api/v1/settings')
      .then((r) => r.json())
      .then(({ data }: { data: AgencySettings }) => {
        if (!data) return
        setForm({
          docPrimaryColor: data.docPrimaryColor ?? '#1B1F3B',
          docSecondaryColor: data.docSecondaryColor ?? '#4A90D9',
          docHeadingFont: data.docHeadingFont ?? 'Calibri',
          docBodyFont: data.docBodyFont ?? 'Calibri',
          docAgencyName: data.docAgencyName ?? '',
          docCoverPage: data.docCoverPage ?? true,
          docPageNumbers: data.docPageNumbers ?? true,
          docFooterText: data.docFooterText ?? '',
          docApplyToGtm: data.docApplyToGtm ?? true,
          docApplyToDemandGen: data.docApplyToDemandGen ?? false,
          docApplyToBranding: data.docApplyToBranding ?? false,
        })
        if (data.docLogoStorageKey) setLogoPreview(data.docLogoStorageKey)
      })
      .catch(() => {})
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          docAgencyName: form.docAgencyName || null,
          docFooterText: form.docFooterText || null,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }, [form])

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch('/api/v1/settings/doc-logo', { method: 'POST', body: fd })
      if (res.ok) {
        const reader = new FileReader()
        reader.onload = (e) => setLogoPreview(e.target?.result as string)
        reader.readAsDataURL(file)
      }
    } finally { setUploadingLogo(false) }
  }

  const removeLogo = async () => {
    await apiFetch('/api/v1/settings/doc-logo', { method: 'DELETE' })
    setLogoPreview(null)
  }

  const set = (key: keyof typeof form, val: unknown) => setForm((f) => ({ ...f, [key]: val }))

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Icons.FileType className="h-4 w-4" style={{ color: '#b4b2a9' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Style Templates</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Set agency-wide defaults for how DOCX downloads look. Individual clients can override these settings.
      </p>

      <div className="rounded-xl p-5 space-y-5" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
        {/* Sub-section label */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>GTM Framework Template</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#a200ee' }}
          >
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Icons.Check className="h-3 w-3" /> : <Icons.Save className="h-3 w-3" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* Apply to */}
        <div>
          <p className="text-[12px] font-medium mb-2" style={{ color: '#6b7280' }}>Apply template to</p>
          <div className="flex flex-wrap gap-2">
            {([
              ['docApplyToGtm', 'GTM Framework'],
              ['docApplyToDemandGen', 'Demand Gen'],
              ['docApplyToBranding', 'Branding'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => set(key, !form[key])}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
                style={form[key]
                  ? { backgroundColor: '#fdf5ff', border: '1px solid #a200ee', color: '#7a00b4' }
                  : { backgroundColor: '#fafaf8', border: '1px solid #e8e7e1', color: '#6b7280' }}
              >
                {form[key] && <Icons.Check className="h-3 w-3" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Logo */}
        <div>
          <p className="text-[12px] font-medium mb-2" style={{ color: '#6b7280' }}>Logo</p>
          {logoPreview ? (
            <div className="flex items-center gap-3">
              <img src={logoPreview} alt="Doc logo" className="h-10 object-contain rounded border border-border" style={{ maxWidth: 160 }} />
              <button onClick={removeLogo} className="text-[11px] text-red-500 hover:text-red-700">Remove</button>
            </div>
          ) : (
            <button
              onClick={() => logoRef.current?.click()}
              disabled={uploadingLogo}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors"
              style={{ border: '1px dashed #d1d5db', color: '#6b7280', backgroundColor: '#fafaf8' }}
            >
              {uploadingLogo ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Upload className="h-3.5 w-3.5" />}
              Upload logo (JPG, PNG, SVG — max 5 MB)
            </button>
          )}
          <input ref={logoRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.svg"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = '' }} />
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-4">
          {([
            ['docPrimaryColor', 'Primary color'],
            ['docSecondaryColor', 'Secondary color'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>{label}</p>
              <div className="flex items-center gap-2">
                <input type="color" value={form[key]} onChange={(e) => set(key, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-border" />
                <input type="text" value={form[key]} maxLength={7}
                  onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) set(key, e.target.value) }}
                  className="flex-1 rounded border border-border px-2 py-1.5 text-[12px] font-mono" />
              </div>
            </div>
          ))}
        </div>

        {/* Fonts */}
        <div className="grid grid-cols-2 gap-4">
          {([
            ['docHeadingFont', 'Heading font'],
            ['docBodyFont', 'Body font'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>{label}</p>
              <select value={form[key]} onChange={(e) => set(key, e.target.value)}
                className="w-full rounded border border-border px-2 py-1.5 text-[13px]"
                style={{ backgroundColor: '#fafaf8' }}>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
        </div>

        {/* Agency name */}
        <div>
          <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>Agency name <span style={{ color: '#b4b2a9' }}>(shown in footer)</span></p>
          <input type="text" value={form.docAgencyName} onChange={(e) => set('docAgencyName', e.target.value)}
            placeholder="e.g. Acme Agency"
            className="w-full rounded border border-border px-3 py-2 text-[13px]" />
        </div>

        {/* Footer text */}
        <div>
          <p className="text-[12px] font-medium mb-1.5" style={{ color: '#6b7280' }}>Footer text <span style={{ color: '#b4b2a9' }}>(optional)</span></p>
          <input type="text" value={form.docFooterText} onChange={(e) => set('docFooterText', e.target.value)}
            placeholder="e.g. Confidential — Do not distribute"
            className="w-full rounded border border-border px-3 py-2 text-[13px]" />
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3">
          {([
            ['docCoverPage', 'Include cover page'],
            ['docPageNumbers', 'Include page numbers'],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center gap-3 cursor-pointer select-none" onClick={() => set(key, !form[key])}>
              <div
                role="switch" aria-checked={form[key]}
                className="relative flex-shrink-0 h-5 w-9 rounded-full transition-colors"
                style={{ backgroundColor: form[key] ? '#a200ee' : '#d1d5db' }}
              >
                <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: form[key] ? 'translateX(16px)' : 'translateX(2px)' }} />
              </div>
              <span className="text-[13px]" style={{ color: '#374151' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

interface AgencyFile {
  id: string
  originalName: string
  label: string | null
  category: string | null
  sizeBytes: number
  createdAt: string
}

const EXPIRY_OPTIONS = [
  { value: null, label: 'Never — keep indefinitely' },
  { value: 7,    label: '1 week (7 days)' },
  { value: 14,   label: '2 weeks (14 days)' },
  { value: 30,   label: '1 month (30 days)' },
  { value: 90,   label: '1 quarter (90 days)' },
  { value: 180,  label: '6 months (180 days)' },
  { value: 365,  label: '1 year (365 days)' },
]

const LIBRARY_CATEGORIES = [
  { value: 'brand-guidelines',  label: 'Brand Guidelines' },
  { value: 'instructions',      label: 'Instructions' },
  { value: 'standards',         label: 'Standards' },
  { value: 'templates',         label: 'Templates' },
  { value: 'approved-examples', label: 'Approved Examples' },
  { value: 'legal',             label: 'Legal' },
  { value: 'other',             label: 'Other' },
]

// ── Library section ───────────────────────────────────────────────────────────

function LibrarySection() {
  const [files, setFiles] = useState<AgencyFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch('/api/v1/library')
      .then((r) => r.json())
      .then(({ data }) => setFiles(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    for (const file of Array.from(fileList)) {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await apiFetch('/api/v1/library', { method: 'POST', body: form })
        if (res.ok) {
          const { data } = await res.json()
          setFiles((prev) => [data, ...prev])
        }
      } catch (err) {
        console.error('Library upload failed', err)
      }
    }
    setUploading(false)
  }

  const startEdit = (f: AgencyFile) => {
    setEditingId(f.id)
    setEditLabel(f.label ?? '')
    setEditCategory(f.category ?? 'other')
  }

  const saveEdit = async (id: string) => {
    setSavingEdit(true)
    try {
      const res = await apiFetch(`/api/v1/library/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel, category: editCategory }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setFiles((prev) => prev.map((f) => (f.id === id ? data : f)))
      }
    } finally {
      setSavingEdit(false)
      setEditingId(null)
    }
  }

  const deleteFile = async (id: string) => {
    setDeletingId(id)
    try {
      await apiFetch(`/api/v1/library/${id}`, { method: 'DELETE' })
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  // Group by category
  const grouped = files.reduce<Record<string, AgencyFile[]>>((acc, f) => {
    const cat = f.category ?? 'other'
    ;(acc[cat] ??= []).push(f)
    return acc
  }, {})

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Icons.Library className="h-4 w-4" style={{ color: '#b4b2a9' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>File Library</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Upload instruction sets, brand guidelines, and standards here. Library files can be
        attached to any workflow node and are automatically available across all clients.
      </p>

      {/* Upload button */}
      <label className="cursor-pointer">
        <div
          className="flex items-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors hover:border-purple-400 hover:bg-purple-50"
          style={{ borderColor: '#e8e7e1' }}
        >
          {uploading
            ? <Icons.Loader2 className="h-4 w-4 animate-spin" style={{ color: '#a200ee' }} />
            : <Icons.Upload className="h-4 w-4" style={{ color: '#b4b2a9' }} />}
          <span style={{ color: uploading ? '#a200ee' : '#6b6a62' }}>
            {uploading ? 'Uploading…' : 'Upload files — PDF, DOCX, TXT, MD, CSV, JSON, HTML'}
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.csv,.json,.html"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </label>

      {/* File list */}
      <div className="mt-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} />
          </div>
        ) : files.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 rounded-xl py-10 text-center"
            style={{ border: '1px solid #e8e7e1', backgroundColor: '#fff' }}
          >
            <Icons.Library className="h-8 w-8" style={{ color: '#dddcd6' }} />
            <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No library files yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([cat, catFiles]) => {
              const catLabel = LIBRARY_CATEGORIES.find((c) => c.value === cat)?.label ?? cat
              return (
                <div key={cat}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>
                    {catLabel}
                  </p>
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid #e8e7e1', backgroundColor: '#fff' }}
                  >
                    {catFiles.map((f, i) => (
                      <div
                        key={f.id}
                        className="px-4 py-3"
                        style={i > 0 ? { borderTop: '1px solid #e8e7e1' } : {}}
                      >
                        {editingId === f.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              placeholder="Label (optional)"
                              className="h-7 flex-1 rounded border px-2 text-xs outline-none focus:border-purple-400"
                              style={{ borderColor: '#e8e7e1' }}
                            />
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="h-7 rounded border px-1 text-xs outline-none"
                              style={{ borderColor: '#e8e7e1' }}
                            >
                              {LIBRARY_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => saveEdit(f.id)}
                              disabled={savingEdit}
                              className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-white"
                              style={{ backgroundColor: '#a200ee' }}
                            >
                              {savingEdit ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Check className="h-3 w-3" />}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex h-7 w-7 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
                              style={{ borderColor: '#e8e7e1' }}
                            >
                              <Icons.X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <Icons.FileText className="h-4 w-4 shrink-0" style={{ color: '#b4b2a9' }} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium" style={{ color: '#1a1a14' }}>
                                {f.label ?? f.originalName}
                              </p>
                              {f.label && (
                                <p className="truncate text-[11px]" style={{ color: '#b4b2a9' }}>{f.originalName}</p>
                              )}
                            </div>
                            <span className="shrink-0 text-[11px]" style={{ color: '#b4b2a9' }}>
                              {formatBytes(f.sizeBytes)}
                            </span>
                            <button
                              onClick={() => startEdit(f)}
                              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
                              title="Edit label / category"
                            >
                              <Icons.Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => deleteFile(f.id)}
                              disabled={deletingId === f.id}
                              className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500"
                              title="Remove from library"
                            >
                              {deletingId === f.id
                                ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                                : <Icons.Trash2 className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Prompt Templates section ──────────────────────────────────────────────────

interface PromptTemplate {
  id: string
  name: string
  body: string
  category: string
  description: string | null
  parentId: string | null
  useCount: number
  createdAt: string
}

const PROMPT_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'content', label: 'Content' },
  { value: 'seo',     label: 'SEO' },
  { value: 'social',  label: 'Social' },
  { value: 'email',   label: 'Email' },
  { value: 'other',   label: 'Other' },
]

function PromptsSection() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
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
    apiFetch('/api/v1/prompts')
      .then((r) => r.json())
      .then(({ data }) => setTemplates(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const startEdit = (t: PromptTemplate) => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditBody(t.body)
    setEditDesc(t.description ?? '')
    setEditCategory(t.category)
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
      if (res.ok) {
        setEditingId(null)
        load()
      }
    } finally {
      setSavingEdit(false)
    }
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
        body: JSON.stringify({ name: newName.trim(), body: newBody.trim(), description: newDesc.trim() || undefined, category: newCategory }),
      })
      if (res.ok) {
        setCreating(false)
        setNewName(''); setNewBody(''); setNewDesc(''); setNewCategory('general')
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  const grouped = templates.reduce<Record<string, PromptTemplate[]>>((acc, t) => {
    ;(acc[t.category] ??= []).push(t)
    return acc
  }, {})

  return (
    <section>
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
          <Icons.Plus className="h-3.5 w-3.5" />
          New template
        </button>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Reusable instruction sets you can load into any AI Generate node. Save effective prompts here to reuse across workflows.
      </p>

      {/* Create form */}
      {creating && (
        <div className="mb-4 rounded-xl p-4 space-y-3" style={{ backgroundColor: '#fff', border: '1px solid #a200ee' }}>
          <p className="text-[12px] font-semibold" style={{ color: '#7a00b4' }}>New Prompt Template</p>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Name</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Blog Post SEO Instructions"
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium" style={{ color: '#666' }}>Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-purple-400 bg-white"
                style={{ borderColor: '#e8e7e1' }}
              >
                {PROMPT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium" style={{ color: '#666' }}>Description <span style={{ color: '#b4b2a9' }}>(optional)</span></label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short summary…"
                className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
                style={{ borderColor: '#e8e7e1' }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Instructions body</label>
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Paste or write your full instruction set here…"
              rows={6}
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400 resize-y font-mono"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
            <button
              onClick={createTemplate}
              disabled={saving || !newName.trim() || !newBody.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded text-white disabled:opacity-50"
              style={{ backgroundColor: '#a200ee' }}
            >
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e7e1' }}>
        {loading ? (
          <div className="flex justify-center py-8">
            <Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center px-6">
            <Icons.ScrollText className="h-8 w-8" style={{ color: '#e0dfd8' }} />
            <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No prompt templates yet</p>
            <p className="text-[12px]" style={{ color: '#c8c7c0' }}>Create your first template above.</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([cat, catTemplates], gi) => (
              <div key={cat}>
                {gi > 0 && <div style={{ borderTop: '1px solid #e8e7e1' }} />}
                <div className="px-4 py-2" style={{ backgroundColor: '#fafaf8' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#b4b2a9' }}>
                    {PROMPT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat}
                  </p>
                </div>
                {catTemplates.map((t, ti) => (
                  <div key={t.id}>
                    {ti > 0 && <div style={{ borderTop: '1px solid #f0efea' }} />}
                    <div className="px-4 py-3 bg-white">
                      {editingId === t.id ? (
                        <div className="space-y-2.5">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded border px-2 py-1 text-xs font-semibold outline-none focus:border-purple-400"
                            style={{ borderColor: '#e8e7e1' }}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-purple-400 bg-white"
                              style={{ borderColor: '#e8e7e1' }}
                            >
                              {PROMPT_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                            <input
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              placeholder="Description (optional)"
                              className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-purple-400"
                              style={{ borderColor: '#e8e7e1' }}
                            />
                          </div>
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={6}
                            className="w-full rounded border px-2 py-1 text-xs font-mono outline-none focus:border-purple-400 resize-y"
                            style={{ borderColor: '#e8e7e1' }}
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="px-2.5 py-1 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
                            <button
                              onClick={saveEdit}
                              disabled={savingEdit}
                              className="px-2.5 py-1 text-xs font-semibold rounded text-white disabled:opacity-50"
                              style={{ backgroundColor: '#a200ee' }}
                            >
                              {savingEdit ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <button
                                className="flex items-center gap-1 text-left"
                                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                              >
                                <Icons.ChevronRight
                                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                                  style={{ color: '#b4b2a9', transform: expandedId === t.id ? 'rotate(90deg)' : 'none' }}
                                />
                                <span className="text-[13px] font-medium" style={{ color: '#1a1a14' }}>{t.name}</span>
                              </button>
                              {t.description && (
                                <p className="text-[11px] mt-0.5 ml-5" style={{ color: '#b4b2a9' }}>{t.description}</p>
                              )}
                              <div className="flex items-center gap-3 mt-1 ml-5">
                                {t.useCount > 0 && (
                                  <span className="text-[10px]" style={{ color: '#b4b2a9' }}>Used {t.useCount}×</span>
                                )}
                                {t.parentId && (
                                  <span className="text-[10px]" style={{ color: '#b4b2a9' }}>Forked</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => startEdit(t)}
                                className="rounded p-1 hover:bg-gray-100"
                                title="Edit"
                              >
                                <Icons.Pencil className="h-3.5 w-3.5" style={{ color: '#b4b2a9' }} />
                              </button>
                              <button
                                onClick={() => deleteTemplate(t.id)}
                                className="rounded p-1 hover:bg-red-50"
                                title="Delete"
                              >
                                <Icons.Trash2 className="h-3.5 w-3.5" style={{ color: '#f87171' }} />
                              </button>
                            </div>
                          </div>
                          {expandedId === t.id && (
                            <pre className="mt-2 ml-5 whitespace-pre-wrap rounded bg-gray-50 px-3 py-2 text-[11px] font-mono leading-relaxed" style={{ color: '#3a3a2e', border: '1px solid #e8e7e1' }}>
                              {t.body}
                            </pre>
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
    </section>
  )
}

// ── Image Prompts section ─────────────────────────────────────────────────────

interface ImagePrompt {
  id: string
  name: string
  promptText: string
  styleTags: string
  notes: string | null
  sortOrder: number
  createdAt: string
}

function ImagePromptsSection() {
  const [prompts, setPrompts] = useState<ImagePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPromptText, setEditPromptText] = useState('')
  const [editStyleTags, setEditStyleTags] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPromptText, setNewPromptText] = useState('')
  const [newStyleTags, setNewStyleTags] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch('/api/v1/image-prompts?global=true')
      .then((r) => r.json())
      .then(({ data }) => setPrompts(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const startEdit = (p: ImagePrompt) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditPromptText(p.promptText)
    setEditStyleTags(p.styleTags)
    setEditNotes(p.notes ?? '')
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSavingEdit(true)
    try {
      const res = await apiFetch(`/api/v1/image-prompts/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, promptText: editPromptText, styleTags: editStyleTags, notes: editNotes || undefined }),
      })
      if (res.ok) { setEditingId(null); load() }
    } finally { setSavingEdit(false) }
  }

  const deletePrompt = async (id: string) => {
    if (!confirm('Delete this image prompt?')) return
    await apiFetch(`/api/v1/image-prompts/${id}`, { method: 'DELETE' })
    load()
  }

  const createPrompt = async () => {
    if (!newName.trim() || !newPromptText.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/image-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), promptText: newPromptText.trim(), styleTags: newStyleTags.trim(), notes: newNotes.trim() || undefined }),
      })
      if (res.ok) {
        setCreating(false)
        setNewName(''); setNewPromptText(''); setNewStyleTags(''); setNewNotes('')
        load()
      }
    } finally { setSaving(false) }
  }

  const seedDefaults = async () => {
    setSeeding(true)
    try {
      await apiFetch('/api/v1/image-prompts/seed', { method: 'POST' })
      load()
    } finally { setSeeding(false) }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icons.Image className="h-4 w-4" style={{ color: '#b4b2a9' }} />
          <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Image Prompts</h2>
        </div>
        <div className="flex items-center gap-2">
          {prompts.length === 0 && !loading && (
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="flex items-center gap-1 text-[12px] font-medium hover:opacity-80 disabled:opacity-50"
              style={{ color: '#b4b2a9' }}
            >
              <Icons.Sparkles className="h-3.5 w-3.5" />
              {seeding ? 'Seeding…' : 'Seed defaults'}
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
            style={{ color: '#a200ee' }}
          >
            <Icons.Plus className="h-3.5 w-3.5" />
            New prompt
          </button>
        </div>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Agency-level image prompts available to all clients. New clients automatically inherit a copy of these prompts.
      </p>

      {creating && (
        <div className="mb-4 rounded-xl p-4 space-y-3" style={{ backgroundColor: '#fff', border: '1px solid #a200ee' }}>
          <p className="text-[12px] font-semibold" style={{ color: '#7a00b4' }}>New Image Prompt</p>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Name</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Hero — The Platform"
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Style Tags <span style={{ color: '#b4b2a9' }}>(optional)</span></label>
            <input
              value={newStyleTags}
              onChange={(e) => setNewStyleTags(e.target.value)}
              placeholder="e.g. hero, platform, brand"
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Prompt Text</label>
            <textarea
              value={newPromptText}
              onChange={(e) => setNewPromptText(e.target.value)}
              placeholder="Full image generation prompt…"
              rows={5}
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400 resize-y font-mono"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium" style={{ color: '#666' }}>Notes <span style={{ color: '#b4b2a9' }}>(optional)</span></label>
            <input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Usage notes or context…"
              className="w-full rounded border px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
              style={{ borderColor: '#e8e7e1' }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
            <button
              onClick={createPrompt}
              disabled={saving || !newName.trim() || !newPromptText.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded text-white disabled:opacity-50"
              style={{ backgroundColor: '#a200ee' }}
            >
              {saving ? 'Saving…' : 'Save prompt'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e7e1' }}>
        {loading ? (
          <div className="flex justify-center py-8">
            <Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} />
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center px-6">
            <Icons.Image className="h-8 w-8" style={{ color: '#e0dfd8' }} />
            <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No image prompts yet</p>
            <p className="text-[12px]" style={{ color: '#c8c7c0' }}>Create your first prompt above or seed the defaults.</p>
          </div>
        ) : (
          <div>
            {prompts.map((p, i) => (
              <div key={p.id}>
                {i > 0 && <div style={{ borderTop: '1px solid #f0efea' }} />}
                <div className="px-4 py-3 bg-white">
                  {editingId === p.id ? (
                    <div className="space-y-2.5">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded border px-2 py-1 text-xs font-semibold outline-none focus:border-purple-400"
                        style={{ borderColor: '#e8e7e1' }}
                      />
                      <input
                        value={editStyleTags}
                        onChange={(e) => setEditStyleTags(e.target.value)}
                        placeholder="Style tags…"
                        className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-purple-400"
                        style={{ borderColor: '#e8e7e1' }}
                      />
                      <textarea
                        value={editPromptText}
                        onChange={(e) => setEditPromptText(e.target.value)}
                        rows={5}
                        className="w-full rounded border px-2 py-1 text-xs font-mono outline-none focus:border-purple-400 resize-y"
                        style={{ borderColor: '#e8e7e1' }}
                      />
                      <input
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes (optional)…"
                        className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-purple-400"
                        style={{ borderColor: '#e8e7e1' }}
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-2.5 py-1 text-xs rounded border hover:bg-gray-50" style={{ borderColor: '#e8e7e1' }}>Cancel</button>
                        <button
                          onClick={saveEdit}
                          disabled={savingEdit}
                          className="px-2.5 py-1 text-xs font-semibold rounded text-white disabled:opacity-50"
                          style={{ backgroundColor: '#a200ee' }}
                        >
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            className="flex items-center gap-1 text-left"
                            onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                          >
                            <Icons.ChevronRight
                              className="h-3.5 w-3.5 shrink-0 transition-transform"
                              style={{ color: '#b4b2a9', transform: expandedId === p.id ? 'rotate(90deg)' : 'none' }}
                            />
                            <span className="text-[13px] font-medium" style={{ color: '#1a1a14' }}>{p.name}</span>
                          </button>
                          {p.styleTags && (
                            <p className="text-[11px] mt-0.5 ml-5" style={{ color: '#b4b2a9' }}>{p.styleTags}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEdit(p)} className="rounded p-1 hover:bg-gray-100" title="Edit">
                            <Icons.Pencil className="h-3.5 w-3.5" style={{ color: '#b4b2a9' }} />
                          </button>
                          <button onClick={() => deletePrompt(p.id)} className="rounded p-1 hover:bg-red-50" title="Delete">
                            <Icons.Trash2 className="h-3.5 w-3.5" style={{ color: '#f87171' }} />
                          </button>
                        </div>
                      </div>
                      {expandedId === p.id && (
                        <div className="mt-2 ml-5 space-y-1.5">
                          <pre className="whitespace-pre-wrap rounded bg-gray-50 px-3 py-2 text-[11px] font-mono leading-relaxed" style={{ color: '#3a3a2e', border: '1px solid #e8e7e1' }}>
                            {p.promptText}
                          </pre>
                          {p.notes && (
                            <p className="text-[11px]" style={{ color: '#b4b2a9' }}>{p.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── DocTemplateSection ────────────────────────────────────────────────────────

interface DocTemplate {
  id: string
  name: string
  docType: string
  status: string
  sizeBytes: number
  confirmedVars: { variableId: string }[]
  processedKey?: string | null
  createdAt: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  gtm: 'GTM Framework',
  demand_gen: 'Demand Gen',
  branding: 'Branding',
  custom: 'Custom',
}

function DocTemplateSection() {
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/api/v1/doc-templates')
      if (r.ok) { const { data } = await r.json(); setTemplates(data ?? []) }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx')) { alert('Only .docx files are supported'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', file.name.replace(/\.docx$/i, ''))
      fd.append('docType', 'gtm')
      const r = await apiFetch('/api/v1/doc-templates', { method: 'POST', body: fd })
      if (!r.ok) { const b = await r.json().catch(() => ({})); alert('Upload failed: ' + ((b as any).error ?? r.status)); return }
      const { data } = await r.json()
      await load()
      setEditingId(data.id)
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setUploading(false)
    }
  }, [load])

  const deleteTemplate = useCallback(async (id: string) => {
    if (!confirm('Delete this template?')) return
    await apiFetch(`/api/v1/doc-templates/${id}`, { method: 'DELETE' })
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    if (editingId === id) setEditingId(null)
  }, [editingId])

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      pending:   { label: 'Pending',   bg: '#f5f5f5', color: '#6b7280' },
      analyzing: { label: 'Analyzing', bg: '#fef9c3', color: '#854d0e' },
      ready:     { label: 'Ready',     bg: '#dcfce7', color: '#166534' },
      error:     { label: 'Error',     bg: '#fee2e2', color: '#991b1b' },
    }
    const s = map[status] ?? map.pending
    return <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
  }

  return (
    <>
      {editingId && (
        <DocTemplateEditor
          templateId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={load}
        />
      )}

      <section>
        <div className="flex items-center gap-2 mb-1">
          <Icons.LayoutTemplate className="h-4 w-4" style={{ color: '#b4b2a9' }} />
          <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Document Templates</h2>
        </div>
        <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
          Upload a polished Word document as a template. AI suggests where variable placeholders should go.
          Open the editor to confirm placements directly in the rendered document.
        </p>

        {/* Drop / click zone */}
        <input
          ref={uploadRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
        />
        <div
          className="flex items-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors cursor-pointer mb-4"
          style={{ borderColor: dragOver ? '#a200ee' : '#e8e7e1', backgroundColor: dragOver ? '#fdf5ff' : 'transparent' }}
          onClick={() => !uploading && uploadRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleUpload(f) }}
        >
          {uploading
            ? <Icons.Loader2 className="h-4 w-4 animate-spin" style={{ color: '#a200ee' }} />
            : <Icons.Upload className="h-4 w-4" style={{ color: dragOver ? '#a200ee' : '#b4b2a9' }} />}
          <span style={{ color: uploading ? '#a200ee' : dragOver ? '#a200ee' : '#6b6a62' }}>
            {uploading ? 'Uploading and analyzing…' : dragOver ? 'Drop to upload' : 'Drop a .docx here or click to browse'}
          </span>
        </div>

        {/* Template list */}
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-[13px]" style={{ color: '#b4b2a9' }}>
            <Icons.Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : templates.length === 0 ? (
          <p className="text-[13px] py-2" style={{ color: '#b4b2a9' }}>No templates yet. Drop a .docx above to get started.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ border: '1px solid #e8e7e1', backgroundColor: '#fff' }}
              >
                <Icons.FileType className="h-4 w-4 shrink-0" style={{ color: '#a200ee' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: '#1a1a14' }}>{t.name}</p>
                  <p className="text-[11px]" style={{ color: '#b4b2a9' }}>
                    {DOC_TYPE_LABELS[t.docType] ?? t.docType}
                    {' · '}{t.confirmedVars?.length ?? 0} variables
                    {t.processedKey ? ' · Ready' : ''}
                  </p>
                </div>
                {statusBadge(t.status)}
                <button
                  onClick={() => setEditingId(t.id)}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium border"
                  style={{ borderColor: '#e8e7e1', color: '#374151' }}
                >
                  <Icons.Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => deleteTemplate(t.id)}
                  className="shrink-0 rounded p-1 hover:text-red-500"
                  style={{ color: '#b4b2a9' }}
                  title="Delete"
                >
                  <Icons.Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Monday integration card ────────────────────────────────────────────────────
const MONDAY_EVENTS: { value: string; label: string }[] = [
  { value: 'change_status_column_value', label: 'Status column changed' },
  { value: 'change_column_value',        label: 'Any column changed' },
  { value: 'create_item',               label: 'Item created' },
  { value: 'create_update',             label: 'Update posted' },
  { value: 'item_archived',             label: 'Item archived' },
]

function MondayCard() {
  const [status,    setStatus]    = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [working,   setWorking]   = useState(false)
  const [boards,    setBoards]    = useState<{ id: string; name: string }[]>([])
  const [boardId,   setBoardId]   = useState('')
  const [webhooks,  setWebhooks]  = useState<{ id: string; event: string }[]>([])
  const [subbing,   setSubbing]   = useState(false)
  const [subMsg,    setSubMsg]    = useState<string | null>(null)
  const [subEvent,  setSubEvent]  = useState('change_status_column_value')

  useEffect(() => {
    apiFetch('/api/v1/integrations/monday/status')
      .then((r) => r.json())
      .then(({ data }) => setStatus(data?.connected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('monday') === 'connected') {
      setStatus('connected')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (status !== 'connected') return
    apiFetch('/api/v1/integrations/monday/boards')
      .then((r) => r.json())
      .then(({ data }) => {
        const boards = data ?? []
        setBoards(boards)
        if (!boards.length) return
        const saved = localStorage.getItem('monday_board_id')
        const validSaved = saved && boards.some((b: { id: string }) => b.id === saved)
        setBoardId(validSaved ? saved : boards[0].id)
      })
      .catch(() => {})
  }, [status])

  useEffect(() => {
    if (!boardId) return
    apiFetch(`/api/v1/integrations/monday/boards/${boardId}/webhooks`)
      .then((r) => r.json())
      .then(({ data }) => setWebhooks(data ?? []))
      .catch(() => setWebhooks([]))
  }, [boardId])

  const handleConnect = async () => {
    setWorking(true)
    const res = await apiFetch('/api/v1/integrations/monday/connect')
    const { data } = await res.json()
    window.location.href = data.url
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Monday.com?')) return
    setWorking(true)
    await apiFetch('/api/v1/integrations/monday/disconnect', { method: 'DELETE' })
    setStatus('disconnected')
    setWorking(false)
  }

  const handleSubscribe = async () => {
    if (!boardId) return
    setSubbing(true)
    setSubMsg(null)
    try {
      await apiFetch(`/api/v1/integrations/monday/boards/${boardId}/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [subEvent] }),
      })
      const res = await apiFetch(`/api/v1/integrations/monday/boards/${boardId}/webhooks`)
      const { data } = await res.json()
      setWebhooks(data ?? [])
      setSubMsg('Subscribed')
    } catch {
      setSubMsg('Error — check API logs')
    } finally {
      setSubbing(false)
    }
  }

  const handleUnsubscribe = async (webhookId: string) => {
    await apiFetch(`/api/v1/integrations/monday/boards/${boardId}/webhooks/${webhookId}`, { method: 'DELETE' })
    setWebhooks(w => w.filter(x => x.id !== webhookId))
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: '#ff3d57' }}>
            <Icons.LayoutGrid className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: '#1a1a14' }}>Monday.com</p>
            <p className="text-[11px]" style={{ color: '#b4b2a9' }}>CEO grid, inline editing, and workflow triggers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'loading' && <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === 'connected' && (
            <>
              <span className="flex items-center gap-1 text-[11px] font-medium text-green-600">
                <Icons.CheckCircle2 className="h-3 w-3" /> Connected
              </span>
              <button
                onClick={handleDisconnect}
                disabled={working}
                className="rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
                style={{ borderColor: '#e8e7e1', color: '#5c5b52' }}
              >
                Disconnect
              </button>
            </>
          )}
          {status === 'disconnected' && (
            <button
              onClick={handleConnect}
              disabled={working}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#a200ee' }}
            >
              {working ? 'Redirecting…' : 'Connect Monday'}
            </button>
          )}
        </div>
      </div>

      {status === 'connected' && boards.length > 0 && (
        <div className="mt-3 border-t border-border pt-3 flex flex-col gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">Board webhook subscriptions</p>

          {/* Board selector */}
          <select
            value={boardId}
            onChange={(e) => { setBoardId(e.target.value); localStorage.setItem('monday_board_id', e.target.value) }}
            className="h-7 w-full rounded border border-border bg-muted/20 px-2 text-xs outline-none"
          >
            {boards.map(b => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
          </select>

          {/* Event selector + subscribe button */}
          <div className="flex items-center gap-2">
            <select
              value={subEvent}
              onChange={(e) => setSubEvent(e.target.value)}
              className="flex-1 h-7 rounded border border-border bg-muted/20 px-2 text-xs outline-none"
            >
              {MONDAY_EVENTS.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
            </select>
            <button
              onClick={handleSubscribe}
              disabled={subbing || !boardId}
              className="rounded px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50 whitespace-nowrap"
              style={{ backgroundColor: '#a200ee' }}
            >
              {subbing ? 'Subscribing…' : '+ Subscribe'}
            </button>
          </div>

          {subMsg && <p className="text-[11px] text-green-600">{subMsg}</p>}

          {/* Active subscriptions */}
          {webhooks.length > 0 && (
            <div className="flex flex-col gap-1">
              {webhooks.map(w => {
                const label = MONDAY_EVENTS.find(ev => ev.value === w.event)?.label ?? w.event
                return (
                  <div key={w.id} className="flex items-center justify-between rounded bg-muted/20 px-2 py-1.5">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-medium" style={{ color: '#1a1a14' }}>{label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{w.event}</span>
                    </div>
                    <button onClick={() => handleUnsubscribe(w.id)} className="text-[10px] text-red-500 hover:text-red-700">Remove</button>
                  </div>
                )
              })}
            </div>
          )}
          {webhooks.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">No active subscriptions on this board</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Box integration card ───────────────────────────────────────────────────────
function BoxCard() {
  const [status,  setStatus]  = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/integrations/box/status')
      .then((r) => r.json())
      .then(({ data }) => setStatus(data?.connected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('box') === 'connected') {
      setStatus('connected')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleConnect = async () => {
    setWorking(true)
    const res = await apiFetch('/api/v1/integrations/box/connect')
    const { data } = await res.json()
    window.location.href = data.url
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Box.com? Automatic folder creation will stop.')) return
    setWorking(true)
    await apiFetch('/api/v1/integrations/box/disconnect', { method: 'DELETE' })
    setStatus('disconnected')
    setWorking(false)
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: '#0061D5' }}>
            <Icons.FolderOpen className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: '#1a1a14' }}>Box.com</p>
            <p className="text-[11px]" style={{ color: '#b4b2a9' }}>Auto-create client folders when items are added in Monday</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'loading' && <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === 'connected' && (
            <>
              <span className="flex items-center gap-1 text-[11px] font-medium text-green-600">
                <Icons.CheckCircle2 className="h-3 w-3" /> Connected
              </span>
              <button
                onClick={handleDisconnect}
                disabled={working}
                className="rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
                style={{ borderColor: '#e8e7e1', color: '#5c5b52' }}
              >
                Disconnect
              </button>
            </>
          )}
          {status === 'disconnected' && (
            <button
              onClick={handleConnect}
              disabled={working}
              className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#a200ee' }}
            >
              {working ? 'Redirecting…' : 'Connect Box'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Integrations ──────────────────────────────────────────────────────────────
// ── CredentialsSection ────────────────────────────────────────────────────────

interface Credential { id: string; provider: string; keyName: string; meta: Record<string, unknown> | null }

const PROVIDERS = [
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'resend',   label: 'Resend'   },
  { value: 'mailgun',  label: 'Mailgun'  },
]

function CredentialsSection() {
  const [creds, setCreds]     = useState<Credential[]>([])
  const [adding, setAdding]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [provider, setProvider] = useState('sendgrid')
  const [keyName, setKeyName]   = useState('Default')
  const [keyValue, setKeyValue] = useState('')
  const [mailgunDomain, setMailgunDomain] = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    apiFetch('/api/v1/settings/credentials')
      .then((r) => r.json())
      .then(({ data }) => { if (Array.isArray(data)) setCreds(data) })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!keyValue.trim()) { setError('API key is required'); return }
    setSaving(true); setError('')
    const meta: Record<string, unknown> = {}
    if (provider === 'mailgun' && mailgunDomain.trim()) meta.mailgunDomain = mailgunDomain.trim()
    const res = await apiFetch('/api/v1/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({ provider, keyName: keyName.trim() || 'Default', keyValue: keyValue.trim(), meta }),
    })
    if (!res.ok) { setError('Failed to save'); setSaving(false); return }
    const { data } = await res.json()
    setCreds((prev) => {
      const filtered = prev.filter((c) => !(c.provider === data.provider && c.keyName === data.keyName))
      return [...filtered, data]
    })
    setAdding(false); setKeyValue(''); setSaving(false)
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/v1/settings/credentials/${id}`, { method: 'DELETE' })
    setCreds((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Icons.KeyRound className="h-4 w-4" style={{ color: '#b4b2a9' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Email Provider Credentials</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Store your email provider API keys here. Email nodes use these automatically — no key needed in the node config.
      </p>

      <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
        {creds.length === 0 && !adding && (
          <p className="text-[13px]" style={{ color: '#b4b2a9' }}>No credentials saved yet.</p>
        )}
        {creds.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ border: '1px solid #e8e7e1' }}>
            <div>
              <p className="text-[13px] font-medium" style={{ color: '#1a1a14' }}>
                {PROVIDERS.find((p) => p.value === c.provider)?.label ?? c.provider}
                {c.keyName !== 'Default' && <span className="ml-1.5 text-[11px]" style={{ color: '#b4b2a9' }}>({c.keyName})</span>}
              </p>
              {c.meta?.mailgunDomain && (
                <p className="text-[11px]" style={{ color: '#b4b2a9' }}>Domain: {c.meta.mailgunDomain as string}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>Saved</span>
              <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                <Icons.Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {adding ? (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: '#b4b2a9' }}>Provider</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-[13px]" style={{ border: '1px solid #e8e7e1', backgroundColor: '#fafaf8', color: '#1a1a14' }}>
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: '#b4b2a9' }}>Label</label>
                <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Default"
                  className="w-full rounded-lg px-3 py-2 text-[13px]" style={{ border: '1px solid #e8e7e1', backgroundColor: '#fafaf8', color: '#1a1a14' }} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: '#b4b2a9' }}>API Key</label>
              <input type="password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder="Paste your API key"
                className="w-full rounded-lg px-3 py-2 text-[13px] font-mono" style={{ border: '1px solid #e8e7e1', backgroundColor: '#fafaf8', color: '#1a1a14' }} />
            </div>
            {provider === 'mailgun' && (
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: '#b4b2a9' }}>Mailgun Domain</label>
                <input value={mailgunDomain} onChange={(e) => setMailgunDomain(e.target.value)} placeholder="mg.yourdomain.com"
                  className="w-full rounded-lg px-3 py-2 text-[13px]" style={{ border: '1px solid #e8e7e1', backgroundColor: '#fafaf8', color: '#1a1a14' }} />
              </div>
            )}
            {error && <p className="text-[12px]" style={{ color: '#dc2626' }}>{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white transition-opacity"
                style={{ backgroundColor: '#1a1a14', opacity: saving ? 0.5 : 1 }}>
                {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Check className="h-3 w-3" />}
                Save
              </button>
              <button onClick={() => { setAdding(false); setError('') }}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ border: '1px solid #e8e7e1', color: '#b4b2a9' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium transition-colors pt-1" style={{ color: '#a200ee' }}>
            <Icons.Plus className="h-3.5 w-3.5" />
            Add credential
          </button>
        )}
      </div>
    </section>
  )
}

function IntegrationsSection() {
  const [status, setStatus]   = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/integrations/wrike/status')
      .then((r) => r.json())
      .then(({ data }) => setStatus(data?.connected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'))
  }, [])

  const handleConnect = async () => {
    setWorking(true)
    const res = await apiFetch('/api/v1/integrations/wrike/connect')
    const { data } = await res.json()
    window.location.href = data.url
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Wrike? Existing workflows using the Wrike source node will stop working.')) return
    setWorking(true)
    await apiFetch('/api/v1/integrations/wrike/disconnect', { method: 'DELETE' })
    setStatus('disconnected')
    setWorking(false)
  }

  // Handle redirect back from Wrike OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wrike  = params.get('wrike')
    if (wrike === 'connected') {
      setStatus('connected')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Icons.Plug className="h-4 w-4" style={{ color: '#b4b2a9' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Integrations</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Connect third-party tools to use as data sources in your workflows.
      </p>
      <div className="flex flex-col gap-3">
      <div className="rounded-xl p-4" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: '#00436B' }}>
              <Icons.CheckSquare className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: '#1a1a14' }}>Wrike</p>
              <p className="text-[11px]" style={{ color: '#b4b2a9' }}>Pull completed tasks into campaign workflows</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'loading' && <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {status === 'connected' && (
              <>
                <span className="flex items-center gap-1 text-[11px] font-medium text-green-600">
                  <Icons.CheckCircle2 className="h-3 w-3" /> Connected
                </span>
                <button
                  onClick={handleDisconnect}
                  disabled={working}
                  className="rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  style={{ borderColor: '#e8e7e1', color: '#5c5b52' }}
                >
                  Disconnect
                </button>
              </>
            )}
            {status === 'disconnected' && (
              <button
                onClick={handleConnect}
                disabled={working}
                className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#a200ee' }}
              >
                {working ? 'Redirecting…' : 'Connect Wrike'}
              </button>
            )}
          </div>
        </div>
      </div>
      <MondayCard />
      <BoxCard />
      </div>
    </section>
  )
}

export function SettingsPage() {
  const [savedDays, setSavedDays] = useState<number | null>(null)
  const [tempExpiryDays, setTempExpiryDays] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/settings')
      .then((r) => r.json())
      .then(({ data }: { data: AgencySettings }) => {
        const days = data?.tempContactExpiryDays ?? null
        setSavedDays(days)
        setTempExpiryDays(days)
      })
      .catch(() => setLoadError(true))
  }, [])

  const isDirty = tempExpiryDays !== savedDays

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ tempContactExpiryDays: tempExpiryDays }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSaveError((body as { error?: string }).error ?? `Failed to save (${res.status})`)
        return
      }
      const { data }: { data: AgencySettings } = await res.json()
      setSavedDays(data?.tempContactExpiryDays ?? null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid #e8e7e1', backgroundColor: '#fff' }}
      >
        <div>
          <h1 className="text-[20px] font-semibold" style={{ color: '#1a1a14' }}>Settings</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: '#b4b2a9' }}>Organization-level configuration</p>
        </div>
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#a200ee' }}
          >
            {saving
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : saved
                ? <Icons.Check className="h-3.5 w-3.5" />
                : <Icons.Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6" style={{ backgroundColor: '#fafaf8' }}>
        <div style={{ maxWidth: 560 }} className="space-y-10">

          {/* ── Integrations ─────────────────────────────────────────────── */}
          <CredentialsSection />

          <IntegrationsSection />

          {/* ── Style Templates ──────────────────────────────────────────── */}
          <DocStyleSection />

          {/* ── Document Templates ───────────────────────────────────────── */}
          <DocTemplateSection />

          {/* ── File Library ─────────────────────────────────────────────── */}
          <LibrarySection />

          {/* ── Prompt Templates ─────────────────────────────────────────── */}
          <PromptsSection />

          {/* ── Image Prompts ────────────────────────────────────────────── */}
          <ImagePromptsSection />

          {/* ── External Contacts ────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Icons.UserX className="h-4 w-4" style={{ color: '#b4b2a9' }} />
              <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>External Contacts</h2>
            </div>
            <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
              When you share a deliverable with someone outside your client's contact list, they are
              automatically added as an external contact. Configure how long these contacts are kept
              before being archived.
            </p>

            {loadError && (
              <div
                className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12px]"
                style={{ backgroundColor: '#fff8e6', border: '1px solid #ffbc44', color: '#7a5200' }}
              >
                <Icons.AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Could not load saved settings — showing defaults. Changes can still be saved.
              </div>
            )}

            <div
              className="rounded-xl p-4 space-y-2"
              style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: '#b4b2a9' }}>
                Auto-archive after
              </p>
              {EXPIRY_OPTIONS.map((opt) => {
                const active = tempExpiryDays === opt.value
                return (
                  <button
                    key={String(opt.value)}
                    onClick={() => setTempExpiryDays(opt.value)}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={
                      active
                        ? { border: '1px solid #a200ee', backgroundColor: '#fdf5ff' }
                        : { border: '1px solid #e8e7e1', backgroundColor: '#fafaf8' }
                    }
                  >
                    <div
                      className="h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center"
                      style={{ borderColor: active ? '#a200ee' : '#dddcd6' }}
                    >
                      {active && (
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: '#a200ee' }} />
                      )}
                    </div>
                    <span
                      className="text-[13px]"
                      style={{ color: active ? '#7a00b4' : '#1a1a14', fontWeight: active ? 500 : 400 }}
                    >
                      {opt.label}
                    </span>
                  </button>
                )
              })}
            </div>

            <div
              className="mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-[12px]"
              style={{ backgroundColor: '#fff8e6', border: '1px solid #ffbc44', color: '#7a5200' }}
            >
              <Icons.Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Archiving removes the contact from active lists but preserves their feedback and
                access history. Contacts with submitted feedback are archived, not deleted.
              </span>
            </div>
          </section>

          {saveError && (
            <div
              className="flex items-center gap-2 rounded-md px-3 py-2 text-[12px]"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
            >
              <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {saveError}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
