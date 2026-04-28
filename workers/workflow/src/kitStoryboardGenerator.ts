import { PDFDocument } from 'pdf-lib'
import { prisma } from '@contentnode/database'
import { uploadBuffer } from '@contentnode/storage'
import type { DocStyle } from './kitGenerator.js'
import { parseScenes, type SceneObject } from './executors/sceneParser.js'
import { getSharedBrowser, closeSharedBrowser, buildStoryboardPageHtml, buildStoryboardCoverHtml } from './storyboardHtml.js'
import type { Job } from 'bullmq'
import type { StoryboardJobData } from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// GPT Image 2 call — generates a single storyboard frame image
// Returns a base64 data URL
// ─────────────────────────────────────────────────────────────────────────────

async function generateStoryboardFrame(opts: {
  scene: SceneObject
  frameIndex: number
  framesPerScene: number
  clientName: string
  verticalName: string
}): Promise<string> {
  const { scene, frameIndex, framesPerScene, clientName, verticalName } = opts
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set — cannot generate storyboard images')

  const frameDescriptions = scene.animationNotes
    .split(/[.\n]+/)
    .map(s => s.trim())
    .filter(Boolean)

  const frameDesc = frameDescriptions[frameIndex] ?? frameDescriptions[0] ?? scene.animationNotes

  const prompt = [
    'Storyboard frame for a professional B2B video.',
    `Scene ${scene.sceneNumber} of ${framesPerScene > 1 ? framesPerScene : 1}: ${scene.sectionLabel}.`,
    `On-screen text concept: ${scene.onScreenText}.`,
    `Animation state: ${frameDesc}.`,
    'Style: cinematic still, professional B2B aesthetic, clean composition, no text overlays, no watermarks, soft lighting.',
    `Brand context: ${clientName} — ${verticalName}.`,
  ].join(' ')

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size: '1536x1024', quality: 'medium' }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GPT Image 2 error ${res.status}: ${err}`)
  }
  const data = await res.json() as { data: { b64_json: string }[] }
  return `data:image/png;base64,${data.data[0].b64_json}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers — stored in generatedFiles.storyboard
// ─────────────────────────────────────────────────────────────────────────────

export interface StoryboardProgress {
  status: 'pending' | 'generating' | 'complete' | 'error'
  framesPerScene: number
  totalScenes: number
  completedScenes: number
  pdfStorageKey?: string
  pdfFilename?: string
  error?: string
  startedAt: string
  completedAt?: string
}

async function setStoryboardProgress(
  sessionId: string,
  patch: Partial<StoryboardProgress>,
): Promise<void> {
  const session = await prisma.kitSession.findUnique({ where: { id: sessionId }, select: { generatedFiles: true } })
  const files = (session?.generatedFiles ?? {}) as Record<string, unknown>
  const current = (files.storyboard ?? {}) as Record<string, unknown>
  await prisma.kitSession.update({
    where: { id: sessionId },
    data: { generatedFiles: { ...files, storyboard: { ...current, ...patch } } as object },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Image cache helpers — stored in storyboardImageCache
// ─────────────────────────────────────────────────────────────────────────────

async function getCachedImage(sessionId: string, key: string): Promise<string | null> {
  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { storyboardImageCache: true },
  })
  const cache = (session?.storyboardImageCache ?? {}) as Record<string, string>
  return cache[key] ?? null
}

async function setCachedImage(sessionId: string, key: string, dataUrl: string): Promise<void> {
  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { storyboardImageCache: true },
  })
  const cache = (session?.storyboardImageCache ?? {}) as Record<string, string>
  await prisma.kitSession.update({
    where: { id: sessionId },
    data: { storyboardImageCache: { ...cache, [key]: dataUrl } as object },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job handler
// ─────────────────────────────────────────────────────────────────────────────

export async function runStoryboardJob(job: Job<StoryboardJobData>): Promise<void> {
  const { sessionId, framesPerScene } = job.data

  await setStoryboardProgress(sessionId, {
    status: 'generating',
    framesPerScene,
    totalScenes: 0,
    completedScenes: 0,
    startedAt: new Date().toISOString(),
  })

  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { generatedFiles: true, storyboardImageCache: true, agencyId: true, client: { select: { name: true } }, vertical: { select: { name: true } } },
  })
  if (!session) throw new Error(`KitSession ${sessionId} not found`)

  const files     = (session.generatedFiles ?? {}) as Record<string, unknown>
  const assets    = (files.assets as Array<Record<string, unknown>>) ?? []
  const docStyle  = (files.docStyle ?? {}) as DocStyle
  const clientName   = session.client?.name   ?? 'Client'
  const verticalName = session.vertical?.name ?? 'Vertical'

  // Read Video Script content (asset index 5)
  const scriptContent = (assets[5]?.content as string | undefined) ?? ''
  if (!scriptContent) throw new Error('KitSession has no Video Script content (asset 5 incomplete)')

  // Parse scenes — use Version A only for storyboard
  const allScenes = parseScenes(scriptContent)
  const scenes    = allScenes.filter(s => s.version === 'A')
  if (scenes.length === 0) throw new Error('Scene parser found no Version A scenes in the video script')

  await setStoryboardProgress(sessionId, { totalScenes: scenes.length })

  const pdfPages: Uint8Array[] = []

  // ── Cover page ──────────────────────────────────────────────────────────────
  {
    const browser = await getSharedBrowser()
    const page    = await browser.newPage()
    const html    = buildStoryboardCoverHtml({ clientName, verticalName, version: 'v1', date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), docStyle })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const buf = await page.pdf({ width: '1400px', height: '1050px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    await page.close()
    pdfPages.push(buf)
  }

  // ── Scene pages ─────────────────────────────────────────────────────────────
  for (const scene of scenes) {
    const frameUrls: string[] = []

    for (let f = 0; f < framesPerScene; f++) {
      const cacheKey = `scene_${scene.sceneNumber}_frame_${f + 1}`
      let dataUrl    = await getCachedImage(sessionId, cacheKey)

      if (!dataUrl) {
        dataUrl = await generateStoryboardFrame({ scene, frameIndex: f, framesPerScene, clientName, verticalName })
        await setCachedImage(sessionId, cacheKey, dataUrl)
      }
      frameUrls.push(dataUrl)
    }

    const browser = await getSharedBrowser()
    const page    = await browser.newPage()
    const html    = buildStoryboardPageHtml({ scene, frameImageUrls: frameUrls, docStyle, clientName, verticalName })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const buf = await page.pdf({ width: '1400px', height: '1050px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    await page.close()
    pdfPages.push(buf)

    await setStoryboardProgress(sessionId, { completedScenes: pdfPages.length - 1 })
  }

  await closeSharedBrowser()

  // ── Assemble PDF ────────────────────────────────────────────────────────────
  const combined = await PDFDocument.create()
  for (const buf of pdfPages) {
    const src      = await PDFDocument.load(buf)
    const [copied] = await combined.copyPages(src, [0])
    combined.addPage(copied)
  }
  const pdfBytes = await combined.save()

  const safeName      = `${clientName} ${verticalName}`.replace(/[^a-zA-Z0-9 ]/g, '').trim()
  const pdfFilename   = `${safeName} - Video Storyboard Draft v1.pdf`
  const pdfStorageKey = `storyboards/${session.agencyId}/${sessionId}/${pdfFilename}`

  await uploadBuffer(pdfStorageKey, Buffer.from(pdfBytes), 'application/pdf')

  await setStoryboardProgress(sessionId, {
    status: 'complete',
    completedScenes: scenes.length,
    pdfStorageKey,
    pdfFilename,
    completedAt: new Date().toISOString(),
  })

  console.log(`[storyboard] job complete — ${scenes.length} scene(s) → ${pdfStorageKey}`)
}
