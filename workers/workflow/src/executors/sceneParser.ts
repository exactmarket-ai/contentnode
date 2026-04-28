import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

export interface SceneObject {
  sceneNumber: number
  timecode: string
  onScreenText: string
  voiceover: string
  animationNotes: string
  sectionLabel: string
  version: 'A' | 'B'
}

// Map common scene positions to readable labels
const SCENE_LABELS: Record<number, string> = {
  1: 'The Hook',
  2: 'Problem Statement',
  3: 'Key Stat',
  4: 'Product Intro',
  5: 'Solution Overview',
  6: 'Feature Highlight',
  7: 'Integration Point',
  8: 'Social Proof',
  9: 'Case Study',
  10: 'Proof Point',
  11: 'Differentiator',
  12: 'Urgency',
  13: 'Final CTA',
  14: 'Close',
}

function sceneLabel(sceneNum: number, isLast: boolean): string {
  if (isLast) return 'CTA'
  return SCENE_LABELS[sceneNum] ?? `Scene ${sceneNum}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses a markdown pipe-table row into cells, handling escaped pipes and
 * trimming whitespace.
 */
function parseTableRow(line: string): string[] {
  // Remove leading/trailing pipes, split on |
  const inner = line.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim())
}

/**
 * Extract storyboard scenes from a markdown/HTML video script.
 *
 * Handles two table header formats:
 *   | Scene | Time | On-Screen Text | Voiceover | Imagery Suggestion |
 *   | Scene/Time | On-Screen Text | Imagery Suggestion |   (legacy 3-col)
 *
 * Returns one SceneObject per data row across all storyboard sections.
 */
function parseScenes(raw: string): SceneObject[] {
  // Strip HTML if the content is HTML
  const isHtml = raw.trimStart().startsWith('<')
  const text = isHtml ? stripHtml(raw) : raw

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const scenes: SceneObject[] = []

  let inStoryboard = false
  let currentVersion: 'A' | 'B' = 'A'
  let headerCols: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect which storyboard version we're in
    if (/version\s*a\b/i.test(line) || /60.second\s+storyboard/i.test(line)) {
      currentVersion = 'A'
      inStoryboard = true
      headerCols = []
      continue
    }
    if (/version\s*b\b/i.test(line) || /90.second\s+storyboard/i.test(line)) {
      currentVersion = 'B'
      inStoryboard = true
      headerCols = []
      continue
    }

    // Exit storyboard on a non-table heading line (##) that isn't inside a table
    if (line.startsWith('##') && !line.startsWith('|')) {
      inStoryboard = false
      headerCols = []
      continue
    }

    if (!line.startsWith('|')) continue

    // Separator row — skip
    if (isSeparatorRow(line)) continue

    const cells = parseTableRow(line)
    if (!cells.length) continue

    // Try to detect table header row
    const firstCell = cells[0].toLowerCase()
    if (firstCell.includes('scene') || firstCell.includes('time')) {
      headerCols = cells.map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
      inStoryboard = true
      continue
    }

    if (!inStoryboard || !headerCols.length) continue

    // Map columns to fields
    const get = (keys: string[]): string => {
      for (const key of keys) {
        const idx = headerCols.findIndex((h) => h.includes(key))
        if (idx >= 0 && cells[idx]) return cells[idx]
      }
      return ''
    }

    const rawScene = get(['scene'])
    const sceneNum = parseInt(rawScene.replace(/\D/g, ''), 10)
    if (isNaN(sceneNum)) continue

    const timecode   = get(['time'])
    const onScreen   = get(['on_screen', 'screen_text', 'screen'])
    const voiceover  = get(['voiceover', 'voice'])
    const imagery    = get(['imagery', 'animation', 'suggestion', 'notes'])

    scenes.push({
      sceneNumber:   sceneNum,
      timecode,
      onScreenText:  onScreen,
      voiceover,
      animationNotes: imagery,
      sectionLabel:  '',   // filled in after we know the last scene
      version:       currentVersion,
    })
  }

  // Assign section labels now that we know total count per version
  const versionLastMap: Record<string, number> = {}
  for (const s of scenes) {
    versionLastMap[s.version] = Math.max(versionLastMap[s.version] ?? 0, s.sceneNumber)
  }
  for (const s of scenes) {
    s.sectionLabel = sceneLabel(s.sceneNumber, s.sceneNumber === versionLastMap[s.version])
  }

  return scenes
}

export class SceneParserExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    _config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const raw = typeof input === 'string' ? input : JSON.stringify(input)
    const scenes = parseScenes(raw)

    if (scenes.length === 0) {
      throw new Error(
        'Scene parser found no storyboard scenes. Make sure the input is a video script with a markdown pipe-table storyboard (## Version A or ## Version B heading + | Scene | Time | ... rows).',
      )
    }

    console.log(`[sceneParser] parsed ${scenes.length} scene(s) across versions A/B`)
    return { output: scenes }
  }
}

// Export parser for direct testing
export { parseScenes }
