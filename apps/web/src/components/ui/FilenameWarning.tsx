import type { FilenameIssue } from '@/lib/filename'

interface Props {
  issues: FilenameIssue[]
}

export function FilenameWarning({ issues }: Props) {
  if (issues.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
      <p className="font-medium">
        {issues.length === 1
          ? 'This filename contains special characters and will be renamed:'
          : `${issues.length} filenames contain special characters and will be renamed:`}
      </p>
      <ul className="space-y-0.5 font-mono">
        {issues.map(({ original, safe }) => (
          <li key={original} className="flex items-center gap-1.5 truncate">
            <span className="text-amber-600/70 dark:text-amber-500/70 truncate">{original}</span>
            <span className="shrink-0">→</span>
            <span className="truncate">{safe}</span>
          </li>
        ))}
      </ul>
      <p className="text-amber-600/70 dark:text-amber-500/60">
        Tip: rename the file before uploading to avoid this (use only letters, numbers, dots, hyphens).
      </p>
    </div>
  )
}
