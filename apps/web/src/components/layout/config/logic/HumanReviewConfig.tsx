import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useWorkflowStore } from '@/store/workflowStore'
import { pollRunUntilTerminal } from '../../TopBar'
import { FieldGroup } from '../shared'

export function HumanReviewConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { output?: unknown; paused?: boolean }
}) {
  const output = nodeRunStatus?.output
  const isPaused = nodeRunStatus?.paused
  const runStatus = useWorkflowStore((s) => s.runStatus)
  const pendingReviewRunId = useWorkflowStore((s) => s.pendingReviewRunId)
  const pendingReviewContent = useWorkflowStore((s) => s.pendingReviewContent)
  const setRunStatus = useWorkflowStore((s) => s.setRunStatus)
  const setPendingReview = useWorkflowStore((s) => s.setPendingReview)

  const isWaiting = (runStatus === 'waiting_review' || isPaused) && !!pendingReviewRunId

  const [editedContent, setEditedContent] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [flagging, setFlagging] = useState(false)
  const [flagNote, setFlagNote] = useState('')

  // Reset local edit state whenever the review content changes
  useEffect(() => {
    setEditedContent(null)
    setSubmitError(null)
    setFlagging(false)
  }, [pendingReviewContent])

  const contentToReview = editedContent ?? pendingReviewContent ?? (typeof output === 'string' ? output : null)

  const handleApprove = async () => {
    if (!pendingReviewRunId || !contentToReview) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { apiFetch } = await import('@/lib/api')
      const res = await apiFetch(`/api/v1/runs/${pendingReviewRunId}/review`, {
        method: 'POST',
        body: JSON.stringify({ approvedContent: contentToReview }),
      })
      if (!res.ok) throw new Error(await res.text())
      setPendingReview(null, null)
      setRunStatus('running')
      const { activeRunId } = useWorkflowStore.getState()
      if (activeRunId) void pollRunUntilTerminal(activeRunId)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const handleFlag = async () => {
    if (!pendingReviewRunId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { apiFetch } = await import('@/lib/api')
      const res = await apiFetch(`/api/v1/runs/${pendingReviewRunId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ note: flagNote }),
      })
      if (!res.ok) throw new Error(await res.text())
      setPendingReview(null, null)
      setRunStatus('failed')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to flag')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <FieldGroup label="Review Instructions">
        <Textarea
          placeholder="Describe what the reviewer should check or edit..."
          className="min-h-[80px] resize-none text-xs"
          value={(config.instructions as string) ?? ''}
          onChange={(e) => onChange('instructions', e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          These instructions appear here when the workflow pauses for review.
        </p>
      </FieldGroup>

      {isWaiting && contentToReview !== null ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
            <Icons.ClipboardCheck className="h-3.5 w-3.5" />
            Awaiting your review — edit if needed, then approve or flag
          </div>

          {(config.instructions as string) && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {config.instructions as string}
            </p>
          )}

          <Textarea
            value={editedContent ?? contentToReview}
            onChange={(e) => setEditedContent(e.target.value)}
            className="min-h-[180px] resize-y text-xs font-mono"
            disabled={submitting}
          />

          {flagging && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Briefly describe the issue (optional):</p>
              <Textarea
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="e.g. Wrong tone, missing key points..."
                className="min-h-[60px] resize-none text-xs"
                disabled={submitting}
              />
            </div>
          )}

          {submitError && (
            <p className="text-[11px] text-destructive">{submitError}</p>
          )}

          <div className="flex gap-2">
            {flagging ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 text-xs"
                  onClick={handleFlag}
                  disabled={submitting}
                >
                  {submitting ? <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Icons.Flag className="mr-1.5 h-3 w-3" />}
                  Confirm Flag
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setFlagging(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={handleApprove}
                  disabled={submitting || !contentToReview?.trim()}
                >
                  {submitting ? <Icons.Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Icons.CheckCircle className="mr-1.5 h-3 w-3" />}
                  Approve & Continue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => setFlagging(true)}
                  disabled={submitting}
                >
                  <Icons.Flag className="mr-1.5 h-3 w-3" />
                  Flag
                </Button>
              </>
            )}
          </div>
        </div>
      ) : output !== undefined && output !== null ? (
        <FieldGroup label="Approved Content">
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-2.5 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </div>
        </FieldGroup>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <Icons.ClipboardCheck className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            When the run reaches this node it will pause here. You'll see the content to review and approve before the workflow continues.
          </p>
        </div>
      )}
    </>
  )
}
