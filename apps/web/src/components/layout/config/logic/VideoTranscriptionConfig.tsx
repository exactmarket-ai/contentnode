import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PROVIDERS = [
  { value: 'assemblyai',     label: 'AssemblyAI',       keyVar: 'ASSEMBLYAI_API_KEY' },
  { value: 'openai-whisper', label: 'OpenAI Whisper',   keyVar: 'OPENAI_API_KEY' },
  { value: 'mock',           label: 'Mock (dev only)',   keyVar: '' },
]

export function VideoTranscriptionConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const provider  = (config.provider    as string) ?? 'assemblyai'
  const apiKeyRef = (config.api_key_ref as string) ?? 'ASSEMBLYAI_API_KEY'

  const currentProvider = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0]

  const handleProviderChange = (val: string) => {
    onChange('provider', val)
    const p = PROVIDERS.find((x) => x.value === val)
    if (p?.keyVar) onChange('api_key_ref', p.keyVar)
  }

  const transcriptOutput = nodeRunStatus?.status === 'passed' && nodeRunStatus.output
    ? (nodeRunStatus.output as Record<string, unknown>).text as string | undefined
    : null

  return (
    <>
      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
        <Icons.Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Receives a video from an upstream <strong>Video Upload</strong> node, extracts the audio,
          and returns a full text transcript. Connect this node's output to AI Generate nodes.
        </span>
      </div>

      {/* Provider */}
      <FieldGroup label="Transcription Provider">
        <div className="flex flex-col gap-1.5">
          {PROVIDERS.map((p) => (
            <label key={p.value} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="video-transcription-provider"
                value={p.value}
                checked={provider === p.value}
                onChange={() => handleProviderChange(p.value)}
                className="accent-blue-600"
              />
              <span className="text-xs font-medium">{p.label}</span>
            </label>
          ))}
        </div>
      </FieldGroup>

      {/* API key env var */}
      {currentProvider.keyVar !== '' && (
        <FieldGroup label="API Key Environment Variable">
          <Input
            value={apiKeyRef}
            onChange={(e) => onChange('api_key_ref', e.target.value)}
            placeholder={currentProvider.keyVar}
            className="h-8 font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Set this env var on the server — never paste the key here directly.
          </p>
        </FieldGroup>
      )}

      {/* Transcript preview after run */}
      {transcriptOutput && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <Label className="text-xs text-muted-foreground">Transcript</Label>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground/80 font-sans">
            {transcriptOutput}
          </pre>
        </div>
      )}
    </>
  )
}
