import * as Icons from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { downloadAsset } from '@/lib/api'
import { AttachmentZone } from '../AttachmentZone'
import { assetUrl } from '@/lib/api'

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: 'did',       label: 'D-ID',       env: 'DID_API_KEY',     cloud: true  },
  { value: 'heygen',    label: 'HeyGen',      env: 'HEYGEN_API_KEY',  cloud: true  },
  { value: 'sadtalker', label: 'SadTalker',   env: 'SADTALKER_BASE_URL (local)', cloud: false },
]

// ─── Main panel ───────────────────────────────────────────────────────────────

export function CharacterAnimationConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const provider        = (config.provider as string)       ?? 'did'
  const characterImage  = (config.character_image as string) ?? ''
  const heygenAvatarId  = (config.heygen_avatar_id as string) ?? ''
  const sadtalkerUrl    = (config.sadtalker_base_url as string) ?? 'http://localhost:7860'
  const expressionScale = (config.expression_scale as number) ?? 1.0
  const stillMode       = (config.still_mode as boolean)    ?? false
  const isLocked        = (config.locked as boolean)        ?? false

  const runOutput    = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed    = nodeRunStatus?.status === 'passed'
  const videoPath    = runOutput?.localPath as string | undefined
  const fullVideoUrl = videoPath ? assetUrl(videoPath) : null

  const providerMeta = PROVIDERS.find(p => p.value === provider)

  return (
    <div className="flex flex-col gap-4">
      {/* Skip toggle */}
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${isLocked ? 'border-amber-400/60 bg-amber-950/20' : 'border-border bg-muted/20'}`}>
        <div className="flex items-center gap-2">
          <Icons.Lock className={`h-3.5 w-3.5 ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-xs font-medium">Skip on next run</p>
            <p className="text-[10px] text-muted-foreground">
              {isLocked ? 'Cached video will be passed downstream' : 'Node will re-animate on every run'}
            </p>
          </div>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isLocked ? 'bg-amber-500' : 'bg-input'}`}
          onClick={() => onChange('locked', !isLocked)}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${isLocked ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Post-run video */}
      {hasPassed && fullVideoUrl && (
        <>
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.VideoIcon className="h-3.5 w-3.5 text-violet-700" />
              <span className="text-xs font-medium text-violet-800">Animated video</span>
            </div>
            <video controls className="w-full rounded" style={{ maxHeight: 200 }}>
              <source src={fullVideoUrl} type="video/mp4" />
            </video>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]"
                onClick={() => downloadAsset(fullVideoUrl!, 'character-animation.mp4')}>
                <Icons.Download className="h-3 w-3" />
                Download
              </Button>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* How to connect */}
      <div className="rounded-md border border-violet-100 bg-violet-50/40 px-3 py-2 text-[10px] text-violet-800 space-y-1">
        <p className="font-medium">How to connect</p>
        <p>Connect <strong>Voice Output</strong> or <strong>Audio Mix → Audio</strong> handle. Optionally connect an <strong>Image Generation → Image</strong> handle to override the photo below.</p>
      </div>

      {/* Provider */}
      <FieldGroup label="Provider">
        <select
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={provider}
          onChange={e => onChange('provider', e.target.value)}
        >
          {PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {providerMeta && (
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
            {providerMeta.cloud ? 'Cloud API — ' : 'Local — '}
            requires: <code className="font-mono">{providerMeta.env}</code>
          </p>
        )}
      </FieldGroup>

      {/* Character photo — all providers */}
      <FieldGroup label="Character photo">
        <AttachmentZone
          value={characterImage}
          onChange={v => onChange('character_image', v)}
          accept="image/*"
          label="Drop photo or click to browse"
          hint="Portrait with visible face works best. Overridden by an upstream Image Generation node."
        />
      </FieldGroup>

      {/* HeyGen avatar ID */}
      {provider === 'heygen' && (
        <FieldGroup label="HeyGen Avatar ID">
          <Input
            className="h-8 text-xs font-mono"
            placeholder="e.g. Abigail_expressive_2024112501"
            value={heygenAvatarId}
            onChange={e => onChange('heygen_avatar_id', e.target.value)}
          />
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
            Find your avatar ID in the HeyGen dashboard under Avatars. If blank, the character photo is used as a talking photo.
          </p>
        </FieldGroup>
      )}

      {/* SadTalker local URL */}
      {provider === 'sadtalker' && (
        <FieldGroup label="SadTalker server URL">
          <Input
            className="h-8 text-xs font-mono"
            placeholder="http://localhost:7860"
            value={sadtalkerUrl}
            onChange={e => onChange('sadtalker_base_url', e.target.value)}
          />
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
            Run with: <code className="font-mono">python scripts/sadtalker_server.py</code>
          </p>
        </FieldGroup>
      )}

      {/* Expression scale — D-ID + SadTalker */}
      {provider !== 'heygen' && (
        <FieldGroup label={`Expression scale — ${expressionScale.toFixed(1)}×`}>
          <input type="range" min={0} max={2} step={0.1} value={expressionScale}
            onChange={e => onChange('expression_scale', parseFloat(e.target.value))}
            className="w-full accent-violet-600" />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>subtle</span><span>natural</span><span>exaggerated</span>
          </div>
        </FieldGroup>
      )}

      {/* Still mode — SadTalker only */}
      {provider === 'sadtalker' && (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-xs font-medium">Still mode</p>
            <p className="text-[10px] text-muted-foreground">
              Reduce head movement — only lips animate
            </p>
          </div>
          <button
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${stillMode ? 'bg-violet-600' : 'bg-input'}`}
            onClick={() => onChange('still_mode', !stillMode)}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${stillMode ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      {/* Env note */}
      {providerMeta?.cloud && (
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          <p className="font-medium mb-0.5">Worker environment variable</p>
          <p>Add <code className="font-mono">{providerMeta.env}=your_key</code> to <code className="font-mono">workers/workflow/.env</code></p>
        </div>
      )}
    </div>
  )
}
