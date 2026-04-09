import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'

const EMAIL_PROVIDERS = [
  { value: 'resend',   label: 'Resend' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'mailgun',  label: 'Mailgun' },
]

const EMAIL_API_KEY_PLACEHOLDER: Record<string, string> = {
  resend:   'RESEND_API_KEY',
  sendgrid: 'SENDGRID_API_KEY',
  mailgun:  'MAILGUN_API_KEY',
}

export function EmailConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const provider = (config.provider as string) ?? 'sendgrid'
  return (
    <>
      <FieldGroup label="Provider">
        <Select value={provider} onValueChange={(v) => { onChange('provider', v); onChange('api_key_ref', EMAIL_API_KEY_PLACEHOLDER[v] ?? '') }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EMAIL_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="API Key (env var name)">
        <Input
          placeholder={EMAIL_API_KEY_PLACEHOLDER[provider] ?? 'API_KEY'}
          className="text-xs"
          value={(config.api_key_ref as string) ?? ''}
          onChange={(e) => onChange('api_key_ref', e.target.value)}
        />
      </FieldGroup>
      {provider === 'mailgun' && (
        <FieldGroup label="Mailgun Domain">
          <Input
            placeholder="mg.yourdomain.com"
            className="text-xs"
            value={(config.mailgun_domain as string) ?? ''}
            onChange={(e) => onChange('mailgun_domain', e.target.value)}
          />
        </FieldGroup>
      )}
      <FieldGroup label="From Email">
        <Input
          placeholder="noreply@yourdomain.com"
          className="text-xs"
          value={(config.from_email as string) ?? ''}
          onChange={(e) => onChange('from_email', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="From Name (optional)">
        <Input
          placeholder="ContentNode"
          className="text-xs"
          value={(config.from_name as string) ?? ''}
          onChange={(e) => onChange('from_name', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="To">
        <Input
          placeholder="recipient@example.com, another@example.com"
          className="text-xs"
          value={(config.to as string) ?? ''}
          onChange={(e) => onChange('to', e.target.value)}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Comma-separated for multiple recipients</p>
      </FieldGroup>
      <FieldGroup label="Subject">
        <Input
          placeholder="Your content is ready"
          className="text-xs"
          value={(config.subject as string) ?? ''}
          onChange={(e) => onChange('subject', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}
