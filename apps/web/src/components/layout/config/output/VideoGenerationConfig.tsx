import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { FieldGroup } from '../shared'
import { AttachmentZone } from '../AttachmentZone'
import { MediaFilmstrip, type MediaAsset } from '../MediaFilmstrip'

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: 'runway',            label: 'Runway Gen-3 Alpha',        env: 'RUNWAY_API_KEY' },
  { value: 'kling',             label: 'Kling AI',                  env: 'KLING_ACCESS_KEY_ID + KLING_ACCESS_KEY_SECRET' },
  { value: 'luma',              label: 'Luma Dream Machine',         env: 'LUMAAI_API_KEY' },
  { value: 'pika',              label: 'Pika Labs',                  env: 'PIKA_API_KEY' },
  { value: 'stability',         label: 'Stability AI (SVD)',         env: 'STABILITY_API_KEY' },
  { value: 'veo2',              label: 'Google Veo 2 (Vertex AI)',   env: 'VERTEX_PROJECT_ID + GOOGLE_BEARER_TOKEN' },
  { value: 'comfyui-animatediff', label: 'ComfyUI + AnimateDiff',   env: 'COMFYUI_BASE_URL (local)' },
  { value: 'cogvideox',         label: 'CogVideoX',                  env: 'COGVIDEOX_BASE_URL (local)' },
  { value: 'wan21',             label: 'Wan2.1',                     env: 'WAN_BASE_URL (local)' },
]

// Per-provider capability map
const SUPPORT: Record<string, {
  duration: boolean
  resolution: boolean
  fps: boolean
  cameraMotion: boolean
  motionIntensity: boolean
  seed: boolean
  endFrame: boolean
  imageToVideo: boolean
  maxDuration: number
}> = {
  runway:              { duration: true, resolution: true,  fps: false, cameraMotion: true,  motionIntensity: true,  seed: true,  endFrame: false, imageToVideo: true,  maxDuration: 10 },
  kling:               { duration: true, resolution: true,  fps: false, cameraMotion: true,  motionIntensity: true,  seed: true,  endFrame: true,  imageToVideo: true,  maxDuration: 10 },
  luma:                { duration: false, resolution: false, fps: false, cameraMotion: false, motionIntensity: false, seed: false, endFrame: true,  imageToVideo: true,  maxDuration: 5 },
  pika:                { duration: true,  resolution: true,  fps: true,  cameraMotion: true,  motionIntensity: true,  seed: true,  endFrame: false, imageToVideo: true,  maxDuration: 5 },
  stability:           { duration: false, resolution: false, fps: false, cameraMotion: false, motionIntensity: true,  seed: true,  endFrame: false, imageToVideo: true,  maxDuration: 4 },
  veo2:                { duration: true,  resolution: true,  fps: false, cameraMotion: false, motionIntensity: false, seed: false, endFrame: false, imageToVideo: true,  maxDuration: 8 },
  'comfyui-animatediff': { duration: true, resolution: true, fps: true, cameraMotion: true,  motionIntensity: true,  seed: true,  endFrame: false, imageToVideo: false, maxDuration: 30 },
  cogvideox:           { duration: false, resolution: false, fps: false, cameraMotion: false, motionIntensity: false, seed: true,  endFrame: false, imageToVideo: false, maxDuration: 6 },
  wan21:               { duration: true,  resolution: true,  fps: false, cameraMotion: false, motionIntensity: false, seed: true,  endFrame: false, imageToVideo: false, maxDuration: 14 },
}

const CAMERA_MOTIONS = [
  { value: 'static',    label: 'Static' },
  { value: 'pan-left',  label: 'Pan left' },
  { value: 'pan-right', label: 'Pan right' },
  { value: 'zoom-in',   label: 'Zoom in' },
  { value: 'zoom-out',  label: 'Zoom out' },
  { value: 'dolly',     label: 'Dolly' },
  { value: 'orbit',     label: 'Orbit' },
]

// ─── Greyed-out unsupported field ─────────────────────────────────────────────

function Unsupported({ reason }: { reason: string }) {
  return (
    <div className="relative" title={reason}>
      <div className="pointer-events-none select-none rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground/50">
        Not supported
      </div>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/40">
        N/A
      </span>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function VideoGenerationConfig({
  config,
  onChange,
  nodeRunStatus,
  nodeLabel = 'video-generation',
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
  nodeLabel?: string
}) {
  const provider = (config.provider as string) ?? 'runway'
  const support  = SUPPORT[provider] ?? SUPPORT.runway
  const [seedLocked, setSeedLocked] = useState((config.seed as number | null) != null)

  // Post-run assets
  const runOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const assets = (runOutput?.assets as MediaAsset[] | undefined) ?? []
  const hasPassed = nodeRunStatus?.status === 'passed'

  const providerMeta = PROVIDERS.find((p) => p.value === provider)
  const isLocal = ['comfyui-animatediff', 'cogvideox', 'wan21'].includes(provider)
  const isStabilityOnly = provider === 'stability' // SVD is img-only

  return (
    <div className="flex flex-col gap-4">
      {/* Post-run filmstrip */}
      {hasPassed && assets.length > 0 && (
        <>
          <MediaFilmstrip assets={assets} nodeLabel={nodeLabel} thumbnailHeight={140} />
          <Separator />
        </>
      )}

      {/* Provider */}
      <FieldGroup label="Provider">
        <Select value={provider} onValueChange={(v) => onChange('provider', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {providerMeta && (
          <p className="text-[9px] text-muted-foreground/60">
            Requires: <code className="font-mono">{providerMeta.env}</code>
          </p>
        )}
      </FieldGroup>

      {/* Duration */}
      {support.duration ? (
        <FieldGroup label={`Duration (seconds, max ${support.maxDuration})`}>
          <Input
            type="number"
            min={3}
            max={support.maxDuration}
            className="h-8 text-xs"
            value={(config.duration_seconds as number) ?? 5}
            onChange={(e) => onChange('duration_seconds', Math.max(1, Math.min(support.maxDuration, Number(e.target.value))))}
          />
        </FieldGroup>
      ) : (
        <FieldGroup label="Duration">
          <Unsupported reason="Duration is fixed for this provider" />
        </FieldGroup>
      )}

      {/* Resolution */}
      {support.resolution ? (
        <FieldGroup label="Resolution">
          <Select
            value={(config.resolution as string) ?? '720p'}
            onValueChange={(v) => onChange('resolution', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p" className="text-xs">720p</SelectItem>
              <SelectItem value="1080p" className="text-xs">1080p</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Resolution">
          <Unsupported reason="Resolution is fixed for this provider" />
        </FieldGroup>
      )}

      {/* FPS */}
      {support.fps ? (
        <FieldGroup label="Frame Rate">
          <Select
            value={String((config.fps as number) ?? 24)}
            onValueChange={(v) => onChange('fps', Number(v))}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24" className="text-xs">24 fps</SelectItem>
              <SelectItem value="30" className="text-xs">30 fps</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Frame Rate">
          <Unsupported reason="Frame rate is fixed for this provider" />
        </FieldGroup>
      )}

      {/* Camera motion */}
      {support.cameraMotion ? (
        <FieldGroup label="Camera Motion">
          <Select
            value={(config.camera_motion as string) ?? 'static'}
            onValueChange={(v) => onChange('camera_motion', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAMERA_MOTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Camera Motion">
          <Unsupported reason="Camera motion presets are not supported by this provider" />
        </FieldGroup>
      )}

      {/* Motion intensity */}
      {support.motionIntensity ? (
        <FieldGroup label="Motion Intensity">
          <Select
            value={(config.motion_intensity as string) ?? 'medium'}
            onValueChange={(v) => onChange('motion_intensity', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low"    className="text-xs">Low</SelectItem>
              <SelectItem value="medium" className="text-xs">Medium</SelectItem>
              <SelectItem value="high"   className="text-xs">High</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Motion Intensity">
          <Unsupported reason="Motion intensity is not configurable for this provider" />
        </FieldGroup>
      )}

      {/* Seed */}
      {support.seed ? (
        <FieldGroup label="Seed">
          <div className="flex gap-1.5">
            <Input
              type="number"
              className="h-8 text-xs"
              placeholder="Random"
              disabled={!seedLocked}
              value={seedLocked ? ((config.seed as number) ?? '') : ''}
              onChange={(e) => onChange('seed', e.target.value ? Number(e.target.value) : null)}
            />
            <button
              onClick={() => {
                const next = !seedLocked
                setSeedLocked(next)
                if (!next) onChange('seed', null)
              }}
              className={cn(
                'shrink-0 rounded-md border px-2 transition-colors',
                seedLocked
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-transparent text-muted-foreground hover:border-foreground',
              )}
              title={seedLocked ? 'Unlock seed (random)' : 'Lock seed (reproducible)'}
            >
              {seedLocked ? <Icons.Lock className="h-3 w-3" /> : <Icons.Unlock className="h-3 w-3" />}
            </button>
          </div>
        </FieldGroup>
      ) : (
        <FieldGroup label="Seed">
          <Unsupported reason="Seed is not supported by this provider" />
        </FieldGroup>
      )}

      {/* Start frame attachment */}
      <FieldGroup
        label={isStabilityOnly ? 'Reference Image (required for SVD)' : 'Start Frame (optional)'}
      >
        <AttachmentZone
          value={(config.start_frame as string) ?? ''}
          onChange={(v) => onChange('start_frame', v)}
          accept="image/*"
          label="Drop start frame image or click to browse"
          hint="Overridden at runtime if an Image Generation node is connected"
        />
      </FieldGroup>

      {/* End frame attachment — always in DOM, visibility hidden when unsupported */}
      <div style={{ visibility: support.endFrame ? 'visible' : 'hidden', height: support.endFrame ? 'auto' : 0, overflow: 'hidden' }}>
        <FieldGroup label="End Frame (optional)">
          <AttachmentZone
            value={(config.end_frame as string) ?? ''}
            onChange={(v) => onChange('end_frame', v)}
            accept="image/*"
            label="Drop end frame image or click to browse"
            hint="Supported by Kling AI and Luma Dream Machine"
          />
        </FieldGroup>
      </div>

      {/* Local provider note */}
      {isLocal && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
          <strong>{providerMeta?.label}</strong> must be running locally.
          Set <code className="font-mono">{providerMeta?.env.split(' ')[0]}</code> in your worker .env.
          A compatible REST API wrapper is required — see docs/offline-local-worker.md.
        </div>
      )}

      {/* Veo 2 note */}
      {provider === 'veo2' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
          Requires <code className="font-mono">VERTEX_PROJECT_ID</code> and <code className="font-mono">GOOGLE_BEARER_TOKEN</code>.
          Obtain the bearer token with: <code className="font-mono">gcloud auth print-access-token</code>
        </div>
      )}
    </div>
  )
}
