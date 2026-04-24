import { useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface RunTriggerModalProps {
  workflowName: string
  onConfirm: (topic: string) => void
  onClose: () => void
}

export function RunTriggerModal({ workflowName, onConfirm, onClose }: RunTriggerModalProps) {
  const [topic, setTopic] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => onConfirm(topic.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="w-full max-w-sm bg-white border border-border rounded-xl shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Start Run</h2>
            <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-[220px]">{workflowName}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Topic</Label>
          <Input
            ref={inputRef}
            placeholder="e.g. Healthcare Compliance, Zero Trust..."
            className="text-sm"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          />
          <p className="text-[10px] text-muted-foreground">
            Used in filenames and passed as context to AI nodes.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit}>
            <Icons.Play className="mr-1.5 h-3.5 w-3.5" />
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
