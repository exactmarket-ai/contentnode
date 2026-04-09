import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import { downloadBuffer, isS3Mode } from '@contentnode/storage'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

// Local disk path for dev mode (not used in S3 mode)
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')

interface UploadedFile {
  id: string
  name: string
  storageKey: string
  uploaded: boolean
}

export class SourceNodeExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    // ── Inline text (text-input subtype or pasted content) ───────────────────
    const inlineContent =
      (config.inlineText as string | undefined) ||
      (config.text as string | undefined) ||
      (config.pasted_text as string | undefined)

    if (inlineContent) return { output: inlineContent }

    // ── Library files (client-scoped or global, attached at design time) ────────
    const libraryRefs = (config.library_refs as Array<{ id: string; name: string }> | undefined) ?? []
    const libraryParts: string[] = []
    const libraryNames: string[] = []
    if (libraryRefs.length > 0) {
      const { prisma } = await import('@contentnode/database')
      const refIds = libraryRefs.map((r) => r.id)
      const [clientFiles, agencyFiles] = await Promise.all([
        ctx.clientId
          ? prisma.clientFile.findMany({ where: { id: { in: refIds }, agencyId: ctx.agencyId } })
          : Promise.resolve([]),
        prisma.agencyFile.findMany({ where: { id: { in: refIds }, agencyId: ctx.agencyId } }),
      ])
      const foundIds = new Set([...clientFiles.map((f) => f.id), ...agencyFiles.map((f) => f.id)])
      for (const ref of libraryRefs) {
        if (!foundIds.has(ref.id)) continue
        const lf = clientFiles.find((f) => f.id === ref.id) ?? agencyFiles.find((f) => f.id === ref.id)!
        const text = await this.readFileText(lf.storageKey, lf.originalName)
        libraryParts.push(text)
        libraryNames.push(lf.label ?? lf.originalName)
      }
    }

    // ── Uploaded files (per run) ──────────────────────────────────────────────
    const uploadedFiles = (config.uploaded_files as UploadedFile[] | undefined) ?? []

    if (libraryParts.length > 0 || uploadedFiles.length > 0) {
      const parts: string[] = [...libraryParts]
      const fileNames: string[] = [...libraryNames]
      for (const f of uploadedFiles) {
        if (!f.storageKey) {
          console.warn(`[source] file "${f.name}" has no storageKey — skipping`)
          continue
        }
        const text = await this.readFileText(f.storageKey, f.name)
        parts.push(text)
        fileNames.push(f.name)
      }
      if (parts.length > 0) return { output: parts.join('\n\n---\n\n'), sourceFiles: fileNames }
    }

    // ── Legacy single documentId path ────────────────────────────────────────
    const documentId = config.documentId as string | undefined
    if (documentId) {
      const { prisma } = await import('@contentnode/database')
      const doc = await prisma.document.findUnique({ where: { id: documentId } })
      if (doc) {
        const meta = doc.metadata as Record<string, unknown>
        if (typeof meta['parsed_text'] === 'string') return { output: meta['parsed_text'] }
        if (typeof meta['storageKey'] === 'string') {
          const text = await this.readFileText(meta['storageKey'] as string, documentId)
          return { output: text }
        }
      }
    }

    throw new Error(
      `Source node ${ctx.nodeId}: no content configured. Upload a file or add inline text.`,
    )
  }

  private async readFileText(storageKey: string, label: string): Promise<string> {
    const ext = extname(storageKey).toLowerCase()

    // Download to buffer (works for both local and S3)
    const buffer = await downloadBuffer(storageKey)

    let text: string

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm']).has(ext)) {
      text = buffer.toString('utf8')
    } else if (ext === '.pdf') {
      // pdf2json requires a file path — write to a temp file, parse, delete
      const tmpDir = tmpdir()
      mkdirSync(tmpDir, { recursive: true })
      const tmpPath = join(tmpDir, `${randomUUID()}.pdf`)
      writeFileSync(tmpPath, buffer)
      try {
        text = await Promise.race([
          new Promise<string>((resolve, reject) => {
            const parser = new PDFParser(null, true)
            parser.on('pdfParser_dataReady', (data: { Pages: Array<{ Texts: Array<{ R: Array<{ T: string }> }> }> }) => {
              const pages = data.Pages ?? []
              const out = pages.map((p) =>
                (p.Texts ?? []).map((t) => {
                  const raw = t.R?.[0]?.T ?? ''
                  try { return decodeURIComponent(raw) } catch { return raw }
                }).join(' ')
              ).join('\n\n')
              resolve(out)
            })
            parser.on('pdfParser_dataError', (err: Error | { parserError: Error }) => {
              reject(err instanceof Error ? err : err.parserError)
            })
            parser.loadPDF(tmpPath)
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`PDF parsing timed out for ${label}`)), 15000)
          ),
        ])
      } finally {
        try { unlinkSync(tmpPath) } catch {}
      }
    } else {
      try {
        text = buffer.toString('utf8')
      } catch {
        throw new Error(`Source node: cannot read file "${label}" (unsupported format ${ext})`)
      }
    }

    return text.replace(/\0/g, '').trim()
  }
}
