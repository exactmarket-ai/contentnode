import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Division {
  id: string
  name: string
  jobs: Job[]
}

interface Job {
  id: string
  name: string
  budgetCents: number | null
}

/**
 * Slides up from the bottom of the canvas while a run is in progress.
 * Lets the user optionally tag the run with a Division, Job, and item name.
 * Dismissable — if closed without saving, the run stays unnamed.
 */
export function RunNamingPanel() {
  const activeRunId = useWorkflowStore((s) => s.activeRunId)
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const workflow = useWorkflowStore((s) => s.workflow)

  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [divisionId, setDivisionId] = useState('')
  const [jobId, setJobId] = useState('')
  const [itemName, setItemName] = useState('')
  const [nextVersion, setNextVersion] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Show panel when run starts; hide/reset when it ends
  useEffect(() => {
    if (runStatus === 'running' && activeRunId) {
      setVisible(true)
      setDismissed(false)
      setSaved(false)
      setDivisionId('')
      setJobId('')
      setItemName('')
      setNextVersion(1)
    } else {
      // Keep saved state briefly visible after run completes, then slide out
      const delay = saved ? 2000 : 0
      const timer = setTimeout(() => {
        setVisible(false)
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [runStatus, activeRunId, saved])

  // Load divisions when clientId is known
  useEffect(() => {
    if (!workflow.clientId) return
    apiFetch(`/api/v1/clients/${workflow.clientId}/divisions`)
      .then((r) => r.json())
      .then(({ data }) => setDivisions(data ?? []))
      .catch(() => {})
  }, [workflow.clientId])

  // Fetch next version when job changes
  useEffect(() => {
    if (!jobId || !workflow.id) return
    apiFetch(`/api/v1/runs/item-version?workflowId=${workflow.id}&jobId=${jobId}`)
      .then((r) => r.json())
      .then(({ data }) => setNextVersion(data?.nextVersion ?? 1))
      .catch(() => {})
  }, [jobId, workflow.id])

  // Reset job when division changes
  const handleDivisionChange = (id: string) => {
    setDivisionId(id)
    setJobId('')
    setNextVersion(1)
  }

  const selectedDivision = divisions.find((d) => d.id === divisionId)
  const availableJobs = selectedDivision?.jobs ?? []

  const handleSave = async () => {
    if (!activeRunId) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (divisionId) body.divisionId = divisionId
      if (jobId) body.jobId = jobId
      if (itemName.trim()) body.itemName = itemName.trim()
      if (jobId) body.itemVersion = nextVersion

      await apiFetch(`/api/v1/runs/${activeRunId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setSaved(true)
    } catch {
      // Non-critical — don't block the run
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    setVisible(false)
  }

  if (!visible || dismissed) return null

  return (
    <div
      className={cn(
        'absolute bottom-4 left-1/2 z-40 w-[480px] -translate-x-1/2',
        'rounded-xl border border-border bg-card shadow-2xl',
        'transition-all duration-300',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Icons.Tag className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">
            {saved ? 'Run tagged' : 'Tag this run (optional)'}
          </span>
          {runStatus === 'running' && !saved && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />
              running…
            </span>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <Icons.X className="h-3.5 w-3.5" />
        </button>
      </div>

      {saved ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-emerald-600">
          <Icons.CheckCircle2 className="h-4 w-4" />
          Run tagged successfully
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {divisions.length > 0 ? (
            <>
              {/* Division + Job row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Division</Label>
                  <select
                    value={divisionId}
                    onChange={(e) => handleDivisionChange(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— none —</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Job</Label>
                  <select
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    disabled={availableJobs.length === 0}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">— none —</option>
                    {availableJobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Item name + version row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Item name</Label>
                  <Input
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="e.g. Q1 Blog Post"
                    className="h-8 text-xs"
                  />
                </div>
                {jobId && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Version</Label>
                    <div className="flex h-8 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                      v{nextVersion}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* No divisions configured — just a free-text item name */
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Item name (optional)</Label>
              <Input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Q1 Blog Post"
                className="h-8 text-xs"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground/70">
                Add divisions &amp; jobs in the client structure tab to enable project tracking.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleDismiss}>
              Skip
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={saving || (!divisionId && !jobId && !itemName.trim())}
            >
              {saving && <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Save tag
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
