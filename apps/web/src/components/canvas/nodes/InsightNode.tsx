import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { NODE_SPEC } from '@/lib/nodeColors'

const spec = NODE_SPEC['ai-model'] // Insights use the AI-model amber color

export const InsightNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'

  const confidence = (data.confidence as number) ?? 0
  const confidencePct = Math.round(confidence * 100)

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${spec.accent}`,
    boxShadow: `0 0 0 3px ${spec.activeRing}, 0 0 24px 6px ${spec.activeRing}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border: `1.5px solid ${spec.accent}`,
    boxShadow: `0 0 20px 4px ${spec.activeRing}`,
  } : isPassed ? {
    border: `1.5px solid ${spec.accent}`,
  } : isFailed ? {
    border: '1.5px solid #ef4444',
  } : confidence > 0.6 ? {
    border: `1.5px solid ${spec.accent}`,
    boxShadow: `0 0 0 2px ${spec.activeRing}`,
  } : {
    border: `1px solid ${spec.headerBorder}`,
  }

  const headerStyle: React.CSSProperties = selected ? {
    backgroundColor: spec.accent,
    borderBottomColor: spec.accent,
  } : {
    backgroundColor: spec.headerBg,
    borderBottomColor: spec.headerBorder,
  }

  const titleColor = selected ? spec.activeTextColor : '#1a1a14'

  return (
    <div className="relative w-[200px] rounded-md bg-white transition-all" style={cardStyle}>
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2" style={headerStyle}>
        <div
          className="shrink-0"
          style={{
            width: 7, height: 7, borderRadius: 2,
            backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent,
          }}
        />
        <span className="text-[11px] font-semibold truncate flex-1" style={{ color: titleColor }}>
          Insight
        </span>
        {confidence > 0.6 && status === 'idle' && (
          <div className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ backgroundColor: spec.accent }} />
        )}
        {isRunning && (
          <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: spec.accent }} />
        )}
        {isPassed && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: spec.accent }} />}
        {isFailed && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Body */}
      <div className="px-2.5 py-1.5 space-y-1">
        <p className="text-[10px] font-medium leading-tight line-clamp-2" style={{ color: '#1a1a14' }}>
          {data.patternDescription as string || data.label as string || 'Pattern insight'}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: '#b4b2a9' }}>
            {data.isCollective ? 'Collective' : 'Individual'}
          </span>
          <span
            className="text-[10px] font-medium tabular-nums"
            style={{ color: confidencePct >= 60 ? spec.accent : '#b4b2a9' }}
          >
            {confidencePct}%
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />
    </div>
  )
})
InsightNode.displayName = 'InsightNode'
