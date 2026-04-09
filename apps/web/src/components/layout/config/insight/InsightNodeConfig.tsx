import * as Icons from 'lucide-react'
import { Label } from '@/components/ui/label'

const SUGGESTED_NODE_LABELS: Record<string, string> = {
  'logic:humanizer':       'Humanizer node',
  'output:content-output': 'Content Output node',
  'logic:ai-generate':     'AI Generate node',
  'logic':                 'Logic node',
  'output':                'Output node',
}

export function InsightNodeConfig({
  config,
}: {
  config: Record<string, unknown>
}) {
  const suggestedNodeType = (config.suggested_node_type as string) ?? ''
  const suggestedConfigChange = (config.suggested_config_change as Record<string, unknown>) ?? {}
  const insightType = (config.insight_type as string) ?? ''
  const nodeLabel = SUGGESTED_NODE_LABELS[suggestedNodeType] ?? suggestedNodeType

  return (
    <div className="space-y-3">
      {/* Pattern type badge */}
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Icons.Lightbulb className="h-4 w-4 text-yellow-600 shrink-0" />
          <span className="text-xs font-medium text-yellow-700 capitalize">
            {insightType.replace(/_/g, ' ')} Pattern
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect this node's output port to a compatible node. When the workflow runs, the
          suggested config change below will be applied as an additional modifier to that node.
        </p>
      </div>

      {/* Suggested target node */}
      {nodeLabel && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Suggested Connection</Label>
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-foreground">
            Connect to: <span className="font-medium text-yellow-700">{nodeLabel}</span>
          </div>
        </div>
      )}

      {/* Config change preview */}
      {Object.keys(suggestedConfigChange).length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Config Change Preview</Label>
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-2.5 py-2 space-y-1">
            {Object.entries(suggestedConfigChange).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                <span className="font-mono text-yellow-700">{String(v)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            These values will be merged into the connected node's config during each run.
          </p>
        </div>
      )}
    </div>
  )
}
