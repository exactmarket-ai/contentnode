import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ─── Model constants ──────────────────────────────────────────────────────────

export const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export const OPENAI_MODELS = [
  { value: 'gpt-4o',       label: 'GPT-4o' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo',  label: 'GPT-4 Turbo' },
  { value: 'o1-mini',      label: 'o1 Mini' },
]

export const OLLAMA_MODELS = [
  { value: 'gemma4:e4b',   label: 'Gemma 4 E4B' },
  { value: 'llama3.1:70b', label: 'Llama 3.1 70B' },
  { value: 'gemma3:12b',   label: 'Gemma 3 12B' },
  { value: 'gemma3:4b',    label: 'Gemma 3 4B' },
  { value: 'llama3.1:8b',  label: 'Llama 3.1 8B' },
  { value: 'llama3.2',     label: 'Llama 3.2 3B' },
  { value: 'mistral',      label: 'Mistral 7B' },
  { value: 'phi3',         label: 'Phi-3' },
]

export function modelLabel(provider: string, model: string): string {
  const all = [...ANTHROPIC_MODELS, ...OPENAI_MODELS, ...OLLAMA_MODELS]
  return all.find((m) => m.value === model)?.label ?? model
}

export function defaultModelForProvider(provider: string): string {
  if (provider === 'openai') return 'gpt-4o'
  if (provider === 'ollama') return 'gemma3:12b'
  return 'claude-sonnet-4-5'
}

export function modelsForProvider(provider: string) {
  if (provider === 'openai') return OPENAI_MODELS
  if (provider === 'ollama') return OLLAMA_MODELS
  return ANTHROPIC_MODELS
}

// ─── Content roles ────────────────────────────────────────────────────────────

export const CONTENT_ROLES = [
  { value: 'source-material', label: 'Source Material' },
  { value: 'instructions',    label: 'Instructions' },
  { value: 'context',         label: 'Context' },
  { value: 'examples',        label: 'Examples' },
]

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface UploadedFile {
  id: string
  name: string
  size: number
  storageKey: string
  uploaded: boolean
}

export interface UploadedAudioFile {
  id: string
  name: string
  size: number
  storageKey: string
  uploaded: boolean
}

// ─── Humanizer constants ──────────────────────────────────────────────────────

export const HUMANIZER_MONTHLY_LIMIT = 500_000

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── FieldGroup ───────────────────────────────────────────────────────────────

export function FieldGroup({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
    </div>
  )
}

// ─── ModelOverride ────────────────────────────────────────────────────────────

export interface ModelOverrideProps {
  enabled: boolean
  onToggle: () => void
  provider: string
  model: string
  temperature: number
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
  showTemperature?: boolean
}

export function ModelOverride({
  enabled,
  onToggle,
  provider,
  model,
  temperature,
  onChange,
  workflowModel,
  showTemperature = false,
}: ModelOverrideProps) {
  const inheritedLabel = `${modelLabel(workflowModel.provider, workflowModel.model)} (default)`

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Model Override</Label>
      <p className="text-xs text-muted-foreground/60">Inherited: {inheritedLabel}</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="accent-blue-500"
        />
        <span className="text-xs">Override model for this node</span>
      </label>

      {enabled && (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <FieldGroup label="Provider">
            <Select
              value={provider}
              onValueChange={(v) =>
                onChange('model_config', {
                  provider: v,
                  model: defaultModelForProvider(v),
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                <SelectItem value="openai" className="text-xs">OpenAI</SelectItem>
                <SelectItem value="ollama" className="text-xs">Ollama (local)</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <FieldGroup label="Model">
            {provider === 'ollama' ? (
              <>
                <input
                  type="text"
                  list="ollama-models-override"
                  value={model}
                  onChange={(e) => onChange('model_config', { provider, model: e.target.value })}
                  placeholder="e.g. llama3.1:70b"
                  className="h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-xs outline-none focus:border-blue-400 transition-colors placeholder:text-muted-foreground"
                />
                <datalist id="ollama-models-override">
                  {OLLAMA_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </datalist>
              </>
            ) : (
              <Select
                value={model}
                onValueChange={(v) => onChange('model_config', { provider, model: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelsForProvider(provider).map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FieldGroup>
          {showTemperature && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Temperature</Label>
                <span className="text-xs text-muted-foreground">{temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => onChange('temperature', parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

