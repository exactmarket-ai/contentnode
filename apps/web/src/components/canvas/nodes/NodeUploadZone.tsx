import { useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch, assetUrl } from '@/lib/api'

export interface ReferenceFile {
  localPath: string
  type: 'image' | 'video'
  filename: string
}

interface NodeUploadZoneProps {
  files: ReferenceFile[]
  onAdd: (file: ReferenceFile) => void
  onRemove: (localPath: string) => void
  accentColor?: string
}

export function NodeUploadZone({ files, onAdd, onRemove, accentColor = '#6366f1' }: NodeUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch('/api/v1/reference-files', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const { data } = await res.json()
      onAdd(data as ReferenceFile)
    } catch (err) {
      console.error('[NodeUploadZone] upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    for (const file of Array.from(fileList)) await upload(file)
  }

  return (
    <div className="space-y-1.5 nodrag">
      {/* Uploaded thumbnails */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <div key={f.localPath} className="relative group" style={{ width: 52, height: 52 }}>
              {f.type === 'video' ? (
                <video
                  src={assetUrl(f.localPath)}
                  className="w-full h-full object-cover rounded-sm border"
                  style={{ borderColor: accentColor + '55' }}
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={assetUrl(f.localPath)}
                  alt={f.filename}
                  draggable={false}
                  className="w-full h-full object-cover rounded-sm border"
                  style={{ borderColor: accentColor + '55' }}
                />
              )}
              {f.type === 'video' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full bg-black/40 p-0.5">
                    <Icons.Play className="h-3 w-3 text-white" />
                  </div>
                </div>
              )}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemove(f.localPath) }}
                className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow"
              >
                <Icons.X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
        onDragLeave={(e) => { e.stopPropagation(); setDragOver(false) }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        className="flex cursor-pointer items-center justify-center gap-1 rounded-sm border border-dashed py-1 transition-colors"
        style={{
          borderColor: dragOver ? accentColor : accentColor + '55',
          backgroundColor: dragOver ? accentColor + '15' : 'transparent',
        }}
      >
        {uploading
          ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" style={{ color: accentColor }} />
          : <Icons.Paperclip className="h-2.5 w-2.5" style={{ color: accentColor }} />}
        <span className="text-[9px] font-medium select-none" style={{ color: accentColor }}>
          {uploading ? 'Uploading…' : files.length ? 'Add more' : 'Add reference'}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}
