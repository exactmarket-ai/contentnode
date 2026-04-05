import { useState } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ConnectivityMode } from '@/store/workflowStore'

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

interface WorkflowCreationModalProps {
  onClose: () => void
}

export function WorkflowCreationModal({ onClose }: WorkflowCreationModalProps) {
  const { setWorkflowName, setWorkflow } = useWorkflowStore()

  const [name, setName] = useState('Untitled Workflow')
  const [mode, setMode] = useState<ConnectivityMode>('online')
  const [provider, setProvider] = useState<'anthropic' | 'ollama'>('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-5')

  const handleProviderChange = (p: string) => {
    const newProvider = p as 'anthropic' | 'ollama'
    setProvider(newProvider)
    setModel(newProvider === 'anthropic' ? 'claude-sonnet-4-5' : 'llama3.2')
  }

  const handleSubmit = () => {
    const trimmed = name.trim() || 'Untitled Workflow'
    setWorkflowName(trimmed)
    setWorkflow({
      connectivity_mode: mode,
      default_model_config: { provider, model, temperature: 0.7 },
    })
    onClose()
  }

  const modelList = provider === 'anthropic' ? ANTHROPIC_MODELS : OLLAMA_MODELS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-2">
            <Icons.Workflow className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold">New Workflow</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your workflow before you start building.
          </p>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
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

          {/* Connectivity mode */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Connectivity Mode</Label>
            <p className="text-[11px] text-muted-foreground">
              Locked after the first run and cannot be changed.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => setMode('online')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  mode === 'online'
                    ? 'border-blue-600 bg-blue-950 text-blue-300'
                    : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-accent',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icons.Wifi className="h-3.5 w-3.5" />
                  Online
                </div>
                <span className="text-[11px] opacity-70 leading-tight">
                  External APIs, Anthropic &amp; cloud models
                </span>
              </button>
              <button
                onClick={() => setMode('offline')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  mode === 'offline'
                    ? 'border-amber-600 bg-amber-950 text-amber-300'
                    : 'border-border bg-background text-muted-foreground hover:border-border/80 hover:bg-accent',
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icons.WifiOff className="h-3.5 w-3.5" />
                  Offline
                </div>
                <span className="text-[11px] opacity-70 leading-tight">
                  Local Ollama models, no external calls
                </span>
              </button>
            </div>
          </div>

          {/* Default AI provider */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Default AI Provider</Label>
            <div className="flex gap-2">
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                  <SelectItem value="ollama" className="text-xs">Ollama (local)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelList.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button size="sm" onClick={handleSubmit} className="h-8 text-xs">
            <Icons.Check className="mr-1.5 h-3.5 w-3.5" />
            Create Workflow
          </Button>
        </div>
      </div>
    </div>
  )
}
