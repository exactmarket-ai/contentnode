import { useEffect, useState, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeStatus {
  status: string
  output?: unknown
  startedAt?: string
  completedAt?: string
}

interface RunRecord {
  id: string
  status: string
  createdAt: string
  completedAt: string | null
  finalOutput: unknown
  output?: { nodeStatuses?: Record<string, NodeStatus> }
  nodeStatuses?: Record<string, NodeStatus>
  parentRunId: string | null
  triggerType: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractContent(finalOutput: unknown): string | null {
  if (typeof finalOutput === 'string') return finalOutput
  if (typeof finalOutput === 'object' && finalOutput !== null) {
    const o = finalOutput as Record<string, unknown>
    if (typeof o.content === 'string') return o.content
    return JSON.stringify(o, null, 2)
  }
  return null
}

function extractDetectionScore(nodeStatuses: Record<string, NodeStatus> | undefined): number | null {
  if (!nodeStatuses) return null
  for (const ns of Object.values(nodeStatuses)) {
    if (ns.status === 'passed' && ns.output && typeof ns.output === 'object') {
      const out = ns.output as Record<string, unknown>
      if (typeof out.overall_score === 'number') return out.overall_score
    }
  }
  return null
}

function scoreColor(score: number) {
  if (score <= 20) return { bg: '#f0fdf4', border: '#86efac', text: '#15803d' }
  if (score <= 50) return { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' }
  return { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' }
}

function downloadTxt(content: string, runIndex: number) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `run-${runIndex}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Run Card ─────────────────────────────────────────────────────────────────

function RunCard({ run, index, total }: { run: RunRecord; index: number; total: number }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const content = extractContent(run.finalOutput)
  const nodeStatuses = run.nodeStatuses ?? (run.output as { nodeStatuses?: Record<string, NodeStatus> } | undefined)?.nodeStatuses
  const detectionScore = extractDetectionScore(nodeStatuses)
  const runNumber = total - index

  const date = new Date(run.createdAt)
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isCompleted = run.status === 'completed'
  const isFailed = run.status === 'failed'

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-white">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card">
        {run.parentRunId && (
          <Icons.CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold text-foreground">Run #{runNumber}</span>
        <span className="text-[10px] text-muted-foreground">{dateStr} · {timeStr}</span>
        {run.triggerType === 'rerun' && (
          <span className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-px text-[10px] font-medium text-blue-600">
            re-run
          </span>
        )}
        {run.triggerType === 'feedback_auto' && (
          <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-px text-[10px] font-medium text-amber-600">
            feedback
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Status chip */}
          {isCompleted && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-px text-[10px] font-medium text-emerald-700">
              <Icons.CheckCircle2 className="h-2.5 w-2.5" />
              Done
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-0.5 rounded-full bg-red-50 border border-red-200 px-1.5 py-px text-[10px] font-medium text-red-600">
              <Icons.XCircle className="h-2.5 w-2.5" />
              Failed
            </span>
          )}
          {!isCompleted && !isFailed && (
            <span className="rounded-full bg-gray-50 border border-gray-200 px-1.5 py-px text-[10px] font-medium text-muted-foreground capitalize">
              {run.status}
            </span>
          )}

          {/* Detection score */}
          {detectionScore !== null && (
            <span
              className="rounded-full border px-1.5 py-px text-[10px] font-semibold"
              style={scoreColor(detectionScore)}
            >
              {detectionScore}% AI
            </span>
          )}
        </div>
      </div>

      {/* Content area */}
      {content ? (
        <div className="px-3 pb-2.5">
          {/* Preview / expanded */}
          <div
            className={cn(
              'mt-2 text-[11px] leading-relaxed text-foreground whitespace-pre-wrap font-mono bg-muted/40 rounded p-2',
              !expanded && 'max-h-[80px] overflow-hidden relative'
            )}
          >
            {content}
            {!expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white/90 to-transparent pointer-events-none" />
            )}
          </div>

          {/* Actions row */}
          <div className="mt-1.5 flex items-center gap-1">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {expanded
                ? <><Icons.ChevronUp className="h-3 w-3" />Collapse</>
                : <><Icons.ChevronDown className="h-3 w-3" />Expand</>
              }
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
            >
              {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => downloadTxt(content, runNumber)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icons.Download className="h-3 w-3" />
              Download
            </button>
          </div>
        </div>
      ) : (
        isCompleted && (
          <p className="px-3 pb-2.5 pt-1 text-[10px] text-muted-foreground italic">No output captured</p>
        )
      )}

      {isFailed && (
        <p className="px-3 pb-2.5 pt-1 text-[10px] text-red-500 italic">Run did not complete</p>
      )}
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function RunHistoryPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch(`/api/v1/runs?workflowId=${encodeURIComponent(workflowId)}&limit=30`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRuns(data ?? [])
        setLoading(false)
      })
      .catch((err) => {
        setError(String(err))
        setLoading(false)
      })
  }, [workflowId])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Icons.History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Run History</span>
        <button
          onClick={load}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Refresh"
        >
          <Icons.RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Icons.X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-2 px-3 py-3">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              Failed to load runs: {error}
            </div>
          )}

          {!loading && !error && runs.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10">
              <Icons.History className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No runs yet for this workflow.</p>
            </div>
          )}

          {!loading && runs.map((run, i) => (
            <RunCard key={run.id} run={run} index={i} total={runs.length} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
