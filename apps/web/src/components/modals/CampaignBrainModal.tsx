import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignBrainAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sourceUrl: string | null
  extractionStatus: 'pending' | 'processing' | 'ready' | 'failed'
  summaryStatus: 'pending' | 'processing' | 'ready' | 'failed'
  summary: string | null
  campaignScopedOnly: boolean
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📄'
  if (mime.includes('word')) return '📝'
  if (mime.startsWith('text/')) return '📃'
  return '📎'
}

// ─── Attachment row ───────────────────────────────────────────────────────────

function AttachmentRow({
  attachment: a,
  campaignId,
  onDelete,
  onSummaryUpdated,
  onScopedToggled,
}: {
  attachment: CampaignBrainAttachment
  campaignId: string
  onDelete: (id: string) => void
  onSummaryUpdated: (id: string, summary: string) => void
  onScopedToggled: (id: string, scoped: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(a.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [togglingScoped, setTogglingScoped] = useState(false)
  const [scopeError, setScopeError] = useState(false)

  const isProcessing =
    a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
    a.summaryStatus === 'pending' || a.summaryStatus === 'processing'

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaignId}/brain/attachments/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ summary: editValue }),
      })
      if (res.ok) {
        onSummaryUpdated(a.id, editValue)
        setEditing(false)
      }
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const handleToggleScoped = async () => {
    setTogglingScoped(true)
    setScopeError(false)
    try {
      const next = !a.campaignScopedOnly
      const res = await apiFetch(`/api/v1/campaigns/${campaignId}/brain/attachments/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ campaignScopedOnly: next }),
      })
      if (res.ok) {
        onScopedToggled(a.id, next)
      } else {
        setScopeError(true)
        setTimeout(() => setScopeError(false), 3000)
      }
    } catch {
      setScopeError(true)
      setTimeout(() => setScopeError(false), 3000)
    } finally {
      setTogglingScoped(false)
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

  const displayName = a.sourceUrl
    ? (() => {
        try {
          const u = new URL(a.sourceUrl)
          return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 40) : '')
        } catch { return a.sourceUrl.slice(0, 60) }
      })()
    : a.filename

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-transparent">
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/20"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-3 shrink-0 text-[11px] text-muted-foreground">
          {expanded ? '▼' : '▶'}
        </span>
        <span className="shrink-0 text-lg">
          {a.sourceUrl ? '🔗' : fileIcon(a.mimeType)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {a.sourceUrl ? 'URL' : formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}
            </span>
            {statusBadge()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); void handleToggleScoped() }}
          disabled={togglingScoped}
          title={a.campaignScopedOnly ? 'Campaign only — click to share globally with this client' : 'Global — click to limit to this campaign only'}
          className={cn(
            'shrink-0 rounded px-2 py-0.5 text-[9px] font-medium transition-colors disabled:opacity-50',
            scopeError
              ? 'border border-red-400/60 bg-red-50 text-red-600'
              : a.campaignScopedOnly
                ? 'border border-amber-400/60 bg-amber-100/80 text-amber-700 hover:bg-amber-200/80'
                : 'border border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          )}
        >
          {togglingScoped
            ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
            : scopeError
              ? 'Error'
              : a.campaignScopedOnly ? 'Campaign only' : 'Global'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(a.id) }}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
        >
          <Icons.Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {a.extractionStatus === 'failed' ? (
            <p className="text-[11px] text-destructive">Extraction failed. Try re-uploading or re-fetching this source.</p>
          ) : isProcessing ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Icons.Loader2 className="h-4 w-4 animate-spin" />
              Claude is reading and interpreting this source…
            </div>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Claude's Read</p>
                {!editing && (
                  <button
                    onClick={() => { setEditValue(a.summary ?? ''); setEditing(true) }}
                    className="text-[10px] text-primary underline hover:text-primary/80"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editing ? (
                <div>
                  <textarea
                    className="w-full resize-y rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={6}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setEditValue(a.summary ?? '') }}
                      className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
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
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inline brain panel ───────────────────────────────────────────────────────

export function CampaignBrainPanel({
  campaignId,
  initialContext,
  onContextSaved,
}: {
  campaignId: string
  initialContext: string | null
  onContextSaved: (context: string) => void
}) {
  const [attachments, setAttachments] = useState<CampaignBrainAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [context, setContext] = useState(initialContext ?? '')
  const [savingContext, setSavingContext] = useState(false)
  const contextDirty = context !== (initialContext ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const base = `/api/v1/campaigns/${campaignId}/brain/attachments`

  const fetchAttachments = useCallback(async () => {
    try {
      const res = await apiFetch(base)
      const { data } = await res.json()
      setAttachments(data ?? [])
      return (data ?? []) as CampaignBrainAttachment[]
    } catch { return [] }
  }, [base])

  useEffect(() => {
    setLoading(true)
    fetchAttachments().finally(() => setLoading(false))
  }, [fetchAttachments])

  // Poll while any attachment is processing
  useEffect(() => {
    const hasProcessing = attachments.some(
      (a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
             a.summaryStatus === 'pending' || a.summaryStatus === 'processing'
    )
    if (!hasProcessing) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const fresh = await fetchAttachments()
      if (fresh.some((a) => a.summaryStatus === 'ready')) {
        const res = await apiFetch(`/api/v1/campaigns/${campaignId}`)
        const { data } = await res.json()
        if (data?.context && data.context !== context) setContext(data.context)
      }
      const stillProcessing = fresh.some(
        (a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
               a.summaryStatus === 'pending' || a.summaryStatus === 'processing'
      )
      if (!stillProcessing) { clearInterval(pollRef.current!); pollRef.current = null }
    }, 4000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [attachments, context, campaignId, fetchAttachments])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(base, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Upload failed')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setUploadError(null)
    } catch {
      setUploadError('Network error — upload failed')
      setTimeout(() => setUploadError(null), 8000)
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(uploadFile)
  }

  const handleAddNote = async () => {
    const trimmed = noteText.trim()
    if (!trimmed) return
    setAddingNote(true)
    try {
      const blob = new Blob([trimmed], { type: 'text/plain' })
      const file = new File([blob], `notes-${Date.now()}.txt`, { type: 'text/plain' })
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(base, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Failed to add note')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setNoteText('')
      setShowNoteInput(false)
    } finally {
      setAddingNote(false)
    }
  }

  const handleAddUrl = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setAddingUrl(true)
    try {
      const res = await apiFetch(`${base}/from-url`, {
        method: 'POST',
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Failed to add URL')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setUrlInput('')
      setShowUrlInput(false)
    } finally {
      setAddingUrl(false)
    }
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`${base}/${id}`, { method: 'DELETE' })
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSaveContext = async () => {
    setSavingContext(true)
    try {
      await apiFetch(`/api/v1/campaigns/${campaignId}`, {
        method: 'PATCH',
        body: JSON.stringify({ context }),
      })
      onContextSaved(context)
    } finally {
      setSavingContext(false)
    }
  }

  const ready = attachments.filter((a) => a.summaryStatus === 'ready').length
  const processing = attachments.filter(
    (a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing' ||
           a.summaryStatus === 'pending' || a.summaryStatus === 'processing'
  ).length
  const failed = attachments.filter((a) => a.extractionStatus === 'failed').length

  return (
    <div className="mx-4 mb-3 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-foreground">Campaign Brain</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Upload docs, paste notes, or add URLs — Claude reads everything and injects campaign context into every workflow run.
        </p>
      </div>

      {/* Drop zone */}
      <div>
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
            accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.json,.html"
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
              <p className="mt-1 text-[10px] text-muted-foreground/60">PDF · DOCX · XLSX · TXT · MD · CSV · JSON · HTML</p>
            </>
          )}
        </div>

        {/* Secondary intake options */}
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
              placeholder="Paste campaign briefs, positioning notes, audience research, or any context you want Claude to learn from…"
              rows={5}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAddNote()}
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
              onKeyDown={(e) => e.key === 'Enter' && void handleAddUrl()}
              placeholder="https://example.com/campaign-brief"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">
              Claude will scrape and read the page content. Works with briefs, competitive pages, research reports, etc.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAddUrl()}
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

        {/* Brain status banner */}
        {!loading && attachments.length > 0 && (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                {ready > 0 ? `✓ ${ready} source${ready !== 1 ? 's' : ''} in brain` : 'Sources processing…'}
                {processing > 0 && ` · ${processing} processing`}
                {failed > 0 && ` · ${failed} failed`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {ready > 0
                  ? 'Claude has read these sources and built a synthesised campaign context below.'
                  : 'Sources are being read — the context will appear when ready.'}
              </p>
            </div>
            {ready > 0 && (
              <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Brain active
              </span>
            )}
          </div>
        )}
      </div>

      {/* Attachment list */}
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Icons.Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : attachments.length > 0 ? (
        <div className="space-y-2">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              campaignId={campaignId}
              onDelete={handleDelete}
              onSummaryUpdated={(id, summary) =>
                setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary, summaryStatus: 'ready' } : x))
              }
              onScopedToggled={(id, scoped) =>
                setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, campaignScopedOnly: scoped } : x))
              }
            />
          ))}
        </div>
      ) : null}

      {/* Synthesised context */}
      {(context || ready > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Synthesised Context</p>
              <p className="text-[11px] text-muted-foreground">Claude's combined read — injected into every workflow run for this campaign</p>
            </div>
            {contextDirty && (
              <button
                onClick={() => void handleSaveContext()}
                disabled={savingContext}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {savingContext ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Check className="h-3 w-3" />}
                Save
              </button>
            )}
          </div>
          <textarea
            className="w-full resize-y rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[8rem]"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            spellCheck={false}
            placeholder="Claude will populate this automatically as it reads your sources. You can also edit it directly."
          />
        </div>
      )}
    </div>
  )
}
