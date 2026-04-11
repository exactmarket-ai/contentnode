import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { FieldGroup, formatBytes } from '../shared'

interface VideoFile {
  id: string
  name: string
  size: number
  storageKey: string
  uploaded: boolean
}

const VIDEO_ACCEPTED   = '.mp4,.mov,.avi,.webm,.mkv,.m4v'
const VIDEO_SIZE_LIMIT = 500 // MB

export function VideoUploadConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sizeError, setSizeError] = useState<string | null>(null)

  const videoFiles = (config.video_files as VideoFile[]) ?? []

  const uploadVideo = useCallback(
    async (files: File[]) => {
      const limitBytes = VIDEO_SIZE_LIMIT * 1024 * 1024
      const tooBig = files.find((f) => f.size > limitBytes)
      if (tooBig) {
        const mb = (tooBig.size / 1024 / 1024).toFixed(1)
        setSizeError(`${tooBig.name} is ${mb} MB — max is ${VIDEO_SIZE_LIMIT} MB`)
        setTimeout(() => setSizeError(null), 6000)
        return
      }
      setSizeError(null)

      const allowed = files.filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        return ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v'].includes(ext)
      })
      if (allowed.length === 0) return
      setUploading(true)
      const results: VideoFile[] = []
      for (const file of allowed) {
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
      onChange('video_files', results.slice(-1))
      setUploading(false)
    },
    [onChange],
  )

  return (
    <FieldGroup label="Video File">
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
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files) uploadVideo(Array.from(e.dataTransfer.files))
        }}
      >
        {uploading
          ? <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          : <Icons.Film className="h-6 w-6 text-muted-foreground" />}
        <div className="w-full min-w-0">
          <p className="text-xs font-medium">
            {uploading ? 'Uploading…' : 'Drop video here or click to browse'}
          </p>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
            MP4, MOV, AVI, WEBM, MKV — up to {VIDEO_SIZE_LIMIT} MB
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={VIDEO_ACCEPTED}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) uploadVideo(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>

      {sizeError && (
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
          <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{sizeError}</span>
        </div>
      )}

      {videoFiles.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {videoFiles.map((f) => (
            <div
              key={f.id}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <Icons.FileVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              {!f.uploaded && (
                <span title="Upload failed"><Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" /></span>
              )}
              <button
                onClick={() => onChange('video_files', [])}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove video"
              >
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Connect this node to a Video Transcription node and/or a Video Frame Extractor node.
      </p>
    </FieldGroup>
  )
}
