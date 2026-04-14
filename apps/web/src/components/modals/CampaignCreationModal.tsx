import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

const GOALS = [
  { value: 'lead_gen',   label: 'Lead Generation',    icon: 'Target',   color: 'text-emerald-400' },
  { value: 'nurture',    label: 'Lead Nurture',        icon: 'Heart',    color: 'text-blue-400' },
  { value: 'awareness',  label: 'Brand Awareness',     icon: 'Megaphone',color: 'text-violet-400' },
  { value: 'retention',  label: 'Customer Retention',  icon: 'RefreshCw',color: 'text-amber-400' },
  { value: 'custom',     label: 'Custom',              icon: 'Settings2',color: 'text-muted-foreground' },
]

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
  /** Pre-selected workflow IDs to add immediately */
  preselectedWorkflowIds?: string[]
}

export function CampaignCreationModal({
  clientId,
  clientName,
  onClose,
  onCreated,
  preselectedWorkflowIds = [],
}: CampaignCreationModalProps) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('lead_gen')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>(preselectedWorkflowIds)

  useEffect(() => {
    apiFetch(`/api/v1/workflows?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setWorkflows((data ?? []).filter((w: Workflow) => w.status !== 'archived')))
      .catch(() => {})
  }, [clientId])

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
      // 1. Create campaign
      const res = await apiFetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          clientId,
          goal,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      })
      const { data: campaign, error: err } = await res.json()
      if (!res.ok) throw new Error(err ?? 'Failed to create campaign')

      // 2. Add selected workflows
      for (let i = 0; i < selectedWorkflowIds.length; i++) {
        await apiFetch(`/api/v1/campaigns/${campaign.id}/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: selectedWorkflowIds[i], order: i }),
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
      <div className="relative w-full max-w-lg bg-white border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <Icons.Layers className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold">New Campaign</h2>
            <p className="text-xs text-muted-foreground">{clientName}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Campaign Name</Label>
            <Input
              placeholder="Q2 Lead Gen Push"
              className="text-sm placeholder:text-muted-foreground/40"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Goal */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Goal</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {GOALS.map((g) => {
                const Icon = Icons[g.icon as keyof typeof Icons] as React.ElementType
                return (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGoal(g.value)}
                    className={cn(
                      'flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition-all text-xs',
                      goal === g.value
                        ? 'border-emerald-600 bg-emerald-950/40 text-foreground'
                        : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                    )}
                  >
                    {Icon && <Icon className={cn('w-3.5 h-3.5', goal === g.value ? g.color : '')} />}
                    <span className="font-medium leading-tight">{g.label}</span>
                  </button>
                )
              })}
            </div>
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

          {/* Workflow selection */}
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
                      <span className={cn(
                        'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
                        selected ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground'
                      )}>
                        {selected && <Icons.Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                      </span>
                      <span className="font-medium truncate flex-1">{wf.name}</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-full',
                        wf.connectivityMode === 'offline' ? 'bg-amber-900/40 text-amber-400' : 'bg-emerald-900/30 text-emerald-400'
                      )}>
                        {wf.connectivityMode}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedWorkflowIds.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {selectedWorkflowIds.length} workflow{selectedWorkflowIds.length !== 1 ? 's' : ''} selected — you can add more later
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Icons.Layers className="w-3.5 h-3.5 mr-1.5" />}
            Create Campaign
          </Button>
        </div>
      </div>
    </div>
  )
}
