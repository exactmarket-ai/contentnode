import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch, assetUrl } from '@/lib/api'
import { FieldGroup, formatBytes } from '../shared'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface VideoFile {
  id: string
  name: string
  size: number
  storageKey: string
  uploaded: boolean
}

interface FrameOutput {
  storageKey?: string
  localPath?: string
  filename?: string
  videoName?: string
  timestampSecs?: number
  durationSecs?: number
}

const VIDEO_ACCEPTED = '.mp4,.mov,.avi,.webm,.mkv,.m4v'
const VIDEO_SIZE_LIMIT_MB = 500

export function VideoFrameExtractorConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const videoFiles = (config.video_files as VideoFile[]) ?? []
  const timestampMode = (config.timestamp_mode as string) ?? 'percent'
  const timestampValue = (config.timestamp_value as number) ?? 50
  const videoContext = (config.video_context as string) ?? ''

  const uploadVideo = useCallback(
    async (files: File[]) => {
      const allowed = files.filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        return ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v'].includes(ext) &&
          f.size <= VIDEO_SIZE_LIMIT_MB * 1024 * 1024
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

  const frameOutput = nodeRunStatus?.status === 'passed' && nodeRunStatus.output
    ? nodeRunStatus.output as FrameOutput
    : null

  return (
    <>
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
          {uploading ? (
            <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Icons.Film className="h-6 w-6 text-muted-foreground" />
          )}
          <div className="w-full min-w-0">
            <p className="text-xs font-medium">
              {uploading ? 'Uploading…' : 'Drop video here or click to browse'}
            </p>
            <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
              MP4, MOV, AVI, WEBM, MKV — up to {VIDEO_SIZE_LIMIT_MB} MB
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
                  <span title="Not yet uploaded">
                    <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  </span>
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
      </FieldGroup>

      {/* Timestamp picker */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Frame Timestamp</Label>
        <div className="flex items-center gap-2">
          <select
            value={timestampMode}
            onChange={(e) => onChange('timestamp_mode', e.target.value)}
            className="rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
          >
            <option value="percent">% of duration</option>
            <option value="seconds">Seconds from start</option>
          </select>
          <input
            type="number"
            min={0}
            max={timestampMode === 'percent' ? 100 : 9999}
            step={timestampMode === 'percent' ? 5 : 1}
            value={timestampValue}
            onChange={(e) => onChange('timestamp_value', Number(e.target.value))}
            className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
          />
          <span className="text-xs text-muted-foreground">
            {timestampMode === 'percent' ? '%' : 's'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          50% captures the video mid-point. Use seconds mode to target a specific moment.
        </p>
      </div>

      {/* Video context / transcript */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Video Context or Transcript</Label>
        <Textarea
          placeholder="Paste the video transcript here, or describe what the video covers — topics, key points, speaker, audience. This drives the title and description generation."
          className="min-h-[100px] resize-none text-xs"
          value={videoContext}
          onChange={(e) => onChange('video_context', e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Optional but recommended — the more context you provide, the better the title and description.
        </p>
      </div>

      {/* Extracted thumbnail preview */}
      {frameOutput && (
        <div className="space-y-2 border-t border-border pt-3">
          <Label className="text-xs text-muted-foreground">Extracted Thumbnail</Label>
          {frameOutput.localPath && (
            <div className="relative overflow-hidden rounded-lg border border-border">
              <img
                src={assetUrl(frameOutput.localPath)}
                alt="Extracted thumbnail"
                className="w-full object-cover"
                style={{ maxHeight: 180 }}
              />
              <a
                href={assetUrl(frameOutput.localPath)}
                download={frameOutput.filename ?? 'thumbnail.jpg'}
                className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[10px] text-white hover:bg-black/80"
                onClick={(e) => e.stopPropagation()}
              >
                <Icons.Download className="h-3 w-3" />
                Download JPG
              </a>
            </div>
          )}
          {frameOutput.timestampSecs != null && (
            <p className="text-[11px] text-muted-foreground">
              Frame at {frameOutput.timestampSecs}s
              {frameOutput.durationSecs ? ` of ${frameOutput.durationSecs}s` : ''}
              {frameOutput.videoName ? ` · ${frameOutput.videoName}` : ''}
            </p>
          )}
        </div>
      )}
    </>
  )
}
