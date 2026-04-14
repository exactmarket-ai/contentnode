import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { CampaignCreationModal } from '@/components/modals/CampaignCreationModal'

// ─── Markdown renderer ───────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
      : part
  )
}

function BriefMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let listItems: string[] = []

  function flushList() {
    if (listItems.length === 0) return
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="space-y-0.5 my-1.5 ml-1">
        {listItems.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/60 shrink-0" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('### ')) {
      flushList()
      nodes.push(<h4 key={i} className="text-[11px] font-semibold text-foreground mt-3 mb-0.5">{line.slice(4)}</h4>)
    } else if (line.startsWith('## ')) {
      flushList()
      nodes.push(<h3 key={i} className="text-xs font-semibold text-foreground mt-3 mb-1 border-b border-border/40 pb-0.5">{line.slice(3)}</h3>)
    } else if (line.match(/^[-*] /)) {
      listItems.push(line.slice(2))
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      nodes.push(<p key={i} className="text-[11px] leading-relaxed">{renderInline(line)}</p>)
    }
  }
  flushList()

  return <div className={cn('space-y-0.5', className)}>{nodes}</div>
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowSummary {
  id: string
  name: string
  status: string
  connectivityMode: string
  description?: string | null
  _count: { runs: number }
}

interface CampaignWorkflowEntry {
  id: string
  campaignId: string
  workflowId: string
  order: number
  role: string | null
  workflow: WorkflowSummary
  latestRun?: {
    id: string
    status: string
    startedAt: string | null
    completedAt: string | null
    campaignId: string | null
    errorMessage: string | null
  } | null
}

interface Campaign {
  id: string
  name: string
  goal: string
  status: string
  brief: string | null
  briefOriginal: string | null
  briefEditedBy: string | null
  briefEditedAt: string | null
  context: string | null
  startDate: string | null
  endDate: string | null
  createdAt: string
  client: { id: string; name: string }
  workflows: CampaignWorkflowEntry[]
  _count: { runs: number }
}

interface BrainAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sourceUrl: string | null
  extractionStatus: string
  summaryStatus: string
  summary: string | null
  createdAt: string
}

interface BundleAsset {
  workflow: { id: string; name: string; role: string | null; order: number }
  runId: string | null
  completedAt: string | null
  output: string | null
  hasOutput: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GOAL_CONFIG: Record<string, { label: string; icon: keyof typeof Icons; color: string }> = {
  lead_gen:   { label: 'Lead Generation',   icon: 'Target',    color: 'text-emerald-400' },
  nurture:    { label: 'Lead Nurture',       icon: 'Heart',     color: 'text-blue-400' },
  awareness:  { label: 'Brand Awareness',    icon: 'Megaphone', color: 'text-violet-400' },
  retention:  { label: 'Customer Retention', icon: 'RefreshCw', color: 'text-amber-400' },
  custom:     { label: 'Custom',             icon: 'Settings2', color: 'text-muted-foreground' },
}

const ROLE_LABELS: Record<string, string> = {
  lead_magnet:   'Lead Magnet',
  email_nurture: 'Email Nurture',
  landing_page:  'Landing Page',
  outreach:      'Outreach',
  ad_copy:       'Ad Copy',
  blog:          'Blog Content',
  social:        'Social Content',
  research:      'Research',
  custom:        'Custom',
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Pending',   color: 'text-muted-foreground' },
  running:    { label: 'Running',   color: 'text-blue-400' },
  completed:  { label: 'Done',      color: 'text-emerald-400' },
  failed:     { label: 'Failed',    color: 'text-red-400' },
  cancelled:  { label: 'Cancelled', color: 'text-muted-foreground' },
}

// ─── Run status dot ───────────────────────────────────────────────────────────

function RunDot({ status }: { status?: string }) {
  if (!status) return <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
  const cfg = STATUS_CONFIG[status]
  const colors: Record<string, string> = {
    pending: 'bg-muted-foreground/50',
    running: 'bg-blue-400 animate-pulse',
    completed: 'bg-emerald-400',
    failed: 'bg-red-400',
    cancelled: 'bg-muted-foreground/30',
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full shrink-0', colors[status] ?? 'bg-muted-foreground/30')} />
      {cfg && <span className={cn('text-[10px]', cfg.color)}>{cfg.label}</span>}
    </span>
  )
}

// ─── Brain attachment row ─────────────────────────────────────────────────────

function BrainAttachmentRow({
  attachment: a,
  onDelete,
  onSummaryEdit,
}: {
  attachment: BrainAttachment
  onDelete: () => void
  onSummaryEdit: (summary: string) => void
}) {
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(a.summary ?? '')
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  const isProcessing =
    a.extractionStatus === 'processing' || a.extractionStatus === 'pending' ||
    a.summaryStatus === 'processing' || a.summaryStatus === 'pending'
  const hasFailed = a.extractionStatus === 'failed' || a.summaryStatus === 'failed'

  const displayName = a.sourceUrl
    ? (() => {
        try {
          const u = new URL(a.sourceUrl)
          const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname
          return u.hostname + path
        } catch { return a.sourceUrl.slice(0, 60) }
      })()
    : a.filename

  function handleSave() {
    onSummaryEdit(summaryDraft)
    setEditingSummary(false)
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2.5 space-y-2">
      {/* Row header */}
      <div className="flex items-center gap-2">
        {a.sourceUrl
          ? <Icons.Link className="w-3 h-3 text-muted-foreground shrink-0" />
          : <Icons.File className="w-3 h-3 text-muted-foreground shrink-0" />
        }
        <span className="flex-1 text-xs text-foreground/80 truncate min-w-0">{displayName}</span>

        {isProcessing ? (
          <span className="flex items-center gap-1 text-[9px] text-blue-400 shrink-0">
            <Icons.Loader2 className="w-3 h-3 animate-spin" />
            Processing
          </span>
        ) : hasFailed ? (
          <span className="text-[9px] text-red-400 shrink-0">Failed</span>
        ) : (
          <span className="text-[9px] text-emerald-400 shrink-0">Ready</span>
        )}

        <button
          onClick={onDelete}
          className="text-muted-foreground/40 hover:text-red-400 transition-colors ml-1 shrink-0"
        >
          <Icons.Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Summary */}
      {(a.summary || a.summaryStatus === 'ready') && (
        <div className="space-y-1 pl-5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/50 font-medium">Summary</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  if (!editingSummary) { setSummaryDraft(a.summary ?? ''); setEditingSummary(true) }
                  else handleSave()
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {editingSummary
                  ? <><Icons.Check className="w-3 h-3" />Save</>
                  : <><Icons.Pencil className="w-3 h-3" />Edit</>
                }
              </button>
              {!editingSummary && a.summary && (
                <button
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {summaryExpanded
                    ? <Icons.ChevronUp className="w-3 h-3" />
                    : <Icons.ChevronDown className="w-3 h-3" />
                  }
                </button>
              )}
            </div>
          </div>
          {editingSummary ? (
            <textarea
              className="w-full text-[11px] text-muted-foreground leading-relaxed bg-background border border-border/60 rounded p-2 resize-none outline-none min-h-[4rem] focus:border-violet-500/50 transition-colors"
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          ) : a.summary ? (
            <p className={cn('text-[11px] text-muted-foreground/70 leading-relaxed', !summaryExpanded && 'line-clamp-2')}>
              {a.summary}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/40 italic">Summarising…</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Campaign card ────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  onRefresh,
}: {
  campaign: Campaign
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefText, setBriefText] = useState(campaign.brief ?? '')
  const [savingBrief, setSavingBrief] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [briefEditing, setBriefEditing] = useState(false)
  const briefDirty = briefText !== (campaign.brief ?? '')
  const [bundleOpen, setBundleOpen] = useState(false)
  const [bundle, setBundle] = useState<BundleAsset[] | null>(null)
  const [loadingBundle, setLoadingBundle] = useState(false)
  const [runResults, setRunResults] = useState<Array<{ workflowName: string; runId: string }> | null>(null)

  // Brain panel state
  const [brainOpen, setBrainOpen] = useState(false)
  const [brainAttachments, setBrainAttachments] = useState<BrainAttachment[]>([])
  const [loadingBrain, setLoadingBrain] = useState(false)
  const [brainContext, setBrainContext] = useState(campaign.context ?? '')
  const brainContextDirty = brainContext !== (campaign.context ?? '')
  const [savingBrainContext, setSavingBrainContext] = useState(false)
  const [brainContextEditing, setBrainContextEditing] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const brainPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live polling
  const [liveWorkflows, setLiveWorkflows] = useState(campaign.workflows)
  const [polling, setPolling] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync live workflows when campaign prop updates (e.g. on full refresh)
  useEffect(() => { setLiveWorkflows(campaign.workflows) }, [campaign.workflows])

  useEffect(() => {
    if (!polling) { if (pollRef.current) clearInterval(pollRef.current); return }
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/campaigns/${campaign.id}`)
        const { data } = await res.json()
        if (data?.workflows) {
          setLiveWorkflows(data.workflows)
          const allTerminal = data.workflows.every((cw: CampaignWorkflowEntry) =>
            cw.latestRun && ['completed', 'failed', 'cancelled'].includes(cw.latestRun.status)
          )
          if (allTerminal) { setPolling(false); onRefresh() }
        }
      } catch { /* keep polling */ }
      setPollCount((c) => {
        if (c >= 119) { setPolling(false); return 0 }
        return c + 1
      })
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [polling]) // eslint-disable-line react-hooks/exhaustive-deps

  const goalCfg = GOAL_CONFIG[campaign.goal] ?? GOAL_CONFIG.custom
  const GoalIcon = Icons[goalCfg.icon] as React.ElementType

  const completedWorkflows = liveWorkflows.filter(
    (cw) => cw.latestRun?.status === 'completed'
  ).length
  const failedWorkflows   = liveWorkflows.filter((cw) => cw.latestRun?.status === 'failed')
  const pendingWorkflows  = liveWorkflows.filter((cw) => cw.latestRun?.status === 'pending')
  const workerStuck = polling && pollCount >= 3 && pendingWorkflows.length === liveWorkflows.filter(cw => cw.latestRun).length && failedWorkflows.length === 0

  async function handleRunAll() {
    setRunning(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/run`, { method: 'POST' })
      const { data } = await res.json()
      setRunResults(data.runs)
      setExpanded(true)
      setPollCount(0)
      setPolling(true)
      onRefresh()
    } catch {
      // error handled gracefully
    } finally {
      setRunning(false)
    }
  }

  async function handleGenerateBrief() {
    setGeneratingBrief(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/brief`, { method: 'POST' })
      const { data } = await res.json()
      setBriefText(data.brief ?? '')
      setBriefOpen(true)
      onRefresh()
    } catch {
      // error handled gracefully
    } finally {
      setGeneratingBrief(false)
    }
  }

  async function handleSaveBrief() {
    setSavingBrief(true)
    try {
      await apiFetch(`/api/v1/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: briefText }),
      })
      onRefresh()
    } catch {
      // error handled gracefully
    } finally {
      setSavingBrief(false)
    }
  }

  async function handleLoadBundle() {
    setLoadingBundle(true)
    setBundleOpen(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/bundle`)
      const { data } = await res.json()
      setBundle(data.assets)
    } catch {
      // error handled gracefully
    } finally {
      setLoadingBundle(false)
    }
  }

  async function loadBrainAttachments() {
    const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/brain/attachments`)
    const { data } = await res.json()
    setBrainAttachments(data ?? [])
    return data as BrainAttachment[]
  }

  async function handleOpenBrain() {
    setBrainOpen(true)
    setLoadingBrain(true)
    try {
      await loadBrainAttachments()
    } finally {
      setLoadingBrain(false)
    }
  }

  // Poll while any attachment is still processing
  useEffect(() => {
    if (!brainOpen) { if (brainPollRef.current) clearInterval(brainPollRef.current); return }
    const hasProcessing = brainAttachments.some(
      (a) => a.extractionStatus === 'processing' || a.extractionStatus === 'pending' ||
             a.summaryStatus === 'processing' || a.summaryStatus === 'pending'
    )
    if (!hasProcessing) { if (brainPollRef.current) clearInterval(brainPollRef.current); brainPollRef.current = null; return }
    if (brainPollRef.current) return // already polling
    brainPollRef.current = setInterval(async () => {
      try {
        const fresh = await loadBrainAttachments()
        // Refresh campaign context if any just became ready
        if (fresh.some((a) => a.summaryStatus === 'ready')) {
          const res = await apiFetch(`/api/v1/campaigns/${campaign.id}`)
          const { data } = await res.json()
          if (data?.context && data.context !== brainContext) setBrainContext(data.context)
        }
        const stillProcessing = fresh.some(
          (a) => a.extractionStatus === 'processing' || a.extractionStatus === 'pending' ||
                 a.summaryStatus === 'processing' || a.summaryStatus === 'pending'
        )
        if (!stillProcessing) { clearInterval(brainPollRef.current!); brainPollRef.current = null }
      } catch {}
    }, 4000)
    return () => { if (brainPollRef.current) clearInterval(brainPollRef.current) }
  }, [brainOpen, brainAttachments]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddUrl() {
    if (!urlInput.trim()) return
    setAddingUrl(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/brain/attachments/from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      if (res.ok) {
        setUrlInput('')
        await loadBrainAttachments()
      }
    } finally {
      setAddingUrl(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/brain/attachments`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) await loadBrainAttachments()
    } finally {
      setUploadingFile(false)
      e.target.value = ''
    }
  }

  async function handleDeleteAttachment(aid: string) {
    await apiFetch(`/api/v1/campaigns/${campaign.id}/brain/attachments/${aid}`, { method: 'DELETE' })
    setBrainAttachments((prev) => prev.filter((a) => a.id !== aid))
  }

  async function handleSaveBrainContext() {
    setSavingBrainContext(true)
    try {
      await apiFetch(`/api/v1/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: brainContext }),
      })
      onRefresh()
    } finally {
      setSavingBrainContext(false)
    }
  }

  async function handleSummaryEdit(aid: string, summary: string) {
    await apiFetch(`/api/v1/campaigns/${campaign.id}/brain/attachments/${aid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    })
    setBrainAttachments((prev) => prev.map((a) => a.id === aid ? { ...a, summary } : a))
  }

  async function handleDelete() {
    if (!confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`)) return
    await apiFetch(`/api/v1/campaigns/${campaign.id}`, { method: 'DELETE' })
    onRefresh()
  }

  const dateRange = campaign.startDate
    ? `${new Date(campaign.startDate).toLocaleDateString()} – ${campaign.endDate ? new Date(campaign.endDate).toLocaleDateString() : 'TBD'}`
    : null

  return (
    <div className="border border-border rounded-xl bg-transparent overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={cn('p-1.5 rounded-lg bg-muted/30', goalCfg.color)}>
          <GoalIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{campaign.name}</span>
            <Badge
              className={cn(
                'text-[9px] px-1.5 py-0 h-4 border-0',
                campaign.status === 'active' ? 'bg-emerald-900/50 text-emerald-300' :
                campaign.status === 'planning' ? 'bg-muted text-muted-foreground' :
                'bg-muted text-muted-foreground'
              )}
            >
              {campaign.status}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{goalCfg.label}</span>
            {dateRange && <span className="text-[10px] text-muted-foreground">{dateRange}</span>}
            <span className="text-[10px] text-muted-foreground">
              {completedWorkflows}/{liveWorkflows.length} workflows done
            </span>
          </div>
        </div>

        {/* Progress bar */}
        {liveWorkflows.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  failedWorkflows.length > 0 ? 'bg-red-500' : polling ? 'bg-blue-500' : 'bg-emerald-500'
                )}
                style={{ width: `${(completedWorkflows / liveWorkflows.length) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {Math.round((completedWorkflows / liveWorkflows.length) * 100)}%
            </span>
          </div>
        )}

        <Icons.ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-180')} />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Workflow list */}
          <div className="px-4 py-3 space-y-1.5">
            {liveWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No workflows added to this campaign yet.</p>
            ) : (
              liveWorkflows.map((cw) => (
                <div
                  key={cw.id}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/20 group"
                >
                  <span className="text-[10px] text-muted-foreground w-4 text-center shrink-0">{cw.order + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">{cw.workflow.name}</span>
                      {cw.role && cw.role !== 'custom' && (
                        <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
                          {ROLE_LABELS[cw.role] ?? cw.role}
                        </span>
                      )}
                    </div>
                  </div>
                  <RunDot status={cw.latestRun?.status} />
                  <a
                    href={`/workflows/${cw.workflowId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                  >
                    <Icons.ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))
            )}
          </div>

          {/* Worker stuck warning */}
          {workerStuck && (
            <div className="mx-4 mb-3 p-3 rounded-lg bg-amber-950/30 border border-amber-700/40 flex items-start gap-2.5">
              <Icons.AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-300 font-medium">Runs queued but not starting</p>
                <p className="text-[11px] text-amber-200/70 mt-0.5">
                  The runs were created but the worker hasn't picked them up yet. Check that your <strong>workflow worker</strong> service is running on Railway and is connected to the same Redis instance.
                </p>
              </div>
            </div>
          )}

          {/* Failure panel */}
          {failedWorkflows.length > 0 && !polling && (
            <div className="mx-4 mb-3 p-3 rounded-lg bg-red-950/30 border border-red-700/40 space-y-2">
              <div className="flex items-center gap-2">
                <Icons.XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <p className="text-xs text-red-300 font-medium">
                  {failedWorkflows.length} workflow{failedWorkflows.length > 1 ? 's' : ''} failed
                </p>
              </div>
              <div className="space-y-2">
                {failedWorkflows.map((cw) => (
                  <div key={cw.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-red-200/80">{cw.workflow.name}</span>
                      <a
                        href={`/workflows/${cw.workflowId}`}
                        className="text-[10px] text-red-400/70 hover:text-red-300 underline underline-offset-2"
                      >
                        Open workflow →
                      </a>
                    </div>
                    {cw.latestRun?.errorMessage && (
                      <p className="text-[10px] text-red-300/70 bg-red-950/40 border border-red-800/40 rounded px-2 py-1 font-mono break-all">
                        {cw.latestRun.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-red-800/40 pt-2 space-y-1">
                <p className="text-[10px] text-red-200/60 font-medium">Next steps:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-[10px] text-red-200/50">
                  <li>Open the failed workflow and check which node is red</li>
                  <li>Make sure Client Brain sections are filled in for this client</li>
                  <li>Verify <code className="bg-red-900/40 px-1 rounded">ANTHROPIC_API_KEY</code> is set in your worker env vars on Railway</li>
                  <li>For intelligence nodes: confirm required fields (URLs, keywords) are configured</li>
                  <li>Re-run the individual workflow to test before running the campaign again</li>
                </ol>
              </div>
            </div>
          )}

          {/* Run feedback */}
          {runResults && (
            <div className="mx-4 mb-3 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40">
              <p className="text-xs text-emerald-400 font-medium mb-1">Campaign runs enqueued</p>
              {runResults.map((r) => (
                <p key={r.runId} className="text-[10px] text-muted-foreground">
                  {r.workflowName} — run {r.runId.slice(-6)}
                </p>
              ))}
            </div>
          )}

          {/* Brief */}
          {briefOpen && briefText && (
            <div className="mx-4 mb-3 rounded-lg bg-muted/20 border border-border overflow-hidden">
              {/* Brief header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
                <span className="text-xs font-medium">Campaign Brief</span>
                <div className="flex items-center gap-2 ml-auto">
                  {campaign.briefOriginal && campaign.briefOriginal !== campaign.brief && (
                    <button
                      onClick={() => setShowOriginal((v) => !v)}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                        showOriginal
                          ? 'border-violet-500/50 text-violet-400 bg-violet-950/30'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {showOriginal ? 'Hide AI draft' : 'Compare AI draft'}
                    </button>
                  )}
                  {campaign.briefEditedBy && campaign.briefEditedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      Edited by{' '}
                      <button
                        onClick={() => setShowOriginal((v) => !v)}
                        className="text-foreground/70 hover:text-foreground underline underline-offset-2 transition-colors"
                      >
                        {campaign.briefEditedBy.slice(0, 8)}
                      </button>
                      {' · '}{new Date(campaign.briefEditedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={() => setBriefEditing((v) => !v)}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    {briefEditing
                      ? <><Icons.Eye className="w-3 h-3" />Preview</>
                      : <><Icons.Pencil className="w-3 h-3" />Edit</>
                    }
                  </button>
                  {briefDirty && (
                    <button
                      onClick={handleSaveBrief}
                      disabled={savingBrief}
                      className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                    >
                      {savingBrief
                        ? <Icons.Loader2 className="w-3 h-3 animate-spin" />
                        : <Icons.Check className="w-3 h-3" />
                      }
                      Save
                    </button>
                  )}
                  <button onClick={() => setBriefOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Content area */}
              {showOriginal && campaign.briefOriginal ? (
                <div className="grid grid-cols-2 divide-x divide-border/60 max-h-80 overflow-y-auto">
                  <div className="p-3">
                    <p className="text-[9px] text-violet-400 font-medium mb-2 uppercase tracking-wide">AI Draft</p>
                    <BriefMarkdown text={campaign.briefOriginal} className="text-muted-foreground/70" />
                  </div>
                  <div className="p-3">
                    <p className="text-[9px] text-emerald-400 font-medium mb-2 uppercase tracking-wide">Your Version</p>
                    {briefEditing ? (
                      <textarea
                        className="w-full text-[11px] text-muted-foreground leading-relaxed bg-transparent resize-none outline-none min-h-[8rem]"
                        value={briefText}
                        onChange={(e) => setBriefText(e.target.value)}
                        autoFocus
                        spellCheck={false}
                      />
                    ) : (
                      <BriefMarkdown text={briefText} className="text-muted-foreground cursor-text" />
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 max-h-80 overflow-y-auto">
                  {briefEditing ? (
                    <textarea
                      className="w-full text-xs text-muted-foreground leading-relaxed bg-transparent resize-none outline-none min-h-[10rem] w-full"
                      value={briefText}
                      onChange={(e) => setBriefText(e.target.value)}
                      autoFocus
                      spellCheck={false}
                    />
                  ) : (
                    <BriefMarkdown text={briefText} className="text-muted-foreground" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Brain panel */}
          {brainOpen && (
            <div className="mx-4 mb-3 rounded-lg bg-muted/20 border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
                <Icons.Brain className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-xs font-medium">Campaign Brain</span>
                <span className="text-[10px] text-muted-foreground/60">Docs and URLs that sharpen every workflow in this campaign</span>
                <button onClick={() => setBrainOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground">
                  <Icons.X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3 space-y-3">
                {/* Add sources row */}
                <div className="flex gap-2">
                  {/* URL input */}
                  <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                    <Icons.Link className="w-3 h-3 text-muted-foreground shrink-0" />
                    <input
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                      placeholder="Paste a URL to fetch…"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAddUrl() }}
                    />
                    <button
                      onClick={() => void handleAddUrl()}
                      disabled={addingUrl || !urlInput.trim()}
                      className="shrink-0 text-[10px] text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
                    >
                      {addingUrl ? <Icons.Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
                    </button>
                  </div>
                  {/* File upload */}
                  <label className={cn(
                    'flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs cursor-pointer hover:bg-muted/30 transition-colors',
                    uploadingFile && 'opacity-50 pointer-events-none'
                  )}>
                    {uploadingFile
                      ? <Icons.Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                      : <Icons.Paperclip className="w-3 h-3 text-muted-foreground" />
                    }
                    <span className="text-muted-foreground">Upload file</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.docx,.txt,.md,.csv,.json,.html"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground/50">Accepts PDF, DOCX, TXT, MD, CSV, JSON, HTML</p>

                {/* Attachment list */}
                {loadingBrain ? (
                  <div className="flex items-center gap-2 py-2">
                    <Icons.Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Loading…</span>
                  </div>
                ) : brainAttachments.length > 0 ? (
                  <div className="space-y-2">
                    {brainAttachments.map((a) => (
                      <BrainAttachmentRow
                        key={a.id}
                        attachment={a}
                        onDelete={() => void handleDeleteAttachment(a.id)}
                        onSummaryEdit={(s) => void handleSummaryEdit(a.id, s)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground/60 italic py-1">No sources added yet — upload a file or fetch a URL to start building campaign intelligence.</p>
                )}

                {/* Synthesised context (user-editable) */}
                {(brainContext || brainAttachments.some((a) => a.summaryStatus === 'ready')) && (
                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-foreground">Synthesised Context</span>
                      <span className="text-[10px] text-muted-foreground/60">Claude's combined read — used in brief generation and runs</span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => setBrainContextEditing((v) => !v)}
                          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                          {brainContextEditing ? <><Icons.Eye className="w-3 h-3" />Preview</> : <><Icons.Pencil className="w-3 h-3" />Edit</>}
                        </button>
                        {brainContextDirty && (
                          <button
                            onClick={() => void handleSaveBrainContext()}
                            disabled={savingBrainContext}
                            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                          >
                            {savingBrainContext ? <Icons.Loader2 className="w-3 h-3 animate-spin" /> : <Icons.Check className="w-3 h-3" />}
                            Save
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg bg-background border border-border/60 p-3 max-h-64 overflow-y-auto">
                      {brainContextEditing ? (
                        <textarea
                          className="w-full text-xs text-muted-foreground leading-relaxed bg-transparent resize-none outline-none min-h-[8rem]"
                          value={brainContext}
                          onChange={(e) => setBrainContext(e.target.value)}
                          autoFocus
                          spellCheck={false}
                        />
                      ) : brainContext ? (
                        <BriefMarkdown text={brainContext} className="text-muted-foreground" />
                      ) : (
                        <p className="text-[11px] text-muted-foreground/50 italic">Context will appear here once Claude processes your sources.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Output bundle */}
          {bundleOpen && (
            <div className="mx-4 mb-3 p-3 rounded-lg bg-muted/20 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Output Bundle</span>
                <button onClick={() => setBundleOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <Icons.X className="w-3.5 h-3.5" />
                </button>
              </div>
              {loadingBundle ? (
                <div className="flex items-center gap-2 py-2">
                  <Icons.Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading outputs…</span>
                </div>
              ) : bundle && bundle.length > 0 ? (
                bundle.map((asset) => (
                  <div key={asset.workflow.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{asset.workflow.name}</span>
                      {asset.hasOutput
                        ? <span className="text-[9px] text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded-full">has output</span>
                        : <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">no run</span>
                      }
                    </div>
                    {asset.output && (
                      <div className="text-[10px] text-muted-foreground bg-background/60 border border-border/50 rounded p-2 max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {asset.output.slice(0, 800)}{asset.output.length > 800 ? '…' : ''}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No completed runs found.</p>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-muted/10">
            {/* Generate Brief — must come first */}
            <Button
              variant={briefText ? 'outline' : 'default'}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={briefText && !briefOpen ? () => setBriefOpen(true) : handleGenerateBrief}
              disabled={generatingBrief}
            >
              {generatingBrief
                ? <Icons.Loader2 className="w-3 h-3 animate-spin" />
                : <Icons.FileText className="w-3 h-3" />
              }
              {briefText ? (briefOpen ? 'Brief' : 'View Brief') : 'Generate Brief'}
            </Button>

            {/* Run All — locked until brief exists */}
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleRunAll}
              disabled={running || polling || liveWorkflows.length === 0 || !briefText}
              title={!briefText ? 'Generate a brief first before running' : undefined}
            >
              {running
                ? <Icons.Loader2 className="w-3 h-3 animate-spin" />
                : <Icons.Play className="w-3 h-3" />
              }
              Run All
            </Button>

            {!briefText && !generatingBrief && (
              <span className="text-[10px] text-muted-foreground/60 italic">← generate a brief first</span>
            )}

            {polling && (
              <span className="flex items-center gap-1.5 text-[10px] text-blue-400">
                <Icons.Loader2 className="w-3 h-3 animate-spin" />
                Checking status…
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-7 text-xs gap-1.5',
                brainOpen && 'border-violet-500/50 text-violet-400 bg-violet-950/20'
              )}
              onClick={() => { if (brainOpen) { setBrainOpen(false) } else { void handleOpenBrain() } }}
            >
              <Icons.Brain className="w-3 h-3" />
              Brain
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 ml-auto"
              onClick={handleLoadBundle}
              disabled={loadingBundle}
            >
              <Icons.Package className="w-3 h-3" />
              Outputs
            </Button>

            <button
              className="text-muted-foreground hover:text-red-400 transition-colors"
              onClick={handleDelete}
            >
              <Icons.Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main tab component ───────────────────────────────────────────────────────

export function CampaignsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const loadCampaigns = useCallback(() => {
    if (!clientId) return
    setLoading(true)
    apiFetch(`/api/v1/campaigns?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        // For each campaign, fetch full detail to get latestRun per workflow
        return Promise.all(
          (data ?? []).map((c: Campaign) =>
            apiFetch(`/api/v1/campaigns/${c.id}`)
              .then((r) => r.json())
              .then(({ data: full }) => full)
              .catch(() => c)
          )
        )
      })
      .then((full) => setCampaigns(full))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Campaigns</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Group workflows into campaigns with a shared goal, timeline, and brief
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowCreate(true)}>
          <Icons.Plus className="w-3.5 h-3.5" />
          New Campaign
        </Button>
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Icons.Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading campaigns…</span>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
          <Icons.Layers className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No campaigns yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            Group your workflows into a campaign with a shared goal and timeline — then run them all at once.
          </p>
          <Button size="sm" className="mt-5 h-8 gap-1.5 text-xs" onClick={() => setShowCreate(true)}>
            <Icons.Plus className="w-3.5 h-3.5" />
            Create First Campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} onRefresh={loadCampaigns} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CampaignCreationModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            loadCampaigns()
          }}
        />
      )}
    </div>
  )
}
