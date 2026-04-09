import { Textarea } from '@/components/ui/textarea'
import { FieldGroup } from '../shared'

export function ConditionConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Condition (JS, returns boolean)">
      <Textarea
        placeholder="return input.length > 100"
        className="min-h-[80px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
    </FieldGroup>
  )
}
