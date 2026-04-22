import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MasterBrainEntry {
  id: string
  table: string
  filename: string
  sourceUrl: string | null
  mimeType: string
  sizeBytes: number
  extractionStatus: string
  summaryStatus: string
  summary: string | null
  createdAt: string
  source: string
  sourceLabel: string
  verticalId: string | null
  verticalName: string | null
  campaignId: string | null
  campaignName: string | null
  campaignScopedOnly: boolean
  uploadMethod: string
  uploadedByName: string | null
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
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊'
  if (mime.startsWith('text/')) return '📃'
  return '📎'
}

const SOURCE_COLOR: Record<string, string> = {
  client: 'bg-blue-100 text-blue-700 border-blue-300/60 dark:bg-blue-900/30 dark:text-blue-400',
  campaign: 'bg-purple-100 text-purple-700 border-purple-300/60 dark:bg-purple-900/30 dark:text-purple-400',
  gtm_framework: 'bg-green-100 text-green-700 border-green-300/60 dark:bg-green-900/30 dark:text-green-400',
  demand_gen: 'bg-orange-100 text-orange-700 border-orange-300/60 dark:bg-orange-900/30 dark:text-orange-400',
  branding: 'bg-pink-100 text-pink-700 border-pink-300/60 dark:bg-pink-900/30 dark:text-pink-400',
}

function SourceBadge({ source, label }: { source: string; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide',
      SOURCE_COLOR[source] ?? 'bg-muted text-muted-foreground border-border'
    )}>
      {label}
    </span>
  )
}

// ─── Master Brain Row ─────────────────────────────────────────────────────────

function MasterBrainRow({
  doc,
  clientId,
  onDelete,
  onSummaryUpdated,
  onScopeToggled,
}: {
  doc: MasterBrainEntry
  clientId: string
  onDelete: (doc: MasterBrainEntry) => void
  onSummaryUpdated: (id: string, table: string, summary: string) => void
  onScopeToggled: (id: string, table: string, campaignScopedOnly: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(doc.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [showText, setShowText] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)
  const [togglingScoped, setTogglingScoped] = useState(false)
  const [scopeError, setScopeError] = useState(false)

  const isProcessing =
    doc.extractionStatus === 'pending' || doc.extractionStatus === 'processing' ||
    doc.summaryStatus === 'pending' || doc.summaryStatus === 'processing'
  const isFailed = doc.extractionStatus === 'failed'
  const isReady = doc.summaryStatus === 'ready'

  // Build PATCH URL for this row's table
  const patchUrl = (() => {
    if (doc.table === 'client_brain_attachments') return `/api/v1/clients/${clientId}/brain/attachments/${doc.id}`
    if (doc.table === 'campaign_brain_attachments' && doc.campaignId) return `/api/v1/campaigns/${doc.campaignId}/brain/attachments/${doc.id}`
    if (doc.table === 'client_brand_attachments') return `/api/v1/clients/${clientId}/brand-profile/attachments/${doc.id}`
    return null
  })()

  // Build text URL for each table type
  const textUrl = (() => {
    if (doc.table === 'client_brain_attachments') return `/api/v1/clients/${clientId}/brain/attachments/${doc.id}/text`
    if (doc.table === 'campaign_brain_attachments' && doc.campaignId) return `/api/v1/campaigns/${doc.campaignId}/brain/attachments/${doc.id}/text`
    if (doc.table === 'client_brand_attachments') return `/api/v1/clients/${clientId}/brand-profile/attachments/${doc.id}/text`
    return null
  })()

  const handleSave = async () => {
    if (!patchUrl) return
    setSaving(true)
    try {
      const res = await apiFetch(patchUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: editValue }),
      })
      if (res.ok) {
        onSummaryUpdated(doc.id, doc.table, editValue)
        setEditing(false)
      }
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const handleViewText = async () => {
    if (!textUrl) return
    if (rawText !== null) { setShowText(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(textUrl)
      if (res.ok) {
        const { data } = await res.json()
        setRawText(data.text ?? '')
      }
    } catch { /* ignore */ } finally {
      setLoadingText(false)
      setShowText(true)
    }
  }

  const handleToggleScoped = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!doc.campaignId || togglingScoped) return
    setTogglingScoped(true)
    setScopeError(false)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${doc.campaignId}/brain/attachments/${doc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ campaignScopedOnly: !doc.campaignScopedOnly }),
      })
      if (res.ok) {
        onScopeToggled(doc.id, doc.table, !doc.campaignScopedOnly)
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

  const displayName = doc.sourceUrl
    ? (() => {
        try {
          const u = new URL(doc.sourceUrl)
          return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 40) : '')
        } catch { return doc.sourceUrl.slice(0, 60) }
      })()
    : doc.filename

  const scopeLabel = doc.verticalName ?? null

  function statusBadge() {
    if (doc.extractionStatus === 'pending' || doc.extractionStatus === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
          Reading…
        </span>
      )
    }
    if (doc.extractionStatus === 'failed') {
      return <span className="text-[10px] text-destructive">Failed</span>
    }
    if (doc.summaryStatus === 'pending' || doc.summaryStatus === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
          Interpreting…
        </span>
      )
    }
    return <span className="text-[10px] font-medium text-green-600 dark:text-green-400">✓ Interpreted</span>
  }

  const canDelete = doc.table === 'client_brain_attachments'

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Row header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/20"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-3 shrink-0 text-[11px] text-muted-foreground">{expanded ? '▼' : '▶'}</span>
        <span className="shrink-0 text-lg">{doc.sourceUrl ? '🔗' : fileIcon(doc.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] text-muted-foreground">
              {doc.sourceUrl ? 'URL' : formatBytes(doc.sizeBytes)}
              {' · '}
              {new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            {doc.uploadedByName && (
              <span className="text-[10px] text-muted-foreground">· Added by {doc.uploadedByName}</span>
            )}
            <SourceBadge source={doc.source} label={doc.sourceLabel} />
            {scopeLabel && (
              <span className="text-[10px] text-muted-foreground">{scopeLabel}</span>
            )}
            {doc.campaignName && (
              <span className="text-[10px] text-muted-foreground">{doc.campaignName}</span>
            )}
            {doc.table === 'campaign_brain_attachments' && doc.campaignId && (
              <button
                onClick={handleToggleScoped}
                disabled={togglingScoped}
                title={doc.campaignScopedOnly ? 'Campaign only — click to make Global' : 'Global — click to make Campaign only'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide transition-colors',
                  scopeError
                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : doc.campaignScopedOnly
                      ? 'border-amber-300/60 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
                      : 'border-emerald-300/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400'
                )}
              >
                {togglingScoped ? (
                  <Icons.Loader2 className="h-2 w-2 animate-spin" />
                ) : scopeError ? (
                  'Error'
                ) : doc.campaignScopedOnly ? (
                  'Campaign only'
                ) : (
                  <>
                    <Icons.Globe className="h-2 w-2" />
                    Global
                  </>
                )}
              </button>
            )}
            {statusBadge()}
          </div>
        </div>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(doc) }}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
          >
            <Icons.Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {isFailed ? (
            <p className="text-[11px] text-destructive">Extraction failed. Try re-uploading or re-fetching this source.</p>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Claude's Read</p>
                <div className="flex items-center gap-3">
                  {/* View original text — shown as soon as extraction is complete */}
                  {doc.extractionStatus === 'ready' && textUrl && (
                    <button
                      onClick={handleViewText}
                      disabled={loadingText}
                      className="text-[10px] text-muted-foreground underline hover:text-foreground"
                    >
                      {loadingText ? 'Loading…' : 'View original text'}
                    </button>
                  )}
                  {/* Edit — only available once summary is ready */}
                  {!editing && isReady && patchUrl && (
                    <button
                      onClick={() => { setEditValue(doc.summary ?? ''); setEditing(true) }}
                      className="text-[10px] text-primary underline hover:text-primary/80"
                    >
                      Edit
                    </button>
                  )}
                  {!editing && isReady && !patchUrl && (
                    <span className="text-[10px] text-muted-foreground italic">
                      Edit in {doc.sourceLabel} area
                    </span>
                  )}
                </div>
              </div>

              {editing ? (
                <div>
                  <textarea
                    className="w-full resize-y rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={10}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setEditValue(doc.summary ?? '') }}
                      className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : isProcessing ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Icons.Loader2 className="h-4 w-4 animate-spin" />
                  {doc.summaryStatus === 'pending' || doc.summaryStatus === 'processing'
                    ? 'Generating interpretation…'
                    : 'Reading file…'}
                </div>
              ) : (
                <div className="rounded-md bg-muted/30 px-3 py-2.5">
                  {doc.summary ? (
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{doc.summary}</p>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">No interpretation recorded.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Raw text modal */}
      {showText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowText(false)}
        >
          <div
            className="flex w-full max-w-2xl max-h-[80vh] flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Original Extracted Text</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{doc.filename}</p>
              </div>
              <button onClick={() => setShowText(false)} className="ml-4 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
                <Icons.X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-6">
              {rawText
                ? <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">{rawText}</pre>
                : <p className="text-sm italic text-muted-foreground">No extracted text available for this file.</p>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Client Brain Tab ─────────────────────────────────────────────────────────

export function ClientBrainTab({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  // Direct upload state (source='client')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Context state
  const [context, setContext] = useState('')
  const [savedContext, setSavedContext] = useState('')
  const [savingContext, setSavingContext] = useState(false)
  const contextDirty = context !== savedContext

  // Master view state
  const [allDocs, setAllDocs] = useState<MasterBrainEntry[]>([])
  const [masterLoading, setMasterLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const base = `/api/v1/clients/${clientId}/brain/attachments`

  const fetchMaster = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/brain/all`)
      const { data } = await res.json()
      setAllDocs(data ?? [])
      return (data ?? []) as MasterBrainEntry[]
    } catch { return [] }
  }, [clientId])

  const fetchContext = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/brain/context`)
      const { data } = await res.json()
      const val = data?.context ?? ''
      setContext(val)
      setSavedContext(val)
    } catch { /* ignore */ }
  }, [clientId])

  useEffect(() => {
    setMasterLoading(true)
    Promise.all([fetchMaster(), fetchContext()]).finally(() => setMasterLoading(false))
  }, [fetchMaster, fetchContext])

  // Poll while any attachment is processing
  useEffect(() => {
    const hasProcessing = allDocs.some(
      (d) => d.extractionStatus === 'pending' || d.extractionStatus === 'processing' ||
             d.summaryStatus === 'pending' || d.summaryStatus === 'processing'
    )
    if (!hasProcessing) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const fresh = await fetchMaster()
      if (fresh.some((d) => d.summaryStatus === 'ready')) {
        const res = await apiFetch(`/api/v1/clients/${clientId}/brain/context`)
        const { data } = await res.json()
        if (data?.context && data.context !== context) {
          setContext(data.context)
          setSavedContext(data.context)
        }
      }
      const stillProcessing = fresh.some(
        (d) => d.extractionStatus === 'pending' || d.extractionStatus === 'processing' ||
               d.summaryStatus === 'pending' || d.summaryStatus === 'processing'
      )
      if (!stillProcessing) { clearInterval(pollRef.current!); pollRef.current = null }
    }, 4000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [allDocs, context, clientId, fetchMaster])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(`${base}?source=client`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Upload failed')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      await fetchMaster()
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
      const res = await apiFetch(`${base}?source=client`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Failed to add note')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      await fetchMaster()
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
      const res = await apiFetch(`${base}/from-url?source=client`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Failed to add URL')
        setTimeout(() => setUploadError(null), 6000)
        return
      }
      await fetchMaster()
      setUrlInput('')
      setShowUrlInput(false)
    } finally {
      setAddingUrl(false)
    }
  }

  const handleDelete = async (doc: MasterBrainEntry) => {
    if (doc.table !== 'client_brain_attachments') return
    await apiFetch(`${base}/${doc.id}`, { method: 'DELETE' })
    setAllDocs((prev) => prev.filter((d) => !(d.id === doc.id && d.table === doc.table)))
  }

  const handleSaveContext = async () => {
    setSavingContext(true)
    try {
      await apiFetch(`/api/v1/clients/${clientId}/brain/context`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      setSavedContext(context)
    } finally {
      setSavingContext(false)
    }
  }

  const readyDocs = allDocs.filter((d) => d.summaryStatus === 'ready').length
  const processingDocs = allDocs.filter(
    (d) => d.extractionStatus === 'pending' || d.extractionStatus === 'processing' ||
           d.summaryStatus === 'pending' || d.summaryStatus === 'processing'
  ).length
  const totalDocs = allDocs.length

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Client Brain</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The unified brain for {clientName} — all docs from all areas (Branding, GTM Framework, Demand Gen, Campaigns) feed here. Add client-level docs below, or navigate to each area to add context there.
        </p>
      </div>

      {/* Brain status banner */}
      {!masterLoading && totalDocs > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {readyDocs > 0 ? `✓ ${readyDocs} of ${totalDocs} source${totalDocs !== 1 ? 's' : ''} interpreted` : 'Sources processing…'}
              {processingDocs > 0 && ` · ${processingDocs} processing`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Sources below contribute to Claude's understanding of {clientName} and are injected into workflow runs.
            </p>
          </div>
          {readyDocs > 0 && (
            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Brain active
            </span>
          )}
        </div>
      )}

      {/* Add client-level docs */}
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">Add to Client Brain</p>
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
              placeholder={`Paste brand guidelines, positioning notes, audience research, or any context you want Claude to learn for ${clientName}…`}
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
              <button type="button" onClick={() => { setShowNoteInput(false); setNoteText('') }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
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
              placeholder="https://example.com/brand-guidelines"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
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
              <button type="button" onClick={() => { setShowUrlInput(false); setUrlInput('') }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {uploadError}
          </div>
        )}
      </div>

      {/* Synthesised context */}
      {(context || readyDocs > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Synthesised Context</p>
              <p className="text-[11px] text-muted-foreground">Claude's combined read — injected into every workflow run for this client</p>
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

      {/* ── All Sources — master list ─────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">All Brain Sources</p>
            <p className="text-[11px] text-muted-foreground">Every document fed into {clientName}'s brain, from any area</p>
          </div>
          <button
            onClick={() => void fetchMaster()}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icons.RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {masterLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icons.Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : allDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <Icons.Brain className="mx-auto mb-2 h-7 w-7 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No brain sources yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground/60">Upload docs above, or add context in the Branding, GTM Framework, Demand Gen, or Campaigns areas</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allDocs.map((doc) => (
              <MasterBrainRow
                key={`${doc.table}:${doc.id}`}
                doc={doc}
                clientId={clientId}
                onDelete={handleDelete}
                onSummaryUpdated={(id, table, summary) =>
                  setAllDocs((prev) => prev.map((d) =>
                    d.id === id && d.table === table ? { ...d, summary, summaryStatus: 'ready' } : d
                  ))
                }
                onScopeToggled={(id, table, campaignScopedOnly) =>
                  setAllDocs((prev) => prev.map((d) =>
                    d.id === id && d.table === table ? { ...d, campaignScopedOnly } : d
                  ))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
