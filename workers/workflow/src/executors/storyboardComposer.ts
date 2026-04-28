import puppeteer, { type Browser } from 'puppeteer'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'
import type { SceneObject } from './sceneParser.js'
import type { DocStyle } from '../kitGenerator.js'

// Module-level browser instance — reused across all pages in one job
let sharedBrowser: Browser | null = null

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.connected) {
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
  }
  return sharedBrowser
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close()
    sharedBrowser = null
  }
}

function frameGridCss(count: number): string {
  if (count === 1) return 'grid-template-columns: 1fr;'
  if (count === 2) return 'grid-template-columns: 1fr 1fr;'
  return 'grid-template-columns: 1fr 1fr;'
}

function buildHtml(opts: {
  scene: SceneObject
  frameImageUrls: string[]
  docStyle: DocStyle
  clientName: string
  verticalName: string
}): string {
  const { scene, frameImageUrls, docStyle, clientName, verticalName } = opts
  const primary = docStyle.primaryColor ?? '#1B1F3B'
  const secondary = docStyle.secondaryColor ?? '#4A90D9'
  const bodyFont = docStyle.bodyFont ?? 'sans-serif'
  const frameCount = Math.max(frameImageUrls.length, 1)

  const frameHtml = frameImageUrls
    .map((url, i) => {
      const label = `${scene.sceneNumber}.${i + 1}`
      return `
        <div class="frame-cell">
          <div class="frame-label">${label}</div>
          <img src="${url}" alt="Frame ${label}" />
        </div>`
    })
    .join('\n')

  const animationLines = scene.animationNotes
    .split(/[.\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => `<li>${i + 1}. ${l}</li>`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1400px; height: 1050px; overflow: hidden;
    font-family: ${bodyFont}, 'Helvetica Neue', sans-serif;
    background: #ffffff;
    display: flex; flex-direction: column;
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0 24px;
    height: 52px; min-height: 52px;
    background: ${primary};
    border-bottom: 1px solid rgba(255,255,255,0.15);
  }
  .header-left  { color: #fff; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
  .header-right { color: rgba(255,255,255,0.8); font-size: 14px; }
  .body {
    display: flex; flex: 1; overflow: hidden;
  }
  .sidebar {
    width: 280px; min-width: 280px;
    padding: 20px 18px;
    border-right: 1px solid #e5e7eb;
    display: flex; flex-direction: column; gap: 16px;
    overflow-y: auto;
  }
  .sidebar-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: #9ca3af; margin-bottom: 4px;
  }
  .sidebar-content {
    font-size: 13px; line-height: 1.55; color: #1f2937;
  }
  .section-pill {
    display: inline-block;
    background: ${secondary};
    color: #fff;
    font-size: 10px; font-weight: 600;
    padding: 2px 10px; border-radius: 999px;
    letter-spacing: 0.05em; text-transform: uppercase;
    margin-bottom: 12px;
  }
  .timecode {
    font-size: 11px; color: #6b7280; margin-bottom: 8px;
  }
  .animation-list {
    list-style: none; font-size: 12px; line-height: 1.7; color: #374151;
    padding-left: 0;
  }
  .frames-area {
    flex: 1; padding: 16px;
    display: grid;
    gap: 12px;
    ${frameGridCss(frameCount)}
    align-content: start;
  }
  .frame-cell {
    position: relative; background: #f3f4f6; border-radius: 6px;
    overflow: hidden; aspect-ratio: 16/9;
  }
  .frame-cell img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .frame-label {
    position: absolute; top: 8px; right: 8px;
    background: ${primary}; color: #fff;
    font-size: 11px; font-weight: 700;
    padding: 2px 8px; border-radius: 4px;
    z-index: 1;
  }
  .footer {
    height: 32px; min-height: 32px;
    padding: 0 24px;
    display: flex; align-items: center;
    border-top: 1px solid #e5e7eb;
    color: #9ca3af; font-size: 11px;
  }
</style>
</head>
<body>
  <div class="header">
    <span class="header-left">${clientName} · ${verticalName}</span>
    <span class="header-right">Scene ${scene.sceneNumber} of ${scene.version === 'A' ? '60s' : '90s'}</span>
  </div>
  <div class="body">
    <div class="sidebar">
      <div>
        <div class="section-pill">${scene.sectionLabel}</div>
        <div class="timecode">${scene.timecode}</div>
      </div>
      <div>
        <div class="sidebar-label">On-Screen Text</div>
        <div class="sidebar-content">${scene.onScreenText || '—'}</div>
      </div>
      <div>
        <div class="sidebar-label">Animation Notes</div>
        <ul class="animation-list">
          ${animationLines || `<li>${scene.animationNotes || '—'}</li>`}
        </ul>
      </div>
    </div>
    <div class="frames-area">
      ${frameHtml || '<div class="frame-cell" style="background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:13px;">No image</div>'}
    </div>
  </div>
  <div class="footer">Notes for Video: No voiceover.</div>
</body>
</html>`
}

function buildCoverHtml(opts: {
  clientName: string
  verticalName: string
  version: string
  date: string
  docStyle: DocStyle
}): string {
  const { clientName, verticalName, version, date, docStyle } = opts
  const primary   = docStyle.primaryColor ?? '#1B1F3B'
  const secondary = docStyle.secondaryColor ?? '#4A90D9'
  const headFont  = docStyle.headingFont ?? 'sans-serif'
  const bodyFont  = docStyle.bodyFont ?? 'sans-serif'
  const logoHtml  = docStyle.logoDataUrl
    ? `<img src="${docStyle.logoDataUrl}" style="height:60px;width:auto;object-fit:contain;margin-bottom:40px;" />`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body {
    width: 1400px; height: 1050px; overflow: hidden; margin: 0;
    background: ${primary};
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: ${headFont}, 'Helvetica Neue', sans-serif;
    text-align: center;
  }
  h1 { font-size: 52px; font-weight: 800; color: #fff; margin: 0 0 16px; letter-spacing: -0.01em; }
  h2 { font-size: 26px; font-weight: 400; color: rgba(255,255,255,0.75); margin: 0 0 32px; font-family: ${bodyFont}; }
  .meta {
    font-family: ${bodyFont}; font-size: 14px; color: rgba(255,255,255,0.45);
    letter-spacing: 0.06em; text-transform: uppercase;
  }
  .accent-bar {
    width: 80px; height: 4px; background: ${secondary};
    border-radius: 2px; margin: 28px auto;
  }
</style>
</head>
<body>
  ${logoHtml}
  <h1>${clientName}</h1>
  <div class="accent-bar"></div>
  <h2>${verticalName} — Video Script Storyboard</h2>
  <div class="meta">Draft ${version} · ${date} · Internal Production Use</div>
</body>
</html>`
}

export interface StoryboardComposerConfig {
  clientName?: string
  verticalName?: string
  version?: string
}

export interface StoryboardPageInput {
  scene: SceneObject
  frameImageUrls: string[]
  docStyle: DocStyle
  clientName: string
  verticalName: string
  isCover?: boolean
  coverVersion?: string
  coverDate?: string
}

/**
 * Storyboard Page Composer — renders one storyboard page (or cover) to PDF bytes.
 *
 * Input: StoryboardPageInput object.
 * Output: { pdfBytes: number[] } — a single-page PDF as a number array (for JSON serialisation).
 */
export class StoryboardComposerExecutor extends NodeExecutor {
  async execute(
    input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const data = input as StoryboardPageInput
    if (!data || typeof data !== 'object') {
      throw new Error('StoryboardComposer expects a StoryboardPageInput object as input.')
    }

    const cfg = config as StoryboardComposerConfig
    const clientName   = data.clientName   || cfg.clientName   || 'Client'
    const verticalName = data.verticalName || cfg.verticalName || 'Vertical'

    const html = data.isCover
      ? buildCoverHtml({
          clientName, verticalName,
          version:  data.coverVersion ?? 'v1',
          date:     data.coverDate    ?? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          docStyle: data.docStyle,
        })
      : buildHtml({
          scene:          data.scene,
          frameImageUrls: data.frameImageUrls ?? [],
          docStyle:       data.docStyle,
          clientName, verticalName,
        })

    const browser = await getSharedBrowser()
    const page    = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const pdfBuffer = await page.pdf({
        width:           '1400px',
        height:          '1050px',
        printBackground: true,
        margin:          { top: '0', right: '0', bottom: '0', left: '0' },
      })
      return { output: { pdfBytes: Array.from(pdfBuffer) } }
    } finally {
      await page.close()
    }
  }
}
