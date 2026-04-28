import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldGroup } from '../shared'
import { ImagePromptPickerModal } from '@/components/modals/ImagePromptPickerModal'
import { useWorkflowStore } from '@/store/workflowStore'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai',    label: 'OpenAI' },
  { value: 'ollama',    label: 'Ollama (local)' },
]

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
    { value: 'claude-sonnet-4-5',         label: 'Claude Sonnet 4.5' },
    { value: 'claude-opus-4-6',           label: 'Claude Opus 4.6' },
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

const CAMERA_MOTIONS = [
  { value: 'auto',      label: 'Let LLM decide' },
  { value: 'static',    label: 'Static' },
  { value: 'pan-left',  label: 'Pan left' },
  { value: 'pan-right', label: 'Pan right' },
  { value: 'zoom-in',   label: 'Zoom in' },
  { value: 'zoom-out',  label: 'Zoom out' },
  { value: 'dolly',     label: 'Dolly' },
  { value: 'orbit',     label: 'Orbit' },
]

export function VideoPromptBuilderConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const provider = (config.provider as string) ?? 'anthropic'
  const model    = (config.model as string) ?? 'claude-haiku-4-5-20251001'
  const models   = MODELS[provider] ?? MODELS.anthropic
  const [showPicker, setShowPicker] = useState(false)
  const clientId   = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const clientName = useWorkflowStore((s) => s.workflow.clientName ?? undefined)

  return (
    <div className="flex flex-col gap-4">
      {showPicker && (
        <ImagePromptPickerModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setShowPicker(false)}
          onSelect={(p) => { onChange('style_hint', p.promptText); setShowPicker(false) }}
        />
      )}
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

      <FieldGroup label="Duration Hint (seconds)">
        <Input
          type="number"
          min={3}
          max={10}
          className="h-8 text-xs"
          placeholder="Let LLM decide"
          value={(config.duration_hint as number) ?? ''}
          onChange={(e) => onChange('duration_hint', e.target.value ? Number(e.target.value) : undefined)}
        />
      </FieldGroup>

      <FieldGroup label="Camera Motion Hint">
        <Select
          value={(config.camera_motion_hint as string) || 'auto'}
          onValueChange={(v) => onChange('camera_motion_hint', v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CAMERA_MOTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Style Hint (optional)">
        <div className="flex items-center justify-between mb-1">
          <span />
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1 text-[10px] font-medium hover:opacity-80"
            style={{ color: '#a200ee' }}
          >
            <Icons.Library className="h-3 w-3" />
            Load from Library
          </button>
        </div>
        <Textarea
          className="min-h-[60px] text-xs resize-none"
          placeholder="e.g. cinematic slow motion, documentary style, dreamlike…"
          value={(config.style_hint as string) ?? ''}
          onChange={(e) => onChange('style_hint', e.target.value)}
        />
      </FieldGroup>

      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] text-blue-700">
        When connected to an <strong>Image Generation</strong> node, mode is automatically set to image-to-video and the reference image is populated from that node's output.
      </div>
    </div>
  )
}
