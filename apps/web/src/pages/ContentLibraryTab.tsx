import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import JSZip from 'jszip'
import { downloadContentLibraryDocx, contentLibraryItemToBlob } from '@/lib/downloadDocx'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryItem {
  id: string
  contentType: string
  content: string | null
  publishStatus: 'draft' | 'approved' | 'archived'
  wordCount: number | null
  createdAt: string
  topicTitle: string
  topicQueueId: string | null
  assignedToType: 'member' | 'vertical' | 'company'
  assignedToId: string | null
  assignedTo: string
  contentPackRunId: string
}

interface Assignee {
  type: string
  id: string | null
  name: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Content-type color mapping
// ─────────────────────────────────────────────────────────────────────────────

function getTypeColors(contentType: string): { bg: string; text: string } {
  const lower = contentType.toLowerCase()
  if (lower.includes('blog') || lower.includes('article')) return { bg: '#EEEDFE', text: '#534AB7' }
  if (lower.includes('linkedin')) return { bg: '#E8F1FB', text: '#1A6FC4' }
  if (lower.includes(' x ') || lower.includes('twitter') || lower.startsWith('x ') || lower.endsWith(' x') || lower === 'x') return { bg: '#F1EFE8', text: '#2C2C2A' }
  if (lower.includes('email')) return { bg: '#FBF0E8', text: '#C45A1A' }
  if (lower.includes('social') || lower.includes('series')) return { bg: '#E8F6F3', text: '#1A8C75' }
  return { bg: '#F5F5F3', text: '#666666' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 2)   return 'just now'
  if (hours < 1)  return `${mins}m ago`
  if (days < 1)   return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
}

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved', archived: 'Archived' }
const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-600',
  approved: 'bg-green-50 text-green-700',
  archived: 'bg-gray-50 text-gray-400',
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeLabel chip
// ─────────────────────────────────────────────────────────────────────────────

function TypeLabel({ contentType }: { contentType: string }) {
  const { bg, text } = getTypeColors(contentType)
  return (
    <span
      style={{ backgroundColor: bg, color: text }}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none truncate max-w-[160px]"
    >
      {contentType}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Content card
// ─────────────────────────────────────────────────────────────────────────────

function ContentCard({
  item,
  selected,
  onSelect,
  onClick,
  onStatusChange,
  onDownload,
  onCopy,
}: {
  item: LibraryItem
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onClick: () => void
  onStatusChange: (id: string, status: string) => void
  onDownload: (item: LibraryItem) => void
  onCopy: (item: LibraryItem) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl border border-border bg-transparent p-3.5 cursor-pointer transition-colors hover:bg-muted/30',
        selected && 'ring-2 ring-blue-500 border-blue-400',
      )}
      onClick={onClick}
    >
      {/* Checkbox */}
      <label
        className="absolute left-2.5 top-2.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ opacity: selected ? 1 : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded cursor-pointer"
          checked={selected}
          onChange={(e) => onSelect(item.id, e.target.checked)}
        />
      </label>

      {/* Three-dot menu */}
      <div className="absolute right-2 top-2 z-10" ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icons.MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-6 z-50 w-44 rounded-lg border border-border bg-white shadow-lg py-1">
            {[
              { label: 'Preview', icon: Icons.Eye, action: () => { setMenuOpen(false); onClick() } },
              { label: 'Download DOCX', icon: Icons.Download, action: () => { setMenuOpen(false); onDownload(item) } },
              { label: 'Copy to clipboard', icon: Icons.Copy, action: () => { setMenuOpen(false); onCopy(item) } },
              ...(item.publishStatus === 'draft'
                ? [{ label: 'Mark approved', icon: Icons.CheckCircle, action: () => { setMenuOpen(false); onStatusChange(item.id, 'approved') } }]
                : item.publishStatus === 'approved'
                ? [{ label: 'Move to draft', icon: Icons.RotateCcw, action: () => { setMenuOpen(false); onStatusChange(item.id, 'draft') } }]
                : []),
              { label: 'Archive', icon: Icons.Archive, action: () => { setMenuOpen(false); onStatusChange(item.id, 'archived') } },
            ].map(({ label, icon: Ic, action }) => (
              <button
                key={label}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                onClick={action}
              >
                <Ic className="h-3 w-3 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Type label + status */}
      <div className="flex items-center gap-1.5 mb-2 pl-5 pr-6">
        <TypeLabel contentType={item.contentType} />
        <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLORS[item.publishStatus])}>
          {STATUS_LABEL[item.publishStatus]}
        </span>
      </div>

      {/* Topic title */}
      <p className="text-[13px] font-medium text-foreground leading-snug line-clamp-2 mb-1">
        {item.topicTitle}
      </p>

      {/* Assigned to */}
      <p className="text-[11px] text-muted-foreground mb-2 truncate">
        {item.assignedTo}
      </p>

      {/* Content preview */}
      {item.content && (
        <p className="text-[11px] text-muted-foreground italic leading-relaxed line-clamp-3 mb-3 flex-1">
          {item.content.slice(0, 150)}{item.content.length > 150 ? '…' : ''}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">
          {item.wordCount ? `${item.wordCount.toLocaleString()} words` : ''}
        </span>
        <span className="text-[10px] text-muted-foreground">{formatRelative(item.createdAt)}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview drawer
// ─────────────────────────────────────────────────────────────────────────────

function PreviewDrawer({
  item,
  clientId,
  clientName,
  onClose,
  onStatusChange,
  onDownload,
}: {
  item: LibraryItem
  clientId: string
  clientName: string
  onClose: () => void
  onStatusChange: (id: string, status: string) => void
  onDownload: (item: LibraryItem) => void
}) {
  const [copied, setCopied] = useState(false)
  const [fullContent, setFullContent] = useState<string | null>(item.content)
  const [loadingFull, setLoadingFull] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingEdits, setSavingEdits] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closingSaving, setClosingSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLoadingFull(true)
    setFullContent(item.content)
    setIsEditing(false)
    setEditedContent('')
    // Always fetch full item to get untruncated content
    apiFetch(`/api/v1/content-library/${clientId}/${item.id}`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.data?.content ?? item.content ?? ''
        setFullContent(c)
        setEditedContent(c)
      })
      .catch(() => { setEditedContent(item.content ?? '') })
      .finally(() => setLoadingFull(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, clientId])

  // Auto-resize textarea as content grows
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [editedContent, isEditing])

  const startEditing = () => { if (!loadingFull) setIsEditing(true) }
  const cancelEditing = () => { setEditedContent(fullContent ?? ''); setIsEditing(false); setSaveError(null) }

  const copy = async () => {
    const text = isEditing ? editedContent : (fullContent ?? '')
    if (text) {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const hasEdits = editedContent !== (fullContent ?? '')

  const nextStatus = item.publishStatus === 'draft' ? 'approved' : item.publishStatus === 'approved' ? 'archived' : 'draft'
  const nextLabel  = item.publishStatus === 'draft' ? 'Approve' : item.publishStatus === 'approved' ? 'Archive' : 'Restore to draft'

  const persistEdits = async (): Promise<boolean> => {
    const res = await apiFetch(`/api/v1/content-library/${clientId}/${item.id}/content`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editedContent }),
    })
    return res.ok
  }

  const handleSaveEdits = async () => {
    if (savingEdits || !hasEdits) return
    setSavingEdits(true)
    setSaveError(null)
    try {
      const ok = await persistEdits()
      if (!ok) {
        setSaveError('Save failed — please try again.')
        return
      }
      setFullContent(editedContent)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch {
      setSaveError('Save failed — please try again.')
    } finally {
      setSavingEdits(false)
    }
  }

  const handleClose = () => {
    if (hasEdits) {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  const handleStatusAction = async () => {
    if (saving) return
    setSaving(true)
    try {
      // When approving with edits, persist the edited content first so the
      // status PATCH can diff it against original_content for the edit signal.
      if (nextStatus === 'approved' && hasEdits) {
        await persistEdits()
        setFullContent(editedContent)
      }
      onStatusChange(item.id, nextStatus)
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-xl bg-white border-l border-border flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground mb-0.5">{item.assignedTo}</p>
            <h2 className="text-sm font-semibold text-foreground leading-snug">{item.topicTitle}</h2>
          </div>
          <button type="button" onClick={handleClose} className="shrink-0 p-1 rounded hover:bg-muted transition-colors">
            <Icons.X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Meta strip */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-2.5 border-b border-border bg-muted/20">
          <TypeLabel contentType={item.contentType} />
          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_COLORS[item.publishStatus])}>
            {STATUS_LABEL[item.publishStatus]}
          </span>
          {item.wordCount && (
            <span className="text-[10px] text-muted-foreground">{item.wordCount.toLocaleString()} words</span>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">{formatRelative(item.createdAt)}</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingFull ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading full content…
            </div>
          ) : (
            <>
              {/* Edit / Cancel toolbar */}
              <div className="flex items-center justify-end mb-2 min-h-[20px]">
                {isEditing ? (
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icons.Undo2 className="h-3 w-3" />
                    Cancel edits
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startEditing}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icons.Pencil className="h-3 w-3" />
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <textarea
                  ref={textareaRef}
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full text-[13px] leading-relaxed text-foreground font-sans resize-none outline-none border border-input rounded-lg p-3 bg-background focus:ring-1 focus:ring-blue-500"
                  style={{ minHeight: 200, overflow: 'hidden' }}
                  autoFocus
                />
              ) : fullContent ? (
                <div
                  className="prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground whitespace-pre-wrap font-sans cursor-text"
                  onClick={startEditing}
                  title="Click to edit"
                >
                  {fullContent}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No content.</p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col px-5 py-3.5 border-t border-border bg-background gap-1.5">
          {saveError && (
            <p className="text-[11px] text-red-600">{saveError}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="text-xs h-7"
              onClick={() => onDownload(item)}
            >
              <Icons.Download className="h-3 w-3 mr-1.5" />
              Download DOCX
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={copy}
            >
              {copied ? <Icons.Check className="h-3 w-3 mr-1.5 text-green-500" /> : <Icons.Copy className="h-3 w-3 mr-1.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {isEditing && hasEdits && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                disabled={savingEdits}
                onClick={handleSaveEdits}
              >
                {savingEdits ? (
                  <Icons.Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : savedFlash ? (
                  <Icons.Check className="h-3 w-3 mr-1.5 text-green-500" />
                ) : null}
                {savingEdits ? 'Saving…' : savedFlash ? 'Saved' : 'Save edits'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 ml-auto"
              disabled={saving}
              onClick={handleStatusAction}
            >
              {saving && <Icons.Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              {nextLabel}
            </Button>
          </div>
        </div>

        {/* Unsaved edits confirmation */}
        {confirmClose && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <div className="bg-white border border-border rounded-xl shadow-2xl p-5 w-72 flex flex-col gap-3">
              <p className="text-sm font-semibold text-foreground">You have unsaved edits</p>
              <p className="text-xs text-muted-foreground">Save before closing, or discard your changes.</p>
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="text-xs h-7 w-full"
                  disabled={closingSaving}
                  onClick={async () => {
                    setClosingSaving(true)
                    try {
                      const ok = await persistEdits()
                      if (ok) {
                        setFullContent(editedContent)
                        onClose()
                      } else {
                        setConfirmClose(false)
                        setSaveError('Save failed — please try again.')
                      }
                    } catch {
                      setConfirmClose(false)
                      setSaveError('Save failed — please try again.')
                    } finally {
                      setClosingSaving(false)
                    }
                  }}
                >
                  {closingSaving && <Icons.Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                  Save edits
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 w-full"
                  onClick={() => { setConfirmClose(false); onClose() }}
                >
                  Discard
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 w-full"
                  onClick={() => setConfirmClose(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab component
// ─────────────────────────────────────────────────────────────────────────────

export function ContentLibraryTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [items, setItems]             = useState<LibraryItem[]>([])
  const [pagination, setPagination]   = useState<Pagination>({ page: 1, limit: 24, total: 0, pages: 0 })
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  // Filters
  const [search, setSearch]                 = useState('')
  const [contentType, setContentType]       = useState('')
  const [assignedToFilter, setAssignedToFilter] = useState('')  // "type::id" or ""
  const [statusFilter, setStatusFilter]     = useState('')
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [page, setPage]                     = useState(1)

  // Filter options
  const [contentTypes, setContentTypes] = useState<string[]>([])
  const [assignees, setAssignees]       = useState<Assignee[]>([])

  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search input
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Load filter options once
  useEffect(() => {
    Promise.all([
      apiFetch(`/api/v1/content-library/${clientId}/content-types`).then((r) => r.json()),
      apiFetch(`/api/v1/content-library/${clientId}/assignees`).then((r) => r.json()),
    ]).then(([ctData, assData]) => {
      setContentTypes(ctData.data ?? [])
      setAssignees(assData.data ?? [])
    }).catch(() => {})
  }, [clientId])

  const fetchItems = useCallback(async (resetPage = false) => {
    const currentPage = resetPage ? 1 : page
    if (resetPage) setPage(1)
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: '24' })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (contentType)     params.set('contentType', contentType)
      if (statusFilter)    params.set('status', statusFilter)
      if (dateFrom)        params.set('dateFrom', dateFrom)
      if (dateTo)          params.set('dateTo', dateTo)
      if (assignedToFilter) {
        const [type, id] = assignedToFilter.split('::')
        if (type) params.set('assignedToType', type)
        if (id && id !== 'null') params.set('assignedToId', id)
      }

      const res  = await apiFetch(`/api/v1/content-library/${clientId}?${params}`)
      const data = await res.json()
      setItems(data.data ?? [])
      setPagination(data.pagination ?? { page: 1, limit: 24, total: 0, pages: 0 })
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [clientId, page, debouncedSearch, contentType, assignedToFilter, statusFilter, dateFrom, dateTo])

  useEffect(() => { fetchItems(true) }, [debouncedSearch, contentType, assignedToFilter, statusFilter, dateFrom, dateTo, clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchItems() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = !!(debouncedSearch || contentType || assignedToFilter || statusFilter || dateFrom || dateTo)

  const clearFilters = () => {
    setSearch('')
    setContentType('')
    setAssignedToFilter('')
    setStatusFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const handleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await apiFetch(`/api/v1/content-library/${clientId}/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishStatus: status }),
      })
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, publishStatus: status as LibraryItem['publishStatus'] } : i))
      if (previewItem?.id === id) setPreviewItem((prev) => prev ? { ...prev, publishStatus: status as LibraryItem['publishStatus'] } : prev)
    } catch { /* non-fatal */ }
  }

  const handleDownloadSingle = async (item: LibraryItem) => {
    // Always fetch full content — list view truncates to 300 chars
    let fullContent = item.content ?? ''
    try {
      const res  = await apiFetch(`/api/v1/content-library/${clientId}/${item.id}`)
      const data = await res.json()
      fullContent = data.data?.content ?? fullContent
    } catch { /* fall back to preview */ }
    await downloadContentLibraryDocx({
      topicTitle:  item.topicTitle,
      contentType: item.contentType,
      assignedTo:  item.assignedTo,
      content:     fullContent,
      clientName,
      createdAt:   item.createdAt,
    })
  }

  const handleBulkDownload = async () => {
    if (selected.size === 0 || bulkLoading) return
    setBulkLoading(true)
    try {
      const zip = new JSZip()
      const selectedItems = items.filter((i) => selected.has(i.id))

      await Promise.all(selectedItems.map(async (item) => {
        // Fetch full content
        let fullContent = item.content ?? ''
        try {
          const res  = await apiFetch(`/api/v1/content-library/${clientId}/${item.id}`)
          const data = await res.json()
          fullContent = data.data?.content ?? fullContent
        } catch { /* use truncated */ }

        const { blob, filename } = await contentLibraryItemToBlob({
          topicTitle:  item.topicTitle,
          contentType: item.contentType,
          assignedTo:  item.assignedTo,
          content:     fullContent,
          clientName,
          createdAt:   item.createdAt,
        })
        zip.file(filename, blob)
      }))

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      const today = new Date().toISOString().slice(0, 10)
      a.download = `content-library_${slugify(clientName)}_${today}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* non-fatal */ }
    finally { setBulkLoading(false) }
  }

  const handleCopy = async (item: LibraryItem) => {
    const fullContent = item.content ?? ''
    await navigator.clipboard.writeText(fullContent).catch(() => {})
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h2 className="text-[15px] font-medium text-foreground">Content Library</h2>
          <p className="text-[12px] text-muted-foreground">All generated content for this client</p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="text-xs h-7"
          disabled={selected.size === 0 || bulkLoading}
          onClick={handleBulkDownload}
          style={{ opacity: selected.size === 0 ? 0.4 : 1, pointerEvents: selected.size === 0 ? 'none' : 'auto' }}
        >
          {bulkLoading
            ? <><Icons.Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Generating…</>
            : <><Icons.Download className="h-3 w-3 mr-1.5" />Download selected ({selected.size})</>
          }
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border bg-muted/10 shrink-0">
        {/* Search */}
        <div className="relative min-w-[200px]">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search content…"
            className="pl-8 h-7 text-xs"
          />
        </div>

        {/* Content type */}
        <select
          value={contentType}
          onChange={(e) => setContentType(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
        >
          <option value="">All types</option>
          {contentTypes.map((ct) => (
            <option key={ct} value={ct}>{ct}</option>
          ))}
        </select>

        {/* Assigned to */}
        <select
          value={assignedToFilter}
          onChange={(e) => setAssignedToFilter(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
        >
          <option value="">All assignees</option>
          {assignees.map((a) => (
            <option key={`${a.type}::${a.id}`} value={`${a.type}::${a.id}`}>{a.name}</option>
          ))}
        </select>

        {/* Status pills */}
        <div className="flex gap-1">
          {(['', 'draft', 'approved', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'h-7 px-2.5 rounded-md text-xs transition-colors',
                statusFilter === s
                  ? 'bg-foreground text-background'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted',
              )}
            >
              {s === '' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Date range */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          title="To date"
        />

        {/* Clear */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
              {items.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onSelect={handleSelect}
                  onClick={() => setPreviewItem(item)}
                  onStatusChange={handleStatusChange}
                  onDownload={handleDownloadSingle}
                  onCopy={handleCopy}
                />
              ))}
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <Paginator
                pagination={pagination}
                onPage={(p) => { setPage(p); setSelected(new Set()) }}
              />
            )}
          </>
        )}
      </div>

      {/* Preview drawer */}
      {previewItem && (
        <PreviewDrawer
          item={previewItem}
          clientId={clientId}
          clientName={clientName}
          onClose={() => setPreviewItem(null)}
          onStatusChange={(id, status) => {
            handleStatusChange(id, status)
            setPreviewItem((prev) => prev?.id === id ? { ...prev, publishStatus: status as LibraryItem['publishStatus'] } : prev)
          }}
          onDownload={handleDownloadSingle}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
        <Icons.Library className="h-5 w-5 text-muted-foreground" />
      </div>
      {hasFilters ? (
        <>
          <p className="text-sm font-medium text-foreground">No content matches your filters</p>
          <button type="button" onClick={onClearFilters} className="text-xs text-blue-600 hover:underline">
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">No content generated yet</p>
          <p className="text-xs text-muted-foreground max-w-[260px]">
            Approve topics in the Content Newsroom and generate content packs to populate this library.
          </p>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination controls
// ─────────────────────────────────────────────────────────────────────────────

function Paginator({ pagination, onPage }: { pagination: Pagination; onPage: (p: number) => void }) {
  const { page, pages, total, limit } = pagination
  const from = (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {total.toLocaleString()} items
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <Icons.ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page + i - 3
          if (p < 1 || p > pages) return null
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded border text-xs transition-colors',
                p === page
                  ? 'border-blue-500 bg-blue-50 text-blue-600 font-medium'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p}
            </button>
          )
        })}
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <Icons.ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
