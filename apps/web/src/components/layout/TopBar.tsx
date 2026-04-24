import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { useOllamaModels } from '@/hooks/useOllamaModels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { BatchRunModal } from '@/components/modals/BatchRunModal'
import { RunTriggerModal } from '@/components/modals/RunTriggerModal'
import { ScheduleModal } from '@/components/modals/ScheduleModal'
import { triggerRun } from '@/lib/runWorkflow'
import { useCurrentUser } from '@/hooks/useCurrentUser'

const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-7',            label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6',          label: 'Sonnet 4.6' },
  { value: 'claude-sonnet-4-5',          label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Haiku 4.5' },
]
const OPENAI_MODELS = [
  { value: 'gpt-4o',       label: 'GPT-4o' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo',  label: 'GPT-4 Turbo' },
  { value: 'o1-mini',      label: 'o1 Mini' },
]
const OLLAMA_MODELS = [
  { value: 'gemma4:e4b',    label: 'Gemma 4 E4B' },
  { value: 'llama3.1:70b',  label: 'Llama 3.1 70B' },
  { value: 'gemma3:12b',    label: 'Gemma 3 12B' },
  { value: 'gemma3:4b',     label: 'Gemma 3 4B' },
  { value: 'llama3.1:8b',   label: 'Llama 3.1 8B' },
  { value: 'llama3.2',      label: 'Llama 3.2 3B' },
  { value: 'mistral',       label: 'Mistral 7B' },
  { value: 'phi3',          label: 'Phi-3' },
]

function defaultModelForProvider(provider: string) {
  if (provider === 'openai') return 'gpt-4o'
  if (provider === 'ollama') return 'llama3.2'
  return 'claude-sonnet-4-5'
}

export async function pollRunUntilTerminal(runId: string) {
  const POLL_INTERVAL_MS = 2000
  const MAX_POLLS = 600 // 20 minutes max

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const store = useWorkflowStore.getState()
    // Stop polling if user manually reset status
    if (store.runStatus === 'idle') return

    const pollRes = await apiFetch(`/api/v1/runs/${runId}`)
    if (!pollRes.ok) {
      console.error('[run] poll failed:', pollRes.status)
      store.setRunError(`Could not fetch run status (HTTP ${pollRes.status})`)
      store.setRunStatus('failed')
      return
    }

    const body = await pollRes.json() as {
      data: {
        status: string
        nodeStatuses?: Record<string, unknown>
        finalOutput?: unknown
        pendingSessionId?: string | null
        pendingReviewNodeId?: string | null
        pendingReviewContent?: string | null
        errorMessage?: string | null
        detectionState?: Record<string, { retryCount: number; lastScore: number; scoreHistory: number[] }> | null
      }
    }
    const data = body.data
    console.log('[run] poll', i + 1, '— status:', data.status)

    if (data.detectionState) {
      const history: Record<string, number[]> = {}
      for (const [nodeId, ds] of Object.entries(data.detectionState)) {
        if (Array.isArray(ds.scoreHistory) && ds.scoreHistory.length > 0) {
          history[nodeId] = ds.scoreHistory
        }
      }
      if (Object.keys(history).length > 0) store.setDetectionScoreHistory(history)
    }

    if (data.nodeStatuses) {
      const nodeStatuses = data.nodeStatuses as Parameters<typeof store.setNodeRunStatuses>[0]
      store.setNodeRunStatuses(nodeStatuses)

      // Persist generated assets into node.data so they survive page reloads
      const ASSET_SUBTYPES = new Set(['image-generation', 'video-generation'])
      const AUDIO_SUBTYPES = new Set(['voice-output', 'music-generation', 'audio-mix'])
      for (const [nodeId, raw] of Object.entries(nodeStatuses)) {
        const ns = raw as { status: string; output?: Record<string, unknown> }
        if (ns.status !== 'passed' && ns.status !== 'skipped') continue
        const { nodes, updateNodeData } = useWorkflowStore.getState()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node) continue
        const cfg = (node.data?.config as Record<string, unknown>) ?? {}
        const subtype = (node.data?.subtype as string) ?? (cfg.subtype as string)

        if (ASSET_SUBTYPES.has(subtype) && ns.output?.assets) {
          if (ns.status === 'passed') {
            // New generation — move previous primary asset into run_history (keep last 3)
            const history = (cfg.run_history as Array<{ localPath: string; type: string; timestamp: string }>) ?? []
            const prevPrimary = (cfg.stored_assets as Array<{ localPath: string }> | undefined)?.[0]
            const updatedHistory = prevPrimary
              ? [...history, {
                  localPath: prevPrimary.localPath,
                  type: subtype === 'video-generation' ? 'video' : 'image',
                  timestamp: new Date().toISOString(),
                }].slice(-3)
              : history
            updateNodeData(nodeId, { config: { ...cfg, stored_assets: ns.output.assets, run_history: updatedHistory } })
          } else {
            updateNodeData(nodeId, { config: { ...cfg, stored_assets: ns.output.assets } })
          }
        } else if (AUDIO_SUBTYPES.has(subtype) && ns.output?.localPath) {
          // Persist audio output so the lock/skip feature can replay it
          updateNodeData(nodeId, { config: { ...cfg, stored_output: ns.output } })
        }
      }
    }

    if (data.status === 'completed') {
      if (data.finalOutput !== undefined) store.setFinalOutput(data.finalOutput)
      store.setRunStatus('completed')
      return
    }
    if (data.status === 'failed') {
      // Mark any node still showing 'running' as failed so the glow clears
      const currentStatuses = useWorkflowStore.getState().nodeRunStatuses
      const patched = Object.fromEntries(
        Object.entries(currentStatuses).map(([nid, ns]) => [
          nid,
          (ns as { status: string }).status === 'running'
            ? { ...(ns as object), status: 'failed', error: data.errorMessage ?? 'Run failed' }
            : ns,
        ])
      )
      store.setNodeRunStatuses(patched as Parameters<typeof store.setNodeRunStatuses>[0])
      store.setRunStatus('failed')
      if (data.errorMessage) store.setRunError(data.errorMessage)
      return
    }
    if (data.status === 'waiting_review') {
      store.setPendingReview(runId, data.pendingReviewContent ?? '')
      store.setRunStatus('waiting_review')
      return
    }
    if (data.status === 'waiting_feedback' || data.status === 'awaiting_assignment') {
      if (data.pendingSessionId) store.setPendingTranscriptionSessionId(data.pendingSessionId)
      store.setRunStatus('awaiting_assignment')
      return
    }
  }

  console.warn('[run] timed out after max polls')
  useWorkflowStore.getState().setRunError('Run timed out — the workflow took too long to complete.')
  useWorkflowStore.getState().setRunStatus('failed')
}

// ─── Assignee Picker ──────────────────────────────────────────────────────────

interface TeamMember { id: string; name: string | null; email: string }

function AssigneePicker() {
  const workflow = useWorkflowStore((s) => s.workflow)
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow)
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const loadMembers = useCallback(() => {
    apiFetch('/api/v1/team')
      .then((r) => r.json())
      .then(({ data }) => setMembers(data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    loadMembers()
  }, [open, loadMembers])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const assign = async (member: TeamMember | null) => {
    setSaving(true)
    setOpen(false)
    const newId = member?.id ?? null
    const newName = member?.name ?? null
    setWorkflow({ defaultAssigneeId: newId, defaultAssigneeName: newName })
    if (workflow.id) {
      try {
        await apiFetch(`/api/v1/workflows/${workflow.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ defaultAssigneeId: newId }),
        })
      } catch {
        // non-critical — store already updated optimistically
      }
    }
    setSaving(false)
  }

  const assigneeName = workflow.defaultAssigneeName
  const initials = assigneeName
    ? assigneeName.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={assigneeName ? `Assigned to ${assigneeName}` : 'Set default assignee'}
        className={cn(
          'relative flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
          assigneeName
            ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'
            : 'border-orange-400 bg-orange-50 text-orange-600 hover:bg-orange-100',
        )}
        style={!assigneeName ? { boxShadow: '0 0 0 2px rgba(249,115,22,0.3), 0 0 10px 3px rgba(249,115,22,0.25)' } : undefined}
      >
        {saving ? (
          <Icons.Loader2 className="h-3 w-3 animate-spin" />
        ) : initials ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 text-[8px] font-bold text-white">
            {initials}
          </span>
        ) : (
          <Icons.UserCircle className="h-3.5 w-3.5" />
        )}
        {assigneeName ?? 'Assign'}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-white shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Default Assignee</p>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {/* Unassign option */}
            {assigneeName && (
              <button
                onClick={() => assign(null)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
              >
                <Icons.UserX className="h-3.5 w-3.5 shrink-0" />
                Unassign
              </button>
            )}
            {members.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
            )}
            {members.map((m) => {
              const mi = m.name
                ? m.name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
                : m.email[0].toUpperCase()
              const isSelected = m.id === workflow.defaultAssigneeId
              return (
                <button
                  key={m.id}
                  onClick={() => assign(m)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                    isSelected ? 'bg-violet-50 text-violet-700' : 'text-foreground hover:bg-accent',
                  )}
                >
                  <span className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                    isSelected ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground',
                  )}>
                    {mi}
                  </span>
                  <div className="min-w-0 text-left">
                    <p className="truncate font-medium">{m.name ?? m.email}</p>
                  </div>
                  {isSelected && <Icons.Check className="ml-auto h-3 w-3 text-violet-600 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const RUN_STATUS_CONFIG = {
  idle:                { label: 'Run',        icon: Icons.Play,     variant: 'default' as const,      spin: false },
  running:             { label: 'Running…',   icon: Icons.Loader2,  variant: 'secondary' as const,    spin: true  },
  completed:           { label: 'Run',        icon: Icons.Play,     variant: 'default' as const,      spin: false },
  failed:              { label: 'Retry',      icon: Icons.RotateCcw, variant: 'destructive' as const, spin: false },
  awaiting_assignment: { label: 'Assign…',    icon: Icons.Users,       variant: 'secondary' as const,   spin: false },
  waiting_review:      { label: 'Review…',    icon: Icons.ClipboardCheck, variant: 'secondary' as const, spin: false },
}

function RunFailedBanner({ error }: { error: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const msg = error ?? 'The workflow run failed with no additional details.'
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
      >
        <Icons.XCircle className="h-3.5 w-3.5 shrink-0" />
        Run failed
        {expanded ? <Icons.ChevronUp className="h-3 w-3" /> : <Icons.ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="absolute top-14 right-4 z-50 w-[420px] rounded-lg border border-red-200 bg-white shadow-xl p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-red-700">
              <Icons.XCircle className="h-4 w-4 shrink-0" />
              Workflow run failed
            </div>
            <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-red-800 bg-red-50 rounded p-3 font-mono break-words whitespace-pre-wrap leading-relaxed">
            {msg}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Check the failed node on the canvas for more details.</p>
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  const { workflow, setWorkflowName, setWorkflow, runStatus, runError, hasBeenRun, activeRunId } = useWorkflowStore()
  const navigate = useNavigate()
  const { isLead } = useCurrentUser()
  const [lockSaving, setLockSaving] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchToast, setBatchToast] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateToast, setDuplicateToast] = useState<{ name: string; id: string } | null>(null)

  // Listen for save dialog trigger from WorkflowEditor's leave-warning modal
  useEffect(() => {
    const handler = () => setSaveDialogOpen(true)
    window.addEventListener('contentnode:open-save-dialog', handler)
    return () => window.removeEventListener('contentnode:open-save-dialog', handler)
  }, [])
  const [saveToast, setSaveToast] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleNew = () => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      runStatus: 'idle',
      nodeRunStatuses: {},
      activeRunId: null,
      hasBeenRun: false,
      workflow: {
        id: null,
        name: 'Untitled Workflow',
        clientId: null,
        clientName: null,
        connectivity_mode: 'online',
        default_model_config: { provider: 'anthropic', model: 'claude-sonnet-4-5', temperature: 0.7 },
      },
    })
    navigate('/workflows/new')
  }

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(workflow.name)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [pendingRunAfterSave, setPendingRunAfterSave] = useState(false)
  const [runTriggerOpen, setRunTriggerOpen] = useState(false)
  const [pendingTopic, setPendingTopic] = useState('')
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)

  // Keep nameValue in sync when a different workflow is loaded
  useEffect(() => {
    setNameValue(workflow.name)
  }, [workflow.id])

  const commitName = async () => {
    const trimmed = nameValue.trim() || 'Untitled Workflow'
    setWorkflowName(trimmed)
    setNameValue(trimmed)
    setEditingName(false)
    // Auto-save name to API immediately
    const wf = useWorkflowStore.getState().workflow
    if (wf.id && trimmed !== wf.name) {
      try {
        await apiFetch(`/api/v1/workflows/${wf.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: trimmed }),
        })
      } catch (err) {
        console.error('[save-name] failed:', err)
      }
    }
  }

  const handleToggleLock = async () => {
    const wf = useWorkflowStore.getState().workflow
    if (!wf.id) return
    const next = !wf.isLocked
    setLockSaving(true)
    try {
      await apiFetch(`/api/v1/workflows/${wf.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isLocked: next }),
      })
      setWorkflow({ isLocked: next })
    } catch (err) {
      console.error('[lock-workflow] failed:', err)
    } finally {
      setLockSaving(false)
    }
  }

  const handleToggleTemplate = async () => {
    const wf = useWorkflowStore.getState().workflow
    if (!wf.id) return
    const next = !wf.isTemplate
    setTemplateSaving(true)
    try {
      await apiFetch(`/api/v1/workflows/${wf.id}/promote-template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          isTemplate: next,
          templateCategory: wf.templateCategory ?? 'general',
          templateDescription: wf.templateDescription ?? wf.name,
        }),
      })
      setWorkflow({ isTemplate: next })
    } catch (err) {
      console.error('[promote-template] failed:', err)
    } finally {
      setTemplateSaving(false)
    }
  }

  const runCfg = RUN_STATUS_CONFIG[runStatus]
  const RunIcon = runCfg.icon
  const isOfflineWf = workflow.connectivity_mode === 'offline'
  const modelList = isOfflineWf ? OLLAMA_MODELS
    : workflow.default_model_config.provider === 'openai' ? OPENAI_MODELS
    : workflow.default_model_config.provider === 'anthropic' ? ANTHROPIC_MODELS
    : OLLAMA_MODELS
  const modelLabel = modelList.find((m) => m.value === workflow.default_model_config.model)?.label
    ?? workflow.default_model_config.model
  const ollamaOptions = useOllamaModels()

  const handleDuplicate = async (name: string, clientId: string) => {
    const { workflow: wf, nodes, edges } = useWorkflowStore.getState()
    const r1 = await apiFetch('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name,
        clientId,
        connectivityMode: wf.connectivity_mode ?? 'online',
        defaultModelConfig: wf.default_model_config,
      }),
    })
    if (!r1.ok) throw new Error(`POST workflow ${r1.status}`)
    const { data: newWf } = await r1.json()
    const r2 = await apiFetch(`/api/v1/workflows/${newWf.id}/graph`, {
      method: 'PUT',
      body: JSON.stringify({ nodes, edges, name, defaultModelConfig: wf.default_model_config }),
    })
    if (!r2.ok) throw new Error(`PUT graph ${r2.status}`)
    // Stay on the current workflow — just show a toast with a link to the copy
    setDuplicateToast({ name, id: newWf.id })
    setTimeout(() => setDuplicateToast(null), 6000)
  }

  const handleRun = () => {
    if (runStatus === 'running') return
    setRunTriggerOpen(true)
  }

  const handleTopicConfirm = async (topic: string) => {
    setRunTriggerOpen(false)
    setPendingTopic(topic)
    const wf = useWorkflowStore.getState().workflow
    if (!wf.id) { setPendingRunAfterSave(true); setSaveDialogOpen(true); return }
    await triggerRun(undefined, topic)
    setPendingTopic('')
  }

  const handleSave = async (name: string, clientId: string, createNew = false) => {
    const { workflow: wf, nodes, edges } = useWorkflowStore.getState()
    if (!wf.id && !createNew) return
    try {
      if (createNew) {
        // Save As — create a brand new workflow and write this graph into it
        const r1 = await apiFetch('/api/v1/workflows', {
          method: 'POST',
          body: JSON.stringify({
            name,
            clientId,
            connectivityMode: wf.connectivity_mode ?? 'online',
            defaultModelConfig: wf.default_model_config,
          }),
        })
        if (!r1.ok) throw new Error(`POST workflow ${r1.status}`)
        const { data: newWf } = await r1.json()
        const r2 = await apiFetch(`/api/v1/workflows/${newWf.id}/graph`, {
          method: 'PUT',
          body: JSON.stringify({ nodes, edges, name, defaultModelConfig: wf.default_model_config }),
        })
        if (!r2.ok) throw new Error(`PUT graph ${r2.status}`)
        setWorkflow({ id: newWf.id, name, clientId, autoCreated: false, graphSaved: true })
        useWorkflowStore.setState({ graphDirty: false })
        setWorkflowName(name)
        // Update the URL bar without triggering a React Router route change.
        // Using navigate() would unmount+remount WorkflowEditor (different route
        // definition), blanking the canvas. replaceState avoids that entirely.
        window.history.replaceState(null, '', `/workflows/${newWf.id}`)
        setSaveToast({ ok: true, msg: `Saved as new — "${name}"` })
      } else {
        // Save over existing workflow
        const r1 = await apiFetch(`/api/v1/workflows/${wf.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, clientId }),
        })
        if (!r1.ok) throw new Error(`PATCH workflow ${r1.status}`)
        const r2 = await apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
          method: 'PUT',
          body: JSON.stringify({ nodes, edges, name, defaultModelConfig: wf.default_model_config }),
        })
        if (!r2.ok) throw new Error(`PUT graph ${r2.status}`)
        setWorkflow({ name, clientId, autoCreated: false, graphSaved: true })
        useWorkflowStore.setState({ graphDirty: false })
        setWorkflowName(name)
        setSaveToast({ ok: true, msg: `Saved — ${nodes.length} node${nodes.length !== 1 ? 's' : ''}` })
      }
    } catch (err) {
      console.error('[save] failed:', err)
      setSaveToast({ ok: false, msg: `Save failed: ${err instanceof Error ? err.message : 'unknown error'}` })
    }
    setTimeout(() => setSaveToast(null), 3500)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
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
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
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
        <Badge className="gap-1 bg-amber-100 text-amber-700 border border-amber-300 pointer-events-none select-none">
          <Icons.WifiOff className="h-3 w-3" />
          OFFLINE
        </Badge>
      )}

      {/* Default model picker — Ollama only in offline mode */}
      <div className="flex items-center gap-1.5">
        {workflow.connectivity_mode !== 'offline' && (
          <Select
            value={workflow.default_model_config.provider}
            onValueChange={(v) => {
              const model = v === 'ollama' && ollamaOptions.length > 0
                ? ollamaOptions[0].value
                : defaultModelForProvider(v)
              setWorkflow({
                default_model_config: {
                  ...workflow.default_model_config,
                  provider: v as 'anthropic' | 'openai' | 'ollama',
                  model,
                },
              })
            }}
          >
            <SelectTrigger className="h-7 gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
              <SelectItem value="openai" className="text-xs">OpenAI</SelectItem>
              <SelectItem value="ollama" className="text-xs">Ollama</SelectItem>
            </SelectContent>
          </Select>
        )}

        {(isOfflineWf || workflow.default_model_config.provider === 'ollama') ? (
          <Select
            value={workflow.default_model_config.model}
            onValueChange={(v) =>
              setWorkflow({
                default_model_config: { ...workflow.default_model_config, provider: 'ollama', model: v },
              })
            }
          >
            <SelectTrigger className="h-7 gap-1 border border-border bg-transparent px-2 text-xs focus:ring-0">
              <Icons.Cpu className="h-3 w-3 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ollamaOptions.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={workflow.default_model_config.model}
            onValueChange={(v) =>
              setWorkflow({
                default_model_config: {
                  ...workflow.default_model_config,
                  model: v,
                },
              })
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
        )}

      </div>

      {/* Promote to template (admin only) */}
      {workflow.id && isLead && (
        <button
          onClick={handleToggleTemplate}
          disabled={templateSaving}
          title={workflow.isTemplate ? 'Remove from org templates' : 'Save as org template — appears in New Workflow picker for all team members'}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
            workflow.isTemplate
              ? 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
              : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
          )}
        >
          {templateSaving
            ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
            : <Icons.Bookmark className="h-3 w-3" />
          }
          {workflow.isTemplate ? 'Template' : 'Save as Template'}
        </button>
      )}

      {/* Workflow lock */}
      {workflow.id && (
        isLead ? (
          <button
            onClick={handleToggleLock}
            disabled={lockSaving}
            title={workflow.isLocked ? 'Workflow is locked — click to unlock (admin only)' : 'Lock workflow structure (users can still edit node settings)'}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              workflow.isLocked
                ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {lockSaving
              ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
              : workflow.isLocked
                ? <Icons.Lock className="h-3 w-3" />
                : <Icons.LockOpen className="h-3 w-3" />
            }
            {workflow.isLocked ? 'Locked' : 'Lock'}
          </button>
        ) : workflow.isLocked ? (
          <span className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <Icons.Lock className="h-3 w-3" />
            Locked
          </span>
        ) : null
      )}

      {/* Project routing badge */}
      {workflow.id && (
        <button
          onClick={() => setProjectPickerOpen(true)}
          title="Set Monday group + Box project folder for this workflow's runs"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            (workflow.mondayGroupId || workflow.boxProjectFolderId)
              ? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
              : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
          )}
        >
          <Icons.FolderKanban className="h-3 w-3" />
          {workflow.mondayGroupName ?? workflow.boxProjectFolderId ? 'Project' : 'Set Project'}
        </button>
      )}

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
        <RunFailedBanner error={runError} />
      )}
      {runStatus === 'awaiting_assignment' && (
        <span className="flex items-center gap-1 text-xs text-blue-400">
          <Icons.Users className="h-3.5 w-3.5" />
          Awaiting speakers
        </span>
      )}
      {runStatus === 'waiting_review' && (
        <Button
          variant="secondary"
          size="sm"
          className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
          onClick={() => {
            const store = useWorkflowStore.getState()
            if (store.pendingReviewRunId) {
              store.setPendingReview(store.pendingReviewRunId, store.pendingReviewContent)
              store.setRunStatus('waiting_review')
            }
          }}
        >
          <Icons.ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
          Review &amp; Approve
        </Button>
      )}

      {/* Assign + Review — always paired together */}
      {workflow.id && (
        <div className="flex items-center gap-1.5">
          <AssigneePicker />
          {activeRunId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/review/${activeRunId}`)}
              className="h-8 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
            >
              <Icons.ClipboardEdit className="mr-1.5 h-3.5 w-3.5" />
              {runStatus === 'completed' ? 'Review' : 'Last Run'}
            </Button>
          )}
        </div>
      )}

      {/* History — only when workflow is saved */}
      {workflow.id && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.dispatchEvent(new CustomEvent('contentnode:open-history'))}
          className="h-8 text-xs text-muted-foreground hover:text-foreground"
        >
          <Icons.History className="mr-1.5 h-3.5 w-3.5" />
          History
        </Button>
      )}

      {/* New */}
      <Button variant="ghost" size="sm" onClick={handleNew} className="h-8 text-xs text-muted-foreground hover:text-foreground">
        <Icons.FilePlus className="mr-1.5 h-3.5 w-3.5" />
        New
      </Button>

      {/* Duplicate — only when workflow is saved */}
      {workflow.id && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDuplicateOpen(true)}
          className="h-8 text-xs text-muted-foreground hover:text-foreground"
          title="Save a copy as a template"
        >
          <Icons.Copy className="mr-1.5 h-3.5 w-3.5" />
          Duplicate
        </Button>
      )}

      {/* Save */}
      <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)} className="h-8 text-xs">
        <Icons.Save className="mr-1.5 h-3.5 w-3.5" />
        Save
      </Button>

      {/* Schedule — only when workflow is saved */}
      {workflow.id && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScheduleOpen(true)}
          className="h-8 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
        >
          <Icons.Clock className="mr-1.5 h-3.5 w-3.5" />
          Schedule
        </Button>
      )}

      {/* Batch Run — only when workflow is saved */}
      {workflow.id && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBatchModalOpen(true)}
          disabled={runStatus === 'running'}
          className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          <Icons.Layers className="mr-1.5 h-3.5 w-3.5" />
          Batch Run
        </Button>
      )}

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

      {/* Schedule modal */}
      {scheduleOpen && workflow.id && (
        <ScheduleModal workflowId={workflow.id} onClose={() => setScheduleOpen(false)} />
      )}

      {/* Batch Run modal */}
      {batchModalOpen && workflow.id && (
        <BatchRunModal
          workflowId={workflow.id}
          onClose={() => setBatchModalOpen(false)}
          onStarted={(batchId, count) => {
            setBatchModalOpen(false)
            setBatchToast(`Started ${count} run${count !== 1 ? 's' : ''} (batch ${batchId.slice(0, 8)}…)`)
            setTimeout(() => setBatchToast(null), 4000)
          }}
        />
      )}

      {/* Batch toast */}
      {batchToast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-700 shadow-lg">
          <Icons.CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
          {batchToast}
        </div>
      )}

      {/* Save toast */}
      {saveToast && (
        <div className={cn(
          'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs shadow-lg',
          saveToast.ok
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700',
        )}>
          {saveToast.ok
            ? <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            : <Icons.XCircle className="h-3.5 w-3.5 text-red-500" />}
          {saveToast.msg}
        </div>
      )}

      {/* Run trigger modal */}
      {runTriggerOpen && (
        <RunTriggerModal
          workflowName={workflow.name}
          onConfirm={handleTopicConfirm}
          onClose={() => setRunTriggerOpen(false)}
        />
      )}

      {/* Save dialog */}
      {saveDialogOpen && (
        <SaveWorkflowDialog
          onClose={() => setSaveDialogOpen(false)}
          onSave={async (name, clientId, createNew) => {
            await handleSave(name, clientId, createNew)
            setSaveDialogOpen(false)
            if (pendingRunAfterSave) {
              setPendingRunAfterSave(false)
              const topic = pendingTopic
              setPendingTopic('')
              await triggerRun(undefined, topic)
            }
          }}
        />
      )}

      {/* Duplicate dialog */}
      {duplicateOpen && (
        <SaveWorkflowDialog
          isDuplicate
          onClose={() => setDuplicateOpen(false)}
          onSave={async (name, clientId) => {
            await handleDuplicate(name, clientId)
            setDuplicateOpen(false)
          }}
        />
      )}

      {/* Project picker modal */}
      {projectPickerOpen && workflow.id && (
        <ProjectPickerModal
          workflowId={workflow.id}
          clientMondayBoardId={workflow.clientMondayBoardId ?? null}
          clientBoxFolderId={workflow.clientBoxFolderId ?? null}
          current={{
            mondayGroupId: workflow.mondayGroupId ?? null,
            mondayGroupName: workflow.mondayGroupName ?? null,
            boxProjectFolderId: workflow.boxProjectFolderId ?? null,
          }}
          onSave={(data) => {
            setWorkflow(data)
            setProjectPickerOpen(false)
            const wf = useWorkflowStore.getState().workflow
            if (wf.id) {
              apiFetch(`/api/v1/workflows/${wf.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  mondayGroupId: data.mondayGroupId ?? null,
                  mondayGroupName: data.mondayGroupName ?? null,
                  boxProjectFolderId: data.boxProjectFolderId ?? null,
                }),
              }).catch(() => {})
            }
          }}
          onClose={() => setProjectPickerOpen(false)}
        />
      )}

      {/* Duplicate toast */}
      {duplicateToast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700 shadow-lg">
          <Icons.Copy className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>Duplicated as <span className="font-semibold">"{duplicateToast.name}"</span></span>
          <button
            onClick={() => { navigate(`/workflows/${duplicateToast.id}`); setDuplicateToast(null) }}
            className="ml-1 font-semibold underline underline-offset-2 hover:text-emerald-900"
          >
            Open
          </button>
          <button onClick={() => setDuplicateToast(null)} className="text-emerald-400 hover:text-emerald-700">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </header>
  )
}

// ─── Save Workflow Dialog ──────────────────────────────────────────────────────

interface Client { id: string; name: string }

function SaveWorkflowDialog({
  onClose,
  onSave,
  isDuplicate = false,
}: {
  onClose: () => void
  onSave: (name: string, clientId: string, createNew: boolean) => Promise<void>
  isDuplicate?: boolean
}) {
  const { workflow } = useWorkflowStore()
  const defaultName = isDuplicate
    ? `Copy of ${workflow.name || 'Untitled Workflow'}`
    : workflow.name || 'Untitled Workflow'
  const [name, setName] = useState(defaultName)
  const [clientId, setClientId] = useState(workflow.clientId ?? '')
  const [clients, setClients] = useState<Client[]>([])
  const [saving, setSaving] = useState(false)

  // createNew when no workflow exists yet OR when duplicating
  const createNew = !workflow.id || isDuplicate

  useEffect(() => {
    apiFetch('/api/v1/clients')
      .then((r) => r.json())
      .then(({ data }) => {
        const active = (data ?? []).filter((c: Client & { status: string }) => c.status !== 'archived')
        setClients(active)
        if (!clientId && active.length > 0) setClientId(active[0].id)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = async () => {
    if (!clientId) return
    setSaving(true)
    try {
      await onSave(name.trim() || 'Untitled Workflow', clientId, createNew)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[440px] rounded-xl border border-border bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Purple header */}
        <div className="rounded-t-xl px-6 py-5 flex items-center justify-between" style={{ backgroundColor: '#a200ee' }}>
          <div className="flex items-center gap-2">
            {isDuplicate
              ? <Icons.Copy className="h-5 w-5 text-white/80" />
              : <Icons.Save className="h-5 w-5 text-white/80" />}
            <h2 className="text-base font-semibold text-white">
              {isDuplicate ? 'Duplicate Workflow' : 'Save Workflow'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-white/60 hover:text-white hover:bg-white/20 transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Workflow Name</label>
            <input
              autoFocus
              className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            {isDuplicate ? (
              <p className="flex items-center gap-1.5 text-[11px]" style={{ color: '#7a00b4' }}>
                <Icons.Copy className="h-3 w-3 shrink-0" />
                A copy will be created. You'll stay on the original.
              </p>
            ) : createNew ? (
              <p className="flex items-center gap-1.5 text-[11px]" style={{ color: '#7a00b4' }}>
                <Icons.Copy className="h-3 w-3 shrink-0" />
                A new workflow will be created.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Client</label>
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !clientId}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#a200ee' }}
          >
            {saving
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : createNew
                ? <Icons.Copy className="h-3.5 w-3.5" />
                : <Icons.Check className="h-3.5 w-3.5" />}
            {saving ? (isDuplicate ? 'Duplicating…' : 'Saving…') : isDuplicate ? 'Duplicate' : createNew ? 'Save as New Workflow' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Project Picker Modal ──────────────────────────────────────────────────────

interface ProjectPickerModalProps {
  workflowId: string
  clientMondayBoardId: string | null
  clientBoxFolderId: string | null
  current: {
    mondayGroupId: string | null
    mondayGroupName: string | null
    boxProjectFolderId: string | null
  }
  onSave: (data: { mondayGroupId?: string | null; mondayGroupName?: string | null; boxProjectFolderId?: string | null }) => void
  onClose: () => void
}

function ProjectPickerModal({
  clientMondayBoardId,
  clientBoxFolderId,
  current,
  onSave,
  onClose,
}: ProjectPickerModalProps) {
  const [mondayGroups, setMondayGroups] = useState<{ id: string; title: string }[]>([])
  const [boxFolders, setBoxFolders] = useState<{ id: string; name: string }[]>([])
  const [selectedMondayGroupId, setSelectedMondayGroupId] = useState(current.mondayGroupId ?? '')
  const [selectedMondayGroupName, setSelectedMondayGroupName] = useState(current.mondayGroupName ?? '')
  const [selectedBoxFolderId, setSelectedBoxFolderId] = useState(current.boxProjectFolderId ?? '')
  // When no client root folder is set, let user pick from the top-level Box root
  const [selectedClientBoxRootId, setSelectedClientBoxRootId] = useState(clientBoxFolderId ?? '')
  const [loadingMonday, setLoadingMonday] = useState(false)
  const [loadingBox, setLoadingBox] = useState(false)

  useEffect(() => {
    if (!clientMondayBoardId) return
    setLoadingMonday(true)
    apiFetch(`/api/v1/integrations/monday/boards/${clientMondayBoardId}/groups`)
      .then((r) => r.json())
      .then(({ data }) => { setMondayGroups(data ?? []) })
      .catch(() => {})
      .finally(() => setLoadingMonday(false))
  }, [clientMondayBoardId])

  // If client root is set, load its subfolders. Otherwise load top-level Box root folders.
  const boxRootId = selectedClientBoxRootId || clientBoxFolderId || ''
  useEffect(() => {
    setLoadingBox(true)
    const url = boxRootId
      ? `/api/v1/integrations/box/folders/${boxRootId}/subfolders`
      : `/api/v1/integrations/box/root-subfolders`
    apiFetch(url)
      .then((r) => r.json())
      .then(({ data }) => { setBoxFolders(data ?? []) })
      .catch(() => {})
      .finally(() => setLoadingBox(false))
  }, [boxRootId])

  const handleSave = () => {
    const group = mondayGroups.find((g) => g.id === selectedMondayGroupId)
    // If client had no root folder and user picked one, save it as the client root
    if (!clientBoxFolderId && selectedClientBoxRootId) {
      const wf = useWorkflowStore.getState().workflow
      if (wf.clientId) {
        apiFetch(`/api/v1/clients/${wf.clientId}`, {
          method: 'PATCH',
          body: JSON.stringify({ boxFolderId: selectedClientBoxRootId }),
        }).catch(() => {})
      }
    }
    onSave({
      mondayGroupId: selectedMondayGroupId || null,
      mondayGroupName: (group?.title ?? selectedMondayGroupName) || null,
      boxProjectFolderId: selectedBoxFolderId || null,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-white border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Icons.FolderKanban className="h-4 w-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-foreground">Project Routing</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Monday group */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Icons.LayoutGrid className="h-3 w-3" />
              Monday Group
            </label>
            {!clientMondayBoardId ? (
              <p className="text-xs text-muted-foreground italic">No Monday board connected to this client.</p>
            ) : loadingMonday ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icons.Loader2 className="h-3 w-3 animate-spin" />Loading groups…
              </div>
            ) : mondayGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No groups found.</p>
            ) : (
              <Select value={selectedMondayGroupId || '__none__'} onValueChange={(v) => setSelectedMondayGroupId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select group…" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">— None —</SelectItem>
                  {mondayGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">{g.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[10px] text-muted-foreground">New Monday items from this workflow will be created in this group.</p>
          </div>

          {/* Box project folder */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Icons.Box className="h-3 w-3" />
              Box Project Folder
            </label>
            {loadingBox ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icons.Loader2 className="h-3 w-3 animate-spin" />Loading folders…
              </div>
            ) : !clientBoxFolderId ? (
              <>
                <p className="text-[10px] text-amber-600">No client root folder set — pick one to link it:</p>
                <Select value={selectedClientBoxRootId || '__none__'} onValueChange={(v) => { setSelectedClientBoxRootId(v === '__none__' ? '' : v); setSelectedBoxFolderId('') }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select client root folder…" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectItem value="__none__" className="text-xs text-muted-foreground">— None —</SelectItem>
                    {boxFolders.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <Select value={selectedBoxFolderId || '__none__'} onValueChange={(v) => setSelectedBoxFolderId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select project folder…" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">— None (use client root) —</SelectItem>
                  {boxFolders.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[10px] text-muted-foreground">Run output folders will be created inside this project folder.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>
            <Icons.Check className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
