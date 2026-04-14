import * as Icons from 'lucide-react'
import { Label } from '@/components/ui/label'
import { assetUrl } from '@/lib/api'
import { downloadAsset } from '@/lib/downloadAsset'
import { useWorkflowStore } from '@/store/workflowStore'

interface MediaOutput {
  storageKey?: string
  localPath?: string
  filename?: string
  videoName?: string
  timestampSecs?: number
  durationSecs?: number
}

function isImagePath(path: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(path)
}

function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|avi|webm|mkv|m4v)(\?|$)/i.test(path)
}

export function MediaDownloadConfig({
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const rawOutput = nodeRunStatus?.status === 'passed' && nodeRunStatus.output
    ? (nodeRunStatus.output as Record<string, unknown>)
    : null

  // Unwrap image-generation / video-generation output shape: { assets: [{ localPath, storageKey, ... }] }
  const output: MediaOutput | null = rawOutput
    ? (rawOutput.localPath || rawOutput.storageKey)
      ? (rawOutput as MediaOutput)
      : Array.isArray(rawOutput.assets) && (rawOutput.assets as MediaOutput[]).length > 0
        ? (rawOutput.assets as MediaOutput[])[0]
        : null
    : null

  if (!output?.localPath && !output?.storageKey) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Icons.Download className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          Connect this node to a <strong>Video Frame Extractor</strong> or any node that
          outputs an image or video file. The file will appear here after the workflow runs.
        </p>
      </div>
    )
  }

  const workflowName = useWorkflowStore((s) => s.workflow.name)

  const filePath    = output.localPath ?? `/files/${output.storageKey}`
  const rawFilename = output.filename ?? output.videoName ?? 'download'
  const isImage     = isImagePath(filePath) || isImagePath(rawFilename)
  const isVideo     = isVideoPath(filePath) || isVideoPath(rawFilename)

  // For thumbnails, name the file "{workflow}_thumbnail.{ext}"
  const ext = (rawFilename.match(/\.[^.]+$/) ?? [''])[0]
  const filename = isImage && workflowName
    ? `${workflowName.replace(/[^a-z0-9_\-]/gi, '_')}_thumbnail${ext || '.jpg'}`
    : rawFilename

  return (
    <div className="space-y-3">
      {/* Image preview */}
      {isImage && output.localPath && (
        <div className="relative overflow-hidden rounded-lg border border-border">
          <img
            src={assetUrl(output.localPath)}
            alt={filename}
            className="w-full object-cover"
            style={{ maxHeight: 220 }}
          />
        </div>
      )}

      {/* Video info */}
      {isVideo && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
          <Icons.FileVideo className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{filename}</p>
            {output.durationSecs && (
              <p className="text-[11px] text-muted-foreground">{output.durationSecs}s</p>
            )}
          </div>
        </div>
      )}

      {/* Meta */}
      {output.timestampSecs != null && (
        <p className="text-[11px] text-muted-foreground">
          Frame at {output.timestampSecs}s
          {output.durationSecs ? ` of ${output.durationSecs}s` : ''}
          {output.videoName ? ` · ${output.videoName}` : ''}
        </p>
      )}

      {/* Download button */}
      {output.localPath && (
        <>
          <Label className="text-xs text-muted-foreground">Download</Label>
          <button
            onClick={() => downloadAsset(output.localPath!, filename)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent transition-colors"
          >
            <Icons.Download className="h-3.5 w-3.5" />
            {filename}
          </button>
        </>
      )}
    </div>
  )
}
