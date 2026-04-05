import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow'
import type { Node, Edge, NodeChange, EdgeChange, Connection, Viewport } from 'reactflow'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectivityMode = 'online' | 'offline'
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface ModelConfig {
  provider: 'anthropic' | 'ollama'
  model: string
  temperature?: number
  max_tokens?: number
}

export interface WorkflowMeta {
  id: string | null
  name: string
  /** Locked after first run — never change after that */
  connectivity_mode: ConnectivityMode
  default_model_config: ModelConfig
}

export interface NodeRunStatus {
  status: 'idle' | 'running' | 'passed' | 'failed'
  output?: unknown
  error?: string
  tokensUsed?: number
  modelUsed?: string
}

// ─── Node palette definition (used by NodePalette + node factories) ───────────

export type NodeCategory = 'source' | 'logic' | 'output'

export interface PaletteNodeDef {
  type: string         // matches executor registry key prefix
  subtype: string      // specific node variant, stored in node.data.subtype
  label: string
  description: string
  category: NodeCategory
  icon: string         // lucide icon name
  defaultConfig: Record<string, unknown>
}

export const PALETTE_NODES: PaletteNodeDef[] = [
  // Source
  {
    type: 'source', subtype: 'text-input',
    label: 'Text Input', description: 'Static text or template literal',
    category: 'source', icon: 'Type',
    defaultConfig: { text: '' },
  },
  {
    type: 'source', subtype: 'file-upload',
    label: 'File Upload', description: 'Upload a document or image',
    category: 'source', icon: 'Upload',
    defaultConfig: { accept: '*', maxSizeMb: 10 },
  },
  {
    type: 'source', subtype: 'api-fetch',
    label: 'API Fetch', description: 'Fetch data from an HTTP endpoint',
    category: 'source', icon: 'Globe',
    defaultConfig: { url: '', method: 'GET', headers: {} },
  },
  {
    type: 'source', subtype: 'web-scrape',
    label: 'Web Scrape', description: 'Scrape content from a webpage',
    category: 'source', icon: 'Scan',
    defaultConfig: { url: '', selector: '' },
  },
  // Logic
  {
    type: 'logic', subtype: 'ai-generate',
    label: 'AI Generate', description: 'Generate content with an AI model',
    category: 'logic', icon: 'Sparkles',
    defaultConfig: { prompt: '', model_config: null },
  },
  {
    type: 'logic', subtype: 'transform',
    label: 'Transform', description: 'Reshape or extract data with JavaScript',
    category: 'logic', icon: 'Wand2',
    defaultConfig: { expression: 'return input' },
  },
  {
    type: 'logic', subtype: 'condition',
    label: 'Condition', description: 'Branch on a boolean expression',
    category: 'logic', icon: 'GitBranch',
    defaultConfig: { expression: 'return true' },
  },
  {
    type: 'logic', subtype: 'merge',
    label: 'Merge', description: 'Combine multiple inputs into one',
    category: 'logic', icon: 'Merge',
    defaultConfig: { strategy: 'concat' },
  },
  {
    type: 'logic', subtype: 'human-review',
    label: 'Human Review', description: 'Pause for human approval before continuing',
    category: 'logic', icon: 'UserCheck',
    defaultConfig: { instructions: '', assignee_email: '' },
  },
  // Output
  {
    type: 'output', subtype: 'webhook',
    label: 'Webhook', description: 'POST result to an external URL',
    category: 'output', icon: 'Send',
    defaultConfig: { url: '', headers: {} },
  },
  {
    type: 'output', subtype: 'email',
    label: 'Email', description: 'Send result via email',
    category: 'output', icon: 'Mail',
    defaultConfig: { to: '', subject: '' },
  },
  {
    type: 'output', subtype: 'file-export',
    label: 'File Export', description: 'Export result as a downloadable file',
    category: 'output', icon: 'Download',
    defaultConfig: { format: 'txt', filename: 'output' },
  },
  {
    type: 'output', subtype: 'display',
    label: 'Display', description: 'Show result in the run panel',
    category: 'output', icon: 'Monitor',
    defaultConfig: {},
  },
]

// ─── Store ────────────────────────────────────────────────────────────────────

interface WorkflowState {
  // Graph
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport

  // Metadata
  workflow: WorkflowMeta

  // UI
  selectedNodeId: string | null
  runStatus: RunStatus
  nodeRunStatuses: Record<string, NodeRunStatus>

  // Actions — graph
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  setViewport: (viewport: Viewport) => void
  addNode: (node: Node) => void
  updateNodeData: (id: string, data: Partial<Record<string, unknown>>) => void

  // Actions — UI
  setSelectedNodeId: (id: string | null) => void
  setRunStatus: (status: RunStatus) => void
  setNodeRunStatuses: (statuses: Record<string, NodeRunStatus>) => void

  // Actions — metadata
  setWorkflowName: (name: string) => void
  setWorkflow: (meta: Partial<WorkflowMeta>) => void
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },

  workflow: {
    id: null,
    name: 'Untitled Workflow',
    connectivity_mode: 'online',
    default_model_config: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      temperature: 0.7,
    },
  },

  selectedNodeId: null,
  runStatus: 'idle',
  nodeRunStatuses: {},

  // Graph actions
  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set({ edges: addEdge({ ...connection, animated: false }, get().edges) }),

  setViewport: (viewport) => set({ viewport }),

  addNode: (node) => set({ nodes: [...get().nodes, node] }),

  updateNodeData: (id, data) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }),

  // UI actions
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setRunStatus: (status) => set({ runStatus: status }),

  setNodeRunStatuses: (statuses) => set({ nodeRunStatuses: statuses }),

  // Metadata actions
  setWorkflowName: (name) =>
    set({ workflow: { ...get().workflow, name } }),

  setWorkflow: (meta) =>
    set({ workflow: { ...get().workflow, ...meta } }),
}))
