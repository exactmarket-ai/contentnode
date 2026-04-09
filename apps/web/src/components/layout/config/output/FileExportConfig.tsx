import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { downloadDocx } from '@/lib/downloadDocx'
import { FieldGroup } from '../shared'

export function FileExportOutput({
  nodeRunStatus,
  config,
}: {
  nodeRunStatus?: { output?: unknown }
  config: Record<string, unknown>
}) {
  const [copied, setCopied] = useState(false)

  const raw = nodeRunStatus?.output
  const outputObj = raw as Record<string, unknown> | string | undefined
  const content = typeof outputObj === 'string' ? outputObj
    : outputObj && typeof outputObj === 'object' ? (outputObj.content as string | undefined) ?? JSON.stringify(outputObj, null, 2)
    : null

  const format = (config.format as string) ?? 'docx'
  const filename = ((config.filename as string) || 'output').replace(/\.[^.]+$/, '')

  const handleDownload = () => {
    if (!content) return
    if (format === 'docx') {
      downloadDocx(content, filename)
    } else {
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  if (!content) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Icons.FileDown className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">File will be ready to download after the workflow runs.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Filename row — truncated display, full name used in download */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Icons.FileDown className="h-3.5 w-3.5 shrink-0 text-purple-600" />
        <span
          className="min-w-0 truncate text-xs font-medium text-purple-700"
          title={`${filename}.${format}`}
        >
          {filename}.{format}
        </span>
      </div>
      {/* Action buttons — left-aligned below filename */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-md border border-emerald-300 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
        >
          <Icons.Download className="h-3 w-3" />
          Download .{format}
        </button>
        <button
          onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  )
}

export function FileExportConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <>
      <FieldGroup label="Format">
        <Select value={(config.format as string) ?? 'docx'} onValueChange={(v) => onChange('format', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['docx', 'txt', 'md', 'json', 'csv', 'html'].map((f) => (
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
