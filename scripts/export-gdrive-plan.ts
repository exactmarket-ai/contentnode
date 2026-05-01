import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  convertInchesToTwip,
} from 'docx'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PRIMARY   = '0057B8'
const SECONDARY = '00A86B'
const DARK      = '1A1A2E'
const LIGHT_BG  = 'F0F4FF'
const BORDER    = 'C5D3E8'
const WHITE     = 'FFFFFF'
const GRAY      = '64748B'

function noBorder() { return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }

function heading1(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 480, after: 160 },
    children: [new TextRun({ text, font: 'Calibri', size: 40, bold: true, color: PRIMARY })],
  })
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, font: 'Calibri', size: 28, bold: true, color: DARK })],
  })
}

function heading3(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, font: 'Calibri', size: 22, bold: true, color: PRIMARY })],
  })
}

function body(text: string, opts: { italic?: boolean; color?: string; spacing?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: opts.spacing ?? 120 },
    children: [new TextRun({ text, font: 'Calibri', size: 20, italics: opts.italic, color: opts.color ?? DARK })],
  })
}

function bullet(text: string, indent = 0): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.3 + indent * 0.25) },
    children: [
      new TextRun({ text: '• ', font: 'Calibri', size: 20, color: PRIMARY }),
      new TextRun({ text, font: 'Calibri', size: 20, color: DARK }),
    ],
  })
}

function code(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: convertInchesToTwip(0.3) },
    children: [new TextRun({ text, font: 'Courier New', size: 18, color: '1E40AF' })],
  })
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
    children: [
      new TextRun({ text: label + ': ', font: 'Calibri', size: 20, bold: true, color: DARK }),
      new TextRun({ text: value, font: 'Calibri', size: 20, color: DARK }),
    ],
  })
}

function divider(): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER } },
    children: [],
  })
}

function sectionBanner(text: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { fill: PRIMARY, type: ShadingType.SOLID, color: PRIMARY },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        children: [new Paragraph({
          children: [new TextRun({ text, font: 'Calibri', size: 26, bold: true, color: WHITE })],
        })],
      })],
    })],
  })
}

function twoColTable(rows: [string, string][], headerRow?: [string, string]): Table {
  const borderStyle = { style: BorderStyle.SINGLE, size: 4, color: BORDER }
  const buildRow = (left: string, right: string, isHeader = false) => new TableRow({
    children: [
      new TableCell({
        width: { size: 35, type: WidthType.PERCENTAGE },
        shading: isHeader ? { fill: LIGHT_BG, type: ShadingType.SOLID, color: LIGHT_BG } : undefined,
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle },
        children: [new Paragraph({ children: [new TextRun({ text: left, font: 'Calibri', size: 19, bold: isHeader, color: isHeader ? PRIMARY : DARK })] })],
      }),
      new TableCell({
        shading: isHeader ? { fill: LIGHT_BG, type: ShadingType.SOLID, color: LIGHT_BG } : undefined,
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle },
        children: [new Paragraph({ children: [new TextRun({ text: right, font: 'Calibri', size: 19, bold: isHeader, color: isHeader ? PRIMARY : DARK })] })],
      }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    rows: [
      ...(headerRow ? [buildRow(headerRow[0], headerRow[1], true)] : []),
      ...rows.map(([l, r]) => buildRow(l, r)),
    ],
  })
}

function callout(text: string, color = LIGHT_BG, borderColor = PRIMARY): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { fill: color, type: ShadingType.SOLID, color },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
          left: { style: BorderStyle.SINGLE, size: 16, color: borderColor },
          right: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        },
        children: [new Paragraph({ children: [new TextRun({ text, font: 'Calibri', size: 19, color: DARK })] })],
      })],
    })],
  })
}

// ─── Document ────────────────────────────────────────────────────────────────

const children: (Paragraph | Table)[] = [

  // Cover
  new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: 'ContentNode', font: 'Calibri', size: 20, bold: true, color: GRAY })],
  }),
  new Paragraph({
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: 'Integration Plan', font: 'Calibri', size: 20, color: GRAY })],
  }),
  new Paragraph({
    spacing: { before: 0, after: 160 },
    children: [new TextRun({ text: 'Google Drive Integration', font: 'Calibri', size: 56, bold: true, color: PRIMARY })],
  }),
  new Paragraph({
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: 'Parallel delivery + feedback loop to Google Drive,', font: 'Calibri', size: 24, color: DARK })],
  }),
  new Paragraph({
    spacing: { before: 0, after: 480 },
    children: [new TextRun({ text: 'matching the existing Box.com integration feature-for-feature.', font: 'Calibri', size: 24, color: DARK })],
  }),
  divider(),

  // ── Section 1: Context ───────────────────────────────────────────────────
  sectionBanner('1. Context & Goal'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  body('ContentNode\'s Box integration is production-complete and covers the full lifecycle: OAuth, per-client/project/run folder creation, DOCX + image delivery, webhook-triggered feedback loops (edit signals → preference profiles → insights), and Monday.com URL writeback.'),
  body(''),
  body('Google Drive replicates that entire lifecycle for agencies on Google Workspace. All new code follows the Box patterns already in the codebase — same Integration table for encrypted tokens, same BullMQ queues for async processing, same HumanizerSignal / brain attachment / profile update pipeline. No new npm packages are introduced; all Drive calls use native fetch, consistent with Box.'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),

  callout('Goal: an agency connects Google Drive in Settings, maps a Drive folder to each client and workflow, and ContentNode delivers files there — just like Box. Stakeholder edits flow back as style signals.', LIGHT_BG, PRIMARY),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 2: What's Required From You ──────────────────────────────────
  sectionBanner('2. What\'s Required From You'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  heading2('Google Cloud Console Setup (~5 minutes)'),
  bullet('Go to console.cloud.google.com → create a new project (or reuse an existing one)'),
  bullet('Enable the Google Drive API for that project'),
  bullet('Go to APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application type)'),
  bullet('Add authorized redirect URI:'),
  code('https://your-api.railway.app/api/v1/integrations/google-drive/callback'),
  bullet('Copy the Client ID and Client Secret'),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Environment Variables (add to Railway — API and Worker services)'),
  code('GOOGLE_DRIVE_CLIENT_ID         = <from Google Cloud Console>'),
  code('GOOGLE_DRIVE_CLIENT_SECRET     = <from Google Cloud Console>'),
  code('GOOGLE_DRIVE_REDIRECT_URI      = https://your-api.railway.app/api/v1/integrations/google-drive/callback'),
  code('GOOGLE_DRIVE_WEBHOOK_TOKEN     = <any random secret string you generate>'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  callout('Note: ENCRYPTION_KEY (already set) is reused for token encryption. No new crypto config needed.', LIGHT_BG, SECONDARY),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 3: Architecture Overview ─────────────────────────────────────
  sectionBanner('3. Architecture Overview'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  body('The integration is structured in five layers, matching Box exactly:'),
  new Paragraph({ spacing: { after: 160 }, children: [] }),

  twoColTable([
    ['OAuth + Token Layer', 'googleDrive.ts route — connect, callback, status, disconnect. Tokens encrypted AES-256-GCM and stored in the Integration table (provider: google_drive).'],
    ['Drive API Client', 'googleDriveClient.ts — thin fetch wrapper for folder create, file upload, file download, push channel register/stop, file share.'],
    ['Delivery Worker', 'googleDriveDelivery.ts — called by runner after run completes. Creates run folder, uploads DOCX + images, shares with stakeholder, registers push channel, writes URL to Monday.'],
    ['Webhook Handler', 'webhooks/googleDrive.ts — receives Google push notifications on file change. Verifies token, downloads new version, creates HumanizerSignal, enqueues diff job.'],
    ['Channel Renewal Cron', 'googleDriveChannelRenewal.ts — BullMQ repeatable job every 6 hours. Renews push channels expiring within 24 hours.'],
  ], ['Layer', 'Responsibility']),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 4: Files ──────────────────────────────────────────────────────
  sectionBanner('4. Files Created and Modified'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  heading2('New Files'),
  twoColTable([
    ['apps/api/src/routes/integrations/googleDrive.ts', 'OAuth routes: connect, callback, status, disconnect. getGoogleDriveToken() helper with auto-refresh.'],
    ['apps/api/src/routes/webhooks/googleDrive.ts', 'Push notification handler. Verifies X-Goog-Channel-Token, downloads new file version, creates signal, enqueues diff.'],
    ['workers/workflow/src/googleDriveClient.ts', 'Raw fetch wrapper: createFolder, ensureSubfolder, uploadFile, downloadFile, registerWatchChannel, stopWatchChannel, shareFile.'],
    ['workers/workflow/src/googleDriveDelivery.ts', 'deliverRunToGoogleDrive() and deliverImageToGoogleDrive(). Parallel to boxDelivery.ts.'],
    ['workers/workflow/src/googleDriveChannelRenewal.ts', 'Repeatable BullMQ job. Queries tracking records with channelExpiry < NOW()+24h, renews each channel.'],
  ], ['File', 'Purpose']),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Modified Files'),
  twoColTable([
    ['packages/database/prisma/schema.prisma', 'New GoogleDriveFileTracking model. Add googleDriveFolderId to Client, googleDriveProjectFolderId to Workflow, deliveryGoogleDriveFileId + Folder to WorkflowRun.'],
    ['workers/workflow/src/runner.ts', 'Add Google Drive delivery path alongside Box. Per-node config: delivery_target: google_drive.'],
    ['workers/workflow/src/worker.ts', 'Register channel renewal repeatable job. Register webhook queue worker.'],
    ['apps/api/src/index.ts', 'Register new googleDrive route plugins.'],
    ['apps/web/src/pages/SettingsPage.tsx', 'Add "Connect Google Drive" OAuth button in integrations section.'],
    ['apps/web/src/pages/ClientDetailPage.tsx', 'Add googleDriveFolderId input field, parallel to boxFolderId.'],
  ], ['File', 'Change']),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Reused Without Changes'),
  bullet('workers/workflow/src/lib/crypto.ts — AES-256-GCM encrypt/decrypt'),
  bullet('workers/workflow/src/boxDiffProcessor.ts — diff + signal extraction (storage-agnostic, reused for Drive diffs)'),
  bullet('workers/workflow/src/mondayWriteback.ts — URL writeback (just a different URL string)'),
  bullet('HumanizerSignal, ClientBrainAttachment, StakeholderPreferenceProfile Prisma models'),
  bullet('QUEUE_BOX_DIFF queue and worker'),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 5: Schema ─────────────────────────────────────────────────────
  sectionBanner('5. Schema Changes'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  heading2('New Model — GoogleDriveFileTracking'),
  body('Parallel to BoxFileTracking. Stores one record per file delivered to Drive.'),
  new Paragraph({ spacing: { after: 100 }, children: [] }),
  twoColTable([
    ['id', 'CUID primary key'],
    ['agencyId', 'FK → Agency'],
    ['clientId', 'FK → Client'],
    ['runId', 'FK → WorkflowRun'],
    ['stakeholderId', 'Nullable FK → Stakeholder (primary recipient)'],
    ['driveFileId', 'Google Drive file ID (unique)'],
    ['driveWebhookChannelId', 'Nullable — channel ID registered for push notifications'],
    ['driveWebhookResourceId', 'Nullable — resource ID returned by Google (needed to stop channel)'],
    ['channelExpiry', 'Nullable DateTime — when push channel expires (max ~7 days)'],
    ['driveFolderId', 'Parent folder ID in Drive'],
    ['filename', 'Original filename delivered'],
    ['originalTextKey', 'Nullable — R2 key of original text (for diff baseline)'],
    ['mondayItemId', 'Nullable — for Monday status writeback'],
    ['revisionCount', 'Int default 0 — incremented each push notification'],
    ['lastVersionAt', 'Nullable DateTime'],
    ['createdAt', 'DateTime default now()'],
  ], ['Field', 'Description']),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Model Field Additions'),
  twoColTable([
    ['Client.googleDriveFolderId', 'String? — root Drive folder ID for this client'],
    ['Workflow.googleDriveProjectFolderId', 'String? — project-level Drive folder'],
    ['WorkflowRun.deliveryGoogleDriveFileId', 'String? — primary delivered file ID'],
    ['WorkflowRun.deliveryGoogleDriveFolderId', 'String? — run delivery folder ID'],
  ], ['Field', 'Type']),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 6: Key Technical Differences vs Box ───────────────────────────
  sectionBanner('6. Key Differences vs Box'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  twoColTable([
    ['Webhook duration', 'Box: persistent until deleted. Google: push channels expire ≤7 days → renewal cron required.'],
    ['Webhook verification', 'Box: HMAC-SHA256 dual-key. Google: X-Goog-Channel-Token static secret sent on registration.'],
    ['File versions', 'Box: explicit version objects. Google: auto-versions on upload; fetch latest with ?alt=media.'],
    ['File sharing', 'Box: metadata tags for attribution. Google: can explicitly share file with stakeholder email (commenter role).'],
    ['Upload endpoint', 'Box: upload.box.com multipart. Google: www.googleapis.com/upload/drive/v3/files multipart.'],
    ['OAuth token lifetime', 'Box: long-lived access tokens (~60 days). Google: access token expires in 1 hour — refresh fires more frequently.'],
    ['SDK approach', 'Both use raw fetch — no external SDK for either.'],
  ], ['Concern', 'Detail']),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 7: Delivery Flow ──────────────────────────────────────────────
  sectionBanner('7. End-to-End Flow'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  heading2('File Delivery'),
  bullet('Workflow run completes'),
  bullet('runner.ts calls deliverRunToGoogleDrive()'),
  bullet('Token auto-refreshed if expired (1-hour window)'),
  bullet('Run subfolder created: {subitem}-{topic}-{date} under workflow.googleDriveProjectFolderId'),
  bullet('DOCX buffer generated (reuses textToDocxBuffer()), uploaded'),
  bullet('File shared with stakeholder email (commenter access)'),
  bullet('Push channel registered (7-day expiry) → channelExpiry stored'),
  bullet('GoogleDriveFileTracking record created'),
  bullet('Monday link column updated with Drive webViewLink'),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Feedback Loop'),
  bullet('Stakeholder edits file in Drive → Google sends push notification to /api/v1/webhooks/google-drive'),
  bullet('Webhook handler verifies X-Goog-Channel-Token'),
  bullet('Looks up GoogleDriveFileTracking by driveWebhookChannelId'),
  bullet('Downloads latest file version, retrieves original from WorkflowRun.output'),
  bullet('Creates HumanizerSignal record (source: gdrive_direct)'),
  bullet('Increments revisionCount, enqueues QUEUE_BOX_DIFF'),
  bullet('Diff processor (boxDiffProcessor.ts) extracts style signals → updates preference profile → generates insights'),
  new Paragraph({ spacing: { after: 160 }, children: [] }),
  heading2('Channel Renewal'),
  bullet('BullMQ repeatable job runs every 6 hours'),
  bullet('Queries GoogleDriveFileTracking where channelExpiry < NOW() + 24h'),
  bullet('For each record: registers new channel, updates channelExpiry + channelId, stops old channel'),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

  divider(),

  // ── Section 8: Verification ───────────────────────────────────────────────
  sectionBanner('8. Verification Checklist'),
  new Paragraph({ spacing: { after: 120 }, children: [] }),
  body('After implementation, verify end-to-end before pushing to main:'),
  new Paragraph({ spacing: { after: 100 }, children: [] }),
  twoColTable([
    ['Migration', 'pnpm prisma migrate dev — confirm applies cleanly, all new fields present'],
    ['OAuth connect', 'Hit /api/v1/integrations/google-drive/connect — Google consent screen opens, scopes shown correctly'],
    ['Token storage', 'Complete OAuth — Integration record created with encrypted tokens (check DB)'],
    ['Folder creation', 'Configure client googleDriveFolderId — create a workflow, confirm project subfolder created in Drive'],
    ['File delivery', 'Run a workflow with delivery_target: google_drive — DOCX appears in Drive run folder'],
    ['File sharing', 'Stakeholder email on run — confirm Drive file shared with commenter access'],
    ['Monday writeback', 'Confirm Monday link column updated with Drive webViewLink after delivery'],
    ['Push notification', 'Edit delivered file in Drive — confirm webhook fires, HumanizerSignal created, QUEUE_BOX_DIFF enqueued'],
    ['Channel renewal', 'Set channelExpiry to NOW() on a test record — confirm cron renews it within 6 hours'],
    ['Token refresh', 'Wait 61 minutes (or manually expire token in DB) — confirm next API call refreshes automatically'],
  ], ['Test', 'Expected Result']),
  new Paragraph({ spacing: { after: 200 }, children: [] }),

]

const doc = new Document({
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertInchesToTwip(1),
          bottom: convertInchesToTwip(1),
          left: convertInchesToTwip(1.1),
          right: convertInchesToTwip(1.1),
        },
      },
    },
    children,
  }],
})

async function main() {
  const buf = await Packer.toBuffer(doc)
  const outPath = join(homedir(), 'Downloads', 'ContentNode-GoogleDrive-Integration-Plan.docx')
  writeFileSync(outPath, buf)
  console.log('✓ Saved:', outPath)
}

main()
