import { useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useWorkflowStore, PALETTE_NODES } from '@/store/workflowStore'
import { SourceNode } from './nodes/SourceNode'
import { LogicNode } from './nodes/LogicNode'
import { OutputNode } from './nodes/OutputNode'
import { InsightNode } from './nodes/InsightNode'
import { AlignmentToolbar } from './AlignmentToolbar'

const nodeTypes = {
  source: SourceNode,
  logic: LogicNode,
  output: OutputNode,
  insight: InsightNode,
}

let nodeIdCounter = 1
function nextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`
}

export function WorkflowCanvas() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    setSelectedNodeId, addNode,
  } = useWorkflowStore()

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const hasFitRef = useRef(false)

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
    setSelectedNodeId(node.id)
  }, [setSelectedNodeId])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
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
    addNode({
      id: newId,
      type: def.type,
      position,
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

  return (
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
      onInit={(instance) => { rfInstanceRef.current = instance }}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      deleteKeyCode="Backspace"
      selectionOnDrag={true}
      panOnDrag={false}
      panActivationKeyCode="Space"
      selectionKeyCode={null}
      multiSelectionKeyCode="Meta"
      className="bg-background"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="hsl(0 0% 18%)"
      />
      <Controls showInteractive={false} />
      <Panel position="top-center">
        <AlignmentToolbar />
      </Panel>
      <MiniMap
        nodeColor={(node) => {
          if (node.type === 'source') return 'rgba(16,185,129,0.4)'
          if (node.type === 'logic') return 'rgba(59,130,246,0.4)'
          if (node.type === 'output') return 'rgba(168,85,247,0.4)'
          if (node.type === 'insight') return 'rgba(234,179,8,0.5)'
          return 'rgba(255,255,255,0.1)'
        }}
        maskColor="rgba(0,0,0,0.6)"
        pannable
        zoomable
      />
    </ReactFlow>
  )
}
