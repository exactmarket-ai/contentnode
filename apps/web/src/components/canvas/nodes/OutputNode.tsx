import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'

export const OutputNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'

  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[data.icon as string] ?? Icons.Box

  return (
    <div
      className={cn(
        'min-w-[160px] rounded-lg border bg-card transition-all',
        selected
          ? 'border-purple-500/70 shadow-[0_0_0_1px_rgba(168,85,247,0.3)]'
          : 'border-border hover:border-purple-500/40',
        status === 'running' && 'border-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.4)]',
        status === 'passed' && 'border-purple-600',
        status === 'failed' && 'border-red-500',
      )}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!border-purple-500/50 !bg-card"
      />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-border bg-purple-500/10 px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500/20">
          <IconComp className="h-3.5 w-3.5 text-purple-400" />
        </div>
        <span className="text-xs font-medium text-purple-300">{data.label as string}</span>
        {status === 'running' && (
          <div className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" />
        )}
        {status === 'passed' && (
          <Icons.CheckCircle2 className="ml-auto h-3.5 w-3.5 text-purple-400" />
        )}
        {status === 'failed' && (
          <Icons.XCircle className="ml-auto h-3.5 w-3.5 text-red-400" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{data.description as string}</p>
      </div>
    </div>
  )
})
OutputNode.displayName = 'OutputNode'
