import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BrandVertical { id: string; name: string; createdAt: string }

interface BrandAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  extractionStatus: 'pending' | 'processing' | 'ready' | 'failed'
  errorMessage?: string | null
  extractedText?: string | null
  summary?: string | null
  summaryStatus?: 'pending' | 'processing' | 'ready' | 'failed'
  gtmSummary?: string | null
  gtmSummaryStatus?: 'pending' | 'processing' | 'ready' | 'failed' | null
  gtmAttachmentId?: string | null
  gtmVerticalId?: string | null
}

interface BrandJson {
  brand_name?: string
  tagline?: string
  mission?: string
  vision?: string
  values?: string[]
  voice_and_tone?: {
    personality_traits?: string[]
    writing_style?: string
    vocabulary_to_use?: string[]
    vocabulary_to_avoid?: string[]
  }
  visual_identity?: {
    primary_colors?: string[]
    secondary_colors?: string[]
    typography?: string
    imagery_style?: string
  }
  target_audience?: {
    primary?: string
    secondary?: string
    psychographics?: string[]
  }
  positioning?: {
    category?: string
    differentiators?: string[]
    competitive_context?: string
  }
  messaging?: {
    core_message?: string
    proof_points?: string[]
    value_propositions?: string[]
  }
  do_not_use?: string[]
}

interface BrandProfile {
  id: string
  extractionStatus: 'idle' | 'extracting' | 'ready' | 'failed'
  extractedJson: BrandJson | null
  editedJson: BrandJson | null
  sourceText: string | null
  errorMessage: string | null
  websiteUrl: string | null
}

interface BuilderData {
  brand_name?: string
  tagline?: string
  mission?: string
  vision?: string
  values?: string[]
  voice_and_tone?: {
    personality_traits?: string[]
    writing_style?: string
    vocabulary_to_use?: string[]
    vocabulary_to_avoid?: string[]
  }
  target_audience?: {
    primary?: string
    secondary?: string
    psychographics?: string[]
  }
  positioning?: {
    category?: string
    differentiators?: string[]
    competitive_context?: string
  }
  messaging?: {
    core_message?: string
    value_propositions?: string[]
    proof_points?: string[]
  }
  visual_identity?: {
    primary_colors?: string[]
    secondary_colors?: string[]
    typography?: string
    imagery_style?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">{children}</label>
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring resize-y"
    />
  )
}

/** Tag chip input — shows chips + text input to add more */
function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')

  const add = () => {
    const trimmed = input.trim()
    if (!trimmed || values.includes(trimmed)) { setInput(''); return }
    onChange([...values, trimmed])
    setInput('')
  }

  return (
    <div className="min-h-[38px] rounded-md border border-border bg-background px-2 py-1.5 flex flex-wrap gap-1 items-center focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
      {values.map((v) => (
        <span
          key={v}
          className="flex items-center gap-0.5 rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >×</button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
      />
    </div>
  )
}

/** Color swatch input */
function ColorInput({ color, onChange, onRemove }: { color: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={color.startsWith('#') ? color : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <input
        type="text"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-foreground focus:outline-none focus:border-ring"
        placeholder="#000000"
      />
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-red-500 text-xs">×</button>
    </div>
  )
}

/** Color array input — up to 5 swatches */
function ColorArrayInput({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {values.map((c, i) => (
        <ColorInput
          key={i}
          color={c}
          onChange={(v) => { const n = [...values]; n[i] = v; onChange(n) }}
          onRemove={() => onChange(values.filter((_, j) => j !== i))}
        />
      ))}
      {values.length < 5 && (
        <button
          type="button"
          onClick={() => onChange([...values, '#000000'])}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >+ Add color</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// File icon helper
// ─────────────────────────────────────────────────────────────────────────────

function fileIcon(mimeType: string): string {
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📝'
  if (mimeType.includes('csv') || mimeType.includes('excel')) return '📊'
  if (mimeType.includes('json')) return '🗂️'
  if (mimeType.includes('html')) return '🌐'
  if (mimeType.includes('text') || mimeType.includes('markdown')) return '📃'
  return '📎'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Attachment Row (GTM-style expandable file row)
// ─────────────────────────────────────────────────────────────────────────────

function BrandAttachmentRow({
  attachment: a,
  clientId,
  deletingId,
  onDelete,
  onSummaryUpdated,
}: {
  attachment: BrandAttachment
  clientId: string
  deletingId: string | null
  onDelete: (a: BrandAttachment) => void
  onSummaryUpdated: (id: string, summary: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingBrand, setEditingBrand] = useState(false)
  const [brandEditValue, setBrandEditValue] = useState(a.summary ?? '')
  const [savingBrand, setSavingBrand] = useState(false)
  const [editingGtm, setEditingGtm] = useState(false)
  const [gtmEditValue, setGtmEditValue] = useState(a.gtmSummary ?? '')
  const [savingGtm, setSavingGtm] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  const brandBase = `/api/v1/clients/${clientId}/brand-profile/attachments`

  const handleSaveBrand = async () => {
    setSavingBrand(true)
    try {
      const res = await apiFetch(`${brandBase}/${a.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: brandEditValue }),
      })
      if (res.ok) {
        onSummaryUpdated(a.id, brandEditValue)
        setEditingBrand(false)
      }
    } catch { /* ignore */ } finally {
      setSavingBrand(false)
    }
  }

  const handleSaveGtm = async () => {
    if (!a.gtmAttachmentId || !a.gtmVerticalId) return
    setSavingGtm(true)
    try {
      const res = await apiFetch(
        `/api/v1/clients/${clientId}/framework/${a.gtmVerticalId}/attachments/${a.gtmAttachmentId}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: gtmEditValue }) }
      )
      if (res.ok) setEditingGtm(false)
    } catch { /* ignore */ } finally {
      setSavingGtm(false)
    }
  }

  const handleViewOriginal = async () => {
    if (rawText !== null) { setShowOriginal(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(`${brandBase}/${a.id}/text`)
      if (res.ok) {
        const { data } = await res.json()
        setRawText(data.text ?? '')
      }
    } catch { /* ignore */ } finally {
      setLoadingText(false)
      setShowOriginal(true)
    }
  }

  function statusBadge() {
    if (a.extractionStatus === 'pending' || a.extractionStatus === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
          <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
          Reading…
        </span>
      )
    }
    if (a.extractionStatus === 'failed') {
      return (
        <span className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0 text-[10px] text-destructive">
          Failed
        </span>
      )
    }
    // extraction ready — show summary status
    if (a.summaryStatus === 'pending' || a.summaryStatus === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
          <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
          Interpreting…
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full border border-green-500/40 bg-green-500/10 px-1.5 py-0 text-[10px] font-medium text-green-600 dark:text-green-400">
        ✓ Interpreted
      </span>
    )
  }

  const isProcessing = a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
    a.summaryStatus === 'pending' || a.summaryStatus === 'processing'

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Row header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/20"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-3 shrink-0 text-[11px] text-muted-foreground">
          {expanded ? '▼' : '▶'}
        </span>
        <span className="shrink-0 text-lg">{fileIcon(a.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}
            </span>
            {statusBadge()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(a) }}
          disabled={deletingId === a.id}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-40"
        >
          {deletingId === a.id ? (
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          )}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border bg-card px-4 pb-4 pt-3">
          {a.extractionStatus === 'failed' ? (
            <p className="text-[11px] text-destructive">
              {a.errorMessage ?? 'Extraction failed. Try re-uploading the file.'}
            </p>
          ) : isProcessing ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Icons.Loader2 className="h-4 w-4 animate-spin" />
              Claude is reading and interpreting this file…
            </div>
          ) : (
            <div className="space-y-3">
              {/* Brand Read */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Brand Read</p>
                  {!editingBrand && (
                    <div className="flex items-center gap-3">
                      <button onClick={handleViewOriginal} disabled={loadingText} className="text-[10px] text-muted-foreground underline hover:text-foreground">
                        {loadingText ? 'Loading…' : 'View original text'}
                      </button>
                      <button onClick={() => { setBrandEditValue(a.summary ?? ''); setEditingBrand(true) }} className="text-[10px] text-primary underline hover:text-primary/80">
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                {editingBrand ? (
                  <div>
                    <textarea
                      className="w-full resize-y rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      rows={8}
                      value={brandEditValue}
                      onChange={(e) => setBrandEditValue(e.target.value)}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={handleSaveBrand} disabled={savingBrand} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        {savingBrand ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingBrand(false); setBrandEditValue(a.summary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/30 px-3 py-2.5">
                    {a.summary ? (
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{a.summary}</p>
                    ) : (
                      <p className="text-[11px] italic text-muted-foreground">No interpretation yet — click Edit to add one manually.</p>
                    )}
                  </div>
                )}
              </div>

              {/* GTM Framework Read */}
              {(a.gtmSummary || a.gtmSummaryStatus === 'pending' || a.gtmSummaryStatus === 'processing' || a.gtmSummaryStatus === 'ready') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">GTM Framework Read</p>
                    {!editingGtm && a.gtmSummaryStatus === 'ready' && a.gtmAttachmentId && (
                      <button onClick={() => { setGtmEditValue(a.gtmSummary ?? ''); setEditingGtm(true) }} className="text-[10px] text-primary underline hover:text-primary/80">
                        Edit
                      </button>
                    )}
                  </div>
                  {a.gtmSummaryStatus === 'pending' || a.gtmSummaryStatus === 'processing' ? (
                    <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                      <Icons.Loader2 className="h-3 w-3 animate-spin" />
                      GTM analysis in progress…
                    </div>
                  ) : editingGtm ? (
                    <div>
                      <textarea
                        className="w-full resize-y rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        rows={8}
                        value={gtmEditValue}
                        onChange={(e) => setGtmEditValue(e.target.value)}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={handleSaveGtm} disabled={savingGtm} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                          {savingGtm ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingGtm(false); setGtmEditValue(a.gtmSummary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/30 px-3 py-2.5">
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{a.gtmSummary}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Raw original text modal */}
      {showOriginal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
          onClick={() => setShowOriginal(false)}
        >
          <div
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
            style={{ maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between bg-primary px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/70">Original Extracted Text</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-primary-foreground">{a.filename}</p>
              </div>
              <button
                onClick={() => setShowOriginal(false)}
                className="ml-4 shrink-0 rounded p-1 text-primary-foreground/70 hover:text-primary-foreground"
              >✕</button>
            </div>
            <div className="overflow-auto bg-card p-6">
              {rawText ? (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">{rawText}</pre>
              ) : (
                <p className="text-sm italic text-muted-foreground">No extracted text available for this file.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Profile sub-section
// ─────────────────────────────────────────────────────────────────────────────

function BrandProfileSection({
  clientId,
  verticalId,
}: {
  clientId: string
  verticalId: string | null
}) {
  const [attachments, setAttachments] = useState<BrandAttachment[]>([])
  const [profile, setProfile] = useState<BrandProfile | null>(null)
  const [loadingAttachments, setLoadingAttachments] = useState(true)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [uploadingCount, setUploadingCount] = useState(0)
  const uploading = uploadingCount > 0
  const [dragging, setDragging] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editedJson, setEditedJson] = useState<BrandJson>({})
  const [saving, setSaving] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const qs = verticalId ? `?verticalId=${verticalId}` : ''
  const baseAttachments = `/api/v1/clients/${clientId}/brand-profile/attachments`
  const baseProfile = `/api/v1/clients/${clientId}/brand-profile`

  const fetchAll = useCallback(async () => {
    const [attRes, profRes] = await Promise.all([
      apiFetch(`${baseAttachments}${qs}`).then((r) => r.json()),
      apiFetch(`${baseProfile}${qs}`).then((r) => r.json()),
    ])
    setAttachments(attRes.data ?? [])
    const p: BrandProfile | null = profRes.data ?? null
    setProfile(p)
    if (p) {
      const live = (p.editedJson ?? p.extractedJson ?? {}) as BrandJson
      setEditedJson(live)
    }
  }, [baseAttachments, baseProfile, qs])

  useEffect(() => {
    setLoadingAttachments(true)
    setLoadingProfile(true)
    fetchAll().finally(() => { setLoadingAttachments(false); setLoadingProfile(false) })
  }, [fetchAll])

  // Poll while any attachment is pending/processing or profile is extracting
  useEffect(() => {
    const hasInProgress =
      attachments.some((a) =>
        a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
        a.summaryStatus === 'pending' || a.summaryStatus === 'processing' ||
        a.gtmSummaryStatus === 'pending' || a.gtmSummaryStatus === 'processing'
      ) ||
      profile?.extractionStatus === 'extracting'
    if (!hasInProgress) return
    const t = setTimeout(() => { fetchAll() }, 4000)
    return () => clearTimeout(t)
  }, [attachments, profile, fetchAll])

  const uploadFile = async (file: File) => {
    setUploadingCount((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(`${baseAttachments}${qs}`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Upload failed'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      setUploadError(null)
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
    } catch { /* ignore */ } finally {
      setUploadingCount((n) => n - 1)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(uploadFile)
  }

  const handleDelete = async (a: BrandAttachment) => {
    if (!confirm(`Delete "${a.filename}"?`)) return
    setDeletingId(a.id)
    try {
      await apiFetch(`${baseAttachments}/${a.id}`, { method: 'DELETE' })
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch { /* ignore */ } finally {
      setDeletingId(null)
    }
  }

  const handleAddNote = async () => {
    const trimmed = noteText.trim()
    if (!trimmed) return
    setAddingNote(true)
    try {
      const blob = new Blob([trimmed], { type: 'text/plain' })
      const timestamp = new Date().toISOString().slice(0, 10)
      const file = new File([blob], `notes-${timestamp}.txt`, { type: 'text/plain' })
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(`${baseAttachments}${qs}`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Failed to add note'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setNoteText('')
      setShowNoteInput(false)
    } catch { /* ignore */ } finally {
      setAddingNote(false)
    }
  }

  const handleAddUrl = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setAddingUrl(true)
    try {
      const res = await apiFetch(`${baseAttachments}/from-url${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Failed to add URL'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setUrlInput('')
      setShowUrlInput(false)
    } catch { /* ignore */ } finally {
      setAddingUrl(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`${baseProfile}${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedJson }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setProfile(data)
      }
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const setField = (path: string[], value: unknown) => {
    setEditedJson((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Record<string, unknown>
      let node: Record<string, unknown> = next
      for (let i = 0; i < path.length - 1; i++) {
        if (!node[path[i]] || typeof node[path[i]] !== 'object') node[path[i]] = {}
        node = node[path[i]] as Record<string, unknown>
      }
      node[path[path.length - 1]] = value
      return next as BrandJson
    })
  }

  const s = (path: string[]): string => {
    let cur: unknown = editedJson
    for (const k of path) {
      if (cur == null || typeof cur !== 'object') return ''
      cur = (cur as Record<string, unknown>)[k]
    }
    return typeof cur === 'string' ? cur : ''
  }

  const arr = (path: string[]): string[] => {
    let cur: unknown = editedJson
    for (const k of path) {
      if (cur == null || typeof cur !== 'object') return []
      cur = (cur as Record<string, unknown>)[k]
    }
    return Array.isArray(cur) ? cur as string[] : []
  }

  const hasProfile = profile?.extractedJson || profile?.editedJson
  const isExtracting = profile?.extractionStatus === 'extracting' ||
    attachments.some((a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing')

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div>
        <div className="mb-3">
          <SectionHeading>Brand Documents</SectionHeading>
          <h3 className="text-base font-semibold text-foreground">Upload brand files</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Upload brand guidelines, style guides, or any documents that define this brand. Claude will extract a structured brand profile automatically.
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            'relative rounded-xl border-2 border-dashed p-6 text-center transition-colors',
            dragging ? 'border-ring bg-accent/20' : 'border-border hover:border-muted-foreground/40'
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {uploading ? (
            <p className="text-sm text-muted-foreground">
              Uploading{uploadingCount > 1 ? ` ${uploadingCount} files` : ''}…
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Drag files here or{' '}
                <button type="button" onClick={() => inputRef.current?.click()} className="text-foreground underline hover:text-muted-foreground">
                  browse
                </button>
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/60">PDF · DOCX · TXT · MD · CSV · JSON · HTML</p>
            </>
          )}
        </div>

        {/* Intake options row */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => { setShowNoteInput((v) => !v); setShowUrlInput(false) }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-[10px]">{showNoteInput ? '▼' : '▶'}</span>
            Paste notes
          </button>
          <button
            type="button"
            onClick={() => { setShowUrlInput((v) => !v); setShowNoteInput(false) }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-[10px]">{showUrlInput ? '▼' : '▶'}</span>
            Add URL
          </button>
        </div>

        {showNoteInput && (
          <div className="mt-2 space-y-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Paste brand guidelines, messaging notes, tone rules, or any context you want Claude to learn from…"
              rows={5}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddNote}
                disabled={addingNote || !noteText.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addingNote ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Plus className="h-3 w-3" />}
                Add to brain
              </button>
              <button type="button" onClick={() => { setShowNoteInput(false); setNoteText('') }} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        {showUrlInput && (
          <div className="mt-2 space-y-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
              placeholder="https://example.com/brand-guidelines"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">
              Claude will scrape and read the page content. Works with brand pages, press releases, LinkedIn, case studies, etc.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddUrl}
                disabled={addingUrl || !urlInput.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addingUrl ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Link className="h-3 w-3" />}
                Add to brain
              </button>
              <button type="button" onClick={() => { setShowUrlInput(false); setUrlInput('') }} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {uploadError}
          </div>
        )}

        {/* Brain summary */}
        {!loadingAttachments && attachments.length > 0 && (() => {
          const ready = attachments.filter((a) => a.extractionStatus === 'ready').length
          const processing = attachments.filter((a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing').length
          const failed = attachments.filter((a) => a.extractionStatus === 'failed').length
          return (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {ready > 0 ? `✓ ${ready} file${ready !== 1 ? 's' : ''} in brain` : 'Files processing…'}
                  {processing > 0 && ` · ${processing} processing`}
                  {failed > 0 && ` · ${failed} failed`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {ready > 0
                    ? 'Claude has read these files and extracted a structured brand profile below.'
                    : 'Files are being read — the brand profile will appear when ready.'}
                </p>
              </div>
              {ready > 0 && (
                <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Brain active
                </span>
              )}
            </div>
          )
        })()}

        {/* Attachment list */}
        {!loadingAttachments && attachments.length > 0 && (
          <div className="mt-3 space-y-2">
            {attachments.map((a) => (
              <BrandAttachmentRow
                key={a.id}
                attachment={a}
                clientId={clientId}
                deletingId={deletingId}
                onDelete={handleDelete}
                onSummaryUpdated={(id, summary) =>
                  setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary, summaryStatus: 'ready' } : x))
                }
              />
            ))}
          </div>
        )}

        {/* Extraction status banner */}
        {isExtracting && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-accent/30 px-4 py-2.5 text-sm text-foreground">
            <div className="h-2 w-2 animate-pulse rounded-full bg-foreground/50" />
            Claude is reading your files and extracting the brand profile…
          </div>
        )}
        {profile?.extractionStatus === 'failed' && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/20 px-4 py-2.5 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20">
            Extraction failed: {profile.errorMessage ?? 'Unknown error'}
          </div>
        )}
      </div>

      {/* Editable brand fields */}
      {(hasProfile || Object.keys(editedJson).length > 0) && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <SectionHeading>Extracted Brand Profile</SectionHeading>
              <h3 className="text-base font-semibold text-foreground">Review & edit</h3>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {/* Identity */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Brand Name</FieldLabel>
                <TextInput value={s(['brand_name'])} onChange={(v) => setField(['brand_name'], v)} placeholder="Acme Corp" />
              </div>
              <div>
                <FieldLabel>Tagline</FieldLabel>
                <TextInput value={s(['tagline'])} onChange={(v) => setField(['tagline'], v)} placeholder="Your tagline" />
              </div>
            </div>
            <div>
              <FieldLabel>Mission</FieldLabel>
              <TextArea value={s(['mission'])} onChange={(v) => setField(['mission'], v)} placeholder="What drives this brand?" />
            </div>
            <div>
              <FieldLabel>Vision</FieldLabel>
              <TextArea value={s(['vision'])} onChange={(v) => setField(['vision'], v)} placeholder="Where is this brand going?" />
            </div>
            <div>
              <FieldLabel>Core Values</FieldLabel>
              <TagInput values={arr(['values'])} onChange={(v) => setField(['values'], v)} placeholder="Add a value…" />
            </div>
          </div>

          {/* Voice & Tone */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Voice & Tone</p>
            <div>
              <FieldLabel>Personality Traits</FieldLabel>
              <TagInput values={arr(['voice_and_tone', 'personality_traits'])} onChange={(v) => setField(['voice_and_tone', 'personality_traits'], v)} placeholder="confident, approachable…" />
            </div>
            <div>
              <FieldLabel>Writing Style</FieldLabel>
              <TextInput value={s(['voice_and_tone', 'writing_style'])} onChange={(v) => setField(['voice_and_tone', 'writing_style'], v)} placeholder="Conversational and direct" />
            </div>
            <div>
              <FieldLabel>Vocabulary to Use</FieldLabel>
              <TagInput values={arr(['voice_and_tone', 'vocabulary_to_use'])} onChange={(v) => setField(['voice_and_tone', 'vocabulary_to_use'], v)} placeholder="Add a term…" />
            </div>
            <div>
              <FieldLabel>Vocabulary to Avoid</FieldLabel>
              <TagInput values={arr(['voice_and_tone', 'vocabulary_to_avoid'])} onChange={(v) => setField(['voice_and_tone', 'vocabulary_to_avoid'], v)} placeholder="Add a term…" />
            </div>
          </div>

          {/* Target Audience */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Target Audience</p>
            <div>
              <FieldLabel>Primary Audience</FieldLabel>
              <TextArea value={s(['target_audience', 'primary'])} onChange={(v) => setField(['target_audience', 'primary'], v)} rows={2} placeholder="Describe your primary audience" />
            </div>
            <div>
              <FieldLabel>Secondary Audience</FieldLabel>
              <TextArea value={s(['target_audience', 'secondary'])} onChange={(v) => setField(['target_audience', 'secondary'], v)} rows={2} placeholder="Describe your secondary audience" />
            </div>
            <div>
              <FieldLabel>Psychographics</FieldLabel>
              <TagInput values={arr(['target_audience', 'psychographics'])} onChange={(v) => setField(['target_audience', 'psychographics'], v)} placeholder="ambitious, tech-savvy…" />
            </div>
          </div>

          {/* Positioning */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Positioning</p>
            <div>
              <FieldLabel>Market Category</FieldLabel>
              <TextInput value={s(['positioning', 'category'])} onChange={(v) => setField(['positioning', 'category'], v)} placeholder="e.g. B2B SaaS" />
            </div>
            <div>
              <FieldLabel>Differentiators</FieldLabel>
              <TagInput values={arr(['positioning', 'differentiators'])} onChange={(v) => setField(['positioning', 'differentiators'], v)} placeholder="Add a differentiator…" />
            </div>
            <div>
              <FieldLabel>Competitive Context</FieldLabel>
              <TextArea value={s(['positioning', 'competitive_context'])} onChange={(v) => setField(['positioning', 'competitive_context'], v)} rows={2} placeholder="How does this brand position relative to competitors?" />
            </div>
          </div>

          {/* Messaging */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Messaging</p>
            <div>
              <FieldLabel>Core Message</FieldLabel>
              <TextArea value={s(['messaging', 'core_message'])} onChange={(v) => setField(['messaging', 'core_message'], v)} rows={2} placeholder="The single most important thing this brand communicates" />
            </div>
            <div>
              <FieldLabel>Value Propositions</FieldLabel>
              <TagInput values={arr(['messaging', 'value_propositions'])} onChange={(v) => setField(['messaging', 'value_propositions'], v)} placeholder="Add a value proposition…" />
            </div>
            <div>
              <FieldLabel>Proof Points</FieldLabel>
              <TagInput values={arr(['messaging', 'proof_points'])} onChange={(v) => setField(['messaging', 'proof_points'], v)} placeholder="Add a proof point…" />
            </div>
          </div>

          {/* Visual Identity */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Visual Identity</p>
            <div>
              <FieldLabel>Primary Colors</FieldLabel>
              <ColorArrayInput values={arr(['visual_identity', 'primary_colors'])} onChange={(v) => setField(['visual_identity', 'primary_colors'], v)} />
            </div>
            <div>
              <FieldLabel>Secondary Colors</FieldLabel>
              <ColorArrayInput values={arr(['visual_identity', 'secondary_colors'])} onChange={(v) => setField(['visual_identity', 'secondary_colors'], v)} />
            </div>
            <div>
              <FieldLabel>Typography Notes</FieldLabel>
              <TextInput value={s(['visual_identity', 'typography'])} onChange={(v) => setField(['visual_identity', 'typography'], v)} placeholder="e.g. Sans-serif headlines, serif body" />
            </div>
            <div>
              <FieldLabel>Imagery Style</FieldLabel>
              <TextInput value={s(['visual_identity', 'imagery_style'])} onChange={(v) => setField(['visual_identity', 'imagery_style'], v)} placeholder="e.g. Clean, minimal, aspirational photography" />
            </div>
          </div>

          {/* Do Not Use */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Do Not Use</p>
            <TagInput values={arr(['do_not_use'])} onChange={(v) => setField(['do_not_use'], v)} placeholder="Add a word or phrase to avoid…" />
          </div>

          {/* Source content toggle */}
          {profile?.sourceText && (
            <div>
              <button
                type="button"
                onClick={() => setShowSource((s) => !s)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showSource ? '▲ Hide source content' : '▼ View source content'}
              </button>
              {showSource && (
                <pre className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground whitespace-pre-wrap">
                  {profile.sourceText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {!loadingProfile && !hasProfile && attachments.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">Upload brand documents above to get started.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/60">Claude will automatically extract a structured brand profile.</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Builder sub-section
// ─────────────────────────────────────────────────────────────────────────────

const WRITING_STYLES = ['Formal', 'Conversational', 'Technical', 'Inspirational', 'Direct']

function BrandBuilderSection({
  clientId,
  verticalId,
}: {
  clientId: string
  verticalId: string | null
}) {
  const [data, setData] = useState<BuilderData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState(false)
  const [hasData, setHasData] = useState(false)

  const qs = verticalId ? `?verticalId=${verticalId}` : ''
  const base = `/api/v1/clients/${clientId}/brand-builder`

  useEffect(() => {
    setLoading(true)
    apiFetch(`${base}${qs}`)
      .then((r) => r.json())
      .then(({ data: d }) => {
        if (d?.dataJson) {
          setData(d.dataJson as BuilderData)
          setHasData(true)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [base, qs])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`${base}${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataJson: data }),
      })
      if (res.ok) setHasData(true)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const set = (path: string[], value: unknown) => {
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Record<string, unknown>
      let node: Record<string, unknown> = next
      for (let i = 0; i < path.length - 1; i++) {
        if (!node[path[i]] || typeof node[path[i]] !== 'object') node[path[i]] = {}
        node = node[path[i]] as Record<string, unknown>
      }
      node[path[path.length - 1]] = value
      return next as BuilderData
    })
  }

  const sv = (path: string[]): string => {
    let cur: unknown = data
    for (const k of path) {
      if (cur == null || typeof cur !== 'object') return ''
      cur = (cur as Record<string, unknown>)[k]
    }
    return typeof cur === 'string' ? cur : ''
  }

  const av = (path: string[]): string[] => {
    let cur: unknown = data
    for (const k of path) {
      if (cur == null || typeof cur !== 'object') return []
      cur = (cur as Record<string, unknown>)[k]
    }
    return Array.isArray(cur) ? cur as string[] : []
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>

  // ── View mode — styled brand card ─────────────────────────────────────────
  if (viewMode && hasData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <SectionHeading>Brand Builder</SectionHeading>
            <h3 className="text-base font-semibold text-foreground">Brand one-pager</h3>
          </div>
          <button
            type="button"
            onClick={() => setViewMode(false)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Edit
          </button>
        </div>

        {/* Brand card */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="border-b border-border bg-gradient-to-r from-blue-600/10 to-purple-600/10 px-6 py-5">
            <h2 className="text-xl font-bold text-foreground">{sv(['brand_name']) || '—'}</h2>
            {sv(['tagline']) && <p className="mt-0.5 text-sm italic text-muted-foreground">{sv(['tagline'])}</p>}
          </div>

          <div className="grid grid-cols-2 gap-0 divide-x divide-border">
            {/* Left column */}
            <div className="divide-y divide-border">
              {sv(['mission']) && (
                <div className="px-5 py-4">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Mission</p>
                  <p className="text-sm text-foreground">{sv(['mission'])}</p>
                </div>
              )}
              {sv(['vision']) && (
                <div className="px-5 py-4">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Vision</p>
                  <p className="text-sm text-foreground">{sv(['vision'])}</p>
                </div>
              )}
              {av(['values']).length > 0 && (
                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Values</p>
                  <div className="flex flex-wrap gap-1.5">
                    {av(['values']).map((v) => (
                      <span key={v} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">{v}</span>
                    ))}
                  </div>
                </div>
              )}
              {sv(['messaging', 'core_message']) && (
                <div className="px-5 py-4">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Core Message</p>
                  <p className="text-sm text-foreground">{sv(['messaging', 'core_message'])}</p>
                </div>
              )}
              {av(['messaging', 'value_propositions']).length > 0 && (
                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Value Propositions</p>
                  <ul className="space-y-1">
                    {av(['messaging', 'value_propositions']).map((v) => (
                      <li key={v} className="flex items-start gap-1.5 text-sm text-foreground">
                        <span className="mt-0.5 shrink-0 text-muted-foreground">›</span>{v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="divide-y divide-border">
              {(av(['voice_and_tone', 'personality_traits']).length > 0 || sv(['voice_and_tone', 'writing_style'])) && (
                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Voice & Tone</p>
                  {sv(['voice_and_tone', 'writing_style']) && (
                    <p className="mb-1.5 text-sm text-foreground">{sv(['voice_and_tone', 'writing_style'])}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {av(['voice_and_tone', 'personality_traits']).map((t) => (
                      <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {sv(['target_audience', 'primary']) && (
                <div className="px-5 py-4">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Primary Audience</p>
                  <p className="text-sm text-foreground">{sv(['target_audience', 'primary'])}</p>
                </div>
              )}
              {av(['positioning', 'differentiators']).length > 0 && (
                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Differentiators</p>
                  <div className="flex flex-wrap gap-1">
                    {av(['positioning', 'differentiators']).map((d) => (
                      <span key={d} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {(av(['visual_identity', 'primary_colors']).length > 0 || av(['visual_identity', 'secondary_colors']).length > 0) && (
                <div className="px-5 py-4">
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Colors</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...av(['visual_identity', 'primary_colors']), ...av(['visual_identity', 'secondary_colors'])].map((c, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c }} />
                        <span className="text-[10px] font-mono text-muted-foreground">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <SectionHeading>Brand Builder</SectionHeading>
          <h3 className="text-base font-semibold text-foreground">Define brand attributes manually</h3>
        </div>
        <div className="flex items-center gap-2">
          {hasData && (
            <button
              type="button"
              onClick={() => setViewMode(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              View
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Identity */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Identity</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Brand Name</FieldLabel>
            <TextInput value={sv(['brand_name'])} onChange={(v) => set(['brand_name'], v)} placeholder="Acme Corp" />
          </div>
          <div>
            <FieldLabel>Tagline</FieldLabel>
            <TextInput value={sv(['tagline'])} onChange={(v) => set(['tagline'], v)} placeholder="Your tagline" />
          </div>
        </div>
        <div>
          <FieldLabel>Mission Statement</FieldLabel>
          <TextArea value={sv(['mission'])} onChange={(v) => set(['mission'], v)} placeholder="Why this brand exists" />
        </div>
        <div>
          <FieldLabel>Vision Statement</FieldLabel>
          <TextArea value={sv(['vision'])} onChange={(v) => set(['vision'], v)} placeholder="Where this brand is going" />
        </div>
        <div>
          <FieldLabel>Core Values</FieldLabel>
          <TagInput values={av(['values'])} onChange={(v) => set(['values'], v)} placeholder="Add a value…" />
        </div>
      </div>

      {/* Voice & Tone */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Voice & Tone</p>
        <div>
          <FieldLabel>Personality Traits</FieldLabel>
          <TagInput values={av(['voice_and_tone', 'personality_traits'])} onChange={(v) => set(['voice_and_tone', 'personality_traits'], v)} placeholder="confident, approachable…" />
        </div>
        <div>
          <FieldLabel>Writing Style</FieldLabel>
          <select
            value={sv(['voice_and_tone', 'writing_style'])}
            onChange={(e) => set(['voice_and_tone', 'writing_style'], e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-ring"
          >
            <option value="">— Select style —</option>
            {WRITING_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Words & Phrases to Use</FieldLabel>
          <TagInput values={av(['voice_and_tone', 'vocabulary_to_use'])} onChange={(v) => set(['voice_and_tone', 'vocabulary_to_use'], v)} placeholder="Add a term…" />
        </div>
        <div>
          <FieldLabel>Words & Phrases to Avoid</FieldLabel>
          <TagInput values={av(['voice_and_tone', 'vocabulary_to_avoid'])} onChange={(v) => set(['voice_and_tone', 'vocabulary_to_avoid'], v)} placeholder="Add a term…" />
        </div>
      </div>

      {/* Audience */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Audience</p>
        <div>
          <FieldLabel>Primary Audience</FieldLabel>
          <TextArea value={sv(['target_audience', 'primary'])} onChange={(v) => set(['target_audience', 'primary'], v)} placeholder="Who is the main buyer or reader?" />
        </div>
        <div>
          <FieldLabel>Secondary Audience</FieldLabel>
          <TextArea value={sv(['target_audience', 'secondary'])} onChange={(v) => set(['target_audience', 'secondary'], v)} placeholder="Secondary audience or influencers" />
        </div>
        <div>
          <FieldLabel>Psychographic Descriptors</FieldLabel>
          <TagInput values={av(['target_audience', 'psychographics'])} onChange={(v) => set(['target_audience', 'psychographics'], v)} placeholder="ambitious, tech-savvy…" />
        </div>
      </div>

      {/* Positioning */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Positioning</p>
        <div>
          <FieldLabel>Market Category</FieldLabel>
          <TextInput value={sv(['positioning', 'category'])} onChange={(v) => set(['positioning', 'category'], v)} placeholder="e.g. B2B SaaS, Healthcare IT" />
        </div>
        <div>
          <FieldLabel>Key Differentiators</FieldLabel>
          <TagInput values={av(['positioning', 'differentiators'])} onChange={(v) => set(['positioning', 'differentiators'], v)} placeholder="Add a differentiator…" />
        </div>
        <div>
          <FieldLabel>Competitive Context</FieldLabel>
          <TextArea value={sv(['positioning', 'competitive_context'])} onChange={(v) => set(['positioning', 'competitive_context'], v)} rows={2} placeholder="How does this brand compare to competitors?" />
        </div>
      </div>

      {/* Messaging */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Messaging</p>
        <div>
          <FieldLabel>Core Message</FieldLabel>
          <TextArea value={sv(['messaging', 'core_message'])} onChange={(v) => set(['messaging', 'core_message'], v)} rows={2} placeholder="The one thing every piece of content should convey" />
        </div>
        <div>
          <FieldLabel>Value Propositions</FieldLabel>
          <div className="space-y-1.5">
            {(av(['messaging', 'value_propositions']).length > 0 ? av(['messaging', 'value_propositions']) : ['']).slice(0, 5).map((vp, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] font-bold text-muted-foreground w-4">{i + 1}.</span>
                <TextArea
                  value={vp}
                  onChange={(v) => {
                    const arr2 = [...av(['messaging', 'value_propositions'])]
                    while (arr2.length <= i) arr2.push('')
                    arr2[i] = v
                    set(['messaging', 'value_propositions'], arr2.filter((_, j) => j < i || v || j < arr2.length - 1))
                  }}
                  rows={1}
                  placeholder={`Value proposition ${i + 1}`}
                />
              </div>
            ))}
            {av(['messaging', 'value_propositions']).length < 5 && (
              <button type="button" onClick={() => set(['messaging', 'value_propositions'], [...av(['messaging', 'value_propositions']), ''])} className="text-[11px] text-muted-foreground hover:text-foreground">
                + Add value proposition
              </button>
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Proof Points</FieldLabel>
          <TagInput values={av(['messaging', 'proof_points'])} onChange={(v) => set(['messaging', 'proof_points'], v)} placeholder="Add a proof point…" />
        </div>
      </div>

      {/* Visual Identity */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Visual Identity</p>
        <div>
          <FieldLabel>Primary Colors</FieldLabel>
          <ColorArrayInput values={av(['visual_identity', 'primary_colors'])} onChange={(v) => set(['visual_identity', 'primary_colors'], v)} />
        </div>
        <div>
          <FieldLabel>Secondary Colors</FieldLabel>
          <ColorArrayInput values={av(['visual_identity', 'secondary_colors'])} onChange={(v) => set(['visual_identity', 'secondary_colors'], v)} />
        </div>
        <div>
          <FieldLabel>Typography Notes</FieldLabel>
          <TextArea value={sv(['visual_identity', 'typography'])} onChange={(v) => set(['visual_identity', 'typography'], v)} rows={2} placeholder="Font families, size guidelines, hierarchy rules" />
        </div>
        <div>
          <FieldLabel>Imagery Style</FieldLabel>
          <TextArea value={sv(['visual_identity', 'imagery_style'])} onChange={(v) => set(['visual_identity', 'imagery_style'], v)} rows={2} placeholder="Photography style, illustration preferences, iconography" />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

type SubTab = 'profile' | 'builder'

export function ClientBrandingTab({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const [verticals, setVerticals] = useState<BrandVertical[]>([])
  const [loadingVerticals, setLoadingVerticals] = useState(true)
  const [activeVerticalId, setActiveVerticalId] = useState<string | null>(null) // null = General
  const [subTab, setSubTab] = useState<SubTab>('profile')

  const fetchVerticals = useCallback(async () => {
    const res = await apiFetch(`/api/v1/clients/${clientId}/brand-verticals`)
    const { data } = await res.json()
    setVerticals(data ?? [])
  }, [clientId])

  useEffect(() => {
    setLoadingVerticals(true)
    fetchVerticals().finally(() => setLoadingVerticals(false))
  }, [fetchVerticals])

  const activeVerticalName = activeVerticalId
    ? (verticals.find((v) => v.id === activeVerticalId)?.name ?? '')
    : null

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar: vertical nav ─────────────────────────────────────── */}
      <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r border-border">
        {/* Mini header */}
        <div className="shrink-0 border-b border-border px-4 py-4">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Branding</div>
          <h2 className="mt-0.5 truncate text-base font-bold text-foreground">{clientName}</h2>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2">
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Brand Voice
          </p>

          {/* General (main brain) */}
          <button
            onClick={() => setActiveVerticalId(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              activeVerticalId === null
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
          >
            <Icons.Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">General</span>
          </button>

          {/* Verticals */}
          {!loadingVerticals && verticals.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {verticals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setActiveVerticalId(v.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                    activeVerticalId === v.id
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  )}
                >
                  <Icons.Tag className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{v.name}</span>
                </button>
              ))}
            </div>
          )}

          {loadingVerticals && (
            <div className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
              <Icons.Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}

          {!loadingVerticals && verticals.length === 0 && (
            <p className="mt-1 px-3 text-[11px] text-muted-foreground/60">
              Add verticals in Structure to build per-vertical brand voices.
            </p>
          )}
        </nav>
      </div>

      {/* ── Right content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Section header */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          {activeVerticalId ? (
            <>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <span>General</span>
                <Icons.ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{activeVerticalName}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Inherits the base brand profile. Upload vertical-specific documents here — Claude will layer this context on top of the general brand.
              </p>
            </>
          ) : (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">General</div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The universal brand identity — voice, values, and guidelines shared across all verticals.
              </p>
            </>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="shrink-0 border-b border-border px-6">
          <div className="flex gap-4">
            {(['profile', 'builder'] as SubTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setSubTab(t)}
                className={cn(
                  'border-b-2 py-2 text-sm font-medium transition-colors',
                  subTab === t
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t === 'profile' ? 'Brand Profile' : 'Brand Builder'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl">
            {subTab === 'profile' && (
              <BrandProfileSection
                key={`profile-${activeVerticalId ?? 'general'}`}
                clientId={clientId}
                verticalId={activeVerticalId}
              />
            )}
            {subTab === 'builder' && (
              <BrandBuilderSection
                key={`builder-${activeVerticalId ?? 'general'}`}
                clientId={clientId}
                verticalId={activeVerticalId}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
