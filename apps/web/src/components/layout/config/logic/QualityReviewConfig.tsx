import * as Icons from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldGroup } from '../shared'
import type { NodeRunStatus } from '@/store/workflowStore'
import { cn } from '@/lib/utils'

interface Props {
  config: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  nodeRunStatus?: NodeRunStatus
}

interface QualityOutput {
  score?: number
  strengths?: string[]
  weaknesses?: string[]
  overall_critique?: string
  improved_prompt?: string
  content_suggestions?: string
  insight_created?: boolean
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? { bg: '#f0fdf4', border: '#86efac', text: '#16a34a' }
    : score >= 6 ? { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' }
    : { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' }

  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold"
      style={{ backgroundColor: color.bg, border: `1px solid ${color.border}`, color: color.text }}
    >
      <Icons.Star className="h-3.5 w-3.5" />
      {score}/10
    </div>
  )
}

export function QualityReviewConfig({ config, onChange, nodeRunStatus }: Props) {
  const output = nodeRunStatus?.output as QualityOutput | undefined
  const hasOutput = output && typeof output.score === 'number'

  return (
    <div className="space-y-4 p-4">
      {/* Post-run output */}
      {hasOutput && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality Review</p>
            <ScoreBadge score={output.score!} />
          </div>

          {output.overall_critique && (
            <p className="text-xs text-foreground leading-relaxed">{output.overall_critique}</p>
          )}

          {output.strengths && output.strengths.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-green-600 mb-1">Strengths</p>
              <ul className="space-y-0.5">
                {output.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Icons.CheckCircle className="h-3 w-3 mt-0.5 shrink-0 text-green-500" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {output.weaknesses && output.weaknesses.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1">Weaknesses</p>
              <ul className="space-y-0.5">
                {output.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Icons.XCircle className="h-3 w-3 mt-0.5 shrink-0 text-red-400" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {output.improved_prompt && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1">Improved Prompt</p>
              <div className="rounded-md border border-blue-200 bg-blue-50/50 p-2">
                <p className="text-xs text-foreground leading-relaxed">{output.improved_prompt}</p>
              </div>
            </div>
          )}

          {output.content_suggestions && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Content Suggestions</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{output.content_suggestions}</p>
            </div>
          )}

          {output.insight_created && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <Icons.Lightbulb className="h-3.5 w-3.5" />
              Insight created — check the Insights tab
            </div>
          )}
        </div>
      )}

      {/* Goal */}
      <FieldGroup label="Content Goal">
        <p className="text-[10px] text-muted-foreground mb-1">What should this content achieve? Be specific about audience, tone, and purpose.</p>
        <Textarea
          value={(config.goal as string) ?? ''}
          onChange={(e) => onChange('goal', e.target.value)}
          placeholder="e.g. A compelling blog post for marketing directors that drives them to request a demo, written in a confident but approachable tone."
          className="text-xs min-h-[80px]"
        />
      </FieldGroup>

      <FieldGroup label="Evaluation Rubric">
        <p className="text-[10px] text-muted-foreground mb-1">Optional custom scoring criteria.</p>
        <Textarea
          value={(config.rubric as string) ?? ''}
          onChange={(e) => onChange('rubric', e.target.value)}
          placeholder={`- Has a strong opening hook\n- Includes 3+ specific examples\n- Ends with a clear CTA`}
          className="text-xs min-h-[64px]"
        />
      </FieldGroup>

      <FieldGroup label="Insight Threshold">
        <p className="text-[10px] text-muted-foreground mb-1">Create an insight if score falls below this (1–10).</p>
        <Input
          type="number"
          min={1}
          max={10}
          value={(config.insight_threshold as number) ?? 7}
          onChange={(e) => onChange('insight_threshold', Number(e.target.value))}
          className="text-xs h-8 w-24"
        />
      </FieldGroup>

      <div className="flex items-center gap-2">
        <input
          id="auto_insight"
          type="checkbox"
          checked={(config.auto_create_insight as boolean) !== false}
          onChange={(e) => onChange('auto_create_insight', e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
        />
        <Label htmlFor="auto_insight" className="text-xs cursor-pointer">Auto-create insight on low score</Label>
      </div>
    </div>
  )
}
