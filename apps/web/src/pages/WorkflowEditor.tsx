import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { TopBar, pollRunUntilTerminal } from '@/components/layout/TopBar'
import { NodePalette } from '@/components/layout/NodePalette'
import { ConfigPanel } from '@/components/layout/ConfigPanel'
import { WorkflowCanvas } from '@/components/canvas/WorkflowCanvas'
import { WorkflowCreationModal } from '@/components/modals/WorkflowCreationModal'
import { SpeakerAssignmentPanel } from '@/components/transcription/SpeakerAssignmentPanel'
import { InsightConfirmationBanner } from '@/components/insights/InsightConfirmationBanner'
import { HumanReviewPanel } from '@/components/review/HumanReviewPanel'
import { RunHistoryPanel } from '@/components/layout/RunHistoryPanel'
import { AlignmentToolbar } from '@/components/canvas/AlignmentToolbar'
import { RunNamingPanel } from '@/components/canvas/RunNamingPanel'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export function WorkflowEditor() {
  const { workflowId } = useParams<{ workflowId?: string }>()
  const [searchParams] = useSearchParams()
  const defaultClientId = searchParams.get('clientId') ?? undefined
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const connectivity_mode = useWorkflowStore((s) => s.workflow.connectivity_mode)
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const activeRunId = useWorkflowStore((s) => s.activeRunId)
  const pendingTranscriptionSessionId = useWorkflowStore((s) => s.pendingTranscriptionSessionId)
  const setPendingTranscriptionSessionId = useWorkflowStore((s) => s.setPendingTranscriptionSessionId)
  const pendingReviewRunId = useWorkflowStore((s) => s.pendingReviewRunId)
  const pendingReviewContent = useWorkflowStore((s) => s.pendingReviewContent)
  const setPendingReview = useWorkflowStore((s) => s.setPendingReview)
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus)

  const workflow = useWorkflowStore((s) => s.workflow)
  const nodes = useWorkflowStore((s) => s.nodes)
  const canvasTool = useWorkflowStore((s) => s.canvasTool)
  const setCanvasTool = useWorkflowStore((s) => s.setCanvasTool)
  const insightConfirmations = useWorkflowStore((s) => s.insightConfirmations)
  const addInsightConfirmation = useWorkflowStore((s) => s.addInsightConfirmation)

  // When opened with a specific workflow ID, load it into the store
  const [loadingWorkflow, setLoadingWorkflow] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(!workflowId)

  // Reset canvas when creating a new workflow
  useEffect(() => {
    if (!workflowId) {
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
          connectivity_mode: 'online',
          default_model_config: { provider: 'anthropic', model: 'claude-sonnet-4-5', temperature: 0.7 },
        },
      })
    }
  }, [workflowId])

  // Load workflow by ID when navigated from client page
  useEffect(() => {
    if (!workflowId) return
    setLoadingWorkflow(true)
    setLoadError(null)
    apiFetch(`/api/v1/workflows/${workflowId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(({ data }) => {
        if (!data) throw new Error('Workflow not found')
        const store = useWorkflowStore.getState()
        // Convert DB nodes → React Flow nodes
        const rfNodes = (data.nodes ?? []).map((n: Record<string, unknown>) => {
          const dbConfig = (n.config as Record<string, unknown>) ?? {}
          return {
            id: n.id as string,
            type: n.type as string,
            position: { x: (n.positionX as number) ?? 0, y: (n.positionY as number) ?? 0 },
            data: {
              label: n.label as string,
              // Spread config fields at top level (for display/compat) AND
              // keep nested `config` so the Run save path always finds it
              ...dbConfig,
              config: dbConfig,
            },
          }
        })
        const rfEdges = (data.edges ?? []).map((e: Record<string, unknown>) => ({
          id: e.id as string,
          source: e.sourceNodeId as string,
          target: e.targetNodeId as string,
          label: e.label as string | undefined,
          animated: false,
        }))
        store.onNodesChange(rfNodes.map((n: { id: string }) => ({ type: 'reset' as const, item: n })))
        store.setWorkflow({
          id: data.id as string,
          name: data.name as string,
          clientId: (data.clientId as string | null) ?? null,
          connectivity_mode: (data.connectivityMode as 'online' | 'offline') ?? 'online',
          graphSaved: true,
        })
        useWorkflowStore.setState({ graphDirty: false })
        // Use internal React Flow method to set nodes/edges directly
        useWorkflowStore.setState({ nodes: rfNodes, edges: rfEdges })
        store.setRunStatus('idle')
        useWorkflowStore.setState({ nodeRunStatuses: {} })

        // Load client-scoped file bindings and merge into node configs
        const clientId = (data.clientId as string | null) ?? ''
        const filesUrl = clientId
          ? `/api/v1/workflows/${data.id}/files?clientId=${encodeURIComponent(clientId)}`
          : `/api/v1/workflows/${data.id}/files`
        apiFetch(filesUrl)
          .then((r) => r.json())
          .then(({ data: filesByNode }: { data: Record<string, Record<string, unknown>> }) => {
            if (!filesByNode || Object.keys(filesByNode).length === 0) return
            useWorkflowStore.setState(state => ({
              nodes: state.nodes.map(n => {
                const nodeFiles = filesByNode[n.id]
                if (!nodeFiles) return n
                const cfg = (n.data.config as Record<string, unknown>) ?? {}
                const newCfg = { ...cfg, ...nodeFiles }
                return { ...n, data: { ...n.data, ...newCfg, config: newCfg } }
              }),
            }))
          })
          .catch(() => {})

        // Restore last completed run's node outputs so File Export / Display nodes
        // show their content even after navigating away and back
        apiFetch(`/api/v1/runs?workflowId=${data.id}&status=completed&limit=1`)
          .then((r) => r.json())
          .then(({ data: runs }) => {
            const last = (runs ?? [])[0]
            if (!last) return
            const nodeStatuses = (last.output as Record<string, unknown>)?.nodeStatuses as Record<string, unknown> | undefined
            if (nodeStatuses && Object.keys(nodeStatuses).length > 0) {
              useWorkflowStore.getState().setNodeRunStatuses(nodeStatuses as Record<string, { status: 'idle' | 'running' | 'passed' | 'failed' | 'skipped'; output?: unknown }>)
              useWorkflowStore.getState().setRunStatus('completed')
              useWorkflowStore.setState({ activeRunId: last.id })
            }
          })
          .catch(() => {})
      })
      .catch((err) => {
        console.error('[load workflow]', err)
        setLoadError(err instanceof Error ? err.message : 'Failed to load workflow')
      })
      .finally(() => setLoadingWorkflow(false))
  }, [workflowId])

  // Poll applied insights for completion notifications (every 30s when run completes)
  useEffect(() => {
    const insightNodeIds = nodes
      .filter((n) => n.type === 'insight')
      .map((n) => (n.data.config as Record<string, unknown>)?.insight_id as string)
      .filter(Boolean)

    if (insightNodeIds.length === 0) return

    const check = async () => {
      for (const insightId of insightNodeIds) {
        try {
          const res = await fetch(`${API_URL}/api/v1/insights/${insightId}`)
          if (!res.ok) continue
          const { data } = await res.json()
          if (!data) continue

          // Show confirmation if: applied status, 3+ runs, score improved, not already showing
          if (
            data.status === 'applied' &&
            data.appliedRunCount >= 3 &&
            data.postApplicationScore !== null &&
            data.baselineScore !== null &&
            data.postApplicationScore > data.baselineScore &&
            (data.dismissedUntilRun === null || data.appliedRunCount >= data.dismissedUntilRun) &&
            !insightConfirmations.find((c) => c.insightId === insightId)
          ) {
            // Get primary stakeholder name from evidence quotes
            const firstQuote = (data.evidenceQuotes as Array<{ stakeholderName?: string }>)[0]
            addInsightConfirmation({
              insightId,
              connectedNodeId: data.connectedNodeId ?? '',
              patternDescription: data.title,
              stakeholderName: firstQuote?.stakeholderName ?? 'stakeholder',
              appliedRunCount: data.appliedRunCount,
            })
          }
        } catch {
          // Non-critical
        }
      }
    }

    void check()
    const interval = setInterval(() => void check(), 30_000)
    return () => clearInterval(interval)
  }, [runStatus, nodes, insightConfirmations, addInsightConfirmation])

  const handleAssignmentComplete = () => {
    setPendingTranscriptionSessionId(null)
    // Resume polling — the run continues after assignment
    const { activeRunId } = useWorkflowStore.getState()
    if (activeRunId) {
      setRunStatus('running')
      void pollRunUntilTerminal(activeRunId)
    }
  }

  const handleAssignmentDismiss = () => {
    setPendingTranscriptionSessionId(null)
    setRunStatus('idle')
  }

  const isAutoCreated = !!(workflow.autoCreated && workflow.id)
  const navigate = useNavigate()

  // (auto-delete on unmount removed — too risky, could silently destroy user work)

  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    const handler = () => setHistoryOpen(true)
    window.addEventListener('contentnode:open-history', handler)
    return () => window.removeEventListener('contentnode:open-history', handler)
  }, [])

  const graphDirty = useWorkflowStore((s) => s.graphDirty)

  // Auto-save 2 seconds after any change to a saved workflow
  useEffect(() => {
    if (!graphDirty || !workflow.id) return
    const timer = setTimeout(async () => {
      const { nodes, edges, workflow: wf } = useWorkflowStore.getState()
      if (!wf.id) return
      try {
        await apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
          method: 'PUT',
          body: JSON.stringify({ nodes, edges, name: wf.name, defaultModelConfig: wf.default_model_config }),
        })
        useWorkflowStore.setState({ graphDirty: false })
        useWorkflowStore.getState().setWorkflow({ graphSaved: true })
      } catch {
        // silent — user can still save manually
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [graphDirty, workflow.id])

  // Warn on browser close/refresh when there are unsaved changes
  const isUnsaved = !!(workflow.id && (!workflow.graphSaved || graphDirty))
  useEffect(() => {
    if (!isUnsaved) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isUnsaved])

  const handleOpenSaveDialog = useCallback(() => {
    window.dispatchEvent(new CustomEvent('contentnode:open-save-dialog'))
  }, [])

  if (loadingWorkflow) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <Icons.AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Couldn't load workflow</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        </div>
        <button
          onClick={() => navigate('/workflows')}
          className="rounded-md border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
        >
          Back to workflows
        </button>
      </div>
    )
  }

  return (
    <>
      {showModal && (
        <WorkflowCreationModal
          onClose={() => setShowModal(false)}
          onDismiss={() => navigate(-1)}
          defaultClientId={defaultClientId}
        />
      )}

      {runStatus === 'waiting_review' && pendingReviewRunId && (
        <HumanReviewPanel
          runId={pendingReviewRunId}
          initialContent={pendingReviewContent ?? ''}
          onComplete={() => {
            setPendingReview(null, null)
            const { activeRunId } = useWorkflowStore.getState()
            if (activeRunId) {
              setRunStatus('running')
              void pollRunUntilTerminal(activeRunId)
            }
          }}
          onDismiss={() => {
            setPendingReview(null, null)
            setRunStatus('idle')
          }}
        />
      )}

      {/* Speaker assignment overlay */}
      {runStatus === 'awaiting_assignment' && pendingTranscriptionSessionId && (
        <SpeakerAssignmentPanel
          sessionId={pendingTranscriptionSessionId}
          onComplete={handleAssignmentComplete}
          onDismiss={handleAssignmentDismiss}
        />
      )}

      <div className="flex h-full flex-col overflow-hidden bg-background">
        <TopBar />
        {isAutoCreated && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-700 shrink-0">
            <Icons.AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Auto-created during a run — not saved yet. Give it a name to keep it.</span>
            <button
              onClick={handleOpenSaveDialog}
              className="ml-auto rounded-md bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-0.5 font-medium transition-colors"
            >
              Save Now
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          <NodePalette />
          <main className="relative flex-1 overflow-hidden">
            <WorkflowCanvas />

            {/* Top-center HUD: shows workflow name pill normally, alignment toolbar when 2+ nodes selected */}
            <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2">
              <AlignmentToolbar workflowName={workflow.name ?? undefined} />
            </div>

            {/* Top-left: pointer / hand tool switcher */}
            <div className="pointer-events-auto absolute top-3 left-3 z-20 flex gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
              <button
                title="Select (V)"
                onClick={() => setCanvasTool('select')}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${canvasTool === 'select' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <Icons.MousePointer2 className="h-3.5 w-3.5" />
              </button>
              <button
                title="Hand / Pan (H)"
                onClick={() => setCanvasTool('hand')}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${canvasTool === 'hand' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <Icons.Hand className="h-3.5 w-3.5" />
              </button>
            </div>


{/* Insight confirmation banners (non-blocking, stacked bottom-right) */}
            {insightConfirmations.length > 0 && (
              <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex flex-col gap-2 max-w-sm">
                {insightConfirmations.map((c) => (
                  <InsightConfirmationBanner key={c.insightId} confirmation={c} />
                ))}
              </div>
            )}

            {/* Run naming panel — slides up while run is in progress */}
            <RunNamingPanel />

            {/* Persistent OFFLINE badge on canvas */}
            {connectivity_mode === 'offline' && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 shadow-lg">
                  <Icons.WifiOff className="h-3.5 w-3.5" />
                  OFFLINE — local models only
                </div>
              </div>
            )}

            {/* Awaiting assignment indicator (when panel is dismissed) */}
            {runStatus === 'awaiting_assignment' && !pendingTranscriptionSessionId && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <div className="flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 shadow-lg">
                  <Icons.Users className="h-3.5 w-3.5" />
                  Awaiting speaker assignment
                </div>
              </div>
            )}
          </main>
          {selectedNodeId && <ConfigPanel />}
          {historyOpen && workflow.id && (
            <RunHistoryPanel workflowId={workflow.id} onClose={() => setHistoryOpen(false)} />
          )}
        </div>
      </div>
    </>
  )
}
