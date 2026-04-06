import { useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-opus-4-6',   label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]
const OLLAMA_MODELS = [
  { value: 'llama3.2', label: 'Llama 3.2' },
  { value: 'mistral',  label: 'Mistral 7B' },
  { value: 'phi3',     label: 'Phi-3' },
]

const RUN_STATUS_CONFIG = {
  idle:                { label: 'Run',        icon: Icons.Play,     variant: 'default' as const,      spin: false },
  running:             { label: 'Running…',   icon: Icons.Loader2,  variant: 'secondary' as const,    spin: true  },
  completed:           { label: 'Run',        icon: Icons.Play,     variant: 'default' as const,      spin: false },
  failed:              { label: 'Retry',      icon: Icons.RotateCcw, variant: 'destructive' as const, spin: false },
  awaiting_assignment: { label: 'Assign…',    icon: Icons.Users,    variant: 'secondary' as const,    spin: false },
}

export function TopBar() {
  const { workflow, setWorkflowName, setWorkflow, runStatus, hasBeenRun } = useWorkflowStore()

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(workflow.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const commitName = () => {
    const trimmed = nameValue.trim() || 'Untitled Workflow'
    setWorkflowName(trimmed)
    setNameValue(trimmed)
    setEditingName(false)
  }

  const runCfg = RUN_STATUS_CONFIG[runStatus]
  const RunIcon = runCfg.icon
  const modelList = workflow.default_model_config.provider === 'anthropic' ? ANTHROPIC_MODELS : OLLAMA_MODELS
  const modelLabel = modelList.find((m) => m.value === workflow.default_model_config.model)?.label
    ?? workflow.default_model_config.model

  const handleRun = () => {
    if (runStatus === 'running') return
    // TODO: wire to API POST /api/v1/runs
    useWorkflowStore.getState().setRunStatus('running')
    setTimeout(() => useWorkflowStore.getState().setRunStatus('idle'), 3000)
  }

  const handleSave = () => {
    // TODO: wire to API PUT /api/v1/workflows/:id
    const { nodes, edges, workflow: wf } = useWorkflowStore.getState()
    console.log('save', { workflow: wf, nodes, edges })
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      {/* Logo */}
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icons.Workflow className="h-4 w-4 text-blue-400" />
        <span className="text-blue-400">ContentNode</span>
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* Workflow name */}
      {editingName ? (
        <input
          ref={nameInputRef}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') { setNameValue(workflow.name); setEditingName(false) }
          }}
          autoFocus
        />
      ) : (
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
          onClick={() => { setNameValue(workflow.name); setEditingName(true) }}
        >
          {workflow.name}
          <Icons.Pencil className="h-3 w-3 text-muted-foreground" />
        </button>
      )}

      {/* Connectivity toggle */}
      <button
        onClick={() => {
          if (hasBeenRun) return
          setWorkflow({
            connectivity_mode: workflow.connectivity_mode === 'online' ? 'offline' : 'online',
          })
        }}
        disabled={hasBeenRun}
        title={
          hasBeenRun
            ? 'Connectivity mode cannot be changed after the first run'
            : workflow.connectivity_mode === 'online'
              ? 'Online — click to switch to Offline (local Ollama)'
              : 'Offline — click to switch to Online (external APIs)'
        }
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
          hasBeenRun && 'cursor-not-allowed opacity-60',
          !hasBeenRun && 'cursor-pointer',
          workflow.connectivity_mode === 'online'
            ? 'border-emerald-700 bg-emerald-950 text-emerald-400 hover:bg-emerald-900'
            : 'border-amber-700 bg-amber-950 text-amber-400 hover:bg-amber-900',
          hasBeenRun && 'hover:bg-transparent',
        )}
      >
        {workflow.connectivity_mode === 'online'
          ? <><Icons.Wifi className="h-3 w-3" />Online</>
          : <><Icons.WifiOff className="h-3 w-3" />Offline</>
        }
        {hasBeenRun && <Icons.Lock className="h-3 w-3 opacity-60" />}
      </button>

      {/* Persistent OFFLINE badge */}
      {workflow.connectivity_mode === 'offline' && (
        <Badge className="gap-1 bg-amber-900 text-amber-300 border border-amber-700 pointer-events-none select-none">
          <Icons.WifiOff className="h-3 w-3" />
          OFFLINE
        </Badge>
      )}

      {/* Default model picker */}
      <div className="flex items-center gap-1.5">
        <Select
          value={workflow.default_model_config.provider}
          onValueChange={(v) =>
            setWorkflow({
              default_model_config: {
                ...workflow.default_model_config,
                provider: v as 'anthropic' | 'ollama',
                model: v === 'anthropic' ? 'claude-sonnet-4-5' : 'llama3.2',
              },
            })
          }
        >
          <SelectTrigger className="h-7 gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
            <SelectItem value="ollama" className="text-xs">Ollama</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={workflow.default_model_config.model}
          onValueChange={(v) =>
            setWorkflow({ default_model_config: { ...workflow.default_model_config, model: v } })
          }
        >
          <SelectTrigger className="h-7 gap-1 border border-border bg-transparent px-2 text-xs focus:ring-0">
            <Icons.Cpu className="h-3 w-3 text-muted-foreground" />
            <SelectValue>{modelLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {modelList.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Run status indicator */}
      {runStatus === 'completed' && (
        <span className="flex items-center gap-1 text-xs text-emerald-400">
          <Icons.CheckCircle2 className="h-3.5 w-3.5" />
          Completed
        </span>
      )}
      {runStatus === 'failed' && (
        <span className="flex items-center gap-1 text-xs text-red-400">
          <Icons.XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      )}
      {runStatus === 'awaiting_assignment' && (
        <span className="flex items-center gap-1 text-xs text-blue-400">
          <Icons.Users className="h-3.5 w-3.5" />
          Awaiting speakers
        </span>
      )}

      {/* Save */}
      <Button variant="outline" size="sm" onClick={handleSave} className="h-8 text-xs">
        <Icons.Save className="mr-1.5 h-3.5 w-3.5" />
        Save
      </Button>

      {/* Run */}
      <Button
        variant={runCfg.variant}
        size="sm"
        onClick={handleRun}
        disabled={runStatus === 'running'}
        className="h-8 text-xs"
      >
        <RunIcon className={cn('mr-1.5 h-3.5 w-3.5', runCfg.spin && 'animate-spin')} />
        {runCfg.label}
      </Button>
    </header>
  )
}
