/**
 * ProductMarketingTab.tsx
 *
 * productPILOT — vertical selector + brain file section at top, skill browser below.
 * Brain section is a copy of the GTM Framework brain section.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { ProductPilot } from '@/components/pilot/ProductPilot'
import { apiFetch } from '@/lib/api'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'
import { DimensionBar, type DimensionItem } from '@/components/layout/DimensionBar'
import { checkFilenames, type FilenameIssue } from '@/lib/filename'
import { FilenameWarning } from '@/components/ui/FilenameWarning'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vertical extends DimensionItem { id: string; name: string; dimensionType: string }

interface Skill {
  key: string
  name: string
  description: string
}

interface SkillCategory {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  skills: Skill[]
}

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  storageKey: string
  summaryStatus: 'pending' | 'processing' | 'ready' | 'failed'
  summary: string | null
  brandSummary?: string | null
  brandSummaryStatus?: string | null
  brandAttachmentId?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📝'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  return '📎'
}

function renderSummaryMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+?)\s+—\s+(High|Medium|Low) importance$/i)
    if (sectionMatch) {
      nodes.push(
        <div key={key++} className="mt-3 mb-1 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">{sectionMatch[1]}</span>
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
            sectionMatch[2].toLowerCase() === 'high' && 'bg-blue-100 text-blue-700',
            sectionMatch[2].toLowerCase() === 'medium' && 'bg-amber-100 text-amber-700',
            sectionMatch[2].toLowerCase() === 'low' && 'bg-zinc-100 text-muted-foreground',
          )}>{sectionMatch[2]}</span>
        </div>
      )
    } else if (line.startsWith('- ')) {
      nodes.push(
        <div key={key++} className="flex gap-1.5 text-[11px] text-foreground/80 leading-relaxed">
          <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
          <span>{line.slice(2)}</span>
        </div>
      )
    } else if (line.trim()) {
      nodes.push(<p key={key++} className="text-[11px] text-muted-foreground">{line}</p>)
    }
  }
  return <div>{nodes}</div>
}

// ─── AttachmentRow ────────────────────────────────────────────────────────────

function AttachmentRow({ attachment: a, base, deletingId, onDelete, onSummaryUpdated }: {
  attachment: Attachment
  base: string
  deletingId: string | null
  onDelete: (a: Attachment) => void
  onSummaryUpdated: (id: string, summary: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(a.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [showText, setShowText] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`${base}/${a.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: editValue }),
      })
      if (res.ok) { onSummaryUpdated(a.id, editValue); setEditing(false) }
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleViewText = async () => {
    if (rawText !== null) { setShowText(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(`${base}/${a.id}/text`)
      if (res.ok) { const { data } = await res.json(); setRawText(data.text ?? '') }
    } catch { /* ignore */ } finally { setLoadingText(false); setShowText(true) }
  }

  const statusBadge = () => {
    if (a.summaryStatus === 'processing' || a.summaryStatus === 'pending') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-blue-500">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-400 border-t-transparent" />
          Processing…
        </span>
      )
    }
    if (a.summaryStatus === 'ready') return <span className="text-[10px] text-green-600 font-medium">✓ Interpreted</span>
    if (a.summaryStatus === 'failed') return <span className="text-[10px] text-red-500">Failed to process</span>
    return null
  }

  return (
    <div className="rounded-lg border border-border bg-transparent overflow-hidden">
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[11px] text-muted-foreground shrink-0 w-3">{expanded ? '▼' : '▶'}</span>
        <span className="text-lg shrink-0">{fileIcon(a.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">{formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
            {statusBadge()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(a) }}
          disabled={deletingId === a.id}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 disabled:opacity-40"
          title="Delete"
        >
          {deletingId === a.id
            ? <span className="h-3.5 w-3.5 block animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          }
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {(a.summaryStatus === 'pending' || a.summaryStatus === 'processing') && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              Claude is reading and interpreting this file…
            </div>
          )}
          {a.summaryStatus === 'failed' && (
            <p className="py-2 text-sm text-red-500">Could not extract readable content from this file.</p>
          )}
          {a.summaryStatus === 'ready' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">productPILOT Read</p>
                  {!editing && (
                    <div className="flex items-center gap-3">
                      <button onClick={handleViewText} disabled={loadingText} className="text-[10px] text-muted-foreground underline hover:text-foreground">
                        {loadingText ? 'Loading…' : 'View original text'}
                      </button>
                      <button onClick={() => { setEditValue(a.summary ?? ''); setEditing(true) }} className="text-[10px] text-blue-500 underline hover:text-blue-700">Edit</button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edit Claude's Interpretation</p>
                    <textarea
                      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      rows={14}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={handleSave} disabled={saving} className="rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => { setEditing(false); setEditValue(a.summary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/20 px-3 py-2">
                    {a.summary ? renderSummaryMarkdown(a.summary) : <p className="text-[11px] text-muted-foreground italic">No interpretation yet</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {showText && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" style={{ maxHeight: '80vh' }}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-foreground truncate">{a.filename} — Raw Text</p>
                  <button onClick={() => setShowText(false)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="overflow-y-auto p-4">
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-foreground">{rawText ?? 'No extracted text available.'}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── BrainSection ─────────────────────────────────────────────────────────────

function BrainSection({ clientId, verticalId, websiteStatus, onScrapeWebsite, onReadyChange }: {
  clientId: string
  verticalId: string | null
  websiteStatus: 'none' | 'pending' | 'running' | 'ready' | 'failed'
  onScrapeWebsite: (websiteUrl: string) => Promise<void>
  onReadyChange: (hasReady: boolean) => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingCount, setUploadingCount] = useState(0)
  const uploading = uploadingCount > 0
  const [dragging, setDragging] = useState(false)
  const [filenameIssues, setFilenameIssues] = useState<FilenameIssue[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')

  const base = verticalId
    ? `/api/v1/clients/${clientId}/framework/${verticalId}/attachments`
    : `/api/v1/clients/${clientId}/brand-profile/attachments`

  const fetchAttachments = useCallback(() => {
    return apiFetch(base).then((r) => r.json()).then(({ data }) => setAttachments(data ?? [])).catch(() => {})
  }, [base])

  useEffect(() => {
    setLoading(true)
    fetchAttachments().finally(() => setLoading(false))
  }, [fetchAttachments])

  useEffect(() => {
    const hasInProgress = attachments.some(
      (a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing'
    )
    if (!hasInProgress) return
    const t = setTimeout(() => { fetchAttachments() }, 4000)
    return () => clearTimeout(t)
  }, [attachments, fetchAttachments])

  useEffect(() => {
    onReadyChange(attachments.some((a) => a.summaryStatus === 'ready'))
  }, [attachments, onReadyChange])

  const uploadFile = async (file: File) => {
    setUploadingCount((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(base, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Upload failed'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 8000)
        return
      }
      setUploadError(null)
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error — upload failed'
      setUploadError(msg)
      setTimeout(() => setUploadError(null), 8000)
    } finally {
      setUploadingCount((n) => n - 1)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const fileArr = Array.from(files)
    setFilenameIssues(checkFilenames(fileArr))
    fileArr.forEach(uploadFile)
  }

  const handleDelete = async (a: Attachment) => {
    if (!confirm(`Delete "${a.filename}"?`)) return
    setDeletingId(a.id)
    try {
      await apiFetch(`${base}/${a.id}`, { method: 'DELETE' })
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch { /* ignore */ } finally { setDeletingId(null) }
  }

  return (
    <div className="pb-5">
      <div className="mb-4">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Brain</div>
        <h2 className="text-xl font-bold text-foreground">Research & Supporting Files</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {verticalId
            ? 'Upload anything relevant to this vertical — meeting notes, capability decks, audio recordings, strategy docs. Used as research context during productPILOT sessions.'
            : 'Upload company-wide research — positioning docs, sales decks, strategy notes. These feed into the client brain and inform all verticals.'
          }
        </p>
      </div>

      {/* Brain status */}
      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
        {(() => {
          const ready      = attachments.filter((a) => a.summaryStatus === 'ready').length
          const processing = attachments.filter((a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing').length
          const failed     = attachments.filter((a) => a.summaryStatus === 'failed').length
          if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
          if (attachments.length === 0) {
            return (
              <div>
                <p className="text-sm font-semibold text-foreground">No files in brain yet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Upload files below — each is automatically read and interpreted by Claude. Interpreted files permanently feed the ✦ Draft buttons.</p>
              </div>
            )
          }
          return (
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {ready > 0 ? `✓ ${ready} file${ready !== 1 ? 's' : ''} in brain` : 'Files processing…'}
                  {processing > 0 && ` · ${processing} processing`}
                  {failed > 0 && ` · ${failed} failed`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ready > 0 ? 'Files are active — productPILOT sessions for this vertical will draw on them.' : 'Files are being read and interpreted — they will activate once ready.'}
                </p>
              </div>
              {ready > 0 && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Brain active</span>}
            </div>
          )
        })()}
      </div>

      {/* Website scraping — vertical only */}
      {verticalId && (
        <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Website context <span className="text-[10px] font-normal text-muted-foreground ml-1">optional</span></p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {websiteStatus === 'none' && 'Scrape the client\'s website to add it to the brain.'}
                {(websiteStatus === 'pending' || websiteStatus === 'running') && 'Scraping website…'}
                {websiteStatus === 'ready' && '✓ Website scraped and in brain. Re-scrape anytime to refresh.'}
                {websiteStatus === 'failed' && 'Scrape failed — check the URL and try again.'}
              </p>
            </div>
            {(websiteStatus === 'running' || websiteStatus === 'pending') && (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://clientwebsite.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
            <button
              disabled={!websiteUrl.trim() || websiteStatus === 'running' || websiteStatus === 'pending'}
              onClick={() => onScrapeWebsite(websiteUrl.trim())}
              className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {websiteStatus === 'ready' ? 'Re-scrape' : 'Scrape Website'}
            </button>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors',
          dragging ? 'border-blue-400 bg-blue-50/40' : 'border-border hover:border-blue-300 hover:bg-muted/20',
        )}
      >
        <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.mp4,.mov,.mp3,.m4a,.wav,.webm" onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            Uploading{uploadingCount > 1 ? ` ${uploadingCount} files` : ''}…
          </div>
        ) : (
          <>
            <div className="text-2xl">📎</div>
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-[11px] text-muted-foreground">Notes, PDFs, Word docs, audio recordings, slide decks — any format</p>
          </>
        )}
      </div>

      {filenameIssues.length > 0 && <FilenameWarning issues={filenameIssues} />}
      {uploadError && (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600 mb-3">
          <span>⚠</span> {uploadError}
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No files yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Uploaded files will appear here and feed into AI research during sessions</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              base={base}
              deletingId={deletingId}
              onDelete={handleDelete}
              onSummaryUpdated={(id, summary) =>
                setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary, summaryStatus: 'ready' } : x))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Skill catalog ────────────────────────────────────────────────────────────

const CATEGORIES: SkillCategory[] = [
  {
    key: 'pm-product-strategy',
    label: 'Product Strategy',
    icon: Icons.Layers,
    skills: [
      { key: 'product-vision',       name: 'Product Vision',         description: 'Craft an inspiring, achievable vision statement.' },
      { key: 'product-strategy',     name: 'Product Strategy',       description: '9-section canvas: vision, segments, trade-offs, growth.' },
      { key: 'value-proposition',    name: 'Value Proposition',      description: 'JTBD 6-part template: Who, Why, Before, How, After, Alternatives.' },
      { key: 'swot-analysis',        name: 'SWOT Analysis',          description: 'Strengths, weaknesses, opportunities, threats + cross-referenced actions.' },
      { key: 'business-model',       name: 'Business Model Canvas',  description: 'All 9 building blocks: partners, activities, resources, channels, revenue.' },
      { key: 'lean-canvas',          name: 'Lean Canvas',            description: 'Startup hypothesis testing across 9 sections.' },
      { key: 'pricing-strategy',     name: 'Pricing Strategy',       description: '7 pricing models evaluated for fit, unit economics, and positioning.' },
      { key: 'monetization-strategy',name: 'Monetization Strategy',  description: 'Brainstorm 3–5 models with audience fit and validation experiments.' },
      { key: 'ansoff-matrix',        name: 'Ansoff Matrix',          description: 'Map growth: penetration, market dev, product dev, diversification.' },
      { key: 'pestle-analysis',      name: 'PESTLE Analysis',        description: 'Political, economic, social, tech, legal, environmental factors.' },
      { key: 'porters-five-forces',  name: "Porter's Five Forces",   description: 'Competitive dynamics: rivalry, suppliers, buyers, substitutes, entrants.' },
      { key: 'startup-canvas',       name: 'Startup Canvas',         description: 'Product strategy + business model for a new venture.' },
    ],
  },
  {
    key: 'pm-product-discovery',
    label: 'Product Discovery',
    icon: Icons.Search,
    skills: [
      { key: 'opportunity-solution-tree', name: 'Opportunity Solution Tree', description: 'Outcome → opportunities → solutions → experiments (Teresa Torres).' },
      { key: 'interview-script',          name: 'Customer Interview Script', description: 'The Mom Test interview scripts with JTBD probing questions.' },
      { key: 'user-stories',              name: 'User Stories',             description: 'INVEST-compliant stories with acceptance criteria and edge cases.' },
      { key: 'brainstorm-ideas-existing', name: 'Brainstorm Ideas',         description: 'PM, Designer, Engineer perspectives — top 5 ideas prioritized.' },
      { key: 'identify-assumptions-existing', name: 'Identify Assumptions', description: 'Value, Usability, Viability, Feasibility risk analysis.' },
      { key: 'prioritize-features',       name: 'Prioritize Features',      description: 'Rank backlog by impact, effort, risk, and strategic alignment.' },
      { key: 'metrics-dashboard',         name: 'Metrics Dashboard',        description: 'North Star, input metrics, health metrics, alerts, cadence.' },
      { key: 'summarize-interview',       name: 'Summarize Interview',      description: 'JTBD-structured summary from interview transcripts.' },
      { key: 'analyze-feature-requests',  name: 'Analyze Feature Requests', description: 'Cluster and prioritize requests by underlying JTBD.' },
      { key: 'prioritize-assumptions',    name: 'Prioritize Assumptions',   description: 'Impact × Risk matrix with experiment suggestions.' },
    ],
  },
  {
    key: 'pm-market-research',
    label: 'Market Research',
    icon: Icons.BarChart2,
    skills: [
      { key: 'user-personas',         name: 'User Personas',         description: 'Research-backed personas with JTBD, goals, fears, and buying behavior.' },
      { key: 'competitor-analysis',   name: 'Competitor Analysis',   description: 'Positioning, strengths, weaknesses, pricing, and strategic movements.' },
      { key: 'market-sizing',         name: 'Market Sizing',         description: 'TAM, SAM, SOM with top-down and bottom-up approaches.' },
      { key: 'market-segments',       name: 'Market Segments',       description: 'Identify and prioritize segments by fit, size, and strategic value.' },
      { key: 'customer-journey-map',  name: 'Customer Journey Map',  description: 'Full journey from awareness to advocacy with gaps and emotions.' },
      { key: 'user-segmentation',     name: 'User Segmentation',     description: 'Segment users by behavior, value, and activation status.' },
      { key: 'sentiment-analysis',    name: 'Sentiment Analysis',    description: 'Theme clusters from reviews, support tickets, and interviews.' },
    ],
  },
  {
    key: 'pm-go-to-market',
    label: 'Go-to-Market',
    icon: Icons.Rocket,
    skills: [
      { key: 'ideal-customer-profile', name: 'Ideal Customer Profile', description: 'ICP with firmographic, behavioral, JTBD, and disqualification criteria.' },
      { key: 'beachhead-segment',      name: 'Beachhead Segment',      description: 'Find the first market to dominate before expanding.' },
      { key: 'gtm-strategy',           name: 'GTM Strategy',           description: 'Channels, messaging, metrics, timeline, and 90-day execution plan.' },
      { key: 'gtm-motions',            name: 'GTM Motions',            description: 'Inbound, outbound, PLG, ABM, partner, community, paid — evaluated.' },
      { key: 'competitive-battlecard', name: 'Competitive Battlecard', description: 'Win/loss patterns, objections, responses, and landmines.' },
      { key: 'growth-loops',           name: 'Growth Loops',           description: 'Viral, usage, collaboration, UGC, referral flywheels designed.' },
    ],
  },
  {
    key: 'pm-marketing-growth',
    label: 'Marketing & Growth',
    icon: Icons.TrendingUp,
    skills: [
      { key: 'north-star-metric',    name: 'North Star Metric',    description: 'The one metric that captures value delivery and leads to revenue.' },
      { key: 'positioning-ideas',    name: 'Positioning Ideas',    description: 'Generate and evaluate positioning territories.' },
      { key: 'value-prop-statements',name: 'Value Prop Statements', description: 'Headlines, elevator pitches, and audience-specific variants.' },
      { key: 'marketing-ideas',      name: 'Marketing Ideas',      description: 'Creative ideas by channel, budget, and growth stage.' },
      { key: 'product-name',         name: 'Product Name',         description: 'Generate and evaluate names for memorability and positioning fit.' },
    ],
  },
  {
    key: 'pm-execution',
    label: 'Execution',
    icon: Icons.ClipboardList,
    skills: [
      { key: 'create-prd',               name: 'Product Requirements Doc', description: 'Problem, solution, requirements, metrics, and out-of-scope.' },
      { key: 'brainstorm-okrs',          name: 'Brainstorm OKRs',          description: 'Outcome-oriented objectives and key results.' },
      { key: 'outcome-roadmap',          name: 'Outcome Roadmap',          description: 'Now/Next/Later organized around outcomes, not features.' },
      { key: 'sprint-plan',              name: 'Sprint Plan',              description: 'Goal, stories, capacity, dependencies, and definition of done.' },
      { key: 'pre-mortem',               name: 'Pre-Mortem',               description: 'Imagine failure — identify risks and prevention strategies.' },
      { key: 'retro',                    name: 'Sprint Retrospective',     description: 'What went well, what to improve, concrete next actions.' },
      { key: 'stakeholder-map',          name: 'Stakeholder Map',          description: 'Influence, interest, support level, and engagement strategy.' },
      { key: 'release-notes',            name: 'Release Notes',            description: 'Customer-facing notes that communicate value, not features.' },
      { key: 'job-stories',              name: 'Job Stories',              description: '"When / I want to / So I can" — context and motivation.' },
      { key: 'test-scenarios',           name: 'Test Scenarios',           description: 'Happy path, edge cases, errors, permissions, performance.' },
      { key: 'summarize-meeting',        name: 'Summarize Meeting',        description: 'Decisions, action items, and context — not discussions.' },
      { key: 'dummy-dataset',            name: 'Dummy Dataset',            description: 'Realistic synthetic data for testing and demos.' },
      { key: 'prioritization-frameworks',name: 'Prioritization Frameworks',description: 'ICE, RICE, Kano, MoSCoW, Opportunity Scoring compared.' },
    ],
  },
  {
    key: 'pm-data-analytics',
    label: 'Data & Analytics',
    icon: Icons.LineChart,
    skills: [
      { key: 'ab-test-analysis', name: 'A/B Test Analysis',   description: 'Statistical significance, guardrail metrics, ship/extend/stop.' },
      { key: 'cohort-analysis',  name: 'Cohort Analysis',     description: 'Retention and engagement patterns by cohort.' },
      { key: 'sql-queries',      name: 'SQL Query Builder',   description: 'Optimized queries for product analytics across all major platforms.' },
    ],
  },
]

const QUICK_TOOLS: Skill[] = [
  { key: 'grammar-check',  name: 'Grammar & Flow Check', description: 'Fix grammar, logic, and flow in any text.' },
  { key: 'draft-nda',      name: 'Draft NDA',             description: 'Non-disclosure agreement template.' },
  { key: 'privacy-policy', name: 'Privacy Policy',        description: 'Privacy policy template for web apps.' },
]

// ─── SkillCard ────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  categoryKey,
  savedSkills,
  onLaunch,
}: {
  skill: Skill
  categoryKey: string
  savedSkills: Set<string>
  onLaunch: (categoryKey: string, skillKey: string, skillName: string) => void
}) {
  const isSaved = savedSkills.has(`${categoryKey}/${skill.key}`)
  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border bg-transparent p-3.5 transition-all hover:border-purple-300 hover:shadow-sm">
      {isSaved && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5">
          <Icons.Brain className="h-2.5 w-2.5 text-emerald-600" />
          <span className="text-[9px] font-medium text-emerald-700">In Brain</span>
        </div>
      )}
      <p className="text-[12px] font-semibold text-foreground pr-14 leading-snug">{skill.name}</p>
      <p className="text-[11px] text-muted-foreground leading-snug flex-1">{skill.description}</p>
      <button
        onClick={() => onLaunch(categoryKey, skill.key, skill.name)}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold text-white transition-colors opacity-0 group-hover:opacity-100"
        style={{ backgroundColor: '#a200ee' }}
      >
        <Icons.Zap className="h-3 w-3" />
        {isSaved ? 'Run again' : 'Launch session'}
      </button>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function ProductMarketingTab({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const verticalTerm = useVerticalTerm()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [pilotSkill, setPilotSkill] = useState<{ categoryKey: string; skillKey: string; skillName: string } | null>(null)
  const [savedSkills, setSavedSkills] = useState<Set<string>>(new Set())

  // Verticals + dimension selection
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [verticalsLoading, setVerticalsLoading] = useState(true)
  const [selectedDimensions, setSelectedDimensions] = useState<Record<string, string>>({})
  const selectedVertical = verticals.find((v) => Object.values(selectedDimensions).includes(v.id)) ?? null
  const setSelectedVertical = (v: Vertical | null) => setSelectedDimensions(v ? { [v.dimensionType]: v.id } : {})

  // Website scrape state
  const [websiteStatus, setWebsiteStatus] = useState<'none' | 'pending' | 'running' | 'ready' | 'failed'>('none')
  const websitePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        const list: Vertical[] = [...(data ?? [])].sort((a: Vertical, b: Vertical) => a.name.localeCompare(b.name))
        setVerticals(list)
      })
      .catch(() => {})
      .finally(() => setVerticalsLoading(false))
  }, [clientId])

  // Load website scrape status when vertical changes
  useEffect(() => {
    if (!selectedVertical) { setWebsiteStatus('none'); return }
    const endpoint = `/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`
    apiFetch(endpoint).then((r) => r.json()).then(({ data }) => {
      setWebsiteStatus((data?.status ?? 'none') as typeof websiteStatus)
    }).catch(() => {})
    return () => { if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null } }
  }, [clientId, selectedVertical])

  const startWebsitePolling = useCallback(() => {
    if (websitePollRef.current) clearInterval(websitePollRef.current)
    websitePollRef.current = setInterval(() => {
      if (!selectedVertical) return
      apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`)
        .then((r) => r.json()).then(({ data }) => {
          const s = (data?.status ?? 'none') as typeof websiteStatus
          setWebsiteStatus(s)
          if (s !== 'running' && s !== 'pending') {
            if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null }
          }
        }).catch(() => {})
    }, 4000)
  }, [clientId, selectedVertical])

  const scrapeWebsite = useCallback(async (websiteUrl: string) => {
    if (!selectedVertical || !websiteUrl) return
    setWebsiteStatus('pending')
    await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    })
    startWebsitePolling()
  }, [clientId, selectedVertical, startWebsitePolling])

  const activeCat = activeCategory ? (CATEGORIES.find((c) => c.key === activeCategory) ?? null) : null

  const launchSkill = (categoryKey: string, skillKey: string, skillName: string) => {
    setPilotSkill({ categoryKey, skillKey, skillName })
  }

  const handleSynthesisSaved = (skillKey: string) => {
    if (pilotSkill) {
      setSavedSkills((prev) => new Set([...prev, `${pilotSkill.categoryKey}/${skillKey}`]))
    }
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Dimension selector bar — matches GTM Framework */}
      <DimensionBar
        items={verticals}
        selected={selectedDimensions}
        onChange={(type, id) => setSelectedDimensions(id ? { [type]: id } : {})}
        loading={verticalsLoading}
        verticalTerm={verticalTerm}
      />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border overflow-y-auto">

        {/* productPILOT header — click to return to brain view */}
        <button
          onClick={() => setActiveCategory(null)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2.5 text-left transition-colors border-b border-border',
            activeCategory === null ? 'bg-muted/20' : 'hover:bg-muted/20',
          )}
        >
          <Icons.Zap className="h-3.5 w-3.5 shrink-0" style={{ color: '#a200ee' }} />
          <div>
            <p className="text-[11px] font-bold tracking-wide" style={{ color: '#a200ee' }}>productPILOT</p>
            <p className="text-[10px] text-muted-foreground">Brain & Overview</p>
          </div>
        </button>

        {/* Category nav */}
        <div className="flex flex-col gap-0.5 p-2 flex-1">
          {CATEGORIES.map((cat) => {
            const CatIcon = cat.icon
            const isActive = cat.key === activeCategory
            const savedCount = cat.skills.filter((s) => savedSkills.has(`${cat.key}/${s.key}`)).length
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                  isActive ? 'text-white' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                )}
                style={isActive ? { backgroundColor: '#a200ee' } : {}}
              >
                <CatIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] font-medium flex-1">{cat.label}</span>
                {savedCount > 0 && (
                  <span className={cn(
                    'text-[9px] font-semibold rounded-full px-1.5 py-0.5',
                    isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
                  )}>{savedCount}</span>
                )}
              </button>
            )
          })}

          <div className="mt-2 border-t border-border pt-2">
            <p className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Quick Tools</p>
            {QUICK_TOOLS.map((tool) => (
              <button
                key={tool.key}
                onClick={() => launchSkill('pm-toolkit', tool.key, tool.name)}
                className="flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
              >
                <Icons.Wrench className="h-3 w-3 shrink-0" />
                <span className="text-[11px]">{tool.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-y-auto">
        {activeCategory === null ? (
          /* Brain + overview — default landing view */
          <div className="p-6 max-w-3xl">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <Icons.Zap className="h-4 w-4" style={{ color: '#a200ee' }} />
                <h2 className="text-base font-semibold text-foreground">productPILOT</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI-guided skill sessions for product managers and marketers. Each session is a structured conversation
                that draws on this client's brain context to produce a synthesis — value props, personas, roadmap priorities,
                and more. Upload research files below to enrich every session with client-specific intelligence.
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Select a category from the left navigation to browse skills and launch a session.
                {selectedVertical && <> Sessions will draw on the <span className="font-medium text-foreground">{selectedVertical.name}</span> vertical brain.</>}
              </p>
            </div>
            <BrainSection
              clientId={clientId}
              verticalId={selectedVertical?.id ?? null}
              websiteStatus={websiteStatus}
              onScrapeWebsite={scrapeWebsite}
              onReadyChange={() => {}}
            />
          </div>
        ) : activeCat ? (
          /* Skill grid — shown when category selected */
          <div className="p-6">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                {(() => { const CatIcon = activeCat.icon; return <CatIcon className="h-4 w-4 text-muted-foreground" /> })()}
                <h2 className="text-base font-semibold text-foreground">{activeCat.label}</h2>
                <span className="text-[11px] text-muted-foreground">{activeCat.skills.length} skills</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Click any skill to launch a guided productPILOT session. Completed sessions save synthesis to this client's Brain.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {activeCat.skills.map((skill) => (
                <SkillCard
                  key={skill.key}
                  skill={skill}
                  categoryKey={activeCat.key}
                  savedSkills={savedSkills}
                  onLaunch={launchSkill}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* ProductPilot modal */}
      {pilotSkill && (
        <ProductPilot
          clientId={clientId}
          clientName={clientName}
          categoryKey={pilotSkill.categoryKey}
          skillKey={pilotSkill.skillKey}
          skillName={pilotSkill.skillName}
          verticalId={selectedVertical?.id ?? null}
          onClose={() => setPilotSkill(null)}
          onSkillSuggestionClick={(catKey, skKey) => {
            const cat = CATEGORIES.find((c) => c.key === catKey)
            let sk = cat?.skills.find((s) => s.key === skKey) ?? QUICK_TOOLS.find((t) => t.key === skKey)
            let resolvedCatKey = catKey
            if (!sk) {
              for (const c of CATEGORIES) {
                const found = c.skills.find((s) => s.key === skKey)
                if (found) { sk = found; resolvedCatKey = c.key; break }
              }
            }
            if (sk) setPilotSkill({ categoryKey: resolvedCatKey, skillKey: skKey, skillName: sk.name })
          }}
          onSynthesisSaved={handleSynthesisSaved}
        />
      )}
      </div>{/* end main content area */}
    </div>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
