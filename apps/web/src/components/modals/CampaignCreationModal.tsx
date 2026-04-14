import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { WORKFLOW_TEMPLATES } from '@/lib/workflowTemplates'

// ─── Campaign templates ───────────────────────────────────────────────────────

interface SetupField {
  nodeId: string
  field: string
  label: string
  placeholder: string
  hint?: string
  type?: 'text' | 'textarea'
}

interface TemplateSlot {
  role: string
  label: string
  keywords: string[]
  description: string
  workflowTemplateId?: string  // ID from WORKFLOW_TEMPLATES to auto-create if no match
  setupFields?: SetupField[]   // Required node fields the user must supply before running
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
  requiresVertical?: boolean  // True when any slot uses a template with GTM/DG vert sections
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
    requiresVertical: true,
    slots: [
      { role: 'lead_magnet',   label: 'Lead Magnet',       keywords: ['lead magnet', 'magnet'],            description: 'Gated asset from your ICP and value prop',  workflowTemplateId: 'dg-lead-magnet' },
      { role: 'email_nurture', label: 'Email Nurture',     keywords: ['email', 'nurture'],                  description: '5-email sequence for new leads',             workflowTemplateId: 'dg-email-nurture' },
      { role: 'landing_page',  label: 'Landing Page',      keywords: ['landing', 'seo', 'page'],            description: 'Conversion pages per target query',          workflowTemplateId: 'dg-seo-landing' },
      { role: 'outreach',      label: 'LinkedIn Outreach', keywords: ['linkedin', 'outreach', 'message'],   description: 'Personalised message variants',              workflowTemplateId: 'dg-linkedin-outreach' },
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
    requiresVertical: true,
    slots: [
      { role: 'ad_copy',      label: 'Ad Copy',      keywords: ['ad', 'copy', 'ads', 'adcopy'],  description: 'Multi-channel ad variations',  workflowTemplateId: 'dg-ad-copy' },
      { role: 'landing_page', label: 'Landing Page', keywords: ['landing', 'page'],               description: 'Matching pages per ad set',  workflowTemplateId: 'dg-seo-landing' },
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
    requiresVertical: true,
    slots: [
      { role: 'email_nurture', label: 'Email Nurture', keywords: ['email', 'nurture'], description: 'Sequence targeting existing leads', workflowTemplateId: 'dg-email-nurture' },
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
    requiresVertical: true,
    slots: [
      {
        role: 'research', label: 'Competitive Research', keywords: ['competitive', 'review', 'scrape', 'web', 'miner', 'intel'],
        description: 'Deep web + review mining', workflowTemplateId: 'intel-competitive',
        setupFields: [
          { nodeId: 'ci-reviews', field: 'companyName', label: 'Company name', placeholder: 'Acme Corp' },
          { nodeId: 'ci-reviews', field: 'companySlug', label: 'Review page URL (optional)', placeholder: 'https://www.trustpilot.com/review/acme-corp', hint: 'Direct URL to a public review page — Trustpilot, G2, or any review site. Leave blank to skip review mining.' },
          { nodeId: 'ci-reviews', field: 'competitors', label: 'Competitor names (comma-separated)', placeholder: 'Competitor A, Competitor B' },
          { nodeId: 'ci-scrape',  field: 'seedUrls', label: 'Competitor website URLs (one per line)', placeholder: 'https://competitor.com', type: 'textarea' },
        ],
      },
      {
        role: 'research', label: 'SEO Research', keywords: ['seo', 'keyword', 'intent', 'content strategy'],
        description: 'Keyword intent mapping', workflowTemplateId: 'intel-seo-content-strategy',
        setupFields: [
          { nodeId: 'seo-keywords', field: 'topic', label: 'Topic / industry', placeholder: 'B2B project management software' },
          { nodeId: 'seo-keywords', field: 'seedKeywords', label: 'Seed keywords (comma-separated)', placeholder: 'project management, team collaboration, task tracking' },
          { nodeId: 'seo-audience', field: 'searchTerms', label: 'Reddit search terms (comma-separated)', placeholder: 'best project management tools, team software' },
          { nodeId: 'seo-audience', field: 'subreddits', label: 'Subreddits (comma-separated, optional)', placeholder: 'projectmanagement, startups, productivity' },
        ],
      },
      {
        role: 'research', label: 'Audience Research', keywords: ['audience', 'signal', 'reddit', 'market signal'],
        description: 'Reddit + social signals', workflowTemplateId: 'intel-market-signal-brief',
        setupFields: [
          { nodeId: 'ms-web',    field: 'seedUrls',    label: 'Industry site URLs to crawl (one per line)', placeholder: 'https://industry-publication.com\nhttps://trade-body.org', type: 'textarea' },
          { nodeId: 'ms-reddit', field: 'searchTerms', label: 'Reddit search terms (comma-separated)', placeholder: 'your product category, your ICP job title' },
          { nodeId: 'ms-reddit', field: 'subreddits',  label: 'Subreddits to search (comma-separated, optional)', placeholder: 'yourindustry, entrepreneur' },
        ],
      },
    ],
  },
  {
    id: 'brand_awareness',
    name: 'Brand Awareness',
    description: 'Content-led awareness across blog and social — builds authority and drives organic discovery.',
    goal: 'awareness',
    icon: 'Megaphone',
    color: 'text-violet-400',
    borderActive: 'border-violet-600',
    bgActive: 'bg-violet-950/30',
    produces: ['Blog post', 'Social content pack', 'Blog → social repurpose'],
    requiresVertical: true,
    slots: [
      { role: 'blog',    label: 'Blog Post',            keywords: ['blog', 'post', 'article'],            description: 'SEO blog post targeting a keyword',        workflowTemplateId: 'dg-blog-post' },
      { role: 'social',  label: 'Social Content Pack',  keywords: ['social', 'content pack', 'linkedin'],  description: 'LinkedIn, short-form, and Instagram posts', workflowTemplateId: 'dg-social-pack' },
      { role: 'social',  label: 'Blog → Social Repurpose', keywords: ['repurpose', 'blog to social'],      description: 'Distribute one blog across all channels',   workflowTemplateId: 'dg-blog-to-social' },
    ],
  },
  {
    id: 'retention',
    name: 'Retention',
    description: 'Keep customers engaged, successful, and growing — re-engagement, onboarding, and upgrade messaging.',
    goal: 'retention',
    icon: 'RefreshCw',
    color: 'text-amber-400',
    borderActive: 'border-amber-600',
    bgActive: 'bg-amber-950/30',
    produces: ['Re-engagement sequence', 'Customer success content', 'Upsell / cross-sell copy'],
    requiresVertical: true,
    slots: [
      { role: 'email_nurture', label: 'Re-engagement Sequence',   keywords: ['reengagement', 're-engagement', 'win-back', 'winback'], description: '3-email sequence for lapsed customers',   workflowTemplateId: 'dg-reengagement-email' },
      { role: 'custom',        label: 'Customer Success Content', keywords: ['customer success', 'onboarding', 'success'],            description: 'Onboarding, feature spotlight, success story', workflowTemplateId: 'dg-customer-success' },
      { role: 'custom',        label: 'Upsell / Cross-sell Copy', keywords: ['upsell', 'cross-sell', 'upgrade'],                      description: 'Targeted upgrade messaging per segment',   workflowTemplateId: 'dg-upsell-crosssell' },
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
  const [creatingSlots, setCreatingSlots] = useState<Record<number, boolean>>({})
  // setupValues: slot index → nodeId → field → value
  const [setupValues, setSetupValues] = useState<Record<number, Record<string, Record<string, string>>>>({})
  // Vertical selection (required for content templates that use GTM/DG vert sections)
  const [verticals, setVerticals] = useState<Array<{ id: string; name: string }>>([])
  const [selectedVerticalId, setSelectedVerticalId] = useState('')
  const [selectedVerticalName, setSelectedVerticalName] = useState('')

  useEffect(() => {
    apiFetch(`/api/v1/workflows?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setWorkflows((data ?? []).filter((w: Workflow) => w.status !== 'archived')))
      .catch(() => {})
    // Fetch brand verticals for this client (used by all content templates)
    apiFetch(`/api/v1/clients/${clientId}/brand-verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        const verts = (data ?? []) as Array<{ id: string; name: string }>
        // Sort alphabetically; "Company" sentinel is prepended separately
        setVerticals([...verts].sort((a, b) => a.name.localeCompare(b.name)))
        // Default to Company (general / no vertical)
        setSelectedVerticalId('__company__')
        setSelectedVerticalName('Company')
      })
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

  async function createWorkflowFromTemplate(slotIndex: number, workflowTemplateId: string) {
    const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === workflowTemplateId)
    if (!tpl) return
    setCreatingSlots((prev) => ({ ...prev, [slotIndex]: true }))
    try {
      // 1. Create the workflow record
      const wRes = await apiFetch('/api/v1/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tpl.name, clientId, connectivityMode: 'online', description: tpl.description }),
      })
      const { data: wf } = await wRes.json()
      if (!wRes.ok || !wf?.id) throw new Error('Failed to create workflow')

      // 2. Inject user-supplied setup values + vertical into template nodes before saving
      const slotSetup = setupValues[slotIndex] ?? {}
      const patchedNodes = tpl.nodes.map((node) => {
        const nodeOverrides = slotSetup[node.id] ?? {}
        // Inject vertical into all client_brain nodes
        // __company__ sentinel = company-wide (no vertical); pass empty strings so executor skips vert sections
        const resolvedVertId = selectedVerticalId === '__company__' ? '' : selectedVerticalId
        const resolvedVertName = selectedVerticalId === '__company__' ? '' : selectedVerticalName
        const verticalOverrides = node.type === 'client_brain'
          ? { verticalId: resolvedVertId, verticalName: resolvedVertName }
          : {}
        const merged = { ...nodeOverrides, ...verticalOverrides }
        if (Object.keys(merged).length === 0) return node
        return {
          ...node,
          data: {
            ...node.data,
            config: { ...node.data.config, ...merged },
          },
        }
      })

      // 3. Apply template nodes + edges via the graph endpoint
      await apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: patchedNodes, edges: tpl.edges }),
      })

      // 4. Add new workflow to local list and assign to slot
      setWorkflows((prev) => [...prev, { id: wf.id, name: wf.name, status: wf.status, connectivityMode: wf.connectivityMode }])
      setSlotAssignments((prev) => ({ ...prev, [slotIndex]: wf.id }))
    } catch {
      // non-fatal — slot stays unassigned
    } finally {
      setCreatingSlots((prev) => ({ ...prev, [slotIndex]: false }))
    }
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

      const slotWorkflows =
        selectedTemplate && selectedTemplate.id !== 'custom'
          ? selectedTemplate.slots
              .map((slot, i) => ({ workflowId: slotAssignments[i] ?? '', role: slot.role, order: i }))
              .filter((w) => w.workflowId && w.workflowId !== '__none__')
          : []
      const slottedIds = new Set(slotWorkflows.map((w) => w.workflowId))
      const extraWorkflows = selectedWorkflowIds
        .filter((id) => !slottedIds.has(id))
        .map((id, i) => ({ workflowId: id, role: 'custom', order: slotWorkflows.length + i }))
      const workflowsToAdd =
        selectedTemplate?.id === 'custom'
          ? selectedWorkflowIds.map((id, i) => ({ workflowId: id, role: 'custom', order: i }))
          : [...slotWorkflows, ...extraWorkflows]

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

              {/* Vertical selector — required for all content templates */}
              {selectedTemplate.requiresVertical && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Brand Vertical <span className="text-red-400">*</span>
                  </Label>
                  {verticals.length === 0 ? (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/20 border border-amber-800/40">
                      <Icons.AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-300">
                        No brand verticals found for this client. Add one in the client settings before running content workflows.
                      </p>
                    </div>
                  ) : (
                    <Select
                      value={selectedVerticalId || '__company__'}
                      onValueChange={(v) => {
                        if (v === '__company__') {
                          setSelectedVerticalId('__company__')
                          setSelectedVerticalName('Company')
                          return
                        }
                        const found = verticals.find((vt) => vt.id === v)
                        setSelectedVerticalId(v)
                        setSelectedVerticalName(found?.name ?? '')
                      }}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Company" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__company__">Company</SelectItem>
                        {verticals.map((vt) => (
                          <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-[10px] text-muted-foreground/60">
                    {selectedVerticalId === '__company__'
                      ? 'Company-wide context only — no vertical-specific GTM or Demand Gen sections.'
                      : 'All Client Brain nodes will use this vertical to pull GTM and Demand Gen context.'}
                  </p>
                </div>
              )}

              {/* Template slot assignment */}
              {selectedTemplate.id !== 'custom' && selectedTemplate.slots.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Assign Workflows</Label>
                  <div className="space-y-3">
                    {selectedTemplate.slots.map((slot, i) => {
                      const isCreating = creatingSlots[i]
                      const assigned = slotAssignments[i]
                      const assignedWorkflow = workflows.find((w) => w.id === assigned)
                      const needsSetup = slot.setupFields && slot.setupFields.length > 0
                      const isUnassigned = !assigned || assigned === '__none__'

                      function setSlotFieldValue(nodeId: string, field: string, value: string) {
                        setSetupValues((prev) => ({
                          ...prev,
                          [i]: { ...prev[i], [nodeId]: { ...(prev[i]?.[nodeId] ?? {}), [field]: value } },
                        }))
                      }

                      return (
                        <div key={i} className="rounded-lg border border-border bg-muted/10 overflow-hidden">
                          {/* Slot header row */}
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{slot.label}</p>
                              <p className="text-[10px] text-muted-foreground">{slot.description}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isCreating ? (
                                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground w-40">
                                  <Icons.Loader2 className="w-3 h-3 animate-spin" />
                                  Creating…
                                </span>
                              ) : (
                                <>
                                  <Select
                                    value={assigned ?? '__none__'}
                                    onValueChange={(v) => setSlotAssignments((prev) => ({ ...prev, [i]: v }))}
                                  >
                                    <SelectTrigger className="w-36 h-7 text-xs">
                                      <SelectValue placeholder="Skip slot" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">Skip slot</SelectItem>
                                      {workflows.map((wf) => (
                                        <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {slot.workflowTemplateId && isUnassigned && (
                                    <button
                                      type="button"
                                      onClick={() => createWorkflowFromTemplate(i, slot.workflowTemplateId!)}
                                      className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-800/50 rounded px-1.5 py-1 transition-colors whitespace-nowrap"
                                      title={`Create ${slot.label} workflow from template`}
                                    >
                                      <Icons.Plus className="w-3 h-3" />
                                      Create
                                    </button>
                                  )}
                                  {!isUnassigned && assignedWorkflow && (
                                    <a
                                      href={`/workflows/${assigned}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                      title="Open workflow"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Icons.ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Setup fields — shown before the workflow is created */}
                          {needsSetup && isUnassigned && (
                            <div className="border-t border-border bg-muted/30 px-3 py-3 space-y-2.5">
                              <p className="text-[10px] font-medium flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                                <Icons.Settings className="w-3 h-3" />
                                Configure before creating — these values will be baked into the workflow
                              </p>
                              {slot.setupFields!.map((sf) => (
                                <div key={`${sf.nodeId}-${sf.field}`} className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground">{sf.label}</label>
                                  {sf.type === 'textarea' ? (
                                    <textarea
                                      className="w-full text-xs bg-background/60 border border-border/60 rounded px-2 py-1.5 resize-none outline-none focus:border-amber-600/50 transition-colors placeholder:text-muted-foreground/40"
                                      rows={2}
                                      placeholder={sf.placeholder}
                                      value={setupValues[i]?.[sf.nodeId]?.[sf.field] ?? ''}
                                      onChange={(e) => setSlotFieldValue(sf.nodeId, sf.field, e.target.value)}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      className="w-full text-xs bg-background/60 border border-border/60 rounded px-2 py-1.5 outline-none focus:border-amber-600/50 transition-colors placeholder:text-muted-foreground/40"
                                      placeholder={sf.placeholder}
                                      value={setupValues[i]?.[sf.nodeId]?.[sf.field] ?? ''}
                                      onChange={(e) => setSlotFieldValue(sf.nodeId, sf.field, e.target.value)}
                                    />
                                  )}
                                  {sf.hint && (
                                    <p className="text-[9px] text-muted-foreground/60">{sf.hint}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Post-creation confirmation */}
                          {needsSetup && !isUnassigned && assignedWorkflow && (
                            <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center gap-2">
                              <Icons.CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                              <p className="text-[10px] flex-1" style={{ color: '#5f5e5a' }}>
                                Created with your settings.{' '}
                                <a href={`/workflows/${assigned}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                                  Open to verify →
                                </a>
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {workflows.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">No workflows yet — you can assign them after creating the campaign.</p>
                  )}
                </div>
              )}

              {/* Workflow multi-select — full list for custom, extras for templates */}
              {selectedTemplate.id === 'custom' ? (
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
              ) : (
                /* Extra workflows for template-based campaigns */
                (() => {
                  const slottedIds = new Set(Object.values(slotAssignments).filter(Boolean))
                  const available = workflows.filter((wf) => !slottedIds.has(wf.id))
                  if (available.length === 0) return null
                  return (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Add Extra Workflows (optional)</Label>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {available.map((wf) => {
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
                    </div>
                  )
                })()
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer — only on step 2 */}
        {step === 2 && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              title={undefined}
            >
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
