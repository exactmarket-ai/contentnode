import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import type { ConnectivityMode } from '@/store/workflowStore'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflowTemplates'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
]
const OLLAMA_MODELS = [
  { value: 'gemma4:e4b',   label: 'Gemma 4 E4B' },
  { value: 'llama3.1:70b', label: 'Llama 3.1 70B' },
  { value: 'gemma3:12b',   label: 'Gemma 3 12B' },
  { value: 'gemma3:4b',    label: 'Gemma 3 4B' },
  { value: 'llama3.1:8b',  label: 'Llama 3.1 8B' },
  { value: 'llama3.2',     label: 'Llama 3.2 3B' },
  { value: 'mistral',      label: 'Mistral 7B' },
  { value: 'phi3',         label: 'Phi-3' },
]

const CATEGORY_LABELS: Record<string, string> = {
  marketing: 'Marketing Campaigns', blog: 'Blog', social: 'Social', email: 'Email', seo: 'SEO', general: 'General',
}

interface Client { id: string; name: string; requireOffline: boolean }

interface OrgTemplate {
  id: string
  name: string
  templateCategory: string | null
  templateDescription: string | null
  nodes: Array<{ id: string }>
  edges: Array<{ id: string }>
}

interface WorkflowCreationModalProps {
  onClose: () => void
  onDismiss?: () => void
  defaultClientId?: string
}

export function WorkflowCreationModal({ onClose, onDismiss, defaultClientId }: WorkflowCreationModalProps) {
  const { setWorkflowName, setWorkflow, loadTemplate } = useWorkflowStore()

  // Step 1: pick template (or blank), Step 2: configure
  const [step, setStep] = useState<'template' | 'configure'>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)

  const [name, setName] = useState('Untitled Workflow')
  const [mode, setMode] = useState<ConnectivityMode>('online')
  const [provider, setProvider] = useState<'anthropic' | 'ollama'>('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-5')
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [clients, setClients] = useState<Client[]>([])
  const [orgTemplates, setOrgTemplates] = useState<OrgTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedOrgTemplateId, setSelectedOrgTemplateId] = useState<string | null>(null)

  // Policy: if selected client requires offline, override all AI settings at render time — no effects
  const selectedClient = clients.find((c) => c.id === clientId)
  const clientRequiresOffline = selectedClient?.requireOffline === true
  const effectiveMode: ConnectivityMode = clientRequiresOffline ? 'offline' : mode
  const effectiveProvider: 'anthropic' | 'ollama' = clientRequiresOffline ? 'ollama' : provider
  const effectiveModel: string = clientRequiresOffline ? 'gemma3:12b' : model

  useEffect(() => {
    apiFetch('/api/v1/clients?status=active')
      .then((r) => r.json())
      .then(({ data }) => {
        const active = (data ?? []).filter((c: Client & { status: string }) => c.status !== 'archived')
        setClients(active)
        if (active.length > 0) {
          setClientId((current) => {
            const isValid = active.some((c: Client) => c.id === current)
            return isValid ? current : active[0].id
          })
        }
      })
      .catch(() => {})
    apiFetch('/api/v1/workflows/templates')
      .then((r) => r.json())
      .then(({ data }) => setOrgTemplates(data ?? []))
      .catch(() => {})
  }, [])

  const handleSelectTemplate = (t: WorkflowTemplate | null) => {
    setSelectedTemplate(t)
    setSelectedOrgTemplateId(null)
    if (t) setName(t.name)
    setStep('configure')
  }

  const handleSelectOrgTemplate = (ot: OrgTemplate) => {
    setSelectedOrgTemplateId(ot.id)
    setSelectedTemplate(null)
    setName(ot.name)
    setStep('configure')
  }

  const handleProviderChange = (p: string) => {
    if (clientRequiresOffline) return
    const newProvider = p as 'anthropic' | 'ollama'
    setProvider(newProvider)
    setModel(newProvider === 'anthropic' ? 'claude-sonnet-4-5' : 'gemma3:12b')
  }

  const handleSubmit = async () => {
    if (!clientId) { setError('Please select a client'); return }
    setSaving(true)
    setError(null)
    try {
      const trimmed = name.trim() || 'Untitled Workflow'
      const res = await apiFetch('/api/v1/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          clientId,
          connectivityMode: effectiveMode,
          defaultModelConfig: { provider: effectiveProvider, model: effectiveModel, temperature: 0.7 },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Failed to create workflow (${res.status})`)
        return
      }
      const { data: wf } = await res.json()
      setWorkflowName(trimmed)
      setWorkflow({
        id: wf.id,
        clientId,
        connectivity_mode: effectiveMode,
        default_model_config: { provider: effectiveProvider, model: effectiveModel, temperature: 0.7 },
        graphSaved: true,
        // Mark blank-canvas workflows so they get cleaned up if user navigates away without adding nodes
        autoCreated: !selectedTemplate && !selectedOrgTemplateId,
      })
      if (selectedTemplate) {
        loadTemplate(selectedTemplate.nodes, selectedTemplate.edges)
        // Save the template graph immediately so the workflow is never blank on reload
        const { nodes: tNodes, edges: tEdges } = useWorkflowStore.getState()
        apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
          method: 'PUT',
          body: JSON.stringify({ nodes: tNodes, edges: tEdges, name: trimmed }),
        }).catch(() => {})
      } else if (selectedOrgTemplateId) {
        // Load the org template's graph into the canvas
        try {
          const tRes = await apiFetch(`/api/v1/workflows/${selectedOrgTemplateId}`)
          if (tRes.ok) {
            const { data: tData } = await tRes.json()
            const rfNodes = (tData.nodes ?? []).map((n: Record<string, unknown>) => {
              const dbConfig = (n.config as Record<string, unknown>) ?? {}
              return {
                id: n.id as string,
                type: n.type as string,
                position: { x: (n.positionX as number) ?? 0, y: (n.positionY as number) ?? 0 },
                data: { label: n.label as string, ...dbConfig, config: dbConfig },
              }
            })
            const rfEdges = (tData.edges ?? []).map((e: Record<string, unknown>) => ({
              id: e.id as string,
              source: e.sourceNodeId as string,
              target: e.targetNodeId as string,
              label: e.label as string | undefined,
              animated: false,
            }))
            useWorkflowStore.setState({ nodes: rfNodes, edges: rfEdges, graphDirty: true })
            // Save the org template graph immediately
            apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
              method: 'PUT',
              body: JSON.stringify({ nodes: rfNodes, edges: rfEdges, name: trimmed }),
            }).catch(() => {})
          }
        } catch { /* non-critical — user gets a blank canvas */ }
      }
      onClose()
    } catch {
      setError('Network error — is the API running?')
    } finally {
      setSaving(false)
    }
  }

  const modelList = effectiveProvider === 'anthropic' ? ANTHROPIC_MODELS : OLLAMA_MODELS

  // ── Step 1: Template picker ─────────────────────────────────────────────────
  if (step === 'template') {
    const categories = [...new Set(WORKFLOW_TEMPLATES.map((t) => t.category))]
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[640px] max-h-[80vh] flex flex-col rounded-xl border border-border bg-white shadow-2xl">
          <div className="rounded-t-xl px-6 py-5 flex items-center justify-between" style={{ backgroundColor: '#a200ee' }}>
            <div>
              <div className="flex items-center gap-2">
                <Icons.LayoutTemplate className="h-5 w-5 text-white/80" />
                <h2 className="text-base font-semibold text-white">New Workflow</h2>
              </div>
              <p className="mt-1 text-sm text-white/70">Start from a template or build from scratch.</p>
            </div>
            {onDismiss && (
              <button onClick={onDismiss} className="rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors" title="Cancel">
                <Icons.X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
            {/* Blank option */}
            <button
              onClick={() => handleSelectTemplate(null)}
              className="w-full flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-left hover:border-blue-600/50 hover:bg-blue-50/60 transition-colors"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                <Icons.Plus className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Blank Canvas</p>
                <p className="text-xs text-muted-foreground">Start with an empty workflow and build from scratch.</p>
              </div>
            </button>

            {/* Org templates */}
            {orgTemplates.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your Organization's Templates</p>
                <div className="grid grid-cols-2 gap-2">
                  {orgTemplates.map((ot) => (
                    <button
                      key={ot.id}
                      onClick={() => handleSelectOrgTemplate(ot)}
                      className="flex items-start gap-3 rounded-lg p-3 text-left transition-opacity hover:opacity-90"
                      style={{ border: '1px solid #e0c0ff', backgroundColor: '#fdf5ff' }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #e0c0ff' }}>
                        <Icons.Bookmark className="h-4 w-4" style={{ color: '#a200ee', fill: '#a200ee' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug">{ot.name}</p>
                        {ot.templateDescription && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{ot.templateDescription}</p>
                        )}
                        <p className="mt-1.5 text-[10px] text-muted-foreground/60">
                          {ot.nodes.length} node{ot.nodes.length !== 1 ? 's' : ''} · {ot.templateCategory ?? 'general'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Templates by category */}
            {categories.map((cat) => (
              <div key={cat}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[cat] ?? cat}</p>
                <div className="grid grid-cols-2 gap-2">
                  {WORKFLOW_TEMPLATES.filter((t) => t.category === cat).map((t) => {
                    const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[t.icon] ?? Icons.Workflow
                    if (t.id === 'blog-humanizer') return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        className="flex items-start gap-3 rounded-lg p-3 text-left transition-opacity hover:opacity-90"
                        style={{ border: '1px solid #f0e0ff', backgroundColor: '#fdf5ff' }}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff' }}>
                          <Icon className="h-4 w-4" style={{ color: '#a200ee' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium leading-snug">{t.name}</p>
                            <span className="inline-flex items-center px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide" style={{ borderRadius: 6, backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff', color: '#7a00b4' }}>★ Recommended</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{t.description}</p>
                          <p className="mt-1.5 text-[10px] text-muted-foreground/60">{t.nodes.length} nodes</p>
                        </div>
                      </button>
                    )
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-blue-600/50 hover:bg-blue-50/60"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: '#f5e6ff', border: '1px solid #f0e0ff' }}>
                          <Icon className="h-4 w-4" style={{ color: '#a200ee' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium leading-snug">{t.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{t.description}</p>
                          <p className="mt-1.5 text-[10px] text-muted-foreground/60">{t.nodes.length} nodes</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Step 2: Configure ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-border bg-white shadow-2xl">
        <div className="rounded-t-xl px-6 py-5" style={{ backgroundColor: '#a200ee' }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setStep('template')} className="text-white/70 hover:text-white">
              <Icons.ChevronLeft className="h-4 w-4" />
            </button>
            <Icons.Workflow className="h-5 w-5 text-white/80" />
            <h2 className="text-base font-semibold text-white">
              {selectedTemplate ? selectedTemplate.name : selectedOrgTemplateId ? (orgTemplates.find(t => t.id === selectedOrgTemplateId)?.name ?? 'New Workflow') : 'New Workflow'}
            </h2>
            {onDismiss && (
              <button onClick={onDismiss} className="ml-auto rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors" title="Cancel">
                <Icons.X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-white/70 pl-10">
            {selectedTemplate
              ? selectedTemplate.description
              : selectedOrgTemplateId
                ? (orgTemplates.find(t => t.id === selectedOrgTemplateId)?.templateDescription ?? 'Configure your workflow before building.')
                : 'Configure your workflow before building.'}
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Workflow Name</Label>
            <Input
              autoFocus
              placeholder="My Content Workflow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Connectivity Mode</Label>
            {clientRequiresOffline
              ? <p className="text-[11px] text-amber-700 flex items-center gap-1"><Icons.ShieldAlert className="h-3 w-3" />This client requires local models only — offline mode is enforced.</p>
              : <p className="text-[11px] text-muted-foreground">Locked after the first run and cannot be changed.</p>
            }
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => { if (!clientRequiresOffline) setMode('online') }}
                disabled={clientRequiresOffline}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  clientRequiresOffline
                    ? 'opacity-40 cursor-not-allowed border-border bg-background text-muted-foreground'
                    : effectiveMode === 'online'
                      ? 'border-purple-400 bg-purple-50 text-purple-700'
                      : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-accent',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icons.Wifi className="h-3.5 w-3.5" />Online
                </div>
                <span className="text-[11px] opacity-70 leading-tight">External APIs, Anthropic &amp; cloud models</span>
              </button>
              <button
                onClick={() => { if (!clientRequiresOffline) setMode('offline') }}
                disabled={clientRequiresOffline}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  effectiveMode === 'offline'
                    ? 'border-amber-600 bg-amber-50 text-amber-700'
                    : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-accent',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icons.WifiOff className="h-3.5 w-3.5" />Offline
                </div>
                <span className="text-[11px] opacity-70 leading-tight">Local Ollama models, no external calls</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Default AI Provider</Label>
            <div className={cn('flex gap-2', clientRequiresOffline && 'opacity-50 pointer-events-none')}>
              <Select value={effectiveProvider} onValueChange={handleProviderChange} disabled={clientRequiresOffline}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                  <SelectItem value="ollama" className="text-xs">Ollama (local)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={effectiveModel} onValueChange={(v) => { if (!clientRequiresOffline) setModel(v) }} disabled={clientRequiresOffline}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modelList.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button size="sm" onClick={handleSubmit} disabled={saving} className="h-8 text-xs">
            {saving
              ? <Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Icons.Check className="mr-1.5 h-3.5 w-3.5" />}
            {selectedTemplate || selectedOrgTemplateId ? 'Create from Template' : 'Create Workflow'}
          </Button>
        </div>
      </div>
    </div>
  )
}
