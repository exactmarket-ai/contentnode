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
  if (mimeType.includes('image')) return '🖼️'
  if (mimeType.includes('text') || mimeType.includes('markdown')) return '📃'
  return '📎'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editedJson, setEditedJson] = useState<BrandJson>({})
  const [saving, setSaving] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
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
      attachments.some((a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing') ||
      profile?.extractionStatus === 'extracting'
    if (!hasInProgress) return
    const t = setTimeout(() => { fetchAll() }, 4000)
    return () => clearTimeout(t)
  }, [attachments, profile, fetchAll])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(`${baseAttachments}${qs}`, { method: 'POST', body: form })
      if (!res.ok) return
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
    } catch { /* ignore */ } finally {
      setUploading(false)
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
            accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.png,.jpg,.jpeg"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {uploading ? (
            <p className="text-sm text-muted-foreground">Uploading…</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Drag files here or{' '}
                <button type="button" onClick={() => inputRef.current?.click()} className="text-foreground underline hover:text-muted-foreground">
                  browse
                </button>
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/60">PDF, DOCX, TXT, MD, CSV, JSON, HTML, PNG, JPG</p>
            </>
          )}
        </div>

        {/* Attachment list */}
        {!loadingAttachments && attachments.length > 0 && (
          <div className="mt-3 space-y-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="text-base shrink-0">{fileIcon(a.mimeType)}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {/* Inline status badge */}
                <span className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  a.extractionStatus === 'pending' && 'border-border bg-muted text-muted-foreground',
                  a.extractionStatus === 'processing' && 'border-border bg-muted text-foreground',
                  a.extractionStatus === 'ready' && 'border-border bg-muted text-foreground',
                  a.extractionStatus === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
                )}>
                  {a.extractionStatus === 'pending' && 'Queued'}
                  {a.extractionStatus === 'processing' && 'Extracting…'}
                  {a.extractionStatus === 'ready' && '✓ Ready'}
                  {a.extractionStatus === 'failed' && 'Failed'}
                </span>
                {/* Action dropdown */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenMenuId(openMenuId === a.id ? null : a.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <Icons.MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                  {openMenuId === a.id && (
                    <div
                      className="absolute right-0 top-7 z-50 min-w-[110px] rounded-lg border border-border bg-popover shadow-lg"
                      onMouseLeave={() => setOpenMenuId(null)}
                    >
                      <button
                        type="button"
                        disabled={deletingId === a.id}
                        onClick={() => { setOpenMenuId(null); handleDelete(a) }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 rounded-lg"
                      >
                        <Icons.Trash2 className="h-3.5 w-3.5" />
                        {deletingId === a.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
  const [addingVertical, setAddingVertical] = useState(false)
  const [newVerticalName, setNewVerticalName] = useState('')
  const [savingVertical, setSavingVertical] = useState(false)
  const [deletingVerticalId, setDeletingVerticalId] = useState<string | null>(null)

  const fetchVerticals = useCallback(async () => {
    const res = await apiFetch(`/api/v1/clients/${clientId}/brand-verticals`)
    const { data } = await res.json()
    setVerticals(data ?? [])
  }, [clientId])

  useEffect(() => {
    setLoadingVerticals(true)
    fetchVerticals().finally(() => setLoadingVerticals(false))
  }, [fetchVerticals])

  const handleCreateVertical = async () => {
    const name = newVerticalName.trim()
    if (!name) return
    setSavingVertical(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/brand-verticals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setVerticals((prev) => [...prev, data])
        setActiveVerticalId(data.id)
        setNewVerticalName('')
        setAddingVertical(false)
      }
    } catch { /* ignore */ } finally {
      setSavingVertical(false)
    }
  }

  const handleDeleteVertical = async (v: BrandVertical) => {
    if (!confirm(`Delete vertical "${v.name}"? This will also delete all brand data for this vertical.`)) return
    setDeletingVerticalId(v.id)
    try {
      await apiFetch(`/api/v1/clients/${clientId}/brand-verticals/${v.id}`, { method: 'DELETE' })
      setVerticals((prev) => prev.filter((x) => x.id !== v.id))
      if (activeVerticalId === v.id) setActiveVerticalId(null)
    } catch { /* ignore */ } finally {
      setDeletingVerticalId(null)
    }
  }

  const activeVerticalName = activeVerticalId
    ? verticals.find((v) => v.id === activeVerticalId)?.name ?? 'Unknown'
    : 'General'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Branding</div>
        <h2 className="text-xl font-bold text-foreground">{clientName}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Manage brand profiles per vertical. Use in workflows via the Brand Context node.
        </p>
      </div>

      {/* Vertical tabs row */}
      <div className="shrink-0 border-b border-border bg-muted/20 px-6">
        <div className="flex items-center gap-0 overflow-x-auto">
          {/* General tab */}
          <button
            onClick={() => setActiveVerticalId(null)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              activeVerticalId === null
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            General
          </button>

          {loadingVerticals
            ? null
            : verticals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setActiveVerticalId(v.id)}
                  className={cn(
                    'group flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    activeVerticalId === v.id
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {v.name}
                  <span
                    onClick={(e) => { e.stopPropagation(); handleDeleteVertical(v) }}
                    className="hidden group-hover:inline text-muted-foreground hover:text-red-500 cursor-pointer"
                    title={`Delete ${v.name}`}
                  >
                    {deletingVerticalId === v.id ? '…' : '×'}
                  </span>
                </button>
              ))}

          {/* Add vertical */}
          {addingVertical ? (
            <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
              <input
                type="text"
                autoFocus
                value={newVerticalName}
                onChange={(e) => setNewVerticalName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateVertical(); if (e.key === 'Escape') { setAddingVertical(false); setNewVerticalName('') } }}
                placeholder="Vertical name"
                className="w-32 rounded border border-border bg-background px-2 py-0.5 text-sm focus:outline-none focus:border-ring"
              />
              <button
                type="button"
                onClick={handleCreateVertical}
                disabled={savingVertical || !newVerticalName.trim()}
                className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingVertical ? '…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => { setAddingVertical(false); setNewVerticalName('') }}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingVertical(true)}
              className="shrink-0 border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
            >
              + Add Vertical
            </button>
          )}
        </div>
      </div>

      {/* Sub-tab row: Brand Profile / Brand Builder */}
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
  )
}
