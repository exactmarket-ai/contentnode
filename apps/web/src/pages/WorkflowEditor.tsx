import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { NodePalette } from '@/components/layout/NodePalette'
import { ConfigPanel } from '@/components/layout/ConfigPanel'
import { WorkflowCanvas } from '@/components/canvas/WorkflowCanvas'
import { WorkflowCreationModal } from '@/components/modals/WorkflowCreationModal'
import { SpeakerAssignmentPanel } from '@/components/transcription/SpeakerAssignmentPanel'
import { TranscriptViewer } from '@/components/transcription/TranscriptViewer'
import { InsightConfirmationBanner } from '@/components/insights/InsightConfirmationBanner'
import { useWorkflowStore } from '@/store/workflowStore'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export function WorkflowEditor() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const connectivity_mode = useWorkflowStore((s) => s.workflow.connectivity_mode)
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const pendingTranscriptionSessionId = useWorkflowStore((s) => s.pendingTranscriptionSessionId)
  const setPendingTranscriptionSessionId = useWorkflowStore((s) => s.setPendingTranscriptionSessionId)
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus)

  const nodes = useWorkflowStore((s) => s.nodes)
  const insightConfirmations = useWorkflowStore((s) => s.insightConfirmations)
  const addInsightConfirmation = useWorkflowStore((s) => s.addInsightConfirmation)

  const [showModal, setShowModal] = useState(true)
  const [showTranscript, setShowTranscript] = useState(false)
  // Keep last assigned session ID so TranscriptViewer can open after the store clears it
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null)

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
    if (pendingTranscriptionSessionId) {
      setCompletedSessionId(pendingTranscriptionSessionId)
    }
    setRunStatus('running')
    setPendingTranscriptionSessionId(null)
    setShowTranscript(true)
  }

  const handleAssignmentDismiss = () => {
    setPendingTranscriptionSessionId(null)
    setRunStatus('idle')
  }

  return (
    <>
      {showModal && <WorkflowCreationModal onClose={() => setShowModal(false)} />}

      {/* Speaker assignment overlay (shown when run is awaiting_assignment) */}
      {runStatus === 'awaiting_assignment' && pendingTranscriptionSessionId && (
        <SpeakerAssignmentPanel
          sessionId={pendingTranscriptionSessionId}
          onComplete={handleAssignmentComplete}
          onDismiss={handleAssignmentDismiss}
        />
      )}

      {/* Transcript viewer overlay (shown after assignment to extract quotes) */}
      {showTranscript && completedSessionId && (
        <TranscriptViewer
          sessionId={completedSessionId}
          onClose={() => setShowTranscript(false)}
        />
      )}

      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <NodePalette />
          <main className="relative flex-1 overflow-hidden">
            <WorkflowCanvas />

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
                <div className="flex items-center gap-1.5 rounded-full border border-amber-700 bg-amber-950/90 px-3 py-1 text-xs font-medium text-amber-300 shadow-lg">
                  <Icons.WifiOff className="h-3.5 w-3.5" />
                  OFFLINE — local models only
                </div>
              </div>
            )}

            {/* Awaiting assignment indicator (when panel is dismissed) */}
            {runStatus === 'awaiting_assignment' && !pendingTranscriptionSessionId && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <div className="flex items-center gap-1.5 rounded-full border border-blue-700 bg-blue-950/90 px-3 py-1 text-xs font-medium text-blue-300 shadow-lg">
                  <Icons.Users className="h-3.5 w-3.5" />
                  Awaiting speaker assignment
                </div>
              </div>
            )}
          </main>
          {selectedNodeId && <ConfigPanel />}
        </div>
      </div>
    </>
  )
}
