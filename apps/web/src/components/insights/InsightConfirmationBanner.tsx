import * as Icons from 'lucide-react'
import { useWorkflowStore, type InsightConfirmation } from '@/store/workflowStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface InsightConfirmationBannerProps {
  confirmation: InsightConfirmation
}

export function InsightConfirmationBanner({ confirmation }: InsightConfirmationBannerProps) {
  const { dismissInsightConfirmation, nodes, updateNodeData, onNodesChange } = useWorkflowStore()

  const handleConfirm = async () => {
    try {
      // Find the insight node on canvas
      const insightNode = nodes.find(
        (n) => n.type === 'insight' && n.data.config?.insight_id === confirmation.insightId
      )

      if (insightNode) {
        // Get the insight's suggested config change
        const suggestedConfigChange = (insightNode.data.config as Record<string, unknown>)
          ?.suggested_config_change as Record<string, unknown> | undefined

        // Find the connected node (via edges)
        const connectedNodeId = confirmation.connectedNodeId
        const targetNode = nodes.find((n) => n.id === connectedNodeId)

        if (targetNode && suggestedConfigChange) {
          // Bake the config change into the connected node
          const currentConfig = (targetNode.data.config as Record<string, unknown>) ?? {}
          updateNodeData(connectedNodeId, {
            config: { ...currentConfig, ...suggestedConfigChange },
          })
        }

        // Remove the insight node from canvas
        onNodesChange([{ type: 'remove', id: insightNode.id }])
      }

      // Mark as confirmed on server
      await fetch(`${API_URL}/api/v1/insights/${confirmation.insightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bake_in' }),
      })
    } catch {
      // Non-critical — dismiss regardless
    }

    dismissInsightConfirmation(confirmation.insightId)
  }

  const handleNotYet = async () => {
    // Dismiss for 2 runs then re-prompt — store dismissal on server
    try {
      await fetch(`${API_URL}/api/v1/insights/${confirmation.insightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissedUntilRun: confirmation.appliedRunCount + 2 }),
      })
    } catch {
      // Non-critical
    }
    dismissInsightConfirmation(confirmation.insightId)
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50',
        'px-4 py-3 shadow-lg backdrop-blur-sm max-w-sm',
      )}
    >
      <Icons.Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-xs text-yellow-800 leading-relaxed">
          You applied{' '}
          <span className="font-medium">"{confirmation.patternDescription}"</span>{' '}
          {confirmation.appliedRunCount} run{confirmation.appliedRunCount !== 1 ? 's' : ''} ago.
          Feedback from <span className="font-medium">{confirmation.stakeholderName}</span>{' '}
          has improved. Add this as a standard part of your workflow template?
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-7 text-xs bg-yellow-600 hover:bg-yellow-500 text-white px-3"
            onClick={() => void handleConfirm()}
          >
            Yes, make it permanent
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-foreground px-3"
            onClick={() => void handleNotYet()}
          >
            Not yet
          </Button>
        </div>
      </div>
      <button
        onClick={() => dismissInsightConfirmation(confirmation.insightId)}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icons.X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
