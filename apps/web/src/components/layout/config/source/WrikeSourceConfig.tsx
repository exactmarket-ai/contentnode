import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { apiFetch } from '@/lib/api'
import * as Icons from 'lucide-react'

export function WrikeSourceConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/integrations/wrike/status')
      .then((r) => r.json())
      .then(({ data }) => setConnected(!!data?.connected))
      .catch(() => setConnected(false))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Connection status */}
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${
        connected === true  ? 'border-green-200 bg-green-50 text-green-700' :
        connected === false ? 'border-amber-200 bg-amber-50 text-amber-700' :
        'border-border bg-muted/20 text-muted-foreground'
      }`}>
        {connected === true  && <Icons.CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
        {connected === false && <Icons.AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
        {connected === null  && <Icons.Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        <span>
          {connected === true  && 'Wrike connected'}
          {connected === false && 'Wrike not connected — go to Settings → Integrations'}
          {connected === null  && 'Checking connection…'}
        </span>
      </div>

      {/* Days back */}
      <FieldGroup label="Days Back" description="How many days of completed tasks to pull">
        <Input
          type="number"
          min={1}
          max={90}
          className="h-8 text-xs"
          value={(config.days_back as number) ?? 14}
          onChange={(e) => onChange('days_back', Math.max(1, Math.min(90, Number(e.target.value))))}
        />
      </FieldGroup>

      {/* Synthesis type */}
      <FieldGroup label="Output Format">
        <Select
          value={(config.synthesis as string) ?? 'summary'}
          onValueChange={(v) => onChange('synthesis', v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="summary" className="text-xs">Campaign Narrative — ready for internal comms</SelectItem>
            <SelectItem value="structured" className="text-xs">Structured Report — categorized with achievements</SelectItem>
            <SelectItem value="raw" className="text-xs">Raw JSON — unprocessed Wrike data</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>
    </div>
  )
}
