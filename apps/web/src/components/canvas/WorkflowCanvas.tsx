import { useCallback, useRef } from 'react'
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

const nodeTypes = {
  source: SourceNode,
  logic: LogicNode,
  output: OutputNode,
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
    const subtype = e.dataTransfer.getData('application/contentnode-subtype')
    if (!subtype || !rfInstanceRef.current) return

    const def = PALETTE_NODES.find((n) => n.subtype === subtype)
    if (!def) return

    const position = rfInstanceRef.current.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    })

    addNode({
      id: nextId(),
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
  }, [addNode])

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
      className="bg-background"
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
          return 'rgba(255,255,255,0.1)'
        }}
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
  )
}
