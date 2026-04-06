import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'

// ─── Port configuration ───────────────────────────────────────────────────────

interface PortDef {
  id: string
  label?: string
  /** Percentage from top of node (e.g. '33%'). Must match the label position. */
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
      // 5 inputs spread across the body area (below the ~32% header zone)
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
  const status = nodeStatuses[id]?.status ?? 'idle'
  const subtype = data.subtype as string
  const portConfig = getPortConfig(subtype)

  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[data.icon as string] ?? Icons.Box

  return (
    <div
      className={cn(
        // `relative` so port labels (absolute children) align with handle top percentages
        'relative min-w-[160px] rounded-lg border bg-card transition-all',
        selected
          ? 'border-blue-500/70 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]'
          : 'border-border hover:border-blue-500/40',
        status === 'running' && 'border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.4)]',
        status === 'passed'  && 'border-blue-600',
        status === 'failed'  && 'border-red-500',
        // Merge needs extra height so 5 input handles are comfortably spaced
        subtype === 'merge'  && 'min-h-[130px]',
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-border bg-blue-500/10 px-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-500/20">
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

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{data.description as string}</p>

        {/* AI-generate: show model override */}
        {subtype === 'ai-generate' &&
          data.config &&
          (data.config as Record<string, unknown>).model_config && (
            <p className="mt-1 text-xs text-blue-400/70">
              {((data.config as Record<string, unknown>).model_config as Record<string, unknown>)?.model as string}
            </p>
          )}

        {/* Detection: show score badge after a run */}
        {subtype === 'detection' && status !== 'idle' && (() => {
          const detOut = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const score = detOut?.overall_score as number | undefined
          const warning = nodeStatuses[id]?.warning
          return score !== undefined ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                  score <= 20  ? 'bg-emerald-900/60 text-emerald-300' :
                  score <= 50  ? 'bg-amber-900/60  text-amber-300'   :
                                 'bg-red-900/60    text-red-300',
                )}
              >
                {score}%
              </span>
              <span className="text-[10px] text-muted-foreground">AI score</span>
              {warning && (
                <span className="text-[10px] text-amber-400" title={warning}>⚠</span>
              )}
            </div>
          ) : null
        })()}

        {/* Conditional Branch: show pass/fail labels from config */}
        {subtype === 'conditional-branch' && data.config && (() => {
          const cfg = data.config as Record<string, unknown>
          const passLabel = (cfg.pass_label as string) || 'pass'
          const failLabel = (cfg.fail_label as string) || 'fail'
          return passLabel !== 'pass' || failLabel !== 'fail' ? (
            <p className="mt-0.5 text-[10px] text-blue-400/50">{passLabel} / {failLabel}</p>
          ) : null
        })()}
      </div>

      {/* ── Input handles ──────────────────────────────────────────────────── */}
      {portConfig.inputs.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ top: port.top }}
        />
      ))}

      {/* Input port labels — shown for merge (numbered 1-5) */}
      {portConfig.inputs
        .filter((p) => p.label)
        .map((port) => (
          <span
            key={`lbl-in-${port.id}`}
            className="pointer-events-none absolute left-2 -translate-y-1/2 select-none text-[9px] font-semibold leading-none text-blue-400/60"
            style={{ top: port.top }}
          >
            {port.label}
          </span>
        ))}

      {/* ── Output handles ─────────────────────────────────────────────────── */}
      {portConfig.outputs.map((port) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ top: port.top }}
        />
      ))}

      {/* Output port labels — condition (pass/fail), human-review, detection, conditional-branch */}
      {portConfig.outputs
        .filter((p) => p.label)
        .map((port) => {
          // For conditional-branch, use dynamic labels from config
          let displayLabel = port.label
          if (subtype === 'conditional-branch' && data.config) {
            const cfg = data.config as Record<string, unknown>
            if (port.id === 'pass') displayLabel = (cfg.pass_label as string) || 'pass'
            if (port.id === 'fail') displayLabel = (cfg.fail_label as string) || 'fail'
          }
          return (
            <span
              key={`lbl-out-${port.id}`}
              className="pointer-events-none absolute right-2 -translate-y-1/2 select-none text-[9px] font-semibold leading-none text-blue-400/60"
              style={{ top: port.top }}
            >
              {displayLabel}
            </span>
          )
        })}
    </div>
  )
})
LogicNode.displayName = 'LogicNode'
