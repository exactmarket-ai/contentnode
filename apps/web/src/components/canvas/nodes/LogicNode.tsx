import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'
import { EditableLabel } from './EditableLabel'

const MULTI_INPUT_LOGIC = new Set(['image-prompt-builder', 'video-prompt-builder'])

// ─── Port configuration ───────────────────────────────────────────────────────

interface PortDef {
  id: string
  label?: string
  top: string
}

interface PortConfig {
  inputs: PortDef[]
  outputs: PortDef[]
}

function getPortConfig(subtype: string): PortConfig {
  switch (subtype) {
    case 'condition':
      return {
        inputs:  [{ id: 'input',    top: '50%' }],
        outputs: [
          { id: 'pass', label: 'pass', top: '33%' },
          { id: 'fail', label: 'fail', top: '67%' },
        ],
      }
    case 'merge':
      return {
        inputs: [
          { id: 'in-1', label: '1', top: '33%' },
          { id: 'in-2', label: '2', top: '44%' },
          { id: 'in-3', label: '3', top: '56%' },
          { id: 'in-4', label: '4', top: '67%' },
          { id: 'in-5', label: '5', top: '78%' },
        ],
        outputs: [{ id: 'output', top: '56%' }],
      }
    case 'human-review':
      return {
        inputs:  [{ id: 'input',       top: '50%' }],
        outputs: [
          { id: 'approved', label: 'approved', top: '33%' },
          { id: 'flagged',  label: 'flagged',  top: '67%' },
        ],
      }
    case 'detection':
      return {
        inputs:  [{ id: 'input', top: '50%' }],
        outputs: [
          { id: 'pass', label: 'pass', top: '33%' },
          { id: 'fail', label: 'fail', top: '67%' },
        ],
      }
    case 'conditional-branch':
      return {
        inputs:  [{ id: 'input', top: '50%' }],
        outputs: [
          { id: 'pass', label: 'pass', top: '33%' },
          { id: 'fail', label: 'fail', top: '67%' },
        ],
      }
    case 'seo-review':
    case 'geo-review':
      return {
        inputs:  [{ id: 'input', top: '50%' }],
        outputs: [
          { id: 'pass',  label: 'pass',  top: '25%' },
          { id: 'flag',  label: 'flag',  top: '50%' },
          { id: 'block', label: 'block', top: '75%' },
        ],
      }
    default:
      return {
        inputs:  [{ id: 'input',  top: '50%' }],
        outputs: [{ id: 'output', top: '50%' }],
      }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const LogicNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeStatuses[id]?.status ?? 'idle'
  const subtype = data.subtype as string
  const portConfig = getPortConfig(subtype)
  const spec = getNodeSpec('logic', subtype)
  const isMultiInput = MULTI_INPUT_LOGIC.has(subtype)

  // Connected upstream labels (for prompt builder nodes)
  const connectedSources = isMultiInput
    ? edges
        .filter((e) => e.target === id)
        .map((e) => {
          const src = nodes.find((n) => n.id === e.source)
          return src?.data?.label as string || 'Source'
        })
        .filter(Boolean)
    : []

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  // Card border/shadow
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

  const titleColor   = selected ? spec.activeTextColor : '#1a1a14'
  const portLblColor = spec.accent + '99' // 60% opacity

  return (
    <div
      className="relative w-[200px] rounded-md bg-white transition-all"
      style={{ ...cardStyle, ...(subtype === 'merge' ? { minHeight: 130 } : {}) }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2" style={headerStyle}>
        <div
          className="shrink-0"
          style={{
            width: 7, height: 7, borderRadius: 2,
            backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent,
          }}
        />
        <EditableLabel
          value={data.label as string}
          onSave={(v) => updateNodeData(id, { label: v })}
          color={titleColor}
        />
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

        {/* Connected sources (prompt builder nodes) */}
        {isMultiInput && connectedSources.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {connectedSources.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="h-px w-2 shrink-0" style={{ backgroundColor: spec.accent + '88' }} />
                <span className="text-[9px] truncate" style={{ color: spec.accent + 'cc' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* AI-generate: model override + prompt template indicator */}
        {subtype === 'ai-generate' && data.config && (
          <>
            {(data.config as Record<string, unknown>).model_config && (
              <p className="mt-1 text-[10px]" style={{ color: spec.accent + 'cc' }}>
                {((data.config as Record<string, unknown>).model_config as Record<string, unknown>)?.model as string}
              </p>
            )}
            {(data.config as Record<string, unknown>).prompt_template_name && (
              <p className="mt-1 flex items-center gap-1 text-[10px] truncate" style={{ color: '#a200ee' }}>
                <Icons.ScrollText className="h-3 w-3 shrink-0" />
                {(data.config as Record<string, unknown>).prompt_template_name as string}
              </p>
            )}
          </>
        )}

        {/* Detection: score badge after run */}
        {subtype === 'detection' && status !== 'idle' && (() => {
          const detOut = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const score = detOut?.overall_score as number | undefined
          const warning = nodeStatuses[id]?.warning
          return score !== undefined ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  backgroundColor: score <= 20 ? '#dcfce7' : score <= 50 ? '#fef9c3' : '#fee2e2',
                  color:           score <= 20 ? '#166534' : score <= 50 ? '#854d0e' : '#991b1b',
                }}
              >
                {score}%
              </span>
              <span className="text-[10px]" style={{ color: '#b4b2a9' }}>AI score</span>
              {warning && <span className="text-[10px] text-amber-500" title={warning}>⚠</span>}
            </div>
          ) : null
        })()}

        {/* Humanizer: word count */}
        {subtype === 'humanizer' && status === 'passed' && (() => {
          const words = nodeStatuses[id]?.wordsProcessed
          return words ? (
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{ backgroundColor: spec.badgeBg, color: spec.badgeText }}
              >
                {words.toLocaleString()}
              </span>
              <span className="text-[10px]" style={{ color: '#b4b2a9' }}>words</span>
            </div>
          ) : null
        })()}

        {/* Translate: target language */}
        {subtype === 'translate' && data.config && (() => {
          const cfg = data.config as Record<string, unknown>
          const targetLang = (cfg.target_language as string) || 'ES'
          return (
            <div className="mt-1.5 flex items-center gap-1">
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: spec.badgeBg, color: spec.badgeText }}
              >
                → {targetLang}
              </span>
            </div>
          )
        })()}

        {/* Fact Checker: flags badge after run */}
        {subtype === 'fact-checker' && status === 'passed' && (() => {
          const output = nodeStatuses[id]?.output
          const text = typeof output === 'string' ? output : ''
          const summaryMatch = text.match(/##\s*FACT\s+CHECK\s+SUMMARY([\s\S]*)$/i)
          const summaryText = summaryMatch?.[1] ?? ''
          const isClean = !summaryText.trim() || summaryText.toLowerCase().includes('no issues found')
          const flagCount = isClean ? 0 : (summaryText.match(/\*\*Claim:\*\*/gi) ?? []).length
          return (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                style={isClean
                  ? { backgroundColor: '#dcfce7', color: '#166534' }
                  : { backgroundColor: '#fef3c7', color: '#92400e' }
                }
              >
                {isClean ? 'Clean' : `${flagCount} flag${flagCount === 1 ? '' : 's'}`}
              </span>
            </div>
          )
        })()}

        {/* Conditional branch: pass/fail labels */}
        {subtype === 'conditional-branch' && data.config && (() => {
          const cfg = data.config as Record<string, unknown>
          const passLabel = (cfg.pass_label as string) || 'pass'
          const failLabel = (cfg.fail_label as string) || 'fail'
          return passLabel !== 'pass' || failLabel !== 'fail' ? (
            <p className="mt-0.5 text-[10px]" style={{ color: portLblColor }}>{passLabel} / {failLabel}</p>
          ) : null
        })()}

        {/* SEO / GEO Review: mode subtext + score badge + Optimize/Review toggle */}
        {(subtype === 'seo-review' || subtype === 'geo-review') && (() => {
          const cfg = (data.config as Record<string, unknown>) ?? {}
          const mode = (cfg.mode as string) ?? 'optimize'
          const reviewOut = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const score = reviewOut?.score as number | undefined
          const notApplicable = reviewOut?.not_applicable as boolean | undefined

          return (
            <div className="mt-1 space-y-1.5">
              {/* Mode label */}
              <p className="text-[10px]" style={{ color: spec.accent + 'cc' }}>
                {mode === 'optimize' ? 'Optimizing' : 'Review only'}
              </p>

              {/* Score badge (post-run) */}
              {score !== undefined && !notApplicable && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={{
                      backgroundColor: score >= 80 ? '#dcfce7' : score >= 60 ? '#fef9c3' : '#fee2e2',
                      color:           score >= 80 ? '#166534' : score >= 60 ? '#854d0e' : '#991b1b',
                    }}
                  >
                    {score}
                  </span>
                  <span className="text-[10px]" style={{ color: '#b4b2a9' }}>/ 100</span>
                </div>
              )}
              {notApplicable && (
                <span className="text-[10px]" style={{ color: '#b4b2a9' }}>N/A for this type</span>
              )}

              {/* Optimize / Review toggle */}
              <button
                className="nodrag flex items-center gap-1.5"
                title={mode === 'optimize' ? 'Click to switch to Review only mode' : 'Click to switch to Optimize mode'}
                onClick={(e) => {
                  e.stopPropagation()
                  const newMode = mode === 'optimize' ? 'review_only' : 'optimize'
                  updateNodeData(id, { config: { ...cfg, mode: newMode } })
                }}
              >
                <div
                  className="relative inline-flex h-3.5 w-6 shrink-0 rounded-full border border-transparent transition-colors"
                  style={{ backgroundColor: mode === 'optimize' ? spec.accent : '#d1d5db' }}
                >
                  <span
                    className="pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform mt-px"
                    style={{ transform: mode === 'optimize' ? 'translateX(10px)' : 'translateX(1px)' }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: mode === 'optimize' ? spec.accent : '#9ca3af' }}>
                  {mode === 'optimize' ? 'Optimize' : 'Review'}
                </span>
              </button>
            </div>
          )
        })()}
      </div>

      {/* Input handles */}
      {portConfig.inputs.map((port) => (
        <Handle key={port.id} type="target" position={Position.Left} id={port.id} style={{ top: port.top }} />
      ))}

      {/* Input port labels (merge numbered) */}
      {portConfig.inputs.filter((p) => p.label).map((port) => (
        <span
          key={`lbl-in-${port.id}`}
          className="pointer-events-none absolute left-2 -translate-y-1/2 select-none text-[9px] font-semibold leading-none"
          style={{ top: port.top, color: portLblColor }}
        >
          {port.label}
        </span>
      ))}

      {/* Output handles */}
      {portConfig.outputs.map((port) => (
        <Handle key={port.id} type="source" position={Position.Right} id={port.id} style={{ top: port.top }} />
      ))}

      {/* Output port labels (condition pass/fail, etc.) */}
      {portConfig.outputs.filter((p) => p.label).map((port) => {
        let displayLabel = port.label
        if (subtype === 'conditional-branch' && data.config) {
          const cfg = data.config as Record<string, unknown>
          if (port.id === 'pass') displayLabel = (cfg.pass_label as string) || 'pass'
          if (port.id === 'fail') displayLabel = (cfg.fail_label as string) || 'fail'
        }
        return (
          <span
            key={`lbl-out-${port.id}`}
            className="pointer-events-none absolute right-2 -translate-y-1/2 select-none text-[9px] font-semibold leading-none"
            style={{ top: port.top, color: portLblColor }}
          >
            {displayLabel}
          </span>
        )
      })}
    </div>
  )
})
LogicNode.displayName = 'LogicNode'
