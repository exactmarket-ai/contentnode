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

interface LeadershipMember {
  id: string
  clientId: string
  name: string
  role: string
  linkedInUrl: string | null
  headshotUrl: string | null
  bio: string | null
  personalTone: string | null
  signatureTopics: string[]
  signatureStories: string[]
  avoidPhrases: string[]
  createdAt: string
}

const CONTENT_TYPE_LABELS: Record<string, { label: string; icon: keyof typeof Icons; description: string }> = {
  linkedin_post:     { label: 'LinkedIn Post',     icon: 'FileText',     description: '150-200 word personal post' },
  linkedin_carousel: { label: 'LinkedIn Carousel', icon: 'LayoutGrid',   description: '7-slide educational carousel' },
  linkedin_article:  { label: 'LinkedIn Article',  icon: 'BookOpen',     description: '800-1200 word authored article' },
  linkedin_bio:      { label: 'LinkedIn "About"',  icon: 'User',         description: '250-300 word profile bio' },
  speaking_bio:      { label: 'Speaker Bio',       icon: 'Mic',          description: '100-word conference bio' },
  email_intro:       { label: 'Email Intro',       icon: 'Mail',         description: 'Personal intro to new contact' },
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
  const [linkedInUrl, setLinkedInUrl]     = useState(member?.linkedInUrl ?? '')
  const [bio, setBio]                     = useState(member?.bio ?? '')
  const [personalTone, setPersonalTone]   = useState(member?.personalTone ?? '')
  const [signatureTopics, setSignatureTopics]    = useState<string[]>(member?.signatureTopics ?? [])
  const [signatureStories, setSignatureStories]  = useState<string[]>(member?.signatureStories ?? [])
  const [avoidPhrases, setAvoidPhrases]          = useState<string[]>(member?.avoidPhrases ?? [])
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !role.trim()) return
    setSaving(true)
    try {
      const payload = {
        clientId,
        name: name.trim(),
        role: role.trim(),
        linkedInUrl: linkedInUrl.trim() || undefined,
        bio: bio.trim() || undefined,
        personalTone: personalTone.trim() || undefined,
        signatureTopics,
        signatureStories,
        avoidPhrases,
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20" onClick={onClose}>
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

          {/* LinkedIn */}
          <div>
            <label className="block text-xs font-medium mb-1">LinkedIn URL</label>
            <Input value={linkedInUrl} onChange={(e) => setLinkedInUrl(e.target.value)} className="h-8 text-xs" placeholder="https://linkedin.com/in/..." />
          </div>

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
// MemberDrawer — slide-in profile + content generation panel
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

  const meta = CONTENT_TYPE_LABELS[contentType]
  const IconComp = Icons[meta.icon] as React.ElementType

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
            {member.linkedInUrl && (
              <a href={member.linkedInUrl} target="_blank" rel="noopener noreferrer"
                className="rounded p-1.5 text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10 transition-colors"
                title="LinkedIn profile"
              >
                <Icons.ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
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

        {/* Content generation */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <p className="text-xs font-semibold text-foreground">Generate content</p>

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
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberCard
// ─────────────────────────────────────────────────────────────────────────────

function MemberCard({ member, onClick }: { member: LeadershipMember; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5 cursor-pointer hover:border-blue-400/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm', avatarColor(member.name))}>
          {getInitials(member.name)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{member.name}</p>
          <p className="text-xs text-muted-foreground truncate">{member.role}</p>
        </div>
        {member.linkedInUrl && (
          <Icons.Linkedin className="h-4 w-4 text-blue-600 ml-auto shrink-0" />
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
    // Open the drawer for a newly created member
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
          {/* Add card */}
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
