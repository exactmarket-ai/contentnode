import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowStore } from '@/store/workflowStore'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  id: string
  speaker: string | null
  speakerName: string | null
  stakeholderId: string | null
  startMs: number
  endMs: number
  text: string
}

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
}

interface SessionDetail {
  id: string
  title: string | null
  status: string
  segments: Segment[]
  stakeholders: Stakeholder[]
}

const FEEDBACK_CATEGORIES = [
  { value: 'pain_point',      label: 'Pain Point' },
  { value: 'desire',          label: 'Desire / Goal' },
  { value: 'objection',       label: 'Objection' },
  { value: 'insight',         label: 'Key Insight' },
  { value: 'action_item',     label: 'Action Item' },
  { value: 'source_material', label: 'Source Material' },
  { value: 'other',           label: 'Other' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function speakerColor(speaker: string | null, idx: number): string {
  const COLORS = ['text-blue-700', 'text-emerald-700', 'text-purple-700', 'text-amber-700', 'text-pink-700']
  if (!speaker) return 'text-muted-foreground'
  return COLORS[idx % COLORS.length]
}

// ─── Selection popover ────────────────────────────────────────────────────────

interface PopoverState {
  visible: boolean
  x: number
  y: number
  text: string
  segmentId: string
  stakeholderId: string | null
}

function SelectionPopover({
  state,
  sessionId,
  sourceNodes,
  onFeedbackCreated,
  onAddToSource,
  onDismiss,
}: {
  state: PopoverState
  sessionId: string
  sourceNodes: { id: string; label: string }[]
  onFeedbackCreated: (category: string) => void
  onAddToSource: (nodeId: string, text: string) => void
  onDismiss: () => void
}) {
  const [mode, setMode] = useState<'menu' | 'feedback' | 'source'>('menu')
  const [category, setCategory] = useState('pain_point')
  const [targetNodeId, setTargetNodeId] = useState(sourceNodes[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitFeedback = async () => {
    if (!state.stakeholderId) {
      setError('This speaker has no stakeholder assigned')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/transcriptions/${sessionId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          segmentId: state.segmentId,
          quoteText: state.text,
          category,
          stakeholderId: state.stakeholderId,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onFeedbackCreated(category)
      onDismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSubmitting(false)
    }
  }

  const submitSource = () => {
    if (!targetNodeId) return
    onAddToSource(targetNodeId, state.text)
    onDismiss()
  }

  return (
    <div
      className="fixed z-50 w-64 rounded-lg border border-border bg-card shadow-2xl"
      style={{ left: state.x, top: state.y - 8, transform: 'translateY(-100%)' }}
    >
      {/* Quote preview */}
      <div className="border-b border-border/40 px-3 py-2">
        <p className="line-clamp-2 text-[11px] italic text-muted-foreground">"{state.text}"</p>
      </div>

      {mode === 'menu' && (
        <div className="p-1.5 space-y-0.5">
          <button
            onClick={() => setMode('feedback')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
          >
            <Icons.MessageSquarePlus className="h-3.5 w-3.5 text-blue-600" />
            Mark as Feedback
          </button>
          {sourceNodes.length > 0 && (
            <button
              onClick={() => setMode('source')}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
            >
              <Icons.FileInput className="h-3.5 w-3.5 text-emerald-600" />
              Add to Source Material
            </button>
          )}
          <button
            onClick={onDismiss}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          >
            <Icons.X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}

      {mode === 'feedback' && (
        <div className="p-3 space-y-2">
          <button onClick={() => setMode('menu')} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Icons.ChevronLeft className="h-3 w-3" /> Back
          </button>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FEEDBACK_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <Button size="sm" className="w-full h-7 text-xs" onClick={submitFeedback} disabled={submitting}>
            {submitting ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : 'Save Feedback'}
          </Button>
        </div>
      )}

      {mode === 'source' && (
        <div className="p-3 space-y-2">
          <button onClick={() => setMode('menu')} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Icons.ChevronLeft className="h-3 w-3" /> Back
          </button>
          <Select value={targetNodeId} onValueChange={setTargetNodeId}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select source node…" /></SelectTrigger>
            <SelectContent>
              {sourceNodes.map((n) => (
                <SelectItem key={n.id} value={n.id} className="text-xs">{n.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="w-full h-7 text-xs" onClick={submitSource} disabled={!targetNodeId}>
            Add to Source
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function TranscriptViewer({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) {
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [savedQuotes, setSavedQuotes] = useState<string[]>([])

  // For "Add to Source" — get source nodes from the workflow
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const sourceNodes = nodes
    .filter((n) => n.type === 'source')
    .map((n) => ({ id: n.id, label: (n.data?.label as string) || n.id }))

  // Build speaker→index map for consistent color coding
  const speakerIndexMap = useRef<Map<string, number>>(new Map())

  const getSpeakerIndex = useCallback((speaker: string | null) => {
    if (!speaker) return 0
    if (!speakerIndexMap.current.has(speaker)) {
      speakerIndexMap.current.set(speaker, speakerIndexMap.current.size)
    }
    return speakerIndexMap.current.get(speaker)!
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(`/api/v1/transcriptions/${sessionId}`)
        if (!res.ok) throw new Error(`Failed to load transcript (${res.status})`)
        const json = await res.json()
        if (!cancelled) {
          setSession(json.data)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load')
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  const handleMouseUp = useCallback(
    (seg: Segment, e: React.MouseEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setPopover(null)
        return
      }
      const text = selection.toString().trim()
      if (text.length < 5) {
        setPopover(null)
        return
      }
      const rect = (e.target as HTMLElement).getBoundingClientRect()
      setPopover({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        text,
        segmentId: seg.id,
        stakeholderId: seg.stakeholderId,
      })
    },
    [],
  )

  const handleAddToSource = useCallback(
    (nodeId: string, text: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      const config = (node.data.config as Record<string, unknown>) ?? {}
      const existing = (config.pasted_text as string) ?? ''
      updateNodeData(nodeId, {
        config: {
          ...config,
          pasted_text: existing ? `${existing}\n\n${text}` : text,
        },
      })
    },
    [nodes, updateNodeData],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-background/80 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col border-r border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
            <Icons.FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Transcript</h2>
            <p className="text-xs text-muted-foreground">
              Select text to mark as feedback or add to source material
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {savedQuotes.length > 0 && (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
                {savedQuotes.length} quote{savedQuotes.length !== 1 ? 's' : ''} saved
              </span>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <Icons.X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1" onClick={() => setPopover(null)}>
          <div className="space-y-1 p-6">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {session && !loading && session.segments.map((seg) => {
              const speakerIdx = getSpeakerIndex(seg.speaker)
              const colorClass = speakerColor(seg.speaker, speakerIdx)
              const displayName = seg.speakerName ?? (seg.speaker ? `Speaker ${seg.speaker}` : 'Unknown')

              return (
                <div
                  key={seg.id}
                  className={cn(
                    'group flex gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/30',
                    savedQuotes.includes(seg.id) && 'bg-emerald-50/60',
                  )}
                >
                  {/* Timestamp */}
                  <div className="w-10 shrink-0 pt-0.5">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatMs(seg.startMs)}
                    </span>
                  </div>

                  {/* Speaker + text */}
                  <div className="flex-1 min-w-0">
                    <span className={cn('text-[11px] font-semibold mr-2', colorClass)}>
                      {displayName}
                    </span>
                    <span
                      className="select-text text-sm leading-relaxed text-foreground/90 cursor-text"
                      onMouseUp={(e) => {
                        e.stopPropagation()
                        handleMouseUp(seg, e)
                      }}
                    >
                      {seg.text}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3">
          <p className="text-[11px] text-muted-foreground">
            Select any text to mark it as feedback or add it to a source node in your workflow.
          </p>
        </div>
      </div>

      {/* Dim overlay */}
      <div className="flex-1 cursor-pointer" onClick={onClose} />

      {/* Selection popover */}
      {popover?.visible && (
        <SelectionPopover
          state={popover}
          sessionId={sessionId}
          sourceNodes={sourceNodes}
          onFeedbackCreated={(cat) => setSavedQuotes((prev) => [...prev, popover.segmentId])}
          onAddToSource={handleAddToSource}
          onDismiss={() => setPopover(null)}
        />
      )}
    </div>
  )
}
