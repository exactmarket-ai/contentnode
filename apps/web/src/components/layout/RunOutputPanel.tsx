import { useState, useMemo } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn, stripMarkdown } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { MarkdownContent } from '@/components/ui/markdown-content'

function extractContent(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content || null
    if (typeof obj.text    === 'string') return obj.text    || null
    return JSON.stringify(obj, null, 2)
  }
  return null
}

interface TerminalOutput {
  nodeId: string
  label: string
  status: 'passed' | 'failed' | 'skipped'
  content: string | null
  error:   string | null
}

// Review nodes display results in their config panel — exclude from the right-rail output
const REVIEW_SUBTYPES = new Set(['seo-review', 'geo-review', 'fact-checker', 'quality-review'])

export function RunOutputPanel() {
  const nodes          = useWorkflowStore((s) => s.nodes)
  const edges          = useWorkflowStore((s) => s.edges)
  const nodeRunStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const runStatus      = useWorkflowStore((s) => s.runStatus)

  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [copiedId, setCopiedId]   = useState<string | null>(null)

  // Terminal nodes = nodes that have no outgoing edge
  const terminalOutputs = useMemo<TerminalOutput[]>(() => {
    const sourcedIds = new Set(edges.map((e) => e.source))
    return nodes
      .filter((n) => !sourcedIds.has(n.id))
      .filter((n) => !REVIEW_SUBTYPES.has((n.data?.subtype as string) ?? ''))
      .map((n) => {
        const nrs = nodeRunStatuses[n.id]
        return {
          nodeId:  n.id,
          label:   (n.data.label as string) || n.type || 'Node',
          status:  (nrs?.status === 'passed' || nrs?.status === 'failed' || nrs?.status === 'skipped')
            ? nrs.status
            : 'passed',
          content: extractContent(nrs?.output),
          error:   nrs?.error ?? null,
        }
      })
      // Only show nodes that actually ran
      .filter((t) => {
        const s = nodeRunStatuses[t.nodeId]?.status
        return s === 'passed' || s === 'failed'
      })
  }, [nodes, edges, nodeRunStatuses])

  const currentId = (activeTab && terminalOutputs.some((t) => t.nodeId === activeTab))
    ? activeTab
    : (terminalOutputs[0]?.nodeId ?? null)
  const current = terminalOutputs.find((t) => t.nodeId === currentId)

  const handleCopy = (t: TerminalOutput) => {
    if (!t.content) return
    navigator.clipboard.writeText(stripMarkdown(t.content))
    setCopiedId(t.nodeId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleDownload = (t: TerminalOutput) => {
    if (!t.content) return
    downloadDocx(t.content, t.label.toLowerCase().replace(/\s+/g, '-'))
  }

  return (
    <div
      className="relative flex h-full w-[320px] shrink-0 flex-col overflow-hidden border-l border-border bg-card"
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        {runStatus === 'completed'
          ? <Icons.CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : <Icons.XCircle className="h-4 w-4 text-red-500" />}
        <span className="text-sm font-medium">Run Output</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {terminalOutputs.length === 1
            ? '1 terminal node'
            : `${terminalOutputs.length} terminal nodes`}
        </span>
      </div>

      {terminalOutputs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <Icons.MonitorPlay className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium">No output</p>
          <p className="text-xs text-muted-foreground">
            No terminal nodes produced output in this run.
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar — only shown when 2 or more terminal nodes */}
          {terminalOutputs.length > 1 && (
            <div className="flex shrink-0 overflow-x-auto border-b border-border">
              {terminalOutputs.map((t) => (
                <button
                  key={t.nodeId}
                  onClick={() => setActiveTab(t.nodeId)}
                  className={cn(
                    'shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                    currentId === t.nodeId
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.status === 'failed'
                    ? <span className="flex items-center gap-1"><Icons.XCircle className="h-3 w-3 text-red-500" />{t.label}</span>
                    : t.label}
                </button>
              ))}
            </div>
          )}

          <ScrollArea className="min-h-0 flex-1">
            {current && (
              <div className="space-y-2 p-3">
                {/* Node label for single-node case */}
                {terminalOutputs.length === 1 && (
                  <div className="flex items-center gap-1.5">
                    {current.status === 'failed'
                      ? <Icons.XCircle className="h-3.5 w-3.5 text-red-500" />
                      : <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    <span className="text-xs font-medium text-muted-foreground">{current.label}</span>
                  </div>
                )}

                {/* Failed node: show error */}
                {current.status === 'failed' && current.error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-red-700">
                      <Icons.XCircle className="h-3.5 w-3.5 shrink-0" />
                      Node failed
                    </p>
                    <p className="break-words whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-red-800">
                      {current.error}
                    </p>
                  </div>
                ) : current.content ? (
                  /* Passed node with content */
                  <>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleCopy(current)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
                      >
                        {copiedId === current.nodeId
                          ? <Icons.Check className="h-3 w-3" />
                          : <Icons.Copy className="h-3 w-3" />}
                        {copiedId === current.nodeId ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => handleDownload(current)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Icons.Download className="h-3 w-3" />
                        .docx
                      </button>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <MarkdownContent
                        content={current.content}
                        className="text-xs leading-relaxed text-foreground prose-panel"
                      />
                    </div>
                  </>
                ) : (
                  /* Passed but no displayable text */
                  <div className="rounded-lg border border-dashed border-border p-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      No text output from this node.
                    </p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  )
}
