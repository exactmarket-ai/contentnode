import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'

export const SourceNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'

  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[data.icon as string] ?? Icons.Box

  return (
    <div
      className={cn(
        'min-w-[160px] rounded-lg border bg-card transition-all',
        selected
          ? 'border-emerald-500/70 shadow-[0_0_0_1px_rgba(16,185,129,0.3)]'
          : 'border-border hover:border-emerald-500/40',
        status === 'running' && 'border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]',
        status === 'passed' && 'border-emerald-600',
        status === 'failed' && 'border-red-500',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-border bg-emerald-500/10 px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20">
          <IconComp className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <span className="text-xs font-medium text-emerald-300">{data.label as string}</span>
        {status === 'running' && (
          <div className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        )}
        {status === 'passed' && (
          <Icons.CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-400" />
        )}
        {status === 'failed' && (
          <Icons.XCircle className="ml-auto h-3.5 w-3.5 text-red-400" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{data.description as string}</p>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-emerald-500/50 !bg-card"
      />
    </div>
  )
})
SourceNode.displayName = 'SourceNode'
