import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'
import { assetUrl } from '@/lib/api'

export const OutputNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const status = nodeStatuses[id]?.status ?? 'idle'
  const subtype = (data.subtype as string) ?? (data.config as Record<string, unknown>)?.subtype as string
  const spec = getNodeSpec('output', subtype)

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${spec.accent}`,
    boxShadow: `0 0 0 3px ${spec.activeRing}`,
  } : isRunning ? {
    border: `1.5px solid ${spec.accent}`,
    boxShadow: `0 0 20px 4px ${spec.activeRing}`,
  } : isPassed ? {
    border: `1.5px solid ${spec.accent}`,
  } : isFailed ? {
    border: '1.5px solid #ef4444',
  } : {
    border: '1px solid #e0deda',
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
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2" style={headerStyle}>
        <div
          className="shrink-0"
          style={{
            width: 7, height: 7, borderRadius: 2,
            backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent,
          }}
        />
        <span className="text-[11px] font-semibold truncate" style={{ color: titleColor }}>
          {data.label as string}
        </span>
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          {spec.label}
        </span>
        {isRunning && (
          <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: spec.accent }} />
        )}
        {isPassed && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: spec.accent }} />}
        {isFailed && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Body */}
      <div className="px-2.5 py-1.5">
        <p className="text-[10px] leading-[1.4] line-clamp-2" style={{ color: '#6b6a62' }}>
          {data.description as string}
        </p>
        {(isPassed || isFailed) && nodeStatuses[id]?.startedAt && (
          <p className="mt-1 text-[10px]" style={{ color: '#b4b2a9' }}>
            Received {new Date(nodeStatuses[id].startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
        {/* Video generation: generating indicator */}
        {isRunning && subtype === 'video-generation' && (
          <p className="mt-1 animate-pulse text-[10px]" style={{ color: spec.accent }}>
            Generating video…
          </p>
        )}
        {/* Video generation: looping preview after completion */}
        {isPassed && subtype === 'video-generation' && (() => {
          const output = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const assets = output?.assets as { localPath: string }[] | undefined
          if (!assets?.length) return null
          return (
            <div className="mt-1.5 overflow-hidden rounded" style={{ maxHeight: '112px' }}>
              <video
                src={assetUrl(assets[0].localPath)}
                autoPlay
                loop
                muted
                playsInline
                className="w-full object-cover"
                style={{ maxHeight: '112px' }}
              />
              {assets.length > 1 && (
                <p className="text-center text-[9px]" style={{ color: '#b4b2a9' }}>
                  +{assets.length - 1} more clip{assets.length > 2 ? 's' : ''}
                </p>
              )}
            </div>
          )
        })()}
        {/* Image generation: show thumbnail strip on canvas */}
        {isPassed && subtype === 'image-generation' && (() => {
          const output = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const assets = output?.assets as { localPath: string }[] | undefined
          if (!assets?.length) return null
          return (
            <div className="mt-1.5 flex gap-1 overflow-x-auto">
              {assets.slice(0, 3).map((a, i) => (
                <img
                  key={i}
                  src={assetUrl(a.localPath)}
                  alt={`Generated ${i + 1}`}
                  className="h-10 w-10 shrink-0 rounded object-cover border"
                  style={{ borderColor: spec.accent + '44' }}
                />
              ))}
              {assets.length > 3 && (
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded border text-[9px] font-medium"
                  style={{ borderColor: spec.accent + '44', color: spec.accent }}
                >
                  +{assets.length - 3}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
})
OutputNode.displayName = 'OutputNode'
