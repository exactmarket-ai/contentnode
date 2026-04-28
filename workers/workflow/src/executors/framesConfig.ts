import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'

export type FramesPerScene = 1 | 2 | 3 | 4

export interface FramesConfigOutput {
  scenes: SceneObject[]
  framesPerScene: FramesPerScene
}

/**
 * Frames Config node — attaches framesPerScene to the scene array.
 *
 * Set framesPerScene in the node config panel before running:
 *   1 = single representative image
 *   2 = before + after key moment
 *   3 = 3-step animation progression
 *   4 = 4-step full progression
 *
 * Defaults to 1 if not configured.
 */
export class FramesConfigExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const scenes = Array.isArray(input) ? (input as SceneObject[]) : []
    const framesPerScene = (config.framesPerScene as FramesPerScene) ?? 1

    if (scenes.length === 0) {
      throw new Error('Frames Config received no scene array. Connect the Scene Parser upstream.')
    }

    const output: FramesConfigOutput = { scenes, framesPerScene }
    console.log(`[framesConfig] ${scenes.length} scene(s) × ${framesPerScene} frame(s)`)
    return { output }
  }
}
