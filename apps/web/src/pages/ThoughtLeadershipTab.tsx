import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SocialPlatform = 'linkedin' | 'x' | 'substack' | 'website' | 'other'

interface SocialProfile {
  platform: SocialPlatform
  url: string
  syncEnabled: boolean
}

interface LeadershipMember {
  id: string
  clientId: string
  name: string
  role: string
  socialProfiles: SocialProfile[]
  socialSyncLastRanAt: string | null
  headshotUrl: string | null
  bio: string | null
  personalTone: string | null
  signatureTopics: string[]
  signatureStories: string[]
  avoidPhrases: string[]
  linkedUserId: string | null
  createdAt: string
}

interface AgencyUser {
  id: string
  name: string
  email: string
  role: string
}

interface BrainStatus {
  exists: boolean
  lastSynthesisAt: string | null
  context: string | null
  attachments: Array<{ source: string; count: number }>
  socialSyncLastRanAt: string | null
}

const CONTENT_TYPE_LABELS: Record<string, { label: string; icon: keyof typeof Icons; description: string }> = {
  linkedin_post:     { label: 'LinkedIn Post',     icon: 'FileText',     description: '150-200 word personal post' },
  linkedin_carousel: { label: 'LinkedIn Carousel', icon: 'LayoutGrid',   description: '7-slide educational carousel' },
  linkedin_article:  { label: 'LinkedIn Article',  icon: 'BookOpen',     description: '800-1200 word authored article' },
  linkedin_bio:      { label: 'LinkedIn "About"',  icon: 'User',         description: '250-300 word profile bio' },
  speaking_bio:      { label: 'Speaker Bio',       icon: 'Mic',          description: '100-word conference bio' },
  email_intro:       { label: 'Email Intro',       icon: 'Mail',         description: 'Personal intro to new contact' },
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  x:        'X / Twitter',
  substack: 'Substack',
  website:  'Personal site',
  other:    'Other',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

function avatarColor(name: string): string {
  const colors = [
    'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500',
  ]
  const idx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  return colors[idx]
}

function detectPlatform(url: string): SocialPlatform {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('linkedin.com')) return 'linkedin'
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x'
    if (host.includes('substack.com')) return 'substack'
    return 'website'
  } catch {
    return 'other'
  }
}

function brainStatusInfo(brain: BrainStatus | null): { dot: string; label: string; pulse: boolean } {
  if (!brain || !brain.exists) return { dot: 'bg-gray-300', label: 'Not initialized', pulse: false }
  if (!brain.lastSynthesisAt) return { dot: 'bg-amber-400', label: 'Building…', pulse: true }
  const daysSince = (Date.now() - new Date(brain.lastSynthesisAt).getTime()) / 86_400_000
  if (daysSince <= 30) return { dot: 'bg-green-500', label: 'Active', pulse: false }
  return { dot: 'bg-amber-400', label: 'Outdated', pulse: false }
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// StringListInput — editable comma/enter tag list
// ─────────────────────────────────────────────────────────────────────────────

function StringListInput({
  label, placeholder, value, onChange,
}: {
  label: string
  placeholder: string
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const trimmed = draft.trim()
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed])
    setDraft('')
  }

  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((item) => (
          <span key={item} className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-700">
            {item}
            <button onClick={() => onChange(value.filter((v) => v !== item))} className="hover:text-blue-900">
              <Icons.X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="h-7 text-xs flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SocialProfilesInput — manage list of social profiles with add/remove/toggle
// ─────────────────────────────────────────────────────────────────────────────

function SocialProfilesInput({
  value,
  onChange,
}: {
  value: SocialProfile[]
  onChange: (v: SocialProfile[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draftUrl, setDraftUrl]         = useState('')
  const [draftPlatform, setDraftPlatform] = useState<SocialPlatform>('linkedin')

  const handleUrlChange = (url: string) => {
    setDraftUrl(url)
    if (url) setDraftPlatform(detectPlatform(url))
  }

  const addProfile = () => {
    const url = draftUrl.trim()
    if (!url) return
    onChange([...value, { platform: draftPlatform, url, syncEnabled: true }])
    setDraftUrl('')
    setDraftPlatform('linkedin')
    setAdding(false)
  }

  const removeProfile = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const toggleSync = (idx: number) => {
    const updated = [...value]
    updated[idx] = { ...updated[idx], syncEnabled: !updated[idx].syncEnabled }
    onChange(updated)
  }

  return (
    <div>
      <label className="block text-xs font-medium mb-2">Social & Web Presence</label>

      {value.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {value.map((p, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">{PLATFORM_LABELS[p.platform]}</span>
              <span className="text-[11px] text-foreground/80 truncate flex-1">{p.url}</span>
              <button
                type="button"
                onClick={() => toggleSync(i)}
                className={cn(
                  'text-[10px] rounded-full px-1.5 py-0.5 border font-medium shrink-0 transition-colors',
                  p.syncEnabled
                    ? 'border-green-500 text-green-600 bg-green-50'
                    : 'border-gray-300 text-gray-400 bg-gray-50',
                )}
                title={p.syncEnabled ? 'Sync enabled — click to disable' : 'Sync disabled — click to enable'}
              >
                {p.syncEnabled ? 'Sync on' : 'Sync off'}
              </button>
              <button type="button" onClick={() => removeProfile(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                <Icons.X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-blue-300 bg-blue-50/30 p-2">
          <div className="flex gap-1.5">
            <select
              value={draftPlatform}
              onChange={(e) => setDraftPlatform(e.target.value as SocialPlatform)}
              className="h-7 rounded border border-border bg-white text-xs px-1 shrink-0"
            >
              {(Object.entries(PLATFORM_LABELS) as Array<[SocialPlatform, string]>).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <Input
              value={draftUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProfile() } }}
              placeholder="https://..."
              className="h-7 text-xs flex-1"
              autoFocus
            />
          </div>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" className="h-6 text-xs px-2" onClick={addProfile} disabled={!draftUrl.trim()}>
              <Icons.Check className="h-3 w-3 mr-1" />Add
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => { setAdding(false); setDraftUrl('') }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.Plus className="h-3 w-3" />
          Add profile
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BrainStatusDot — small indicator shown on member card and drawer
// ─────────────────────────────────────────────────────────────────────────────

function BrainStatusDot({ brain, onClick }: { brain: BrainStatus | null; onClick?: () => void }) {
  const { dot, label, pulse } = brainStatusInfo(brain)
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Brain: ${label}`}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted/50 transition-colors"
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', dot, pulse && 'animate-pulse')} />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BrainPopover — shown when brain status dot is clicked in the drawer
// ─────────────────────────────────────────────────────────────────────────────

function BrainPopover({
  memberId,
  brain,
  onClose,
  onResynthesize,
  onSyncNow,
}: {
  memberId: string
  brain: BrainStatus | null
  onClose: () => void
  onResynthesize: () => void
  onSyncNow: () => void
}) {
  const [showContext, setShowContext] = useState(false)
  const { dot, label, pulse } = brainStatusInfo(brain)

  const sourceLabels: Record<string, string> = {
    profile:     'Profile seeds',
    content_run: 'Content runs',
    edit_signal: 'Edit signals',
    social_sync: 'Social syncs',
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-end p-4 sm:p-6" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-border bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full', dot, pulse && 'animate-pulse')} />
            <span className="text-xs font-semibold">Brain — {label}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="text-[11px] text-muted-foreground">
            Last synthesized: <span className="text-foreground font-medium">{formatRelative(brain?.lastSynthesisAt ?? null)}</span>
          </div>

          {brain?.attachments && brain.attachments.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Signal sources</p>
              {brain.attachments.map((a) => (
                <div key={a.source} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{sourceLabels[a.source] ?? a.source}</span>
                  <span className="font-medium tabular-nums">{a.count}</span>
                </div>
              ))}
            </div>
          )}

          {brain?.context && (
            <div>
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"
              >
                <Icons.ChevronDown className={cn('h-3 w-3 transition-transform', showContext && 'rotate-180')} />
                {showContext ? 'Hide context' : 'View compiled context'}
              </button>
              {showContext && (
                <pre className="mt-2 whitespace-pre-wrap text-[10px] leading-relaxed text-foreground/80 max-h-60 overflow-y-auto rounded border border-border bg-muted/30 p-2 font-sans">
                  {brain.context}
                </pre>
              )}
            </div>
          )}

          <div className="flex gap-1.5 pt-1 border-t border-border">
            <Button variant="outline" size="sm" className="h-6 text-[11px] flex-1" onClick={onResynthesize}>
              <Icons.RefreshCw className="h-3 w-3 mr-1" />Re-synthesize
            </Button>
            {(brain?.attachments?.find((a) => a.source === 'social_sync') !== undefined ||
              (brain as BrainStatus | null)?.socialSyncLastRanAt !== undefined) && (
              <Button variant="outline" size="sm" className="h-6 text-[11px] flex-1" onClick={onSyncNow}>
                <Icons.RefreshCcw className="h-3 w-3 mr-1" />Sync now
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberModal — create or edit a leadership member
// ─────────────────────────────────────────────────────────────────────────────

interface MemberModalProps {
  clientId: string
  member?: LeadershipMember
  onClose: () => void
  onSaved: (m: LeadershipMember) => void
}

function MemberModal({ clientId, member, onClose, onSaved }: MemberModalProps) {
  const isEdit = !!member
  const [name, setName]                   = useState(member?.name ?? '')
  const [role, setRole]                   = useState(member?.role ?? '')
  const [socialProfiles, setSocialProfiles] = useState<SocialProfile[]>(member?.socialProfiles ?? [])
  const [bio, setBio]                     = useState(member?.bio ?? '')
  const [personalTone, setPersonalTone]   = useState(member?.personalTone ?? '')
  const [signatureTopics, setSignatureTopics]    = useState<string[]>(member?.signatureTopics ?? [])
  const [signatureStories, setSignatureStories]  = useState<string[]>(member?.signatureStories ?? [])
  const [avoidPhrases, setAvoidPhrases]          = useState<string[]>(member?.avoidPhrases ?? [])
  const [linkedUserId, setLinkedUserId]          = useState<string | null>(member?.linkedUserId ?? null)
  const [agencyUsers, setAgencyUsers]            = useState<AgencyUser[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/v1/leadership/agency-users')
      .then((r) => r.json())
      .then((data) => setAgencyUsers(data.data ?? []))
      .catch(() => {})
  }, [])

  const handleSubmit = async () => {
    if (!name.trim() || !role.trim()) return
    setSaving(true)
    try {
      const payload = {
        clientId,
        name: name.trim(),
        role: role.trim(),
        socialProfiles,
        bio: bio.trim() || undefined,
        personalTone: personalTone.trim() || undefined,
        signatureTopics,
        signatureStories,
        avoidPhrases,
        ...(isEdit ? { linkedUserId } : {}),
      }
      const res = isEdit
        ? await apiFetch(`/api/v1/leadership/${member!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await apiFetch('/api/v1/leadership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Save failed')
        return
      }
      const { data } = await res.json()
      onSaved(data)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-white shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold">{isEdit ? 'Edit member' : 'Add leadership member'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Name + Role */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Full name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="Jane Smith" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Role / Title *</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} className="h-8 text-xs" placeholder="CEO" />
            </div>
          </div>

          {/* Social & Web Presence */}
          <SocialProfilesInput value={socialProfiles} onChange={setSocialProfiles} />

          {/* Bio */}
          <div>
            <label className="block text-xs font-medium mb-1">Short bio</label>
            <p className="text-[11px] text-muted-foreground mb-1.5">2-3 sentences about their background and what they stand for</p>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} className="min-h-[72px] resize-none text-xs" placeholder="Jane has spent 15 years building B2B SaaS companies..." />
          </div>

          {/* Personal tone */}
          <div>
            <label className="block text-xs font-medium mb-1">Personal voice & tone</label>
            <p className="text-[11px] text-muted-foreground mb-1.5">How they communicate — adjectives, style notes, what makes their voice distinct</p>
            <Textarea value={personalTone} onChange={(e) => setPersonalTone(e.target.value)} className="min-h-[60px] resize-none text-xs" placeholder="Direct and opinionated. Challenges conventional wisdom. Uses short sentences. Skips fluff..." />
          </div>

          {/* Signature topics */}
          <StringListInput
            label="Signature topics"
            placeholder="e.g. GTM strategy, founder-led sales"
            value={signatureTopics}
            onChange={setSignatureTopics}
          />

          {/* Signature stories */}
          <StringListInput
            label="Signature stories / examples they reference"
            placeholder="e.g. The time we lost our biggest client and what we learned"
            value={signatureStories}
            onChange={setSignatureStories}
          />

          {/* Avoid phrases */}
          <StringListInput
            label="Things they'd never say"
            placeholder="e.g. synergy, move the needle, disruption"
            value={avoidPhrases}
            onChange={setAvoidPhrases}
          />

          {/* Link to ContentNode user (edit mode only) */}
          {isEdit && (
            <div>
              <label className="block text-xs font-medium mb-1">Link to ContentNode user</label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                When linked, edits by this user automatically write to this thought leader's brain.
              </p>
              <select
                value={linkedUserId ?? ''}
                onChange={(e) => setLinkedUserId(e.target.value || null)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              >
                <option value="">— Not linked —</option>
                {agencyUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={saving || !name.trim() || !role.trim()}>
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {isEdit ? 'Save changes' : 'Add member'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberDrawer — slide-in profile + content generation + brain panel
// ─────────────────────────────────────────────────────────────────────────────

interface DrawerProps {
  member: LeadershipMember
  onClose: () => void
  onEdit: () => void
  onDeleted: () => void
}

function MemberDrawer({ member, onClose, onEdit, onDeleted }: DrawerProps) {
  const [contentType, setContentType] = useState('linkedin_post')
  const [topic, setTopic]             = useState('')
  const [generating, setGenerating]   = useState(false)
  const [output, setOutput]           = useState('')
  const [copied, setCopied]           = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [brain, setBrain]             = useState<BrainStatus | null>(null)
  const [showBrainPopover, setShowBrainPopover] = useState(false)
  const [syncing, setSyncing]         = useState(false)
  const [resynthesizing, setResynthesizing] = useState(false)
  const [activeTab, setActiveTab]     = useState<'generate' | 'brain'>('generate')

  // Load brain status on mount
  useEffect(() => {
    apiFetch(`/api/v1/leadership/${member.id}/brain`)
      .then((r) => r.json())
      .then(({ data }) => setBrain(data))
      .catch(() => {})
  }, [member.id])

  const handleGenerate = async () => {
    setGenerating(true)
    setOutput('')
    try {
      const res = await apiFetch(`/api/v1/leadership/${member.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, topic: topic.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Generation failed')
        return
      }
      const { data } = await res.json()
      setOutput(data.content)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(output).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = async () => {
    if (!confirm(`Remove ${member.name} from this client's leadership team?`)) return
    setDeleting(true)
    try {
      await apiFetch(`/api/v1/leadership/${member.id}`, { method: 'DELETE' })
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const res = await apiFetch(`/api/v1/leadership/${member.id}/sync-now`, { method: 'POST' })
      if (res.ok) {
        alert('Social sync queued — brain will update in a few minutes.')
      } else {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Sync failed')
      }
    } finally {
      setSyncing(false)
      setShowBrainPopover(false)
    }
  }

  const handleResynthesize = async () => {
    setResynthesizing(true)
    try {
      const res = await apiFetch(`/api/v1/leadership/${member.id}/sync-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthesizeOnly: true }),
      })
      if (res.ok) {
        alert('Re-synthesis queued — brain will update shortly.')
      }
    } finally {
      setResynthesizing(false)
      setShowBrainPopover(false)
    }
  }

  const meta = CONTENT_TYPE_LABELS[contentType]
  const IconComp = Icons[meta.icon] as React.ElementType
  const linkedInProfile = member.socialProfiles.find((p) => p.platform === 'linkedin')

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-transparent" onClick={onClose}>
      <div
        className="relative flex w-full max-w-lg flex-col bg-white border-l border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 shrink-0">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white text-sm font-semibold', avatarColor(member.name))}>
            {getInitials(member.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{member.name}</p>
            <p className="text-xs text-muted-foreground">{member.role}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {linkedInProfile && (
              <a href={linkedInProfile.url} target="_blank" rel="noopener noreferrer"
                className="rounded p-1.5 text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10 transition-colors"
                title="LinkedIn profile"
              >
                <Icons.ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <BrainStatusDot brain={brain} onClick={() => setShowBrainPopover(true)} />
            <button
              className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={onEdit} title="Edit profile"
            >
              <Icons.Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={handleDelete} disabled={deleting} title="Remove member"
            >
              <Icons.Trash2 className="h-3.5 w-3.5" />
            </button>
            <button className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={onClose}>
              <Icons.X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Profile summary */}
        <div className="border-b border-border px-5 py-3 flex flex-col gap-2 shrink-0">
          {member.bio && <p className="text-xs text-muted-foreground leading-relaxed">{member.bio}</p>}
          {member.personalTone && (
            <div className="flex items-start gap-1.5">
              <Icons.MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">{member.personalTone}</p>
            </div>
          )}
          {member.signatureTopics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {member.signatureTopics.map((t) => (
                <span key={t} className="rounded-full bg-blue-500/8 border border-blue-200 px-2 py-0.5 text-[10px] text-blue-700">{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setActiveTab('generate')}
            className={cn('flex-1 py-2 text-xs font-medium transition-colors', activeTab === 'generate' ? 'text-foreground border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            Generate content
          </button>
          <button
            onClick={() => setActiveTab('brain')}
            className={cn('flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5', activeTab === 'brain' ? 'text-foreground border-b-2 border-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', brainStatusInfo(brain).dot)} />
            Brain
          </button>
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'generate' ? (
            <div className="px-5 py-4 flex flex-col gap-4">
              {/* Content type grid */}
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(CONTENT_TYPE_LABELS).map(([key, val]) => {
                  const Ic = Icons[val.icon] as React.ElementType
                  return (
                    <button
                      key={key}
                      onClick={() => setContentType(key)}
                      className={cn(
                        'flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                        contentType === key
                          ? 'border-blue-500 bg-blue-500/8'
                          : 'border-border hover:border-blue-300 hover:bg-muted/50',
                      )}
                    >
                      <Ic className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', contentType === key ? 'text-blue-600' : 'text-muted-foreground')} />
                      <div>
                        <p className={cn('text-[11px] font-medium leading-tight', contentType === key ? 'text-blue-700' : '')}>{val.label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{val.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Topic / angle */}
              <div>
                <label className="block text-xs font-medium mb-1">Topic or angle <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-8 text-xs"
                  placeholder={contentType === 'linkedin_post' ? 'e.g. Why most GTM strategies fail in year 2' : 'e.g. Leave blank to let Claude choose'}
                />
              </div>

              <Button onClick={handleGenerate} disabled={generating} className="w-full">
                {generating
                  ? <><Icons.Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Generating in {member.name.split(' ')[0]}&apos;s voice…</>
                  : <><IconComp className="h-3.5 w-3.5 mr-2" />Generate {meta.label}</>
                }
              </Button>

              {/* Output */}
              {output && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{meta.label}</p>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {copied ? <Icons.Check className="h-3 w-3 text-green-500" /> : <Icons.Copy className="h-3 w-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-sans">{output}</pre>
                  <Button variant="outline" size="sm" className="h-7 text-xs self-start" onClick={handleGenerate} disabled={generating}>
                    <Icons.RefreshCw className="h-3 w-3 mr-1" />
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Brain tab */
            <BrainTab
              memberId={member.id}
              brain={brain}
              socialProfiles={member.socialProfiles}
              onSyncNow={handleSyncNow}
              onResynthesize={handleResynthesize}
              syncing={syncing}
              resynthesizing={resynthesizing}
            />
          )}
        </div>
      </div>

      {/* Brain popover */}
      {showBrainPopover && (
        <BrainPopover
          memberId={member.id}
          brain={brain}
          onClose={() => setShowBrainPopover(false)}
          onResynthesize={handleResynthesize}
          onSyncNow={handleSyncNow}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BrainTab — brain view inside drawer
// ─────────────────────────────────────────────────────────────────────────────

function BrainTab({
  memberId,
  brain,
  socialProfiles,
  onSyncNow,
  onResynthesize,
  syncing,
  resynthesizing,
}: {
  memberId: string
  brain: BrainStatus | null
  socialProfiles: SocialProfile[]
  onSyncNow: () => void
  onResynthesize: () => void
  syncing: boolean
  resynthesizing: boolean
}) {
  const [attachments, setAttachments] = useState<Array<{ id: string; source: string; content: string; createdAt: string; metadata: Record<string, unknown> | null }>>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const sourceColors: Record<string, string> = {
    profile:     'bg-blue-100 text-blue-700',
    content_run: 'bg-violet-100 text-violet-700',
    edit_signal: 'bg-amber-100 text-amber-700',
    social_sync: 'bg-emerald-100 text-emerald-700',
  }

  const { dot, label, pulse } = brainStatusInfo(brain)

  const loadAttachments = () => {
    setLoadingAttachments(true)
    apiFetch(`/api/v1/leadership/${memberId}/brain/attachments`)
      .then((r) => r.json())
      .then(({ data }) => setAttachments(data ?? []))
      .catch(() => {})
      .finally(() => setLoadingAttachments(false))
  }

  const hasSyncableProfiles = socialProfiles.some((p) => p.syncEnabled)

  return (
    <div className="px-5 py-4 flex flex-col gap-4">
      {/* Status + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', dot, pulse && 'animate-pulse')} />
          <span className="text-xs font-medium">{label}</span>
          {brain?.lastSynthesisAt && (
            <span className="text-[11px] text-muted-foreground">· {formatRelative(brain.lastSynthesisAt)}</span>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={onResynthesize} disabled={resynthesizing}>
            {resynthesizing ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icons.RefreshCw className="h-2.5 w-2.5" />}
          </Button>
          {hasSyncableProfiles && (
            <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={onSyncNow} disabled={syncing}>
              {syncing ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icons.RefreshCcw className="h-2.5 w-2.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Social sync info */}
      {socialProfiles.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium">Social & Web Presence</p>
            <span className="text-[10px] text-muted-foreground">
              {brain?.socialSyncLastRanAt ? `Last synced: ${formatRelative(brain.socialSyncLastRanAt)}` : 'Never synced'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {socialProfiles.map((p, i) => (
              <span key={i} className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', p.syncEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {PLATFORM_LABELS[p.platform]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Signal source counts */}
      {brain?.attachments && brain.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brain.attachments.map((a) => (
            <span key={a.source} className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', sourceColors[a.source] ?? 'bg-gray-100 text-gray-600')}>
              {a.source.replace(/_/g, ' ')} × {a.count}
            </span>
          ))}
        </div>
      )}

      {/* Compiled context */}
      {brain?.context && (
        <div>
          <button
            type="button"
            onClick={() => setShowContext((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-blue-700"
          >
            <Icons.ChevronDown className={cn('h-3 w-3 transition-transform', showContext && 'rotate-180')} />
            Compiled voice profile
          </button>
          {showContext && (
            <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80 rounded-lg border border-border bg-muted/20 p-3 font-sans">
              {brain.context}
            </pre>
          )}
        </div>
      )}

      {/* Attachment feed */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium">Signal history</p>
          <button
            type="button"
            onClick={loadAttachments}
            disabled={loadingAttachments}
            className="text-[11px] text-blue-600 hover:text-blue-800"
          >
            {loadingAttachments ? 'Loading…' : attachments.length > 0 ? 'Refresh' : 'Load'}
          </button>
        </div>
        {attachments.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {attachments.slice(0, 20).map((a) => (
              <div key={a.id} className="rounded-lg border border-border bg-transparent p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', sourceColors[a.source] ?? 'bg-gray-100 text-gray-600')}>
                    {a.source.replace(/_/g, ' ')}
                  </span>
                  {!!(a.metadata as Record<string, unknown>)?.platform && (
                    <span className="text-[10px] text-muted-foreground">
                      {String((a.metadata as Record<string, unknown>).platform)}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">{formatRelative(a.createdAt)}</span>
                </div>
                <p className="text-[11px] text-foreground/80 leading-snug">
                  {expandedIds.has(a.id) ? a.content : a.content.slice(0, 120) + (a.content.length > 120 ? '…' : '')}
                </p>
                {a.content.length > 120 && (
                  <button
                    type="button"
                    onClick={() => setExpandedIds((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n })}
                    className="text-[10px] text-blue-600 hover:text-blue-800 mt-0.5"
                  >
                    {expandedIds.has(a.id) ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          !loadingAttachments && (
            <p className="text-xs text-muted-foreground">Click Load to see signal history.</p>
          )
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberCard
// ─────────────────────────────────────────────────────────────────────────────

function MemberCard({ member, onClick }: { member: LeadershipMember; onClick: () => void }) {
  const linkedInProfile = member.socialProfiles.find((p) => p.platform === 'linkedin')

  return (
    <div
      onClick={onClick}
      className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5 cursor-pointer hover:border-blue-400/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm', avatarColor(member.name))}>
          {getInitials(member.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{member.name}</p>
          <p className="text-xs text-muted-foreground truncate">{member.role}</p>
        </div>
        {linkedInProfile && (
          <Icons.Linkedin className="h-4 w-4 text-blue-600 shrink-0" />
        )}
      </div>

      {member.bio && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{member.bio}</p>
      )}

      {member.signatureTopics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {member.signatureTopics.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t}</span>
          ))}
          {member.signatureTopics.length > 3 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">+{member.signatureTopics.length - 3}</span>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-auto pt-1 border-t border-border">
        Click to generate content
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ThoughtLeadershipTab — main export
// ─────────────────────────────────────────────────────────────────────────────

export function ThoughtLeadershipTab({ clientId }: { clientId: string }) {
  const [members, setMembers]               = useState<LeadershipMember[]>([])
  const [loading, setLoading]               = useState(true)
  const [showAddModal, setShowAddModal]     = useState(false)
  const [editMember, setEditMember]         = useState<LeadershipMember | null>(null)
  const [openMember, setOpenMember]         = useState<LeadershipMember | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch(`/api/v1/leadership?clientId=${clientId}`)
      .then((r) => r.json())
      .then(({ data }) => setMembers(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSaved = (m: LeadershipMember) => {
    setMembers((prev) => {
      const idx = prev.findIndex((p) => p.id === m.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = m
        return next
      }
      return [...prev, m]
    })
    setShowAddModal(false)
    setEditMember(null)
    if (!editMember) setOpenMember(m)
  }

  const handleDeleted = () => {
    if (openMember) {
      setMembers((prev) => prev.filter((m) => m.id !== openMember.id))
      setOpenMember(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Thought Leadership</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Executive profiles for ghostwriting LinkedIn posts, articles, and speaking content in their voice
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowAddModal(true)}>
          <Icons.UserPlus className="h-3.5 w-3.5 mr-1.5" />
          + Leadership Member
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center rounded-xl border border-dashed border-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icons.Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No leadership members yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Add the executives you write for — CEO, CMO, founders. Each profile powers content generation in their authentic voice.
            </p>
          </div>
          <Button size="sm" className="h-8 text-xs mt-1" onClick={() => setShowAddModal(true)}>
            <Icons.UserPlus className="h-3.5 w-3.5 mr-1.5" />
            + Leadership Member
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} onClick={() => setOpenMember(m)} />
          ))}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-muted-foreground hover:text-foreground hover:border-blue-400/50 transition-colors min-h-[140px]"
          >
            <Icons.UserPlus className="h-5 w-5" />
            <span className="text-xs font-medium">+ Leadership Member</span>
          </button>
        </div>
      )}

      {/* Add / Edit modal */}
      {(showAddModal || editMember) && (
        <MemberModal
          clientId={clientId}
          member={editMember ?? undefined}
          onClose={() => { setShowAddModal(false); setEditMember(null) }}
          onSaved={handleSaved}
        />
      )}

      {/* Member drawer */}
      {openMember && (
        <MemberDrawer
          member={openMember}
          onClose={() => setOpenMember(null)}
          onEdit={() => { setEditMember(openMember); setOpenMember(null) }}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
