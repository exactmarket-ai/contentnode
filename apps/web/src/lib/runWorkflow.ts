/**
 * Shared "trigger a run" logic used by both the TopBar Run button and the
 * per-node "Run to here" right-click action.
 *
 * When stopAtNodeId is provided the API will prune the graph to only the
 * ancestors of that node (+ the node itself) before executing, so the run
 * naturally terminates after the target node without touching anything
 * downstream.
 */
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'
import { pollRunUntilTerminal } from '@/components/layout/TopBar'
import type { Node, Edge } from 'reactflow'

/** BFS backwards from targetId to collect all ancestor node IDs (inclusive). */
function getAncestorIds(targetId: string, edges: Edge[]): Set<string> {
  const incoming = new Map<string, string[]>()
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push(e.source)
  }

  const visited = new Set<string>()
  const queue = [targetId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const src of incoming.get(cur) ?? []) queue.push(src)
  }
  return visited
}

function isSourceNodeConfigured(n: Node): boolean {
  const cfg = (n.data?.config as Record<string, unknown>) ?? {}
  return !!(
    cfg.text || cfg.inlineText || cfg.pasted_text ||
    (Array.isArray(cfg.uploaded_files) && cfg.uploaded_files.length > 0) ||
    (Array.isArray(cfg.library_refs) && cfg.library_refs.length > 0) ||
    (Array.isArray(cfg.audio_files) && cfg.audio_files.length > 0) ||
    (Array.isArray(cfg.video_files) && cfg.video_files.length > 0) ||
    cfg.documentId || cfg.url || cfg.raw_text
  )
}

export async function triggerRun(stopAtNodeId?: string, topic?: string): Promise<void> {
  const store = useWorkflowStore.getState()
  const { nodes, edges, workflow: wf } = store

  if (!wf.id) {
    window.dispatchEvent(new CustomEvent('contentnode:open-save-dialog'))
    return
  }

  // Validate source nodes — for "run to here" only validate ancestors of target
  const relevantNodeIds = stopAtNodeId
    ? getAncestorIds(stopAtNodeId, edges)
    : null  // null = all nodes

  const unconfigured = nodes.filter((n) => {
    if (n.type !== 'source') return false
    if (relevantNodeIds && !relevantNodeIds.has(n.id)) return false
    // Source nodes with incoming edges receive data from upstream — no content required
    const hasIncomingEdge = edges.some((e) => e.target === n.id)
    if (hasIncomingEdge) return false
    return !isSourceNodeConfigured(n)
  })

  if (unconfigured.length > 0) {
    const labels = unconfigured.map((n) => (n.data?.label as string) || n.id).join(', ')
    alert(
      `Please configure your source node${unconfigured.length > 1 ? 's' : ''} before running.\n\n` +
      `Missing content: ${labels}\n\nOpen the node and upload a file or paste text.`
    )
    return
  }

  store.setRunStatus('running')
  store.setDetectionScoreHistory({})  // clear previous run's detection scores
  // Do NOT pre-reset any node statuses here. Nodes that aren't part of this
  // execution path must keep their output indefinitely. Nodes that are part of
  // this run will be set to 'running' → 'passed'/'failed' by the first poll.

  // For "Run to here": seed already-completed ancestor nodes so the runner skips them.
  // This prevents re-generating images that are already done when you only want to
  // run the final composition/downstream node.
  const seedNodeStatuses: Record<string, unknown> = {}
  if (stopAtNodeId && relevantNodeIds) {
    const currentStatuses = store.nodeRunStatuses
    for (const nodeId of relevantNodeIds) {
      if (nodeId === stopAtNodeId) continue // always re-run the target itself
      const s = currentStatuses[nodeId]
      if ((s?.status === 'passed' || s?.status === 'skipped') && s.output !== undefined) {
        seedNodeStatuses[nodeId] = s
      }
    }
  }

  try {
    const res = await apiFetch('/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: wf.id,
        graph: { nodes, edges },
        model_config: wf.default_model_config,
        connectivity_mode: wf.connectivity_mode,
        ...(stopAtNodeId ? { stopAtNodeId } : {}),
        ...(Object.keys(seedNodeStatuses).length > 0 ? { seedNodeStatuses } : {}),
        ...(topic?.trim() ? { topic: topic.trim() } : {}),
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      let errMsg = `Failed to start run (HTTP ${res.status})`
      try { const j = JSON.parse(text); if (j.error) errMsg = j.error } catch { /* raw text */ }
      store.setRunError(errMsg)
      store.setRunStatus('failed')
      return
    }

    const { runId, workflowId: createdWorkflowId } = await res.json() as { runId: string; workflowId: string }
    store.setActiveRunId(runId)
    if (!wf.id && createdWorkflowId) {
      store.setWorkflow({ id: createdWorkflowId, autoCreated: true })
    }
    await pollRunUntilTerminal(runId)

    // Auto-save graph after successful run so output is never lost
    if (useWorkflowStore.getState().runStatus === 'completed' && wf.id) {
      const latest = useWorkflowStore.getState()
      apiFetch(`/api/v1/workflows/${wf.id}/graph`, {
        method: 'PUT',
        body: JSON.stringify({
          nodes: latest.nodes,
          edges: latest.edges,
          name: latest.workflow.name,
          defaultModelConfig: latest.workflow.default_model_config,
        }),
      })
        .then(() => {
          useWorkflowStore.getState().setWorkflow({ graphSaved: true })
          useWorkflowStore.setState({ graphDirty: false })
        })
        .catch(() => {})
    }
  } catch (err) {
    store.setRunError(err instanceof Error ? err.message : 'Unexpected error')
    store.setRunStatus('failed')
  }
}
