import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'

const BELOW_THRESHOLD_OPTIONS = [
  { value: 'flag',         label: 'Flag and continue', description: 'Workflow continues, content is flagged in output' },
  { value: 'block',        label: 'Block',             description: 'Workflow stops — connect the Block port to a Human Review node' },
  { value: 'pass_through', label: 'Pass through',      description: 'Workflow continues regardless of score (informational)' },
]

function ScoreBreakdown({ breakdown }: {
  breakdown: Array<{ criterion: string; score: number; note: string }>
}) {
  return (
    <div className="space-y-1">
      {breakdown.map((item) => (
        <div key={item.criterion} className="flex items-start gap-2 rounded border border-border px-2 py-1.5">
          <div className="mt-px flex h-5 w-8 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
            style={{
              backgroundColor: item.score >= 8 ? '#dcfce7' : item.score >= 6 ? '#fef9c3' : '#fee2e2',
              color:           item.score >= 8 ? '#166534' : item.score >= 6 ? '#854d0e' : '#991b1b',
            }}
          >
            {item.score}/10
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium leading-tight truncate">{item.criterion}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{item.note}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export function GeoReviewConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const mode = (config.mode as string) ?? 'optimize'
  const threshold = (config.threshold as number) ?? 70
  const belowAction = (config.below_threshold_action as string) ?? 'flag'
  const showBreakdown = config.show_breakdown !== false

  const runOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const score = runOutput?.score as number | undefined
  const breakdown = runOutput?.breakdown as Array<{ criterion: string; score: number; note: string }> | undefined
  const notApplicable = runOutput?.not_applicable as boolean | undefined
  const gatedNote = runOutput?.gated_note as string | undefined

  return (
    <div className="flex flex-col gap-4">

      {/* ── Mode section ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Mode</p>

        {/* Optimize / Review toggle */}
        <div
          className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
            mode === 'optimize' ? 'border-cyan-300 bg-cyan-50/50' : 'border-border bg-muted/20'
          }`}
        >
          <div className="flex items-center gap-2">
            {mode === 'optimize'
              ? <Icons.Zap className="h-3.5 w-3.5 text-cyan-600" />
              : <Icons.Eye className="h-3.5 w-3.5 text-muted-foreground" />}
            <div>
              <p className="text-xs font-medium">
                {mode === 'optimize' ? 'Optimize' : 'Review only'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {mode === 'optimize'
                  ? 'GEO requirements are injected into the upstream generation prompt before content is generated'
                  : 'Content is evaluated after generation without modifying the prompt'}
              </p>
            </div>
          </div>
          <button
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              mode === 'optimize' ? 'bg-cyan-500' : 'bg-input'
            }`}
            onClick={() => onChange('mode', mode === 'optimize' ? 'review_only' : 'optimize')}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
              mode === 'optimize' ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>

      {/* ── Scoring section ── */}
      <div className="space-y-3 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground">Scoring</p>

        {/* Threshold slider */}
        <FieldGroup label={`Minimum passing score: ${threshold}`}>
          <input
            type="range" min={0} max={100} step={5}
            className="w-full accent-cyan-600"
            value={threshold}
            onChange={(e) => onChange('threshold', Number(e.target.value))}
          />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>0</span><span>50</span><span>100</span>
          </div>
        </FieldGroup>

        {/* Below-threshold action */}
        <FieldGroup label="Below threshold action">
          <div className="space-y-1.5">
            {BELOW_THRESHOLD_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="geo-below-action"
                  value={opt.value}
                  checked={belowAction === opt.value}
                  onChange={() => onChange('below_threshold_action', opt.value)}
                  className="mt-0.5 accent-cyan-600 shrink-0"
                />
                <div>
                  <p className="text-xs font-medium">{opt.label}</p>
                  <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </FieldGroup>

        {/* Show breakdown toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showBreakdown}
            onChange={(e) => onChange('show_breakdown', e.target.checked)}
            className="accent-cyan-600"
          />
          <span className="text-xs">Show score breakdown</span>
        </label>
      </div>

      {/* ── Post-run results ── */}
      {notApplicable && (
        <div className="rounded-md border border-dashed border-border p-3 text-center">
          <p className="text-xs text-muted-foreground">Not applicable for this content type</p>
        </div>
      )}

      {score !== undefined && !notApplicable && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-sm font-bold tabular-nums"
              style={{
                backgroundColor: score >= 80 ? '#dcfce7' : score >= 60 ? '#fef9c3' : '#fee2e2',
                color:           score >= 80 ? '#166534' : score >= 60 ? '#854d0e' : '#991b1b',
              }}
            >
              {score}
            </span>
            <span className="text-xs text-muted-foreground">/ 100 GEO score</span>
          </div>
          {gatedNote && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
              {gatedNote}
            </div>
          )}
          {showBreakdown && breakdown && breakdown.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground">Criterion breakdown</p>
              <ScoreBreakdown breakdown={breakdown} />
            </>
          )}
        </div>
      )}

      {/* ── Criteria reference ── */}
      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          GEO criteria reference (10 criteria)
        </summary>
        <ol className="mt-2 space-y-1 pl-4">
          {[
            'Answer-first structure (first 30–50 words)',
            'FAQ block (35–55 word self-contained answers)',
            'Heading clarity (question / declarative form)',
            'Cited statistics (named source)',
            'Entity definitions (key terms defined)',
            'Author authority signals (named author + credential)',
            'E-E-A-T language (experience + expertise indicators)',
            'Content freshness signals (date, current examples)',
            'Structured answer density (bullets, Q&A, lists)',
            'Citation coverage (core answer in first 30%)',
          ].map((c, i) => (
            <li key={i} className="text-[10px] text-muted-foreground">{c}</li>
          ))}
        </ol>
      </details>
    </div>
  )
}
