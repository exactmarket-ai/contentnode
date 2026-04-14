import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { CampaignCreationModal } from '@/components/modals/CampaignCreationModal'
import { CampaignBrainPanel } from '@/components/modals/CampaignBrainModal'

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
    firstImagePath: string | null
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

// ─── Preflight — required node fields ────────────────────────────────────────

interface RequiredFieldDef {
  key: string
  label: string
  type: 'text' | 'textarea'
  placeholder: string
}

const REQUIRED_NODE_FIELDS: Record<string, { validation: 'all' | 'any'; hint: string; fields: RequiredFieldDef[] }> = {
  'seo-intent': {
    validation: 'any',
    hint: 'Fill in at least one of these',
    fields: [
      { key: 'topic',        label: 'Topic',         type: 'text',     placeholder: 'e.g. manufacturing automation software' },
      { key: 'seedKeywords', label: 'Seed Keywords',  type: 'textarea', placeholder: 'One per line…\nmanufacturing lead gen\nindustrial CRM' },
    ],
  },
  'deep-web-scrape': {
    validation: 'all',
    hint: 'Required',
    fields: [
      { key: 'seedUrls', label: 'Seed URLs', type: 'textarea', placeholder: 'https://example.com\nhttps://…' },
    ],
  },
  'review-miner': {
    validation: 'all',
    hint: 'Required',
    fields: [
      { key: 'companySlug', label: 'Company Name / Slug', type: 'text', placeholder: 'acme-corp' },
    ],
  },
  'audience-signal': {
    validation: 'all',
    hint: 'Required',
    fields: [
      { key: 'searchTerms', label: 'Reddit Search Terms', type: 'textarea', placeholder: 'One per line…' },
    ],
  },
}

function isNodeConfigReady(subtype: string, config: Record<string, unknown>): boolean {
  const req = REQUIRED_NODE_FIELDS[subtype]
  if (!req) return true
  const filled = req.fields.filter((f) => ((config[f.key] as string) ?? '').trim().length > 0)
  return req.validation === 'any' ? filled.length > 0 : filled.length === req.fields.length
}

interface PreflightIssue {
  workflowId: string
  workflowName: string
  nodes: Array<{ nodeId: string; nodeLabel: string; subtype: string }>
}

// ─── Preflight dialog ─────────────────────────────────────────────────────────

function PreflightDialog({
  issues,
  values,
  onChange,
  onSaveAndRun,
  onCancel,
  saving,
}: {
  issues: PreflightIssue[]
  values: Record<string, Record<string, Record<string, string>>>
  onChange: (workflowId: string, nodeId: string, field: string, value: string) => void
  onSaveAndRun: () => void
  onCancel: () => void
  saving: boolean
}) {
  // Check if all issues are resolved
  const allReady = issues.every((issue) =>
    issue.nodes.every((n) => {
      const req = REQUIRED_NODE_FIELDS[n.subtype]
      if (!req) return true
      const nodeVals = values[issue.workflowId]?.[n.nodeId] ?? {}
      const filled = req.fields.filter((f) => (nodeVals[f.key] ?? '').trim().length > 0)
      return req.validation === 'any' ? filled.length > 0 : filled.length === req.fields.length
    })
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg bg-white border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="p-1.5 rounded-lg bg-amber-100 shrink-0">
            <Icons.Settings2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">Quick setup needed</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {issues.length === 1
                ? `1 workflow needs a couple of fields filled in before it can run.`
                : `${issues.length} workflows need a couple of fields filled in before they can run.`}
            </p>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground shrink-0">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* Issues */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {issues.map((issue) => (
            <div key={issue.workflowId}>
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Icons.GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                {issue.workflowName}
              </p>
              <div className="space-y-4 pl-5">
                {issue.nodes.map((n) => {
                  const req = REQUIRED_NODE_FIELDS[n.subtype]!
                  return (
                    <div key={n.nodeId}>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        {n.nodeLabel} · <span className="normal-case">{req.hint}</span>
                      </p>
                      <div className="space-y-2">
                        {req.fields.map((f) => (
                          <div key={f.key}>
                            <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
                            {f.type === 'textarea' ? (
                              <Textarea
                                className="text-xs min-h-[60px] font-mono"
                                placeholder={f.placeholder}
                                value={values[issue.workflowId]?.[n.nodeId]?.[f.key] ?? ''}
                                onChange={(e) => onChange(issue.workflowId, n.nodeId, f.key, e.target.value)}
                              />
                            ) : (
                              <Input
                                className="text-xs"
                                placeholder={f.placeholder}
                                value={values[issue.workflowId]?.[n.nodeId]?.[f.key] ?? ''}
                                onChange={(e) => onChange(issue.workflowId, n.nodeId, f.key, e.target.value)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={!allReady || saving}
            onClick={onSaveAndRun}
          >
            {saving ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icons.Play className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save & Run'}
          </Button>
        </div>
      </div>
    </div>
  )
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
  // Brain modal
  const [brainOpen, setBrainOpen] = useState(false)
  const [brainContext, setBrainContext] = useState(campaign.context ?? '')

  // Live polling
  const [liveWorkflows, setLiveWorkflows] = useState(campaign.workflows)
  const [polling, setPolling] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const [runError, setRunError] = useState<string | null>(null)
  // Preflight — checked on expand, shown before Run All
  const [nodeWarnings, setNodeWarnings] = useState<Record<string, PreflightIssue['nodes']>>({})
  const [checkingWarnings, setCheckingWarnings] = useState(false)
  const [warningsChecked, setWarningsChecked] = useState(false)
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([])
  const [preflightValues, setPreflightValues] = useState<Record<string, Record<string, Record<string, string>>>>({})
  const [showPreflight, setShowPreflight] = useState(false)
  const [savingPreflight, setSavingPreflight] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync live workflows when campaign prop updates (e.g. on full refresh)
  useEffect(() => { setLiveWorkflows(campaign.workflows) }, [campaign.workflows])

  // Check for unconfigured nodes as soon as the card is expanded
  const checkWarnings = useCallback(async () => {
    setCheckingWarnings(true)
    const warnings: Record<string, PreflightIssue['nodes']> = {}
    for (const cw of liveWorkflows) {
      try {
        const r = await apiFetch(`/api/v1/workflows/${cw.workflowId}`)
        if (!r.ok) continue
        const { data: wf } = await r.json()
        const bad: PreflightIssue['nodes'] = []
        for (const node of (wf.nodes ?? []) as Array<{ id: string; label: string; config: Record<string, unknown> }>) {
          const cfg = (node.config ?? {}) as Record<string, unknown>
          const subtype = (cfg.subtype as string) ?? ''
          if (REQUIRED_NODE_FIELDS[subtype] && !isNodeConfigReady(subtype, cfg)) {
            bad.push({ nodeId: node.id, nodeLabel: node.label ?? subtype, subtype })
          }
        }
        if (bad.length > 0) warnings[cw.workflowId] = bad
      } catch { /* ignore individual workflow fetch errors */ }
    }
    setNodeWarnings(warnings)
    setWarningsChecked(true)
    setCheckingWarnings(false)
  }, [liveWorkflows]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (expanded && !warningsChecked) checkWarnings()
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

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
        if (c >= 300) { setPolling(false); return 0 }
        return c + 1
      })
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [polling]) // eslint-disable-line react-hooks/exhaustive-deps

  const goalCfg = GOAL_CONFIG[campaign.goal] ?? GOAL_CONFIG.custom
  const GoalIcon = Icons[goalCfg.icon] as React.ElementType

  const completedWorkflows = liveWorkflows.filter(
    (cw) => cw.latestRun?.status === 'completed'
  ).length
  const runningWorkflows  = liveWorkflows.filter((cw) => cw.latestRun?.status === 'running').length
  const failedWorkflows   = liveWorkflows.filter((cw) => cw.latestRun?.status === 'failed')
  const pendingWorkflows  = liveWorkflows.filter((cw) => cw.latestRun?.status === 'pending')
  const workerStuck = polling && pollCount >= 6 && pendingWorkflows.length === liveWorkflows.filter(cw => cw.latestRun).length && failedWorkflows.length === 0 && runningWorkflows === 0

  async function doRunAll() {
    const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/run`, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error ?? `Server error ${res.status}`)
    const runMap: Record<string, string> = {}
    for (const r of (json.data?.runs ?? []) as Array<{ workflowId: string; runId: string }>) {
      runMap[r.workflowId] = r.runId
    }
    setLiveWorkflows((prev) =>
      prev.map((cw) =>
        runMap[cw.workflowId]
          ? { ...cw, latestRun: { id: runMap[cw.workflowId], status: 'pending', startedAt: null, completedAt: null, campaignId: campaign.id, errorMessage: null } }
          : cw
      )
    )
    setExpanded(true)
    setPollCount(0)
    setPolling(true)
    onRefresh()
  }

  function openPreflightDialog(warningMap: Record<string, PreflightIssue['nodes']>) {
    const issues: PreflightIssue[] = liveWorkflows
      .filter((cw) => (warningMap[cw.workflowId]?.length ?? 0) > 0)
      .map((cw) => ({ workflowId: cw.workflowId, workflowName: cw.workflow.name, nodes: warningMap[cw.workflowId] }))
    const vals: Record<string, Record<string, Record<string, string>>> = {}
    for (const issue of issues) {
      vals[issue.workflowId] = {}
      for (const n of issue.nodes) {
        vals[issue.workflowId][n.nodeId] = {}
        for (const f of REQUIRED_NODE_FIELDS[n.subtype]?.fields ?? []) {
          vals[issue.workflowId][n.nodeId][f.key] = ''
        }
      }
    }
    setPreflightIssues(issues)
    setPreflightValues(vals)
    setShowPreflight(true)
  }

  async function handleRunAll() {
    setRunning(true)
    setRunError(null)
    try {
      // If we already have warning data use it; otherwise fetch now
      let warnings = nodeWarnings
      if (!warningsChecked) {
        // First time — fetch synchronously so we don't miss anything
        const fresh: Record<string, PreflightIssue['nodes']> = {}
        for (const cw of liveWorkflows) {
          try {
            const r = await apiFetch(`/api/v1/workflows/${cw.workflowId}`)
            if (!r.ok) continue
            const { data: wf } = await r.json()
            const bad: PreflightIssue['nodes'] = []
            for (const node of (wf.nodes ?? []) as Array<{ id: string; label: string; config: Record<string, unknown> }>) {
              const cfg = (node.config ?? {}) as Record<string, unknown>
              const subtype = (cfg.subtype as string) ?? ''
              if (REQUIRED_NODE_FIELDS[subtype] && !isNodeConfigReady(subtype, cfg)) {
                bad.push({ nodeId: node.id, nodeLabel: node.label ?? subtype, subtype })
              }
            }
            if (bad.length > 0) fresh[cw.workflowId] = bad
          } catch { /* ignore */ }
        }
        setNodeWarnings(fresh)
        setWarningsChecked(true)
        warnings = fresh
      }

      if (Object.keys(warnings).length > 0) {
        openPreflightDialog(warnings)
        return
      }

      await doRunAll()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start runs')
    } finally {
      setRunning(false)
    }
  }

  async function handleSaveAndRun() {
    setSavingPreflight(true)
    try {
      // Save each modified node config via targeted PATCH
      for (const issue of preflightIssues) {
        for (const n of issue.nodes) {
          const nodeVals = preflightValues[issue.workflowId]?.[n.nodeId] ?? {}
          const nonEmpty = Object.fromEntries(
            Object.entries(nodeVals).filter(([, v]) => v.trim().length > 0)
          )
          if (Object.keys(nonEmpty).length === 0) continue
          await apiFetch(`/api/v1/workflows/${issue.workflowId}/nodes/${n.nodeId}/config`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nonEmpty),
          })
        }
      }
      setShowPreflight(false)
      setPreflightIssues([])
      // Clear saved workflows from warnings
      setNodeWarnings((prev) => {
        const next = { ...prev }
        for (const issue of preflightIssues) delete next[issue.workflowId]
        return next
      })
      await doRunAll()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to save configuration')
      setShowPreflight(false)
    } finally {
      setSavingPreflight(false)
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
                      {nodeWarnings[cw.workflowId]?.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openPreflightDialog(nodeWarnings) }}
                          className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-950/40 border border-amber-700/40 px-1.5 py-0.5 rounded-full hover:bg-amber-950/60 transition-colors"
                        >
                          <Icons.AlertTriangle className="w-2.5 h-2.5" />
                          Needs setup
                        </button>
                      )}
                    </div>
                  </div>
                  <RunDot status={cw.latestRun?.status} />
                  {cw.latestRun?.firstImagePath && (
                    <a
                      href={`/review/${cw.latestRun.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-8 h-8 rounded overflow-hidden border border-border/60 hover:border-border transition-colors"
                      title="View image output"
                    >
                      <img
                        src={cw.latestRun.firstImagePath}
                        alt="output preview"
                        className="w-full h-full object-cover"
                      />
                    </a>
                  )}
                  {cw.latestRun?.status === 'completed' && (
                    <a
                      href={`/review/${cw.latestRun.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-opacity shrink-0"
                      title="Review content"
                    >
                      <Icons.FileText className="w-3 h-3" />
                      <span>Review</span>
                    </a>
                  )}
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

          {/* Run error banner */}
          {runError && (
            <div className="mx-4 mb-3 p-3 rounded-lg bg-red-950/30 border border-red-700/40 flex items-start gap-2.5">
              <Icons.XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-300 font-medium">Failed to start runs</p>
                <p className="text-[11px] text-red-200/70 mt-0.5">{runError}</p>
              </div>
              <button onClick={() => setRunError(null)} className="text-red-400/60 hover:text-red-400 shrink-0">
                <Icons.X className="w-3 h-3" />
              </button>
            </div>
          )}

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

          {/* Live run status summary — shown while polling */}
          {polling && (
            <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <Icons.Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
              <div className="flex-1 flex items-center gap-3 flex-wrap">
                {runningWorkflows > 0 && (
                  <span className="text-[11px] text-blue-400 font-medium">{runningWorkflows} running</span>
                )}
                {pendingWorkflows.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">{pendingWorkflows.length} queued</span>
                )}
                {completedWorkflows > 0 && (
                  <span className="text-[11px] text-emerald-400 font-medium">{completedWorkflows} done</span>
                )}
                {failedWorkflows.length > 0 && (
                  <span className="text-[11px] text-red-400">{failedWorkflows.length} failed</span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {completedWorkflows + failedWorkflows.length} / {liveWorkflows.length}
              </span>
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

          {/* Preflight setup dialog */}
          {showPreflight && (
            <PreflightDialog
              issues={preflightIssues}
              values={preflightValues}
              onChange={(wfId, nodeId, field, value) =>
                setPreflightValues((prev) => ({
                  ...prev,
                  [wfId]: {
                    ...prev[wfId],
                    [nodeId]: { ...prev[wfId]?.[nodeId], [field]: value },
                  },
                }))
              }
              onSaveAndRun={handleSaveAndRun}
              onCancel={() => setShowPreflight(false)}
              saving={savingPreflight}
            />
          )}

          {/* Brain panel */}
          {brainOpen && (
            <div className="border-t border-border pt-4">
              <CampaignBrainPanel
                campaignId={campaign.id}
                initialContext={brainContext}
                onContextSaved={(ctx) => { setBrainContext(ctx); onRefresh() }}
              />
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
              className={cn(
                'h-7 text-xs gap-1.5',
                Object.keys(nodeWarnings).length > 0 && !running && !polling &&
                  'border-amber-600/50 text-amber-300 bg-amber-950/20 hover:bg-amber-950/40'
              )}
              onClick={handleRunAll}
              disabled={running || polling || liveWorkflows.length === 0 || !briefText}
              title={!briefText ? 'Generate a brief first before running' : undefined}
            >
              {running
                ? <Icons.Loader2 className="w-3 h-3 animate-spin" />
                : Object.keys(nodeWarnings).length > 0
                  ? <Icons.AlertTriangle className="w-3 h-3" />
                  : <Icons.Play className="w-3 h-3" />
              }
              {Object.keys(nodeWarnings).length > 0 && !running ? 'Setup & Run' : 'Run All'}
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
              onClick={() => setBrainOpen((v) => !v)}
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
