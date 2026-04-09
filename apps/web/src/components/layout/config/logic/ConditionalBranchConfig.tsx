import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkflowStore } from '@/store/workflowStore'
import { FieldGroup } from '../shared'

export function ConditionalBranchConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const conditionType = (config.condition_type as string) ?? 'detection_score'
  const operator = (config.operator as string) ?? 'above'
  const value = (config.value as number) ?? 20
  const passLabel = (config.pass_label as string) ?? 'pass'
  const failLabel = (config.fail_label as string) ?? 'fail'
  const fallbackHumanizerId = (config.fallback_humanizer_id as string) ?? ''

  // Get humanizer nodes from the store for the fallback selector
  const nodes = useWorkflowStore((s) => s.nodes)
  const humanizerNodes = nodes.filter(
    (n) => n.data?.subtype === 'humanizer',
  )

  return (
    <>
      {/* Condition type */}
      <FieldGroup label="Condition Type">
        <Select value={conditionType} onValueChange={(v) => onChange('condition_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="detection_score" className="text-xs">Detection Score</SelectItem>
            <SelectItem value="word_count"      className="text-xs">Word Count</SelectItem>
            <SelectItem value="retry_count"     className="text-xs">Retry Count</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Operator */}
      <FieldGroup label="Operator">
        <Select value={operator} onValueChange={(v) => onChange('operator', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="above" className="text-xs">Above</SelectItem>
            <SelectItem value="below" className="text-xs">Below</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Value */}
      <FieldGroup label="Value">
        <Input
          type="number"
          min={0}
          className="h-8 text-xs"
          value={value}
          onChange={(e) => onChange('value', parseInt(e.target.value) || 0)}
        />
      </FieldGroup>

      {/* Port labels */}
      <div className="grid grid-cols-2 gap-2">
        <FieldGroup label="Pass label">
          <Input
            className="h-8 text-xs"
            placeholder="pass"
            value={passLabel}
            onChange={(e) => onChange('pass_label', e.target.value)}
          />
        </FieldGroup>
        <FieldGroup label="Fail label">
          <Input
            className="h-8 text-xs"
            placeholder="fail"
            value={failLabel}
            onChange={(e) => onChange('fail_label', e.target.value)}
          />
        </FieldGroup>
      </div>

      {/* Fallback humanizer selector */}
      <FieldGroup label="Fallback Humanizer (after max retries)">
        <Select
          value={fallbackHumanizerId || '__none__'}
          onValueChange={(v) => onChange('fallback_humanizer_id', v === '__none__' ? '' : v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
            {humanizerNodes.map((n) => (
              <SelectItem key={n.id} value={n.id} className="text-xs">
                {(n.data?.label as string) || n.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Humanizer to use when max retries are exhausted
        </p>
      </FieldGroup>
    </>
  )
}
