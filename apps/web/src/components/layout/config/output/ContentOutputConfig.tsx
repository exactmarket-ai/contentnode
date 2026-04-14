import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { useWorkflowStore } from '@/store/workflowStore'
import { FieldGroup } from '../shared'

const OUTPUT_TYPES = [
  { value: 'blog-post',      label: 'Blog Post' },
  { value: 'email',          label: 'Email' },
  { value: 'ad-copy',        label: 'Ad Copy' },
  { value: 'linkedin-post',  label: 'LinkedIn Post' },
  { value: 'video-script',   label: 'Video Script' },
  { value: 'landing-page',   label: 'Landing Page' },
  { value: 'custom',         label: 'Custom' },
]

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

export function DisplayNodeOutput({
  nodeRunStatus,
}: {
  nodeRunStatus?: { output?: unknown; warning?: string; startedAt?: string }
}) {
  const finalOutput = useWorkflowStore((s) => s.finalOutput)
  const [copied, setCopied] = useState(false)

  function extractContent(raw: unknown): string | null {
    if (typeof raw === 'string') return raw || null
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.content === 'string') return obj.content || null
      if (typeof obj.text   === 'string') return obj.text   || null
      return JSON.stringify(obj, null, 2)
    }
    return null
  }
  // Try node-specific output, then fall back to workflow-level finalOutput
  const content = extractContent(nodeRunStatus?.output) ?? extractContent(finalOutput)

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!content) return
    downloadDocx(content, 'output')
  }

  if (!content) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Icons.MonitorPlay className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">Output will appear here after the workflow runs.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icons.CheckCircle2 className="h-3.5 w-3.5 text-purple-600" />
        <span className="text-xs font-medium text-purple-700">Run Output</span>
        {nodeRunStatus?.startedAt && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(nodeRunStatus.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
          >
            {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icons.Download className="h-3 w-3" />
            .docx
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-muted/30 p-3 max-h-[60vh] overflow-y-auto">
        <pre className="whitespace-pre-wrap text-xs text-foreground font-sans leading-relaxed">{content}</pre>
      </div>
    </div>
  )
}

export function ContentOutputConfig({
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
