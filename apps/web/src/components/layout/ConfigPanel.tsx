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

// ─── Logic / humanizer ────────────────────────────────────────────────────────

const HUMANIZER_MODES = [
  { value: 'executive-natural',  label: 'Executive Natural' },
  { value: 'conversational',     label: 'Conversational' },
  { value: 'confident-expert',   label: 'Confident Expert' },
  { value: 'premium-brand',      label: 'Premium Brand' },
  { value: 'founder-voice',      label: 'Founder Voice' },
  { value: 'sales-polished',     label: 'Sales Polished' },
  { value: 'journalistic-clean', label: 'Journalistic Clean' },
  { value: 'social-native',      label: 'Social Native' },
  { value: 'custom',             label: 'Custom' },
]

const HUMANIZER_SLIDERS: { key: string; label: string }[] = [
  { key: 'naturalness', label: 'Naturalness' },
  { key: 'energy',      label: 'Energy' },
  { key: 'precision',   label: 'Precision' },
  { key: 'formality',   label: 'Formality' },
  { key: 'boldness',    label: 'Boldness' },
  { key: 'compression', label: 'Compression' },
  { key: 'personality', label: 'Personality' },
  { key: 'safety',      label: 'Safety' },
]

const HUMANIZER_MODE_PRESETS: Record<string, Record<string, number>> = {
  'executive-natural':  { naturalness: 70, energy: 55, precision: 75, formality: 65, boldness: 60, compression: 55, personality: 45, safety: 80 },
  'conversational':     { naturalness: 85, energy: 65, precision: 50, formality: 25, boldness: 50, compression: 45, personality: 70, safety: 70 },
  'confident-expert':   { naturalness: 65, energy: 60, precision: 80, formality: 55, boldness: 80, compression: 60, personality: 55, safety: 65 },
  'premium-brand':      { naturalness: 75, energy: 50, precision: 70, formality: 70, boldness: 55, compression: 60, personality: 50, safety: 85 },
  'founder-voice':      { naturalness: 80, energy: 80, precision: 55, formality: 35, boldness: 85, compression: 50, personality: 80, safety: 55 },
  'sales-polished':     { naturalness: 70, energy: 75, precision: 65, formality: 55, boldness: 75, compression: 65, personality: 60, safety: 75 },
  'journalistic-clean': { naturalness: 80, energy: 55, precision: 85, formality: 60, boldness: 65, compression: 75, personality: 35, safety: 80 },
  'social-native':      { naturalness: 90, energy: 85, precision: 40, formality: 15, boldness: 80, compression: 80, personality: 85, safety: 60 },
  'custom':             { naturalness: 70, energy: 60, precision: 65, formality: 50, boldness: 55, compression: 40, personality: 60, safety: 80 },
}

function HumanizerConfig({
  config,
  onChange,
  workflowModel,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
  const mode = (config.mode as string) ?? 'executive-natural'
  const modelCfg = (config.model_config as Record<string, unknown> | null) ?? null
  const overrideEnabled = modelCfg !== null
  const targetedRewrite = (config.targeted_rewrite as boolean) ?? true

  const overrideProvider = (modelCfg?.provider as string) ?? 'anthropic'
  const overrideModel = (modelCfg?.model as string) ?? 'claude-sonnet-4-5'
  const inheritedLabel = `${modelLabel(workflowModel.provider, workflowModel.model)} (default)`

  const handleModeChange = (newMode: string) => {
    onChange('mode', newMode)
    // Apply preset slider values when mode changes
    const preset = HUMANIZER_MODE_PRESETS[newMode]
    if (preset) {
      for (const [key, value] of Object.entries(preset)) {
        onChange(key, value)
      }
    }
  }

  return (
    <>
      {/* Mode */}
      <FieldGroup label="Voice Mode">
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HUMANIZER_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Sliders */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">Style Parameters</Label>
        {HUMANIZER_SLIDERS.map(({ key, label }) => {
          const val = (config[key] as number) ?? 50
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground/80">{label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{val}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={val}
                onChange={(e) => onChange(key, parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          )
        })}
      </div>

      {/* Targeted rewrite toggle */}
      <div className="flex items-center justify-between rounded-md border border-border p-2.5">
        <div className="space-y-0.5">
          <Label className="text-xs">Targeted rewriting only</Label>
          <p className="text-[11px] text-muted-foreground">
            Rewrites only AI-flagged sentences, not the full piece
          </p>
        </div>
        <button
          onClick={() => onChange('targeted_rewrite', !targetedRewrite)}
          className={cn(
            'ml-3 h-5 w-9 shrink-0 rounded-full border transition-colors',
            targetedRewrite ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
              targetedRewrite ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Model override */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Model Override</Label>
        <p className="text-xs text-muted-foreground/60">Inherited: {inheritedLabel}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overrideEnabled}
            onChange={(e) =>
              onChange('model_config', e.target.checked ? { provider: 'anthropic', model: 'claude-sonnet-4-5' } : null)
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
                onValueChange={(v) => onChange('model_config', { provider: v, model: defaultModelForProvider(v) })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modelsForProvider(overrideProvider).map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Logic / detection ────────────────────────────────────────────────────────

const DETECTION_SERVICES = [
  { value: 'gptzero',      label: 'GPTZero' },
  { value: 'originality',  label: 'Originality.ai' },
  { value: 'copyleaks',    label: 'Copyleaks' },
  { value: 'sapling',      label: 'Sapling' },
  { value: 'local',        label: 'Local (offline)' },
]

function DetectionConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { output?: unknown; warning?: string }
}) {
  const service = (config.service as string) ?? 'gptzero'
  const threshold = (config.threshold as number) ?? 20
  const maxRetries = (config.max_retries as number) ?? 3
  const apiKeyRef = (config.api_key_ref as string) ?? ''

  // Run-time output
  const detOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const overallScore = detOutput?.overall_score as number | undefined
  const flaggedSentences = detOutput?.flagged_sentences as string[] | undefined
  const warning = nodeRunStatus?.warning

  return (
    <>
      {/* Service */}
      <FieldGroup label="Detection Service">
        <Select value={service} onValueChange={(v) => onChange('service', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DETECTION_SERVICES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Threshold */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Threshold</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{threshold}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={threshold}
          onChange={(e) => onChange('threshold', parseInt(e.target.value))}
          className="w-full accent-blue-500"
        />
        <p className="text-[11px] text-muted-foreground">
          Scores above this value trigger the humanizer loop
        </p>
      </div>

      {/* Max retries */}
      <FieldGroup label="Max Retries">
        <Input
          type="number"
          min={1}
          max={10}
          className="h-8 text-xs"
          value={maxRetries}
          onChange={(e) => onChange('max_retries', parseInt(e.target.value) || 3)}
        />
      </FieldGroup>

      {/* API key reference */}
      {service !== 'local' && (
        <FieldGroup label="API Key Environment Variable">
          <Input
            placeholder="e.g. GPTZERO_API_KEY"
            className="font-mono text-xs"
            value={apiKeyRef}
            onChange={(e) => onChange('api_key_ref', e.target.value)}
          />
        </FieldGroup>
      )}

      {/* ── Run-time results ── */}
      {overallScore !== undefined && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Last Run Score</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  overallScore <= 20  ? 'bg-emerald-900/60 text-emerald-300' :
                  overallScore <= 50  ? 'bg-amber-900/60  text-amber-300'   :
                                        'bg-red-900/60    text-red-300',
                )}
              >
                {overallScore}%
              </span>
            </div>

            {warning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-900/20 px-2.5 py-2">
                <span className="mt-0.5 shrink-0 text-sm text-amber-400">⚠</span>
                <p className="text-xs text-amber-300">{warning}</p>
              </div>
            )}

            {flaggedSentences && flaggedSentences.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Flagged Sentences ({flaggedSentences.length})
                </Label>
                <div className="max-h-[200px] space-y-1 overflow-y-auto">
                  {flaggedSentences.map((sentence, i) => (
                    <div
                      key={i}
                      className="rounded border border-red-500/20 bg-red-900/10 px-2.5 py-1.5 text-xs text-red-300/80"
                    >
                      {sentence}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {flaggedSentences?.length === 0 && (
              <p className="text-xs text-emerald-400">No sentences flagged — content looks human-written.</p>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ─── Logic / conditional-branch ───────────────────────────────────────────────

function ConditionalBranchConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const conditionType = (config.condition_type as string) ?? 'detection_score'
  const operator = (config.operator as string) ?? 'above'
  const value = (config.value as number) ?? 20
  const passLabel = (config.pass_label as string) ?? 'pass'
  const failLabel = (config.fail_label as string) ?? 'fail'
  const fallbackHumanizerId = (config.fallback_humanizer_id as string) ?? ''

  // Get humanizer nodes from the store for the fallback selector
  const nodes = useWorkflowStore((s) => s.nodes)
  const humanizerNodes = nodes.filter(
    (n) => n.data?.subtype === 'humanizer',
  )

  return (
    <>
      {/* Condition type */}
      <FieldGroup label="Condition Type">
        <Select value={conditionType} onValueChange={(v) => onChange('condition_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="detection_score" className="text-xs">Detection Score</SelectItem>
            <SelectItem value="word_count"      className="text-xs">Word Count</SelectItem>
            <SelectItem value="retry_count"     className="text-xs">Retry Count</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Operator */}
      <FieldGroup label="Operator">
        <Select value={operator} onValueChange={(v) => onChange('operator', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="above" className="text-xs">Above</SelectItem>
            <SelectItem value="below" className="text-xs">Below</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Value */}
      <FieldGroup label="Value">
        <Input
          type="number"
          min={0}
          className="h-8 text-xs"
          value={value}
          onChange={(e) => onChange('value', parseInt(e.target.value) || 0)}
        />
      </FieldGroup>

      {/* Port labels */}
      <div className="grid grid-cols-2 gap-2">
        <FieldGroup label="Pass label">
          <Input
            className="h-8 text-xs"
            placeholder="pass"
            value={passLabel}
            onChange={(e) => onChange('pass_label', e.target.value)}
          />
        </FieldGroup>
        <FieldGroup label="Fail label">
          <Input
            className="h-8 text-xs"
            placeholder="fail"
            value={failLabel}
            onChange={(e) => onChange('fail_label', e.target.value)}
          />
        </FieldGroup>
      </div>

      {/* Fallback humanizer selector */}
      <FieldGroup label="Fallback Humanizer (after max retries)">
        <Select
          value={fallbackHumanizerId || '__none__'}
          onValueChange={(v) => onChange('fallback_humanizer_id', v === '__none__' ? '' : v)}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-muted-foreground">None</SelectItem>
            {humanizerNodes.map((n) => (
              <SelectItem key={n.id} value={n.id} className="text-xs">
                {(n.data?.label as string) || n.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Humanizer to use when max retries are exhausted
        </p>
      </FieldGroup>
    </>
  )
}

// ─── Source / transcription ───────────────────────────────────────────────────

const AUDIO_ACCEPTED_EXTENSIONS = '.mp3,.wav,.m4a,.ogg,.flac'
const AUDIO_FILE_SIZE_LIMIT_MB = 500

const TRANSCRIPTION_PROVIDERS = [
  { value: 'deepgram',      label: 'Deepgram' },
  { value: 'assemblyai',    label: 'AssemblyAI' },
  { value: 'openai-whisper', label: 'OpenAI Whisper' },
  { value: 'local',         label: 'Local (mock)' },
]

interface UploadedAudioFile {
  id: string
  name: string
  size: number
  storageKey: string
  uploaded: boolean
}

function TranscriptionConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const audioFileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const nodes = useWorkflowStore((s) => s.nodes)
  const audioFiles = (config.audio_files as UploadedAudioFile[]) ?? []
  const provider = (config.provider as string) ?? 'deepgram'
  const enableDiarization = (config.enable_diarization as boolean) ?? true
  const maxSpeakers = (config.max_speakers as number | null) ?? null
  const apiKeyRef = (config.api_key_ref as string) ?? ''
  const targetNodeIds = (config.target_node_ids as string[]) ?? []

  const uploadAudio = useCallback(
    async (files: File[]) => {
      const allowed = files.filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        return ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext) &&
          f.size <= AUDIO_FILE_SIZE_LIMIT_MB * 1024 * 1024
      })
      if (allowed.length === 0) return
      setUploading(true)

      const results: UploadedAudioFile[] = []
      for (const file of allowed) {
        const fd = new FormData()
        fd.append('file', file)
        try {
          const res = await fetch(`${API_URL}/api/v1/documents`, { method: 'POST', body: fd })
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
      onChange('audio_files', [...audioFiles, ...results])
      setUploading(false)
    },
    [audioFiles, onChange],
  )

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) uploadAudio(Array.from(e.dataTransfer.files))
  }

  const removeAudio = (id: string) =>
    onChange('audio_files', audioFiles.filter((f) => f.id !== id))

  const toggleTargetNode = (nodeId: string) => {
    const next = targetNodeIds.includes(nodeId)
      ? targetNodeIds.filter((id) => id !== nodeId)
      : [...targetNodeIds, nodeId]
    onChange('target_node_ids', next)
  }

  // Nodes that can receive transcript output (source nodes excluded)
  const receiverNodes = nodes.filter((n) => n.type !== 'source')

  return (
    <>
      {/* Audio file upload */}
      <FieldGroup label="Audio Files">
        <div
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-blue-500 bg-blue-950/30 text-blue-300'
              : 'border-border hover:border-border/60 hover:bg-accent/40',
          )}
          onClick={() => audioFileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {uploading ? (
            <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Icons.Mic className="h-6 w-6 text-muted-foreground" />
          )}
          <div>
            <p className="text-xs font-medium">
              {uploading ? 'Uploading…' : 'Drop audio files or click to browse'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              MP3, WAV, M4A, OGG, FLAC — up to {AUDIO_FILE_SIZE_LIMIT_MB} MB each
            </p>
          </div>
          <input
            ref={audioFileInputRef}
            type="file"
            multiple
            accept={AUDIO_ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadAudio(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        </div>
      </FieldGroup>

      {audioFiles.length > 0 && (
        <div className="space-y-1">
          {audioFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <Icons.Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              {!f.uploaded && (
                <span title="Not synced to server">
                  <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                </span>
              )}
              <button onClick={() => removeAudio(f.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Provider */}
      <FieldGroup label="Transcription Provider">
        <Select value={provider} onValueChange={(v) => onChange('provider', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRANSCRIPTION_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* API key env-var reference (hidden for local) */}
      {provider !== 'local' && (
        <FieldGroup label="API Key (env var name)">
          <Input
            placeholder={`e.g. ${provider.toUpperCase().replace('-', '_')}_API_KEY`}
            className="text-xs"
            value={apiKeyRef}
            onChange={(e) => onChange('api_key_ref', e.target.value)}
          />
        </FieldGroup>
      )}

      {/* Speaker diarization */}
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Enable Speaker Diarization</Label>
        <button
          onClick={() => onChange('enable_diarization', !enableDiarization)}
          className={cn(
            'h-5 w-9 rounded-full border transition-colors',
            enableDiarization ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
          )}
        >
          <span className={cn('block h-3.5 w-3.5 rounded-full bg-white transition-transform', enableDiarization ? 'translate-x-4' : 'translate-x-0.5')} />
        </button>
      </div>

      {/* Max speakers hint */}
      {enableDiarization && (
        <FieldGroup label="Max Speakers (optional hint)">
          <Input
            type="number"
            min={1}
            max={10}
            placeholder="Auto-detect"
            className="text-xs"
            value={maxSpeakers ?? ''}
            onChange={(e) => onChange('max_speakers', e.target.value ? parseInt(e.target.value, 10) : null)}
          />
          <p className="text-[11px] text-muted-foreground">
            Hint to improve diarization accuracy. Leave blank to auto-detect.
          </p>
        </FieldGroup>
      )}

      {/* Target nodes */}
      {receiverNodes.length > 0 && (
        <FieldGroup label="Send Transcript To">
          <div className="space-y-1.5">
            {receiverNodes.map((n) => {
              const nodeLabel = (n.data?.label as string) || n.id
              const isSelected = targetNodeIds.includes(n.id)
              return (
                <button
                  key={n.id}
                  onClick={() => toggleTargetNode(n.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                    isSelected
                      ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                      : 'border-border text-muted-foreground hover:bg-accent/40',
                  )}
                >
                  <span className={cn('h-3.5 w-3.5 rounded border transition-colors shrink-0',
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground',
                  )}>
                    {isSelected && <Icons.Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  {nodeLabel}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Selected nodes will receive the full transcript as their source input after speaker assignment.
          </p>
        </FieldGroup>
      )}
    </>
  )
}

// ─── Output / client-feedback ─────────────────────────────────────────────────

const FEEDBACK_SOURCE_TYPES = [
  { value: 'portal',     label: 'Client Portal' },
  { value: 'manual',     label: 'Manual Entry' },
  { value: 'transcription', label: 'Transcription' },
]

const FEEDBACK_SENTIMENTS = [
  { value: 'approved',             label: 'Approved' },
  { value: 'approved_with_changes', label: 'Approved with changes' },
  { value: 'needs_revision',       label: 'Needs revision' },
  { value: 'rejected',             label: 'Rejected' },
]

const TONE_OPTIONS = [
  { value: 'too_formal',  label: 'Too formal' },
  { value: 'too_casual',  label: 'Too casual' },
  { value: 'just_right',  label: 'Just right' },
  { value: 'too_generic', label: 'Too generic' },
]

const CONTENT_TAG_OPTIONS = [
  { value: 'too_long',       label: 'Too long' },
  { value: 'too_short',      label: 'Too short' },
  { value: 'missing_points', label: 'Missing points' },
  { value: 'off_brief',      label: 'Off brief' },
  { value: 'good',           label: 'Good' },
]

interface ReentryRule {
  sentiment: string
  reentry_node_id: string
}

interface ManualFeedback {
  decision: string
  star_rating: number
  tone_feedback: string
  content_tags: string[]
  comment: string
}

function ClientFeedbackConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const sourceType       = (config.source_type as string) ?? 'portal'
  const triggerMode      = (config.trigger_mode as string) ?? 'auto'
  const autoTriggerOn    = (config.auto_trigger_on as string[]) ?? ['needs_revision', 'rejected']
  const reentryNodeId    = (config.default_reentry_node_id as string) ?? ''
  const reentryRules     = (config.reentry_rules as ReentryRule[]) ?? []
  const maxAutoRetries   = (config.max_auto_retries as number) ?? 3
  const stakeholderIds   = (config.stakeholder_ids as string[]) ?? []
  const manualFeedback   = (config.manual_feedback as ManualFeedback) ?? {
    decision: 'needs_revision', star_rating: 3, tone_feedback: '', content_tags: [], comment: '',
  }

  const nodes = useWorkflowStore((s) => s.nodes)
  // All non-feedback nodes that could be re-entry points
  const reentryNodes = nodes.filter((n) => n.data?.subtype !== 'client-feedback')

  const toggleAutoTrigger = (sentiment: string) => {
    const next = autoTriggerOn.includes(sentiment)
      ? autoTriggerOn.filter((s) => s !== sentiment)
      : [...autoTriggerOn, sentiment]
    onChange('auto_trigger_on', next)
  }

  const updateReentryRule = (sentiment: string, nodeId: string) => {
    const existing = reentryRules.filter((r) => r.sentiment !== sentiment)
    if (nodeId) existing.push({ sentiment, reentry_node_id: nodeId })
    onChange('reentry_rules', existing)
  }

  const getReentryRule = (sentiment: string) =>
    reentryRules.find((r) => r.sentiment === sentiment)?.reentry_node_id ?? ''

  const toggleContentTag = (tag: string) => {
    const tags = manualFeedback.content_tags ?? []
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    onChange('manual_feedback', { ...manualFeedback, content_tags: next })
  }

  return (
    <>
      {/* Source type */}
      <FieldGroup label="Source Type">
        <Select value={sourceType} onValueChange={(v) => onChange('source_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FEEDBACK_SOURCE_TYPES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Trigger mode */}
      <FieldGroup label="Trigger Mode">
        <div className="grid grid-cols-2 gap-1.5">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onChange('trigger_mode', m)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                triggerMode === m
                  ? 'border-purple-600 bg-purple-950/40 text-purple-300'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              {m === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {triggerMode === 'auto'
            ? 'Automatically re-triggers the workflow when sentiment matches.'
            : 'Pauses the workflow — resume manually after entering feedback.'}
        </p>
      </FieldGroup>

      {/* Stakeholder IDs (portal mode) */}
      {sourceType === 'portal' && (
        <FieldGroup label="Stakeholder IDs">
          <Textarea
            className="min-h-[60px] font-mono text-xs"
            placeholder="One stakeholder ID per line"
            value={stakeholderIds.join('\n')}
            onChange={(e) =>
              onChange('stakeholder_ids', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Paste stakeholder IDs from the Clients section. Magic links are generated automatically.
          </p>
        </FieldGroup>
      )}

      {/* Auto mode settings */}
      {triggerMode === 'auto' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auto-trigger on Sentiments</Label>
            {FEEDBACK_SENTIMENTS.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTriggerOn.includes(value)}
                  onChange={() => toggleAutoTrigger(value)}
                  className="accent-purple-500"
                />
                <span className="text-xs">{label}</span>
              </label>
            ))}
          </div>

          {/* Default re-entry node */}
          <FieldGroup label="Default Re-entry Node">
            <Select
              value={reentryNodeId || '__none__'}
              onValueChange={(v) => onChange('default_reentry_node_id', v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">
                  Start from beginning
                </SelectItem>
                {reentryNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">
                    {(n.data?.label as string) || n.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Node to restart from when feedback triggers a re-run. Overridable per sentiment below.
            </p>
          </FieldGroup>

          {/* Per-sentiment re-entry rules */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Conditional Re-entry Rules</Label>
            {FEEDBACK_SENTIMENTS.filter(({ value }) => autoTriggerOn.includes(value)).map(({ value, label }) => (
              <div key={value} className="rounded-md border border-border p-2.5 space-y-1">
                <p className="text-xs font-medium">{label}</p>
                <Select
                  value={getReentryRule(value) || '__default__'}
                  onValueChange={(v) => updateReentryRule(value, v === '__default__' ? '' : v)}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__" className="text-xs text-muted-foreground">
                      Use default re-entry node
                    </SelectItem>
                    {reentryNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-xs">
                        {(n.data?.label as string) || n.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {autoTriggerOn.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">
                Select sentiments above to configure per-sentiment rules.
              </p>
            )}
          </div>

          {/* Max auto-retries */}
          <FieldGroup label="Max Auto-retries">
            <Input
              type="number"
              min={1}
              max={20}
              className="h-8 text-xs"
              value={maxAutoRetries}
              onChange={(e) => onChange('max_auto_retries', parseInt(e.target.value) || 3)}
            />
            <p className="text-[11px] text-muted-foreground">
              After this many re-runs the workflow escalates to human review.
            </p>
          </FieldGroup>
        </>
      )}

      {/* Manual entry form */}
      {triggerMode === 'manual' && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Manual feedback to inject when this node is reached during a run.
          </p>

          {/* Sentiment */}
          <FieldGroup label="Sentiment">
            <Select
              value={manualFeedback.decision}
              onValueChange={(v) => onChange('manual_feedback', { ...manualFeedback, decision: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEEDBACK_SENTIMENTS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Star rating */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Star Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => onChange('manual_feedback', { ...manualFeedback, star_rating: star })}
                  className={cn(
                    'text-lg transition-colors',
                    star <= manualFeedback.star_rating ? 'text-amber-400' : 'text-muted-foreground/30',
                  )}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <FieldGroup label="Tone">
            <Select
              value={manualFeedback.tone_feedback || '__none__'}
              onValueChange={(v) =>
                onChange('manual_feedback', { ...manualFeedback, tone_feedback: v === '__none__' ? '' : v })
              }
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">Not specified</SelectItem>
                {TONE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Content tags */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Content Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TAG_OPTIONS.map(({ value, label }) => {
                const active = (manualFeedback.content_tags ?? []).includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleContentTag(value)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      active
                        ? 'border-purple-600 bg-purple-950/40 text-purple-300'
                        : 'border-border text-muted-foreground hover:bg-accent/40',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Comment */}
          <FieldGroup label="Comment">
            <Textarea
              className="min-h-[80px] text-xs"
              placeholder="Optional feedback comment…"
              value={manualFeedback.comment}
              onChange={(e) => onChange('manual_feedback', { ...manualFeedback, comment: e.target.value })}
            />
          </FieldGroup>
        </>
      )}
    </>
  )
}

// ─── Config dispatcher ────────────────────────────────────────────────────────

function NodeConfigForm({
  nodeType,
  subtype,
  config,
  onChange,
  workflowModel,
  nodeRunStatus,
}: {
  nodeType: string
  subtype: string
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
  nodeRunStatus?: { output?: unknown; warning?: string }
}) {
  switch (nodeType) {
    case 'source':
      if (subtype === 'transcription')
        return <TranscriptionConfig config={config} onChange={onChange} />
      return <DocumentSourceConfig config={config} onChange={onChange} />
    case 'logic':
      if (subtype === 'humanizer')
        return <HumanizerConfig config={config} onChange={onChange} workflowModel={workflowModel} />
      if (subtype === 'detection')
        return <DetectionConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'conditional-branch')
        return <ConditionalBranchConfig config={config} onChange={onChange} />
      return <AiGenerateConfig config={config} onChange={onChange} workflowModel={workflowModel} />
    case 'output':
      if (subtype === 'client-feedback')
        return <ClientFeedbackConfig config={config} onChange={onChange} />
      return <ContentOutputConfig config={config} onChange={onChange} />
    case 'insight':
      return <InsightNodeConfig config={config} />
    default:
      return <p className="text-xs text-muted-foreground">No configuration for this node type.</p>
  }
}

// ─── Insight node config ──────────────────────────────────────────────────────

const SUGGESTED_NODE_LABELS: Record<string, string> = {
  'logic:humanizer':       'Humanizer node',
  'output:content-output': 'Content Output node',
  'logic:ai-generate':     'AI Generate node',
  'logic':                 'Logic node',
  'output':                'Output node',
}

function InsightNodeConfig({
  config,
}: {
  config: Record<string, unknown>
}) {
  const suggestedNodeType = (config.suggested_node_type as string) ?? ''
  const suggestedConfigChange = (config.suggested_config_change as Record<string, unknown>) ?? {}
  const insightType = (config.insight_type as string) ?? ''
  const nodeLabel = SUGGESTED_NODE_LABELS[suggestedNodeType] ?? suggestedNodeType

  return (
    <div className="space-y-3">
      {/* Pattern type badge */}
      <div className="rounded-lg border border-yellow-700/40 bg-yellow-950/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Icons.Lightbulb className="h-4 w-4 text-yellow-400 shrink-0" />
          <span className="text-xs font-medium text-yellow-300 capitalize">
            {insightType.replace(/_/g, ' ')} Pattern
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect this node's output port to a compatible node. When the workflow runs, the
          suggested config change below will be applied as an additional modifier to that node.
        </p>
      </div>

      {/* Suggested target node */}
      {nodeLabel && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Suggested Connection</Label>
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-foreground">
            Connect to: <span className="font-medium text-yellow-300">{nodeLabel}</span>
          </div>
        </div>
      )}

      {/* Config change preview */}
      {Object.keys(suggestedConfigChange).length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Config Change Preview</Label>
          <div className="rounded-md border border-yellow-700/30 bg-yellow-950/10 px-2.5 py-2 space-y-1">
            {Object.entries(suggestedConfigChange).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                <span className="font-mono text-yellow-300">{String(v)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            These values will be merged into the connected node's config during each run.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeData, workflow, nodeRunStatuses } = useWorkflowStore()
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
    insight: 'text-yellow-400',
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
            subtype={subtype}
            config={config}
            onChange={onConfigChange}
            workflowModel={workflow.default_model_config}
            nodeRunStatus={nodeRunStatuses[node.id]}
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
