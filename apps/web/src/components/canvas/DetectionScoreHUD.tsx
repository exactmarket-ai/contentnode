import { useWorkflowStore } from '@/store/workflowStore'
import { cn } from '@/lib/utils'
import * as Icons from 'lucide-react'

function scoreColor(score: number): string {
  if (score <= 30) return 'bg-green-500'
  if (score <= 60) return 'bg-amber-400'
  return 'bg-red-500'
}

function scoreTextColor(score: number): string {
  if (score <= 30) return 'text-green-500'
  if (score <= 60) return 'text-amber-400'
  return 'text-red-500'
}

function ScoreBar({ score, pass, isCurrent }: { score: number; pass: number; isCurrent: boolean }) {
  const height = Math.max(8, score)
  return (
    <div className="flex flex-col items-center gap-0.5" title={`Pass ${pass}: ${Math.round(score)}%`}>
      <div
        className={cn(
          'w-5 rounded-sm transition-all duration-300',
          scoreColor(score),
          isCurrent && 'ring-2 ring-white/60 ring-offset-1 ring-offset-card',
        )}
        style={{ height: `${height * 0.56}px` }}
      />
      <span className="text-[9px] text-muted-foreground/70 tabular-nums">{Math.round(score)}</span>
    </div>
  )
}

function NodeScoreSection({
  label,
  scores,
  isRunning,
}: {
  label: string
  scores: number[]
  isRunning: boolean
}) {
  const latest = scores[scores.length - 1]
  const trend = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : null

  return (
    <div className="flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground truncate max-w-[140px]">{label}</span>
        <div className="flex items-center gap-1.5">
          {trend !== null && (
            <span className={cn('text-[10px] font-medium tabular-nums', trend < 0 ? 'text-green-500' : 'text-red-400')}>
              {trend < 0 ? '▼' : '▲'} {Math.abs(Math.round(trend))}
            </span>
          )}
          {latest !== undefined && (
            <span className={cn('text-sm font-bold tabular-nums', scoreTextColor(latest))}>
              {Math.round(latest)}%
            </span>
          )}
          {isRunning && (
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
      </div>

      {/* Score bars */}
      {scores.length > 0 && (
        <div className="flex items-end gap-1" style={{ height: '56px' }}>
          {scores.map((s, i) => (
            <ScoreBar
              key={i}
              score={s}
              pass={i + 1}
              isCurrent={i === scores.length - 1}
            />
          ))}
          {/* Pulsing placeholder for next pass */}
          {isRunning && (
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-5 rounded-sm bg-muted-foreground/20 animate-pulse" style={{ height: '20px' }} />
              <span className="text-[9px] text-muted-foreground/30">…</span>
            </div>
          )}
        </div>
      )}

      {/* 30% threshold line label */}
      {scores.length > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-px flex-1 bg-green-500/30 border-t border-dashed border-green-500/40" />
          <span className="text-[9px] text-green-500/60">30% target</span>
          <div className="h-px flex-1 bg-green-500/30 border-t border-dashed border-green-500/40" />
        </div>
      )}
    </div>
  )
}

export function DetectionScoreHUD() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const nodeRunStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const detectionScoreHistory = useWorkflowStore((s) => s.detectionScoreHistory)

  // Find all detection nodes in the workflow
  const detectionNodes = nodes.filter((n) => {
    const cfg = (n.data?.config as Record<string, unknown>) ?? {}
    return (n.data?.subtype ?? cfg.subtype) === 'detection'
  })

  const isActiveRun = runStatus === 'running'
  const isVisible =
    detectionNodes.length > 0 &&
    (isActiveRun || runStatus === 'completed' || runStatus === 'failed') &&
    // Only show if at least one detection node has scores
    detectionNodes.some((n) => {
      const history = detectionScoreHistory[n.id]
      const fromOutput = (nodeRunStatuses[n.id]?.output as Record<string, unknown> | undefined)?.overall_score
      return (history && history.length > 0) || fromOutput !== undefined
    })

  if (!isVisible) return null

  return (
    <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 -translate-x-1/2">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/95 backdrop-blur-sm px-4 py-3 shadow-xl min-w-[260px] max-w-[480px]">
        {/* Title */}
        <div className="flex items-center gap-2">
          <Icons.ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            AI Detection Scores
          </span>
          {isActiveRun && (
            <span className="ml-auto text-[10px] text-blue-400 font-medium animate-pulse">LIVE</span>
          )}
        </div>

        {/* One section per detection node */}
        <div className="flex flex-col gap-4">
          {detectionNodes.map((node) => {
            const nodeId = node.id
            const label = (node.data?.label as string) ?? 'Detection'
            const nodeStatus = nodeRunStatuses[nodeId]
            const historyFromState = detectionScoreHistory[nodeId]
            // Fall back to single score from nodeStatus output if no history yet
            const singleScore = (nodeStatus?.output as Record<string, unknown> | undefined)?.overall_score as number | undefined
            const scores: number[] =
              historyFromState && historyFromState.length > 0
                ? historyFromState
                : singleScore !== undefined
                ? [singleScore]
                : []
            const isThisNodeRunning = isActiveRun && nodeStatus?.status === 'running'

            if (scores.length === 0 && !isThisNodeRunning) return null

            return (
              <NodeScoreSection
                key={nodeId}
                label={label}
                scores={scores}
                isRunning={isThisNodeRunning}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
