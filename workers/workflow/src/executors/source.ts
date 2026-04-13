import { join, extname } from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
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
    // config.text is ONLY real content for text-input nodes.
    // file-upload nodes use config.text as a UI placeholder/hint — never as content.
    const subtype = config.subtype as string | undefined
    const isTextInputNode = subtype === 'text-input'
    const inlineContent =
      (config.inlineText as string | undefined) ||
      (isTextInputNode ? (config.text as string | undefined) : undefined) ||
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
      if (parts.length > 0) {
        const nonEmpty = parts.filter((p) => p.trim().length > 0)
        if (nonEmpty.length === 0) {
          const names = fileNames.join(', ')
          throw new Error(
            `Source node: file(s) [${names}] were uploaded but yielded no readable text. ` +
            `This usually means a scanned/image-only PDF. ` +
            `Try: (1) use a text-based PDF, (2) run OCR on it first, or (3) paste the content directly into a Text Input node.`
          )
        }
        const keptNames = fileNames.filter((_, i) => parts[i].trim().length > 0)
        return { output: nonEmpty.join('\n\n---\n\n'), sourceFiles: keptNames }
      }
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
      const parser = new PDFParse({ data: buffer })
      const parsed = await Promise.race([
        parser.getText(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`PDF parsing timed out for "${label}"`)), 30_000)
        ),
      ])
      text = parsed.text
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
