import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldGroup } from '../shared'

export function WebhookConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const authType = (config.auth_type as string) ?? 'none'
  return (
    <>
      <FieldGroup label="URL">
        <Input
          placeholder="https://hooks.example.com/..."
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Method">
        <Select value={(config.method as string) ?? 'POST'} onValueChange={(v) => onChange('method', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['POST', 'PUT', 'PATCH'].map((m) => (
              <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="Content Type">
        <Select value={(config.content_type as string) ?? 'application/json'} onValueChange={(v) => onChange('content_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="application/json" className="text-xs">JSON</SelectItem>
            <SelectItem value="application/x-www-form-urlencoded" className="text-xs">Form URL-encoded</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="Auth">
        <Select value={authType} onValueChange={(v) => onChange('auth_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">None</SelectItem>
            <SelectItem value="bearer" className="text-xs">Bearer token</SelectItem>
            <SelectItem value="basic" className="text-xs">Basic auth (user:pass)</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>
      {authType !== 'none' && (
        <FieldGroup label="Auth value (env var name)">
          <Input
            placeholder="WEBHOOK_AUTH_TOKEN"
            className="text-xs"
            value={(config.auth_value_ref as string) ?? ''}
            onChange={(e) => onChange('auth_value_ref', e.target.value)}
          />
        </FieldGroup>
      )}
      <FieldGroup label="HMAC secret (env var name, optional)">
        <Input
          placeholder="WEBHOOK_SECRET"
          className="text-xs"
          value={(config.secret_ref as string) ?? ''}
          onChange={(e) => onChange('secret_ref', e.target.value)}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Signs payload with X-ContentNode-Signature header</p>
      </FieldGroup>
      <FieldGroup label="Custom headers (optional)">
        <Textarea
          placeholder={'X-My-Header: value\nAnother-Header: value'}
          className="text-xs font-mono"
          rows={3}
          value={(config.custom_headers as string) ?? ''}
          onChange={(e) => onChange('custom_headers', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}
