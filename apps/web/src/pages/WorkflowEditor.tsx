import { TopBar } from '@/components/layout/TopBar'
import { NodePalette } from '@/components/layout/NodePalette'
import { ConfigPanel } from '@/components/layout/ConfigPanel'
import { WorkflowCanvas } from '@/components/canvas/WorkflowCanvas'
import { useWorkflowStore } from '@/store/workflowStore'

export function WorkflowEditor() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <main className="relative flex-1 overflow-hidden">
          <WorkflowCanvas />
        </main>
        {selectedNodeId && <ConfigPanel />}
      </div>
    </div>
  )
}
