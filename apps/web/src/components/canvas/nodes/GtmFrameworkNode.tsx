import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'
import { NODE_SPEC } from '@/lib/nodeColors'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Section registry (mirrors the 18 GTM sections)
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { num: '01', short: 'Vertical Overview' },
  { num: '02', short: 'Customer Profile' },
  { num: '03', short: 'Market Pressures' },
  { num: '04', short: 'Core Challenges' },
  { num: '05', short: 'Solutions + Stack' },
  { num: '06', short: 'Why [Client]' },
  { num: '07', short: 'Segments + Buyers' },
  { num: '08', short: 'Messaging Framework' },
  { num: '09', short: 'Proof Points' },
  { num: '10', short: 'Objection Handling' },
  { num: '11', short: 'Brand Voice' },
  { num: '12', short: 'Competitive Diff.' },
  { num: '13', short: 'Quotes + Testimonials' },
  { num: '14', short: 'Campaign Themes' },
  { num: '15', short: 'FAQs' },
  { num: '16', short: 'Content Funnel' },
  { num: '17', short: 'Regulatory' },
  { num: '18', short: 'CTAs + Next Steps' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export const GtmFrameworkNode = memo(function GtmFrameworkNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, nodeRunStatuses } = useWorkflowStore()
  const workflowClientId = useWorkflowStore((s) => s.workflow.clientId)

  const spec = NODE_SPEC['input']
  const config = (data.config as Record<string, unknown>) ?? {}
  const sections = (config.sections as string[]) ?? SECTIONS.map((s) => s.num)
  const verticalName = (config.verticalName as string) || null
  const [resolvedClientName, setResolvedClientName] = useState<string | null>((config.clientName as string) || null)

  // Fetch client name from API if not already in config
  useEffect(() => {
    const stored = (config.clientName as string) || null
    if (stored) { setResolvedClientName(stored); return }
    if (!workflowClientId) return
    apiFetch(`/api/v1/clients/${workflowClientId}`)
      .then((r) => r.json())
      .then((c) => { if (c?.data?.name) setResolvedClientName(c.data.name) })
      .catch(() => {})
  }, [workflowClientId, config.clientName])

  const resolveShort = (short: string) =>
    resolvedClientName ? short.replace('[Client]', resolvedClientName) : short

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

  const toggleSection = (e: React.MouseEvent, num: string) => {
    e.stopPropagation()
    const next = sections.includes(num)
      ? sections.filter((s) => s !== num)
      : [...sections, num]
    const currentConfig = (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data?.config as Record<string, unknown>) ?? {}
    updateNodeData(id, { config: { ...currentConfig, sections: next } })
  }

  const selectedCount = sections.length

  // Split 18 sections into two columns of 9
  const left  = SECTIONS.slice(0, 9)
  const right = SECTIONS.slice(9, 18)

  return (
    <div
      className="relative rounded-md bg-white"
      style={{ width: 380, ...cardStyle }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={headerStyle}
      >
        {/* Spec dot */}
        <div
          className="shrink-0"
          style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }}
        />
        <span
          className="flex-1 truncate text-[11px] font-semibold"
          style={{ color: selected ? spec.activeTextColor : '#1a1a14' }}
        >
          {(data.label as string) || 'GTM Framework'}
        </span>
        <span
          className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          {selectedCount} / 18
        </span>
        {isRunning && <div className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }} />}
        {isPassed && <span className="ml-1 text-[10px]" style={{ color: spec.accent }}>✓</span>}
        {isFailed && <span className="ml-1 text-[10px] text-red-500">✗</span>}
      </div>

      {/* Vertical label */}
      {verticalName && (
        <div className="border-b px-3 py-1.5" style={{ borderColor: spec.headerBorder, backgroundColor: spec.headerBg }}>
          <span className="text-[10px] font-medium" style={{ color: spec.accent }}>
            Vertical: {verticalName}
          </span>
        </div>
      )}

      {/* Section grid */}
      <div className="px-2.5 py-2">
        <div className="flex gap-1.5">
          {/* Left column */}
          <div className="flex-1 space-y-0.5">
            {left.map((s) => {
              const active = sections.includes(s.num)
              return (
                <button
                  key={s.num}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-gray-50"
                  onClick={(e) => toggleSection(e, s.num)}
                >
                  <span
                    className="shrink-0 text-[9px] font-bold tabular-nums"
                    style={{ color: active ? spec.accent : '#c8c8c8', width: 14 }}
                  >
                    {s.num}
                  </span>
                  <span
                    className="shrink-0 h-2 w-2 rounded-sm border"
                    style={{
                      backgroundColor: active ? spec.accent : 'transparent',
                      borderColor: active ? spec.accent : '#d1d5db',
                    }}
                  />
                  <span
                    className="truncate text-[10px]"
                    style={{ color: active ? '#1a1a1a' : '#9ca3af' }}
                  >
                    {resolveShort(s.short)}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Right column */}
          <div className="flex-1 space-y-0.5">
            {right.map((s) => {
              const active = sections.includes(s.num)
              return (
                <button
                  key={s.num}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-gray-50"
                  onClick={(e) => toggleSection(e, s.num)}
                >
                  <span
                    className="shrink-0 text-[9px] font-bold tabular-nums"
                    style={{ color: active ? spec.accent : '#c8c8c8', width: 14 }}
                  >
                    {s.num}
                  </span>
                  <span
                    className="shrink-0 h-2 w-2 rounded-sm border"
                    style={{
                      backgroundColor: active ? spec.accent : 'transparent',
                      borderColor: active ? spec.accent : '#d1d5db',
                    }}
                  />
                  <span
                    className="truncate text-[10px]"
                    style={{ color: active ? '#1a1a1a' : '#9ca3af' }}
                  >
                    {resolveShort(s.short)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />
    </div>
  )
})
