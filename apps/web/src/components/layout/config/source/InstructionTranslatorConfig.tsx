import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api'
import { useWorkflowStore, type NodeRunStatus } from '@/store/workflowStore'

interface InstructionObject {
  role_context: string
  audience: string
  tone: string
  strategic_direction: string
  visual_language: string
  constraints: string[]
  gaps: string[]
  confidence: Record<string, 'direct' | 'inferred'>
}

interface SourceNode {
  id: string
  label: string
  subtype: string
  isInstructions: boolean
  textContent?: string
  parsedInstructions?: InstructionObject
  fileNames?: string[]
}

interface Props {
  config: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  nodeRunStatus?: NodeRunStatus
  nodeId: string
}

const STRING_FIELDS: { key: keyof InstructionObject; label: string }[] = [
  { key: 'role_context', label: 'Role Context' },
  { key: 'audience', label: 'Audience' },
  { key: 'tone', label: 'Tone' },
  { key: 'strategic_direction', label: 'Strategic Direction' },
  { key: 'visual_language', label: 'Visual Language' },
]

function ConfidenceBadge({ level }: { level: 'direct' | 'inferred' | 'inherited' }) {
  const styles =
    level === 'direct'   ? 'bg-green-100 text-green-700'
    : level === 'inherited' ? 'bg-blue-100 text-blue-700'
    : 'bg-amber-100 text-amber-700'
  return (
    <span className={`rounded-full px-1.5 py-px text-[8px] font-semibold ${styles}`}>
      {level}
    </span>
  )
}

export function InstructionTranslatorConfig({ config, onChange, nodeRunStatus, nodeId }: Props) {
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gapAnswers, setGapAnswers] = useState<Record<number, string>>({})
  const [suggestingGap, setSuggestingGap] = useState<Record<number, boolean>>({})
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])

  const allNodes = useWorkflowStore((s) => s.nodes)

  // Build list of other source nodes
  const otherSources: SourceNode[] = allNodes
    .filter((n) => n.id !== nodeId && n.type === 'source')
    .map((n) => {
      const cfg = (n.data.config as Record<string, unknown>) ?? {}
      const subtype = (n.data.subtype as string) ?? ''
      const isInstructions = subtype === 'instruction-translator' && !!cfg.parsed
      const label = (n.data.label as string) || subtype

      const uploadedFiles = (cfg.uploaded_files as Array<{ name: string }> | undefined) ?? []
      const audioFiles = (cfg.audio_files as Array<{ name: string }> | undefined) ?? []
      const libraryRefs = (cfg.library_refs as Array<{ name?: string; label?: string }> | undefined) ?? []
      const allFileNames = [
        ...uploadedFiles.map((f) => f.name),
        ...audioFiles.map((f) => f.name),
        ...libraryRefs.map((f) => f.name ?? f.label ?? 'document'),
      ]

      return {
        id: n.id,
        label,
        subtype,
        isInstructions,
        textContent: (cfg.text as string | undefined) || (cfg.pasted_text as string | undefined) || (cfg.inlineText as string | undefined),
        parsedInstructions: isInstructions ? (cfg.parsed as InstructionObject) : undefined,
        fileNames: allFileNames.length > 0 ? allFileNames : undefined,
      }
    })

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const runOutput = nodeRunStatus?.output as InstructionObject | undefined
  const parsed: InstructionObject | undefined = runOutput ?? (config.parsed as InstructionObject | undefined)

  const updateParsedField = (key: string, value: unknown) => {
    const current: InstructionObject = parsed ?? {
      role_context: '', audience: '', tone: '', strategic_direction: '',
      visual_language: '', constraints: [], gaps: [], confidence: {},
    }
    onChange('parsed', { ...current, [key]: value })
  }

  const handleSuggestGap = async (index: number, gap: string) => {
    const rawText = (config.raw_text as string | undefined)?.trim()
    if (!rawText) return
    setSuggestingGap((prev) => ({ ...prev, [index]: true }))
    try {
      const res = await apiFetch('/api/v1/instruction-translator/suggest-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, gap, parsed }),
      })
      const json = await res.json()
      if (res.ok && json.suggestion) {
        setGapAnswers((prev) => ({ ...prev, [index]: json.suggestion }))
      }
    } catch { /* ignore */ } finally {
      setSuggestingGap((prev) => ({ ...prev, [index]: false }))
    }
  }

  const handleConvert = async (withGapAnswers = false) => {
    const rawText = (config.raw_text as string | undefined)?.trim()
    if (!rawText) return
    setTranslating(true)
    setError(null)

    let augmented = rawText
    if (withGapAnswers && parsed?.gaps) {
      const filled = parsed.gaps
        .map((gap, i) => gapAnswers[i]?.trim() ? `${gap}: ${gapAnswers[i].trim()}` : null)
        .filter(Boolean)
      if (filled.length > 0) {
        augmented += `\n\nAdditional context:\n${filled.join('\n')}`
      }
    }

    // Build selected source contexts
    const selectedSources = otherSources.filter((s) => selectedSourceIds.includes(s.id))
    const baseline = selectedSources.find((s) => s.isInstructions)?.parsedInstructions
    const textContexts = selectedSources
      .filter((s) => !s.isInstructions && s.textContent)
      .map((s) => ({ label: s.label, content: s.textContent! }))
    const fileHints = selectedSources
      .filter((s) => s.fileNames?.length)
      .flatMap((s) => s.fileNames!.map((name) => ({ label: s.label, filename: name })))

    try {
      const res = await apiFetch('/api/v1/instruction-translator/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: augmented,
          ...(baseline ? { baseline } : {}),
          ...(textContexts.length > 0 ? { text_contexts: textContexts } : {}),
          ...(fileHints.length > 0 ? { file_hints: fileHints } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Conversion failed')
        return
      }
      onChange('parsed', json.data)
      setGapAnswers({})
    } catch {
      setError('Conversion failed — check your connection')
    } finally {
      setTranslating(false)
    }
  }

  const rawText = (config.raw_text as string) ?? ''

  return (
    <div className="p-4 space-y-3">

      {/* Source context selector */}
      {otherSources.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Include in Conversion</p>
          {otherSources.map((s) => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={selectedSourceIds.includes(s.id)}
                onChange={() => toggleSource(s.id)}
                className="h-3 w-3 rounded border-input accent-primary cursor-pointer"
              />
              <span className="text-[10px] text-foreground group-hover:text-foreground/80 flex items-center gap-1 min-w-0">
                {s.isInstructions
                  ? <Icons.ScrollText className="h-3 w-3 text-blue-500 shrink-0" />
                  : s.fileNames
                  ? <Icons.FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  : <Icons.Type className="h-3 w-3 text-muted-foreground shrink-0" />}
                <span className="truncate">{s.label}</span>
                {s.isInstructions && (
                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-px text-[8px] font-semibold text-blue-700">will merge</span>
                )}
                {s.fileNames && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">{s.fileNames.length} file{s.fileNames.length !== 1 ? 's' : ''}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-2 gap-3">
        {/* Left — raw input */}
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Brief / Notes</p>
          <Textarea
            value={rawText}
            onChange={(e) => onChange('raw_text', e.target.value)}
            placeholder="Paste your brief, campaign notes, or instructions..."
            className="text-xs resize-none min-h-[300px]"
          />
          <button
            onClick={() => handleConvert(false)}
            disabled={translating || !rawText}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#a200ee' }}
          >
            {translating
              ? <><Icons.Loader2 className="h-3 w-3 animate-spin" /> Converting…</>
              : <><Icons.Wand2 className="h-3 w-3" /> Convert Brief</>}
          </button>
          {error && (
            <p className="text-[10px] text-red-500 flex items-center gap-1">
              <Icons.AlertCircle className="h-3 w-3 shrink-0" />{error}
            </p>
          )}

          {/* Constraints — shown below Convert Brief button */}
          {(parsed?.constraints?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Constraints</p>
              <div className="flex flex-wrap gap-1">
                {parsed!.constraints.map((c, i) => (
                  <span key={i} className="bg-red-100 px-1.5 py-px text-[9px] text-red-700" style={{ borderRadius: 5 }}>{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — structured output */}
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Structured Output</p>

          {!parsed ? (
            <div className="rounded-md border border-dashed border-border p-4 flex flex-col items-center justify-center gap-2 min-h-[300px]">
              <Icons.Wand2 className="h-5 w-5 text-muted-foreground/40" />
              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                Paste your brief and click<br /><span className="font-semibold">Convert Brief</span>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {STRING_FIELDS.map(({ key, label }) => {
                const val = (parsed[key] as string) ?? ''
                const conf = (parsed.confidence?.[key] ?? 'inferred') as 'direct' | 'inferred' | 'inherited'
                return (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                      <ConfidenceBadge level={conf} />
                    </div>
                    <Textarea
                      value={val}
                      onChange={(e) => updateParsedField(key, e.target.value)}
                      className="text-[10px] min-h-[36px] resize-none p-1.5"
                    />
                  </div>
                )
              })}

              {/* Gaps */}
              {(parsed.gaps?.length ?? 0) > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2 space-y-2">
                  <div className="flex items-center gap-1">
                    <Icons.AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-600">Gaps in Brief</p>
                  </div>
                  {parsed.gaps.map((g, i) => (
                    <div key={i} className="space-y-0.5">
                      <p className="text-[10px] text-amber-700">• {g}</p>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="Fill in this gap…"
                          value={gapAnswers[i] ?? ''}
                          onChange={(e) => setGapAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                          className="flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-[10px] outline-none focus:border-amber-400"
                        />
                        <button
                          onClick={() => handleSuggestGap(i, g)}
                          disabled={suggestingGap[i]}
                          title="Suggest a value"
                          className="shrink-0 flex items-center justify-center h-[26px] w-[26px] rounded border border-amber-200 bg-white hover:bg-amber-50 transition-colors disabled:opacity-40"
                        >
                          {suggestingGap[i]
                            ? <Icons.Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
                            : <Icons.Sparkles className="h-3 w-3 text-amber-500" />}
                        </button>
                      </div>
                    </div>
                  ))}
                  {Object.values(gapAnswers).some((v) => v?.trim()) && (
                    <button
                      onClick={() => handleConvert(true)}
                      disabled={translating}
                      className="flex items-center gap-1 text-[10px] font-semibold disabled:opacity-40 hover:opacity-80 transition-opacity"
                      style={{ color: '#b45309' }}
                    >
                      <Icons.RefreshCw className="h-3 w-3" /> Re-convert with answers
                    </button>
                  )}
                </div>
              )}

              {(parsed.gaps?.length ?? 0) === 0 && (
                <button
                  onClick={() => handleConvert(false)}
                  disabled={translating || !rawText}
                  className="flex items-center gap-1 text-[10px] font-medium disabled:opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: '#a200ee' }}
                >
                  <Icons.RefreshCw className="h-3 w-3" /> Re-convert
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
