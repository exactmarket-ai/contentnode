import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'

const ASSET_OPTIONS = [
  { value: '5', label: 'Asset 06 — Video Script' },
  { value: '0', label: 'Asset 01 — Brochure' },
  { value: '1', label: 'Asset 02 — Playbook' },
  { value: '2', label: 'Asset 03 — Customer Deck' },
  { value: '3', label: 'Asset 04 — BDR Emails' },
  { value: '4', label: 'Asset 05 — Target Audience Trigger' },
  { value: '6', label: 'Asset 07 — Web Page Copy' },
  { value: '7', label: 'Asset 08 — LinkedIn Posts' },
]

export function VideoScriptReaderConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const source = (config.source as string) ?? 'kit_session'

  return (
    <>
      <FieldGroup
        label="Source"
        description="GTM Kit Session reads the raw markdown directly from a generated kit. Passthrough forwards upstream node output."
      >
        <Select value={source} onValueChange={(v) => onChange('source', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="kit_session" className="text-xs">GTM Kit Session</SelectItem>
            <SelectItem value="passthrough" className="text-xs">Passthrough (upstream input)</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {source === 'kit_session' && (
        <>
          <FieldGroup
            label="Kit Session ID"
            description="Find this in the GTM Kit Generator URL: /clients/:clientId/:verticalId — use the session ID from the API or ask your admin."
          >
            <Input
              className="h-8 text-xs font-mono"
              placeholder="cmoj6748j000tyig0tdshl1nq"
              value={(config.kitSessionId as string) ?? ''}
              onChange={(e) => onChange('kitSessionId', e.target.value)}
            />
          </FieldGroup>

          <FieldGroup label="Asset">
            <Select
              value={String(config.assetIndex ?? 5)}
              onValueChange={(v) => onChange('assetIndex', parseInt(v, 10))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>
        </>
      )}
    </>
  )
}
