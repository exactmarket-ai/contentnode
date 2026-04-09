import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup, CONTENT_ROLES } from '../shared'

export function ApiFetchConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="Content Role">
        <Select value={(config.content_role as string) ?? 'source-material'} onValueChange={(v) => onChange('content_role', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="URL">
        <Input
          placeholder="https://api.example.com/data"
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Method">
        <Select value={(config.method as string) ?? 'GET'} onValueChange={(v) => onChange('method', v)}>
          <SelectTrigger className="text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
    </>
  )
}
