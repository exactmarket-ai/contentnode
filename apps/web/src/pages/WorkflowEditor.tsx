import { useState } from 'react'
import * as Icons from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { NodePalette } from '@/components/layout/NodePalette'
import { ConfigPanel } from '@/components/layout/ConfigPanel'
import { WorkflowCanvas } from '@/components/canvas/WorkflowCanvas'
import { WorkflowCreationModal } from '@/components/modals/WorkflowCreationModal'
import { useWorkflowStore } from '@/store/workflowStore'

export function WorkflowEditor() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const connectivity_mode = useWorkflowStore((s) => s.workflow.connectivity_mode)

  // Show the creation modal when first opening (workflow has no id yet).
  const [showModal, setShowModal] = useState(true)

  return (
    <>
      {showModal && <WorkflowCreationModal onClose={() => setShowModal(false)} />}

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
          </main>
          {selectedNodeId && <ConfigPanel />}
        </div>
      </div>
    </>
  )
}
