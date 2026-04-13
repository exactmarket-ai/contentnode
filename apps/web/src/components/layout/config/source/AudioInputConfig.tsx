import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '../shared'
import { assetUrl, apiFetch, downloadAsset } from '@/lib/api'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface StoredAudio {
  storageKey: string
  localPath:  string
  filename:   string
  sizeBytes:  number
}

export function AudioInputConfig({
  config,
  onChange,
}: {
  config:   Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const storedAudio = config.stored_audio as StoredAudio | undefined
  const fullAudioUrl = storedAudio?.localPath ? assetUrl(storedAudio.localPath) : null

  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [uploading,  setUploading]  = useState(false)
  const [dropping,   setDropping]   = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadFile = useCallback(async (file: File) => {
    const allowedExt = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!allowedExt.has(ext)) {
      setUploadError(`Unsupported format ".${ext}" — please use MP3, WAV, M4A, OGG, or FLAC.`)
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch('/api/v1/documents', { method: 'POST', body: form })
      if (!res.ok) {
        const { error } = await res.json() as { error: string }
        throw new Error(error ?? `Upload failed (${res.status})`)
      }
      const json = await res.json() as { data: { id: string; filename: string; storageKey: string; sizeBytes: number } }
      const { storageKey, filename, sizeBytes } = json.data
      onChange('stored_audio', {
        storageKey,
        localPath: `/files/doc/${storageKey}`,
        filename,
        sizeBytes,
      })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [onChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }, [uploadFile])

  const handleRemove = () => onChange('stored_audio', undefined)

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup label="Audio file">
        {fullAudioUrl && storedAudio ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.Music className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-emerald-800 truncate flex-1 min-w-0" title={storedAudio.filename}>
                {storedAudio.filename}
              </span>
              <span className="text-[10px] text-emerald-500 shrink-0">{formatBytes(storedAudio.sizeBytes)}</span>
            </div>
            <audio controls className="w-full" style={{ height: 36 }}>
              <source src={fullAudioUrl} />
            </audio>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px] flex-1"
                onClick={() => fileInputRef.current?.click()}>
                <Icons.Upload className="h-3 w-3" />
                Replace
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]"
                onClick={() => downloadAsset(fullAudioUrl!, 'audio.mp3')}>
                <Icons.Download className="h-3 w-3" />
                Download
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px] text-destructive hover:text-destructive"
                onClick={handleRemove}>
                <Icons.Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : uploading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-5 animate-pulse">
            <Icons.Upload className="h-4 w-4 text-emerald-600" />
            <span className="text-xs text-emerald-700">Uploading…</span>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors"
            style={{
              borderColor: dropping ? '#059669' : '#a7f3d0',
              backgroundColor: dropping ? 'rgba(5,150,105,0.06)' : 'transparent',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDropping(true) }}
            onDragLeave={() => setDropping(false)}
            onDrop={handleDrop}
          >
            <Icons.Upload className="h-6 w-6 text-emerald-400" />
            <p className="text-xs text-muted-foreground text-center">
              Drop an audio file here or{' '}
              <span className="text-emerald-600 font-medium">click to browse</span>
            </p>
            <p className="text-[10px] text-muted-foreground/60">MP3 · WAV · M4A · OGG · FLAC</p>
          </div>
        )}

        {uploadError && (
          <p className="text-[10px] text-destructive mt-1">{uploadError}</p>
        )}
      </FieldGroup>

      <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground space-y-1">
        <p className="font-medium">How this works</p>
        <p>Upload any audio file and connect this node's output to an <strong>Audio Mix</strong> node. The file is stored with the workflow and reused on every run — no re-upload needed.</p>
      </div>

      <input ref={fileInputRef} type="file" className="hidden"
        accept=".mp3,.wav,.m4a,.ogg,.flac,audio/*"
        onChange={handleFileChange} />
    </div>
  )
}
