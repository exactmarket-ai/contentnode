import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { CampaignCreationModal } from '@/components/modals/CampaignCreationModal'

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
  const briefDirty = briefText !== (campaign.brief ?? '')
  const [bundleOpen, setBundleOpen] = useState(false)
  const [bundle, setBundle] = useState<BundleAsset[] | null>(null)
  const [loadingBundle, setLoadingBundle] = useState(false)
  const [runResults, setRunResults] = useState<Array<{ workflowName: string; runId: string }> | null>(null)

  const goalCfg = GOAL_CONFIG[campaign.goal] ?? GOAL_CONFIG.custom
  const GoalIcon = Icons[goalCfg.icon] as React.ElementType

  const completedWorkflows = campaign.workflows.filter(
    (cw) => cw.latestRun?.status === 'completed'
  ).length

  async function handleRunAll() {
    setRunning(true)
    try {
      const res = await apiFetch(`/api/v1/campaigns/${campaign.id}/run`, { method: 'POST' })
      const { data } = await res.json()
      setRunResults(data.runs)
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
              {completedWorkflows}/{campaign.workflows.length} workflows done
            </span>
          </div>
        </div>

        {/* Progress bar */}
        {campaign.workflows.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(completedWorkflows / campaign.workflows.length) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {Math.round((completedWorkflows / campaign.workflows.length) * 100)}%
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
            {campaign.workflows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No workflows added to this campaign yet.</p>
            ) : (
              campaign.workflows.map((cw) => (
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

              {/* Compare view — side by side when showing original */}
              {showOriginal && campaign.briefOriginal ? (
                <div className="grid grid-cols-2 divide-x divide-border/60">
                  <div className="p-3">
                    <p className="text-[9px] text-violet-400 font-medium mb-1.5 uppercase tracking-wide">AI Draft</p>
                    <div className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                      {campaign.briefOriginal}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-[9px] text-emerald-400 font-medium mb-1.5 uppercase tracking-wide">Your Version</p>
                    <textarea
                      className="w-full text-[11px] text-muted-foreground leading-relaxed bg-transparent resize-none outline-none max-h-72 min-h-[8rem] overflow-y-auto"
                      value={briefText}
                      onChange={(e) => setBriefText(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </div>
              ) : (
                <textarea
                  className="w-full text-xs text-muted-foreground leading-relaxed bg-transparent resize-none outline-none max-h-72 min-h-[8rem] overflow-y-auto p-3"
                  value={briefText}
                  onChange={(e) => setBriefText(e.target.value)}
                  spellCheck={false}
                />
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

          {/* Action bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-muted/10">
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleRunAll}
              disabled={running || campaign.workflows.length === 0}
            >
              {running
                ? <Icons.Loader2 className="w-3 h-3 animate-spin" />
                : <Icons.Play className="w-3 h-3" />
              }
              Run All
            </Button>

            <Button
              variant="outline"
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

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleLoadBundle}
              disabled={loadingBundle}
            >
              <Icons.Package className="w-3 h-3" />
              Outputs
            </Button>

            <button
              className="ml-auto text-muted-foreground hover:text-red-400 transition-colors"
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
