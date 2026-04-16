import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariableSuggestion {
  variableId: string
  variableName: string
  sampleText: string
  reason: string
}

interface DocTemplate {
  id: string
  name: string
  docType: string
  status: string
  confirmedVars: VariableSuggestion[]
  processedKey?: string | null
  suggestions?: VariableSuggestion[]
  errorMessage?: string | null
}

interface GtmVariable {
  id: string
  label: string
  description: string
  section: string
}

interface Popover {
  text: string
  viewportX: number
  viewportY: number
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Walk text nodes inside `container` (skipping existing <mark> subtrees)
 * and call `callback` with a Range on the first match of `searchText`.
 * Returns true if a match was found and the callback executed without error.
 */
function markFirst(
  container: HTMLElement,
  searchText: string,
  callback: (range: Range) => void,
): boolean {
  if (!searchText.trim()) return false

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node) =>
      node.parentElement?.closest('mark')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const txt = node.textContent ?? ''
    const idx = txt.indexOf(searchText)
    if (idx === -1) continue
    try {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + searchText.length)
      callback(range)
      return true
    } catch {
      // Text crosses element boundaries — skip this node
    }
  }
  return false
}

/** Apply amber (suggestion) and purple (confirmed) marks to the rendered DOM */
function applyAllMarks(
  container: HTMLElement,
  suggestions: VariableSuggestion[],
  confirmed: VariableSuggestion[],
) {
  const confirmedIds = new Set(confirmed.map((v) => v.variableId))

  // Confirmed vars — replace sample text with {{var}} pill
  for (const v of confirmed) {
    markFirst(container, v.sampleText, (range) => {
      const mark = document.createElement('mark')
      mark.className = 'cn-confirmed'
      mark.dataset.var = v.variableId
      mark.dataset.original = v.sampleText
      mark.title = 'Click to remove'
      mark.textContent = `{{${v.variableId}}}`
      range.deleteContents()
      range.insertNode(mark)
    })
  }

  // AI suggestions — underline original text
  for (const v of suggestions) {
    if (confirmedIds.has(v.variableId)) continue
    markFirst(container, v.sampleText, (range) => {
      const mark = document.createElement('mark')
      mark.className = 'cn-suggestion'
      mark.dataset.var = v.variableId
      mark.dataset.original = v.sampleText
      mark.title = `${v.reason} — click to confirm`
      try {
        range.surroundContents(mark)
      } catch {
        // Partial selection across elements — skip
      }
    })
  }
}

// ── Mark CSS (injected once) ──────────────────────────────────────────────────

const MARK_CSS = `
  mark.cn-suggestion {
    background: #fef9c3;
    color: inherit;
    padding: 1px 2px;
    border-radius: 2px;
    cursor: pointer;
    border-bottom: 2px dashed #f59e0b;
    transition: background 0.12s;
  }
  mark.cn-suggestion:hover { background: #fef08a; }
  mark.cn-suggestion::after {
    content: " ⬤";
    font-size: 7px;
    vertical-align: super;
    color: #f59e0b;
  }
  mark.cn-confirmed {
    background: #ede9fe;
    color: #5b21b6;
    padding: 1px 5px;
    border-radius: 3px;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid #c4b5fd;
    white-space: nowrap;
    transition: background 0.12s;
  }
  mark.cn-confirmed:hover { background: #ddd6fe; }
  ::selection { background: #a200ee26; }
`

// ── Main component ────────────────────────────────────────────────────────────

export function DocTemplateEditor({
  templateId,
  onClose,
  onSaved,
}: {
  templateId: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [template, setTemplate]       = useState<DocTemplate | null>(null)
  const [allVars, setAllVars]         = useState<GtmVariable[]>([])
  const [confirmedVars, setConfirmedVars] = useState<VariableSuggestion[]>([])
  const [docBytes, setDocBytes]       = useState<ArrayBuffer | null>(null)
  const [rendering, setRendering]     = useState(false)
  const [popover, setPopover]         = useState<Popover | null>(null)
  const [selectedVarId, setSelectedVarId] = useState('')
  const [saving, setSaving]           = useState(false)
  const [processing, setProcessing]   = useState(false)
  const [saved, setSaved]             = useState(false)
  const [processOk, setProcessOk]     = useState(false)

  const bodyRef  = useRef<HTMLDivElement>(null)
  // Keep a ref for confirmed vars so the render effect always sees current value
  const confirmedRef = useRef<VariableSuggestion[]>([])
  confirmedRef.current = confirmedVars
  const suggestionsRef = useRef<VariableSuggestion[]>([])

  // ── Load template metadata + variable vocabulary ──────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch(`/api/v1/doc-templates/${templateId}`).then((r) => r.json()),
      apiFetch('/api/v1/doc-templates/variables').then((r) => r.json()),
    ]).then(([tData, vData]) => {
      const t: DocTemplate = tData.data
      setTemplate(t)
      const cv = (t.confirmedVars as VariableSuggestion[]) ?? []
      setConfirmedVars(cv)
      confirmedRef.current = cv
      suggestionsRef.current = (t.suggestions as VariableSuggestion[]) ?? []
      setAllVars(vData.data ?? [])
      if (t.processedKey) setProcessOk(true)
    })
  }, [templateId])

  // ── Fetch raw .docx bytes ─────────────────────────────────────────────────
  useEffect(() => {
    apiFetch(`/api/v1/doc-templates/${templateId}/file`)
      .then((r) => r.arrayBuffer())
      .then(setDocBytes)
  }, [templateId])

  // ── Render with docx-preview + apply marks ────────────────────────────────
  useEffect(() => {
    if (!docBytes || !bodyRef.current) return
    let cancelled = false

    setRendering(true)

    import('docx-preview').then(({ renderAsync }) =>
      renderAsync(new Uint8Array(docBytes), bodyRef.current!, undefined, {
        className: 'cn-docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      }),
    ).then(() => {
      if (cancelled || !bodyRef.current) return
      applyAllMarks(bodyRef.current, suggestionsRef.current, confirmedRef.current)
      setRendering(false)
    }).catch((err) => {
      if (!cancelled) { console.error('[docx-preview]', err); setRendering(false) }
    })

    return () => { cancelled = true }
  // Re-render when bytes load or confirmed vars change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docBytes, confirmedVars])

  // ── Dismiss popover on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('.cn-popover, mark')) setPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Text selection → popover ──────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (text.length < 2) return
    const range = sel?.getRangeAt(0)
    const rect  = range?.getBoundingClientRect()
    if (rect && rect.width > 0) {
      setPopover({ text, viewportX: rect.left + rect.width / 2, viewportY: rect.bottom + 10 })
      setSelectedVarId('')
    }
  }, [])

  // ── Click on a <mark> element ─────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('mark') as HTMLElement | null
    if (!el) return
    e.stopPropagation()
    const varId = el.dataset.var
    if (!varId) return

    if (el.classList.contains('cn-confirmed')) {
      setConfirmedVars((prev) => prev.filter((v) => v.variableId !== varId))
      setProcessOk(false)
    } else if (el.classList.contains('cn-suggestion')) {
      const sug = suggestionsRef.current.find((s) => s.variableId === varId)
      if (sug) { setConfirmedVars((prev) => [...prev.filter((v) => v.variableId !== varId), sug]); setProcessOk(false) }
    }
  }, [])

  // ── Assign from popover ───────────────────────────────────────────────────
  const assignVariable = useCallback(() => {
    if (!popover || !selectedVarId) return
    const meta = allVars.find((v) => v.id === selectedVarId)
    const entry: VariableSuggestion = {
      variableId:   selectedVarId,
      variableName: meta?.label ?? selectedVarId,
      sampleText:   popover.text,
      reason:       'Manually selected',
    }
    setConfirmedVars((prev) => [...prev.filter((v) => v.variableId !== selectedVarId), entry])
    setPopover(null)
    setProcessOk(false)
    window.getSelection()?.removeAllRanges()
  }, [popover, selectedVarId, allVars])

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!template) return
    setSaving(true)
    try {
      await apiFetch(`/api/v1/doc-templates/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmedVars }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    } finally { setSaving(false) }
  }, [template, confirmedVars, onSaved])

  // ── Process ───────────────────────────────────────────────────────────────
  const process = useCallback(async () => {
    if (!template) return
    await save()
    setProcessing(true)
    try {
      const r = await apiFetch(`/api/v1/doc-templates/${template.id}/process`, { method: 'POST' })
      if (r.ok) { const { data } = await r.json(); setTemplate(data); setProcessOk(true) }
      else { const b = await r.json().catch(() => ({})); alert('Process failed: ' + ((b as any).error ?? r.status)) }
    } finally { setProcessing(false) }
  }, [template, save])

  // ── Derived ───────────────────────────────────────────────────────────────
  const suggestions   = (template?.suggestions as VariableSuggestion[] | undefined) ?? []
  const confirmedIds  = new Set(confirmedVars.map((v) => v.variableId))
  const varsBySection = allVars.reduce<Record<string, GtmVariable[]>>((acc, v) => {
    ;(acc[v.section] ??= []).push(v)
    return acc
  }, {})

  const popoverLeft = popover
    ? Math.max(8, Math.min(popover.viewportX - 168, (window.innerWidth || 1200) - 344))
    : 0
  const popoverTop = popover
    ? Math.min(popover.viewportY, (window.innerHeight || 800) - 220)
    : 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: '#fff' }}>
      {/* Inject mark CSS once */}
      <style>{MARK_CSS}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid #e8e7e1', backgroundColor: '#fff' }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] hover:bg-gray-100"
          style={{ color: '#6b7280' }}
        >
          <Icons.ChevronLeft className="h-4 w-4" /> Back
        </button>

        <div className="h-5 w-px shrink-0" style={{ backgroundColor: '#e8e7e1' }} />

        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold truncate" style={{ color: '#1a1a14' }}>
            {template?.name ?? 'Loading…'}
          </p>
          <p className="text-[12px] flex items-center gap-3 flex-wrap" style={{ color: '#b4b2a9' }}>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-b-2 border-dashed border-amber-400" style={{ backgroundColor: '#fef9c3' }} />
              Amber = AI suggestion — click to confirm
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#ede9fe', border: '1px solid #c4b5fd' }} />
              Purple = confirmed — click to remove
            </span>
            <span>Select any text to assign manually</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: '#e8e7e1', color: '#374151' }}
          >
            {saving
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : saved
                ? <Icons.Check className="h-3.5 w-3.5" style={{ color: '#16a34a' }} />
                : <Icons.Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>

          <button
            onClick={process}
            disabled={processing || !confirmedVars.length}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: '#a200ee' }}
          >
            {processing
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : processOk
                ? <Icons.CheckCircle2 className="h-3.5 w-3.5" />
                : <Icons.Wand2 className="h-3.5 w-3.5" />}
            {processing ? 'Processing…' : processOk ? 'Re-process' : 'Process template'}
          </button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Document canvas */}
        <div
          className="flex-1 overflow-y-auto relative"
          style={{ backgroundColor: '#e8eaed' }}
        >
          {/* Subtle re-render overlay */}
          {rendering && (
            <div
              className="absolute inset-0 z-10 flex items-start justify-center pt-8 pointer-events-none"
              style={{ backgroundColor: 'rgba(232,234,237,0.5)' }}
            >
              <div
                className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] shadow-md"
                style={{ backgroundColor: '#fff', color: '#6b7280' }}
              >
                <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#a200ee' }} />
                Rendering…
              </div>
            </div>
          )}

          {/* docx-preview mounts here */}
          <div
            ref={bodyRef}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            style={{ minHeight: '100%' }}
          />

          {/* Empty state while loading bytes */}
          {!docBytes && !rendering && (
            <div className="flex items-center justify-center h-64 gap-2 text-sm" style={{ color: '#9ca3af' }}>
              <Icons.Loader2 className="h-5 w-5 animate-spin" /> Loading document…
            </div>
          )}
        </div>

        {/* ── Right panel ───────────────────────────────────────────────── */}
        <aside
          className="w-72 shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: '1px solid #e8e7e1', backgroundColor: '#fafaf8' }}
        >
          <div className="flex-1 overflow-y-auto">

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="p-4" style={{ borderBottom: '1px solid #f0eee8' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: '#b4b2a9' }}>
                  AI Suggestions ({suggestions.length})
                </p>
                <div className="space-y-1.5">
                  {suggestions.map((v) => {
                    const confirmed = confirmedIds.has(v.variableId)
                    return (
                      <button
                        key={v.variableId}
                        onClick={() => {
                          if (confirmed) { setConfirmedVars((p) => p.filter((c) => c.variableId !== v.variableId)); setProcessOk(false) }
                          else           { setConfirmedVars((p) => [...p.filter((c) => c.variableId !== v.variableId), v]); setProcessOk(false) }
                        }}
                        className="w-full text-left rounded-lg px-3 py-2 text-[12px] transition-colors"
                        style={{ border: `1px solid ${confirmed ? '#a200ee' : '#e8e7e1'}`, backgroundColor: confirmed ? '#fdf5ff' : '#fff' }}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center"
                            style={{ borderColor: confirmed ? '#a200ee' : '#d1d5db', backgroundColor: confirmed ? '#a200ee' : 'transparent' }}
                          >
                            {confirmed && <Icons.Check className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <code
                            className="text-[11px] rounded px-1 truncate"
                            style={{ backgroundColor: '#f3f0ff', color: '#7c3aed' }}
                          >
                            {`{{${v.variableId}}}`}
                          </code>
                        </div>
                        <p className="mt-1 text-[11px] truncate" style={{ color: '#9ca3af' }}>
                          "{v.sampleText}"
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Confirmed */}
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: '#b4b2a9' }}>
                Confirmed ({confirmedVars.length})
              </p>
              {confirmedVars.length === 0 ? (
                <p className="text-[12px]" style={{ color: '#b4b2a9' }}>
                  Click amber text to confirm an AI suggestion, or select any text in the document.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {confirmedVars.map((v) => (
                    <div
                      key={v.variableId}
                      className="flex items-start gap-2 rounded-lg px-3 py-2"
                      style={{ backgroundColor: '#f3f0ff', border: '1px solid #ddd6fe' }}
                    >
                      <div className="flex-1 min-w-0">
                        <code className="text-[11px]" style={{ color: '#7c3aed' }}>{`{{${v.variableId}}}`}</code>
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: '#6b7280' }}>← "{v.sampleText}"</p>
                      </div>
                      <button
                        onClick={() => { setConfirmedVars((p) => p.filter((c) => c.variableId !== v.variableId)); setProcessOk(false) }}
                        className="shrink-0 mt-0.5 rounded p-0.5 hover:text-red-500"
                        style={{ color: '#c4b5fd' }}
                      >
                        <Icons.X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {processOk && (
            <div
              className="shrink-0 flex items-center gap-2 px-4 py-3 text-[12px]"
              style={{ borderTop: '1px solid #e8e7e1', backgroundColor: '#f0fdf4', color: '#166534' }}
            >
              <Icons.CheckCircle2 className="h-4 w-4 shrink-0" />
              Template processed and ready to use.
            </div>
          )}
        </aside>
      </div>

      {/* ── Floating popover (fixed viewport coords) ──────────────────────── */}
      {popover && (
        <div
          className="cn-popover fixed z-[200] rounded-xl shadow-2xl p-4"
          style={{ left: popoverLeft, top: popoverTop, width: 336, backgroundColor: '#fff', border: '1px solid #e8e7e1' }}
        >
          <p className="text-[12px] mb-1" style={{ color: '#6b7280' }}>Assign variable to:</p>
          <p
            className="text-[13px] font-medium mb-3 rounded px-2 py-1 truncate"
            style={{ backgroundColor: '#fef9c3', color: '#78350f' }}
          >
            "{popover.text.slice(0, 72)}{popover.text.length > 72 ? '…' : ''}"
          </p>
          <select
            value={selectedVarId}
            onChange={(e) => setSelectedVarId(e.target.value)}
            className="w-full rounded-lg border px-2 py-1.5 text-[13px] mb-3"
            style={{ borderColor: '#e8e7e1', color: '#374151' }}
            autoFocus
          >
            <option value="">— pick a variable —</option>
            {Object.entries(varsBySection).map(([section, vars]) => (
              <optgroup
                key={section}
                label={section === 'meta' ? 'Document Metadata' : `Section ${section.padStart(2, '0')}`}
              >
                {vars.map((v) => (
                  <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={assignVariable}
              disabled={!selectedVarId}
              className="flex-1 rounded-md py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: '#a200ee' }}
            >
              Assign
            </button>
            <button
              onClick={() => { setPopover(null); window.getSelection()?.removeAllRanges() }}
              className="rounded-md px-3 py-1.5 text-[13px] border"
              style={{ borderColor: '#e8e7e1', color: '#6b7280' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
