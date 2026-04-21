import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'
import { apiFetch } from '@/lib/api'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'

interface Client { id: string; name: string }
interface BrandVertical { id: string; name: string }

export const BrandContextNode = memo(function BrandContextNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, nodeRunStatuses } = useWorkflowStore()
  const workflowClientId = useWorkflowStore((s) => s.workflow.clientId)
  const verticalTerm = useVerticalTerm()

  const spec = getNodeSpec('source', 'brand-context')
  const config = (data.config as Record<string, unknown>) ?? {}
  const clientId = (config.clientId as string) || workflowClientId || ''
  const verticalId = (config.verticalId as string) || ''
  const clientName = (config.clientName as string) || ''
  const verticalName = (config.verticalName as string) || 'General'
  const dataSource = (config.dataSource as string) || 'both'

  const [verticals, setVerticals] = useState<BrandVertical[]>([])
  const [resolvedClientName, setResolvedClientName] = useState<string>(clientName)

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      clientName
        ? Promise.resolve(clientName)
        : apiFetch(`/api/v1/clients/${clientId}`).then((r) => r.json()).then((c) => c?.data?.name ?? ''),
      apiFetch(`/api/v1/clients/${clientId}/brand-verticals`).then((r) => r.json()).then(({ data: d }) => d ?? []),
    ]).then(([name, verts]) => {
      setResolvedClientName(name as string)
      setVerticals(verts as BrandVertical[])
    }).catch(() => {})
  }, [clientId, clientName])

  const handleVerticalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    const val = e.target.value
    const found = verticals.find((v) => v.id === val)
    const currentConfig = (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data?.config as Record<string, unknown>) ?? {}
    updateNodeData(id, { config: { ...currentConfig, verticalId: val, verticalName: found?.name ?? 'General' } })
  }

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

  const sourceLabel = dataSource === 'profile' ? 'Brand Profile'
    : dataSource === 'builder' ? 'Brand Builder'
    : 'Profile + Builder'

  return (
    <div className="relative rounded-md bg-white" style={{ width: 260, ...cardStyle }}>
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
          {(data.label as string) || 'Brand Context'}
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          input
        </span>
        {isRunning && <div className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }} />}
        {isPassed  && <span className="ml-1 text-[10px]" style={{ color: spec.accent }}>✓</span>}
        {isFailed  && <span className="ml-1 text-[10px] text-red-500">✗</span>}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1.5">
        {/* Client */}
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Client</span>
          <span className="flex-1 truncate text-[11px] text-foreground">
            {resolvedClientName || <span className="text-muted-foreground italic">not set</span>}
          </span>
        </div>

        {/* Vertical selector */}
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{verticalTerm}</span>
          <select
            value={verticalId}
            onChange={handleVerticalChange}
            className="nodrag flex-1 rounded border border-border bg-white px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-1"
            style={{ borderColor: verticalId ? spec.accent : undefined }}
          >
            <option value="">General</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Data source */}
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Source</span>
          <span className="flex-1 truncate text-[11px] text-muted-foreground">{sourceLabel}</span>
        </div>
      </div>

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />
    </div>
  )
})
