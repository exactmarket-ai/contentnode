import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'

export interface StoryboardFrameGenConfig {
  framesPerScene?: 1 | 2 | 3 | 4
  clientName?: string
  verticalName?: string
  /** Skip image generation and return placeholder data URLs (useful for testing) */
  useCachedImages?: boolean
}

export interface FramedScene {
  scene: SceneObject & { imagePrompt?: string }
  frameImageUrls: string[]
}

const MAX_CONCURRENT = 5

async function generateFrame(opts: {
  scene: SceneObject & { imagePrompt?: string }
  frameIndex: number
  framesPerScene: number
  clientName: string
  verticalName: string
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const { scene, frameIndex, framesPerScene, clientName, verticalName } = opts

  // Use pre-built imagePrompt from the prompt builder node if available
  let prompt: string
  if (scene.imagePrompt) {
    prompt = scene.imagePrompt
  } else {
    const frameDescriptions = scene.animationNotes
      .split(/[.\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const frameDesc = frameDescriptions[frameIndex] ?? frameDescriptions[0] ?? scene.animationNotes

    prompt = [
      'Storyboard frame for a professional B2B video.',
      `Scene ${scene.sceneNumber}${framesPerScene > 1 ? `, frame ${frameIndex + 1} of ${framesPerScene}` : ''}: ${scene.sectionLabel}.`,
      `On-screen text concept: ${scene.onScreenText}.`,
      `Animation state: ${frameDesc}.`,
      'Style: cinematic still, professional B2B aesthetic, clean composition, no text overlays, no watermarks, soft lighting.',
      `Brand context: ${clientName} — ${verticalName}.`,
    ].join(' ')
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024', quality: 'medium' }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GPT Image error ${res.status}: ${err}`)
  }
  const data = await res.json() as { data: { b64_json: string }[] }
  return `data:image/png;base64,${data.data[0].b64_json}`
}

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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/**
 * Storyboard Frame Generator — generates AI images for every scene.
 *
 * Input:  SceneObject[] (optionally with imagePrompt field from StoryboardImagePromptBuilder)
 * Output: FramedScene[] — each scene paired with its generated frame URLs
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
    const framesPerScene  = cfg.framesPerScene  ?? 1
    const clientName      = cfg.clientName      || 'Client'
    const verticalName    = cfg.verticalName    || 'Vertical'
    const useCachedImages = cfg.useCachedImages ?? false

    console.log(`[storyboard-frame-gen] generating ${framesPerScene} frame(s) for ${scenes.length} scenes (parallel, max ${MAX_CONCURRENT})`)

    // Build flat list of all (scene, frameIndex) jobs
    interface FrameJob { scene: SceneObject & { imagePrompt?: string }; frameIndex: number; sceneIdx: number }
    const jobs: FrameJob[] = []
    for (let s = 0; s < scenes.length; s++) {
      for (let f = 0; f < framesPerScene; f++) {
        jobs.push({ scene: scenes[s], frameIndex: f, sceneIdx: s })
      }
    }

    // Placeholder for cache/test mode
    const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    const frameResults = await pMap(jobs, async (job) => {
      if (useCachedImages) {
        console.log(`[storyboard-frame-gen] scene ${job.scene.sceneNumber} frame ${job.frameIndex + 1} — cached placeholder`)
        return PLACEHOLDER
      }
      console.log(`[storyboard-frame-gen] scene ${job.scene.sceneNumber} frame ${job.frameIndex + 1}/${framesPerScene}`)
      return generateFrame({ scene: job.scene, frameIndex: job.frameIndex, framesPerScene, clientName, verticalName })
    }, MAX_CONCURRENT)

    // Reassemble per-scene
    const framedScenes: FramedScene[] = scenes.map((scene, s) => {
      const frameImageUrls = jobs
        .map((j, idx) => j.sceneIdx === s ? frameResults[idx] : null)
        .filter((u): u is string => u !== null)
      return { scene, frameImageUrls }
    })

    console.log(`[storyboard-frame-gen] done — ${framedScenes.length} scene(s) with images`)
    return { output: framedScenes }
  }
}
