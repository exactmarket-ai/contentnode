import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Overview {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  successRate: number
  waitingFeedback: number
  waitingApproval: number
  feedbackCount: number
  avgCompletionMins: number
}
interface RunDay { date: string; completed: number; failed: number; total: number }
interface SentimentItem { sentiment: string; count: number }
interface TokenModel { model: string; tokens: number }
interface OutputType { type: string; count: number }
interface DetectionItem { label: string; count: number }
interface TopWorkflow { id: string; name: string; periodRuns: number; completed: number; failed: number; successRate: number; tokens: number }
interface HumService { service: string; words: number }
interface ClientUsage {
  totalTokens: number
  tokensByModel: TokenModel[]
  totalHumWords: number
  humWordsByService: HumService[]
  transcriptionMinutes: number
  assemblyaiMinutes: number
  detectionCalls: number
  totalImagesGenerated: number
  totalVideosGenerated: number
  totalTranslationChars: number
  brandFilesReady: number
  fwFilesReady: number
}
interface ManualEntry { id: string; date: string; service: string; description: string | null; quantity: number; unit: string }

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SENTIMENT_CFG: Record<string, { label: string; color: string }> = {
  approved:              { label: 'Approved',          color: '#22c55e' },
  approved_with_changes: { label: 'With changes',      color: '#3b82f6' },
  needs_revision:        { label: 'Needs revision',    color: '#f59e0b' },
  rejected:              { label: 'Rejected',          color: '#ef4444' },
  no_decision:           { label: 'No decision',       color: '#94a3b8' },
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6']

const DAYS_OPTIONS = [
  { label: '7d',  value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
]

const UNIT_OPTIONS = ['minutes', 'hours', 'sessions', 'videos', 'words', 'pages', 'other']
const SUGGESTED_SERVICES = ['Google Meet', 'Zoom', 'Video Editing', 'Copywriting', 'Design', 'Research', 'Strategy Session', 'Client Call', 'Content Review', 'Other']

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n)
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-foreground' }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  color?: string
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

function SectionHeading({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Donut chart
// ─────────────────────────────────────────────────────────────────────────────

function DonutChart({ data, colors, label }: {
  data: { name: string; value: number }[]
  colors: string[]
  label: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-xs text-muted-foreground py-4 text-center">No data</p>
  return (
    <div className="flex flex-col items-center gap-3">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={2} dataKey="value">
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} stroke="transparent" />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v, n) => [`${Number(v)} (${total > 0 ? Math.round(Number(v) / total * 100) : 0}%)`, String(n)]}
          />
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

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal bar list
// ─────────────────────────────────────────────────────────────────────────────

function HBar({ label, value, max, color, unit = '' }: { label: string; value: number; max: number; color: string; unit?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs truncate text-muted-foreground">{label}</span>
        <span className="text-xs font-medium shrink-0 ml-2">{fmt(value)}{unit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual usage section (inline)
// ─────────────────────────────────────────────────────────────────────────────

function ManualUsageSection({
  clientId,
  onEntriesChange,
}: {
  clientId: string
  onEntriesChange?: (entries: ManualEntry[]) => void
}) {
  const [entries, setEntries] = useState<ManualEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ date: today, service: '', description: '', quantity: '', unit: 'minutes' })

  const setAndNotify = useCallback((list: ManualEntry[]) => {
    setEntries(list)
    onEntriesChange?.(list)
  }, [onEntriesChange])

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/manual-usage`)
      .then((r) => r.json())
      .then(({ data }) => { setAndNotify(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, setAndNotify])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.service.trim() || !form.quantity || !form.date) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/manual-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeading title="Manual Activity Log" icon={Icons.ClipboardEdit} />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
        >
          <Icons.Plus className="h-3 w-3" />
          Log activity
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Service / Tool</label>
              <input type="text" value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                placeholder="e.g. Google Meet" list="svc-list"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required />
              <datalist id="svc-list">{SUGGESTED_SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Description (optional)</label>
            <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Strategy call with marketing team"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Quantity</label>
              <input type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="60" className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Unit</label>
              <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving && <Icons.Loader2 className="h-3 w-3 animate-spin" />}
              Save entry
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-4"><Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No manual activity logged yet.</p>
      ) : (
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
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                {deleting === entry.id ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icons.Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF export
// ─────────────────────────────────────────────────────────────────────────────

function exportPdf(clientName: string, days: number, overview: Overview, usage: ClientUsage, topWorkflows: TopWorkflow[], manualEntries: ManualEntry[]) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const period = `Last ${days} days`

  const statRows = [
    ['Workflow Runs', String(overview.totalRuns)],
    ['Completed', String(overview.completedRuns)],
    ['Failed', String(overview.failedRuns)],
    ['Success Rate', `${overview.successRate}%`],
    ['Avg Completion', `${overview.avgCompletionMins} min`],
    ['Feedback Received', String(overview.feedbackCount)],
    ['AI Tokens', fmt(usage.totalTokens)],
    ['Humanizer Words', fmt(usage.totalHumWords)],
    ['Live Transcription', `${usage.transcriptionMinutes} min`],
    ['File Transcription', `${usage.assemblyaiMinutes} min`],
    ['Detection Calls', String(usage.detectionCalls)],
    ['Images Generated', String(usage.totalImagesGenerated)],
    ['Videos Generated', String(usage.totalVideosGenerated)],
    ['Brand Files', String(usage.brandFilesReady)],
    ['GTM Files', String(usage.fwFilesReady)],
  ].filter(([, v]) => v !== '0' && v !== '0 min')

  const thStyle = 'padding:7px 12px;background:#f8f8f8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#888;text-align:left;border-bottom:2px solid #e8e8e8'
  const tdStyle = 'padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px'

  const wfRows = topWorkflows.map((wf) =>
    `<tr><td style="${tdStyle}">${wf.name}</td><td style="${tdStyle};text-align:center">${wf.periodRuns}</td><td style="${tdStyle};text-align:center;color:#22c55e">${wf.completed}</td><td style="${tdStyle};text-align:center;color:#ef4444">${wf.failed}</td><td style="${tdStyle};text-align:center">${wf.successRate}%</td><td style="${tdStyle};text-align:right">${fmt(wf.tokens)}</td></tr>`
  ).join('')

  const manualRows = manualEntries.map((e) => {
    const d = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `<tr><td style="${tdStyle}">${d}</td><td style="${tdStyle}">${e.service}</td><td style="${tdStyle};color:#555">${e.description ?? ''}</td><td style="${tdStyle};text-align:right">${e.quantity} ${e.unit}</td></tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${clientName} — Usage Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 48px; background: #fff; }
  @page { margin: 24mm 20mm; size: A4; }
  @media print { body { padding: 0; } }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:36px;padding-bottom:16px;border-bottom:2px solid #111">
  <div>
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Usage & Performance Report</div>
    <h1 style="margin:0;font-size:26px;font-weight:700">${clientName}</h1>
  </div>
  <div style="text-align:right;font-size:12px;color:#666">${period}<br>${date}</div>
</div>

<h2>Summary</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:28px">
  ${statRows.map(([label, value]) => `<div style="border:1px solid #e8e8e8;border-radius:8px;padding:12px"><div style="font-size:11px;color:#888;margin-bottom:3px">${label}</div><div style="font-size:18px;font-weight:700">${value}</div></div>`).join('')}
</div>

${topWorkflows.length > 0 ? `<h2>Top Workflows</h2>
<table><thead><tr>
  <th style="${thStyle}">Workflow</th><th style="${thStyle};text-align:center">Runs</th><th style="${thStyle};text-align:center">Completed</th><th style="${thStyle};text-align:center">Failed</th><th style="${thStyle};text-align:center">Success</th><th style="${thStyle};text-align:right">Tokens</th>
</tr></thead><tbody>${wfRows}</tbody></table>` : ''}

${manualEntries.length > 0 ? `<h2>Manual Activity Log</h2>
<table><thead><tr>
  <th style="${thStyle}">Date</th><th style="${thStyle}">Tool / Service</th><th style="${thStyle}">Description</th><th style="${thStyle};text-align:right">Quantity</th>
</tr></thead><tbody>${manualRows}</tbody></table>` : ''}

<div style="margin-top:48px;padding-top:16px;border-top:1px solid #e8e8e8;font-size:11px;color:#aaa;display:flex;justify-content:space-between">
  <span>Generated by ContentNode</span><span>${date}</span>
</div>
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

export function ClientUsageTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  const [overview, setOverview] = useState<Overview | null>(null)
  const [runsOverTime, setRunsOverTime] = useState<RunDay[]>([])
  const [sentiment, setSentiment] = useState<SentimentItem[]>([])
  const [tokensByModel, setTokensByModel] = useState<TokenModel[]>([])
  const [outputTypes, setOutputTypes] = useState<OutputType[]>([])
  const [detectionRate, setDetectionRate] = useState<DetectionItem[]>([])
  const [topWorkflows, setTopWorkflows] = useState<TopWorkflow[]>([])
  const [humUsage, setHumUsage] = useState<HumService[]>([])
  const [usage, setUsage] = useState<ClientUsage | null>(null)
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([])

  const load = useCallback(() => {
    setLoading(true)
    const qs = `?clientId=${clientId}&days=${days}`
    Promise.all([
      apiFetch(`/api/v1/reports/overview${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/runs-over-time${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/feedback-sentiment${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/tokens-by-model${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/output-types${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/detection-pass-rate${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/top-workflows${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/reports/humanizer-usage${qs}`).then((r) => r.json()),
      apiFetch(`/api/v1/clients/${clientId}/usage`).then((r) => r.json()),
    ])
      .then(([ov, rot, sent, tbm, ot, dr, tw, hu, cu]) => {
        setOverview(ov.data)
        setRunsOverTime(rot.data ?? [])
        setSentiment(sent.data ?? [])
        setTokensByModel(tbm.data ?? [])
        setOutputTypes(ot.data ?? [])
        setDetectionRate(dr.data ?? [])
        setTopWorkflows(tw.data ?? [])
        setHumUsage(hu.data ?? [])
        setUsage(cu.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId, days])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  if (!overview || !usage) return (
    <p className="py-8 text-center text-sm text-muted-foreground">Failed to load usage data.</p>
  )

  const totalTranscription = usage.transcriptionMinutes + usage.assemblyaiMinutes
  const sentimentData = sentiment.map((s) => ({
    name: SENTIMENT_CFG[s.sentiment]?.label ?? s.sentiment,
    value: s.count,
  }))
  const sentimentColors = sentiment.map((s) => SENTIMENT_CFG[s.sentiment]?.color ?? '#94a3b8')
  const detectionData = detectionRate.map((d) => ({ name: d.label, value: d.count }))
  const detectionColors = ['#22c55e', '#f59e0b', '#94a3b8']
  const outputData = outputTypes.slice(0, 6).map((o) => ({ name: o.type, value: o.count }))
  const maxTokens = Math.max(...tokensByModel.map((t) => t.tokens), 1)
  const maxHum = Math.max(...humUsage.map((h) => h.words), 1)

  const extraStats = [
    { label: 'Images', value: usage.totalImagesGenerated },
    { label: 'Videos', value: usage.totalVideosGenerated },
    { label: 'Translation', value: usage.totalTranslationChars, fmt: (v: number) => v >= 1000 ? `${Math.round(v / 1000)}K ch` : `${v} ch` },
    { label: 'Detection', value: usage.detectionCalls, fmt: (v: number) => `${v} calls` },
    { label: 'Brand Files', value: usage.brandFilesReady },
    { label: 'GTM Files', value: usage.fwFilesReady },
  ].filter((s) => s.value > 0)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {DAYS_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                days === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
            <Icons.RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={() => exportPdf(clientName, days, overview, usage, topWorkflows, manualEntries)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <Icons.FileDown className="h-3.5 w-3.5" />
            Download PDF
          </button>
        </div>
      </div>

      {/* ── Primary stat cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Icons.Play}        label="Workflow Runs"   value={String(overview.totalRuns)} />
        <StatCard icon={Icons.CheckCircle2} label="Success Rate"   value={`${overview.successRate}%`}
          color={overview.successRate >= 80 ? 'text-emerald-500' : overview.successRate >= 50 ? 'text-amber-500' : 'text-red-500'}
          sub={`${overview.completedRuns} completed · ${overview.failedRuns} failed`} />
        <StatCard icon={Icons.Zap}         label="AI Tokens"       value={fmt(usage.totalTokens)} />
        <StatCard icon={Icons.Handshake}   label="Feedback"        value={String(overview.feedbackCount)}
          sub={overview.waitingFeedback > 0 ? `${overview.waitingFeedback} awaiting` : undefined} />
      </div>

      {/* ── Secondary stats ── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Icons.Wand2}  label="Humanizer Words"   value={fmt(usage.totalHumWords)} />
        <StatCard icon={Icons.Mic}    label="Transcription"     value={totalTranscription > 0 ? `${totalTranscription} min` : '—'} />
        <StatCard icon={Icons.Clock}  label="Avg Completion"    value={overview.avgCompletionMins > 0 ? `${overview.avgCompletionMins} min` : '—'} />
        <StatCard icon={Icons.FileText} label="Brain Files"     value={String(usage.brandFilesReady + usage.fwFilesReady)}
          sub={usage.brandFilesReady > 0 || usage.fwFilesReady > 0 ? `${usage.brandFilesReady} brand · ${usage.fwFilesReady} GTM` : undefined} />
      </div>

      {/* ── Runs over time chart ── */}
      {runsOverTime.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title={`Workflow Runs — Last ${days} Days`} icon={Icons.BarChart2} />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={runsOverTime} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-completed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-failed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false}
                tickFormatter={(v: string) => v.slice(5)} interval={Math.floor(runsOverTime.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="completed" stroke="#22c55e" fill="url(#grad-completed)" strokeWidth={2} dot={false} name="Completed" />
              <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="url(#grad-failed)" strokeWidth={2} dot={false} name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Three donuts ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Feedback Sentiment" icon={Icons.Handshake} />
          <DonutChart data={sentimentData} colors={sentimentColors} label="feedback" />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Output Types" icon={Icons.FileText} />
          <DonutChart data={outputData} colors={CHART_COLORS} label="outputs" />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeading title="Detection Pass Rate" icon={Icons.ShieldCheck} />
          <DonutChart data={detectionData} colors={detectionColors} label="detection" />
        </div>
      </div>

      {/* ── Two bar breakdowns ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <SectionHeading title="AI Tokens by Model" icon={Icons.Zap} />
          {tokensByModel.length === 0
            ? <p className="text-xs text-muted-foreground">No token usage yet</p>
            : tokensByModel.map((t, i) => (
                <HBar key={t.model} label={t.model} value={t.tokens} max={maxTokens} color={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <SectionHeading title="Humanizers by Service" icon={Icons.Wand2} />
          {humUsage.length === 0
            ? <p className="text-xs text-muted-foreground">No humanizer usage yet</p>
            : humUsage.map((h, i) => (
                <HBar key={h.service} label={h.service} value={h.words} max={maxHum} color={CHART_COLORS[(i + 2) % CHART_COLORS.length]} unit=" words" />
              ))}
        </div>
      </div>

      {/* ── Extra stats (images/videos/translation/etc.) ── */}
      {extraStats.length > 0 && (
        <div className={cn('grid gap-3', extraStats.length <= 3 ? 'grid-cols-3' : 'grid-cols-6')}>
          {extraStats.map(({ label, value, fmt: fmtFn }) => (
            <div key={label} className="rounded-lg border border-border bg-card/50 px-3 py-3 text-center">
              <p className="text-lg font-bold">{fmtFn ? fmtFn(value) : String(value)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Top workflows table ── */}
      {topWorkflows.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <SectionHeading title="Top Workflows" icon={Icons.Workflow} />
          </div>
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
                  <tr key={wf.id} className={cn('border-b border-border/50 hover:bg-muted/20 transition-colors', i % 2 === 0 ? '' : 'bg-muted/10')}>
                    <td className="px-4 py-2.5 font-medium">{wf.name}</td>
                    <td className="px-4 py-2.5 text-right">{wf.periodRuns}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{wf.completed}</td>
                    <td className="px-4 py-2.5 text-right text-red-500">{wf.failed}</td>
                    <td className={cn('px-4 py-2.5 text-right font-medium',
                      wf.successRate >= 80 ? 'text-emerald-500' : wf.successRate >= 50 ? 'text-amber-500' : 'text-red-500'
                    )}>{wf.successRate}%</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(wf.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Manual activity log ── */}
      <ManualUsageSection clientId={clientId} onEntriesChange={setManualEntries} />
    </div>
  )
}
