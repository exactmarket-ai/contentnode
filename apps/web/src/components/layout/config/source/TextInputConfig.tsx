import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldGroup, CONTENT_ROLES } from '../shared'
import { PromptPickerModal, type PromptTemplate } from '@/components/modals/PromptPickerModal'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore } from '@/store/workflowStore'

export function TextInputConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const clientId = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const clientName = useWorkflowStore((s) => s.workflow.clientName ?? undefined)
  const [showPromptPicker, setShowPromptPicker] = useState(false)
  const [loadedTemplate, setLoadedTemplate] = useState<PromptTemplate | null>(null)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedConfirm, setSavedConfirm] = useState(false)
  const [existingNames, setExistingNames] = useState<string[]>([])

  const currentText = (config.text as string) ?? ''
  const isModified = loadedTemplate !== null && currentText !== loadedTemplate.body
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
    onChange('text', t.body)
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
          body: currentText,
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

  return (
    <>
      <FieldGroup label="Content Role">
        <Select value={(config.content_role as string) ?? 'source-material'} onValueChange={(v) => onChange('content_role', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Text Content</span>
          <button
            onClick={() => setShowPromptPicker(true)}
            className="flex items-center gap-1 text-[10px] font-medium hover:opacity-80 transition-opacity"
            style={{ color: '#a200ee' }}
          >
            <Icons.ScrollText className="h-3 w-3" />
            Load from Library
          </button>
        </div>

        {loadedTemplate && (
          <div className="rounded-md px-2.5 py-1.5 text-[10px] flex items-start justify-between gap-2" style={{ backgroundColor: '#fdf5ff', border: '1px solid #e9b8ff' }}>
            <div className="min-w-0">
              <span className="font-semibold" style={{ color: '#7a00b4' }}>
                {isModified ? 'Modified: ' : 'Loaded: '}
              </span>
              <span className="truncate" style={{ color: '#3a003a' }}>{loadedTemplate.name}</span>
            </div>
            <button onClick={() => { setLoadedTemplate(null); setShowSaveInput(false); onChange('prompt_template_name', null) }} className="shrink-0 text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3 w-3" />
            </button>
          </div>
        )}

        <Textarea
          placeholder="Enter text or use {{variable}} templates..."
          className="min-h-[100px] resize-none text-xs"
          value={currentText}
          onChange={(e) => onChange('text', e.target.value)}
        />

        {currentText && !showSaveInput && (
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

      {showPromptPicker && (
        <PromptPickerModal
          onSelect={handleLoadTemplate}
          onClose={() => setShowPromptPicker(false)}
          clientId={clientId}
          clientName={clientName}
        />
      )}
    </>
  )
}
