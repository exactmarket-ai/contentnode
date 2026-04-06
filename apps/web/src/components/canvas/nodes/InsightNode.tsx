import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'

export const InsightNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'

  const confidence = (data.confidence as number) ?? 0
  const confidencePct = Math.round(confidence * 100)

  return (
    <div
      className={cn(
        'relative min-w-[180px] max-w-[220px] rounded-lg border bg-card transition-all',
        selected
          ? 'border-yellow-500/70 shadow-[0_0_0_1px_rgba(234,179,8,0.3)]'
          : 'border-yellow-700/50 hover:border-yellow-500/60',
        status === 'running' && 'border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]',
        status === 'passed' && 'border-yellow-600',
        status === 'failed' && 'border-red-500',
        confidence > 0.6 && 'shadow-[0_0_0_1px_rgba(234,179,8,0.15)]',
      )}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ top: '50%' }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-yellow-700/30 bg-yellow-500/10 px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-yellow-500/20">
          <Icons.Lightbulb className="h-3.5 w-3.5 text-yellow-400" />
        </div>
        <span className="text-xs font-medium text-yellow-300 truncate flex-1">Insight</span>

        {/* High-confidence attention indicator */}
        {confidence > 0.6 && status === 'idle' && (
          <div className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
        )}
        {status === 'running' && (
          <div className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400 shrink-0" />
        )}
        {status === 'passed' && (
          <Icons.CheckCircle2 className="ml-auto h-3.5 w-3.5 text-yellow-400 shrink-0" />
        )}
        {status === 'failed' && (
          <Icons.XCircle className="ml-auto h-3.5 w-3.5 text-red-400 shrink-0" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-yellow-200 font-medium leading-tight line-clamp-2">
          {data.patternDescription as string || data.label as string || 'Pattern insight'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {data.isCollective ? 'Collective' : 'Individual'}
          </span>
          <span className={cn(
            'text-xs font-medium tabular-nums',
            confidencePct >= 60 ? 'text-yellow-400' : 'text-muted-foreground'
          )}>
            {confidencePct}% confidence
          </span>
        </div>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ top: '50%' }}
      />
    </div>
  )
})
InsightNode.displayName = 'InsightNode'
