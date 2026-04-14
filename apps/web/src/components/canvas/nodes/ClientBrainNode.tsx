import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'

export const ClientBrainNode = memo(function ClientBrainNode({ id, data, selected }: NodeProps) {
  const nodeRunStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const workflowClientName = useWorkflowStore((s) => s.workflow.clientName)

  const spec = getNodeSpec('client_brain')
  const config = (data.config as Record<string, unknown>) ?? {}

  const clientName = (config.clientName as string) || workflowClientName || ''
  const gtmSections = (config.gtmSections as string[]) ?? []
  const dgBase = (config.dgBaseSections as string[]) ?? []
  const dgVert = (config.dgVertSections as string[]) ?? []
  const includeBrand = (config.includeBrand as boolean) ?? false

  const runStatus = nodeRunStatuses[id]
  const isRunning = runStatus?.status === 'running'
  const isPassed  = runStatus?.status === 'passed'
  const isFailed  = runStatus?.status === 'failed'

  const headerStyle = selected
    ? { backgroundColor: spec.accent, borderColor: spec.accent }
    : { backgroundColor: spec.headerBg, borderColor: spec.headerBorder }

  const cardStyle = selected
    ? { boxShadow: `0 0 0 2px ${spec.activeRing}`, border: `1.5px solid ${spec.accent}` }
    : { border: `1px solid ${spec.headerBorder}` }

  const allSections = [
    ...gtmSections.map((s) => `§${s}`),
    ...dgBase,
    ...dgVert,
    ...(includeBrand ? ['Brand'] : []),
  ]

  return (
    <div className="relative rounded-md bg-white" style={{ width: 220, ...cardStyle }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={headerStyle}
      >
        <div
          className="shrink-0"
          style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }}
        />
        <span
          className="flex-1 truncate text-[11px] font-semibold"
          style={{ color: selected ? spec.activeTextColor : '#1a1a14' }}
        >
          {(data.label as string) || 'Client Brain'}
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          Brain
        </span>
        {isRunning && <div className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }} />}
        {isPassed  && <span className="ml-1 text-[10px]" style={{ color: spec.accent }}>✓</span>}
        {isFailed  && <span className="ml-1 text-[10px] text-red-500">✗</span>}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1.5">
        {/* Client name */}
        <div className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Client</span>
          <span className="flex-1 truncate text-[11px] text-foreground">
            {clientName || <span className="text-muted-foreground italic text-[10px]">not set</span>}
          </span>
        </div>

        {/* Active sections */}
        {allSections.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {allSections.map((s) => (
              <span
                key={s}
                className="rounded px-1 py-px text-[9px] font-medium"
                style={{ backgroundColor: spec.badgeBg, color: spec.badgeText }}
              >
                {s}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">No sections selected</p>
        )}
      </div>

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />
    </div>
  )
})
