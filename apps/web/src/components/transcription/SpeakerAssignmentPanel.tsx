import { useCallback, useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  id: string
  speaker: string
  speakerName: string | null
  startMs: number
  endMs: number
  text: string
}

interface SpeakerGroup {
  speaker: string          // raw label: "0", "1" …
  audioClipKey: string | null
  speakerName: string | null
  stakeholderId: string | null
  isAgencyParticipant: boolean
  segments: Segment[]
}

interface Stakeholder {
  id: string
  name: string
  email: string
  role: string | null
}

interface SessionDetail {
  id: string
  title: string | null
  status: string
  durationSecs: number | null
  speakers: SpeakerGroup[]
  stakeholders: Stakeholder[]
}

interface Assignment {
  speaker: string
  speakerName: string
  stakeholderId: string | null
  isAgencyParticipant: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Audio clip player ────────────────────────────────────────────────────────

function AudioClipPlayer({ clipKey }: { clipKey: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      setPlaying(false)
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }, [playing])

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={`${API_URL}/uploads/${clipKey}`}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <button
        onClick={toggle}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-accent hover:bg-accent/80 transition-colors"
        title={playing ? 'Pause' : 'Play 10-second clip'}
      >
        {playing
          ? <Icons.Pause className="h-3 w-3" />
          : <Icons.Play className="h-3 w-3" />
        }
      </button>
      <span className="text-[11px] text-muted-foreground">10-sec clip</span>
    </div>
  )
}

// ─── Add stakeholder inline form ──────────────────────────────────────────────

function AddStakeholderForm({
  sessionId,
  onCreated,
}: {
  sessionId: string
  onCreated: (s: Stakeholder) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/transcriptions/${sessionId}/stakeholders`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      onCreated(json.data)
      setName('')
      setEmail('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create stakeholder')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Add new stakeholder</p>
      <div className="flex gap-2">
        <Input
          placeholder="Name"
          className="h-7 text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Email"
          className="h-7 text-xs"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button size="sm" variant="secondary" className="h-7 shrink-0 text-xs" onClick={submit} disabled={loading || !name || !email}>
          {loading ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Plus className="h-3 w-3" />}
        </Button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

// ─── Speaker card ─────────────────────────────────────────────────────────────

function SpeakerCard({
  group,
  assignment,
  stakeholders,
  sessionId,
  onAssignmentChange,
  onStakeholderCreated,
}: {
  group: SpeakerGroup
  assignment: Assignment
  stakeholders: Stakeholder[]
  sessionId: string
  onAssignmentChange: (speaker: string, update: Partial<Assignment>) => void
  onStakeholderCreated: (s: Stakeholder) => void
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isAssigned = assignment.isAgencyParticipant || assignment.stakeholderId !== null

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      isAssigned ? 'border-emerald-300 bg-emerald-50/60' : 'border-border',
    )}>
      {/* Speaker header */}
      <div className="flex items-center gap-3 p-3">
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          isAssigned ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground',
        )}>
          {group.speaker}
        </div>

        <div className="flex-1 min-w-0">
          <Input
            placeholder={`Speaker ${group.speaker} name…`}
            className="h-7 text-xs"
            value={assignment.speakerName}
            onChange={(e) => onAssignmentChange(group.speaker, { speakerName: e.target.value })}
          />
        </div>

        {isAssigned && <Icons.CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
      </div>

      {/* Audio clip + segments preview */}
      <div className="border-t border-border/40 px-3 pb-2 pt-2 space-y-2">
        {group.audioClipKey && (
          <AudioClipPlayer clipKey={group.audioClipKey} />
        )}

        {/* Segments preview */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Icons.ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          {group.segments.length} segment{group.segments.length !== 1 ? 's' : ''}
        </button>

        {expanded && (
          <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1">
            {group.segments.map((seg) => (
              <div key={seg.id} className="flex gap-2 text-xs">
                <span className="shrink-0 tabular-nums text-muted-foreground w-10">
                  {formatMs(seg.startMs)}
                </span>
                <p className="text-foreground/80 leading-relaxed">{seg.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignment controls */}
      <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-2">
        {/* Agency participant toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Mark as agency participant</Label>
          <button
            onClick={() => {
              onAssignmentChange(group.speaker, {
                isAgencyParticipant: !assignment.isAgencyParticipant,
                stakeholderId: null,
              })
            }}
            className={cn(
              'h-5 w-9 rounded-full border transition-colors',
              assignment.isAgencyParticipant ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
            )}
          >
            <span className={cn('block h-3.5 w-3.5 rounded-full bg-white transition-transform', assignment.isAgencyParticipant ? 'translate-x-4' : 'translate-x-0.5')} />
          </button>
        </div>

        {/* Stakeholder dropdown (hidden when agency participant) */}
        {!assignment.isAgencyParticipant && (
          <>
            <Select
              value={assignment.stakeholderId ?? '__none__'}
              onValueChange={(v) => {
                if (v === '__none__') {
                  onAssignmentChange(group.speaker, { stakeholderId: null })
                } else {
                  const s = stakeholders.find((s) => s.id === v)
                  onAssignmentChange(group.speaker, { stakeholderId: v, speakerName: s?.name ?? assignment.speakerName })
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Assign to stakeholder…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">
                  — Not assigned —
                </SelectItem>
                {stakeholders.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                    {s.role ? ` (${s.role})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
            >
              <Icons.Plus className="h-3 w-3" />
              Add new stakeholder
            </button>

            {showAddForm && (
              <AddStakeholderForm
                sessionId={sessionId}
                onCreated={(s) => {
                  onStakeholderCreated(s)
                  onAssignmentChange(group.speaker, { stakeholderId: s.id })
                  setShowAddForm(false)
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SpeakerAssignmentPanel({
  sessionId,
  onComplete,
  onDismiss,
}: {
  sessionId: string
  onComplete: () => void
  onDismiss: () => void
}) {
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch session
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(`/api/v1/transcriptions/${sessionId}`)
        if (!res.ok) throw new Error(`Failed to load session (${res.status})`)
        const json = await res.json()
        if (cancelled) return
        const data: SessionDetail = json.data
        setSession(data)
        setStakeholders(data.stakeholders)
        // Initialise assignments from existing data
        const init: Record<string, Assignment> = {}
        for (const g of data.speakers) {
          init[g.speaker] = {
            speaker: g.speaker,
            speakerName: g.speakerName ?? `Speaker ${g.speaker}`,
            stakeholderId: g.stakeholderId,
            isAgencyParticipant: g.isAgencyParticipant,
          }
        }
        setAssignments(init)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  const handleAssignmentChange = (speaker: string, update: Partial<Assignment>) => {
    setAssignments((prev) => ({
      ...prev,
      [speaker]: { ...prev[speaker], ...update },
    }))
  }

  const handleStakeholderCreated = (s: Stakeholder) => {
    setStakeholders((prev) => [...prev, s])
  }

  const allAssigned = session?.speakers.every((g) => {
    const a = assignments[g.speaker]
    return a?.isAgencyParticipant || a?.stakeholderId !== null
  }) ?? false

  const handleSubmit = async () => {
    if (!allAssigned) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/v1/transcriptions/${sessionId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assignments: Object.values(assignments) }),
      })
      if (!res.ok) throw new Error(await res.text())
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/60 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col border-r border-border bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
            <Icons.Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Speaker Assignment</h2>
            <p className="text-xs text-muted-foreground">
              Identify each speaker before the workflow can continue
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-6">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {session && !loading && (
              <>
                {/* Session info */}
                <div className="flex items-center gap-4 rounded-md border border-border bg-background/50 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{session.title}</span>
                  {session.durationSecs && (
                    <span className="text-muted-foreground">
                      {Math.floor(session.durationSecs / 60)}m {session.durationSecs % 60}s
                    </span>
                  )}
                  <span className="ml-auto rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                    {session.speakers.length} speaker{session.speakers.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Speaker cards */}
                {session.speakers.map((group) => (
                  <SpeakerCard
                    key={group.speaker}
                    group={group}
                    assignment={assignments[group.speaker] ?? { speaker: group.speaker, speakerName: '', stakeholderId: null, isAgencyParticipant: false }}
                    stakeholders={stakeholders}
                    sessionId={sessionId}
                    onAssignmentChange={handleAssignmentChange}
                    onStakeholderCreated={handleStakeholderCreated}
                  />
                ))}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          {!allAssigned && session && (
            <p className="mb-3 text-[11px] text-amber-600">
              All speakers must be assigned or marked as agency participants before proceeding.
            </p>
          )}
          {error && <p className="mb-3 text-[11px] text-red-600">{error}</p>}
          <Button
            onClick={handleSubmit}
            disabled={!allAssigned || submitting || loading}
            className="w-full"
          >
            {submitting
              ? <><Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving assignments…</>
              : <><Icons.CheckCircle2 className="mr-2 h-4 w-4" />Confirm assignments &amp; continue</>
            }
          </Button>
        </div>
      </div>

      {/* Dim overlay click to dismiss */}
      <div className="flex-1 cursor-pointer" onClick={onDismiss} />
    </div>
  )
}
