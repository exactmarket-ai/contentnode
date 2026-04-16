import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatBytes } from '@/components/layout/config/shared'

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

// ── Main page ─────────────────────────────────────────────────────────────────

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

          {/* ── Style Templates ──────────────────────────────────────────── */}
          <DocStyleSection />

          {/* ── File Library ─────────────────────────────────────────────── */}
          <LibrarySection />

          {/* ── Prompt Templates ─────────────────────────────────────────── */}
          <PromptsSection />

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
