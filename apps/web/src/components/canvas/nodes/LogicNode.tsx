import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'

export const LogicNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'

  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[data.icon as string] ?? Icons.Box

  return (
    <div
      className={cn(
        'min-w-[160px] rounded-lg border bg-card transition-all',
        selected
          ? 'border-blue-500/70 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]'
          : 'border-border hover:border-blue-500/40',
        status === 'running' && 'border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.4)]',
        status === 'passed' && 'border-blue-600',
        status === 'failed' && 'border-red-500',
      )}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!border-blue-500/50 !bg-card"
      />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-border bg-blue-500/10 px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/20">
          <IconComp className="h-3.5 w-3.5 text-blue-400" />
        </div>
        <span className="text-xs font-medium text-blue-300">{data.label as string}</span>
        {status === 'running' && (
          <div className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        )}
        {status === 'passed' && (
          <Icons.CheckCircle2 className="ml-auto h-3.5 w-3.5 text-blue-400" />
        )}
        {status === 'failed' && (
          <Icons.XCircle className="ml-auto h-3.5 w-3.5 text-red-400" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{data.description as string}</p>
        {data.subtype === 'ai-generate' && data.config && (data.config as Record<string, unknown>).model_config && (
          <p className="mt-1 text-xs text-blue-400/70">
            {((data.config as Record<string, unknown>).model_config as Record<string, unknown>)?.model as string}
          </p>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-blue-500/50 !bg-card"
      />
    </div>
  )
})
LogicNode.displayName = 'LogicNode'
