/**
 * fileCleanup.ts
 *
 * Deletes video and audio source files from local storage that are older than
 * FILE_CLEANUP_MAX_AGE_HOURS (default 24h). These are large transient files
 * used only during transcription — the transcript text is kept in the DB.
 *
 * Documents (PDF, DOCX, TXT, CSV, etc.) are left untouched; they are reused
 * across runs and have no retention pressure.
 *
 * In S3/R2 mode, set a bucket lifecycle rule instead — this job only handles
 * local filesystem storage.
 */

import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { isS3Mode } from '@contentnode/storage'

const UPLOAD_DIR   = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')
const MAX_AGE_HOURS = Number(process.env.FILE_CLEANUP_MAX_AGE_HOURS ?? 24)

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac'])

function isTranscriptionFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext)
}

/**
 * Walk a directory (non-recursive by default) and return file paths.
 */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((p) => {
        try { return statSync(p).isFile() } catch { return false }
      })
  } catch {
    return []
  }
}

export async function runFileCleanup(): Promise<void> {
  if (isS3Mode()) {
    // In S3/R2 mode, rely on bucket lifecycle rules — nothing to do here.
    console.log('[file-cleanup] S3 mode detected — skipping local cleanup (use bucket lifecycle rules)')
    return
  }

  const cutoffMs = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000
  let deleted = 0
  let errors  = 0

  // Scan root uploads dir
  const dirsToScan = [
    UPLOAD_DIR,
    join(UPLOAD_DIR, 'clips'), // speaker audio clips from transcription
  ]

  for (const dir of dirsToScan) {
    for (const filePath of listFiles(dir)) {
      if (!isTranscriptionFile(filePath)) continue
      try {
        const { mtimeMs } = statSync(filePath)
        if (mtimeMs < cutoffMs) {
          unlinkSync(filePath)
          deleted++
        }
      } catch {
        errors++
      }
    }
  }

  console.log(
    `[file-cleanup] done — deleted ${deleted} file${deleted !== 1 ? 's' : ''} older than ${MAX_AGE_HOURS}h` +
    (errors > 0 ? `, ${errors} error${errors !== 1 ? 's' : ''}` : ''),
  )
}
