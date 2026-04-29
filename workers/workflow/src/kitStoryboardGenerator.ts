import { PDFDocument } from 'pdf-lib'
import { prisma } from '@contentnode/database'
import { uploadBuffer, downloadBuffer } from '@contentnode/storage'
import type { DocStyle } from './kitGenerator.js'
import { parseScenes, type SceneObject } from './executors/sceneParser.js'
import puppeteer from 'puppeteer'
import { resolveChromiumPath, CHROMIUM_LAUNCH_ARGS, buildStoryboardPageHtml, buildStoryboardCoverHtml } from './storyboardHtml.js'
import type { Job } from 'bullmq'
import {
  QUEUE_STORYBOARD_SCENE,
  QUEUE_STORYBOARD_ASSEMBLE,
  type StoryboardJobData,
  type StoryboardSceneJobData,
  type StoryboardAssembleJobData,
  createQueue,
} from './queues.js'

// ─────────────────────────────────────────────────────────────────────────────
// Queue singletons — created once per process
// ─────────────────────────────────────────────────────────────────────────────

let _sceneQueue: ReturnType<typeof createQueue<StoryboardSceneJobData>> | null = null
let _assembleQueue: ReturnType<typeof createQueue<StoryboardAssembleJobData>> | null = null

function getSceneQueue() {
  if (!_sceneQueue) _sceneQueue = createQueue<StoryboardSceneJobData>(QUEUE_STORYBOARD_SCENE)
  return _sceneQueue
}
function getAssembleQueue() {
  if (!_assembleQueue) _assembleQueue = createQueue<StoryboardAssembleJobData>(QUEUE_STORYBOARD_ASSEMBLE)
  return _assembleQueue
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StoryboardSceneRecord {
  sceneNumber: number
  status: 'pending' | 'generating' | 'complete' | 'error'
  pageStorageKey?: string
  error?: string
}

export interface StoryboardProgress {
  status: 'pending' | 'generating' | 'complete' | 'error'
  framesPerScene: number
  totalScenes: number
  completedScenes: number
  scenes: StoryboardSceneRecord[]
  coverStorageKey?: string
  pdfStorageKey?: string
  pdfFilename?: string
  error?: string
  startedAt: string
  completedAt?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getStoryboard(sessionId: string): Promise<{ storyboard: StoryboardProgress; files: Record<string, unknown> }> {
  const session = await prisma.kitSession.findUnique({ where: { id: sessionId }, select: { generatedFiles: true } })
  const files = (session?.generatedFiles ?? {}) as Record<string, unknown>
  const storyboard = (files.storyboard ?? {}) as StoryboardProgress
  return { storyboard, files }
}

async function patchStoryboard(sessionId: string, patch: Partial<StoryboardProgress>): Promise<void> {
  const { storyboard, files } = await getStoryboard(sessionId)
  await prisma.kitSession.update({
    where: { id: sessionId },
    data: { generatedFiles: { ...files, storyboard: { ...storyboard, ...patch } } as object },
  })
}

async function patchScene(sessionId: string, sceneNumber: number, patch: Partial<StoryboardSceneRecord>): Promise<StoryboardProgress> {
  const { storyboard, files } = await getStoryboard(sessionId)
  const scenes = (storyboard.scenes ?? []).map(s =>
    s.sceneNumber === sceneNumber ? { ...s, ...patch } : s,
  )
  const completedScenes = scenes.filter(s => s.status === 'complete').length
  const updated: StoryboardProgress = { ...storyboard, scenes, completedScenes }
  await prisma.kitSession.update({
    where: { id: sessionId },
    data: { generatedFiles: { ...files, storyboard: updated } as object },
  })
  return updated
}

// ─────────────────────────────────────────────────────────────────────────────
// Image generation (GPT Image 2)
// ─────────────────────────────────────────────────────────────────────────────

async function generateFrame(scene: SceneObject, frameIndex: number, framesPerScene: number, clientName: string, verticalName: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const frameDescs = scene.animationNotes.split(/[.\n]+/).map(s => s.trim()).filter(Boolean)
  const frameDesc  = frameDescs[frameIndex] ?? frameDescs[0] ?? scene.animationNotes

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
  if (!res.ok) throw new Error(`GPT Image 2 error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { data: { b64_json: string }[] }
  return `data:image/png;base64,${data.data[0].b64_json}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 1 — Orchestrator: parse scenes, enqueue per-scene jobs
// ─────────────────────────────────────────────────────────────────────────────

export async function runStoryboardJob(job: Job<StoryboardJobData>): Promise<void> {
  const { sessionId, agencyId, framesPerScene } = job.data

  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { generatedFiles: true, agencyId: true, client: { select: { name: true } }, vertical: { select: { name: true } } },
  })
  if (!session) throw new Error(`KitSession ${sessionId} not found`)

  const files       = (session.generatedFiles ?? {}) as Record<string, unknown>
  const assets      = (files.assets as Array<Record<string, unknown>>) ?? []
  const scriptContent = (assets[5]?.content as string | undefined) ?? ''
  if (!scriptContent) throw new Error('Video Script (asset 5) is not complete')

  const allScenes = parseScenes(scriptContent)
  const scenes    = allScenes.filter(s => s.version === 'A')
  if (scenes.length === 0) throw new Error('Scene parser found no Version A scenes')

  // Build scene list — skip any that already have a completed page (resume support)
  const existing = ((files.storyboard as StoryboardProgress | undefined)?.scenes ?? [])
  const sceneRecords: StoryboardSceneRecord[] = scenes.map(s => {
    const prev = existing.find(e => e.sceneNumber === s.sceneNumber)
    if (prev?.status === 'complete' && prev.pageStorageKey) return prev
    return { sceneNumber: s.sceneNumber, status: 'pending' }
  })

  const completedScenes = sceneRecords.filter(s => s.status === 'complete').length

  await patchStoryboard(sessionId, {
    status: 'generating',
    framesPerScene,
    totalScenes: scenes.length,
    completedScenes,
    scenes: sceneRecords,
    startedAt: new Date().toISOString(),
  })

  // Render cover page and upload it once
  const docStyle    = (files.docStyle ?? {}) as DocStyle
  const clientName  = session.client?.name   ?? 'Client'
  const verticalName = session.vertical?.name ?? 'Vertical'
  const date        = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const browser   = await puppeteer.launch({ headless: true, executablePath: resolveChromiumPath(), args: CHROMIUM_LAUNCH_ARGS })
  const coverPage = await browser.newPage()
  await coverPage.setContent(buildStoryboardCoverHtml({ clientName, verticalName, version: 'v1', date, docStyle }), { waitUntil: 'networkidle0' })
  const coverBuf  = await coverPage.pdf({ width: '1400px', height: '1050px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
  await coverPage.close()
  await browser.close()

  const coverKey = `storyboards/${agencyId}/${sessionId}/cover.pdf`
  await uploadBuffer(coverKey, Buffer.from(coverBuf), 'application/pdf')
  await patchStoryboard(sessionId, { coverStorageKey: coverKey })

  // Enqueue one job per scene that still needs processing
  const pending = sceneRecords.filter(s => s.status !== 'complete')
  console.log(`[storyboard] orchestrator: ${scenes.length} scenes total, ${completedScenes} already done, enqueueing ${pending.length}`)

  for (const s of pending) {
    await getSceneQueue().add(
      `scene-${s.sceneNumber}`,
      { sessionId, agencyId, sceneNumber: s.sceneNumber, framesPerScene },
      { removeOnComplete: { count: 20 }, removeOnFail: { count: 10 } },
    )
  }

  // If all scenes were already complete (full resume), trigger assembly directly
  if (pending.length === 0) {
    await getAssembleQueue().add(
      'assemble',
      { sessionId, agencyId },
      { jobId: `assemble-${sessionId}`, removeOnComplete: { count: 20 }, removeOnFail: { count: 10 } },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 2 — Scene: generate images + render single-page PDF + upload
// ─────────────────────────────────────────────────────────────────────────────

export async function runStoryboardSceneJob(job: Job<StoryboardSceneJobData>): Promise<void> {
  const { sessionId, agencyId, sceneNumber, framesPerScene } = job.data
  console.log(`[storyboard-scene] scene ${sceneNumber} starting`)

  await patchScene(sessionId, sceneNumber, { status: 'generating' })

  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { generatedFiles: true, storyboardImageCache: true, client: { select: { name: true } }, vertical: { select: { name: true } } },
  })
  if (!session) throw new Error(`KitSession ${sessionId} not found`)

  const files       = (session.generatedFiles ?? {}) as Record<string, unknown>
  const assets      = (files.assets as Array<Record<string, unknown>>) ?? []
  const scriptContent = (assets[5]?.content as string | undefined) ?? ''
  const docStyle    = (files.docStyle ?? {}) as DocStyle
  const clientName  = session.client?.name   ?? 'Client'
  const verticalName = session.vertical?.name ?? 'Vertical'

  const allScenes = parseScenes(scriptContent)
  const scene     = allScenes.find(s => s.version === 'A' && s.sceneNumber === sceneNumber)
  if (!scene) throw new Error(`Scene ${sceneNumber} not found in video script`)

  // Generate frames — use image cache to survive retries
  const cache  = (session.storyboardImageCache ?? {}) as Record<string, string>
  const frameUrls: string[] = []

  for (let f = 0; f < framesPerScene; f++) {
    const cacheKey = `scene_${sceneNumber}_frame_${f + 1}`
    let dataUrl    = cache[cacheKey] ?? null

    if (!dataUrl) {
      dataUrl = await generateFrame(scene, f, framesPerScene, clientName, verticalName)
      // Write image to cache immediately
      const latestSession = await prisma.kitSession.findUnique({ where: { id: sessionId }, select: { storyboardImageCache: true } })
      const latestCache   = (latestSession?.storyboardImageCache ?? {}) as Record<string, string>
      await prisma.kitSession.update({
        where: { id: sessionId },
        data: { storyboardImageCache: { ...latestCache, [cacheKey]: dataUrl } as object },
      })
    }
    frameUrls.push(dataUrl)
  }

  // Render single-page PDF — private browser per scene (avoids shared-browser races)
  const browser = await puppeteer.launch({ headless: true, executablePath: resolveChromiumPath(), args: CHROMIUM_LAUNCH_ARGS })
  const page    = await browser.newPage()
  let buf: Uint8Array
  try {
    await page.setContent(
      buildStoryboardPageHtml({ scene, frameImageUrls: frameUrls, docStyle, clientName, verticalName }),
      { waitUntil: 'networkidle0' },
    )
    buf = await page.pdf({ width: '1400px', height: '1050px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  // Upload page PDF
  const paddedNum = String(sceneNumber).padStart(2, '0')
  const pageKey   = `storyboards/${agencyId}/${sessionId}/scenes/scene-${paddedNum}.pdf`
  await uploadBuffer(pageKey, Buffer.from(buf), 'application/pdf')

  // Mark scene complete
  await patchScene(sessionId, sceneNumber, { status: 'complete', pageStorageKey: pageKey })
  console.log(`[storyboard-scene] scene ${sceneNumber} complete → ${pageKey}`)

  // Fresh DB read — avoid race condition when multiple scenes complete simultaneously
  const { storyboard: fresh } = await getStoryboard(sessionId)
  const allDone = fresh.scenes.length > 0
    && fresh.scenes.every(s => s.status === 'complete' && s.pageStorageKey)
    && !fresh.pdfStorageKey

  if (allDone) {
    console.log(`[storyboard-scene] all ${fresh.scenes.length} scenes confirmed complete — enqueueing assembly`)
    // Fixed jobId deduplicates if two scenes complete simultaneously and both try to trigger
    await getAssembleQueue().add(
      'assemble',
      { sessionId, agencyId },
      { jobId: `assemble-${sessionId}`, removeOnComplete: { count: 20 }, removeOnFail: { count: 10 } },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job 3 — Assembly: merge cover + all scene PDFs into combined file
// ─────────────────────────────────────────────────────────────────────────────

export async function runStoryboardAssembleJob(job: Job<StoryboardAssembleJobData>): Promise<void> {
  const { sessionId, agencyId } = job.data
  console.log(`[storyboard-assemble] starting assembly for session ${sessionId}`)

  const session = await prisma.kitSession.findUnique({
    where: { id: sessionId },
    select: { generatedFiles: true, client: { select: { name: true } }, vertical: { select: { name: true } } },
  })
  if (!session) throw new Error(`KitSession ${sessionId} not found`)

  const files      = (session.generatedFiles ?? {}) as Record<string, unknown>
  const storyboard = (files.storyboard ?? {}) as StoryboardProgress
  const clientName = session.client?.name   ?? 'Client'
  const verticalName = session.vertical?.name ?? 'Vertical'

  // Collect all page keys in scene order
  const scenes = [...(storyboard.scenes ?? [])].sort((a, b) => a.sceneNumber - b.sceneNumber)
  const pageKeys = [
    ...(storyboard.coverStorageKey ? [storyboard.coverStorageKey] : []),
    ...scenes.filter(s => s.pageStorageKey).map(s => s.pageStorageKey as string),
  ]

  if (pageKeys.length === 0) throw new Error('No page PDFs found to assemble')

  // Download and merge
  const combined = await PDFDocument.create()
  for (const key of pageKeys) {
    const buf       = await downloadBuffer(key)
    const src       = await PDFDocument.load(buf)
    const [copied]  = await combined.copyPages(src, [0])
    combined.addPage(copied)
  }
  const pdfBytes = await combined.save()

  const safeName      = `${clientName} ${verticalName}`.replace(/[^a-zA-Z0-9 ]/g, '').trim()
  const pdfFilename   = `${safeName} - Video Storyboard Draft v1.pdf`
  const pdfStorageKey = `storyboards/${agencyId}/${sessionId}/${pdfFilename}`

  await uploadBuffer(pdfStorageKey, Buffer.from(pdfBytes), 'application/pdf')

  await patchStoryboard(sessionId, {
    status: 'complete',
    pdfStorageKey,
    pdfFilename,
    completedAt: new Date().toISOString(),
  })

  console.log(`[storyboard-assemble] combined PDF uploaded → ${pdfStorageKey}`)
}
