import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const OLLAMA_MODELS = [
  { value: 'llama3.2', label: 'Llama 3.2' },
  { value: 'mistral',  label: 'Mistral 7B' },
  { value: 'phi3',     label: 'Phi-3' },
  { value: 'gemma2',   label: 'Gemma 2' },
]

// ─── Field components ─────────────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── Subtype-specific config forms ───────────────────────────────────────────

function TextInputConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Text Content">
      <Textarea
        placeholder="Enter text or use {{variable}} templates..."
        className="min-h-[100px] resize-none text-xs"
        value={(config.text as string) ?? ''}
        onChange={(e) => onChange('text', e.target.value)}
      />
    </FieldGroup>
  )
}

function ApiFetchConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="URL">
        <Input
          placeholder="https://api.example.com/data"
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Method">
        <Select value={(config.method as string) ?? 'GET'} onValueChange={(v) => onChange('method', v)}>
          <SelectTrigger className="text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
    </>
  )
}

function WebScrapeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="URL">
        <Input
          placeholder="https://example.com/page"
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="CSS Selector (optional)">
        <Input
          placeholder=".article-content, #main"
          className="text-xs"
          value={(config.selector as string) ?? ''}
          onChange={(e) => onChange('selector', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

function AiGenerateConfig({ config, onChange, workflowModel }: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
  const modelCfg = (config.model_config as Record<string, unknown> | null) ?? null
  const useWorkflowDefault = modelCfg === null

  const provider = (modelCfg?.provider as string) ?? workflowModel.provider
  const model = (modelCfg?.model as string) ?? workflowModel.model
  const temperature = (modelCfg?.temperature as number) ?? workflowModel.temperature ?? 0.7

  return (
    <>
      <FieldGroup label="Prompt">
        <Textarea
          placeholder="Write a summary of {{input}}..."
          className="min-h-[120px] resize-none text-xs font-mono"
          value={(config.prompt as string) ?? ''}
          onChange={(e) => onChange('prompt', e.target.value)}
        />
      </FieldGroup>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Model Override</Label>
        <button
          className="text-xs text-blue-400 hover:text-blue-300"
          onClick={() => onChange('model_config', useWorkflowDefault ? { provider: 'anthropic', model: 'claude-sonnet-4-5', temperature: 0.7 } : null)}
        >
          {useWorkflowDefault ? 'Override' : 'Use workflow default'}
        </button>
      </div>

      {!useWorkflowDefault && (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <FieldGroup label="Provider">
            <Select value={provider} onValueChange={(v) => onChange('model_config', { ...modelCfg, provider: v, model: v === 'anthropic' ? 'claude-sonnet-4-5' : 'llama3.2' })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                <SelectItem value="ollama" className="text-xs">Ollama (local)</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <FieldGroup label="Model">
            <Select value={model} onValueChange={(v) => onChange('model_config', { ...modelCfg, model: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(provider === 'anthropic' ? ANTHROPIC_MODELS : OLLAMA_MODELS).map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>
          <FieldGroup label={`Temperature: ${temperature.toFixed(1)}`}>
            <input
              type="range" min="0" max="1" step="0.1"
              value={temperature}
              onChange={(e) => onChange('model_config', { ...modelCfg, temperature: parseFloat(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </FieldGroup>
        </div>
      )}
    </>
  )
}

function TransformConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Expression (JS)">
      <Textarea
        placeholder="return input.trim()"
        className="min-h-[100px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
      <p className="text-xs text-muted-foreground">Use <code className="text-blue-400">input</code> to reference the incoming value.</p>
    </FieldGroup>
  )
}

function ConditionConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Condition (JS, returns boolean)">
      <Textarea
        placeholder="return input.length > 100"
        className="min-h-[80px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
    </FieldGroup>
  )
}

function WebhookConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Webhook URL">
      <Input
        placeholder="https://hooks.example.com/..."
        className="text-xs"
        value={(config.url as string) ?? ''}
        onChange={(e) => onChange('url', e.target.value)}
      />
    </FieldGroup>
  )
}

function EmailConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="To">
        <Input
          placeholder="recipient@example.com"
          className="text-xs"
          value={(config.to as string) ?? ''}
          onChange={(e) => onChange('to', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Subject">
        <Input
          placeholder="Workflow result: {{workflow.name}}"
          className="text-xs"
          value={(config.subject as string) ?? ''}
          onChange={(e) => onChange('subject', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

function FileExportConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="Format">
        <Select value={(config.format as string) ?? 'txt'} onValueChange={(v) => onChange('format', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['txt', 'md', 'json', 'csv', 'html'].map((f) => (
              <SelectItem key={f} value={f} className="text-xs">.{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="Filename">
        <Input
          placeholder="output"
          className="text-xs"
          value={(config.filename as string) ?? ''}
          onChange={(e) => onChange('filename', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Config dispatcher ────────────────────────────────────────────────────────

function NodeConfigForm({ subtype, config, onChange, workflowModel }: {
  subtype: string
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
  switch (subtype) {
    case 'text-input':   return <TextInputConfig config={config} onChange={onChange} />
    case 'api-fetch':    return <ApiFetchConfig config={config} onChange={onChange} />
    case 'web-scrape':   return <WebScrapeConfig config={config} onChange={onChange} />
    case 'ai-generate':  return <AiGenerateConfig config={config} onChange={onChange} workflowModel={workflowModel} />
    case 'transform':    return <TransformConfig config={config} onChange={onChange} />
    case 'condition':    return <ConditionConfig config={config} onChange={onChange} />
    case 'webhook':      return <WebhookConfig config={config} onChange={onChange} />
    case 'email':        return <EmailConfig config={config} onChange={onChange} />
    case 'file-export':  return <FileExportConfig config={config} onChange={onChange} />
    default:             return <p className="text-xs text-muted-foreground">No configuration for this node type.</p>
  }
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeData, workflow } = useWorkflowStore()
  const node = nodes.find((n) => n.id === selectedNodeId)

  const [localLabel, setLocalLabel] = useState('')

  useEffect(() => {
    if (node) setLocalLabel(node.data.label as string)
  }, [node?.id])

  if (!node) {
    return (
      <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <Icons.MousePointerClick className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No node selected</p>
            <p className="mt-1 text-xs text-muted-foreground">Click a node on the canvas to configure it</p>
          </div>
        </div>
      </div>
    )
  }

  const subtype = node.data.subtype as string
  const config = (node.data.config as Record<string, unknown>) ?? {}

  const onConfigChange = (key: string, value: unknown) => {
    updateNodeData(node.id, { config: { ...config, [key]: value } })
  }

  const CATEGORY_COLOR: Record<string, string> = {
    source: 'text-emerald-400',
    logic: 'text-blue-400',
    output: 'text-purple-400',
  }
  const colorClass = CATEGORY_COLOR[node.type ?? ''] ?? 'text-foreground'

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Icons.Settings2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Node Config</span>
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={() => useWorkflowStore.getState().setSelectedNodeId(null)}
        >
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-3 py-3">
          {/* Node identity */}
          <div className="space-y-3">
            <FieldGroup label="Node Label">
              <Input
                className="text-xs"
                value={localLabel}
                onChange={(e) => setLocalLabel(e.target.value)}
                onBlur={() => updateNodeData(node.id, { label: localLabel })}
              />
            </FieldGroup>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Type:</span>
              <span className={cn('text-xs font-medium capitalize', colorClass)}>
                {node.type} / {subtype}
              </span>
            </div>
          </div>

          <Separator />

          {/* Type-specific config */}
          <NodeConfigForm
            subtype={subtype}
            config={config}
            onChange={onConfigChange}
            workflowModel={workflow.default_model_config}
          />
        </div>
      </ScrollArea>

      {/* Footer: delete node */}
      <div className="border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            useWorkflowStore.getState().onNodesChange([{ type: 'remove', id: node.id }])
            useWorkflowStore.getState().setSelectedNodeId(null)
          }}
        >
          <Icons.Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete Node
        </Button>
      </div>
    </div>
  )
}
