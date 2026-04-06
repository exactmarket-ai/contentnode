import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const OPENAI_MODELS = [
  { value: 'gpt-4o',       label: 'GPT-4o' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo',  label: 'GPT-4 Turbo' },
  { value: 'o1-mini',      label: 'o1 Mini' },
]

const OLLAMA_MODELS = [
  { value: 'llama3.2', label: 'Llama 3.2' },
  { value: 'mistral',  label: 'Mistral 7B' },
  { value: 'phi3',     label: 'Phi-3' },
  { value: 'gemma2',   label: 'Gemma 2' },
]

function modelLabel(provider: string, model: string): string {
  const all = [...ANTHROPIC_MODELS, ...OPENAI_MODELS, ...OLLAMA_MODELS]
  return all.find((m) => m.value === model)?.label ?? model
}

function defaultModelForProvider(provider: string): string {
  if (provider === 'openai') return 'gpt-4o'
  if (provider === 'ollama') return 'llama3.2'
  return 'claude-sonnet-4-5'
}

function modelsForProvider(provider: string) {
  if (provider === 'openai') return OPENAI_MODELS
  if (provider === 'ollama') return OLLAMA_MODELS
  return ANTHROPIC_MODELS
}

const SOURCE_DOCUMENT_TYPES = [
  { value: 'brand-guidelines',       label: 'Brand Guidelines' },
  { value: 'content-standards',      label: 'Content Standards' },
  { value: 'source-material',        label: 'Source Material' },
  { value: 'product-documentation',  label: 'Product Documentation' },
  { value: 'messaging-framework',    label: 'Messaging Framework' },
  { value: 'approved-examples',      label: 'Approved Examples' },
  { value: 'negative-examples',      label: 'Negative Examples' },
  { value: 'legal-documents',        label: 'Legal Documents' },
  { value: 'seo-brief',              label: 'SEO Brief' },
  { value: 'custom',                 label: 'Custom' },
]

const LOGIC_TASK_TYPES = [
  { value: 'expand',              label: 'Expand' },
  { value: 'summarize',           label: 'Summarize' },
  { value: 'rewrite',             label: 'Rewrite' },
  { value: 'compress',            label: 'Compress' },
  { value: 'generate-variations', label: 'Generate Variations' },
  { value: 'generate-headlines',  label: 'Generate Headlines' },
  { value: 'extract-claims',      label: 'Extract Claims' },
]

const OUTPUT_TYPES = [
  { value: 'blog-post',      label: 'Blog Post' },
  { value: 'email',          label: 'Email' },
  { value: 'ad-copy',        label: 'Ad Copy' },
  { value: 'linkedin-post',  label: 'LinkedIn Post' },
  { value: 'video-script',   label: 'Video Script' },
  { value: 'landing-page',   label: 'Landing Page' },
  { value: 'custom',         label: 'Custom' },
]

// ─── Field components ─────────────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── Source / file-upload ─────────────────────────────────────────────────────

interface UploadedFile {
  id: string
  name: string
  size: number
  uploaded: boolean  // false = upload failed or pending
}

const ACCEPTED_EXTENSIONS = '.pdf,.docx,.txt,.md,.csv,.json,.html'
const FILE_SIZE_LIMIT_MB = 100

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DocumentSourceConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadedFiles = (config.uploaded_files as UploadedFile[]) ?? []

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
          const res = await fetch(`${API_URL}/api/v1/documents`, { method: 'POST', body: fd })
          if (res.ok) {
            const json = await res.json()
            results.push({ id: json.data.id, name: file.name, size: file.size, uploaded: true })
          } else {
            // Auth not available in dev — keep file with local ID
            results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, uploaded: false })
          }
        } catch {
          results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, uploaded: false })
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
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-blue-500 bg-blue-950/30 text-blue-300'
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
          <div>
            <p className="text-xs font-medium">
              {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
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
        <div className="space-y-1">
          {uploadedFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <Icons.FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              {!f.uploaded && (
                <span title="File not yet synced to server (no auth)">
                  <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                </span>
              )}
              <button
                onClick={() => removeFile(f.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Text paste area */}
      <FieldGroup label="Paste Content Directly">
        <Textarea
          placeholder="Paste text content here…"
          className="min-h-[100px] resize-none text-xs"
          value={(config.pasted_text as string) ?? ''}
          onChange={(e) => onChange('pasted_text', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Source / text-input ──────────────────────────────────────────────────────

function TextInputConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Text Content">
      <Textarea
        placeholder="Enter text or use {{variable}} templates..."
        className="min-h-[100px] resize-none text-xs"
        value={(config.text as string) ?? ''}
        onChange={(e) => onChange('text', e.target.value)}
      />
    </FieldGroup>
  )
}

// ─── Source / api-fetch ───────────────────────────────────────────────────────

function ApiFetchConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="URL">
        <Input
          placeholder="https://api.example.com/data"
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Method">
        <Select value={(config.method as string) ?? 'GET'} onValueChange={(v) => onChange('method', v)}>
          <SelectTrigger className="text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
    </>
  )
}

// ─── Source / web-scrape ──────────────────────────────────────────────────────

function WebScrapeConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="URL">
        <Input
          placeholder="https://example.com/page"
          className="text-xs"
          value={(config.url as string) ?? ''}
          onChange={(e) => onChange('url', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="CSS Selector (optional)">
        <Input
          placeholder=".article-content, #main"
          className="text-xs"
          value={(config.selector as string) ?? ''}
          onChange={(e) => onChange('selector', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Logic / ai-generate ──────────────────────────────────────────────────────

function AiGenerateConfig({
  config,
  onChange,
  workflowModel,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
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
      <FieldGroup label="Additional Instructions">
        <Textarea
          placeholder="Any extra guidance for the model…"
          className="min-h-[72px] resize-none text-xs"
          value={(config.additional_instructions as string) ?? ''}
          onChange={(e) => onChange('additional_instructions', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Logic / transform ────────────────────────────────────────────────────────

function TransformConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Expression (JS)">
      <Textarea
        placeholder="return input.trim()"
        className="min-h-[100px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Use <code className="text-blue-400">input</code> to reference the incoming value.
      </p>
    </FieldGroup>
  )
}

// ─── Logic / condition ────────────────────────────────────────────────────────

function ConditionConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Condition (JS, returns boolean)">
      <Textarea
        placeholder="return input.length > 100"
        className="min-h-[80px] resize-none font-mono text-xs"
        value={(config.expression as string) ?? ''}
        onChange={(e) => onChange('expression', e.target.value)}
      />
    </FieldGroup>
  )
}

// ─── Logic / human-review ─────────────────────────────────────────────────────

function HumanReviewConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="Review Instructions">
        <Textarea
          placeholder="Describe what the reviewer should check..."
          className="min-h-[80px] resize-none text-xs"
          value={(config.instructions as string) ?? ''}
          onChange={(e) => onChange('instructions', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Assignee Email (optional)">
        <Input
          placeholder="reviewer@example.com"
          className="text-xs"
          value={(config.assignee_email as string) ?? ''}
          onChange={(e) => onChange('assignee_email', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Output / webhook ─────────────────────────────────────────────────────────

function WebhookConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <FieldGroup label="Webhook URL">
      <Input
        placeholder="https://hooks.example.com/..."
        className="text-xs"
        value={(config.url as string) ?? ''}
        onChange={(e) => onChange('url', e.target.value)}
      />
    </FieldGroup>
  )
}

// ─── Output / email ───────────────────────────────────────────────────────────

function EmailConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="To">
        <Input
          placeholder="recipient@example.com"
          className="text-xs"
          value={(config.to as string) ?? ''}
          onChange={(e) => onChange('to', e.target.value)}
        />
      </FieldGroup>
      <FieldGroup label="Subject">
        <Input
          placeholder="Workflow result: {{workflow.name}}"
          className="text-xs"
          value={(config.subject as string) ?? ''}
          onChange={(e) => onChange('subject', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Output / file-export ─────────────────────────────────────────────────────

function FileExportConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="Format">
        <Select value={(config.format as string) ?? 'txt'} onValueChange={(v) => onChange('format', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['txt', 'md', 'json', 'csv', 'html'].map((f) => (
              <SelectItem key={f} value={f} className="text-xs">
                .{f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
      <FieldGroup label="Filename">
        <Input
          placeholder="output"
          className="text-xs"
          value={(config.filename as string) ?? ''}
          onChange={(e) => onChange('filename', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}

// ─── Output / content-output ──────────────────────────────────────────────────

function OutputFormatOptions({
  outputType,
  options,
  onOptionsChange,
}: {
  outputType: string
  options: Record<string, unknown>
  onOptionsChange: (opts: Record<string, unknown>) => void
}) {
  const set = (k: string, v: unknown) => onOptionsChange({ ...options, [k]: v })

  switch (outputType) {
    case 'blog-post':
      return (
        <>
          <FieldGroup label="Tone">
            <Select value={(options.tone as string) ?? 'professional'} onValueChange={(v) => set('tone', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="professional" className="text-xs">Professional</SelectItem>
                <SelectItem value="conversational" className="text-xs">Conversational</SelectItem>
                <SelectItem value="educational" className="text-xs">Educational</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Include Table of Contents</Label>
            <button
              onClick={() => set('include_toc', !(options.include_toc ?? false))}
              className={cn(
                'h-5 w-9 rounded-full border transition-colors',
                options.include_toc ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  options.include_toc ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </>
      )

    case 'email':
      return (
        <FieldGroup label="Tone">
          <Select value={(options.tone as string) ?? 'friendly'} onValueChange={(v) => set('tone', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="formal" className="text-xs">Formal</SelectItem>
              <SelectItem value="friendly" className="text-xs">Friendly</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      )

    case 'ad-copy':
      return (
        <>
          <FieldGroup label="Platform">
            <Select value={(options.platform as string) ?? 'google'} onValueChange={(v) => set('platform', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google" className="text-xs">Google Ads</SelectItem>
                <SelectItem value="facebook" className="text-xs">Facebook / Instagram</SelectItem>
                <SelectItem value="twitter" className="text-xs">Twitter / X</SelectItem>
                <SelectItem value="linkedin" className="text-xs">LinkedIn</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Include Call to Action</Label>
            <button
              onClick={() => set('include_cta', !(options.include_cta ?? true))}
              className={cn(
                'h-5 w-9 rounded-full border transition-colors',
                options.include_cta !== false ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  options.include_cta !== false ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </>
      )

    case 'linkedin-post':
      return (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Include Hashtags</Label>
            <button
              onClick={() => set('include_hashtags', !(options.include_hashtags ?? true))}
              className={cn(
                'h-5 w-9 rounded-full border transition-colors',
                options.include_hashtags !== false ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  options.include_hashtags !== false ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
          <FieldGroup label="Emoji Style">
            <Select value={(options.emoji_style as string) ?? 'moderate'} onValueChange={(v) => set('emoji_style', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                <SelectItem value="moderate" className="text-xs">Moderate</SelectItem>
                <SelectItem value="liberal" className="text-xs">Liberal</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
        </>
      )

    case 'video-script':
      return (
        <>
          <FieldGroup label="Style">
            <Select value={(options.style as string) ?? 'conversational'} onValueChange={(v) => set('style', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="formal" className="text-xs">Formal</SelectItem>
                <SelectItem value="conversational" className="text-xs">Conversational</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Include B-Roll Notes</Label>
            <button
              onClick={() => set('include_broll', !(options.include_broll ?? false))}
              className={cn(
                'h-5 w-9 rounded-full border transition-colors',
                options.include_broll ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  options.include_broll ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </>
      )

    case 'landing-page':
      return (
        <>
          <FieldGroup label="Number of Sections">
            <Input
              type="number"
              min={3}
              max={12}
              className="text-xs h-8"
              value={(options.section_count as number) ?? 6}
              onChange={(e) => set('section_count', parseInt(e.target.value) || 6)}
            />
          </FieldGroup>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Include FAQ Section</Label>
            <button
              onClick={() => set('include_faq', !(options.include_faq ?? true))}
              className={cn(
                'h-5 w-9 rounded-full border transition-colors',
                options.include_faq !== false ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  options.include_faq !== false ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </>
      )

    case 'custom':
      return (
        <FieldGroup label="Format Instructions">
          <Textarea
            placeholder="Describe the desired output format…"
            className="min-h-[80px] resize-none text-xs"
            value={(options.instructions as string) ?? ''}
            onChange={(e) => set('instructions', e.target.value)}
          />
        </FieldGroup>
      )

    default:
      return null
  }
}

function ContentOutputConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const outputType = (config.output_type as string) ?? 'blog-post'
  const formatOptions = (config.format_options as Record<string, unknown>) ?? {}

  return (
    <>
      <FieldGroup label="Output Type">
        <Select value={outputType} onValueChange={(v) => onChange('output_type', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTPUT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Target word count range */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Target Length (words)</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={50}
            placeholder="Min"
            className="h-8 text-xs"
            value={(config.min_words as number) ?? ''}
            onChange={(e) => onChange('min_words', parseInt(e.target.value) || 0)}
          />
          <span className="shrink-0 text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            min={50}
            placeholder="Max"
            className="h-8 text-xs"
            value={(config.max_words as number) ?? ''}
            onChange={(e) => onChange('max_words', parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* Type-specific format options */}
      <OutputFormatOptions
        outputType={outputType}
        options={formatOptions}
        onOptionsChange={(opts) => onChange('format_options', opts)}
      />
    </>
  )
}

// ─── Config dispatcher ────────────────────────────────────────────────────────

function NodeConfigForm({
  nodeType,
  config,
  onChange,
  workflowModel,
}: {
  nodeType: string
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
  switch (nodeType) {
    case 'source': return <DocumentSourceConfig config={config} onChange={onChange} />
    case 'logic':  return <AiGenerateConfig config={config} onChange={onChange} workflowModel={workflowModel} />
    case 'output': return <ContentOutputConfig config={config} onChange={onChange} />
    default:       return <p className="text-xs text-muted-foreground">No configuration for this node type.</p>
  }
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeData, workflow } = useWorkflowStore()
  const node = nodes.find((n) => n.id === selectedNodeId)

  const [localLabel, setLocalLabel] = useState('')

  useEffect(() => {
    if (node) setLocalLabel(node.data.label as string)
  }, [node?.id])

  if (!node) {
    return (
      <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <Icons.MousePointerClick className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No node selected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click a node on the canvas to configure it
            </p>
          </div>
        </div>
      </div>
    )
  }

  const nodeType = node.type ?? ''
  const subtype = node.data.subtype as string
  const config = (node.data.config as Record<string, unknown>) ?? {}

  const onConfigChange = (key: string, value: unknown) => {
    updateNodeData(node.id, { config: { ...config, [key]: value } })
  }

  const CATEGORY_COLOR: Record<string, string> = {
    source: 'text-emerald-400',
    logic: 'text-blue-400',
    output: 'text-purple-400',
  }
  const colorClass = CATEGORY_COLOR[nodeType] ?? 'text-foreground'

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Icons.Settings2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Node Config</span>
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={() => useWorkflowStore.getState().setSelectedNodeId(null)}
        >
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-3 py-3">
          {/* Node identity */}
          <div className="space-y-3">
            <FieldGroup label="Node Label">
              <Input
                className="text-xs"
                value={localLabel}
                onChange={(e) => setLocalLabel(e.target.value)}
                onBlur={() => updateNodeData(node.id, { label: localLabel })}
              />
            </FieldGroup>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Type:</span>
              <span className={cn('text-xs font-medium capitalize', colorClass)}>
                {node.type} / {subtype}
              </span>
            </div>
          </div>

          <Separator />

          {/* Type-specific config */}
          <NodeConfigForm
            nodeType={nodeType}
            config={config}
            onChange={onConfigChange}
            workflowModel={workflow.default_model_config}
          />
        </div>
      </ScrollArea>

      {/* Footer: delete node */}
      <div className="border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            useWorkflowStore.getState().onNodesChange([{ type: 'remove', id: node.id }])
            useWorkflowStore.getState().setSelectedNodeId(null)
          }}
        >
          <Icons.Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete Node
        </Button>
      </div>
    </div>
  )
}
