import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow'
import type { Node, Edge, NodeChange, EdgeChange, Connection, Viewport } from 'reactflow'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectivityMode = 'online' | 'offline'
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_assignment'

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
  warning?: string
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
  // Detection-Humanization loop
  {
    type: 'logic', subtype: 'humanizer',
    label: 'Humanizer', description: 'Rewrite content to reduce AI detection score',
    category: 'logic', icon: 'PenLine',
    defaultConfig: {
      subtype: 'humanizer',
      mode: 'executive-natural',
      naturalness: 70,
      energy: 60,
      precision: 65,
      formality: 50,
      boldness: 55,
      compression: 40,
      personality: 60,
      safety: 80,
      model_config: null,
      targeted_rewrite: true,
    },
  },
  {
    type: 'logic', subtype: 'detection',
    label: 'Detection', description: 'Score content for AI detection likelihood',
    category: 'logic', icon: 'ScanSearch',
    defaultConfig: {
      subtype: 'detection',
      service: 'gptzero',
      threshold: 20,
      max_retries: 3,
      api_key_ref: '',
    },
  },
  {
    type: 'logic', subtype: 'conditional-branch',
    label: 'Conditional Branch', description: 'Route based on detection score, word count, or retry count',
    category: 'logic', icon: 'GitFork',
    defaultConfig: {
      subtype: 'conditional-branch',
      condition_type: 'detection_score',
      operator: 'above',
      value: 20,
      pass_label: 'pass',
      fail_label: 'fail',
      fallback_humanizer_id: '',
    },
  },
  // Output
  // Transcription (source type — produces transcript text from audio)
  {
    type: 'source', subtype: 'transcription',
    label: 'Transcription', description: 'Transcribe audio recordings with speaker diarization',
    category: 'source', icon: 'Mic',
    defaultConfig: {
      subtype: 'transcription',
      provider: 'deepgram',
      enable_diarization: true,
      max_speakers: null,
      target_node_ids: [],
      stakeholder_id: null,
      api_key_ref: 'DEEPGRAM_API_KEY',
      audio_files: [],
    },
  },
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
  {
    type: 'output', subtype: 'content-output',
    label: 'Content Output', description: 'Format and deliver generated content',
    category: 'output', icon: 'FileText',
    defaultConfig: { output_type: 'blog-post', min_words: 800, max_words: 1200, format_options: {} },
  },
  {
    type: 'output', subtype: 'client-feedback',
    label: 'Client Feedback', description: 'Request stakeholder feedback via secure portal or manual entry',
    category: 'output', icon: 'MessageSquare',
    defaultConfig: {
      subtype: 'client-feedback',
      source_type: 'portal',
      trigger_mode: 'auto',
      auto_trigger_on: ['needs_revision', 'rejected'],
      default_reentry_node_id: '',
      reentry_rules: [],
      max_auto_retries: 3,
      stakeholder_ids: [],
      manual_feedback: {
        decision: 'needs_revision',
        star_rating: 3,
        tone_feedback: '',
        content_tags: [],
        comment: '',
      },
    },
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
  /** True once the workflow has been run at least once — locks connectivity_mode */
  hasBeenRun: boolean
  /** Set when a transcription node pauses the run awaiting speaker assignment */
  pendingTranscriptionSessionId: string | null

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

  // Actions — transcription
  setPendingTranscriptionSessionId: (id: string | null) => void
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
  hasBeenRun: false,
  pendingTranscriptionSessionId: null,

  // Graph actions
  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set({
      edges: addEdge(
        {
          ...connection,
          animated: false,
          // Preserve the source handle ID as the edge label so the runner
          // can do port-based routing (e.g. 'pass' / 'fail' for branch nodes)
          label: connection.sourceHandle ?? undefined,
        },
        get().edges,
      ),
    }),

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

  setRunStatus: (status) =>
    set((state) => ({
      runStatus: status,
      hasBeenRun: status === 'running' ? true : state.hasBeenRun,
    })),

  setNodeRunStatuses: (statuses) => set({ nodeRunStatuses: statuses }),

  // Metadata actions
  setWorkflowName: (name) =>
    set({ workflow: { ...get().workflow, name } }),

  setWorkflow: (meta) =>
    set({ workflow: { ...get().workflow, ...meta } }),

  // Transcription actions
  setPendingTranscriptionSessionId: (id) =>
    set({ pendingTranscriptionSessionId: id }),
}))
