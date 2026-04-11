// ─── Node Card Color System ────────────────────────────────────────────────────
// Implements the ContentNodeAI card spec exactly.
// Each node subtype maps to one of 5 types: prompt | input | ai-model | transform | eval

export type NodeSpecType = 'prompt' | 'input' | 'ai-model' | 'transform' | 'eval' | 'generate'

export interface NodeSpec {
  accent: string
  headerBg: string
  headerBorder: string
  headerBgHover: string
  activeRing: string
  activeTextColor: string
  badgeBg: string
  badgeText: string
  label: string
}

export const NODE_SPEC: Record<NodeSpecType, NodeSpec> = {
  prompt: {
    accent:         '#a200ee',
    headerBg:       '#fdf5ff',
    headerBorder:   '#f0e0ff',
    headerBgHover:  '#f9ecff',
    activeRing:     'rgba(162,0,238,0.12)',
    activeTextColor:'#ffffff',
    badgeBg:        '#f5e6ff',
    badgeText:      '#7a00b4',
    label:          'Prompt',
  },
  input: {
    accent:         '#185fa5',
    headerBg:       '#f0f6fd',
    headerBorder:   '#b8d8f5',
    headerBgHover:  '#dceefa',
    activeRing:     'rgba(24,95,165,0.12)',
    activeTextColor:'#e6f1fb',
    badgeBg:        '#e6f1fb',
    badgeText:      '#0c447c',
    label:          'Input',
  },
  'ai-model': {
    accent:         '#ffbc44',
    headerBg:       '#fffbf0',
    headerBorder:   '#ffe8a0',
    headerBgHover:  '#fff5d6',
    activeRing:     'rgba(255,188,68,0.15)',
    activeTextColor:'#4a3200',
    badgeBg:        '#fff8e6',
    badgeText:      '#7a5200',
    label:          'AI Model',
  },
  transform: {
    accent:         '#3b6d11',
    headerBg:       '#f4f9ee',
    headerBorder:   '#d0e8b0',
    headerBgHover:  '#eaf3de',
    activeRing:     'rgba(59,109,17,0.12)',
    activeTextColor:'#eaf3de',
    badgeBg:        '#eaf3de',
    badgeText:      '#27500a',
    label:          'Transform',
  },
  generate: {
    accent:         '#d4500a',
    headerBg:       '#fff7f2',
    headerBorder:   '#ffd4b8',
    headerBgHover:  '#ffeedd',
    activeRing:     'rgba(212,80,10,0.12)',
    activeTextColor:'#ffffff',
    badgeBg:        '#ffeedd',
    badgeText:      '#a03200',
    label:          'Generate',
  },
  eval: {
    accent:         '#888780',
    headerBg:       '#fafaf7',
    headerBorder:   '#e8e6e0',
    headerBgHover:  '#f0ede8',
    activeRing:     'rgba(136,135,128,0.12)',
    activeTextColor:'#f0ede8',
    badgeBg:        '#f0ede8',
    badgeText:      '#5f5e5a',
    label:          'Eval',
  },
}

/** Map our node type + subtype to a spec type */
export function getNodeSpec(type: string, subtype?: string): NodeSpec {
  let specType: NodeSpecType = 'eval'

  if (type === 'source' || type === 'gtm_framework' || type === 'brand_context') {
    specType = 'input'
  } else if (type === 'logic') {
    specType = 'ai-model' // all logic nodes are orange
  } else if (type === 'insight') {
    specType = 'ai-model'
  } else {
    specType = 'transform' // output nodes are green
  }

  return NODE_SPEC[specType]
}
