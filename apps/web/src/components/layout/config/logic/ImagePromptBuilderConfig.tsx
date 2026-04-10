import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldGroup } from '../shared'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai',    label: 'OpenAI' },
  { value: 'ollama',    label: 'Ollama (local)' },
]

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 (fast)' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
    { value: 'gpt-4o',      label: 'GPT-4o' },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'mistral',  label: 'Mistral' },
    { value: 'phi3',     label: 'Phi-3' },
  ],
}

const ASPECT_RATIOS = [
  { value: 'auto', label: 'Let LLM decide' },
  { value: '1:1',  label: '1:1 — Square' },
  { value: '16:9', label: '16:9 — Landscape' },
  { value: '9:16', label: '9:16 — Portrait' },
  { value: '4:3',  label: '4:3 — Classic' },
]

export function ImagePromptBuilderConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const provider = (config.provider as string) ?? 'anthropic'
  const model    = (config.model as string) ?? 'claude-haiku-4-5-20251001'
  const models   = MODELS[provider] ?? MODELS.anthropic

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup label="LLM Provider">
        <Select
          value={provider}
          onValueChange={(v) => {
            onChange('provider', v)
            onChange('model', MODELS[v]?.[0]?.value ?? '')
          }}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Model">
        <Select value={model} onValueChange={(v) => onChange('model', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Aspect Ratio Override">
        <Select
          value={(config.aspect_ratio_override as string) || 'auto'}
          onValueChange={(v) => onChange('aspect_ratio_override', v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((r) => (
              <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Style Hint (optional)">
        <Textarea
          className="min-h-[60px] text-xs resize-none"
          placeholder="e.g. cinematic, oil painting, dark and moody…"
          value={(config.style_hint as string) ?? ''}
          onChange={(e) => onChange('style_hint', e.target.value)}
        />
      </FieldGroup>
    </div>
  )
}
