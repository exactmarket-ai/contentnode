import { useCallback, useRef, useEffect, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useWorkflowStore, PALETTE_NODES } from '@/store/workflowStore'
import { SourceNode } from './nodes/SourceNode'
import { LogicNode } from './nodes/LogicNode'
import { OutputNode } from './nodes/OutputNode'
import { InsightNode } from './nodes/InsightNode'
import { GtmFrameworkNode } from './nodes/GtmFrameworkNode'
import { BrandContextNode } from './nodes/BrandContextNode'
import { GroupNode } from './nodes/GroupNode'
import { VoiceOutputNode } from './nodes/VoiceOutputNode'
import { MusicGenerationNode } from './nodes/MusicGenerationNode'
import { AudioMixNode } from './nodes/AudioMixNode'
import { AudioInputNode } from './nodes/AudioInputNode'
import { CharacterAnimationNode } from './nodes/CharacterAnimationNode'
import { CanvasContextMenu } from './CanvasContextMenu'
import { NodeContextMenu } from './NodeContextMenu'

const nodeTypes = {
  source: SourceNode,
  logic: LogicNode,
  output: OutputNode,
  insight: InsightNode,
  gtm_framework: GtmFrameworkNode,
  brand_context: BrandContextNode,
  group: GroupNode,
  voice_output: VoiceOutputNode,
  music_generation: MusicGenerationNode,
  audio_mix: AudioMixNode,
  audio_input: AudioInputNode,
  character_animation: CharacterAnimationNode,
}

let nodeIdCounter = 1
function nextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`
}

export function WorkflowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    setSelectedNodeId, addNode, setRfInstance,
  } = useWorkflowStore()
  const canvasTool = useWorkflowStore((s) => s.canvasTool)
  const setCanvasTool = useWorkflowStore((s) => s.setCanvasTool)

  // Keyboard shortcuts: V = select, H = hand
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'v' || e.key === 'V') setCanvasTool('select')
      if (e.key === 'h' || e.key === 'H') setCanvasTool('hand')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCanvasTool])

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
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
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

    const newId = nextId()
    const isGroup = def.type === 'group'
    addNode({
      id: newId,
      type: def.type,
      position,
      ...(isGroup ? { style: { width: 400, height: 280 }, zIndex: -1 } : {}),
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
        minZoom={0.05}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Backspace"
        selectionOnDrag={canvasTool === 'select'}
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
            if (node.type === 'gtm_framework' || node.type === 'brand_context') return 'rgba(24,95,165,0.4)'
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
