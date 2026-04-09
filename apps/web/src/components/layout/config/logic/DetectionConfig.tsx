import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { FieldGroup } from '../shared'

const DETECTION_SERVICES = [
  { value: 'gptzero',      label: 'GPTZero' },
  { value: 'originality',  label: 'Originality.ai' },
  { value: 'copyleaks',    label: 'Copyleaks' },
  { value: 'sapling',      label: 'Sapling' },
  { value: 'local',        label: 'Local (offline)' },
]

export function DetectionConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { output?: unknown; warning?: string }
}) {
  const service = (config.service as string) ?? 'gptzero'
  const threshold = (config.threshold as number) ?? 20
  const maxRetries = (config.max_retries as number) ?? 3
  const apiKeyRef = (config.api_key_ref as string) ?? ''

  // Run-time output
  const detOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const overallScore = detOutput?.overall_score as number | undefined
  const flaggedSentences = detOutput?.flagged_sentences as string[] | undefined
  const warning = nodeRunStatus?.warning

  return (
    <>
      {/* Service */}
      <FieldGroup label="Detection Service">
        <Select value={service} onValueChange={(v) => onChange('service', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DETECTION_SERVICES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Threshold */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Threshold</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{threshold}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={threshold}
          onChange={(e) => onChange('threshold', parseInt(e.target.value))}
          className="w-full accent-blue-500"
        />
        <p className="text-[11px] text-muted-foreground">
          Scores above this value trigger the humanizer loop
        </p>
      </div>

      {/* Max retries */}
      <FieldGroup label="Max Retries">
        <Input
          type="number"
          min={1}
          max={10}
          className="h-8 text-xs"
          value={maxRetries}
          onChange={(e) => onChange('max_retries', parseInt(e.target.value) || 3)}
        />
      </FieldGroup>

      {/* API key reference */}
      {service !== 'local' && (
        <FieldGroup label="API Key Environment Variable">
          <Input
            placeholder="e.g. GPTZERO_API_KEY"
            className="font-mono text-xs"
            value={apiKeyRef}
            onChange={(e) => onChange('api_key_ref', e.target.value)}
          />
        </FieldGroup>
      )}

      {/* ── Run-time results ── */}
      {overallScore !== undefined && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Last Run Score</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  overallScore <= 20  ? 'bg-emerald-100 text-emerald-700' :
                  overallScore <= 50  ? 'bg-amber-100   text-amber-700'  :
                                        'bg-red-100     text-red-700',
                )}
              >
                {overallScore}%
              </span>
            </div>

            {warning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                <span className="mt-0.5 shrink-0 text-sm text-amber-600">⚠</span>
                <p className="text-xs text-amber-700">{warning}</p>
              </div>
            )}

            {flaggedSentences && flaggedSentences.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Flagged Sentences ({flaggedSentences.length})
                </Label>
                <div className="max-h-[200px] space-y-1 overflow-y-auto">
                  {flaggedSentences.map((sentence, i) => (
                    <div
                      key={i}
                      className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600"
                    >
                      {sentence}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {flaggedSentences?.length === 0 && (
              <p className="text-xs text-emerald-400">No sentences flagged — content looks human-written.</p>
            )}
          </div>
        </>
      )}
    </>
  )
}
