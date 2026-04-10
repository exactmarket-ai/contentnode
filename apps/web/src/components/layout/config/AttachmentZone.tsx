import { useRef } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

interface AttachmentZoneProps {
  /** Current value: a URL, base64 data URI, or empty string */
  value: string
  onChange: (value: string) => void
  /** MIME types to accept in the file browser (e.g. "image/*") */
  accept?: string
  label?: string
  hint?: string
  /** When true, renders a collapsed thumbnail-only view (for compact layouts) */
  compact?: boolean
}

function isImage(value: string) {
  return value.startsWith('data:image') || /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(value)
}

/**
 * Shared drag-and-drop / browse attachment zone.
 * Used by ImageGenerationConfig (reference image) and VideoGenerationConfig
 * (start frame, end frame). Converts uploaded files to base64 data URIs so
 * they are stored directly in the node config without a separate upload request.
 */
export function AttachmentZone({ value, onChange, accept = 'image/*', label, hint, compact = false }: AttachmentZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') onChange(e.target.result)
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    e.target.value = ''
  }

  if (value) {
    // Show thumbnail with remove button
    return (
      <div className={cn('relative overflow-hidden rounded-md border border-border bg-muted', compact ? 'h-16' : 'h-28')}>
        {isImage(value) ? (
          <img src={value} alt="Attached" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Icons.FileVideo className="h-4 w-4" />
            <span>Frame attached</span>
          </div>
        )}
        <button
          onClick={() => onChange('')}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
          title="Remove"
        >
          <Icons.X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 text-center transition-colors hover:bg-muted',
        compact ? 'h-16 px-2' : 'h-20 px-4',
      )}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
      <Icons.Upload className="h-4 w-4 text-muted-foreground" />
      {!compact && (
        <>
          <p className="text-[10px] text-muted-foreground">
            {label ?? 'Drop image or click to browse'}
          </p>
          {hint && <p className="text-[9px] text-muted-foreground/60">{hint}</p>}
        </>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleBrowse} />
    </div>
  )
}
