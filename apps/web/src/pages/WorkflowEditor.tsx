import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate, useBlocker } from 'react-router-dom'
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
  const pendingTranscriptionSessionId = useWorkflowStore((s) => s.pendingTranscriptionSessionId)
  const setPendingTranscriptionSessionId = useWorkflowStore((s) => s.setPendingTranscriptionSessionId)
  const pendingReviewRunId = useWorkflowStore((s) => s.pendingReviewRunId)
  const pendingReviewContent = useWorkflowStore((s) => s.pendingReviewContent)
  const setPendingReview = useWorkflowStore((s) => s.setPendingReview)
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus)

  const workflow = useWorkflowStore((s) => s.workflow)
  const nodes = useWorkflowStore((s) => s.nodes)
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
        store.setNodeRunStatuses({})

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
              useWorkflowStore.getState().setNodeRunStatuses(nodeStatuses as Record<string, { status: 'idle' | 'running' | 'passed' | 'failed'; output?: unknown }>)
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

  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    const handler = () => setHistoryOpen(true)
    window.addEventListener('contentnode:open-history', handler)
    return () => window.removeEventListener('contentnode:open-history', handler)
  }, [])

  const graphDirty = useWorkflowStore((s) => s.graphDirty)

  // Unsaved = new workflow never saved, OR existing workflow with changes since last save
  const isUnsaved = !!(workflow.id && (!workflow.graphSaved || graphDirty))

  const [deletingWorkflow, setDeletingWorkflow] = useState(false)

  // Block all React Router navigation (links, back button, programmatic) when unsaved
  const blocker = useBlocker(isUnsaved)

  // Also warn on browser close/refresh
  useEffect(() => {
    if (!isUnsaved) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isUnsaved])

  const handleLeaveWithoutSaving = useCallback(async () => {
    // Only delete if the workflow was never saved — otherwise just leave, saved version stays intact
    if (workflow.id && !workflow.graphSaved) {
      setDeletingWorkflow(true)
      try { await apiFetch(`/api/v1/workflows/${workflow.id}`, { method: 'DELETE' }) } catch { /* ignore */ }
      setDeletingWorkflow(false)
    }
    blocker.proceed?.()
  }, [workflow.id, workflow.graphSaved, blocker])

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

      {/* ── Unsaved-changes navigation guard ─────────────────────────────── */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="w-[400px] rounded-xl border border-border bg-white shadow-2xl overflow-hidden">
            <div className="px-5 py-4" style={{ backgroundColor: '#a200ee' }}>
              <div className="flex items-center gap-2">
                <Icons.AlertTriangle className="h-4 w-4 text-white/80" />
                <p className="text-[13px] font-semibold text-white">Unsaved workflow</p>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[13px] text-foreground">
                <strong>{workflow.name}</strong> has unsaved changes.
              </p>
              <p className="text-[12px] text-muted-foreground">
                {workflow.graphSaved
                  ? 'Your changes will be lost if you leave without saving.'
                  : 'This workflow hasn\'t been saved yet and won\'t appear in your list if you leave.'}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => blocker.reset?.()}
                  className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLeaveWithoutSaving}
                  disabled={deletingWorkflow}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {deletingWorkflow ? 'Removing…' : workflow.graphSaved ? 'Leave without saving' : 'Discard & leave'}
                </button>
                <button
                  onClick={() => { blocker.reset?.(); handleOpenSaveDialog() }}
                  className="ml-auto rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: '#a200ee' }}
                >
                  Save workflow
                </button>
              </div>
            </div>
          </div>
        </div>
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

            {/* Workflow name — floating centered at top of canvas */}
            {workflow.name && (
              <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2">
                <div className="rounded-full border border-border bg-card/80 backdrop-blur-sm px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                  {workflow.name}
                </div>
              </div>
            )}

            {/* Insight confirmation banners (non-blocking, stacked bottom-right) */}
            {insightConfirmations.length > 0 && (
              <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex flex-col gap-2 max-w-sm">
                {insightConfirmations.map((c) => (
                  <InsightConfirmationBanner key={c.insightId} confirmation={c} />
                ))}
              </div>
            )}

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
