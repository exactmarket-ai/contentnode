import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore } from '@/store/workflowStore'
import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

interface WorkflowOption {
  id: string
  name: string
  clientId: string | null
  status: string
}

interface Division {
  id: string
  name: string
  jobs: { id: string; name: string }[]
}

interface OutputNode {
  id: string
  label: string | null
  type: string
}

interface PreviewRun {
  id: string
  approvalStatus: 'approved' | 'latest' | 'none'
  createdAt: string
  outputPreview: string | null
}

/**
 * Config panel for the workflow-output source node.
 * Lets the user pick a source workflow, optional division/job filter,
 * a specific output node to pull from, and a fallback toggle.
 * Shows a live preview of the matching run if one exists.
 */
export function WorkflowOutputConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const currentWorkflowId = useWorkflowStore((s) => s.workflow.id)

  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [outputNodes, setOutputNodes] = useState<OutputNode[]>([])
  const [preview, setPreview] = useState<PreviewRun | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const sourceWorkflowId = (config.sourceWorkflowId as string) ?? ''
  const divisionId = (config.divisionId as string) ?? ''
  const jobId = (config.jobId as string) ?? ''
  const outputNodeId = (config.outputNodeId as string) ?? ''
  const fallbackToLatest = (config.fallbackToLatest as boolean | undefined) ?? true

  // Load all workflows on mount
  useEffect(() => {
    apiFetch('/api/v1/workflows')
      .then((r) => r.json())
      .then(({ data }) => {
        // Exclude the current workflow from the list to prevent self-reference
        const all = (data ?? []) as WorkflowOption[]
        setWorkflows(all.filter((wf) => wf.id !== currentWorkflowId))
      })
      .catch(() => {})
  }, [currentWorkflowId])

  // When source workflow changes: load its divisions (via client) and output nodes
  useEffect(() => {
    if (!sourceWorkflowId) {
      setDivisions([])
      setOutputNodes([])
      return
    }

    // Load the workflow to get its clientId
    apiFetch(`/api/v1/workflows/${sourceWorkflowId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const clientId = data?.clientId as string | null
        if (clientId) {
          apiFetch(`/api/v1/clients/${clientId}/divisions`)
            .then((r) => r.json())
            .then(({ data: divs }) => setDivisions(divs ?? []))
            .catch(() => setDivisions([]))
        } else {
          setDivisions([])
        }

        // Extract output nodes from the workflow
        const nodes = (data?.nodes ?? []) as OutputNode[]
        setOutputNodes(nodes.filter((n) => n.type === 'output'))
      })
      .catch(() => {
        setDivisions([])
        setOutputNodes([])
      })
  }, [sourceWorkflowId])

  // Load preview run when filters change
  useEffect(() => {
    if (!sourceWorkflowId) {
      setPreview(null)
      return
    }
    setPreviewLoading(true)
    const params = new URLSearchParams({ workflowId: sourceWorkflowId, status: 'completed', limit: '1' })
    if (divisionId) params.set('divisionId', divisionId)
    if (jobId) params.set('jobId', jobId)

    apiFetch(`/api/v1/runs?${params.toString()}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const run = (data ?? [])[0]
        if (!run) {
          setPreview(null)
          return
        }

        // Check if run has approval feedback
        const hasFeedback = Array.isArray(run.feedbacks) && run.feedbacks.some(
          (f: { decision: string }) => f.decision === 'approved' || f.decision === 'approved_with_changes',
        )

        // Try to extract a text preview from nodeStatuses
        const nodeStatuses = run.nodeStatuses ?? {}
        const outputEntries = Object.entries(nodeStatuses) as [string, { status: string; output?: unknown }][]
        const passed = outputEntries.filter(([, ns]) => ns.status === 'passed' && ns.output)
        const lastOutput = passed[passed.length - 1]?.[1]?.output
        let outputPreview: string | null = null
        if (typeof lastOutput === 'string') {
          outputPreview = lastOutput.slice(0, 200) + (lastOutput.length > 200 ? '…' : '')
        }

        setPreview({
          id: run.id,
          approvalStatus: hasFeedback ? 'approved' : 'latest',
          createdAt: run.createdAt,
          outputPreview,
        })
      })
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false))
  }, [sourceWorkflowId, divisionId, jobId])

  const selectedDivision = divisions.find((d) => d.id === divisionId)
  const availableJobs = selectedDivision?.jobs ?? []

  const handleDivisionChange = (id: string) => {
    onChange('divisionId', id || undefined)
    onChange('jobId', undefined)
  }

  return (
    <div className="space-y-4">
      {/* Source workflow */}
      <FieldGroup label="Source Workflow">
        <select
          value={sourceWorkflowId}
          onChange={(e) => {
            onChange('sourceWorkflowId', e.target.value || undefined)
            onChange('divisionId', undefined)
            onChange('jobId', undefined)
            onChange('outputNodeId', undefined)
          }}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— select a workflow —</option>
          {workflows.map((wf) => (
            <option key={wf.id} value={wf.id}>{wf.name}</option>
          ))}
        </select>
      </FieldGroup>

      {sourceWorkflowId && (
        <>
          {/* Division + Job filters */}
          {divisions.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Division (optional)">
                <select
                  value={divisionId}
                  onChange={(e) => handleDivisionChange(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— any —</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </FieldGroup>

              <FieldGroup label="Job (optional)">
                <select
                  value={jobId}
                  onChange={(e) => onChange('jobId', e.target.value || undefined)}
                  disabled={availableJobs.length === 0}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">— any —</option>
                  {availableJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </FieldGroup>
            </div>
          )}

          {/* Output node selector */}
          {outputNodes.length > 0 && (
            <FieldGroup label="Output Node (optional)">
              <select
                value={outputNodeId}
                onChange={(e) => onChange('outputNodeId', e.target.value || undefined)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— auto (last output) —</option>
                {outputNodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.label ?? n.type} ({n.id.slice(0, 8)}…)</option>
                ))}
              </select>
            </FieldGroup>
          )}

          {/* Fallback toggle */}
          <label className="flex cursor-pointer items-center gap-3">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={fallbackToLatest}
                onChange={(e) => onChange('fallbackToLatest', e.target.checked)}
              />
              <div className={cn(
                'h-4 w-7 rounded-full transition-colors',
                fallbackToLatest ? 'bg-blue-500' : 'bg-muted',
              )}>
                <div className={cn(
                  'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
                  fallbackToLatest ? 'translate-x-3.5' : 'translate-x-0.5',
                )} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium">Fallback to latest if no approval</p>
              <p className="text-[10px] text-muted-foreground">
                When on, uses the most recent run if no approved run exists (shows a warning)
              </p>
            </div>
          </label>

          {/* Preview section */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Matching Run Preview</p>
            {previewLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching…
              </div>
            ) : preview ? (
              <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                    preview.approvalStatus === 'approved'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700',
                  )}>
                    {preview.approvalStatus === 'approved' ? (
                      <><Icons.CheckCircle2 className="h-2.5 w-2.5" /> Approved</>
                    ) : (
                      <><Icons.AlertTriangle className="h-2.5 w-2.5" /> Latest (unreviewed)</>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(preview.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {preview.outputPreview ? (
                  <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed">
                    {preview.outputPreview}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">No text preview available</p>
                )}
                <p className="text-[9px] text-muted-foreground/50 font-mono">{preview.id}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
                <Icons.FileSearch className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                <p className="text-[10px] text-muted-foreground">
                  {sourceWorkflowId
                    ? 'No completed runs found matching the selected filters'
                    : 'Select a source workflow to see a preview'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
