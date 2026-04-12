import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { DeliverableStatusStepper, type ReviewStatus } from '@/components/deliverables/DeliverableStatusStepper'
import { downloadTxt, downloadDeliverableDocx } from '@/lib/downloadDocx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NodeStatus { output?: unknown; status?: string }

interface Run {
  id: string
  workflowName: string
  projectName: string | null
  itemName: string | null
  status: string
  reviewStatus: ReviewStatus
  createdAt: string
  completedAt: string | null
  finalOutput: unknown
  nodeStatuses: Record<string, NodeStatus> | null
  editedContent: Record<string, string> | null
  workflow?: { nodes?: Array<{ id: string; label: string; type: string; config: Record<string, unknown> }> } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (typeof o.content === 'string') return o.content
    return JSON.stringify(o, null, 2)
  }
  return ''
}

interface OutputTab { nodeId: string; label: string; content: string }

function extractOutputs(run: Run): OutputTab[] {
  const nodeMap = Object.fromEntries(
    (run.workflow?.nodes ?? []).map((n) => [n.id, n])
  )
  const edited = run.editedContent ?? {}
  const tabs: OutputTab[] = Object.entries(run.nodeStatuses ?? {})
    .filter(([, s]) => s.status === 'passed' && s.output != null)
    .map(([nodeId, s]) => {
      const node = nodeMap[nodeId]
      if (!node || node.type !== 'output') return null
      // Prefer edited content if available
      const content = edited[nodeId] ?? toText(s.output)
      if (!content.trim()) return null
      return { nodeId, label: node.label || 'Output', content }
    })
    .filter(Boolean) as OutputTab[]

  if (tabs.length > 0) return tabs

  const fallback = toText(run.finalOutput)
  if (fallback) return [{ nodeId: 'final', label: 'Output', content: fallback }]
  return []
}

function getPreview(run: Run): string {
  const outputs = extractOutputs(run)
  if (outputs.length === 0) return ''
  return outputs[0].content.slice(0, 300).replace(/\s+/g, ' ').trim()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Status filter bar ─────────────────────────────────────────────────────────

const STATUS_FILTERS: { key: ReviewStatus | 'all'; label: string }[] = [
  { key: 'all',             label: 'All' },
  { key: 'none',            label: 'Generated' },
  { key: 'pending',         label: 'Agency review' },
  { key: 'sent_to_client',  label: 'Sent to client' },
  { key: 'client_responded',label: 'Client responded' },
  { key: 'closed',          label: 'Closed' },
]

// ── Deliverable card ──────────────────────────────────────────────────────────

function DeliverableCard({
  run,
  onStatusChange,
  onOpen,
}: {
  run: Run
  onStatusChange: (id: string, status: ReviewStatus) => void
  onOpen: (id: string) => void
}) {
  const outputs    = extractOutputs(run)
  const preview    = getPreview(run)
  const hasEdits   = run.editedContent && Object.keys(run.editedContent).length > 0
  const hasContent = outputs.length > 0
  const [downloading, setDownloading] = useState(false)

  const handleDownloadDocx = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!hasContent) return
    setDownloading(true)
    const title = run.itemName ?? run.projectName ?? run.workflowName
    await downloadDeliverableDocx(outputs, title)
    setDownloading(false)
  }

  const handleDownloadTxt = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!hasContent) return
    const title = run.itemName ?? run.projectName ?? run.workflowName
    const text = outputs.map((o) => outputs.length > 1 ? `== ${o.label} ==\n\n${o.content}` : o.content).join('\n\n---\n\n')
    downloadTxt(text, title)
  }

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden hover:border-blue-300 transition-colors cursor-pointer group"
      onClick={() => onOpen(run.id)}
    >
      {/* Card header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2 gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate">
              {run.itemName ?? run.projectName ?? run.workflowName}
            </h3>
            {hasEdits && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 border border-blue-200 px-1.5 py-px text-[9px] font-semibold text-blue-600">
                <Icons.PenLine className="h-2.5 w-2.5" />
                Edited
              </span>
            )}
            {run.status === 'completed' && outputs.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">No output</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {run.workflowName}
            {run.completedAt ? ` · ${formatDate(run.completedAt)}` : ` · ${formatDate(run.createdAt)}`}
          </p>
        </div>

        {/* Download buttons */}
        {hasContent && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={handleDownloadTxt}
              title="Download TXT"
              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Icons.FileText className="h-3 w-3" />
            </button>
            <button
              onClick={handleDownloadDocx}
              disabled={downloading}
              title="Download DOCX"
              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
            >
              {downloading
                ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                : <Icons.FileDown className="h-3 w-3" />
              }
            </button>
          </div>
        )}
      </div>

      {/* Content preview */}
      {preview && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {preview}{preview.length >= 300 ? '…' : ''}
          </p>
        </div>
      )}

      {/* Status stepper */}
      <div
        className="border-t border-border bg-muted/30 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <DeliverableStatusStepper
          status={run.reviewStatus}
          onChange={(s) => onStatusChange(run.id, s)}
        />
      </div>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function ClientDeliverablesTab({ clientId }: { clientId: string }) {
  const navigate = useNavigate()
  const [runs, setRuns]           = useState<Run[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<ReviewStatus | 'all'>('all')
  const [search, setSearch]       = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/v1/runs?clientId=${clientId}&status=completed&limit=100`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRuns(data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (runId: string, status: ReviewStatus) => {
    setUpdatingId(runId)
    try {
      await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: status }),
      })
      setRuns((prev) => prev.map((r) => r.id === runId ? { ...r, reviewStatus: status } : r))
    } finally {
      setUpdatingId(null)
    }
  }

  const filtered = runs.filter((r) => {
    if (filter !== 'all' && r.reviewStatus !== filter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = (r.itemName ?? r.projectName ?? r.workflowName ?? '').toLowerCase()
      if (!name.includes(q)) return false
    }
    return true
  })

  // Group by workflow name for visual separation
  const grouped: Record<string, Run[]> = {}
  for (const r of filtered) {
    const key = r.workflowName
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search deliverables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                filter === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={load}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <Icons.RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Icons.Package className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {runs.length === 0 ? 'No completed deliverables yet' : 'No deliverables match your filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([workflowName, groupRuns]) => (
            <div key={workflowName} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icons.Workflow className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {workflowName}
                </h4>
                <span className="text-[10px] text-muted-foreground">({groupRuns.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupRuns.map((run) => (
                  <div key={run.id} className={cn(updatingId === run.id && 'opacity-60 pointer-events-none')}>
                    <DeliverableCard
                      run={run}
                      onStatusChange={handleStatusChange}
                      onOpen={(id) => navigate(`/review/${id}`)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
