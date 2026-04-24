import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useOllamaModels } from '@/hooks/useOllamaModels'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

// ─── Model constants ──────────────────────────────────────────────────────────

export const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-7',            label: 'Claude Opus 4.7' },
  { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
  { value: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
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

// ─── PMRoutingSection ─────────────────────────────────────────────────────────

interface MondayColumn { id: string; title: string; type: string; labels: string[] }

/**
 * Collapsible "PM Routing" section appended to any output node config.
 * Controls where Box files land and what gets written back to Monday.
 * Loads live column/status data from the client's Monday board when available.
 */
export function PMRoutingSection({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const workflow = useWorkflowStore((s) => s.workflow)
  const boardId = workflow.clientMondayBoardId

  const [open, setOpen] = useState(
    !!(config.delivery_box_subfolder || config.delivery_monday_column || config.delivery_monday_status)
  )
  const [columns, setColumns] = useState<MondayColumn[]>([])

  useEffect(() => {
    if (!boardId) return
    apiFetch(`/api/v1/integrations/monday/boards/${boardId}/columns-meta`)
      .then((r) => r.json())
      .then(({ data }) => { if (Array.isArray(data)) setColumns(data) })
      .catch(() => {})
  }, [boardId])

  const linkColumns = columns.filter((c) => c.type === 'link' || c.type === 'text')
  const statusColumns = columns.filter((c) => c.type === 'color')
  const selectedStatusColumn = columns.find((c) => c.title === config.delivery_monday_status_column)
  const statusLabels = selectedStatusColumn?.labels ?? []

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Icons.Share2 className="h-3.5 w-3.5" />
          PM Routing
        </span>
        <Icons.ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <FieldGroup
            label="Box Subfolder"
            description="Creates this subfolder inside the run's Box folder and delivers the file there."
          >
            <Input
              placeholder="e.g. Blog"
              className="text-xs"
              value={(config.delivery_box_subfolder as string) ?? ''}
              onChange={(e) => onChange('delivery_box_subfolder', e.target.value)}
            />
          </FieldGroup>

          <FieldGroup
            label="Monday URL Column"
            description="Column to receive the Box file URL after delivery."
          >
            {linkColumns.length > 0 ? (
              <Select
                value={(config.delivery_monday_column as string) || '__none__'}
                onValueChange={(v) => onChange('delivery_monday_column', v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select column…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">— None —</SelectItem>
                  {linkColumns.map((c) => (
                    <SelectItem key={c.id} value={c.title} className="text-xs">{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="e.g. Blog URL"
                className="text-xs"
                value={(config.delivery_monday_column as string) ?? ''}
                onChange={(e) => onChange('delivery_monday_column', e.target.value)}
              />
            )}
          </FieldGroup>

          <FieldGroup
            label="Monday Status Column"
            description="Which status column to update on delivery."
          >
            {statusColumns.length > 0 ? (
              <Select
                value={(config.delivery_monday_status_column as string) || '__none__'}
                onValueChange={(v) => {
                  onChange('delivery_monday_status_column', v === '__none__' ? '' : v)
                  onChange('delivery_monday_status', '')
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select column…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">— None —</SelectItem>
                  {statusColumns.map((c) => (
                    <SelectItem key={c.id} value={c.title} className="text-xs">{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="e.g. Stage"
                className="text-xs"
                value={(config.delivery_monday_status_column as string) ?? ''}
                onChange={(e) => onChange('delivery_monday_status_column', e.target.value)}
              />
            )}
          </FieldGroup>

          {!!(config.delivery_monday_status_column || config.delivery_monday_status) && (
            <FieldGroup
              label="Status Label on Delivery"
              description="Sets the status column to this label when the file lands in Box."
            >
              {statusLabels.length > 0 ? (
                <Select
                  value={(config.delivery_monday_status as string) || '__none__'}
                  onValueChange={(v) => onChange('delivery_monday_status', v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select label…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs text-muted-foreground">— None —</SelectItem>
                    {statusLabels.map((label) => (
                      <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. Ready for Review"
                  className="text-xs"
                  value={(config.delivery_monday_status as string) ?? ''}
                  onChange={(e) => onChange('delivery_monday_status', e.target.value)}
                />
              )}
            </FieldGroup>
          )}
        </div>
      )}
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
  const ollamaOptions = useOllamaModels()

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
            <Select
              value={model}
              onValueChange={(v) => onChange('model_config', { provider, model: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(provider === 'ollama' ? ollamaOptions : modelsForProvider(provider)).map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

