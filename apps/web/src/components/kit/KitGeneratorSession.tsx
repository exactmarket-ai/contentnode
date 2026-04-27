/**
 * KitGeneratorSession — full-page GTM Kit Generator overlay.
 *
 * Phase 1 (current): intake review — reads framework, validates, shows
 * intake JSON, lets user choose Full/Quick mode, then starts generation.
 * Asset generation is NOT built yet — confirmation of intake JSON required first.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

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

interface KitSessionData {
  id: string
  mode: string
  status: string
  currentAsset: number | null
  approvedAssets: number[]
  chatHistory: ChatMessage[]
  intakeJson: Record<string, unknown> | null
  generatedFiles: Record<string, unknown>
}

interface ChatMessage {
  role: 'system' | 'assistant' | 'user'
  content: string
  ts: string
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
  { index: 0, num: '01', name: 'Brochure',              ext: 'docx' },
  { index: 1, num: '02', name: 'eBook',                 ext: 'html' },
  { index: 2, num: '03', name: 'Sales Cheat Sheet',     ext: 'html' },
  { index: 3, num: '04', name: 'BDR Emails',            ext: 'docx' },
  { index: 4, num: '05', name: 'Customer Deck',         ext: 'pptx' },
  { index: 5, num: '06', name: 'Video Script',          ext: 'docx' },
  { index: 6, num: '07', name: 'Web Page Copy',         ext: 'docx' },
  { index: 7, num: '08', name: 'Internal Brief',        ext: 'docx' },
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
            {warnings.length} warning{warnings.length > 1 ? 's' : ''} — generation will proceed with gaps
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
  const [phase, setPhase]             = useState<'loading' | 'intake' | 'mode' | 'generating' | 'delivery'>('loading')
  const [intake, setIntake]           = useState<Record<string, unknown> | null>(null)
  const [validation, setValidation]   = useState<IntakeValidation | null>(null)
  const [mode, setMode]               = useState<'full' | 'quick'>('full')
  const [session, setSession]         = useState<KitSessionData | null>(null)
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [starting, setStarting]       = useState(false)

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
        if (s.status !== 'intake') {
          setPhase(s.status === 'delivery' || s.status === 'complete' ? 'delivery' : 'generating')
          return
        }
      }

      setPhase('intake')
    } catch (err) {
      setLoadError('Failed to load framework data. Check your connection and try again.')
      setPhase('intake')
    }
  }, [clientId, verticalId])

  useEffect(() => { void load() }, [load])

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
      } else {
        // Update mode on existing session
        const res = await apiFetch(`/api/v1/kit-sessions/${currentSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, status: 'asset_01', currentAsset: 0, intakeJson: intake }),
        })
        const { data } = await res.json()
        currentSession = data as KitSessionData
      }
      setSession(currentSession)
      setPhase('generating')
      // TODO: kick off generation — asset building to be added after intake JSON is confirmed
    } catch {
      setLoadError('Failed to start session. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  // Close with escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const filename = (asset: typeof ASSETS[0]) =>
    `${clientName} ${verticalName} Kit - ${asset.num} ${asset.name}.${asset.ext}`

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

          {/* Generating — placeholder pending asset build confirmation */}
          {phase === 'generating' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                <svg className="h-8 w-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900">Asset generation coming soon</p>
                <p className="mt-1 text-sm text-gray-500 max-w-md">
                  Session created. Confirm the intake JSON is correct before asset generation is built.
                </p>
              </div>
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-6 py-4 text-left max-w-lg w-full">
                <p className="text-xs font-semibold text-gray-600 mb-3">Files that will be generated:</p>
                <div className="flex flex-col gap-1.5">
                  {ASSETS.map((a) => (
                    <div key={a.index} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-mono text-[10px] text-gray-400 w-6">{a.num}</span>
                      <span className="font-medium">{a.name}</span>
                      <span className="ml-auto text-gray-400 uppercase text-[10px]">.{a.ext}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ASSETS.map((a) => (
                    <code key={a.index} className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {filename(a)}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
