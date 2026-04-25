import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'

const EMAIL_PROVIDERS = [
  { value: 'resend',   label: 'Resend' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'mailgun',  label: 'Mailgun' },
]

export function EmailConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const provider = (config.provider as string) ?? 'sendgrid'
  return (
    <>
      <FieldGroup label="Provider" description="API key is configured in Settings → Email Provider Credentials">
        <Select value={provider} onValueChange={(v) => onChange('provider', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EMAIL_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
