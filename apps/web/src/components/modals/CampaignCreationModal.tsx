import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─── Campaign templates ───────────────────────────────────────────────────────

interface TemplateSlot {
  role: string
  label: string
  keywords: string[]
  description: string
}

interface CampaignTemplate {
  id: string
  name: string
  description: string
  goal: string
  icon: keyof typeof Icons
  color: string
  borderActive: string
  bgActive: string
  produces: string[]
  slots: TemplateSlot[]
}

const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'lead_gen_system',
    name: 'Lead Gen System',
    description: 'Complete lead generation package — from gated asset through outreach.',
    goal: 'lead_gen',
    icon: 'Target',
    color: 'text-emerald-400',
    borderActive: 'border-emerald-600',
    bgActive: 'bg-emerald-950/30',
    produces: ['Lead magnet', '5-email sequence', 'Landing pages', 'LinkedIn messages'],
    slots: [
      { role: 'lead_magnet',   label: 'Lead Magnet',       keywords: ['lead magnet', 'magnet'],                      description: 'Gated asset from your ICP and value prop' },
      { role: 'email_nurture', label: 'Email Nurture',     keywords: ['email', 'nurture'],                            description: '5-email sequence for new leads' },
      { role: 'landing_page',  label: 'Landing Page',      keywords: ['landing', 'seo', 'page'],                      description: 'Conversion pages per target query' },
      { role: 'outreach',      label: 'LinkedIn Outreach', keywords: ['linkedin', 'outreach', 'message'],             description: 'Personalised message variants' },
    ],
  },
  {
    id: 'ad_campaign',
    name: 'Ad Campaign',
    description: 'Paid campaign assets — ad copy variations and matching landing pages.',
    goal: 'lead_gen',
    icon: 'Megaphone',
    color: 'text-blue-400',
    borderActive: 'border-blue-600',
    bgActive: 'bg-blue-950/30',
    produces: ['Ad variations', 'Landing pages'],
    slots: [
      { role: 'ad_copy',      label: 'Ad Copy',      keywords: ['ad', 'copy', 'ads', 'adcopy'],  description: 'Multi-channel ad variations' },
      { role: 'landing_page', label: 'Landing Page', keywords: ['landing', 'page'],               description: 'Matching pages per ad set' },
    ],
  },
  {
    id: 'nurture_sequence',
    name: 'Nurture Sequence',
    description: 'Re-engage existing leads with a targeted email sequence.',
    goal: 'nurture',
    icon: 'Heart',
    color: 'text-pink-400',
    borderActive: 'border-pink-600',
    bgActive: 'bg-pink-950/30',
    produces: ['5-email nurture sequence'],
    slots: [
      { role: 'email_nurture', label: 'Email Nurture', keywords: ['email', 'nurture'], description: 'Sequence targeting existing leads' },
    ],
  },
  {
    id: 'market_intelligence',
    name: 'Market Intelligence',
    description: 'Research package — competitive landscape, SEO, and audience signals.',
    goal: 'custom',
    icon: 'Search',
    color: 'text-violet-400',
    borderActive: 'border-violet-600',
    bgActive: 'bg-violet-950/30',
    produces: ['Competitive battlecard', 'SEO content map', 'Audience brief'],
    slots: [
      { role: 'research', label: 'Competitive Research', keywords: ['competitive', 'review', 'scrape', 'web', 'miner', 'intel'], description: 'Deep web + review mining' },
      { role: 'research', label: 'SEO Research',         keywords: ['seo', 'keyword', 'intent', 'content strategy'],             description: 'Keyword intent mapping' },
      { role: 'research', label: 'Audience Research',    keywords: ['audience', 'signal', 'reddit', 'market signal'],            description: 'Reddit + social signals' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Build a campaign from scratch — select any workflows manually.',
    goal: 'custom',
    icon: 'Settings2',
    color: 'text-muted-foreground',
    borderActive: 'border-border',
    bgActive: 'bg-muted/20',
    produces: [],
    slots: [],
  },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workflow {
  id: string
  name: string
  status: string
  connectivityMode: string
}

interface CampaignCreationModalProps {
  clientId: string
  clientName: string
  onClose: () => void
  onCreated: (campaign: { id: string; name: string }) => void
  preselectedWorkflowIds?: string[]
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function autoMatch(slot: TemplateSlot, workflows: Workflow[]): string {
  const match = workflows.find((wf) =>
    slot.keywords.some((kw) => wf.name.toLowerCase().includes(kw.toLowerCase()))
  )
  return match?.id ?? ''
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CampaignCreationModal({
  clientId,
  clientName,
  onClose,
  onCreated,
  preselectedWorkflowIds = [],
}: CampaignCreationModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [slotAssignments, setSlotAssignments] = useState<Record<number, string>>({})
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>(preselectedWorkflowIds)

  useEffect(() => {
    apiFetch(`/api/v1/workflows?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setWorkflows((data ?? []).filter((w: Workflow) => w.status !== 'archived')))
      .catch(() => {})
  }, [clientId])

  // Re-run auto-match once workflows arrive (they may load after template is picked)
  useEffect(() => {
    if (!selectedTemplate || selectedTemplate.id === 'custom') return
    setSlotAssignments((prev) => {
      const next = { ...prev }
      selectedTemplate.slots.forEach((slot, i) => {
        if (!next[i]) next[i] = autoMatch(slot, workflows)
      })
      return next
    })
  }, [workflows]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectTemplate(template: CampaignTemplate) {
    setSelectedTemplate(template)
    const assignments: Record<number, string> = {}
    template.slots.forEach((slot, i) => {
      assignments[i] = autoMatch(slot, workflows)
    })
    setSlotAssignments(assignments)
    setStep(2)
  }

  function toggleWorkflow(id: string) {
    setSelectedWorkflowIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Campaign name is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          clientId,
          goal: selectedTemplate?.goal ?? 'custom',
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      })
      const { data: campaign, error: err } = await res.json()
      if (!res.ok) throw new Error(err ?? 'Failed to create campaign')

      const workflowsToAdd =
        selectedTemplate && selectedTemplate.id !== 'custom'
          ? selectedTemplate.slots
              .map((slot, i) => ({ workflowId: slotAssignments[i] ?? '', role: slot.role, order: i }))
              .filter((w) => w.workflowId && w.workflowId !== '__none__')
          : selectedWorkflowIds.map((id, i) => ({ workflowId: id, role: 'custom', order: i }))

      for (const w of workflowsToAdd) {
        await apiFetch(`/api/v1/campaigns/${campaign.id}/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: w.workflowId, order: w.order, role: w.role }),
        })
      }

      onCreated(campaign)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl bg-white border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          {step === 2 && (
            <button onClick={() => setStep(1)} className="text-muted-foreground hover:text-foreground mr-1">
              <Icons.ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <Icons.Layers className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold">New Campaign</h2>
            <p className="text-xs text-muted-foreground">{clientName}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── Step 1: Template picker ── */}
          {step === 1 && (
            <div className="px-6 py-5 space-y-4">
              <p className="text-xs text-muted-foreground">What kind of campaign are you running?</p>
              <div className="grid grid-cols-2 gap-3">
                {CAMPAIGN_TEMPLATES.map((tpl) => {
                  const Icon = Icons[tpl.icon] as React.ElementType
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => selectTemplate(tpl)}
                      className="flex flex-col items-start gap-2 p-3.5 rounded-xl border border-border bg-transparent text-left transition-all hover:border-foreground/20 hover:bg-muted/10"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className={cn('p-1.5 rounded-lg bg-muted/30', tpl.color)}>
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-semibold">{tpl.name}</span>
                        <Icons.ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">{tpl.description}</p>
                      {tpl.produces.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {tpl.produces.map((p) => (
                            <span key={p} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2: Configure ── */}
          {step === 2 && selectedTemplate && (
            <div className="px-6 py-5 space-y-5">

              {/* Selected template badge */}
              <div className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs font-medium', selectedTemplate.borderActive, selectedTemplate.bgActive)}>
                {(() => { const Icon = Icons[selectedTemplate.icon] as React.ElementType; return <Icon className={cn('w-3.5 h-3.5 shrink-0', selectedTemplate.color)} /> })()}
                {selectedTemplate.name}
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Campaign Name</Label>
                <Input
                  placeholder={`${clientName} — ${selectedTemplate.name}`}
                  className="text-sm placeholder:text-muted-foreground/40"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start Date (optional)</Label>
                  <Input type="date" className="text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">End Date (optional)</Label>
                  <Input type="date" className="text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              {/* Template slot assignment */}
              {selectedTemplate.id !== 'custom' && selectedTemplate.slots.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Assign Workflows</Label>
                  <div className="space-y-2">
                    {selectedTemplate.slots.map((slot, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/10">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{slot.label}</p>
                          <p className="text-[10px] text-muted-foreground">{slot.description}</p>
                        </div>
                        <Select
                          value={slotAssignments[i] ?? ''}
                          onValueChange={(v) => setSlotAssignments((prev) => ({ ...prev, [i]: v }))}
                        >
                          <SelectTrigger className="w-40 h-7 text-xs shrink-0">
                            <SelectValue placeholder="Skip slot" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Skip slot</SelectItem>
                            {workflows.map((wf) => (
                              <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  {workflows.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">No workflows yet — you can assign them after creating the campaign.</p>
                  )}
                </div>
              )}

              {/* Custom workflow multi-select */}
              {selectedTemplate.id === 'custom' && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Add Workflows (optional)</Label>
                  {workflows.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">No workflows found for this client.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {workflows.map((wf) => {
                        const selected = selectedWorkflowIds.includes(wf.id)
                        return (
                          <button
                            key={wf.id}
                            type="button"
                            onClick={() => toggleWorkflow(wf.id)}
                            className={cn(
                              'flex items-center gap-2.5 w-full px-3 py-2 rounded border text-left text-xs transition-colors',
                              selected
                                ? 'bg-emerald-950/40 border-emerald-700 text-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <span className={cn('w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0', selected ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground')}>
                              {selected && <Icons.Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                            </span>
                            <span className="font-medium truncate flex-1">{wf.name}</span>
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', wf.connectivityMode === 'offline' ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/30 text-emerald-400')}>
                              {wf.connectivityMode}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer — only on step 2 */}
        {step === 2 && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving
                ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                : <Icons.Layers className="w-3.5 h-3.5 mr-1.5" />
              }
              Create Campaign
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
