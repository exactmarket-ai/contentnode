import { useState } from 'react'
import * as Icons from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { NodePalette } from '@/components/layout/NodePalette'
import { ConfigPanel } from '@/components/layout/ConfigPanel'
import { WorkflowCanvas } from '@/components/canvas/WorkflowCanvas'
import { WorkflowCreationModal } from '@/components/modals/WorkflowCreationModal'
import { SpeakerAssignmentPanel } from '@/components/transcription/SpeakerAssignmentPanel'
import { TranscriptViewer } from '@/components/transcription/TranscriptViewer'
import { useWorkflowStore } from '@/store/workflowStore'

export function WorkflowEditor() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const connectivity_mode = useWorkflowStore((s) => s.workflow.connectivity_mode)
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const pendingTranscriptionSessionId = useWorkflowStore((s) => s.pendingTranscriptionSessionId)
  const setPendingTranscriptionSessionId = useWorkflowStore((s) => s.setPendingTranscriptionSessionId)
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus)

  const [showModal, setShowModal] = useState(true)
  const [showTranscript, setShowTranscript] = useState(false)
  // Keep last assigned session ID so TranscriptViewer can open after the store clears it
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null)

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
