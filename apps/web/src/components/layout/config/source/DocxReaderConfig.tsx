import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { FieldGroup, formatBytes } from '../shared'

const ACCEPTED = '.docx,.txt,.md'
const SIZE_LIMIT_MB = 50

export function DocxReaderConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storageKey = config.storageKey as string | undefined
  const fileName   = config.fileName   as string | undefined
  const fileSize   = config.fileSize   as number | undefined

  const uploadFile = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['docx', 'txt', 'md'].includes(ext)) {
      setError(`Unsupported file type ".${ext}" — use .docx, .txt, or .md`)
      return
    }
    if (file.size > SIZE_LIMIT_MB * 1024 * 1024) {
      setError(`File is too large — max ${SIZE_LIMIT_MB} MB`)
      return
    }
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch('/api/v1/documents', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const json = await res.json()
      onChange('storageKey', json.data.storageKey)
      onChange('fileName', file.name)
      onChange('fileSize', file.size)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }, [onChange])

  return (
    <FieldGroup label="Script File" description="Upload the .docx or .txt video script to parse into scenes.">
      {storageKey ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
          <Icons.FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-xs font-medium">{fileName ?? storageKey}</span>
          {fileSize != null && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(fileSize)}</span>
          )}
          <button
            onClick={() => { onChange('storageKey', ''); onChange('fileName', ''); onChange('fileSize', null) }}
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title="Remove file"
          >
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className={cn(
            'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors',
            isDragging
              ? 'border-blue-400 bg-blue-50 text-blue-600'
              : 'border-border hover:border-border/60 hover:bg-accent/40',
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files) uploadFile(Array.from(e.dataTransfer.files))
          }}
        >
          {uploading
            ? <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            : <Icons.FileText className="h-6 w-6 text-muted-foreground" />}
          <div>
            <p className="text-xs font-medium">{uploading ? 'Uploading…' : 'Drop script here or click to browse'}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">DOCX, TXT, MD — up to {SIZE_LIMIT_MB} MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFile(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        </div>
      )}

      {error && (
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
          <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </FieldGroup>
  )
}
