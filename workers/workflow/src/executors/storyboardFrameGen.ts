import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import { generateSingleImageUrl, type ImageGenerationConfig } from './imageGeneration.js'
import type { SceneObject } from './sceneParser.js'

export interface StoryboardFrameGenConfig {
  provider?: string
  quality?: 'draft' | 'standard' | 'high'
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3'
  framesPerScene?: 1 | 2 | 3 | 4
  clientName?: string
  verticalName?: string
  /** Skip API calls and return placeholder images (useful for layout testing) */
  useCachedImages?: boolean
}

export interface FramedScene {
  scene: SceneObject & { imagePrompt?: string }
  frameImageUrls: string[]
}

const MAX_CONCURRENT = 5

/** Runs at most `limit` promises concurrently */
async function pMap<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, limit: number): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function buildPrompt(scene: SceneObject & { imagePrompt?: string }, frameIndex: number, framesPerScene: number, clientName: string, verticalName: string): string {
  if (scene.imagePrompt) return scene.imagePrompt

  const frameDescriptions = scene.animationNotes.split(/[.\n]+/).map(s => s.trim()).filter(Boolean)
  const frameDesc = frameDescriptions[frameIndex] ?? frameDescriptions[0] ?? scene.animationNotes

  return [
    'Storyboard frame for a professional B2B video.',
    `Scene ${scene.sceneNumber}${framesPerScene > 1 ? `, frame ${frameIndex + 1} of ${framesPerScene}` : ''}: ${scene.sectionLabel}.`,
    `On-screen text concept: ${scene.onScreenText}.`,
    `Animation state: ${frameDesc}.`,
    'Style: cinematic still, professional B2B aesthetic, clean composition, no text overlays, no watermarks, soft lighting.',
    `Brand context: ${clientName} — ${verticalName}.`,
  ].join(' ')
}

/**
 * Storyboard Frame Generator — generates AI images for every scene.
 *
 * Supports all providers available in the standard Image Generation node
 * (gptimage2, gptimage15, gptimage1mini, dalle3, ideogram, fal).
 *
 * Input:  SceneObject[] (optionally with imagePrompt from StoryboardImagePromptBuilder)
 * Output: FramedScene[] — each scene paired with its generated frame data URLs
 */
export class StoryboardFrameGenExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const scenes = Array.isArray(input) ? input as (SceneObject & { imagePrompt?: string })[] : []
    if (scenes.length === 0) {
      throw new Error('StoryboardFrameGen: expected SceneObject[] from scene parser — got empty input.')
    }

    const cfg = config as StoryboardFrameGenConfig
    const provider       = cfg.provider      ?? 'gptimage2'
    const quality        = cfg.quality       ?? 'standard'
    const aspect_ratio   = cfg.aspect_ratio  ?? '16:9'
    const framesPerScene = cfg.framesPerScene ?? 1
    const clientName     = cfg.clientName    || 'Client'
    const verticalName   = cfg.verticalName  || 'Vertical'
    const useCachedImages = cfg.useCachedImages ?? false

    const imgCfg = {
      provider, quality, aspect_ratio, num_outputs: 1,
    } as Partial<ImageGenerationConfig> & { provider: string }

    console.log(`[storyboard-frame-gen] ${scenes.length} scenes × ${framesPerScene} frame(s), provider=${provider}, quality=${quality}`)

    interface FrameJob { scene: SceneObject & { imagePrompt?: string }; frameIndex: number; sceneIdx: number }
    const jobs: FrameJob[] = []
    for (let s = 0; s < scenes.length; s++) {
      for (let f = 0; f < framesPerScene; f++) {
        jobs.push({ scene: scenes[s], frameIndex: f, sceneIdx: s })
      }
    }

    const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    const frameResults = await pMap(jobs, async (job) => {
      if (useCachedImages) return PLACEHOLDER
      const prompt = buildPrompt(job.scene, job.frameIndex, framesPerScene, clientName, verticalName)
      console.log(`[storyboard-frame-gen] scene ${job.scene.sceneNumber} frame ${job.frameIndex + 1}/${framesPerScene}`)
      return generateSingleImageUrl(prompt, imgCfg)
    }, MAX_CONCURRENT)

    const framedScenes: FramedScene[] = scenes.map((scene, s) => ({
      scene,
      frameImageUrls: jobs
        .map((j, idx) => j.sceneIdx === s ? frameResults[idx] : null)
        .filter((u): u is string => u !== null),
    }))

    console.log(`[storyboard-frame-gen] done — ${framedScenes.length} scene(s)`)
    return { output: framedScenes }
  }
}
