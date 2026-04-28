import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'

export interface StoryboardFrameGenConfig {
  framesPerScene?: 1 | 2 | 3 | 4
  clientName?: string
  verticalName?: string
}

export interface FramedScene {
  scene: SceneObject
  frameImageUrls: string[]
}

async function generateFrame(opts: {
  scene: SceneObject
  frameIndex: number
  framesPerScene: number
  clientName: string
  verticalName: string
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const { scene, frameIndex, framesPerScene, clientName, verticalName } = opts
  const frameDescriptions = scene.animationNotes
    .split(/[.\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const frameDesc = frameDescriptions[frameIndex] ?? frameDescriptions[0] ?? scene.animationNotes

  const prompt = [
    'Storyboard frame for a professional B2B video.',
    `Scene ${scene.sceneNumber}${framesPerScene > 1 ? `, frame ${frameIndex + 1} of ${framesPerScene}` : ''}: ${scene.sectionLabel}.`,
    `On-screen text concept: ${scene.onScreenText}.`,
    `Animation state: ${frameDesc}.`,
    'Style: cinematic still, professional B2B aesthetic, clean composition, no text overlays, no watermarks, soft lighting.',
    `Brand context: ${clientName} — ${verticalName}.`,
  ].join(' ')

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size: '1536x1024', quality: 'medium' }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GPT Image 2 error ${res.status}: ${err}`)
  }
  const data = await res.json() as { data: { b64_json: string }[] }
  return `data:image/png;base64,${data.data[0].b64_json}`
}

/**
 * Storyboard Frame Generator — generates AI images for every scene.
 *
 * Input:  SceneObject[]  (from scene-parser)
 * Output: FramedScene[]  — each scene paired with its generated frame URLs
 */
export class StoryboardFrameGenExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const scenes = Array.isArray(input) ? input as SceneObject[] : []
    if (scenes.length === 0) {
      throw new Error('StoryboardFrameGen: expected SceneObject[] from Scene Parser — got empty input.')
    }

    const cfg = config as StoryboardFrameGenConfig
    const framesPerScene = cfg.framesPerScene ?? 1
    const clientName     = cfg.clientName    || 'Client'
    const verticalName   = cfg.verticalName  || 'Vertical'

    const versionAScenes = scenes.filter(s => s.version === 'A')
    if (versionAScenes.length === 0) {
      throw new Error('StoryboardFrameGen: no Version A scenes found — only Version A is used for storyboards.')
    }

    console.log(`[storyboard-frame-gen] generating ${framesPerScene} frame(s) for ${versionAScenes.length} scenes`)

    const framedScenes: FramedScene[] = []
    for (const scene of versionAScenes) {
      const frameImageUrls: string[] = []
      for (let f = 0; f < framesPerScene; f++) {
        console.log(`[storyboard-frame-gen] scene ${scene.sceneNumber} frame ${f + 1}/${framesPerScene}`)
        const url = await generateFrame({ scene, frameIndex: f, framesPerScene, clientName, verticalName })
        frameImageUrls.push(url)
      }
      framedScenes.push({ scene, frameImageUrls })
    }

    console.log(`[storyboard-frame-gen] done — ${framedScenes.length} scene(s) with images`)
    return { output: framedScenes }
  }
}
