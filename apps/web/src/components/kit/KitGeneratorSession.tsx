/**
 * KitGeneratorSession — full-page GTM Kit Generator overlay.
 *
 * Phases: intake → mode → generating → checkpoint (full mode only) → delivery
 */
import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { downloadKit, type DocStyle } from '@/lib/kitDownload'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
  blocking: boolean
}

interface IntakeValidation {
  errors: ValidationError[]
  blocking: boolean
  blockingCount: number
  warningCount: number
}

interface AssetRecord {
  index: number
  name: string
  num: string
  ext: string
  status: 'pending' | 'generating' | 'complete' | 'error'
  content?: string
  stage?: string
  completedAt?: string
  error?: string
}

interface GeneratedFiles {
  assets?: AssetRecord[]
  docStyle?: DocStyle
  checkpointQuestions?: string
  consistencyIssues?: string[]
  storyboard?: StoryboardProgress
}

interface StoryboardSceneRecord {
  sceneNumber: number
  status: 'pending' | 'generating' | 'complete' | 'error'
  pageStorageKey?: string
  error?: string
}

interface StoryboardProgress {
  status: 'pending' | 'generating' | 'complete' | 'error'
  framesPerScene: number
  totalScenes: number
  completedScenes: number
  scenes: StoryboardSceneRecord[]
  pdfStorageKey?: string
  pdfFilename?: string
  error?: string
  startedAt: string
  completedAt?: string
}

interface KitSessionData {
  id: string
  mode: string
  status: string
  currentAsset: number | null
  approvedAssets: number[]
  chatHistory: { role: string; content: string; assetIndex?: number }[]
  intakeJson: Record<string, unknown> | null
  generatedFiles: GeneratedFiles
}

interface ArchivedSession {
  id: string
  mode: string
  createdAt: string
  updatedAt: string
}

interface IntakeResponse {
  intake: Record<string, unknown>
  validation: IntakeValidation
  meta: {
    clientName: string
    verticalName: string
    frameworkLastUpdated: string | null
  }
}

// ── Asset manifest ────────────────────────────────────────────────────────────

const ASSETS = [
  { index: 0, num: '01', name: 'Brochure',          ext: 'docx' },
  { index: 1, num: '02', name: 'eBook',             ext: 'html' },
  { index: 2, num: '03', name: 'Sales Cheat Sheet', ext: 'html' },
  { index: 3, num: '04', name: 'BDR Emails',        ext: 'docx' },
  { index: 4, num: '05', name: 'Customer Deck',     ext: 'pptx' },
  { index: 5, num: '06', name: 'Video Script',      ext: 'docx' },
  { index: 6, num: '07', name: 'Web Page Copy',     ext: 'docx' },
  { index: 7, num: '08', name: 'Internal Brief',    ext: 'docx' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function AssetTracker({ approvedAssets, currentAsset }: { approvedAssets: number[]; currentAsset: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Assets</p>
      {ASSETS.map((a) => {
        const approved = approvedAssets.includes(a.index)
        const active   = currentAsset === a.index
        return (
          <div
            key={a.index}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
              approved ? 'bg-green-50 text-green-700'
                : active  ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-400',
            )}
          >
            <span className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              approved ? 'bg-green-500 text-white'
                : active  ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-400',
            )}>
              {approved ? '✓' : a.num}
            </span>
            <span className="truncate">{a.name}</span>
            {active && (
              <span className="ml-auto shrink-0 text-[10px] font-medium text-blue-500">In progress</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ValidationBanner({ validation }: { validation: IntakeValidation }) {
  if (validation.errors.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <span className="text-base">✓</span>
        <span>All required fields are complete. Ready to generate.</span>
      </div>
    )
  }

  const blocking = validation.errors.filter((e) => e.blocking)
  const warnings = validation.errors.filter((e) => !e.blocking)

  return (
    <div className="flex flex-col gap-2">
      {blocking.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-red-800">
            {blocking.length} required field{blocking.length > 1 ? 's' : ''} missing — generation blocked
          </p>
          <ul className="flex flex-col gap-1">
            {blocking.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-amber-800">
            {warnings.length} warning{warnings.length > 1 ? 's' : ''} — generation will proceed with placeholders
          </p>
          <ul className="flex flex-col gap-1">
            {warnings.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ModeSelector({ value, onChange }: { value: 'full' | 'quick'; onChange: (v: 'full' | 'quick') => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        onClick={() => onChange('full')}
        className={cn(
          'rounded-xl border-2 p-4 text-left transition-all',
          value === 'full'
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-white hover:border-gray-300',
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Full Session</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', value === 'full' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500')}>
            Recommended
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Generates assets one at a time with sparring checkpoints and review between each. Best for new verticals or first-time kit generation.
        </p>
      </button>
      <button
        onClick={() => onChange('quick')}
        className={cn(
          'rounded-xl border-2 p-4 text-left transition-all',
          value === 'quick'
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 bg-white hover:border-gray-300',
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Quick Generate</span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Generates all 8 assets back to back with no sparring checkpoints, then delivers all files at once. Use when time is short and the framework is already validated.
        </p>
      </button>
    </div>
  )
}

function IntakeJsonViewer({ intake }: { intake: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)

  const summary = [
    { label: 'Vertical',        value: (intake.vertical as Record<string, unknown>)?.name as string },
    { label: 'Segments',        value: `${((intake.segments as unknown[]) ?? []).length} defined` },
    { label: 'Statistics',      value: `${((intake.statistics as unknown[]) ?? []).length} with source` },
    { label: 'Challenges',      value: `${((intake.challenges as unknown[]) ?? []).length} total` },
    { label: 'Differentiators', value: `${((intake.differentiators as unknown[]) ?? []).length} total` },
    { label: 'Case Studies',    value: `${((intake.case_studies as unknown[]) ?? []).length} total` },
    { label: 'Objections',      value: `${((intake.objections as unknown[]) ?? []).length} total` },
    { label: 'Regulatory',      value: `${((intake.regulatory_frameworks as unknown[]) ?? []).length} frameworks` },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">Intake Data Summary</p>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {expanded ? 'Hide JSON' : 'View full JSON'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-0 border-t border-gray-200">
        {summary.map((item) => (
          <div key={item.label} className="border-r border-b border-gray-200 px-4 py-2.5 last:border-r-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{item.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-800 truncate">{item.value || '—'}</p>
          </div>
        ))}
      </div>
      {expanded && (
        <div className="border-t border-gray-200 p-4">
          <pre className="max-h-96 overflow-y-auto rounded-lg bg-gray-900 p-4 text-[11px] text-green-400 leading-relaxed">
            {JSON.stringify(intake, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  clientId: string
  clientName: string
  verticalId: string
  verticalName: string
  onClose: () => void
}

export function KitGeneratorSession({ clientId, clientName, verticalId, verticalName, onClose }: Props) {
  const [phase, setPhase]             = useState<'loading' | 'intake' | 'mode' | 'generating' | 'checkpoint' | 'delivery'>('loading')
  const [intake, setIntake]           = useState<Record<string, unknown> | null>(null)
  const [validation, setValidation]   = useState<IntakeValidation | null>(null)
  const [mode, setMode]               = useState<'full' | 'quick'>('full')
  const [session, setSession]         = useState<KitSessionData | null>(null)
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [starting, setStarting]       = useState(false)
  const [approveNotes, setApproveNotes]   = useState('')
  const [approving, setApproving]         = useState(false)
  const [cancelling, setCancelling]       = useState(false)
  const [showHistory, setShowHistory]     = useState(false)
  const [history, setHistory]             = useState<ArchivedSession[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const generationStartRef                = React.useRef<number | null>(null)

  // Load intake + existing session on mount
  const load = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const [intakeRes, sessionRes] = await Promise.all([
        apiFetch(`/api/v1/kit-sessions/intake/${clientId}/${verticalId}`).then((r) => r.json() as Promise<IntakeResponse>),
        apiFetch(`/api/v1/kit-sessions/${clientId}/${verticalId}`).then((r) => r.json()),
      ])

      setIntake(intakeRes.intake)
      setValidation(intakeRes.validation)

      if (sessionRes.data) {
        const s = sessionRes.data as KitSessionData
        setSession(s)
        setMode(s.mode as 'full' | 'quick')
        if (s.status === 'delivery' || s.status === 'complete') { setPhase('delivery'); return }
        if (s.status === 'checkpoint') { setPhase('checkpoint'); return }
        if (s.status === 'generating' || s.status === 'cancelled' || s.status === 'error') { setPhase('generating'); return }
      }

      setPhase('intake')
    } catch {
      setLoadError('Failed to load framework data. Check your connection and try again.')
      setPhase('intake')
    }
  }, [clientId, verticalId])

  useEffect(() => { void load() }, [load])

  // Poll for session updates during generation and checkpoint phases
  useEffect(() => {
    if (phase !== 'generating' && phase !== 'checkpoint') return
    if (phase === 'generating' && !generationStartRef.current) {
      generationStartRef.current = Date.now()
    }
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/kit-sessions/${clientId}/${verticalId}`)
        const { data } = await res.json()
        if (!data) return
        const s = data as KitSessionData
        setSession(s)
        if (s.status === 'delivery' || s.status === 'complete') setPhase('delivery')
        else if (s.status === 'checkpoint') setPhase('checkpoint')
        else if (s.status === 'error') setPhase('generating') // stays on generating, shows error
      } catch { /* non-fatal polling error */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [phase, clientId, verticalId])

  // Start generation — create or resume session, snapshot intake JSON
  const startGeneration = async () => {
    if (!intake || !validation) return
    setStarting(true)
    try {
      let currentSession = session
      if (!currentSession) {
        const res = await apiFetch(`/api/v1/kit-sessions/${clientId}/${verticalId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        })
        const { data } = await res.json()
        currentSession = data as KitSessionData
      }
      // Save intakeJson and mode on the session before generating
      await apiFetch(`/api/v1/kit-sessions/${currentSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, intakeJson: intake }),
      })
      setSession({ ...currentSession, mode, intakeJson: intake, generatedFiles: {} })
      // Kick off generation
      await apiFetch(`/api/v1/kit-sessions/${currentSession.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setPhase('generating')
    } catch {
      setLoadError('Failed to start generation. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  const approveCheckpoint = async () => {
    if (!session) return
    setApproving(true)
    try {
      await apiFetch(`/api/v1/kit-sessions/${session.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: approveNotes }),
      })
      setApproveNotes('')
      setPhase('generating')
    } catch {
      setLoadError('Failed to approve. Please try again.')
    } finally {
      setApproving(false)
    }
  }

  const cancelGeneration = async () => {
    if (!session) return
    setCancelling(true)
    try {
      await apiFetch(`/api/v1/kit-sessions/${session.id}/cancel`, { method: 'POST' })
      onClose()
    } catch { /* ignore */ } finally {
      setCancelling(false)
    }
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch(`/api/v1/kit-sessions/${clientId}/${verticalId}/history`)
      const { data } = await res.json()
      setHistory(Array.isArray(data) ? data as ArchivedSession[] : [])
    } catch { /* non-fatal */ } finally {
      setHistoryLoading(false)
    }
  }

  const downloadAsset = async (asset: AssetRecord) => {
    if (!asset.content) return
    const docStyle = session?.generatedFiles?.docStyle
    await downloadKit({ ...asset, content: asset.content }, clientName, verticalName, docStyle)
  }

  const [reexporting, setReexporting] = useState<number | null>(null)

  // ── Edit asset state (hidden — flip ENABLE_KIT_EDIT to test) ─────────────────
  const ENABLE_KIT_EDIT = false
  const [editingAsset, setEditingAsset]   = useState<AssetRecord | null>(null)
  const [editContent, setEditContent]     = useState('')
  const [editSaving, setEditSaving]       = useState(false)
  const [editError, setEditError]         = useState<string | null>(null)

  const openEdit = (asset: AssetRecord) => {
    setEditingAsset(asset)
    setEditContent(asset.content ?? '')
    setEditError(null)
  }

  const saveAndDownload = async () => {
    if (!editingAsset || !session) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await apiFetch(`/kit-sessions/${session.id}/assets/${editingAsset.index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })
      if (!res.ok) throw new Error('Save failed')
      const updated = { ...editingAsset, content: editContent }
      const docStyle = session.generatedFiles?.docStyle
      await downloadKit(updated, clientName, verticalName, docStyle)
      // Patch local session state so future downloads use the edit
      setSession((prev) => {
        if (!prev) return prev
        const assets = (prev.generatedFiles?.assets ?? []).map((a: AssetRecord) =>
          a.index === editingAsset.index ? { ...a, content: editContent } : a
        )
        return { ...prev, generatedFiles: { ...prev.generatedFiles, assets } }
      })
      setEditingAsset(null)
    } catch {
      setEditError('Failed to save. Try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Storyboard generation state ──────────────────────────────────────────────
  const [showFramesModal, setShowFramesModal]       = useState(false)
  const [framesPerScene, setFramesPerScene]         = useState<1 | 2 | 3 | 4>(1)
  const [storyboardStarting, setStoryboardStarting] = useState(false)
  const [storyboard, setStoryboard]                 = useState<StoryboardProgress | null>(null)
  const [storyboardDownloadError, setStoryboardDownloadError] = useState<string | null>(null)

  // Sync storyboard status from session
  useEffect(() => {
    if (session?.generatedFiles?.storyboard) {
      setStoryboard(session.generatedFiles.storyboard)
    }
  }, [session])

  // Poll storyboard progress while generating or pending
  useEffect(() => {
    if (!session || !storyboard || (storyboard.status !== 'generating' && storyboard.status !== 'pending')) return
    const iv = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/kit-sessions/${session.id}/storyboard`)
        const { data } = await res.json()
        if (data) setStoryboard(data as StoryboardProgress)
      } catch { /* non-fatal */ }
    }, 4000)
    return () => clearInterval(iv)
  }, [session, storyboard])

  const startStoryboard = async () => {
    if (!session) return
    setStoryboardStarting(true)
    try {
      await apiFetch(`/api/v1/kit-sessions/${session.id}/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framesPerScene }),
      })
      setStoryboard({ status: 'pending', framesPerScene, totalScenes: 0, completedScenes: 0, scenes: [], startedAt: new Date().toISOString() })
      setShowFramesModal(false)
    } catch {
      setLoadError('Failed to start storyboard generation.')
    } finally {
      setStoryboardStarting(false)
    }
  }

  const downloadStoryboard = async () => {
    if (!session) return
    setStoryboardDownloadError(null)
    try {
      const res = await apiFetch(`/api/v1/kit-sessions/${session.id}/storyboard/download`)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status}: ${body}`)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const filename = storyboard?.pdfFilename ?? 'storyboard.pdf'
      a.href = objectUrl
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[downloadStoryboard] failed:', msg)
      setStoryboardDownloadError(msg)
    }
  }

  const downloadScenePage = async (sceneNumber: number) => {
    if (!session) return
    try {
      const res = await apiFetch(`/api/v1/kit-sessions/${session.id}/storyboard/scenes/${sceneNumber}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `Scene ${sceneNumber}.pdf`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) {
      console.error('[downloadScenePage] failed:', e)
    }
  }

  const downloadSceneFrame = async (sceneNumber: number, frameIndex: number) => {
    if (!session) return
    try {
      const res = await apiFetch(`/api/v1/kit-sessions/${session.id}/storyboard/scenes/${sceneNumber}/frames/${frameIndex}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `Scene ${sceneNumber} Frame ${frameIndex}.png`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) {
      console.error('[downloadSceneFrame] failed:', e)
    }
  }

  const reexportAsset = async (asset: AssetRecord) => {
    if (!asset.content || reexporting !== null) return
    setReexporting(asset.index)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/doc-style/merged`)
      const merged = res.ok ? ((await res.json()) as { data: DocStyle }).data : undefined
      await downloadKit({ ...asset, content: asset.content }, clientName, verticalName, merged)
    } finally {
      setReexporting(null)
    }
  }

  // Close with escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">

      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6">
        <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="h-5 w-px bg-gray-200" />
        <div>
          <p className="text-sm font-semibold text-gray-900 leading-tight">GTM Kit Generator</p>
          <p className="text-[11px] text-gray-400">{clientName} · {verticalName}</p>
        </div>
        {session && (
          <span className={cn(
            'ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
            session.mode === 'quick' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700',
          )}>
            {session.mode === 'quick' ? 'Quick Generate' : 'Full Session'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(phase === 'generating' || phase === 'checkpoint') && (
            <button
              onClick={() => void cancelGeneration()}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
          {phase === 'intake' && !loadError && validation && !validation.blocking && (
            <button
              onClick={() => setPhase('mode')}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
            >
              Continue →
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar — asset tracker */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 px-4 py-5">
          <AssetTracker
            approvedAssets={session?.approvedAssets ?? []}
            currentAsset={session?.currentAsset ?? null}
          />
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-y-auto">

          {/* Loading */}
          {phase === 'loading' && (
            <div className="flex flex-1 items-center justify-center gap-3 text-gray-400">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm">Reading framework data…</span>
            </div>
          )}

          {/* Error */}
          {loadError && (
            <div className="m-6 flex flex-col items-center gap-3">
              <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-center">
                <p className="text-sm font-semibold text-red-800">{loadError}</p>
                <button onClick={() => void load()} className="mt-3 text-xs text-red-600 hover:text-red-700 underline">
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Intake review */}
          {phase === 'intake' && intake && validation && (
            <div className="flex flex-col gap-6 p-8 max-w-3xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Intake Review</h2>
                <p className="mt-1 text-sm text-gray-500">
                  The following data was read from the {verticalName} GTM Framework. Review it before starting generation.
                </p>
              </div>

              <ValidationBanner validation={validation} />
              <IntakeJsonViewer intake={intake} />

              {validation.blocking ? (
                <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
                  <svg className="h-5 w-5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-red-800">Generation blocked</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Return to the GTM Framework and complete the {validation.blockingCount} required field{validation.blockingCount > 1 ? 's' : ''} listed above, then come back.
                    </p>
                  </div>
                  <button onClick={onClose} className="ml-auto shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors">
                    Back to Framework
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Ready to continue</p>
                    <p className="text-xs text-gray-500 mt-0.5">All required fields are present. Choose your generation mode next.</p>
                  </div>
                  <button
                    onClick={() => setPhase('mode')}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
                  >
                    Choose Mode →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode selection */}
          {phase === 'mode' && intake && validation && (
            <div className="flex flex-col gap-6 p-8 max-w-3xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Choose Generation Mode</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Select how you'd like to run this kit generation session.
                </p>
              </div>

              <ModeSelector value={mode} onChange={setMode} />

              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">
                    Generating: {clientName} {verticalName} Kit
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">8 assets · {mode === 'full' ? 'with sparring checkpoints after each asset' : 'all assets delivered at once, no checkpoints'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ASSETS.map((a) => (
                      <span key={a.index} className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {a.num} {a.name}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => void startGeneration()}
                  disabled={starting}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors',
                    starting ? 'cursor-not-allowed bg-blue-300' : 'bg-blue-500 hover:bg-blue-600',
                  )}
                >
                  {starting && (
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {starting ? 'Starting…' : 'Start Generation'}
                </button>
              </div>
            </div>
          )}

          {/* Generating */}
          {phase === 'generating' && (
            <div className="flex flex-1 flex-col gap-0 overflow-hidden">
              {(() => {
                const assets = session?.generatedFiles?.assets ?? []
                const doneCount = assets.filter(a => a.status === 'complete').length
                const totalCount = 8
                const pct = Math.round((doneCount / totalCount) * 100)
                const errored = assets.find(a => a.status === 'error')
                const elapsedMs = generationStartRef.current ? Date.now() - generationStartRef.current : 0
                const msPerAsset = doneCount > 0 ? elapsedMs / doneCount : 45000
                const remainingMs = (totalCount - doneCount) * msPerAsset
                const remainingMin = Math.ceil(remainingMs / 60000)
                return (
                  <>
                    <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-600">
                          {errored ? '⚠ Generation error on one asset' : doneCount === 0 ? 'Starting generation…' : `${doneCount} of ${totalCount} assets complete`}
                        </span>
                        <div className="flex items-center gap-3">
                          {!errored && doneCount < totalCount && (
                            <span className="text-xs text-gray-400">
                              ~{remainingMin > 1 ? `${remainingMin} min` : 'less than a minute'} remaining
                            </span>
                          )}
                          <button
                            onClick={() => void cancelGeneration()}
                            disabled={cancelling}
                            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            {cancelling ? 'Cancelling…' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div
                          className="h-1.5 rounded-full bg-[#a200ee] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Asset list */}
                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="max-w-2xl mx-auto flex flex-col gap-2">
                        {(assets.length === 8 ? assets : Array.from({ length: 8 }, (_, i) => ({
                          index: i,
                          name: ['Brochure','eBook','Sales Cheat Sheet','BDR Emails','Customer Deck','Video Script','Web Page Copy','Internal Brief'][i],
                          num: ['01','02','03','04','05','06','07','08'][i],
                          ext: ['docx','html','html','docx','pptx','docx','docx','docx'][i],
                          status: 'pending' as const,
                        }))).map((asset) => (
                          <div
                            key={asset.index}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border px-4 py-3 transition-all',
                              asset.status === 'complete' ? 'border-green-200 bg-green-50'
                                : asset.status === 'generating' ? 'border-purple-200 bg-purple-50'
                                : asset.status === 'error' ? 'border-red-200 bg-red-50'
                                : 'border-gray-200 bg-white',
                            )}
                          >
                            {/* Status icon */}
                            <div className="shrink-0">
                              {asset.status === 'complete' && (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500">
                                  <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                              {asset.status === 'generating' && (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500">
                                  <svg className="h-3.5 w-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                  </svg>
                                </div>
                              )}
                              {asset.status === 'error' && (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500">
                                  <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </div>
                              )}
                              {asset.status === 'pending' && (
                                <div className="h-7 w-7 rounded-full border-2 border-gray-200 bg-white flex items-center justify-center">
                                  <span className="text-[10px] font-bold text-gray-300">{asset.num}</span>
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  'text-sm font-semibold',
                                  asset.status === 'complete' ? 'text-green-800'
                                    : asset.status === 'generating' ? 'text-purple-800'
                                    : asset.status === 'error' ? 'text-red-800'
                                    : 'text-gray-400',
                                )}>
                                  {asset.num} {asset.name}
                                </span>
                                <span className="text-[10px] uppercase text-gray-300">.{asset.ext}</span>
                              </div>
                              {asset.status === 'generating' && asset.stage && (
                                <p className="mt-0.5 text-xs text-purple-600 animate-pulse">{asset.stage}</p>
                              )}
                              {asset.status === 'error' && asset.error && (
                                <p className="mt-0.5 text-xs text-red-600 truncate">{asset.error}</p>
                              )}
                              {asset.status === 'complete' && asset.completedAt && (
                                <p className="mt-0.5 text-xs text-green-600">
                                  Complete · {new Date(asset.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}

          {/* Full Session checkpoint */}
          {phase === 'checkpoint' && session && (
            <div className="flex flex-1 overflow-hidden">
              {/* Completed asset content */}
              <div className="flex-1 overflow-y-auto border-r border-gray-200 p-8">
                {(() => {
                  const assets = session.generatedFiles?.assets ?? []
                  const currentIdx = session.currentAsset ?? 0
                  const currentAsset = assets[currentIdx]
                  return (
                    <div className="max-w-2xl">
                      <div className="mb-4 flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
                          <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <h2 className="text-base font-bold text-gray-900">
                          {currentAsset ? `${currentAsset.num} ${currentAsset.name} — Generated` : 'Asset Generated'}
                        </h2>
                      </div>
                      {currentAsset?.content ? (
                        <div className="rounded-xl border border-gray-200 bg-gray-50">
                          <div className="max-h-[60vh] overflow-y-auto p-6">
                            <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-700 leading-relaxed">
                              {currentAsset.content}
                            </pre>
                          </div>
                          <div className="border-t border-gray-200 px-4 py-2">
                            <button
                              onClick={() => currentAsset && downloadAsset(currentAsset)}
                              className="text-xs text-blue-600 hover:text-blue-700"
                            >
                              Download {currentAsset.name} (.{currentAsset.ext})
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Content loading…</p>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* Sparring checkpoint panel */}
              <div className="w-80 shrink-0 flex flex-col border-l border-gray-200 bg-gray-50">
                <div className="flex-1 overflow-y-auto p-5">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Sparring Checkpoint</p>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-line">
                      {session.generatedFiles?.checkpointQuestions ?? ''}
                    </p>
                  </div>
                  <div className="mt-4">
                    <label className="mb-1.5 block text-xs font-medium text-gray-600">
                      Notes or edit requests (optional)
                    </label>
                    <textarea
                      value={approveNotes}
                      onChange={e => setApproveNotes(e.target.value)}
                      rows={3}
                      placeholder="e.g. Shorten the differentiators section, add more case study detail…"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:outline-none resize-none"
                    />
                  </div>
                </div>
                <div className="shrink-0 border-t border-gray-200 p-4 flex flex-col gap-2">
                  <button
                    onClick={() => void approveCheckpoint()}
                    disabled={approving}
                    className={cn(
                      'w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors',
                      approving ? 'cursor-not-allowed bg-blue-300' : 'bg-blue-500 hover:bg-blue-600',
                    )}
                  >
                    {approving ? 'Approving…' : 'Approve → Next Asset'}
                  </button>
                  <button
                    onClick={() => void cancelGeneration()}
                    disabled={cancelling}
                    className="w-full rounded-lg border border-gray-200 py-2 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel generation'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delivery */}
          {phase === 'delivery' && session && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-3xl mx-auto">

                {/* Delivery header */}
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">All 8 assets ready</h2>
                    <p className="text-sm text-gray-500">{clientName} {verticalName} GTM Kit</p>
                  </div>
                </div>

                {/* Consistency issues */}
                {(session.generatedFiles?.consistencyIssues ?? []).length > 0 && (
                  <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                    <p className="mb-2 text-sm font-semibold text-amber-800">Consistency checks flagged {session.generatedFiles.consistencyIssues!.length} issue{session.generatedFiles.consistencyIssues!.length > 1 ? 's' : ''}</p>
                    <ul className="flex flex-col gap-1">
                      {session.generatedFiles.consistencyIssues!.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                          <span className="mt-0.5 shrink-0">⚠</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Download grid */}
                <div className="grid grid-cols-2 gap-3">
                  {(session.generatedFiles?.assets ?? []).map((asset) => (
                    <div
                      key={asset.index}
                      className={cn(
                        'flex items-center justify-between rounded-xl border px-4 py-3',
                        asset.status === 'complete' ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-50',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{asset.num} {asset.name}</p>
                        <p className="text-[10px] uppercase text-gray-400">.{asset.ext}</p>
                      </div>
                      <div className="ml-3 flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => void downloadAsset(asset)}
                          disabled={asset.status !== 'complete'}
                          className={cn(
                            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                            asset.status === 'complete'
                              ? 'bg-[#a200ee] text-white hover:bg-[#8800cc]'
                              : 'cursor-not-allowed bg-gray-200 text-gray-400',
                          )}
                        >
                          Download
                        </button>
                        {asset.status === 'complete' && (
                          <button
                            onClick={() => void reexportAsset(asset)}
                            disabled={reexporting !== null}
                            title="Re-export with current branding"
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-40"
                          >
                            {reexporting === asset.index ? '…' : '↻'}
                          </button>
                        )}
                        {asset.status === 'complete' && asset.content && (
                          <a
                            href={`data:text/plain;charset=utf-8,${encodeURIComponent(asset.content)}`}
                            download={`${asset.num}-${asset.name.replace(/ /g, '-').toLowerCase()}-content.txt`}
                            title="Download raw content for preview script"
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                          >
                            raw
                          </a>
                        )}
                        {ENABLE_KIT_EDIT && asset.status === 'complete' && (
                          <button
                            onClick={() => openEdit(asset)}
                            title="Edit content before downloading"
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                          >
                            ✎
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Video Storyboard Generator */}
                {(() => {
                  const videoScript = (session.generatedFiles?.assets ?? []).find((a) => a.index === 5)
                  if (!videoScript || videoScript.status !== 'complete') return null
                  return (
                    <div className="mt-6 rounded-xl border border-purple-200 bg-purple-50 px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-purple-900">Video Storyboard</p>
                          <p className="text-xs text-purple-600 mt-0.5">
                            Generate an illustrated PDF storyboard from Asset 06 using AI images.
                          </p>
                        </div>
                        {!storyboard ? (
                          <button
                            onClick={() => setShowFramesModal(true)}
                            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition-colors"
                          >
                            Generate Storyboard
                          </button>
                        ) : storyboard.status === 'error' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600">{storyboard.error ?? 'Generation failed'}</span>
                            <button
                              onClick={() => setShowFramesModal(true)}
                              className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            {storyboard.status === 'generating' || storyboard.status === 'pending' ? (
                              <>
                                <span className="text-xs text-purple-700 font-medium">
                                  {storyboard.status === 'pending' ? 'Queued…' : `${storyboard.completedScenes} / ${storyboard.totalScenes || '?'} scenes`}
                                </span>
                                <svg className="h-4 w-4 animate-spin text-purple-500" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              </>
                            ) : null}
                            <button
                              onClick={() => setShowFramesModal(true)}
                              className="rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
                            >
                              Regenerate
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Download error */}
                      {storyboardDownloadError && (
                        <p className="mt-2 text-xs text-red-600 break-all">{storyboardDownloadError}</p>
                      )}

                      {/* Per-scene page list — shows as scenes complete */}
                      {storyboard && (storyboard.scenes ?? []).length > 0 && (
                        <div className="mt-3 divide-y divide-purple-100 rounded-lg border border-purple-100 overflow-hidden">
                          {[...(storyboard.scenes ?? [])].sort((a, b) => a.sceneNumber - b.sceneNumber).map((s) => (
                            <div key={s.sceneNumber} className="flex items-center justify-between px-3 py-2 bg-white">
                              <span className="text-xs text-purple-900 font-medium">
                                Scene {s.sceneNumber} of {storyboard.totalScenes}
                              </span>
                              {s.status === 'complete' ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => void downloadScenePage(s.sceneNumber)}
                                    className="text-[10px] font-semibold text-purple-600 hover:text-purple-800 transition-colors"
                                  >
                                    PDF
                                  </button>
                                  {Array.from({ length: storyboard.framesPerScene ?? 1 }, (_, i) => (
                                    <button
                                      key={i}
                                      onClick={() => void downloadSceneFrame(s.sceneNumber, i + 1)}
                                      className="text-[10px] font-semibold text-gray-400 hover:text-gray-700 transition-colors"
                                    >
                                      Img {i + 1}
                                    </button>
                                  ))}
                                </div>
                              ) : s.status === 'error' ? (
                                <span className="text-[10px] text-red-500">Failed</span>
                              ) : s.status === 'generating' ? (
                                <span className="text-[10px] text-purple-400 flex items-center gap-1">
                                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                  </svg>
                                  Rendering…
                                </span>
                              ) : (
                                <span className="text-[10px] text-purple-300">Queued</span>
                              )}
                            </div>
                          ))}
                          {/* Assembled / combined PDF row */}
                          <div className="flex items-center justify-between px-3 py-2 bg-purple-50">
                            <span className="text-xs font-semibold text-purple-900">Combined PDF</span>
                            {storyboard.pdfStorageKey ? (
                              <button
                                onClick={() => void downloadStoryboard()}
                                className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 transition-colors"
                              >
                                Download all
                              </button>
                            ) : (
                              <span className="text-[10px] text-purple-300 flex items-center gap-1">
                                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                Assembling…
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Footer: filename hint + previous versions toggle */}
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    Files are named: {clientName} {verticalName} Kit - 01 Brochure.docx etc.
                  </p>
                  <button
                    onClick={() => {
                      setShowHistory((v) => !v)
                      if (!showHistory) void loadHistory()
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
                  >
                    {showHistory ? 'Hide previous versions' : 'View previous versions'}
                  </button>
                </div>

                {/* Previous versions list */}
                {showHistory && (
                  <div className="mt-3 rounded-xl border border-gray-200 overflow-hidden">
                    {historyLoading ? (
                      <p className="px-4 py-3 text-xs text-gray-400">Loading…</p>
                    ) : history.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400">No previous versions archived yet.</p>
                    ) : (
                      history.map((s, i) => (
                        <div
                          key={s.id}
                          className={cn(
                            'flex items-center justify-between px-4 py-2.5',
                            i < history.length - 1 && 'border-b border-gray-100',
                          )}
                        >
                          <span className="text-xs text-gray-700">
                            {new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}{' '}
                            <span className="text-gray-400">
                              {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </span>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                            s.mode === 'quick' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700',
                          )}>
                            {s.mode === 'quick' ? 'Quick Generate' : 'Full Session'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ── Kit content editor modal (hidden — ENABLE_KIT_EDIT controls visibility) ── */}
          {ENABLE_KIT_EDIT && editingAsset && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
              <div className="bg-white border border-border rounded-xl shadow-2xl flex flex-col w-[90vw] max-w-4xl h-[85vh]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
                  <div>
                    <p className="font-semibold text-gray-900">{editingAsset.num} {editingAsset.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Edit the raw content, then save &amp; re-download</p>
                  </div>
                  <button
                    onClick={() => setEditingAsset(null)}
                    className="text-gray-400 hover:text-gray-700 text-xl leading-none"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  className="flex-1 w-full resize-none font-mono text-xs text-gray-800 p-4 outline-none"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 shrink-0">
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  {!editError && <span />}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingAsset(null)}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void saveAndDownload()}
                      disabled={editSaving}
                      className="rounded-lg bg-[#a200ee] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8800cc] disabled:opacity-50"
                    >
                      {editSaving ? 'Saving…' : 'Save + Download'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Frames-per-scene modal */}
      {showFramesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 pt-5 pb-4">
              <h3 className="text-base font-bold text-gray-900 mb-1">Generate Video Storyboard</h3>
              <p className="text-xs text-gray-500 mb-5">
                Choose how many AI-generated images to create per scene. More frames = richer storyboard, but takes longer.
              </p>
              <div className="grid grid-cols-4 gap-2 mb-5">
                {([1, 2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setFramesPerScene(n)}
                    className={cn(
                      'rounded-xl border-2 py-3 flex flex-col items-center gap-1 transition-all',
                      framesPerScene === n
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 bg-white hover:border-gray-300',
                    )}
                  >
                    <span className={cn('text-xl font-bold', framesPerScene === n ? 'text-purple-700' : 'text-gray-700')}>{n}</span>
                    <span className="text-[10px] text-gray-400">{n === 1 ? 'frame' : 'frames'}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 text-center mb-4">
                {framesPerScene === 1 && 'Fastest — 1 image per scene'}
                {framesPerScene === 2 && 'Balanced — 2 images per scene'}
                {framesPerScene === 3 && 'Detailed — 3 images per scene'}
                {framesPerScene === 4 && 'Full coverage — 4 images per scene (slowest)'}
              </p>
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button
                onClick={() => setShowFramesModal(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void startStoryboard()}
                disabled={storyboardStarting}
                className={cn(
                  'flex-1 rounded-lg py-2 text-sm font-semibold text-white transition-colors',
                  storyboardStarting ? 'cursor-not-allowed bg-purple-300' : 'bg-purple-600 hover:bg-purple-700',
                )}
              >
                {storyboardStarting ? 'Starting…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
