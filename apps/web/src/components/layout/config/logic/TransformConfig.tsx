import { Textarea } from '@/components/ui/textarea'
import { FieldGroup } from '../shared'

export function TransformConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Expression (JS)">
      <Textarea
        placeholder="return input.trim()"
        className="min-h-[100px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Use <code className="text-blue-400">input</code> to reference the incoming value.
      </p>
    </FieldGroup>
  )
}
