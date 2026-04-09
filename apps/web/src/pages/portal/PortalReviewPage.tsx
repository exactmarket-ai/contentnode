import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { portalFetch } from './PortalPage'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Correction {
  id: string
  originalText: string
  suggestedText: string
  comment: string
}

interface DeliverableDetail {
  id: string
  workflowName: string
  status: string
  finalOutput: unknown
  nodeStatuses: Record<string, { output?: unknown; status?: string }>
  workflowNodes: Array<{ id: string; label: string; type: string }>
  priorFeedback: Array<{ id: string; decision: string | null; comment: string | null; createdAt: string }>
}

interface OutputTab { nodeId: string; label: string; content: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (typeof o.content === 'string') return o.content
    return JSON.stringify(o, null, 2)
  }
  return ''
}

function extractOutputs(d: DeliverableDetail): OutputTab[] {
  const nodeMap = Object.fromEntries((d.workflowNodes ?? []).map((n) => [n.id, n]))
  const tabs: OutputTab[] = Object.entries(d.nodeStatuses)
    .filter(([, s]) => s.status === 'passed' && s.output != null)
    .map(([nodeId, s]) => {
      const node = nodeMap[nodeId]
      if (!node || node.type !== 'output') return null
      const content = toText(s.output)
      if (!content.trim()) return null
      return { nodeId, label: node.label || 'Output', content }
    })
    .filter(Boolean) as OutputTab[]

  if (tabs.length > 0) return tabs

  const fallback = toText(d.finalOutput)
  if (fallback) return [{ nodeId: 'final', label: 'Output', content: fallback }]
  return []
}

// ─── Correction popover ───────────────────────────────────────────────────────

function CorrectionPopover({
  x, y, selectedText, onSubmit, onDismiss,
}: {
  x: number; y: number; selectedText: string
  onSubmit: (suggested: string, comment: string) => void
  onDismiss: () => void
}) {
  const [suggested, setSuggested] = useState('')
  const [comment, setComment]     = useState('')
  const ref        = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // Place above the selection if there's room, otherwise flip below
  const ESTIMATED_H = 260
  const MARGIN      = 8
  const initPos = {
    x: Math.max(MARGIN, Math.min(x, window.innerWidth - 328)),
    y: y - ESTIMATED_H >= MARGIN
      ? y - ESTIMATED_H
      : Math.min(y + 24, window.innerHeight - ESTIMATED_H - MARGIN),
  }
  const [pos, setPos] = useState(initPos)
  const posRef        = useRef(initPos)

  // Outside-click dismissal — skip while dragging
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (isDragging.current) return
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])

  const handleTitleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startMX = e.clientX
    const startMY = e.clientY
    const startEX = posRef.current.x
    const startEY = posRef.current.y
    isDragging.current = true

    const onMove = (ev: MouseEvent) => {
      const el = ref.current
      const w  = el ? el.offsetWidth  : 320
      const h  = el ? el.offsetHeight : 260
      const p  = {
        x: Math.max(8, Math.min(window.innerWidth  - w - 8, startEX + ev.clientX - startMX)),
        y: Math.max(8, Math.min(window.innerHeight - h - 8, startEY + ev.clientY - startMY)),
      }
      posRef.current = p
      setPos(p)
    }

    const onUp = () => {
      setTimeout(() => { isDragging.current = false }, 0)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 w-80 rounded-lg overflow-hidden shadow-2xl"
      style={{ left: pos.x, top: pos.y, border: '1px solid #a200ee' }}
    >
      {/* Title bar — drag handle */}
      <div
        style={{ background: '#a200ee', cursor: 'grab' }}
        className="flex items-center justify-between px-3 py-2 select-none"
        onMouseDown={handleTitleMouseDown}
      >
        <div className="flex items-center gap-2">
          <Icons.GripHorizontal style={{ color: 'rgba(255,255,255,0.7)', width: 14, height: 14 }} />
          <span style={{ color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
            Suggest a correction
          </span>
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onDismiss}
          style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', padding: 2, cursor: 'pointer', lineHeight: 0 }}
        >
          <Icons.X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Selected text preview */}
      <div style={{ background: '#faf8ff', borderBottom: '1px solid #e5e4e0', padding: '6px 12px' }}>
        <p style={{ fontSize: 11, fontStyle: 'italic', color: '#6b6a62', margin: 0 }} className="line-clamp-2">
          &ldquo;{selectedText}&rdquo;
        </p>
      </div>

      {/* Form */}
      <div style={{ background: '#fff', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Textarea autoFocus placeholder="Replace with…" className="min-h-[64px] resize-none text-xs"
          value={suggested} onChange={(e) => setSuggested(e.target.value)} />
        <Textarea placeholder="Optional comment…" className="min-h-[48px] resize-none text-xs"
          value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-7 text-xs" disabled={!suggested.trim()}
            onClick={() => onSubmit(suggested.trim(), comment.trim())}>
            Add Correction
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDismiss}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DECISIONS = [
  { value: 'approved',              label: 'Approved',              color: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { value: 'approved_with_changes', label: 'Approved with changes', color: 'border-blue-300 bg-blue-50 text-blue-700' },
  { value: 'needs_revision',        label: 'Needs revision',        color: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: 'rejected',              label: 'Rejected',              color: 'border-red-300 bg-red-50 text-red-700' },
]

const TONE_OPTIONS = [
  { value: 'too_formal',  label: 'Too formal' },
  { value: 'too_casual',  label: 'Too casual' },
  { value: 'just_right',  label: 'Just right' },
  { value: 'too_generic', label: 'Too generic' },
]

const CONTENT_TAGS = [
  { value: 'too_long',       label: 'Too long' },
  { value: 'too_short',      label: 'Too short' },
  { value: 'missing_points', label: 'Missing points' },
  { value: 'off_brief',      label: 'Off brief' },
  { value: 'good',           label: 'Good' },
]

export function PortalReviewPage() {
  const { runId } = useParams<{ runId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [deliverable, setDeliverable] = useState<DeliverableDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [corrections, setCorrections] = useState<Correction[]>([])
  const [popover, setPopover] = useState<{ x: number; y: number; text: string } | null>(null)
  const [decision, setDecision] = useState('approved_with_changes')
  const [starRating, setStarRating] = useState(0)
  const [toneFeedback, setToneFeedback] = useState('')
  const [contentTags, setContentTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    if (!runId || !token) return
    portalFetch(token, `/portal/deliverables/${runId}`)
      .then((r) => r.json())
      .then(({ data }) => { setDeliverable(data); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [runId, token])

  const outputs = deliverable ? extractOutputs(deliverable) : []

  const handleMouseUp = (e: React.MouseEvent) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString().trim()
    if (text.length < 3) return
    setPopover({ x: e.clientX, y: e.clientY, text })
  }

  const addCorrection = (suggested: string, cmt: string) => {
    if (!popover) return
    setCorrections((prev) => [...prev, {
      id: crypto.randomUUID(),
      originalText: popover.text,
      suggestedText: suggested,
      comment: cmt,
    }])
    setPopover(null)
    window.getSelection()?.removeAllRanges()
  }

  const toggleTag = (tag: string) =>
    setContentTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])

  const handleSubmit = async () => {
    if (!runId || !token) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await portalFetch(token, `/portal/deliverables/${runId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          starRating: starRating > 0 ? starRating : undefined,
          toneFeedback: toneFeedback || undefined,
          contentTags,
          comment: comment || undefined,
          specificChanges: corrections.map((c) => ({
            text: c.originalText,
            instruction: c.suggestedText,
          })),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSubmitted(true)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !deliverable) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-red-400">{error ?? 'Deliverable not found'}</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Icons.CheckCircle2 className="h-7 w-7" />
        </div>
        <div>
          <p className="text-base font-semibold">Thank you for your feedback</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {corrections.length > 0
              ? `${corrections.length} correction${corrections.length !== 1 ? 's' : ''} submitted.`
              : 'Your review has been received.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(`/portal?token=${token}`)}>
          <Icons.ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to deliverables
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
        <button onClick={() => navigate(`/portal?token=${token}`)} className="text-muted-foreground hover:text-foreground">
          <Icons.ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Icons.ClipboardEdit className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold">{deliverable.workflowName}</span>
        </div>
        <span className="text-xs text-muted-foreground">Select text to suggest a correction</span>
        <div className="ml-auto flex items-center gap-2">
          {corrections.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
              {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
            </span>
          )}
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="h-8 text-xs">
            {submitting
              ? <Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Icons.Send className="mr-1.5 h-3.5 w-3.5" />}
            Submit Feedback
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Content */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {outputs.length > 1 && (
            <div className="flex shrink-0 gap-1 border-b border-border bg-card px-6 pt-3">
              {outputs.map((tab, i) => (
                <button
                  key={tab.nodeId}
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    'rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors',
                    i === activeTab
                      ? 'border-border bg-background text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-3xl">
            {outputs.length > 0 ? (
              <div
                className="select-text cursor-text whitespace-pre-wrap rounded-xl border border-border bg-card p-8 text-sm leading-relaxed text-foreground/90"
                onMouseUp={handleMouseUp}
              >
                {outputs[activeTab]?.content ?? ''}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <Icons.FileX className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No content available for this deliverable.</p>
              </div>
            )}

            {/* Prior feedback notice */}
            {deliverable.priorFeedback.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-700">
                  You've previously submitted feedback on this deliverable ({deliverable.priorFeedback.length} time{deliverable.priorFeedback.length !== 1 ? 's' : ''}). You can submit again if it has been updated.
                </p>
              </div>
            )}
          </div>
          </div>
        </main>

        {/* Sidebar */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4">
          {/* Decision */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Your decision</p>
            <div className="space-y-1.5">
              {DECISIONS.map((d) => (
                <button key={d.value} onClick={() => setDecision(d.value)}
                  className={cn(
                    'w-full rounded-md border px-3 py-1.5 text-left text-xs font-medium transition-colors',
                    decision === d.value ? d.color : 'border-border text-muted-foreground hover:bg-accent/40',
                  )}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Star rating */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Rating</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} onClick={() => setStarRating(star === starRating ? 0 : star)}
                  className={cn('h-7 w-7 rounded transition-colors',
                    star <= starRating ? 'text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400/60')}>
                  <Icons.Star className={cn('h-5 w-5', star <= starRating && 'fill-current')} />
                </button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Tone</p>
            <div className="grid grid-cols-2 gap-1">
              {TONE_OPTIONS.map((t) => (
                <button key={t.value} onClick={() => setToneFeedback(toneFeedback === t.value ? '' : t.value)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs transition-colors',
                    toneFeedback === t.value
                      ? 'border-purple-400 bg-purple-50 text-purple-700'
                      : 'border-border text-muted-foreground hover:bg-accent/40',
                  )}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content tags */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Content tags</p>
            <div className="flex flex-wrap gap-1">
              {CONTENT_TAGS.map((t) => (
                <button key={t.value} onClick={() => toggleTag(t.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                    contentTags.includes(t.value)
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-border text-muted-foreground hover:bg-accent/40',
                  )}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Comment</p>
            <Textarea placeholder="Any additional feedback…" className="min-h-[80px] resize-none text-xs"
              value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>

          {/* Corrections */}
          {corrections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Corrections ({corrections.length})</p>
              <div className="space-y-2">
                {corrections.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-background p-2.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[11px] italic text-muted-foreground">"{c.originalText}"</p>
                      <button onClick={() => setCorrections((prev) => prev.filter((x) => x.id !== c.id))}
                        className="shrink-0 text-muted-foreground hover:text-destructive">
                        <Icons.X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-start gap-1">
                      <Icons.ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                      <p className="text-[11px] text-blue-700">{c.suggestedText}</p>
                    </div>
                    {c.comment && <p className="text-[11px] text-muted-foreground">{c.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {corrections.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <Icons.MousePointer className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
              <p className="text-[11px] text-muted-foreground">Select any text to suggest a correction.</p>
            </div>
          )}

          {submitError && (
            <p className="text-[11px] text-red-400 break-words">{submitError}</p>
          )}
        </aside>
      </div>

      {popover && (
        <CorrectionPopover
          x={popover.x} y={popover.y} selectedText={popover.text}
          onSubmit={addCorrection}
          onDismiss={() => setPopover(null)}
        />
      )}
    </div>
  )
}
