import { useCallback, useRef, useEffect, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useWorkflowStore, PALETTE_NODES, OFFLINE_COMPATIBLE_SUBTYPES } from '@/store/workflowStore'
import { SourceNode } from './nodes/SourceNode'
import { LogicNode } from './nodes/LogicNode'
import { OutputNode } from './nodes/OutputNode'
import { InsightNode } from './nodes/InsightNode'
import { GtmFrameworkNode } from './nodes/GtmFrameworkNode'
import { BrandContextNode } from './nodes/BrandContextNode'
import { ClientBrainNode } from './nodes/ClientBrainNode'
import { GroupNode } from './nodes/GroupNode'
import { VoiceOutputNode } from './nodes/VoiceOutputNode'
import { MusicGenerationNode } from './nodes/MusicGenerationNode'
import { AudioMixNode } from './nodes/AudioMixNode'
import { AudioInputNode } from './nodes/AudioInputNode'
import { CharacterAnimationNode } from './nodes/CharacterAnimationNode'
import { VideoCompositionNode } from './nodes/VideoCompositionNode'
import { AudioReplaceNode } from './nodes/AudioReplaceNode'
import { CanvasContextMenu } from './CanvasContextMenu'
import { NodeContextMenu } from './NodeContextMenu'

const nodeTypes = {
  source: SourceNode,
  logic: LogicNode,
  output: OutputNode,
  insight: InsightNode,
  gtm_framework: GtmFrameworkNode,
  brand_context: BrandContextNode,
  client_brain: ClientBrainNode,
  deep_web_scrape: SourceNode,
  review_miner: SourceNode,
  seo_intent: SourceNode,
  audience_signal: SourceNode,
  wrike_source: SourceNode,
  group: GroupNode,
  voice_output: VoiceOutputNode,
  music_generation: MusicGenerationNode,
  audio_mix: AudioMixNode,
  audio_input: AudioInputNode,
  character_animation: CharacterAnimationNode,
  video_composition:   VideoCompositionNode,
  audio_replace:       AudioReplaceNode,
}

let nodeIdCounter = 1
function nextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`
}

export function WorkflowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    setSelectedNodeId, addNode, setRfInstance, duplicateNodes,
  } = useWorkflowStore()
  const canvasTool = useWorkflowStore((s) => s.canvasTool)
  const setCanvasTool = useWorkflowStore((s) => s.setCanvasTool)
  const isLocked = useWorkflowStore((s) => s.workflow.isLocked ?? false)

  // Keyboard shortcuts: V = select, H = hand, Cmd+D = duplicate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+D: always block browser bookmark, then duplicate if not in an input
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          const selectedIds = useWorkflowStore.getState().nodes.filter((n) => n.selected).map((n) => n.id)
          if (selectedIds.length > 0) duplicateNodes(selectedIds)
        }
        return
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'v' || e.key === 'V') setCanvasTool('select')
      if (e.key === 'h' || e.key === 'H') setCanvasTool('hand')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCanvasTool, duplicateNodes])

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const hasFitRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeId: string; subtype: string } | null>(null)

  // Fit view once after workflow nodes load asynchronously
  useEffect(() => {
    if (nodes.length > 0 && !hasFitRef.current) {
      hasFitRef.current = true
      setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.2 }), 50)
    }
    if (nodes.length === 0) {
      hasFitRef.current = false
    }
  }, [nodes.length])

  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    if (canvasTool === 'hand') return
    setSelectedNodeId(node.id)
  }, [setSelectedNodeId, canvasTool])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setContextMenu(null)
    setNodeContextMenu(null)
  }, [setSelectedNodeId])

  // Drag-and-drop from palette
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (isLocked) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [isLocked])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (isLocked) return
    if (!rfInstanceRef.current) return

    const position = rfInstanceRef.current.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    })

    // ── Insight card drop ──────────────────────────────────────────────────
    const insightJson = e.dataTransfer.getData('application/contentnode-insight')
    if (insightJson) {
      try {
        const insight = JSON.parse(insightJson) as {
          insightId: string
          type: string
          title: string
          confidence: number | null
          isCollective: boolean
          suggestedNodeType: string | null
          suggestedConfigChange: Record<string, unknown>
          body: string
        }

        const newId = nextId()
        addNode({
          id: newId,
          type: 'insight',
          position,
          data: {
            label: insight.title,
            description: insight.body,
            icon: 'Lightbulb',
            subtype: 'insight',
            confidence: insight.confidence,
            isCollective: insight.isCollective,
            patternDescription: insight.title,
            config: {
              subtype: 'insight',
              insight_id: insight.insightId,
              insight_type: insight.type,
              suggested_node_type: insight.suggestedNodeType,
              suggested_config_change: insight.suggestedConfigChange,
            },
          },
        })
        setSelectedNodeId(newId)
      } catch {
        // Malformed drag data — ignore
      }
      return
    }

    // ── Palette node drop ──────────────────────────────────────────────────
    const subtype = e.dataTransfer.getData('application/contentnode-subtype')
    if (!subtype) return

    const def = PALETTE_NODES.find((n) => n.subtype === subtype)
    if (!def) return

    // Block online-only nodes in offline workflows
    const { workflow } = useWorkflowStore.getState()
    if (workflow.connectivity_mode === 'offline' && !OFFLINE_COMPATIBLE_SUBTYPES.has(subtype)) return

    const newId = nextId()
    const isGroup = def.type === 'group'
    addNode({
      id: newId,
      type: def.type,
      position,
      ...(isGroup ? { style: { width: 700, height: 500 }, zIndex: -1 } : {}),
      data: {
        label: def.label,
        description: def.description,
        icon: def.icon,
        subtype: def.subtype,
        config: { ...def.defaultConfig },
      },
    })
    setSelectedNodeId(newId)
  }, [addNode, setSelectedNodeId])

  // Right-click on canvas pane → show context menu
  const onPaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Right-click on a node → show node context menu
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => {
    e.preventDefault()
    setContextMenu(null) // close canvas menu if open
    const subtype = (node.data?.subtype as string) ?? (node.data?.config as Record<string, unknown> | undefined)?.subtype as string ?? ''
    setNodeContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id, subtype })
  }, [])

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onInit={(instance) => {
          rfInstanceRef.current = instance
          setRfInstance(instance)
        }}
        nodeTypes={nodeTypes}
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.05}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={isLocked ? null : 'Backspace'}
        nodesDraggable={!isLocked}
        nodesConnectable={!isLocked}
        edgesUpdatable={!isLocked}
        selectionOnDrag={!isLocked && canvasTool === 'select'}
        panOnDrag={canvasTool === 'hand'}
        panActivationKeyCode={canvasTool === 'select' ? 'Space' : null}
        selectionKeyCode={null}
        multiSelectionKeyCode="Meta"
        className={canvasTool === 'hand' ? 'bg-background cursor-grab active:cursor-grabbing' : 'bg-background'}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(0 0% 18%)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'source') return 'rgba(16,185,129,0.4)'
            if (node.type === 'logic') return 'rgba(59,130,246,0.4)'
            if (node.type === 'output') return 'rgba(168,85,247,0.4)'
            if (node.type === 'insight') return 'rgba(234,179,8,0.5)'
            if (['gtm_framework', 'brand_context', 'client_brain', 'deep_web_scrape', 'review_miner', 'seo_intent', 'audience_signal', 'wrike_source'].includes(node.type ?? '')) return 'rgba(24,95,165,0.4)'
            if (node.type === 'group') return 'rgba(59,130,246,0.15)'
            return 'rgba(255,255,255,0.1)'
          }}
          maskColor="rgba(0,0,0,0.6)"
          pannable
          zoomable
        />
      </ReactFlow>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      {nodeContextMenu && (
        <NodeContextMenu
          nodeId={nodeContextMenu.nodeId}
          subtype={nodeContextMenu.subtype}
          x={nodeContextMenu.x}
          y={nodeContextMenu.y}
          onClose={() => setNodeContextMenu(null)}
        />
      )}
    </>
  )
}
