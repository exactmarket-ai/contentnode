import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore } from '@/store/workflowStore'

interface Props {
  runId: string
  initialContent: string
  onComplete: () => void
  onDismiss: () => void
}

export function HumanReviewPanel({ runId, initialContent, onComplete, onDismiss }: Props) {
  const [content, setContent] = useState(initialContent)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/runs/${runId}/review`, {
        method: 'POST',
        body: JSON.stringify({ approvedContent: content }),
      })
      if (!res.ok) throw new Error(await res.text())
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-border bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
              <Icons.ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Human Review</h2>
              <p className="text-xs text-muted-foreground">Review and edit the content before it continues to AI Generate</p>
            </div>
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Editable content */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[200px] max-h-[400px] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Transcript content will appear here..."
        />

        <p className="text-[11px] text-muted-foreground">
          You can edit the text above before approving. The edited version will be passed to the next node.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={submitting}>
            Dismiss
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={submitting || !content.trim()}>
            {submitting ? (
              <><Icons.Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Approving…</>
            ) : (
              <><Icons.CheckCircle className="mr-1.5 h-3.5 w-3.5" />Approve &amp; Continue</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
