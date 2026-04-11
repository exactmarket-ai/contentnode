import { useCallback, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore } from '@/store/workflowStore'
import { FieldGroup, formatBytes, UploadedAudioFile, CONTENT_ROLES } from '../shared'

const AUDIO_ACCEPTED_EXTENSIONS = '.mp3,.wav,.m4a,.ogg,.flac,audio/*'
const AUDIO_FILE_SIZE_LIMIT_MB = 500

const TRANSCRIPTION_PROVIDERS = [
  { value: 'assemblyai',    label: 'AssemblyAI' },
  { value: 'deepgram',      label: 'Deepgram' },
  { value: 'local',         label: 'Local (mock)' },
  { value: 'openai-whisper', label: 'OpenAI Whisper' },
]

export function TranscriptionConfig({
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
      {/* Upstream connection note */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Icons.Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Connect a <strong>Video Upload</strong> or audio source to this node's left handle to transcribe it automatically.
          Or upload audio files directly below.
        </span>
      </div>

      {/* Content role */}
      <FieldGroup label="Content Role">
        <Select value={(config.content_role as string) ?? 'source-material'} onValueChange={(v) => onChange('content_role', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Audio file upload */}
      <FieldGroup label="Audio Files">
        <div
          className={cn(
            'flex w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-blue-400 bg-blue-50 text-blue-600'
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
          <div className="w-full min-w-0">
            <p className="text-xs font-medium">
              {uploading ? 'Uploading…' : 'Drop audio files or click to browse'}
            </p>
            <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
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
        <div className="w-full space-y-1">
          {audioFiles.map((f) => (
            <div
              key={f.id}
              className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <Icons.Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 break-all text-xs">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
              {!f.uploaded && (
                <span title="Not synced to server">
                  <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                </span>
              )}
              <button onClick={() => removeAudio(f.id)} className="shrink-0 text-muted-foreground hover:text-destructive" title="Remove file">
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Provider */}
      <FieldGroup label="Transcription Provider">
        <select
          value={provider}
          onChange={(e) => { onChange('provider', e.target.value); onChange('api_key_ref', '') }}
          className="h-8 w-full rounded-md border border-input bg-white px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {TRANSCRIPTION_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
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
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
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
