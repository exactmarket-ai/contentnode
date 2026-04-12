import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'
import { downloadDocx, downloadTxt, downloadDeliverableDocx } from '@/lib/downloadDocx'
import { DeliverableStatusStepper, type ReviewStatus } from '@/components/deliverables/DeliverableStatusStepper'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { SearchAndReplaceExtension, searchState, searchPluginKey, srSetSearch, srNext, srPrev } from '@/pages/writer/SearchAndReplace'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Correction {
  id: string
  originalText: string
  suggestedText: string
  comment: string
}

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
  seniority: string
  archivedAt: string | null
}

interface FeedbackRecord {
  id: string
  decision: string | null
  comment: string | null
  starRating: number | null
  outputDecisions: Record<string, { decision: string; comment?: string }>
  specificChanges: Array<{ text: string; instruction: string }>
  createdAt: string
  stakeholder: { id: string; name: string; role: string | null } | null
}

interface RunData {
  id: string
  status: string
  reviewStatus: string
  reviewerIds: string[]
  assigneeId: string | null
  internalNotes: string | null
  workflow: {
    id: string
    name: string
    projectName: string | null
    itemName: string | null
    nodes?: Array<{ id: string; label: string; type: string; config: Record<string, unknown> }>
    client: { id: string; name: string } | null
  } | null
  finalOutput: unknown
  nodeStatuses: Record<string, { output?: unknown; status?: string }>
  editedContent: Record<string, string> | null
  feedbacks: FeedbackRecord[]
}

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

interface OutputTab {
  nodeId: string
  label: string
  content: string
  originalContent: string
  subtype?: string
  assets?: { localPath: string }[]
}

function extractOutputs(run: RunData): OutputTab[] {
  const nodeMap = Object.fromEntries(
    (run.workflow?.nodes ?? []).map((n) => [n.id, n])
  )
  const edited = run.editedContent ?? {}
  const tabs: OutputTab[] = Object.entries(run.nodeStatuses)
    .filter(([, s]) => s.status === 'passed' && s.output != null)
    .map(([nodeId, s]) => {
      const node = nodeMap[nodeId]
      if (!node || node.type !== 'output') return null
      const subtype = (node.config?.subtype as string) ?? ''

      // Image / video nodes
      if (subtype === 'image-generation' || subtype === 'video-generation') {
        const out = s.output as Record<string, unknown> | undefined
        const assets = out?.assets as { localPath: string }[] | undefined
        if (!assets?.length) return null
        return { nodeId, label: node.label || 'Media', content: '', originalContent: '', subtype, assets }
      }

      // Text nodes
      const originalContent = toText(s.output)
      if (!originalContent.trim()) return null
      const content = edited[nodeId] ?? originalContent
      return { nodeId, label: node.label || 'Output', content, originalContent, subtype }
    })
    .filter(Boolean) as OutputTab[]

  if (tabs.length > 0) return tabs

  const fallback = toText(run.finalOutput)
  if (fallback) return [{ nodeId: 'final', label: 'Output', content: fallback, originalContent: fallback }]
  return []
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Decision badge ───────────────────────────────────────────────────────────

const DECISION_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  approved:              { label: 'Approved',              color: 'text-emerald-600', icon: Icons.CheckCircle2 },
  approved_with_changes: { label: 'Approved w/ changes',  color: 'text-blue-600',    icon: Icons.CheckCircle },
  needs_revision:        { label: 'Needs revision',        color: 'text-amber-600',   icon: Icons.RefreshCw },
  rejected:              { label: 'Rejected',              color: 'text-red-600',     icon: Icons.XCircle },
}

function DecisionBadge({ decision }: { decision: string }) {
  const cfg = DECISION_CONFIG[decision]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

// ─── Review status badge ──────────────────────────────────────────────────────

const REVIEW_STATUS: Record<string, { label: string; color: string }> = {
  none:             { label: 'Not reviewed',    color: 'text-slate-400' },
  pending:          { label: 'Agency reviewed', color: 'text-blue-600' },
  sent_to_client:   { label: 'Sent to client',  color: 'text-purple-600' },
  client_responded: { label: 'Client responded',color: 'text-emerald-600' },
  closed:           { label: 'Closed',          color: 'text-slate-500' },
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
      ? y - ESTIMATED_H          // enough room above — show above
      : Math.min(y + 24, window.innerHeight - ESTIMATED_H - MARGIN), // flip below
  }
  const [pos, setPos]   = useState(initPos)
  const posRef          = useRef(initPos)

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
      {/* ── Title bar ── drag handle ────────────────────────────────────── */}
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

      {/* ── Selected text preview ───────────────────────────────────────── */}
      <div style={{ background: '#faf8ff', borderBottom: '1px solid #e5e4e0', padding: '6px 12px' }}>
        <p style={{ fontSize: 11, fontStyle: 'italic', color: '#6b6a62', margin: 0 }} className="line-clamp-2">
          &ldquo;{selectedText}&rdquo;
        </p>
      </div>

      {/* ── Form ────────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Textarea
          autoFocus
          placeholder="Replace with…"
          className="min-h-[64px] resize-none text-xs"
          value={suggested}
          onChange={(e) => setSuggested(e.target.value)}
        />
        <Textarea
          placeholder="Optional comment…"
          className="min-h-[48px] resize-none text-xs"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
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

// ─── Send to contact dialog ───────────────────────────────────────────────────

interface AdHocContact { name: string; email: string }

function SendToContactDialog({
  runId, clientId, onClose, onSent,
}: {
  runId: string; clientId: string | null; onClose: () => void; onSent: (links: { name: string; email: string; portalUrl: string }[]) => void
}) {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [selected, setSelected]         = useState<Set<string>>(new Set())
  const [adHoc, setAdHoc]               = useState<AdHocContact[]>([])
  const [emailInput, setEmailInput]     = useState('')
  const [nameInput, setNameInput]       = useState('')
  const [emailError, setEmailError]     = useState<string | null>(null)
  const [sending, setSending]           = useState(false)
  const [links, setLinks]               = useState<{ name: string; email: string; portalUrl: string; isNew?: boolean }[] | null>(null)
  const [copied, setCopied]             = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    apiFetch(`/api/v1/clients/${clientId}/stakeholders`)
      .then((r) => r.json())
      .then(({ data }) => setStakeholders((data ?? []).filter((s: Stakeholder) => !s.archivedAt)))
      .catch(() => {})
  }, [clientId])

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const addAdHoc = () => {
    const email = emailInput.trim().toLowerCase()
    const name  = nameInput.trim()
    if (!email) { setEmailError('Email is required'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError('Enter a valid email address'); return }
    if (adHoc.some((c) => c.email === email) || stakeholders.some((s) => s.email.toLowerCase() === email && selected.has(s.id))) {
      setEmailError('Already added'); return
    }
    setAdHoc((prev) => [...prev, { name: name || email, email }])
    setEmailInput('')
    setNameInput('')
    setEmailError(null)
  }

  const removeAdHoc = (email: string) => setAdHoc((prev) => prev.filter((c) => c.email !== email))

  const totalRecipients = selected.size + adHoc.length

  const handleSend = async () => {
    if (totalRecipients === 0) return
    setSending(true)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}/send-review`, {
        method: 'POST',
        body: JSON.stringify({
          stakeholderIds: Array.from(selected),
          newContacts: adHoc,
        }),
      })
      const { data } = await res.json()
      setLinks(data.links)
      onSent(data.links)
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icons.Send className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-semibold">Send to contact</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {links ? (
          <div className="space-y-2 p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Portal links sent. You can also copy and share these directly:
            </p>
            {links.map((l) => (
              <div key={l.email} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium">{l.name}</p>
                        {l.isNew && (
                          <span className="rounded-full bg-purple-50 border border-purple-200 px-1.5 py-px text-[9px] font-semibold text-purple-600">
                            new contact
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{l.email}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                    onClick={() => copyLink(l.portalUrl)}>
                    {copied === l.portalUrl
                      ? <><Icons.Check className="h-3 w-3 text-emerald-600" /> Copied</>
                      : <><Icons.Copy className="h-3 w-3" /> Copy</>
                    }
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/60 font-mono truncate">{l.portalUrl}</p>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground pt-1">
              Access can be revoked anytime from the Access tab on the client page.
            </p>
            <Button className="w-full mt-1 h-8 text-xs" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            {/* Email input — always shown first */}
            <div className="p-4 border-b border-border/40 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Send to any email address</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-[140px] shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAdHoc() } }}
                  className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
                <button
                  onClick={addAdHoc}
                  className="shrink-0 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 transition-colors"
                >
                  Add
                </button>
              </div>
              {emailError && <p className="text-[11px] text-red-500">{emailError}</p>}

              {/* Ad-hoc chips */}
              {adHoc.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {adHoc.map((c) => (
                    <span key={c.email} className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-1 text-[11px] font-medium text-purple-700">
                      {c.name !== c.email ? `${c.name} <${c.email}>` : c.email}
                      <button onClick={() => removeAdHoc(c.email)} className="ml-0.5 text-purple-400 hover:text-purple-700">
                        <Icons.X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Existing contacts */}
            {stakeholders.length > 0 && (
              <div className="max-h-52 overflow-y-auto p-4 space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">Or select existing contacts</p>
                {stakeholders.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleSelect(s.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      selected.has(s.id) ? 'border-purple-500 bg-purple-50' : 'border-border hover:bg-accent/30',
                    )}
                  >
                    <div className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                      selected.has(s.id) ? 'border-purple-500 bg-purple-500' : 'border-border',
                    )}>
                      {selected.has(s.id) && <Icons.Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{s.email}{s.role ? ` · ${s.role}` : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2 border-t border-border/40 p-4">
              <Button variant="ghost" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1 h-8 text-xs gap-1.5"
                disabled={totalRecipients === 0 || sending}
                onClick={handleSend}
              >
                {sending ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Send className="h-3.5 w-3.5" />}
                Send{totalRecipients > 0 ? ` to ${totalRecipients}` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Per-output decision picker ───────────────────────────────────────────────

const OUTPUT_DECISIONS = [
  { value: 'approved',              label: 'Approve',         icon: Icons.ThumbsUp,   color: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
  { value: 'approved_with_changes', label: 'With changes',    icon: Icons.CheckCircle, color: 'border-blue-500 bg-blue-50 text-blue-700' },
  { value: 'needs_revision',        label: 'Needs revision',  icon: Icons.RefreshCw,  color: 'border-amber-500 bg-amber-50 text-amber-700' },
  { value: 'rejected',              label: 'Reject',          icon: Icons.ThumbsDown, color: 'border-red-500 bg-red-50 text-red-700' },
]

function OutputDecisionPicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {OUTPUT_DECISIONS.map((d) => {
        const Icon = d.icon
        const active = value === d.value
        return (
          <button
            key={d.value}
            onClick={() => onChange(active ? '' : d.value)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
              active ? d.color : 'border-border text-muted-foreground hover:bg-accent/40',
            )}
          >
            <Icon className="h-3 w-3" />
            {d.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── TipTap helpers ───────────────────────────────────────────────────────────

function htmlToPlain(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim()
}

function plainToHtml(text: string) {
  return '<p>' + text.split(/\n\n+/).map((p) => p.replace(/\n/g, '<br>')).join('</p><p>') + '</p>'
}

const EDITOR_STYLES = `
  .review-tiptap { flex:1; min-height:60vh; background:#fff; color:inherit;
    border:1px solid hsl(var(--border)); border-radius:0.75rem;
    padding:2rem 2rem; font-size:0.875rem; line-height:1.75;
    font-family:inherit; outline:none; }
  .review-tiptap:focus-within { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,0.2); }
  .review-tiptap p { margin:0 0 0.75em; }
  .review-tiptap h1 { font-size:1.6em; font-weight:700; margin:0 0 0.5em; }
  .review-tiptap h2 { font-size:1.3em; font-weight:700; margin:0 0 0.5em; }
  .review-tiptap h3 { font-size:1.1em; font-weight:600; margin:0 0 0.5em; }
  .review-tiptap ul { margin:0 0 0.75em; padding-left:1.5em; list-style:disc; }
  .review-tiptap ol { margin:0 0 0.75em; padding-left:1.5em; list-style:decimal; }
  .review-tiptap li { margin-bottom:0.25em; }
  .review-tiptap blockquote { border-left:3px solid hsl(var(--border)); margin:0 0 0.75em; padding-left:1em; color:#666; font-style:italic; }
  .review-tiptap strong { font-weight:700; }
  .review-tiptap em { font-style:italic; }
  .review-tiptap u { text-decoration:underline; }
  .review-tiptap p.is-editor-empty:first-child::before { content:attr(data-placeholder); color:#aaa; pointer-events:none; float:left; height:0; }
`

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReviewPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()

  const [run, setRun] = useState<RunData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-output decisions: nodeId → decision string
  const [tabDecisions, setTabDecisions] = useState<Record<string, string>>({})

  // Corrections
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [popover, setPopover] = useState<{ x: number; y: number; text: string } | null>(null)

  // Overall review fields
  const [overallComment, setOverallComment] = useState('')
  const [starRating, setStarRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Active tab
  const [activeTab, setActiveTab] = useState(0)

  // Internal notes
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  // TipTap editor — always active for text outputs
  const [savingEdit, setSavingEdit] = useState(false)
  const [savedEditAt, setSavedEditAt] = useState<number | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const [replaceVal, setReplaceVal] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Floating selection menu — shown when editor has a non-empty selection
  const [selMenu, setSelMenu] = useState<{ text: string; x: number; y: number } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: 'Click to start editing…' }),
      SearchAndReplaceExtension,
    ],
    content: '',
    editorProps: { attributes: { class: 'review-tiptap' } },
  })

  // Send to contact dialog
  const [showSendDialog, setShowSendDialog] = useState(false)
  const [reviewStatus, setReviewStatus] = useState('none')
  const [stakeholderMap, setStakeholderMap] = useState<Record<string, { name: string; email: string }>>({})

  useEffect(() => {
    if (!runId) return
    apiFetch(`/api/v1/runs/${runId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRun(data)
        setReviewStatus(data.reviewStatus ?? 'none')
        setNotes(data.internalNotes ?? '')
        setLoading(false)
        // Load stakeholder names if client is known
        if (data.workflow?.client?.id) {
          apiFetch(`/api/v1/clients/${data.workflow.client.id}/stakeholders`)
            .then((r) => r.json())
            .then(({ data: shs }) => {
              const map: Record<string, { name: string; email: string }> = {}
              for (const s of (shs ?? [])) map[s.id] = { name: s.name, email: s.email }
              setStakeholderMap(map)
            })
            .catch(() => {})
        }
      })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [runId])

  const outputs = run ? extractOutputs(run) : []

  // Show/hide the selection bubble menu
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { empty, from, to } = editor.state.selection
      if (empty) { setSelMenu(null); return }
      const text = editor.state.doc.textBetween(from, to, ' ').trim()
      if (text.length < 3) { setSelMenu(null); return }
      // Position above the selection start
      const coords = editor.view.coordsAtPos(from)
      setSelMenu({ text, x: coords.left, y: coords.top })
    }
    editor.on('selectionUpdate', update)
    editor.on('blur', () => setSelMenu(null))
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', () => setSelMenu(null))
    }
  }, [editor])

  // Populate editor whenever the active tab or loaded run changes
  useEffect(() => {
    if (!editor || !run) return
    const tab = extractOutputs(run)[activeTab]
    if (!tab || tab.assets) return // skip media tabs
    editor.commands.setContent(plainToHtml(tab.content))
  }, [editor, activeTab, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const addCorrection = (suggested: string, comment: string) => {
    if (!popover) return
    setCorrections((prev) => [...prev, {
      id: crypto.randomUUID(),
      originalText: popover.text,
      suggestedText: suggested,
      comment,
    }])
    setPopover(null)
    window.getSelection()?.removeAllRanges()
    setSelMenu(null)
  }

  const removeCorrection = (id: string) =>
    setCorrections((prev) => prev.filter((c) => c.id !== id))

  // Derive overall decision from per-output decisions
  const decisions = Object.values(tabDecisions).filter(Boolean)
  const overallDecision = (() => {
    if (decisions.length === 0) return undefined
    if (decisions.every((d) => d === 'approved')) return 'approved'
    if (decisions.some((d) => d === 'rejected')) return 'rejected'
    if (decisions.some((d) => d === 'needs_revision')) return 'needs_revision'
    return 'approved_with_changes'
  })()

  const handleSubmit = async () => {
    if (!runId) return
    setSubmitting(true)
    try {
      await apiFetch('/api/v1/feedback', {
        method: 'POST',
        body: JSON.stringify({
          workflowRunId: runId,
          decision: overallDecision,
          comment: overallComment || undefined,
          starRating: starRating > 0 ? starRating : undefined,
          outputDecisions: tabDecisions,
          specificChanges: corrections.map((c) => ({
            text: c.originalText,
            instruction: `Replace with: ${c.suggestedText}${c.comment ? ` (${c.comment})` : ''}`,
          })),
        }),
      })
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSent = (links: { name: string; email: string; portalUrl: string }[]) => {
    setReviewStatus('sent_to_client')
    // Re-fetch to update reviewerIds display
    if (runId) {
      apiFetch(`/api/v1/runs/${runId}`)
        .then((r) => r.json())
        .then(({ data }) => setRun(data))
        .catch(() => {})
    }
    void links
  }

  const [updatingStatus, setUpdatingStatus] = useState(false)
  const handleReviewStatusChange = async (status: ReviewStatus) => {
    if (!runId) return
    setUpdatingStatus(true)
    setReviewStatus(status)
    try {
      await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: status }),
      })
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!runId) return
    setSavingNotes(true)
    try {
      await apiFetch(`/api/v1/runs/${runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: notes }),
      })
      setRun((prev) => prev ? { ...prev, internalNotes: notes } : prev)
    } finally {
      setSavingNotes(false)
    }
  }

  const editorDispatch = useCallback((meta: unknown) => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, meta))
    setMatchCount(searchState.results.length)
    setMatchIndex(searchState.currentIndex)
    const match = searchState.results[searchState.currentIndex]
    if (match) {
      editor.commands.setTextSelection({ from: match.from, to: match.to })
      editor.commands.scrollIntoView()
    }
  }, [editor])

  const handleSearchChange = (val: string) => { setSearchVal(val); srSetSearch(val, editorDispatch) }
  const handleFindNext = () => srNext(editorDispatch)
  const handleFindPrev = () => srPrev(editorDispatch)
  const handleReplaceCurrent = () => {
    if (!editor || !searchState.results.length) return
    const match = searchState.results[searchState.currentIndex]
    if (!match) return
    editor.chain().setTextSelection({ from: match.from, to: match.to }).insertContent(searchState.replaceTerm).run()
    editorDispatch({ replaced: true })
  }
  const handleReplaceAll = () => {
    if (!editor || !searchState.searchTerm || !searchState.results.length) return
    const sorted = [...searchState.results].sort((a, b) => b.from - a.from)
    let tr = editor.state.tr
    for (const m of sorted) {
      if (searchState.replaceTerm) tr = tr.replaceWith(m.from, m.to, editor.state.schema.text(searchState.replaceTerm))
      else tr = tr.delete(m.from, m.to)
    }
    editor.view.dispatch(tr)
    searchState.results = []; searchState.currentIndex = 0
    setMatchCount(0); setMatchIndex(0)
  }

  const handleSaveEdit = async () => {
    if (!runId || !editor) return
    const tab = outputs[activeTab]
    if (!tab) return
    setSavingEdit(true)
    const plain = htmlToPlain(editor.getHTML())
    try {
      await apiFetch(`/api/v1/runs/${runId}/edited-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: tab.nodeId, content: plain }),
      })
      setRun((prev) => {
        if (!prev) return prev
        const existing = (prev.editedContent ?? {}) as Record<string, string>
        return { ...prev, editedContent: { ...existing, [tab.nodeId]: plain } }
      })
      setSavedEditAt(Date.now())
      setShowSearch(false)
    } finally {
      setSavingEdit(false)
    }
  }

  // Review title
  const reviewTitle = run ? [
    run.workflow?.client?.name,
    run.workflow?.projectName,
    run.workflow?.name,
    run.workflow?.itemName,
  ].filter(Boolean).join(' — ') : 'Review'

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-red-400">{error ?? 'Run not found'}</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Icons.CheckCircle2 className="h-7 w-7" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold">Review submitted</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {corrections.length > 0
              ? `${corrections.length} correction${corrections.length !== 1 ? 's' : ''} logged.`
              : 'Your feedback has been recorded.'}
          </p>
          {run.workflow?.client && (
            <Button variant="outline" size="sm" className="mt-4 gap-1.5"
              onClick={() => setShowSendDialog(true)}>
              <Icons.Send className="h-3.5 w-3.5" />
              Send to client contact
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <Icons.ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back
        </Button>
        {showSendDialog && run.workflow?.client && (
          <SendToContactDialog
            runId={run.id}
            clientId={run.workflow.client.id}
            onClose={() => setShowSendDialog(false)}
            onSent={handleSent}
          />
        )}
      </div>
    )
  }

  const rsConfig = REVIEW_STATUS[reviewStatus] ?? REVIEW_STATUS.none

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <Icons.ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Icons.ClipboardEdit className="h-4 w-4 shrink-0 text-purple-600" />
          <span className="text-sm font-semibold truncate">{reviewTitle}</span>
        </div>
        <span className={cn('text-[11px] font-medium', rsConfig.color)}>· {rsConfig.label}</span>
        <span className="text-xs text-muted-foreground hidden lg:block">Select text to suggest a correction</span>
        <div className="ml-auto flex items-center gap-2">
          {run.workflow?.client && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => setShowSendDialog(true)}>
              <Icons.Send className="h-3.5 w-3.5" />
              Send to contact
            </Button>
          )}
          {corrections.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
              {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
            </span>
          )}
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="h-8 text-xs">
            {submitting
              ? <Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Icons.Send className="mr-1.5 h-3.5 w-3.5" />
            }
            Submit Review
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Content pane */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          {outputs.length > 1 && (
            <div className="flex shrink-0 gap-1 border-b border-border bg-card px-6 pt-3">
              {outputs.map((tab, i) => (
                <button
                  key={tab.nodeId}
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors',
                    i === activeTab
                      ? 'border-border bg-background text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                  {tabDecisions[tab.nodeId] && (
                    <span className={cn('h-1.5 w-1.5 rounded-full',
                      tabDecisions[tab.nodeId] === 'approved' ? 'bg-emerald-400' :
                      tabDecisions[tab.nodeId] === 'rejected' ? 'bg-red-400' :
                      tabDecisions[tab.nodeId] === 'needs_revision' ? 'bg-amber-400' : 'bg-blue-400'
                    )} />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Per-output decision row */}
          {outputs.length > 0 && (
            <div className="shrink-0 border-b border-border/40 bg-card/50 px-8 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-medium">
                Decision for <span className="text-foreground">{outputs[activeTab]?.label}</span>:
              </span>
              <OutputDecisionPicker
                value={tabDecisions[outputs[activeTab]?.nodeId ?? '']}
                onChange={(v) => {
                  const nodeId = outputs[activeTab]?.nodeId
                  if (!nodeId) return
                  setTabDecisions((prev) => ({ ...prev, [nodeId]: v }))
                }}
              />
              <div className="ml-auto flex items-center gap-1.5">
                {/* Save edits — always visible for text outputs */}
                {!outputs[activeTab]?.assets && (
                  <>
                    {outputs[activeTab]?.content !== outputs[activeTab]?.originalContent && (
                      <span className="text-[10px] text-blue-600 font-medium flex items-center gap-0.5">
                        <Icons.PenLine className="h-2.5 w-2.5" />Edited
                      </span>
                    )}
                    {savedEditAt && (
                      <span className="text-[10px] text-emerald-600 font-medium">Saved</span>
                    )}
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-60"
                    >
                      {savingEdit
                        ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                        : <Icons.Check className="h-3 w-3" />
                      }
                      Save edits
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    const tab = outputs[activeTab]
                    if (tab?.content) downloadDocx(tab.content, tab.label || 'output')
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-border/60 hover:text-foreground transition-colors"
                >
                  <Icons.FileDown className="h-3 w-3" />
                  .docx
                </button>
                <button
                  onClick={() => {
                    const tab = outputs[activeTab]
                    if (tab?.content) downloadTxt(tab.content, tab.label || 'output')
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-border/60 hover:text-foreground transition-colors"
                >
                  <Icons.FileText className="h-3 w-3" />
                  .txt
                </button>
                {outputs.length > 1 && (
                  <button
                    onClick={async () => {
                      const title = run.workflow?.projectName ?? run.workflow?.name ?? 'deliverable'
                      await downloadDeliverableDocx(outputs, title)
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                  >
                    <Icons.Download className="h-3 w-3" />
                    All outputs
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Formatting toolbar — always visible for text outputs */}
          {!outputs[activeTab]?.assets && editor && (
            <>
              <div className="shrink-0 flex items-center gap-0.5 border-b border-border bg-card px-4 py-1.5 flex-wrap">
                {/* Headings */}
                {(['H1','H2','H3'] as const).map((h, i) => (
                  <button key={h} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: (i+1) as 1|2|3 }).run() }}
                    className={cn('px-2 py-1 text-xs rounded font-semibold transition-colors', editor.isActive('heading', { level: i+1 }) ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>{h}</button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" />
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}
                  className={cn('px-2 py-1 text-xs rounded font-bold transition-colors', editor.isActive('bold') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>B</button>
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}
                  className={cn('px-2 py-1 text-xs rounded italic transition-colors', editor.isActive('italic') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>I</button>
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}
                  className={cn('px-2 py-1 text-xs rounded underline transition-colors', editor.isActive('underline') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>U</button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }}
                  className={cn('px-2 py-1 text-xs rounded transition-colors', editor.isActive('bulletList') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>• List</button>
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }}
                  className={cn('px-2 py-1 text-xs rounded transition-colors', editor.isActive('orderedList') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>1. List</button>
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run() }}
                  className={cn('px-2 py-1 text-xs rounded transition-colors', editor.isActive('blockquote') ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}>" Quote</button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().undo().run() }}
                  className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent/60 transition-colors">↩ Undo</button>
                <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().redo().run() }}
                  className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent/60 transition-colors">↪ Redo</button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  onMouseDown={(e) => { e.preventDefault(); setShowSearch((v) => { if (!v) setTimeout(() => searchInputRef.current?.focus(), 50); return !v }) }}
                  className={cn('flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors', showSearch ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}
                  title="Find & Replace (⌘H)"
                >
                  <Icons.Search className="h-3 w-3" />
                  Find &amp; Replace
                </button>
              </div>

              {/* Search & Replace panel */}
              {showSearch && (
                <div className="shrink-0 flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <input ref={searchInputRef} value={searchVal} onChange={(e) => handleSearchChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleFindNext() }}
                      placeholder="Find…" className="h-7 w-40 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <span className="text-[10px] text-muted-foreground w-14">
                      {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : searchVal ? '0 results' : ''}
                    </span>
                    <button onMouseDown={(e) => { e.preventDefault(); handleFindPrev() }} className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">↑</button>
                    <button onMouseDown={(e) => { e.preventDefault(); handleFindNext() }} className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent">↓</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input value={replaceVal} onChange={(e) => { setReplaceVal(e.target.value); searchState.replaceTerm = e.target.value }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleReplaceCurrent() }}
                      placeholder="Replace with…" className="h-7 w-40 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button onMouseDown={(e) => { e.preventDefault(); handleReplaceCurrent() }} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">Replace</button>
                    <button onMouseDown={(e) => { e.preventDefault(); handleReplaceAll() }} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">All</button>
                  </div>
                  <button onMouseDown={(e) => { e.preventDefault(); setShowSearch(false); handleSearchChange('') }} className="ml-auto text-muted-foreground hover:text-foreground text-base leading-none">×</button>
                </div>
              )}
            </>
          )}

          <div className="flex-1 overflow-y-auto px-8 py-8">
            <style>{EDITOR_STYLES}</style>
            <div className="mx-auto max-w-3xl">
              {outputs.length > 0 ? (() => {
                const tab = outputs[activeTab]
                if (!tab) return null

                // ── Image output ──────────────────────────────────────────────
                if (tab.subtype === 'image-generation' && tab.assets?.length) {
                  return (
                    <div className="space-y-4">
                      <div className={cn('grid gap-3', tab.assets.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                        {tab.assets.map((a, i) => (
                          <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-card">
                            <img src={assetUrl(a.localPath)} alt={`${tab.label} ${i + 1}`} className="w-full object-cover" />
                            <a href={assetUrl(a.localPath)} download className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                              <Icons.Download className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ))}
                      </div>
                      <p className="text-center text-xs text-muted-foreground">{tab.assets.length} image{tab.assets.length !== 1 ? 's' : ''}</p>
                    </div>
                  )
                }

                // ── Video output ──────────────────────────────────────────────
                if (tab.subtype === 'video-generation' && tab.assets?.length) {
                  return (
                    <div className="space-y-3">
                      {tab.assets.map((a, i) => (
                        <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-black">
                          <video src={assetUrl(a.localPath)} controls className="w-full" style={{ maxHeight: '70vh' }} />
                          <a href={assetUrl(a.localPath)} download className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            <Icons.Download className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )
                }

                // ── Text output — TipTap editor (always on) ───────────────
                return <EditorContent editor={editor} />
              })() : (
                <div className="flex flex-col items-center gap-3 py-20 text-center">
                  <Icons.FileX className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No content output found for this run.</p>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Sidebar */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4">
          {/* Pipeline status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Pipeline stage</p>
              {updatingStatus && <Icons.Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-3">
              <DeliverableStatusStepper
                status={reviewStatus as ReviewStatus}
                onChange={handleReviewStatusChange}
              />
            </div>
          </div>

          {/* Output decisions summary */}
          {outputs.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Output decisions</p>
              <div className="space-y-1">
                {outputs.map((tab) => (
                  <div key={tab.nodeId} className="flex items-center justify-between">
                    <p className="text-xs text-foreground/80 truncate">{tab.label}</p>
                    {tabDecisions[tab.nodeId]
                      ? <DecisionBadge decision={tabDecisions[tab.nodeId]} />
                      : <span className="text-[11px] text-muted-foreground/50">pending</span>
                    }
                  </div>
                ))}
              </div>
              {overallDecision && (
                <div className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Overall</span>
                  <DecisionBadge decision={overallDecision} />
                </div>
              )}
            </div>
          )}

          {/* Internal notes — feeds brain/pattern detector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Icons.StickyNote className="h-3 w-3" />
                Internal notes
              </p>
              {savingNotes && <Icons.Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <Textarea
              placeholder="Notes for the team — what changed and why…"
              className="min-h-[64px] resize-none text-xs border-amber-200 focus:border-amber-400"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleSaveNotes}
            />
            <p className="text-[10px] text-muted-foreground/60">Saved automatically. Feeds content improvement.</p>
          </div>

          {/* Star rating */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Rating</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setStarRating(star === starRating ? 0 : star)}
                  className={cn(
                    'h-7 w-7 rounded transition-colors',
                    star <= starRating ? 'text-amber-600' : 'text-muted-foreground/40 hover:text-amber-600/60',
                  )}
                >
                  <Icons.Star className={cn('h-5 w-5', star <= starRating && 'fill-current')} />
                </button>
              ))}
            </div>
          </div>

          {/* Overall comment */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Overall comment</p>
            <Textarea
              placeholder="General feedback…"
              className="min-h-[72px] resize-none text-xs"
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
            />
          </div>

          {/* Corrections list */}
          {corrections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Corrections ({corrections.length})</p>
              <div className="space-y-2">
                {corrections.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-background p-2.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[11px] italic text-muted-foreground">"{c.originalText}"</p>
                      <button onClick={() => removeCorrection(c.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <Icons.X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-start gap-1">
                      <Icons.ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />
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
              <p className="text-[11px] text-muted-foreground">Select any text in the content to suggest a correction.</p>
            </div>
          )}

          {/* Reviewers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Reviewers</p>
              {run.workflow?.client && (
                <button
                  onClick={() => setShowSendDialog(true)}
                  className="text-[11px] text-purple-600 hover:text-purple-700 flex items-center gap-1"
                >
                  <Icons.Send className="h-2.5 w-2.5" />
                  Send to contact
                </button>
              )}
            </div>
            {(run.reviewerIds ?? []).length > 0 ? (
              <div className="space-y-1">
                {(run.reviewerIds as string[]).map((rid) => {
                  const s = stakeholderMap[rid]
                  return (
                    <div key={rid} className="flex items-center gap-1.5 group">
                      <Icons.User className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[11px] text-foreground/80">{s?.name ?? rid.slice(0, 8) + '…'}</span>
                        {s?.email && <span className="text-[10px] text-muted-foreground/50 ml-1">{s.email}</span>}
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                        title="Remove reviewer"
                        onClick={async () => {
                          const next = (run.reviewerIds as string[]).filter((id) => id !== rid)
                          await apiFetch(`/api/v1/runs/${run.id}/review-meta`, {
                            method: 'PATCH',
                            body: JSON.stringify({ reviewerIds: next }),
                          })
                          setRun((prev) => prev ? { ...prev, reviewerIds: next } : prev)
                        }}
                      >
                        <Icons.X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/50">No contacts assigned yet.</p>
            )}
          </div>

          {/* Review history */}
          {run.feedbacks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Review history ({run.feedbacks.length})</p>
              <div className="space-y-2">
                {run.feedbacks.map((fb) => (
                  <div key={fb.id} className="rounded-lg border border-border bg-background p-2.5 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-medium">
                          {fb.stakeholder?.name ?? 'Agency review'}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatDate(fb.createdAt)}</p>
                      </div>
                      {fb.decision && <DecisionBadge decision={fb.decision} />}
                    </div>
                    {fb.comment && (
                      <p className="text-[11px] text-foreground/70 line-clamp-2">{fb.comment}</p>
                    )}
                    {fb.starRating && (
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map((s) => (
                          <Icons.Star key={s} className={cn('h-3 w-3', s <= fb.starRating! ? 'text-amber-600 fill-current' : 'text-muted-foreground/30')} />
                        ))}
                      </div>
                    )}
                    {Object.entries(fb.outputDecisions ?? {}).length > 0 && (
                      <div className="space-y-0.5 border-t border-border/30 pt-1">
                        {Object.entries(fb.outputDecisions).map(([nid, od]) => (
                          <div key={nid} className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground truncate">{nid}</span>
                            <DecisionBadge decision={od.decision} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Selection bubble menu — appears above selected text in editor */}
      {selMenu && !popover && (
        <div
          className="fixed z-50 flex items-center overflow-hidden rounded-lg border border-border bg-white shadow-xl"
          style={{ left: selMenu.x, top: selMenu.y - 48 }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              setPopover({ x: selMenu.x, y: selMenu.y, text: selMenu.text })
              setSelMenu(null)
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-blue-50 hover:text-blue-700 transition-colors"
          >
            <Icons.MessageSquarePlus className="h-3.5 w-3.5" />
            Suggest change
          </button>
          <div className="w-px h-6 bg-border shrink-0" />
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              setSelMenu(null)
              editor?.commands.focus()
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Icons.PenLine className="h-3.5 w-3.5" />
            Edit directly
          </button>
        </div>
      )}

      {/* Correction popover */}
      {popover && (
        <CorrectionPopover
          x={popover.x}
          y={popover.y}
          selectedText={popover.text}
          onSubmit={addCorrection}
          onDismiss={() => setPopover(null)}
        />
      )}

      {/* Send to contact dialog */}
      {showSendDialog && run.workflow?.client && (
        <SendToContactDialog
          runId={run.id}
          clientId={run.workflow.client.id}
          onClose={() => setShowSendDialog(false)}
          onSent={(links) => {
            handleSent(links)
            setShowSendDialog(false)
          }}
        />
      )}
    </div>
  )
}
