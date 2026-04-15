/**
 * ClientBillingReportsTab — unified billing + analytics tab for a client.
 *
 * Covers every chargeable service: Anthropic, AssemblyAI, BypassGPT, DeepL,
 * FAL AI, Google Gemini, Imagine Art, Kling AI, Luma Labs, Runway, Stability AI,
 * StealthGPT, Undetectable, D-ID, HeyGen, ElevenLabs, OpenAI TTS, Shotstack,
 * plus stakeholder activity, workflow intelligence, and manual activity log.
 */

import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ReportsDashboard } from './ReportsDashboard'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Overview {
  totalRuns: number; completedRuns: number; failedRuns: number
  successRate: number; waitingFeedback: number; feedbackCount: number; avgCompletionMins: number
}
interface RunDay    { date: string; completed: number; failed: number; total: number }
interface TokenModel { model: string; tokens: number }
interface HumService { service: string; words: number; costUsd: number }
interface SentimentItem { sentiment: string; count: number }
interface OutputType    { type: string; count: number }
interface DetectionItem { label: string; count: number }
interface TopWorkflow   { id: string; name: string; periodRuns: number; completed: number; failed: number; successRate: number; tokens: number }
interface StakeholderStat {
  id: string; name: string; email: string; role: string | null; seniority: string
  totalFeedback: number; totalCorrections: number; avgRating: number | null
  decisions: Record<string, number>; tones: Record<string, number>; tags: Record<string, number>
  lastActive: string | null
}
interface ProviderCount  { provider: string; count: number; costUsd: number }
interface ProviderVideo  { provider: string; count: number; secs: number; costUsd: number }
interface ProviderVoice  { provider: string; chars: number; secs: number; costUsd: number }
interface ProviderMedia  { provider: string; secs: number; costUsd: number }
interface ProviderXlate  { provider: string; chars: number; costUsd: number }
interface DetectionSvc   { service: string; calls: number; costUsd: number }
interface ManualEntry    { id: string; date: string; service: string; description: string | null; quantity: number; unit: string }

interface ClientUsage {
  totalRuns: number; brandFilesReady: number; fwFilesReady: number
  totalTokens: number; totalTokensCostUsd: number
  tokensByModel: TokenModel[]
  totalHumWords: number; totalHumCostUsd: number
  humWordsByService: HumService[]
  totalImagesGenerated: number; totalImageCostUsd: number
  imageGeneration: { byProvider: ProviderCount[] }
  totalVideosGenerated: number; totalVideoGenSecs: number; totalVideoGenCostUsd: number
  videoGeneration: { byProvider: ProviderVideo[] }
  voiceGeneration:    { totalChars: number; totalSecs: number; totalCostUsd: number; byProvider: ProviderVoice[] }
  characterAnimation: { totalSecs: number; totalCostUsd: number; byProvider: ProviderMedia[] }
  musicGeneration:    { totalSecs: number; totalCostUsd: number; byProvider: ProviderMedia[] }
  videoComposition:   { totalSecs: number; totalCostUsd: number }
  detectionCalls: number; totalDetectionCostUsd: number
  detectionByService: DetectionSvc[]
  totalTranslationChars: number; totalTranslationCostUsd: number
  translationByProvider: ProviderXlate[]
  transcriptionMinutes: number; assemblyaiMinutes: number; assemblyaiCostUsd: number
  videoIntelligenceCalls: number
  braveSearchQueries: number
  grandTotalCostUsd: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider display names & icons
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  // Text AI
  anthropic: 'Anthropic', openai: 'OpenAI', ollama: 'Ollama (local)',
  'claude-sonnet-4-6': 'Anthropic Sonnet', 'claude-haiku-4-5-20251001': 'Anthropic Haiku',
  'gpt-4o': 'OpenAI GPT-4o', 'gpt-4o-mini': 'OpenAI GPT-4o mini',
  // Image gen
  dalle3: 'DALL·E 3', falai: 'FAL AI', fal: 'FAL AI',
  stability: 'Stability AI', stabilityai: 'Stability AI',
  imagineart: 'Imagine Art', comfyui: 'ComfyUI (local)', automatic1111: 'Auto1111 (local)',
  // Video gen
  runway: 'Runway', kling: 'Kling AI', luma: 'Luma Labs', lumalabs: 'Luma Labs',
  pika: 'Pika', veo2: 'Google Veo2',
  // Voice TTS
  elevenlabs: 'ElevenLabs',
  // Animation
  did: 'D-ID', heygen: 'HeyGen', sadtalker: 'SadTalker (local)',
  // Music
  suno: 'Suno', udio: 'Udio',
  // Video comp
  shotstack: 'Shotstack',
  // Humanizer
  undetectable: 'Undetectable.ai', bypassgpt: 'BypassGPT', stealthgpt: 'StealthGPT',
  cnhumanizer: 'CN Humanizer (local)', claude: 'Claude Humanizer', humanizeai: 'HumanizeAI',
  // Detection
  gptzero: 'GPTZero', originality: 'Originality.ai', sapling: 'Sapling',
  copyleaks: 'Copyleaks', local: 'Local detector',
  // Translation
  deepl: 'DeepL', google: 'Google Translate',
  // Assembly
  assemblyai: 'AssemblyAI',
  unknown: 'Unknown',
}

function providerLabel(key: string) { return PROVIDER_LABELS[key.toLowerCase()] ?? key }

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6']

const SENTIMENT_CFG: Record<string, { label: string; color: string }> = {
  approved:              { label: 'Approved',       color: '#22c55e' },
  approved_with_changes: { label: 'With changes',   color: '#3b82f6' },
  needs_revision:        { label: 'Needs revision', color: '#f59e0b' },
  rejected:              { label: 'Rejected',       color: '#ef4444' },
  no_decision:           { label: 'No decision',    color: '#94a3b8' },
}
const SENTIMENT_COLORS_MAP: Record<string, string> = {
  approved: '#10b981', approved_with_changes: '#3b82f6',
  needs_revision: '#f59e0b', rejected: '#ef4444', no_decision: '#6b7280',
}

const DAYS_OPTIONS = [{ label: '7d', value: 7 }, { label: '30d', value: 30 }, { label: '90d', value: 90 }]
const UNIT_OPTIONS = ['minutes', 'hours', 'sessions', 'videos', 'words', 'pages', 'other']
const SUGGESTED_SERVICES = ['Google Meet', 'Zoom', 'Video Editing', 'Copywriting', 'Design', 'Research', 'Strategy Session', 'Client Call', 'Content Review', 'Other']

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n)
}
function fmtSecs(s: number) {
  if (s <= 0) return '—'
  const m = Math.floor(s / 60); const rem = Math.round(s % 60)
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`
}
function fmtCost(n: number, always = false) {
  if (n <= 0) return always ? '$0.00' : null
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}
function toISODate(d: Date) { return d.toISOString().slice(0, 10) }

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = 'text-foreground' }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-xl font-bold leading-none', color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function CollapsibleSection({ title, icon: Icon, badge, badgeColor = 'bg-blue-100 text-blue-700', children, defaultCollapsed = false, onDownload }: {
  title: string; icon: React.ComponentType<{ className?: string }>
  badge?: string; badgeColor?: string
  children: React.ReactNode; defaultCollapsed?: boolean; onDownload?: () => void
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', badgeColor)}>{badge}</span>}
        </div>
        <div className="flex items-center gap-2">
          {onDownload && !collapsed && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              onClick={(e) => { e.stopPropagation(); onDownload() }}>
              <Icons.Download className="h-3 w-3" />CSV
            </Button>
          )}
          <Icons.ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>
      {!collapsed && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  )
}

function SectionHeading({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
    </div>
  )
}

function DonutChart({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-xs text-muted-foreground py-4 text-center">No data</p>
  return (
    <div className="flex flex-col items-center gap-3">
      <ResponsiveContainer width="100%" height={130}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={58} paddingAngle={2} dataKey="value">
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} stroke="transparent" />)}
          </Pie>
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n) => [`${Number(v)} (${Math.round(Number(v) / total * 100)}%)`, String(n)]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="w-full space-y-1">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
              <span className="text-muted-foreground truncate">{d.name}</span>
            </div>
            <span className="font-medium shrink-0 ml-2">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HBar({ label, value, max, color, unit = '' }: { label: string; value: number; max: number; color: string; unit?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs truncate text-muted-foreground">{label}</span>
        <span className="text-xs font-medium shrink-0 ml-2">{fmt(value)}{unit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
    </div>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map((i) => <Icons.Star key={i} className={`h-3 w-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground'}`} />)}
      <span className="ml-1 text-xs text-muted-foreground">{rating}</span>
    </div>
  )
}

// ── Billing card ─────────────────────────────────────────────────────────────
function BillingCard({ icon: Icon, iconColor, category, service, usage, metric, cost, byRows, hasUsage }: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string; category: string; service: string
  usage: string; metric: string; cost: string | null; hasUsage: boolean
  byRows?: Array<{ label: string; usage: string; cost: string | null }>
}) {
  const [open, setOpen] = useState(false)
  const hasSubs = hasUsage && byRows && byRows.length > 1

  return (
    <div className={cn(
      'rounded-xl border border-border bg-card overflow-hidden flex flex-col transition-opacity',
      !hasUsage && 'opacity-40',
    )}>
      {/* Header row */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${hasUsage ? iconColor : '#94a3b8'}18` }}
        >
          <Icon className="h-4 w-4" style={{ color: hasUsage ? iconColor : '#94a3b8' }} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground leading-none mb-0.5">{category}</p>
          <p className="text-xs font-semibold leading-tight truncate">{service}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 pb-3 flex-1 space-y-2.5">
        {/* Usage */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Usage</p>
          <p className={cn('text-lg font-bold leading-none', !hasUsage && 'text-muted-foreground')}>
            {usage}
          </p>
          {hasUsage && metric !== '' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{metric}</p>
          )}
        </div>

        {/* Cost */}
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Est. Cost</p>
          <p className={cn(
            'text-sm font-bold leading-none',
            !hasUsage ? 'text-muted-foreground/50' : cost ? 'text-emerald-500' : 'text-muted-foreground',
          )}>
            {!hasUsage ? '—' : cost ?? 'Self-hosted'}
          </p>
        </div>
      </div>

      {/* Provider breakdown (expandable) */}
      {hasSubs && (
        <div className="border-t border-border/60">
          <button
            onClick={() => setOpen(!open)}
            className="flex w-full items-center justify-between px-4 py-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
          >
            <span>{open ? 'Hide' : 'Show'} {byRows!.length} providers</span>
            <Icons.ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="px-4 pb-3 space-y-1.5">
              {byRows!.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground truncate">{row.label}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] font-mono text-foreground">{row.usage}</span>
                    <span className={cn('text-[10px] font-medium', row.cost ? 'text-emerald-500' : 'text-muted-foreground')}>
                      {row.cost ?? '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual activity log
// ─────────────────────────────────────────────────────────────────────────────

function ManualUsageSection({ clientId, onEntriesChange }: { clientId: string; onEntriesChange?: (e: ManualEntry[]) => void }) {
  const [entries, setEntries] = useState<ManualEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ date: today, service: '', description: '', quantity: '', unit: 'minutes' })

  const setAndNotify = useCallback((list: ManualEntry[]) => { setEntries(list); onEntriesChange?.(list) }, [onEntriesChange])
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/manual-usage`).then((r) => r.json())
      .then(({ data }) => { setAndNotify(data ?? []); setLoading(false) }).catch(() => setLoading(false))
  }, [clientId, setAndNotify])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.service.trim() || !form.quantity || !form.date) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/manual-usage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: form.date, service: form.service.trim(), description: form.description.trim() || undefined, quantity: parseFloat(form.quantity), unit: form.unit }),
      })
      const { data } = await res.json()
      setAndNotify([data, ...entries])
      setForm({ date: today, service: '', description: '', quantity: '', unit: 'minutes' })
      setShowForm(false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await apiFetch(`/api/v1/clients/${clientId}/manual-usage/${id}`, { method: 'DELETE' })
      setAndNotify(entries.filter((e) => e.id !== id))
    } finally { setDeleting(null) }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <CollapsibleSection title="Manual Activity Log" icon={Icons.ClipboardEdit} defaultCollapsed>
      <div className="flex justify-end -mt-2 mb-1">
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors">
          <Icons.Plus className="h-3 w-3" />Log activity
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Service / Tool</label>
              <input type="text" value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                placeholder="e.g. Google Meet" list="svc-list"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required />
              <datalist id="svc-list">{SUGGESTED_SERVICES.map((s) => <option key={s} value={s} />)}</datalist></div>
          </div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Description (optional)</label>
            <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Strategy call with marketing team"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Quantity</label>
              <input type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Unit</label>
              <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving && <Icons.Loader2 className="h-3 w-3 animate-spin" />}Save entry</button>
          </div>
        </form>
      )}
      {loading ? <div className="flex justify-center py-4"><Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        : entries.length === 0 ? <p className="text-xs text-muted-foreground">No manual activity logged yet.</p>
        : (
          <div className="space-y-1">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{entry.service}</span>
                    <span className="text-xs font-semibold">{entry.quantity} {entry.unit}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(entry.date)}</span>
                  </div>
                  {entry.description && <p className="mt-0.5 text-xs text-muted-foreground truncate">{entry.description}</p>}
                </div>
                <button onClick={() => handleDelete(entry.id)} disabled={deleting === entry.id}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  {deleting === entry.id ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
    </CollapsibleSection>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF export
// ─────────────────────────────────────────────────────────────────────────────

function exportPdf(clientName: string, days: number, overview: Overview, usage: ClientUsage, topWorkflows: TopWorkflow[], manualEntries: ManualEntry[]) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const thS = 'padding:7px 12px;background:#f8f8f8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#888;text-align:left;border-bottom:2px solid #e8e8e8'
  const tdS = 'padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px'

  const rows: [string, string][] = [
    ['Workflow Runs',       String(overview.totalRuns)],
    ['Success Rate',        `${overview.successRate}%`],
    ['AI Tokens (all)',     fmt(usage.totalTokens)],
    ['AI Token Cost',       fmtCost(usage.totalTokensCostUsd, true) ?? '—'],
    ['Humanizer Words',     fmt(usage.totalHumWords)],
    ['Humanizer Cost',      fmtCost(usage.totalHumCostUsd, true) ?? '—'],
    ['Images Generated',    String(usage.totalImagesGenerated)],
    ['Image Gen Cost',      fmtCost(usage.totalImageCostUsd, true) ?? '—'],
    ['Videos Generated',    String(usage.totalVideosGenerated)],
    ['Video Gen Cost',      fmtCost(usage.totalVideoGenCostUsd, true) ?? '—'],
    ['Voice TTS',           fmtSecs(usage.voiceGeneration.totalSecs)],
    ['Voice Cost',          fmtCost(usage.voiceGeneration.totalCostUsd, true) ?? '—'],
    ['Char Animation',      fmtSecs(usage.characterAnimation.totalSecs)],
    ['Animation Cost',      fmtCost(usage.characterAnimation.totalCostUsd, true) ?? '—'],
    ['Music Generation',    fmtSecs(usage.musicGeneration.totalSecs)],
    ['Music Cost',          fmtCost(usage.musicGeneration.totalCostUsd, true) ?? '—'],
    ['Video Composition',   fmtSecs(usage.videoComposition.totalSecs)],
    ['Comp Cost',           fmtCost(usage.videoComposition.totalCostUsd, true) ?? '—'],
    ['Detection Calls',     String(usage.detectionCalls)],
    ['Detection Cost',      fmtCost(usage.totalDetectionCostUsd, true) ?? '—'],
    ['Translation Chars',   fmt(usage.totalTranslationChars)],
    ['Translation Cost',    fmtCost(usage.totalTranslationCostUsd, true) ?? '—'],
    ['AssemblyAI',          `${usage.assemblyaiMinutes} min`],
    ['Transcription Cost',  fmtCost(usage.assemblyaiCostUsd, true) ?? '—'],
    ['Grand Total (est.)',  fmtCost(usage.grandTotalCostUsd, true) ?? '—'],
  ].filter(([, v]) => v !== '0' && v !== '—' && v !== '$0.00')

  const wfRows = topWorkflows.map((wf) =>
    `<tr><td style="${tdS}">${wf.name}</td><td style="${tdS};text-align:center">${wf.periodRuns}</td><td style="${tdS};text-align:center;color:#22c55e">${wf.completed}</td><td style="${tdS};text-align:center;color:#ef4444">${wf.failed}</td><td style="${tdS};text-align:center">${wf.successRate}%</td><td style="${tdS};text-align:right">${fmt(wf.tokens)}</td></tr>`
  ).join('')

  const manualRows = manualEntries.map((e) => {
    const d = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `<tr><td style="${tdS}">${d}</td><td style="${tdS}">${e.service}</td><td style="${tdS};color:#555">${e.description ?? ''}</td><td style="${tdS};text-align:right">${e.quantity} ${e.unit}</td></tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${clientName} — Billing Report</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;margin:0;padding:48px;background:#fff}@page{margin:24mm 20mm}@media print{body{padding:0}}h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin:24px 0 8px}table{width:100%;border-collapse:collapse;margin-bottom:24px}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:36px;padding-bottom:16px;border-bottom:2px solid #111">
  <div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Billing &amp; Usage Report</div><h1 style="margin:0;font-size:26px;font-weight:700">${clientName}</h1></div>
  <div style="text-align:right;font-size:12px;color:#666">Last ${days} days<br>${date}</div>
</div>
<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin-bottom:28px">
  <div style="font-size:11px;color:#16a34a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Estimated Total Cost</div>
  <div style="font-size:32px;font-weight:700;color:#15803d">${fmtCost(usage.grandTotalCostUsd, true)}</div>
  <div style="font-size:11px;color:#16a34a;margin-top:2px">Based on approximate public list prices. Actual costs may vary.</div>
</div>
<h2>Service Breakdown</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:28px">
  ${rows.map(([label, value]) => `<div style="border:1px solid #e8e8e8;border-radius:8px;padding:12px"><div style="font-size:11px;color:#888;margin-bottom:3px">${label}</div><div style="font-size:16px;font-weight:700">${value}</div></div>`).join('')}
</div>
${topWorkflows.length > 0 ? `<h2>Top Workflows</h2><table><thead><tr><th style="${thS}">Workflow</th><th style="${thS};text-align:center">Runs</th><th style="${thS};text-align:center">Completed</th><th style="${thS};text-align:center">Failed</th><th style="${thS};text-align:center">Success</th><th style="${thS};text-align:right">Tokens</th></tr></thead><tbody>${wfRows}</tbody></table>` : ''}
${manualEntries.length > 0 ? `<h2>Manual Activity Log</h2><table><thead><tr><th style="${thS}">Date</th><th style="${thS}">Service</th><th style="${thS}">Description</th><th style="${thS};text-align:right">Qty</th></tr></thead><tbody>${manualRows}</tbody></table>` : ''}
<div style="margin-top:48px;padding-top:16px;border-top:1px solid #e8e8e8;font-size:11px;color:#aaa;display:flex;justify-content:space-between"><span>Generated by ContentNode · Prices are estimates only</span><span>${date}</span></div>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function ClientBillingReportsTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [overview, setOverview]             = useState<Overview | null>(null)
  const [runsOverTime, setRunsOverTime]     = useState<RunDay[]>([])
  const [sentiment, setSentiment]           = useState<SentimentItem[]>([])
  const [tokensByModel, setTokensByModel]   = useState<TokenModel[]>([])
  const [outputTypes, setOutputTypes]       = useState<OutputType[]>([])
  const [detectionRate, setDetectionRate]   = useState<DetectionItem[]>([])
  const [topWorkflows, setTopWorkflows]     = useState<TopWorkflow[]>([])
  const [humUsage, setHumUsage]             = useState<Array<{ service: string; words: number }>>([])
  const [usage, setUsage]                   = useState<ClientUsage | null>(null)
  const [manualEntries, setManualEntries]   = useState<ManualEntry[]>([])
  const [stakeholderStats, setStakeholderStats] = useState<StakeholderStat[]>([])
  const [stkSort, setStkSort]   = useState<'name' | 'totalFeedback' | 'totalCorrections' | 'avgRating' | 'lastActive'>('totalFeedback')
  const [stkDir, setStkDir]     = useState<'asc' | 'desc'>('desc')
  const [expandedStk, setExpandedStk] = useState<string | null>(null)

  const today = new Date(); const ago = new Date(today); ago.setDate(today.getDate() - days)
  const startDate = toISODate(ago); const endDate = toISODate(today)

  const EMPTY_OVERVIEW: Overview = { totalRuns: 0, completedRuns: 0, failedRuns: 0, successRate: 0, waitingFeedback: 0, feedbackCount: 0, avgCompletionMins: 0 }
  const EMPTY_USAGE: ClientUsage = {
    totalRuns: 0, brandFilesReady: 0, fwFilesReady: 0,
    totalTokens: 0, totalTokensCostUsd: 0, tokensByModel: [],
    totalHumWords: 0, totalHumCostUsd: 0, humWordsByService: [],
    totalImagesGenerated: 0, totalImageCostUsd: 0, imageGeneration: { byProvider: [] },
    totalVideosGenerated: 0, totalVideoGenSecs: 0, totalVideoGenCostUsd: 0, videoGeneration: { byProvider: [] },
    voiceGeneration: { totalChars: 0, totalSecs: 0, totalCostUsd: 0, byProvider: [] },
    characterAnimation: { totalSecs: 0, totalCostUsd: 0, byProvider: [] },
    musicGeneration: { totalSecs: 0, totalCostUsd: 0, byProvider: [] },
    videoComposition: { totalSecs: 0, totalCostUsd: 0 },
    detectionCalls: 0, totalDetectionCostUsd: 0, detectionByService: [],
    totalTranslationChars: 0, totalTranslationCostUsd: 0, translationByProvider: [],
    transcriptionMinutes: 0, assemblyaiMinutes: 0, assemblyaiCostUsd: 0,
    videoIntelligenceCalls: 0, braveSearchQueries: 0, grandTotalCostUsd: 0,
  }

  const load = useCallback(async () => {
    setLoading(true)
    const qs = `?clientId=${clientId}&days=${days}`
    const safe = async <T,>(p: Promise<T>, fb: T): Promise<T> => { try { return await p } catch { return fb } }
    const j = (p: Promise<Response>) => p.then((r) => r.json())

    const [ov, rot, sent, tbm, ot, dr, tw, hu, cu, ss] = await Promise.all([
      safe(j(apiFetch(`/api/v1/reports/overview${qs}`)),                          { data: EMPTY_OVERVIEW }),
      safe(j(apiFetch(`/api/v1/reports/runs-over-time${qs}`)),                    { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/feedback-sentiment${qs}`)),                { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/tokens-by-model${qs}`)),                   { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/output-types${qs}`)),                      { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/detection-pass-rate${qs}`)),               { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/top-workflows${qs}`)),                     { data: [] }),
      safe(j(apiFetch(`/api/v1/reports/humanizer-usage${qs}`)),                   { data: [] }),
      safe(j(apiFetch(`/api/v1/clients/${clientId}/usage`)),                      { data: EMPTY_USAGE }),
      safe(j(apiFetch(`/api/v1/clients/${clientId}/stakeholder-stats?startDate=${startDate}&endDate=${endDate}`)), { data: [] }),
    ])

    setOverview(ov.data ?? EMPTY_OVERVIEW)
    setRunsOverTime(rot.data ?? [])
    setSentiment(sent.data ?? [])
    setTokensByModel(tbm.data ?? [])
    setOutputTypes(ot.data ?? [])
    setDetectionRate(dr.data ?? [])
    setTopWorkflows(tw.data ?? [])
    setHumUsage(hu.data ?? [])
    setUsage(cu.data ?? EMPTY_USAGE)
    setStakeholderStats(ss.data ?? [])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, days])

  useEffect(() => { load() }, [load])

  if (loading || !overview || !usage) return (
    <div className="flex items-center justify-center py-20">
      <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  const sentimentData   = sentiment.map((s) => ({ name: SENTIMENT_CFG[s.sentiment]?.label ?? s.sentiment, value: s.count }))
  const sentimentColors = sentiment.map((s) => SENTIMENT_CFG[s.sentiment]?.color ?? '#94a3b8')
  const detectionData   = detectionRate.map((d) => ({ name: d.label, value: d.count }))
  const outputData      = outputTypes.slice(0, 6).map((o) => ({ name: o.type, value: o.count }))
  const maxTokens       = Math.max(...tokensByModel.map((t) => t.tokens), 1)
  const maxHum          = Math.max(...humUsage.map((h) => h.words), 1)

  const sortedStk = [...stakeholderStats].sort((a, b) => {
    let c = 0
    if (stkSort === 'name')             c = a.name.localeCompare(b.name)
    else if (stkSort === 'totalFeedback')    c = a.totalFeedback - b.totalFeedback
    else if (stkSort === 'totalCorrections') c = a.totalCorrections - b.totalCorrections
    else if (stkSort === 'avgRating')        c = (a.avgRating ?? -1) - (b.avgRating ?? -1)
    else if (stkSort === 'lastActive')       c = (a.lastActive ? new Date(a.lastActive).getTime() : 0) - (b.lastActive ? new Date(b.lastActive).getTime() : 0)
    return stkDir === 'asc' ? c : -c
  })

  // Build billing rows — ALL services always shown; zero usage displays as "—"
  type BillingRowDef = {
    key: string; icon: React.ComponentType<{ className?: string }>; iconColor: string
    category: string; service: string; usage: string; metric: string; cost: string | null
    byRows?: Array<{ label: string; usage: string; cost: string | null }>
    totalCostUsd: number; hasUsage: boolean
  }

  const u = usage  // alias for brevity

  const billingRows: BillingRowDef[] = [
    // ── Text AI (Anthropic, OpenAI, etc.) ──────────────────────────────────
    {
      key: 'tokens', icon: Icons.Zap, iconColor: '#f59e0b',
      category: 'Text AI', service: 'Anthropic / OpenAI — AI Generation',
      usage: u.totalTokens > 0 ? fmt(u.totalTokens) : '—', metric: 'tokens',
      cost: fmtCost(u.totalTokensCostUsd), totalCostUsd: u.totalTokensCostUsd,
      hasUsage: u.totalTokens > 0,
      byRows: u.tokensByModel.length > 0
        ? u.tokensByModel.map((t) => ({ label: t.model, usage: fmt(t.tokens) + ' tok', cost: null }))
        : undefined,
    },

    // ── Humanizer (Undetectable, BypassGPT, StealthGPT) ───────────────────
    {
      key: 'humanizer', icon: Icons.Wand2, iconColor: '#8b5cf6',
      category: 'Content Humanizer', service: 'Undetectable · BypassGPT · StealthGPT',
      usage: u.totalHumWords > 0 ? fmt(u.totalHumWords) + ' words' : '—', metric: 'words',
      cost: fmtCost(u.totalHumCostUsd), totalCostUsd: u.totalHumCostUsd,
      hasUsage: u.totalHumWords > 0,
      byRows: u.humWordsByService.length > 0
        ? u.humWordsByService.map((h) => ({ label: providerLabel(h.service), usage: fmt(h.words) + ' words', cost: fmtCost(h.costUsd) }))
        : undefined,
    },

    // ── Image generation (DALL·E 3, FAL AI, Stability AI, Imagine Art) ────
    {
      key: 'image', icon: Icons.Image, iconColor: '#06b6d4',
      category: 'Image Generation', service: 'DALL·E 3 · FAL AI · Stability AI · Imagine Art',
      usage: u.totalImagesGenerated > 0 ? `${u.totalImagesGenerated} images` : '—', metric: 'images',
      cost: fmtCost(u.totalImageCostUsd), totalCostUsd: u.totalImageCostUsd,
      hasUsage: u.totalImagesGenerated > 0,
      byRows: u.imageGeneration.byProvider.length > 0
        ? u.imageGeneration.byProvider.map((p) => ({ label: providerLabel(p.provider), usage: `${p.count} img`, cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Video generation (Runway, Kling AI, Luma Labs, Pika) ──────────────
    {
      key: 'videogen', icon: Icons.Video, iconColor: '#ef4444',
      category: 'Video Generation', service: 'Runway · Kling AI · Luma Labs · Pika',
      usage: u.totalVideosGenerated > 0
        ? `${u.totalVideosGenerated} clips${u.totalVideoGenSecs > 0 ? ' · ' + fmtSecs(u.totalVideoGenSecs) : ''}`
        : '—',
      metric: 'clips', cost: fmtCost(u.totalVideoGenCostUsd), totalCostUsd: u.totalVideoGenCostUsd,
      hasUsage: u.totalVideosGenerated > 0,
      byRows: u.videoGeneration.byProvider.length > 0
        ? u.videoGeneration.byProvider.map((p) => ({ label: providerLabel(p.provider), usage: `${p.count} clips${p.secs > 0 ? ' · ' + fmtSecs(p.secs) : ''}`, cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Voice TTS (ElevenLabs, OpenAI TTS) ────────────────────────────────
    {
      key: 'voice', icon: Icons.Mic2, iconColor: '#6366f1',
      category: 'Voice TTS', service: 'ElevenLabs · OpenAI TTS',
      usage: u.voiceGeneration.totalChars > 0
        ? `${fmt(u.voiceGeneration.totalChars)} chars · ${fmtSecs(u.voiceGeneration.totalSecs)}`
        : '—',
      metric: 'characters', cost: fmtCost(u.voiceGeneration.totalCostUsd),
      totalCostUsd: u.voiceGeneration.totalCostUsd, hasUsage: u.voiceGeneration.totalChars > 0,
      byRows: u.voiceGeneration.byProvider.length > 0
        ? u.voiceGeneration.byProvider.map((p) => ({ label: providerLabel(p.provider), usage: fmt(p.chars) + ' ch · ' + fmtSecs(p.secs), cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Character animation (D-ID, HeyGen, SadTalker) ─────────────────────
    {
      key: 'anim', icon: Icons.PersonStanding, iconColor: '#ec4899',
      category: 'Character Animation', service: 'D-ID · HeyGen · SadTalker',
      usage: u.characterAnimation.totalSecs > 0 ? fmtSecs(u.characterAnimation.totalSecs) : '—',
      metric: 'seconds', cost: fmtCost(u.characterAnimation.totalCostUsd),
      totalCostUsd: u.characterAnimation.totalCostUsd, hasUsage: u.characterAnimation.totalSecs > 0,
      byRows: u.characterAnimation.byProvider.length > 0
        ? u.characterAnimation.byProvider.map((p) => ({ label: providerLabel(p.provider), usage: fmtSecs(p.secs), cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Music generation ───────────────────────────────────────────────────
    {
      key: 'music', icon: Icons.Music, iconColor: '#14b8a6',
      category: 'Music Generation', service: 'AI Music & SFX',
      usage: u.musicGeneration.totalSecs > 0 ? fmtSecs(u.musicGeneration.totalSecs) : '—',
      metric: 'seconds', cost: fmtCost(u.musicGeneration.totalCostUsd),
      totalCostUsd: u.musicGeneration.totalCostUsd, hasUsage: u.musicGeneration.totalSecs > 0,
      byRows: u.musicGeneration.byProvider.length > 0
        ? u.musicGeneration.byProvider.map((p) => ({ label: providerLabel(p.provider), usage: fmtSecs(p.secs), cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Video composition (Shotstack) ──────────────────────────────────────
    {
      key: 'videocomp', icon: Icons.Film, iconColor: '#f97316',
      category: 'Video Composition', service: 'Shotstack',
      usage: u.videoComposition.totalSecs > 0 ? fmtSecs(u.videoComposition.totalSecs) : '—',
      metric: 'seconds', cost: fmtCost(u.videoComposition.totalCostUsd),
      totalCostUsd: u.videoComposition.totalCostUsd, hasUsage: u.videoComposition.totalSecs > 0,
    },

    // ── AI Detection (GPTZero, Originality.ai, Sapling, Copyleaks) ─────────
    {
      key: 'detect', icon: Icons.ShieldCheck, iconColor: '#22c55e',
      category: 'AI Detection', service: 'GPTZero · Originality.ai · Sapling · Copyleaks',
      usage: u.detectionCalls > 0 ? `${u.detectionCalls} calls` : '—', metric: 'calls',
      cost: fmtCost(u.totalDetectionCostUsd), totalCostUsd: u.totalDetectionCostUsd,
      hasUsage: u.detectionCalls > 0,
      byRows: u.detectionByService.length > 0
        ? u.detectionByService.map((d) => ({ label: providerLabel(d.service), usage: `${d.calls} calls`, cost: fmtCost(d.costUsd) }))
        : undefined,
    },

    // ── Translation (DeepL, Google Translate) ─────────────────────────────
    {
      key: 'translate', icon: Icons.Languages, iconColor: '#3b82f6',
      category: 'Translation', service: 'DeepL · Google Translate',
      usage: u.totalTranslationChars > 0 ? `${fmt(u.totalTranslationChars)} chars` : '—',
      metric: 'characters', cost: fmtCost(u.totalTranslationCostUsd),
      totalCostUsd: u.totalTranslationCostUsd, hasUsage: u.totalTranslationChars > 0,
      byRows: u.translationByProvider.length > 0
        ? u.translationByProvider.map((p) => ({ label: providerLabel(p.provider), usage: fmt(p.chars) + ' ch', cost: fmtCost(p.costUsd) }))
        : undefined,
    },

    // ── Transcription: AssemblyAI ──────────────────────────────────────────
    {
      key: 'assemblyai', icon: Icons.Mic, iconColor: '#84cc16',
      category: 'Transcription', service: 'AssemblyAI',
      usage: u.assemblyaiMinutes > 0 ? `${u.assemblyaiMinutes} min` : '—', metric: 'minutes',
      cost: fmtCost(u.assemblyaiCostUsd), totalCostUsd: u.assemblyaiCostUsd,
      hasUsage: u.assemblyaiMinutes > 0,
    },

    // ── Transcription: Live (local, no cost) ───────────────────────────────
    {
      key: 'livetranscript', icon: Icons.Mic, iconColor: '#94a3b8',
      category: 'Transcription', service: 'Live Transcription (local)',
      usage: u.transcriptionMinutes > 0 ? `${u.transcriptionMinutes} min` : '—', metric: 'minutes',
      cost: null, totalCostUsd: 0, hasUsage: u.transcriptionMinutes > 0,
    },

    // ── Video Intelligence (Google AI Studio / Gemini) ─────────────────────
    {
      key: 'videointel', icon: Icons.Eye, iconColor: '#6366f1',
      category: 'Video Intelligence', service: 'Google AI Studio (Gemini)',
      usage: u.videoIntelligenceCalls > 0 ? `${u.videoIntelligenceCalls} analyses` : '—',
      metric: 'analyses', cost: null, totalCostUsd: 0,
      hasUsage: u.videoIntelligenceCalls > 0,
    },

    // ── Brave Search (GTM / company profile enrichment) ───────────────────
    {
      key: 'brave', icon: Icons.Search, iconColor: '#f97316',
      category: 'Research Enrichment', service: 'Brave Search API (GTM / Company Autofill)',
      usage: u.braveSearchQueries > 0 ? `${u.braveSearchQueries} queries` : '—',
      metric: 'queries (free tier: 2,000/mo)', cost: null, totalCostUsd: 0,
      hasUsage: u.braveSearchQueries > 0,
    },
  ]

  const totalBilledCost = billingRows.reduce((s, r) => s + r.totalCostUsd, 0)

  return (
    <div className="space-y-6">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {DAYS_OPTIONS.map(({ label, value }) => (
            <button key={value} onClick={() => setDays(value)}
              className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
                days === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
            <Icons.RefreshCw className="h-3.5 w-3.5" />Refresh
          </button>
          <button onClick={() => exportPdf(clientName, days, overview, usage, topWorkflows, manualEntries)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
            <Icons.FileDown className="h-3.5 w-3.5" />Download PDF
          </button>
        </div>
      </div>

      {/* ── Performance overview ── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Icons.Play}        label="Workflow Runs"  value={String(overview.totalRuns)} />
        <StatCard icon={Icons.CheckCircle2} label="Success Rate"  value={`${overview.successRate}%`}
          color={overview.successRate >= 80 ? 'text-emerald-500' : overview.successRate >= 50 ? 'text-amber-500' : 'text-red-500'}
          sub={`${overview.completedRuns} completed · ${overview.failedRuns} failed`} />
        <StatCard icon={Icons.Zap}          label="AI Tokens"     value={fmt(usage.totalTokens)} />
        <StatCard icon={Icons.Handshake}    label="Feedback"      value={String(overview.feedbackCount)}
          sub={overview.waitingFeedback > 0 ? `${overview.waitingFeedback} awaiting` : undefined} />
      </div>

      {/* ── Billing table ── */}
      <CollapsibleSection
        title="Billable Services — All Providers"
        icon={Icons.Receipt}
        badge={totalBilledCost > 0 ? `~$${totalBilledCost.toFixed(2)} est.` : billingRows.length === 0 ? 'No usage yet' : undefined}
        badgeColor={totalBilledCost > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}
      >
        <p className="text-[10px] text-muted-foreground -mt-2">
          All tracked services shown. Dimmed cards have no activity this period.
          Self-hosted / local services show no cost. Click active cards with multiple providers to expand.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {billingRows.map((row) => (
            <BillingCard key={row.key} {...row} />
          ))}
        </div>

        {/* Total footer */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold">Total estimated cost this period</p>
            <p className="text-[10px] text-muted-foreground">Based on approximate public list prices · actual costs may vary</p>
          </div>
          <p className={cn('text-2xl font-bold', totalBilledCost > 0 ? 'text-emerald-500' : 'text-muted-foreground')}>
            {totalBilledCost > 0 ? `$${totalBilledCost.toFixed(2)}` : '—'}
          </p>
        </div>
      </CollapsibleSection>

      {/* ── Runs over time ── */}
      {runsOverTime.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title={`Workflow Runs — Last ${days} Days`} icon={Icons.BarChart2} />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={runsOverTime} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-c" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                <linearGradient id="grad-f" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false}
                tickFormatter={(v: string) => v.slice(5)} interval={Math.floor(runsOverTime.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="completed" stroke="#22c55e" fill="url(#grad-c)" strokeWidth={2} dot={false} name="Completed" />
              <Area type="monotone" dataKey="failed"    stroke="#ef4444" fill="url(#grad-f)" strokeWidth={2} dot={false} name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Three donuts ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Feedback Sentiment" icon={Icons.Handshake} />
          <DonutChart data={sentimentData} colors={sentimentColors} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Output Types" icon={Icons.FileText} />
          <DonutChart data={outputData} colors={CHART_COLORS} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Detection Pass Rate" icon={Icons.ShieldCheck} />
          <DonutChart data={detectionData} colors={['#22c55e', '#f59e0b', '#94a3b8']} />
        </div>
      </div>

      {/* ── Token + humanizer bars ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <SectionHeading title="AI Tokens by Model" icon={Icons.Zap} />
          {tokensByModel.length === 0
            ? <p className="text-xs text-muted-foreground">No token usage yet</p>
            : tokensByModel.map((t, i) => <HBar key={t.model} label={t.model} value={t.tokens} max={maxTokens} color={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <SectionHeading title="Humanizers by Service" icon={Icons.Wand2} />
          {humUsage.length === 0
            ? <p className="text-xs text-muted-foreground">No humanizer usage yet</p>
            : humUsage.map((h, i) => <HBar key={h.service} label={providerLabel(h.service)} value={h.words} max={maxHum} color={CHART_COLORS[(i + 2) % CHART_COLORS.length]} unit=" words" />)}
        </div>
      </div>

      {/* ── Top workflows ── */}
      {topWorkflows.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 pt-4 pb-2"><SectionHeading title="Top Workflows" icon={Icons.Workflow} /></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Workflow</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Runs</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Completed</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Failed</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Success</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {topWorkflows.map((wf, i) => (
                  <tr key={wf.id} className={cn('border-b border-border/50 hover:bg-muted/20', i % 2 === 0 ? '' : 'bg-muted/10')}>
                    <td className="px-4 py-2.5 font-medium">{wf.name}</td>
                    <td className="px-4 py-2.5 text-right">{wf.periodRuns}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{wf.completed}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{wf.failed}</td>
                    <td className={cn('px-4 py-2.5 text-right font-medium',
                      wf.successRate >= 80 ? 'text-emerald-500' : wf.successRate >= 50 ? 'text-amber-500' : 'text-red-500')}>
                      {wf.successRate}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(wf.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Stakeholder activity ── */}
      <CollapsibleSection title="Stakeholder Activity" icon={Icons.Users} defaultCollapsed={stakeholderStats.length === 0}>
        {stakeholderStats.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No stakeholder feedback yet</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-1 pb-1 text-[10px] text-muted-foreground">
              <span className="mr-1">Sort:</span>
              {([['name', 'Name'], ['totalFeedback', 'Reviews'], ['totalCorrections', 'Corrections'], ['avgRating', 'Rating'], ['lastActive', 'Last Active']] as const).map(([col, label]) => (
                <button key={col}
                  onClick={() => { setStkSort(col); setStkDir(stkSort === col && stkDir === 'desc' ? 'asc' : 'desc') }}
                  className={cn('inline-flex items-center gap-0.5 rounded px-2 py-0.5 transition-colors', stkSort === col ? 'bg-blue-100 text-blue-700' : 'hover:bg-muted')}>
                  {label}
                  {stkSort === col && (stkDir === 'desc' ? <Icons.ChevronDown className="h-2.5 w-2.5" /> : <Icons.ChevronUp className="h-2.5 w-2.5" />)}
                </button>
              ))}
            </div>
            {sortedStk.map((s) => {
              const isExp = expandedStk === s.id
              const decisionData = Object.entries(s.decisions).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v, key: k }))
              const tagData = Object.entries(s.tags).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v })).sort((a, b) => b.count - a.count)
              const toneData = Object.entries(s.tones).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v }))
              return (
                <div key={s.id} className="rounded-lg border border-border bg-background overflow-hidden">
                  <button className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/30" onClick={() => setExpandedStk(isExp ? null : s.id)}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{s.name.slice(0, 2).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.role ? `${s.role} · ` : ''}{s.email}</p>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-center"><p className="text-sm font-semibold">{s.totalFeedback}</p><p className="text-[10px] text-muted-foreground">reviews</p></div>
                      <div className="text-center"><p className="text-sm font-semibold">{s.totalCorrections}</p><p className="text-[10px] text-muted-foreground">corrections</p></div>
                      <div className="text-center min-w-[80px]"><StarRating rating={s.avgRating} /><p className="text-[10px] text-muted-foreground">avg rating</p></div>
                      <div className="text-[10px] text-muted-foreground min-w-[60px] text-right">{s.lastActive ? new Date(s.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}</div>
                      <Icons.ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isExp && 'rotate-180')} />
                    </div>
                  </button>
                  {isExp && (
                    <div className="border-t border-border px-4 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/20">
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Decisions</p>
                        {decisionData.length === 0 ? <p className="text-xs text-muted-foreground">No decisions yet</p> : (
                          <div className="space-y-1.5">
                            {decisionData.map(({ label, count, key }) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: SENTIMENT_COLORS_MAP[key] ?? '#6b7280' }} />
                                  <span className="text-xs capitalize truncate">{label}</span>
                                </div>
                                <span className="text-xs font-semibold shrink-0">{count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tone Feedback</p>
                        {toneData.length === 0 ? <p className="text-xs text-muted-foreground">No tone feedback yet</p> : (
                          <ResponsiveContainer width="100%" height={100}>
                            <BarChart data={toneData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                              <XAxis type="number" hide />
                              <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: '#71717a' }} width={80} />
                              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', fontSize: 10, borderRadius: 6 }} />
                              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                                {toneData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Content Tags</p>
                        {tagData.length === 0 ? <p className="text-xs text-muted-foreground">No content tags yet</p> : (
                          <div className="flex flex-wrap gap-1.5">
                            {tagData.map(({ label, count }) => (
                              <span key={label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
                                {label}<span className="font-semibold text-muted-foreground">x{count}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* ── Full ReportsDashboard charts ── */}
      <ReportsDashboard clientId={clientId} startDate={startDate} endDate={endDate} showFilters={false} />

      {/* ── Manual activity log ── */}
      <ManualUsageSection clientId={clientId} onEntriesChange={setManualEntries} />

    </div>
  )
}
