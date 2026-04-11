import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { FieldGroup, modelLabel, defaultModelForProvider, modelsForProvider } from '../shared'
import { PromptPickerModal, type PromptTemplate } from '@/components/modals/PromptPickerModal'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore } from '@/store/workflowStore'

const LOGIC_TASK_TYPES = [
  { value: 'expand',              label: 'Expand' },
  { value: 'summarize',           label: 'Summarize' },
  { value: 'rewrite',             label: 'Rewrite' },
  { value: 'compress',            label: 'Compress' },
  { value: 'generate-variations', label: 'Generate Variations' },
  { value: 'generate-headlines',  label: 'Generate Headlines' },
  { value: 'extract-claims',      label: 'Extract Claims' },
]

export function AiGenerateConfig({
  config,
  onChange,
  workflowModel,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const clientId = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const clientName = useWorkflowStore((s) => s.workflow.clientName ?? undefined)
  const [copied, setCopied] = useState(false)
  const [showPromptPicker, setShowPromptPicker] = useState(false)
  const [loadedTemplate, setLoadedTemplate] = useState<PromptTemplate | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [savedConfirm, setSavedConfirm] = useState(false)
  const [existingNames, setExistingNames] = useState<string[]>([])

  const currentInstructions = (config.additional_instructions as string) ?? ''
  const isModified = loadedTemplate !== null && currentInstructions !== loadedTemplate.body
  const nameConflict = existingNames.some((n) => n.toLowerCase() === saveTemplateName.trim().toLowerCase())

  const openSaveInput = async () => {
    setSaveTemplateName('')
    setShowSaveInput(true)
    try {
      const res = await apiFetch('/api/v1/prompts')
      const { data } = await res.json()
      setExistingNames((data as PromptTemplate[]).map((t) => t.name))
    } catch { /* ignore */ }
  }

  const handleLoadTemplate = (t: PromptTemplate) => {
    setLoadedTemplate(t)
    onChange('additional_instructions', t.body)
    onChange('prompt_template_name', t.name)
    setShowPromptPicker(false)
    setShowSaveInput(false)
  }

  const handleSaveAsNew = async () => {
    if (!saveTemplateName.trim()) return
    setSavingTemplate(true)
    try {
      const res = await apiFetch('/api/v1/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveTemplateName.trim(),
          body: currentInstructions,
          category: 'general',
          parentId: loadedTemplate?.id,
          ...(clientId ? { clientId } : {}),
        }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setLoadedTemplate(data)
        onChange('prompt_template_name', data.name)
        setSaveTemplateName('')
        setShowSaveInput(false)
        setSavedConfirm(true)
        setTimeout(() => setSavedConfirm(false), 3000)
      }
    } finally {
      setSavingTemplate(false)
    }
  }

  const modelCfg = (config.model_config as Record<string, unknown> | null) ?? null
  const overrideEnabled = modelCfg !== null

  const overrideProvider = (modelCfg?.provider as string) ?? 'anthropic'
  const overrideModel = (modelCfg?.model as string) ?? 'claude-sonnet-4-5'
  const temperature = (config.temperature as number) ?? workflowModel.temperature ?? 0.7

  const inheritedLabel = `${modelLabel(workflowModel.provider, workflowModel.model)} (default)`

  return (
    <>
      {/* Task type */}
      <FieldGroup label="Task">
        <Select
          value={(config.task_type as string) ?? 'rewrite'}
          onValueChange={(v) => onChange('task_type', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOGIC_TASK_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Model override */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Model Override</Label>
        <p className="text-xs text-muted-foreground/60">Inherited: {inheritedLabel}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overrideEnabled}
            onChange={(e) =>
              onChange(
                'model_config',
                e.target.checked
                  ? { provider: 'anthropic', model: 'claude-sonnet-4-5' }
                  : null,
              )
            }
            className="accent-blue-500"
          />
          <span className="text-xs">Override model for this node</span>
        </label>

        {overrideEnabled && (
          <div className="space-y-2 rounded-md border border-border p-2.5">
            <FieldGroup label="Provider">
              <Select
                value={overrideProvider}
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
                value={overrideModel}
                onValueChange={(v) => onChange('model_config', { ...modelCfg, model: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelsForProvider(overrideProvider).map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>
          </div>
        )}
      </div>

      {/* Temperature */}
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

      {/* Additional instructions */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Additional Instructions</Label>
          <button
            onClick={() => setShowPromptPicker(true)}
            className="flex items-center gap-1 text-[10px] font-medium hover:opacity-80 transition-opacity"
            style={{ color: '#a200ee' }}
          >
            <Icons.ScrollText className="h-3 w-3" />
            Load from Library
          </button>
        </div>

        {/* Loaded template indicator */}
        {loadedTemplate && (
          <div className="rounded-md px-2.5 py-1.5 text-[10px] flex items-start justify-between gap-2" style={{ backgroundColor: '#fdf5ff', border: '1px solid #e9b8ff' }}>
            <div className="min-w-0">
              <span className="font-semibold" style={{ color: '#7a00b4' }}>
                {isModified ? 'Modified: ' : 'Loaded: '}
              </span>
              <span className="truncate" style={{ color: '#3a003a' }}>{loadedTemplate.name}</span>
              {loadedTemplate.parentId && (
                <span className="ml-1 text-muted-foreground">(fork)</span>
              )}
            </div>
            <button onClick={() => { setLoadedTemplate(null); setShowSaveInput(false); onChange('prompt_template_name', null) }} className="shrink-0 text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3 w-3" />
            </button>
          </div>
        )}

        <Textarea
          placeholder="Any extra guidance for the model…"
          className="min-h-[72px] resize-none text-xs"
          value={currentInstructions}
          onChange={(e) => onChange('additional_instructions', e.target.value)}
        />

        {currentInstructions && !showSaveInput && (
          <button
            onClick={openSaveInput}
            className="flex items-center gap-1 text-[10px] font-medium hover:opacity-80"
            style={{ color: '#a200ee' }}
          >
            <Icons.BookmarkPlus className="h-3 w-3" />
            {isModified ? 'Save as new template' : 'Save to Library'}
          </button>
        )}
        {savedConfirm && (
          <p className="flex items-center gap-1 text-[10px]" style={{ color: '#16a34a' }}>
            <Icons.Check className="h-3 w-3" />Saved to Prompt Library
          </p>
        )}
        {showSaveInput && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !nameConflict) handleSaveAsNew(); if (e.key === 'Escape') setShowSaveInput(false) }}
                placeholder="Template name…"
                className="flex-1 rounded border bg-background px-2 py-1 text-xs outline-none"
                style={{ borderColor: nameConflict ? '#ef4444' : undefined }}
              />
              <button
                onClick={handleSaveAsNew}
                disabled={savingTemplate || !saveTemplateName.trim() || nameConflict}
                className="rounded px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: '#a200ee' }}
              >
                {savingTemplate ? '…' : 'Save'}
              </button>
              <button onClick={() => setShowSaveInput(false)} className="text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
          {nameConflict && (
            <p className="flex items-center gap-1 text-[10px] text-red-500">
              <Icons.AlertCircle className="h-3 w-3" />
              A template with this name already exists
            </p>
          )}
        </div>
        )}
      </div>

      {/* Prompt picker modal */}
      {showPromptPicker && (
        <PromptPickerModal
          onSelect={handleLoadTemplate}
          onClose={() => setShowPromptPicker(false)}
          clientId={clientId}
          clientName={clientName}
        />
      )}

      {/* Output preview — shown after a successful run */}
      {nodeRunStatus?.status === 'passed' && nodeRunStatus.output != null && (() => {
        const outputText = typeof nodeRunStatus.output === 'string'
          ? nodeRunStatus.output
          : JSON.stringify(nodeRunStatus.output, null, 2)
        const download = (ext: 'txt' | 'md') => {
          const blob = new Blob([outputText], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `output.${ext}`
          a.click()
          URL.revokeObjectURL(url)
        }
        return (
          <>
            <Separator />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Generated Output</Label>
                <div className="flex items-center gap-1">
                  <button
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      navigator.clipboard.writeText(outputText)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied
                      ? <><Icons.Check className="h-3 w-3" />Copied</>
                      : <><Icons.Copy className="h-3 w-3" />Copy</>
                    }
                  </button>
                  <button
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => download('txt')}
                  >
                    <Icons.Download className="h-3 w-3" />.txt
                  </button>
                  <button
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => download('md')}
                  >
                    <Icons.Download className="h-3 w-3" />.md
                  </button>
                </div>
              </div>
              <Textarea
                readOnly
                value={outputText}
                className="min-h-[140px] resize-y text-xs font-mono bg-muted/30 text-muted-foreground"
              />
            </div>
          </>
        )
      })()}
    </>
  )
}
