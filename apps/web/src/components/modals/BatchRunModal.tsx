import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

interface FileEntry {
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  documentId?: string
  documentName: string
  errorMsg?: string
}

interface BatchRunModalProps {
  workflowId: string
  onClose: () => void
  onStarted: (batchId: string, count: number) => void
}

export function BatchRunModal({ workflowId, onClose, onStarted }: BatchRunModalProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [dragging, setDragging] = useState(false)
  const [launching, setLaunching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (newFiles: File[]) => {
    const entries: FileEntry[] = newFiles.map((f) => ({
      file: f,
      status: 'pending',
      documentName: f.name,
    }))
    setFiles((prev) => [...prev, ...entries])
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) addFiles(dropped)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) addFiles(selected)
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const uploadAll = async (): Promise<FileEntry[]> => {
    const updated = [...files]
    for (let i = 0; i < updated.length; i++) {
      const entry = updated[i]
      if (entry.status === 'done') continue
      updated[i] = { ...entry, status: 'uploading' }
      setFiles([...updated])

      try {
        const formData = new FormData()
        formData.append('file', entry.file)
        const res = await apiFetch('/api/v1/documents', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          updated[i] = {
            ...entry,
            status: 'error',
            errorMsg: (body as { error?: string }).error ?? `Upload failed (${res.status})`,
          }
        } else {
          const body = await res.json() as { data: { id: string; filename: string } }
          updated[i] = {
            ...entry,
            status: 'done',
            documentId: body.data.id,
            documentName: body.data.filename,
          }
        }
      } catch (err) {
        updated[i] = { ...entry, status: 'error', errorMsg: String(err) }
      }

      setFiles([...updated])
    }
    return updated
  }

  const handleRunAll = async () => {
    setLaunching(true)
    try {
      const uploaded = await uploadAll()
      const successful = uploaded.filter((f) => f.status === 'done' && f.documentId)
      if (successful.length === 0) {
        setLaunching(false)
        return
      }

      const res = await apiFetch('/api/v1/runs/batch', {
        method: 'POST',
        body: JSON.stringify({
          workflowId,
          documents: successful.map((f) => ({ id: f.documentId!, name: f.documentName })),
        }),
      })

      if (!res.ok) {
        console.error('[batch-run] failed:', res.status)
        setLaunching(false)
        return
      }

      const body = await res.json() as { data: { batchId: string } }
      onStarted(body.data.batchId, successful.length)
    } catch (err) {
      console.error('[batch-run] error:', err)
      setLaunching(false)
    }
  }

  const doneCount = files.filter((f) => f.status === 'done').length
  const pendingCount = files.filter((f) => f.status === 'pending').length
  const canRun = pendingCount > 0 || doneCount > 0
  const hasErrors = files.some((f) => f.status === 'error')

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icons.Layers className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Batch Run</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload multiple documents. Each will be processed as a separate run sharing a batch ID so you can track them together.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 transition-colors',
              dragging
                ? 'border-blue-500 bg-blue-50/60'
                : 'border-border hover:border-border/80 hover:bg-muted/10',
            )}
          >
            <Icons.Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Drop files here or <span className="text-blue-600 underline">browse</span>
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              PDF, DOCX, TXT, MD, CSV, JSON, HTML
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.csv,.json,.html"
              onChange={handleFileInput}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {files.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  {/* Status icon */}
                  <span className="shrink-0">
                    {entry.status === 'pending' && <Icons.FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    {entry.status === 'uploading' && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
                    {entry.status === 'done' && <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                    {entry.status === 'error' && <Icons.XCircle className="h-3.5 w-3.5 text-red-600" />}
                  </span>

                  {/* Name */}
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                    {entry.file.name}
                  </span>

                  {/* Size */}
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {(entry.file.size / 1024).toFixed(0)} KB
                  </span>

                  {/* Error */}
                  {entry.status === 'error' && entry.errorMsg && (
                    <span className="shrink-0 text-[10px] text-red-600 max-w-[120px] truncate" title={entry.errorMsg}>
                      {entry.errorMsg}
                    </span>
                  )}

                  {/* Remove */}
                  {!launching && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <Icons.X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasErrors && (
            <p className="text-xs text-amber-600">
              Some files failed to upload. Successful uploads will still be run.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <span className="text-xs text-muted-foreground">
            {files.length === 0
              ? 'No files selected'
              : `${files.length} file${files.length !== 1 ? 's' : ''} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs" disabled={launching}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRunAll}
              disabled={!canRun || launching}
              className="h-8 text-xs"
            >
              {launching
                ? <><Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Running…</>
                : <><Icons.Layers className="mr-1.5 h-3.5 w-3.5" />Run All ({files.length})</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
