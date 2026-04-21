import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string
  clerkUserId: string
  email: string
  name: string | null
  title: string | null
  department: string | null
  role: string
  createdAt: string
  lastActiveAt: string | null
  pending: boolean
  inviteExpired: boolean
}

// ─── Types for history ────────────────────────────────────────────────────────

interface AuditEntry {
  id: string
  action: string
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface HistoryRun {
  id: string
  status: string
  createdAt: string
  workflow: { id: string; name: string; client: { id: string; name: string } | null } | null
}

interface MemberHistory {
  member: TeamMember & { lastActiveAt: string | null }
  stats: {
    totalRuns: number
    clientsWorkedWith: number
    accessGrantsGiven: number
    totalAuditActions: number
    templatesCreated: number
    feedbackEntered: number
    contentReviewed: number
    lastWorkflowRunAt: string | null
    lastActiveAt: string | null
  }
  recentRuns: HistoryRun[]
  clientsWorkedWith: { id: string; name: string }[]
  activity: AuditEntry[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  // System / legacy
  owner:          { bg: '#fdf5ff', border: '#e9c8ff', color: '#a200ee', label: 'Owner' },
  super_admin:    { bg: '#fdf5ff', border: '#e9c8ff', color: '#a200ee', label: 'Super Admin' },
  admin:          { bg: '#f0f6fd', border: '#b8d8f5', color: '#185fa5', label: 'Admin' },
  org_admin:      { bg: '#f0f6fd', border: '#b8d8f5', color: '#185fa5', label: 'Org Admin' },
  manager:        { bg: '#fffbeb', border: '#fde68a', color: '#b45309', label: 'Manager' },
  client_manager: { bg: '#fffbeb', border: '#fde68a', color: '#b45309', label: 'Client Manager' },
  lead:           { bg: '#f0fdf4', border: '#86efac', color: '#166534', label: 'Lead' },
  editor:         { bg: '#f0fdf4', border: '#86efac', color: '#166534', label: 'Editor' },
  member:         { bg: '#f4f4f2', border: '#dddcd6', color: '#5c5b52', label: 'Member' },
  reviewer:       { bg: '#fff7ed', border: '#fed7aa', color: '#9a3412', label: 'Reviewer' },
  viewer:         { bg: '#f9f9f7', border: '#dddcd6', color: '#6b7280', label: 'Viewer' },
  api_user:       { bg: '#f0f9ff', border: '#7dd3fc', color: '#0369a1', label: 'API User' },
  // Internal agency functional roles
  strategist:           { bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8', label: 'Strategist' },
  campaign_manager:     { bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8', label: 'Campaign Manager' },
  art_director:         { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', label: 'Art Director' },
  brand_manager:        { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', label: 'Brand Manager' },
  designer:             { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', label: 'Designer' },
  social_media_manager: { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', label: 'Social Media Manager' },
  content_manager:      { bg: '#ecfdf5', border: '#6ee7b7', color: '#065f46', label: 'Content Manager' },
  copywriter:           { bg: '#f0fdf4', border: '#86efac', color: '#166534', label: 'Copywriter' },
  seo_specialist:       { bg: '#f0f9ff', border: '#7dd3fc', color: '#0369a1', label: 'SEO Specialist' },
  performance_marketer: { bg: '#f0f9ff', border: '#7dd3fc', color: '#0369a1', label: 'Performance Marketer' },
  project_manager:      { bg: '#fffbeb', border: '#fde68a', color: '#b45309', label: 'Project Manager' },
  account_manager:      { bg: '#fffbeb', border: '#fde68a', color: '#b45309', label: 'Account Manager' },
  compliance_reviewer:  { bg: '#fff7ed', border: '#fed7aa', color: '#9a3412', label: 'Compliance Reviewer' },
  // Client-facing roles
  client_legal_reviewer:     { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: Legal' },
  client_brand_reviewer:     { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: Brand' },
  client_creative_reviewer:  { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: Creative' },
  client_marcom_reviewer:    { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: MarCom' },
  client_product_reviewer:   { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: Product' },
  client_executive_approver: { bg: '#fdf4ff', border: '#e9d5ff', color: '#7e22ce', label: 'Client: Executive' },
  client_stakeholder:        { bg: '#f9f9f7', border: '#dddcd6', color: '#6b7280', label: 'Client: Stakeholder' },
}

// ─── Invite modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void
  onInvited: (member: TeamMember) => void
}

function InviteModal({ onClose, onInvited }: InviteModalProps) {
  const [name, setName]     = useState('')
  const [email, setEmail]   = useState('')
  const [role, setRole]     = useState('member')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Invite failed')
        return
      }
      onInvited(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[420px] overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ backgroundColor: '#a200ee' }}>
          <span className="text-[15px] font-semibold text-white">Invite Team Member</span>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="Jane Smith"
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="jane@agency.com"
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] bg-white outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            >
              <optgroup label="Agency — Leadership">
                <option value="admin">Admin — full org + workflow access</option>
                <option value="strategist">Strategist — strategy, LLM, graphics, video</option>
                <option value="campaign_manager">Campaign Manager — leads campaigns, LLM, graphics, video</option>
                <option value="project_manager">Project Manager — ops oversight, full media access</option>
                <option value="account_manager">Account Manager — client liaison, full media access</option>
              </optgroup>
              <optgroup label="Agency — Creative">
                <option value="art_director">Art Director — LLM + graphics, no video</option>
                <option value="brand_manager">Brand Manager — LLM + graphics, no video</option>
                <option value="designer">Designer — LLM + graphics, no video</option>
                <option value="social_media_manager">Social Media Manager — LLM + graphics</option>
                <option value="content_manager">Content Manager — LLM + graphics</option>
                <option value="copywriter">Copywriter — LLM + humanizer, no graphics</option>
              </optgroup>
              <optgroup label="Agency — Specialist">
                <option value="seo_specialist">SEO Specialist — LLM only</option>
                <option value="performance_marketer">Performance Marketer — LLM only</option>
                <option value="compliance_reviewer">Compliance Reviewer — read + review only</option>
              </optgroup>
              <optgroup label="Agency — Access Level">
                <option value="manager">Manager — manages clients, workflows, and leads/members</option>
                <option value="lead">Lead — manages client-level external access</option>
                <option value="member">Member — can view and run workflows</option>
              </optgroup>
              <optgroup label="Client-Facing">
                <option value="client_executive_approver">Client: Executive Approver</option>
                <option value="client_legal_reviewer">Client: Legal Reviewer</option>
                <option value="client_brand_reviewer">Client: Brand Reviewer</option>
                <option value="client_creative_reviewer">Client: Creative Reviewer</option>
                <option value="client_marcom_reviewer">Client: MarCom Reviewer</option>
                <option value="client_product_reviewer">Client: Product Reviewer</option>
                <option value="client_stakeholder">Client: Stakeholder</option>
              </optgroup>
            </select>
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#dddcd6] px-4 py-2 text-[13px] text-[#5c5b52] hover:bg-[#f4f4f2] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#a200ee' }}
            >
              {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Profile Modal ────────────────────────────────────────────────────────

interface EditProfileModalProps {
  member: TeamMember
  onClose: () => void
  onSaved: (updated: Partial<TeamMember>) => void
}

function EditProfileModal({ member, onClose, onSaved }: EditProfileModalProps) {
  const [name, setName]           = useState(member.name ?? '')
  const [title, setTitle]         = useState(member.title ?? '')
  const [department, setDept]     = useState(member.department ?? '')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/team/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          title: title.trim() || null,
          department: department.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Update failed'); return }
      onSaved({ name: json.data.name, title: json.data.title, department: json.data.department })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[420px] overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e7e1]">
          <div>
            <span className="text-[15px] font-semibold text-[#1a1a14]">Edit Profile</span>
            <p className="text-[12px] text-[#b4b2a9] mt-0.5">{member.email}</p>
          </div>
          <button onClick={onClose} className="text-[#b4b2a9] hover:text-[#1a1a14] transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Senior Account Manager"
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#5c5b52] mb-1">Department</label>
            <input
              type="text"
              value={department}
              onChange={e => setDept(e.target.value)}
              placeholder="e.g. Client Services"
              className="w-full rounded-md border border-[#dddcd6] px-3 py-2 text-[13px] text-[#1a1a14] outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#dddcd6] px-4 py-2 text-[13px] text-[#5c5b52] hover:bg-[#f4f4f2] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#a200ee' }}
            >
              {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── History Drawer ────────────────────────────────────────────────────────────

// Maps action strings to readable labels + icon colors
const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  'workflow.run.created':     { label: 'Started a workflow run',      color: '#a200ee' },
  'workflow.run.completed':   { label: 'Completed a workflow run',    color: '#16a34a' },
  'workflow.run.failed':      { label: 'Workflow run failed',         color: '#dc2626' },
  'workflow.run.cancelled':   { label: 'Cancelled a workflow run',    color: '#d97706' },
  'access.grant_created':     { label: 'Granted portal access',       color: '#185fa5' },
  'access.grant_revoked':     { label: 'Revoked portal access',       color: '#dc2626' },
  'access.grant_resent':      { label: 'Resent portal link',          color: '#185fa5' },
  'team.invite_sent':         { label: 'Sent team invite',            color: '#a200ee' },
  'team.role_changed':        { label: 'Changed member role',         color: '#d97706' },
  'team.profile_updated':     { label: 'Updated member profile',      color: '#5c5b52' },
  'team.member_removed':      { label: 'Removed team member',         color: '#dc2626' },
  'workflow.created':         { label: 'Created a workflow',          color: '#a200ee' },
  'workflow.updated':         { label: 'Updated a workflow',          color: '#5c5b52' },
  'workflow.deleted':         { label: 'Deleted a workflow',          color: '#dc2626' },
}

function getActionLabel(action: string) {
  return ACTION_CONFIG[action]?.label ?? action.replace(/\./g, ' · ')
}

function getActionColor(action: string) {
  return ACTION_CONFIG[action]?.color ?? '#b4b2a9'
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays === 0) return 'Today ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return `${diffDays} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function HistoryDrawer({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [history, setHistory]   = useState<MemberHistory | null>(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'activity' | 'clients' | 'runs'>('activity')

  useEffect(() => {
    apiFetch(`/api/v1/team/${member.id}/history`)
      .then((r) => r.json())
      .then(({ data }) => setHistory(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [member.id])

  const rs = ROLE_STYLES[member.role] ?? ROLE_STYLES.member

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-screen w-[520px] flex flex-col bg-white shadow-2xl border-l border-[#e8e7e1]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#e8e7e1]">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0"
            style={{ backgroundColor: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
          >
            {(member.name ?? member.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[#1a1a14] truncate">{member.name ?? member.email}</h2>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                style={{ backgroundColor: rs.bg, border: `1px solid ${rs.border}`, color: rs.color }}
              >
                {rs.label}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#b4b2a9]">
              <span>{member.email}</span>
              {member.title && <><span>·</span><span>{member.title}</span></>}
              {member.department && <><span>·</span><span>{member.department}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="text-[#b4b2a9] hover:text-[#1a1a14] transition-colors">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Stats bar */}
        {history && (
          <div className="border-b border-[#e8e7e1]">
            <div className="grid grid-cols-4 gap-px bg-[#e8e7e1]">
              {[
                { label: 'Runs',      value: history.stats.totalRuns },
                { label: 'Clients',   value: history.stats.clientsWorkedWith },
                { label: 'Reviewed',  value: history.stats.contentReviewed },
                { label: 'Feedback',  value: history.stats.feedbackEntered },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[#fafaf8] px-3 py-3 text-center">
                  <p className="text-[17px] font-bold text-[#1a1a14]">{value}</p>
                  <p className="text-[10px] text-[#b4b2a9] uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#e8e7e1]">
              <div className="bg-[#fafaf8] px-3 py-2.5">
                <p className="text-[10px] text-[#b4b2a9] uppercase tracking-wide mb-0.5">Last active</p>
                <p className="text-[13px] font-semibold text-[#1a1a14]">{relativeTime(history.stats.lastActiveAt)}</p>
              </div>
              <div className="bg-[#fafaf8] px-3 py-2.5">
                <p className="text-[10px] text-[#b4b2a9] uppercase tracking-wide mb-0.5">Last workflow run</p>
                <p className="text-[13px] font-semibold text-[#1a1a14]">{relativeTime(history.stats.lastWorkflowRunAt)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#e8e7e1]">
              <div className="bg-[#fafaf8] px-3 py-2.5">
                <p className="text-[10px] text-[#b4b2a9] uppercase tracking-wide mb-0.5">Templates created</p>
                <p className="text-[13px] font-semibold text-[#1a1a14]">{history.stats.templatesCreated}</p>
              </div>
              <div className="bg-[#fafaf8] px-3 py-2.5">
                <p className="text-[10px] text-[#b4b2a9] uppercase tracking-wide mb-0.5">Access grants</p>
                <p className="text-[13px] font-semibold text-[#1a1a14]">{history.stats.accessGrantsGiven}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[#e8e7e1]">
          {(['activity', 'clients', 'runs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-[12px] font-medium capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-[#a200ee] text-[#a200ee]'
                  : 'border-transparent text-[#b4b2a9] hover:text-[#1a1a14]'
              }`}
            >
              {t === 'activity' ? 'Activity' : t === 'clients' ? 'Clients' : 'Runs'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[13px] text-[#b4b2a9]">
              <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading history…
            </div>
          ) : !history ? (
            <p className="py-12 text-center text-[13px] text-[#b4b2a9]">Failed to load history</p>
          ) : (
            <>
              {/* Activity tab */}
              {tab === 'activity' && (
                <div className="p-4">
                  {history.activity.length === 0 ? (
                    <div className="flex flex-col items-center py-12 gap-2 text-center">
                      <Icons.Activity className="h-8 w-8 text-[#dddcd6]" />
                      <p className="text-[13px] text-[#b4b2a9]">No activity recorded yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {history.activity.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-[#fafaf8] transition-colors">
                          <div
                            className="mt-0.5 h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: getActionColor(entry.action) }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[#1a1a14]">{getActionLabel(entry.action)}</p>
                            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                              <p className="text-[11px] text-[#b4b2a9] truncate mt-0.5">
                                {entry.metadata.workflowName as string
                                  ?? entry.metadata.email as string
                                  ?? entry.metadata.name as string
                                  ?? (entry.metadata.fields as string[])?.join(', ')
                                  ?? ''}
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] text-[#b4b2a9] shrink-0 mt-0.5">{formatDate(entry.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Clients tab */}
              {tab === 'clients' && (
                <div className="p-4">
                  {history.clientsWorkedWith.length === 0 ? (
                    <div className="flex flex-col items-center py-12 gap-2 text-center">
                      <Icons.Building2 className="h-8 w-8 text-[#dddcd6]" />
                      <p className="text-[13px] text-[#b4b2a9]">No client interactions yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-[11px] text-[#b4b2a9] uppercase tracking-wide mb-3">
                        {history.clientsWorkedWith.length} client{history.clientsWorkedWith.length !== 1 ? 's' : ''} worked with
                      </p>
                      {history.clientsWorkedWith.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg border border-[#e8e7e1] px-3 py-2.5">
                          <div className="h-7 w-7 rounded-full bg-[#f0f6fd] flex items-center justify-center text-[11px] font-bold text-[#185fa5] shrink-0">
                            {c.name[0].toUpperCase()}
                          </div>
                          <span className="text-[13px] font-medium text-[#1a1a14]">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Runs tab */}
              {tab === 'runs' && (
                <div className="p-4">
                  {history.recentRuns.length === 0 ? (
                    <div className="flex flex-col items-center py-12 gap-2 text-center">
                      <Icons.Play className="h-8 w-8 text-[#dddcd6]" />
                      <p className="text-[13px] text-[#b4b2a9]">No workflow runs yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-[#b4b2a9] uppercase tracking-wide mb-3">
                        Showing {history.recentRuns.length} most recent of {history.stats.totalRuns} total
                      </p>
                      {history.recentRuns.map((run) => {
                        const statusColors: Record<string, { bg: string; color: string }> = {
                          completed:  { bg: '#d0e8b0', color: '#3b6d11' },
                          failed:     { bg: '#fee2e2', color: '#dc2626' },
                          running:    { bg: '#dbeafe', color: '#1d4ed8' },
                          cancelled:  { bg: '#fef3c7', color: '#d97706' },
                        }
                        const sc = statusColors[run.status] ?? { bg: '#f4f4f2', color: '#5c5b52' }
                        return (
                          <div key={run.id} className="flex items-start gap-3 rounded-lg border border-[#e8e7e1] px-3 py-2.5">
                            <Icons.Play className="h-3.5 w-3.5 text-[#b4b2a9] mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-[#1a1a14] truncate">
                                {run.workflow?.name ?? 'Unknown workflow'}
                              </p>
                              {run.workflow?.client && (
                                <p className="text-[11px] text-[#b4b2a9]">{run.workflow.client.name}</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                                style={{ backgroundColor: sc.bg, color: sc.color }}
                              >
                                {run.status}
                              </span>
                              <span className="text-[10px] text-[#b4b2a9]">{formatDate(run.createdAt)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#e8e7e1] px-5 py-3 text-[11px] text-[#b4b2a9]">
          Member since {new Date(member.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TeamPage() {
  const { isAdmin, isOwner } = useCurrentUser()
  const [members, setMembers]           = useState<TeamMember[]>([])
  const [loading, setLoading]           = useState(true)
  const [showInvite, setShowInvite]     = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [historyMember, setHistoryMember] = useState<TeamMember | null>(null)
  const canManage = isAdmin

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const loadMembers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/team')
      const json = await res.json()
      if (res.ok) setMembers(json.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  async function handleRoleChange(memberId: string, newRole: TeamMember['role']) {
    const prevMembers = members
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
    setActionLoading(memberId)
    try {
      const res = await apiFetch(`/api/v1/team/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMembers(prevMembers)
        showToast((json as { error?: string }).error ?? 'Failed to update role', false)
        return
      }
      showToast('Role updated')
    } catch {
      setMembers(prevMembers)
      showToast('Network error — failed to update role', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSyncClerk(memberId: string) {
    setActionLoading(memberId)
    try {
      const res = await apiFetch(`/api/v1/team/${memberId}/sync-clerk`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error ?? 'Could not sync — user may need to sign up first', false)
        return
      }
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...json.data } : m))
      showToast('Member activated successfully')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleResendInvite(memberId: string, email: string) {
    setActionLoading(memberId)
    try {
      const res = await apiFetch(`/api/v1/team/${memberId}/resend-invite`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json()
        showToast(json.error ?? 'Failed to resend invite', false)
        return
      }
      showToast(`Invite resent to ${email}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend invite', false)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm('Remove this team member? They will lose access immediately.')) return
    setActionLoading(memberId)
    try {
      const res = await apiFetch(`/api/v1/team/${memberId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        showToast(json.error ?? 'Failed to remove member', false)
        return
      }
      setMembers(prev => prev.filter(m => m.id !== memberId))
      showToast('Member removed')
    } finally {
      setActionLoading(null)
    }
  }

  const isPending = (m: TeamMember) => m.pending

  return (
    <div className="flex-1 overflow-auto p-6 bg-[#fafaf8]">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#1a1a14]">Team</h1>
          <p className="mt-0.5 text-[13px] text-[#b4b2a9]">
            Manage who has access to your ContentNode workspace.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#a200ee' }}
          >
            <Icons.UserPlus className="h-4 w-4" />
            Invite Member
          </button>
        )}
      </div>

      {/* Role legend */}
      <div className="mb-5 flex flex-wrap gap-x-1.5 gap-y-1.5">
        {Object.entries(ROLE_STYLES).map(([role, s]) => (
          <span
            key={role}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.color }}
          >
            {s.label}
          </span>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#e8e7e1] bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[13px] text-[#b4b2a9]">
            <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading team…
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Icons.Users className="h-8 w-8 text-[#dddcd6]" />
            <p className="text-[13px] text-[#b4b2a9]">No team members yet. Invite someone to get started.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#e8e7e1] bg-[#fafaf8]">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Email</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Role</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Last Active</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Joined</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#b4b2a9]">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => {
                const rs = ROLE_STYLES[m.role] ?? ROLE_STYLES.member
                const busy = actionLoading === m.id
                return (
                  <tr
                    key={m.id}
                    className={`border-b border-[#f0efe9] transition-colors hover:bg-[#fafaf8] ${i === members.length - 1 ? 'border-b-0' : ''}`}
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                          style={{ backgroundColor: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}
                        >
                          {(m.name ?? m.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-[#1a1a14]">{m.name ?? '—'}</p>
                          {(m.title || m.department) && (
                            <p className="text-[11px] text-[#b4b2a9]">
                              {[m.title, m.department].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 text-[#5c5b52]">{m.email}</td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      {canManage && m.role !== 'owner' ? (
                        <select
                          value={m.role}
                          disabled={busy}
                          onChange={e => handleRoleChange(m.id, e.target.value as TeamMember['role'])}
                          className="rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white border outline-none cursor-pointer disabled:cursor-default"
                          style={{ backgroundColor: rs.bg, borderColor: rs.border, color: rs.color }}
                        >
                          {isOwner && <option value="owner">Owner</option>}
                          <optgroup label="Leadership">
                            <option value="admin">Admin</option>
                            <option value="strategist">Strategist</option>
                            <option value="campaign_manager">Campaign Manager</option>
                            <option value="project_manager">Project Manager</option>
                            <option value="account_manager">Account Manager</option>
                          </optgroup>
                          <optgroup label="Creative">
                            <option value="art_director">Art Director</option>
                            <option value="brand_manager">Brand Manager</option>
                            <option value="designer">Designer</option>
                            <option value="social_media_manager">Social Media Manager</option>
                            <option value="content_manager">Content Manager</option>
                            <option value="copywriter">Copywriter</option>
                          </optgroup>
                          <optgroup label="Specialist">
                            <option value="seo_specialist">SEO Specialist</option>
                            <option value="performance_marketer">Performance Marketer</option>
                            <option value="compliance_reviewer">Compliance Reviewer</option>
                          </optgroup>
                          <optgroup label="Access Level">
                            <option value="manager">Manager</option>
                            <option value="lead">Lead</option>
                            <option value="member">Member</option>
                          </optgroup>
                          <optgroup label="Client-Facing">
                            <option value="client_executive_approver">Client: Executive</option>
                            <option value="client_legal_reviewer">Client: Legal</option>
                            <option value="client_brand_reviewer">Client: Brand</option>
                            <option value="client_creative_reviewer">Client: Creative</option>
                            <option value="client_marcom_reviewer">Client: MarCom</option>
                            <option value="client_product_reviewer">Client: Product</option>
                            <option value="client_stakeholder">Client: Stakeholder</option>
                          </optgroup>
                        </select>
                      ) : (
                        <span
                          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{ backgroundColor: rs.bg, border: `1px solid ${rs.border}`, color: rs.color }}
                        >
                          {rs.label}
                        </span>
                      )}
                    </td>

                    {/* Last Active */}
                    <td className="px-4 py-3">
                      {m.pending ? (
                        <span className="text-[#b4b2a9]">—</span>
                      ) : (
                        <span className={`text-[13px] ${m.lastActiveAt ? 'text-[#1a1a14]' : 'text-[#b4b2a9]'}`}>
                          {relativeTime(m.lastActiveAt)}
                        </span>
                      )}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-[#b4b2a9]">
                      {new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {m.inviteExpired ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-50 border border-red-200 text-red-600">
                          Invite Expired
                        </span>
                      ) : isPending(m) ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-700">
                          Invite Pending
                        </span>
                      ) : (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#d0e8b0] border border-[#3b6d11] text-[#3b6d11]">
                          Active
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* History — always visible */}
                        <button
                          onClick={() => setHistoryMember(m)}
                          className="rounded p-1.5 text-[#b4b2a9] hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          title="View history"
                        >
                          <Icons.History className="h-3.5 w-3.5" />
                        </button>
                        {/* Edit profile — admins only */}
                        {canManage && (
                          <button
                            onClick={() => setEditingMember(m)}
                            disabled={busy}
                            className="rounded p-1.5 text-[#b4b2a9] hover:bg-[#f0f6fd] hover:text-[#185fa5] transition-colors disabled:opacity-40"
                            title="Edit profile"
                          >
                            <Icons.Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canManage && isPending(m) && (
                          <>
                            <button
                              onClick={() => handleSyncClerk(m.id)}
                              disabled={busy}
                              className="rounded p-1.5 text-[#b4b2a9] hover:bg-green-50 hover:text-green-600 transition-colors disabled:opacity-40"
                              title="Activate — look up their Clerk account and mark as active"
                            >
                              {busy ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.UserCheck className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              onClick={() => handleResendInvite(m.id, m.email)}
                              disabled={busy}
                              className="rounded p-1.5 text-[#b4b2a9] hover:bg-amber-50 hover:text-amber-600 transition-colors disabled:opacity-40"
                              title="Resend invite email"
                            >
                              {busy ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.MailCheck className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                        {canManage && m.role !== 'owner' && (
                          <button
                            onClick={() => handleRemove(m.id)}
                            disabled={busy}
                            className="rounded p-1.5 text-[#b4b2a9] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                            title="Remove member"
                          >
                            {busy ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-lg ${
            toast.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={(member) => {
            setMembers(prev => [...prev, member])
            setShowInvite(false)
            showToast(`Invite sent to ${member.email}`)
          }}
        />
      )}

      {/* Edit profile modal */}
      {editingMember && (
        <EditProfileModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={(updated) => {
            setMembers(prev => prev.map(m => m.id === editingMember.id ? { ...m, ...updated } : m))
            setEditingMember(null)
            showToast('Profile updated')
          }}
        />
      )}

      {/* History drawer */}
      {historyMember && (
        <HistoryDrawer
          member={historyMember}
          onClose={() => setHistoryMember(null)}
        />
      )}
    </div>
  )
}
