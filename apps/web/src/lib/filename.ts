/**
 * Filename safety utilities — mirrors the server-side sanitization in clients.ts.
 * Characters outside [a-zA-Z0-9._-] are replaced with underscores on the API.
 */

const SAFE_PATTERN = /^[a-zA-Z0-9._-]+$/

export function isSafeFilename(name: string): boolean {
  // Treat extension separately so we only check the base name
  const lastDot = name.lastIndexOf('.')
  const base = lastDot >= 0 ? name.slice(0, lastDot) : name
  return SAFE_PATTERN.test(base)
}

export function sanitizeFilename(name: string): string {
  const lastDot = name.lastIndexOf('.')
  const ext = lastDot >= 0 ? name.slice(lastDot) : ''
  const base = lastDot >= 0 ? name.slice(0, lastDot) : name
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') + ext
}

export interface FilenameIssue {
  original: string
  safe: string
}

export function checkFilenames(files: File[]): FilenameIssue[] {
  return files
    .filter((f) => !isSafeFilename(f.name))
    .map((f) => ({ original: f.name, safe: sanitizeFilename(f.name) }))
}
