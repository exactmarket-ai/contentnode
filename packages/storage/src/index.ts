/**
 * Storage abstraction — local disk in dev, S3-compatible in production.
 *
 * Set S3_BUCKET env var to enable S3 mode.
 * Works with AWS S3 and Cloudflare R2 (set S3_ENDPOINT for R2).
 *
 * Env vars (S3 mode):
 *   S3_BUCKET              — bucket name (required to enable S3 mode)
 *   S3_REGION              — region (default: us-east-1; use 'auto' for R2)
 *   AWS_ACCESS_KEY_ID      — access key
 *   AWS_SECRET_ACCESS_KEY  — secret key
 *   S3_ENDPOINT            — custom endpoint for R2/MinIO (optional)
 *
 * Env vars (local mode):
 *   UPLOAD_DIR             — local directory (default: ./uploads)
 */

import { createWriteStream, mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable, pipeline as streamPipeline } from 'node:stream'
import { promisify } from 'node:util'

const pipeline = promisify(streamPipeline)

// ─── Config ───────────────────────────────────────────────────────────────────

const S3_BUCKET   = process.env.S3_BUCKET ?? ''
const S3_REGION   = process.env.S3_REGION ?? 'us-east-1'
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? undefined   // R2 / MinIO
const UPLOAD_DIR  = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')

export function isS3Mode(): boolean {
  return !!S3_BUCKET
}

// ─── S3 client (lazy-loaded so local mode has zero AWS overhead) ──────────────

let _s3Client: import('@aws-sdk/client-s3').S3Client | null = null

async function getS3Client() {
  if (_s3Client) return _s3Client
  const { S3Client } = await import('@aws-sdk/client-s3')
  _s3Client = new S3Client({
    region: S3_REGION,
    ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
  })
  return _s3Client
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload from a Node.js Readable stream (multipart file upload).
 * In local mode: streams to disk.
 * In S3 mode: streams to S3 using multipart upload.
 */
export async function uploadStream(
  storageKey: string,
  stream: Readable,
  contentType = 'application/octet-stream',
): Promise<void> {
  if (!isS3Mode()) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
    const filePath = join(UPLOAD_DIR, storageKey)
    await pipeline(stream, createWriteStream(filePath))
    return
  }

  const { Upload } = await import('@aws-sdk/lib-storage')
  const s3 = await getS3Client()
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: S3_BUCKET,
      Key: storageKey,
      Body: stream,
      ContentType: contentType,
    },
  })
  await upload.done()
}

/**
 * Upload from a Buffer (e.g. transformed content).
 */
export async function uploadBuffer(
  storageKey: string,
  buffer: Buffer,
  contentType = 'application/octet-stream',
): Promise<void> {
  if (!isS3Mode()) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
    await writeFile(join(UPLOAD_DIR, storageKey), buffer)
    return
  }

  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = await getS3Client()
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType,
  }))
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a file as a Buffer.
 * In local mode: reads from disk.
 * In S3 mode: downloads from S3.
 */
export async function downloadBuffer(storageKey: string): Promise<Buffer> {
  if (!isS3Mode()) {
    const filePath = join(UPLOAD_DIR, storageKey)
    return Buffer.from(readFileSync(filePath))
  }

  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = await getS3Client()
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }))
  if (!res.Body) throw new Error(`S3: empty body for key "${storageKey}"`)

  // Collect stream into buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a stored file.
 */
export async function deleteObject(storageKey: string): Promise<void> {
  if (!isS3Mode()) {
    const filePath = join(UPLOAD_DIR, storageKey)
    if (existsSync(filePath)) unlinkSync(filePath)
    return
  }

  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = await getS3Client()
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }))
}

// ─── Local path helper (dev only) ────────────────────────────────────────────

/**
 * Returns the absolute local path for a storageKey.
 * Only valid in local mode — throws in S3 mode.
 * Used by legacy code that needs a file path (e.g. pdf2json).
 */
export function localPath(storageKey: string): string {
  if (isS3Mode()) throw new Error('localPath() called in S3 mode — use downloadBuffer() instead')
  return resolve(join(UPLOAD_DIR, storageKey))
}

// ─── Generated asset storage ─────────────────────────────────────────────────

/**
 * Save a generated asset (image, video, audio) to persistent local storage.
 *
 * Accepts either:
 *   - A URL string — the file is fetched and the response body is saved
 *   - A Buffer — saved directly
 *
 * Files are stored under the "generated/" prefix so they are grouped separately
 * from user-uploaded documents.
 *
 * Returns the storage key (e.g. "generated/abc123.jpg") which can be used to
 * derive the public serving path: `/files/generated/abc123.jpg`
 */
export async function saveGeneratedFile(
  source: string | Buffer,
  filename: string,
  contentType = 'application/octet-stream',
): Promise<string> {
  const storageKey = `generated/${filename}`

  let buffer: Buffer

  if (typeof source === 'string') {
    // Fetch from URL (provider temporary URL or localhost provider endpoint)
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`Failed to fetch generated file from ${source}: HTTP ${response.status}`)
    }
    buffer = Buffer.from(await response.arrayBuffer())
  } else {
    buffer = source
  }

  await uploadBuffer(storageKey, buffer, contentType)
  return storageKey
}

export { UPLOAD_DIR }
