import { useCallback, useRef, useState } from 'react'
import { useWorkflowStore } from '@/store/workflowStore'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { FieldGroup, formatBytes, UploadedFile } from '../shared'
import { LibraryPickerModal } from '@/components/modals/LibraryPickerModal'
import { PromptPickerModal, type PromptTemplate } from '@/components/modals/PromptPickerModal'

interface LibraryRef {
  id: string
  name: string
}

const SOURCE_DOCUMENT_TYPES = [
  { value: 'approved-examples',      label: 'Approved Examples' },
  { value: 'brand-guidelines',       label: 'Brand Guidelines' },
  { value: 'content-standards',      label: 'Content Standards' },
  { value: 'context',                label: 'Context' },
  { value: 'custom',                 label: 'Custom' },
  { value: 'instructions',           label: 'Instructions' },
  { value: 'legal-documents',        label: 'Legal Documents' },
  { value: 'messaging-framework',    label: 'Messaging Framework' },
  { value: 'negative-examples',      label: 'Negative Examples' },
  { value: 'product-documentation',  label: 'Product Documentation' },
  { value: 'seo-brief',              label: 'SEO Brief' },
  { value: 'source-material',        label: 'Source Material' },
]

const ACCEPTED_EXTENSIONS = '.pdf,.docx,.txt,.md,.csv,.json,.html'
const FILE_SIZE_LIMIT_MB = 100

export function DocumentSourceConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const clientId = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const clientName = useWorkflowStore((s) => s.workflow.clientName ?? undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showPromptPicker, setShowPromptPicker] = useState(false)
  const [loadedTemplate, setLoadedTemplate] = useState<PromptTemplate | null>(null)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedConfirm, setSavedConfirm] = useState(false)
  const [existingNames, setExistingNames] = useState<string[]>([])
  const uploadedFiles = (config.uploaded_files as UploadedFile[]) ?? []
  const libraryRefs = (config.library_refs as LibraryRef[]) ?? []

  const currentText = (config.pasted_text as string) ?? ''
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
    onChange('pasted_text', t.body)
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

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setUploading(true)

      const results: UploadedFile[] = []

      for (const file of files) {
        if (file.size > FILE_SIZE_LIMIT_MB * 1024 * 1024) continue

        const fd = new FormData()
        fd.append('file', file)

        try {
          const res = await apiFetch('/api/v1/documents', { method: 'POST', body: fd })
          if (res.ok) {
            const json = await res.json()
            results.push({ id: json.data.id, name: file.name, size: file.size, storageKey: json.data.storageKey, uploaded: true })
          } else {
            results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, storageKey: '', uploaded: false })
          }
        } catch {
          results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, storageKey: '', uploaded: false })
        }
      }

      onChange('uploaded_files', [...uploadedFiles, ...results])
      setUploading(false)
    },
    [uploadedFiles, onChange],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) uploadFiles(Array.from(e.dataTransfer.files))
  }

  const removeFile = (id: string) => {
    onChange(
      'uploaded_files',
      uploadedFiles.filter((f) => f.id !== id),
    )
  }

  return (
    <>
      <FieldGroup label="Document Type">
        <Select
          value={(config.document_type as string) ?? 'source-material'}
          onValueChange={(v) => onChange('document_type', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Drop zone */}
      <FieldGroup label="Upload Files">
        <div
          className={cn(
            'flex w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-blue-400 bg-blue-50 text-blue-600'
              : 'border-border hover:border-border/60 hover:bg-accent/40',
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {uploading ? (
            <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Icons.Upload className="h-6 w-6 text-muted-foreground" />
          )}
          <div className="w-full min-w-0">
            <p className="text-xs font-medium">
              {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
            </p>
            <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
              PDF, DOCX, TXT, MD, CSV, JSON, HTML — up to {FILE_SIZE_LIMIT_MB} MB each
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      </FieldGroup>

      {/* Uploaded file list */}
      {uploadedFiles.length > 0 && (
        <div className="w-full space-y-1">
          {uploadedFiles.map((f) => (
            <div
              key={f.id}
              className="flex w-full items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <Icons.FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 break-all text-xs">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              {!f.uploaded && (
                <span title="File not yet synced to server (no auth)">
                  <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                </span>
              )}
              <button
                onClick={() => removeFile(f.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove file"
              >
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Library files */}
      <FieldGroup label="Global Library">
        <button
          type="button"
          onClick={() => setShowLibrary(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-purple-400 hover:text-purple-600"
          style={{ borderColor: '#e8e7e1' }}
        >
          <Icons.Library className="h-3.5 w-3.5 shrink-0" />
          <span>{libraryRefs.length > 0 ? `${libraryRefs.length} library file${libraryRefs.length !== 1 ? 's' : ''} attached — click to change` : 'Add files from Library…'}</span>
        </button>
        {libraryRefs.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {libraryRefs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                style={{ borderColor: '#e8e7e1', backgroundColor: '#fdf5ff' }}
              >
                <Icons.Library className="h-3.5 w-3.5 shrink-0" style={{ color: '#a200ee' }} />
                <span className="flex-1 truncate" style={{ color: '#7a00b4' }}>{ref.name}</span>
                <button
                  onClick={() => onChange('library_refs', libraryRefs.filter((r) => r.id !== ref.id))}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Icons.X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </FieldGroup>

      {showLibrary && (
        <LibraryPickerModal
          selectedIds={libraryRefs.map((r) => r.id)}
          clientId={clientId}
          clientName={clientName}
          onConfirm={(selected) => {
            onChange('library_refs', selected)
            setShowLibrary(false)
          }}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Text paste area */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Paste Content Directly</span>
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
            </div>
            <button onClick={() => { setLoadedTemplate(null); setShowSaveInput(false); onChange('prompt_template_name', null) }} className="shrink-0 text-muted-foreground hover:text-foreground">
              <Icons.X className="h-3 w-3" />
            </button>
          </div>
        )}

        <Textarea
          placeholder="Paste text content here…"
          className="min-h-[100px] resize-none text-xs"
          value={currentText}
          onChange={(e) => onChange('pasted_text', e.target.value)}
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

      {/* Prompt picker modal */}
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
