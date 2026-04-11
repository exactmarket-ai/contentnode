import { FieldGroup } from '../shared'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import * as Icons from 'lucide-react'

const GEMINI_MODELS = [
  { value: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash (default)' },
  { value: 'gemini-2.5-pro',            label: 'Gemini 2.5 Pro (best quality)' },
  { value: 'gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite (fastest, cheapest)' },
]

const DEFAULT_PROMPT =
  'Analyze this video and provide: (1) what it is about, (2) key topics and visuals, (3) any on-screen text or graphics, (4) the tone and purpose, (5) a 2–3 sentence summary for content planning.'

export function VideoIntelligenceConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const model  = (config.model  as string) ?? 'gemini-2.5-flash'
  const prompt = (config.prompt as string) ?? DEFAULT_PROMPT

  return (
    <>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Icons.Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Connect a <strong>Video Upload</strong> node to this node's input.
          Gemini will watch the video and describe its content, visuals, and on-screen text.
        </span>
      </div>

      <FieldGroup label="Model">
        <Select value={model} onValueChange={(v) => onChange('model', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GEMINI_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Flash is faster and cheaper. Pro gives richer analysis on complex videos.
        </p>
      </FieldGroup>

      <FieldGroup label="Analysis Prompt">
        <Textarea
          className="text-xs"
          rows={6}
          value={prompt}
          onChange={(e) => onChange('prompt', e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Customise what Gemini focuses on — e.g. extract product names, summarise key messages, identify speakers.
        </p>
      </FieldGroup>
    </>
  )
}
