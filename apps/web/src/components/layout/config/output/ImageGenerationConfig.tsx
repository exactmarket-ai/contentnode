import { useState } from 'react'
import * as Icons from 'lucide-react'  // Icons.Lock, Icons.Unlock still used
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FieldGroup } from '../shared'
import { AttachmentZone } from '../AttachmentZone'
import { MediaFilmstrip, type MediaAsset } from '../MediaFilmstrip'

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: 'dalle3',        label: 'DALL-E 3',       desc: 'OpenAI' },
  { value: 'ideogram',      label: 'Ideogram v2',    desc: 'Ideogram' },
  { value: 'fal',           label: 'Fal.ai',         desc: 'FLUX Dev' },
  { value: 'comfyui',       label: 'ComfyUI',        desc: 'Local' },
  { value: 'automatic1111', label: 'AUTOMATIC1111',  desc: 'Local' },
]

// Which settings each provider supports
const PROVIDER_SUPPORT: Record<string, {
  aspectRatio: boolean
  quality: boolean
  numOutputs: boolean
  cfgScale: boolean
  seed: boolean
  negativePrompt: boolean
  referenceImage: boolean
}> = {
  dalle3: {
    aspectRatio: true,
    quality: true,
    numOutputs: true,
    cfgScale: false,
    seed: false,
    negativePrompt: false,
    referenceImage: false,
  },
  ideogram: {
    aspectRatio: true,
    quality: true,
    numOutputs: true,
    cfgScale: false,
    seed: true,
    negativePrompt: true,
    referenceImage: false,
  },
  fal: {
    aspectRatio: true,
    quality: false,
    numOutputs: true,
    cfgScale: false,
    seed: true,
    negativePrompt: false,
    referenceImage: false,
  },
  comfyui: {
    aspectRatio: true,
    quality: true,
    numOutputs: true,
    cfgScale: true,
    seed: true,
    negativePrompt: true,
    referenceImage: false,
  },
  automatic1111: {
    aspectRatio: true,
    quality: true,
    numOutputs: true,
    cfgScale: true,
    seed: true,
    negativePrompt: true,
    referenceImage: true,
  },
}

const ASPECT_RATIOS = [
  { value: '1:1',  label: '1:1 — Square' },
  { value: '16:9', label: '16:9 — Landscape' },
  { value: '9:16', label: '9:16 — Portrait' },
  { value: '4:3',  label: '4:3 — Classic' },
]

const QUALITY_OPTIONS = [
  { value: 'draft',    label: 'Draft (fast)' },
  { value: 'standard', label: 'Standard' },
  { value: 'high',     label: 'High quality' },
]

// ─── Unsupported field tooltip ────────────────────────────────────────────────

function UnsupportedOverlay({ reason }: { label?: string; reason: string }) {
  return (
    <div className="pointer-events-none select-none rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground/50">
      {reason}
    </div>
  )
}

// ─── Main config panel ────────────────────────────────────────────────────────

export function ImageGenerationConfig({
  config,
  onChange,
  nodeRunStatus,
  nodeLabel = 'image-generation',
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
  nodeLabel?: string
}) {
  const provider = (config.provider as string) ?? 'dalle3'
  const support  = PROVIDER_SUPPORT[provider] ?? PROVIDER_SUPPORT.dalle3
  const [seedLocked, setSeedLocked] = useState((config.seed as number | null) != null)

  // Extract generated assets from run output OR stored config assets
  const runOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const assets = (runOutput?.assets as MediaAsset[] | undefined)
    ?? (config.stored_assets as MediaAsset[] | undefined)
    ?? []
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const isSkipped  = nodeRunStatus?.status === 'skipped'
  const isLocked   = config.locked === true
  const hasAssets  = ((config.stored_assets as unknown[]) ?? []).length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* Skip toggle */}
      <div
        className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${isLocked ? 'border-amber-400/60 bg-amber-950/20' : 'border-border bg-muted/20'}`}
      >
        <div className="flex items-center gap-2">
          <Icons.Lock className={`h-3.5 w-3.5 ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-xs font-medium">Skip on next run</p>
            <p className="text-[10px] text-muted-foreground">
              {isLocked
                ? hasAssets ? 'Cached output will be passed downstream — no API call' : 'Run once to generate, then subsequent runs will skip'
                : 'Node will regenerate on every run'}
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

      {/* Post-run filmstrip (shared component) */}
      {(hasPassed || isSkipped) && assets.length > 0 && (
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
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label}
                <span className="ml-1 text-muted-foreground">· {p.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Aspect ratio */}
      {support.aspectRatio ? (
        <FieldGroup label="Aspect Ratio">
          <Select
            value={(config.aspect_ratio as string) ?? '1:1'}
            onValueChange={(v) => onChange('aspect_ratio', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASPECT_RATIOS.map((r) => (
                <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Aspect Ratio">
          <UnsupportedOverlay label="Not supported by this provider" reason="N/A for this provider" />
        </FieldGroup>
      )}

      {/* Quality */}
      {support.quality ? (
        <FieldGroup label="Quality">
          <Select
            value={(config.quality as string) ?? 'standard'}
            onValueChange={(v) => onChange('quality', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUALITY_OPTIONS.map((q) => (
                <SelectItem key={q.value} value={q.value} className="text-xs">{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>
      ) : (
        <FieldGroup label="Quality">
          <UnsupportedOverlay label="Not configurable for Fal.ai" reason="N/A for this provider" />
        </FieldGroup>
      )}

      {/* Ideogram style type */}
      {provider === 'ideogram' && (
        <FieldGroup label="Style">
          <Select
            value={(config.style_type as string) ?? 'AUTO'}
            onValueChange={(v) => onChange('style_type', v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[
                { value: 'AUTO',      label: 'Auto' },
                { value: 'GENERAL',   label: 'General' },
                { value: 'REALISTIC', label: 'Realistic' },
                { value: 'DESIGN',    label: 'Design' },
                { value: 'RENDER_3D', label: '3D Render' },
                { value: 'ANIME',     label: 'Anime' },
              ].map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>
      )}

      {/* Number of outputs */}
      <FieldGroup label="Number of Images">
        <Input
          type="number"
          min={1}
          max={4}
          className="h-8 text-xs"
          value={(config.num_outputs as number) ?? 1}
          onChange={(e) => onChange('num_outputs', Math.max(1, Math.min(4, Number(e.target.value))))}
        />
      </FieldGroup>

      {/* CFG scale */}
      {support.cfgScale ? (
        <FieldGroup label={`CFG Scale: ${config.cfg_scale ?? 7}`}>
          <input
            type="range" min={1} max={20} step={0.5}
            className="w-full accent-foreground"
            value={(config.cfg_scale as number) ?? 7}
            onChange={(e) => onChange('cfg_scale', Number(e.target.value))}
          />
        </FieldGroup>
      ) : (
        <FieldGroup label="CFG Scale">
          <UnsupportedOverlay label="Not configurable" reason="N/A for this provider" />
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
                'shrink-0 rounded-md border px-2 transition-colors text-xs',
                seedLocked
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-transparent text-muted-foreground hover:border-foreground',
              )}
              title={seedLocked ? 'Unlock seed (random each run)' : 'Lock seed (reproducible)'}
            >
              {seedLocked ? <Icons.Lock className="h-3 w-3" /> : <Icons.Unlock className="h-3 w-3" />}
            </button>
          </div>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {seedLocked ? 'Fixed seed — same prompt produces same image' : 'Random seed each run'}
          </p>
        </FieldGroup>
      ) : (
        <FieldGroup label="Seed">
          <UnsupportedOverlay label="Not supported by DALL-E 3" reason="N/A for this provider" />
        </FieldGroup>
      )}

      {/* Negative prompt */}
      {support.negativePrompt ? (
        <FieldGroup label="Negative Prompt">
          <Textarea
            className="min-h-[60px] text-xs resize-none"
            placeholder="e.g. blurry, watermark, text, low quality, distorted…"
            value={(config.negative_prompt as string) ?? ''}
            onChange={(e) => onChange('negative_prompt', e.target.value)}
          />
        </FieldGroup>
      ) : (
        <FieldGroup label="Negative Prompt">
          <UnsupportedOverlay label="Not supported by this provider" reason="Use the Image Prompt Builder to add negative guidance" />
        </FieldGroup>
      )}

      {/* Reference image (img2img) — shared AttachmentZone */}
      {support.referenceImage && (
        <FieldGroup label="Reference Image (optional)">
          <AttachmentZone
            value={(config.reference_image as string) ?? ''}
            onChange={(v) => onChange('reference_image', v)}
            accept="image/*"
            label="Drop reference image or click to browse"
            hint="Used for image-to-image generation (AUTOMATIC1111)"
          />
        </FieldGroup>
      )}

      {/* Local provider notes */}
      {(provider === 'comfyui' || provider === 'automatic1111') && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
          <strong>{provider === 'comfyui' ? 'ComfyUI' : 'AUTOMATIC1111'}</strong> must be running
          locally. Set <code className="font-mono">
            {provider === 'comfyui' ? 'COMFYUI_BASE_URL' : 'A1111_BASE_URL'}
          </code> in your worker .env if not using the default port.
        </div>
      )}
    </div>
  )
}
