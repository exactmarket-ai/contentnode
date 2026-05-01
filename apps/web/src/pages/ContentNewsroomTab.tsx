import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopicSource {
  title: string
  publication: string
  url: string
  publish_date: string
}

interface TopicItem {
  id: string
  title: string
  summary: string
  score: number
  scoreRationale: string | null
  sources: TopicSource[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  vertical: { id: string; name: string } | null
}

interface NewsroomMeta {
  totalDecisions: number
  verticalCount: number
  hasPreferenceProfile: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 8) return '#16a34a'
  if (score >= 6) return '#d97706'
  return '#dc2626'
}

function scoreBg(score: number): string {
  if (score >= 8) return '#f0fdf4'
  if (score >= 6) return '#fffbeb'
  return '#fef2f2'
}

// ── Topic Card ─────────────────────────────────────────────────────────────────

function TopicCard({
  topic,
  selected,
  onSelect,
  onApprove,
  onReject,
  loading,
}: {
  topic: TopicItem
  selected: boolean
  onSelect: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        border: selected ? '1.5px solid #a200ee' : '1px solid #e5e7eb',
        borderRadius: 10,
        backgroundColor: selected ? '#fdf5ff' : '#ffffff',
        padding: '14px 16px',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onSelect(topic.id)}
          style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
            border: selected ? '1.5px solid #a200ee' : '1.5px solid #d1d5db',
            backgroundColor: selected ? '#a200ee' : '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {selected && <Icons.Check className="h-3 w-3 text-white" />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            {/* Score badge */}
            <span
              style={{
                fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '1px 7px',
                color: scoreColor(topic.score), backgroundColor: scoreBg(topic.score),
                flexShrink: 0,
              }}
            >
              {topic.score.toFixed(1)}
            </span>

            {/* Vertical pill */}
            {topic.vertical && (
              <span style={{ fontSize: 10, borderRadius: 10, padding: '1px 8px', backgroundColor: '#ede9fe', color: '#6d28d9', fontWeight: 500, flexShrink: 0 }}>
                {topic.vertical.name}
              </span>
            )}

            {/* Title */}
            <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1, minWidth: 0, margin: 0 }}>
              {topic.title}
            </p>
          </div>

          {/* Summary */}
          <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0', lineHeight: 1.5 }}>
            {topic.summary}
          </p>

          {/* Score rationale — expandable */}
          {topic.scoreRationale && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 0', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              <Icons.ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
              Why this score?
            </button>
          )}
          {expanded && topic.scoreRationale && (
            <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0', lineHeight: 1.5, backgroundColor: '#f9fafb', borderRadius: 6, padding: '8px 10px' }}>
              {topic.scoreRationale}
            </p>
          )}

          {/* Sources */}
          {topic.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {topic.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 10, borderRadius: 6, padding: '2px 8px',
                    backgroundColor: '#f3f4f6', color: '#374151', fontWeight: 500,
                    textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3,
                  }}
                >
                  <Icons.ExternalLink className="h-2.5 w-2.5" />
                  {s.publication || new URL(s.url).hostname}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onReject(topic.id)}
            disabled={loading}
            title="Reject"
            style={{
              width: 30, height: 30, borderRadius: 6, border: '1px solid #fee2e2',
              backgroundColor: '#fff7f7', color: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            <Icons.X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onApprove(topic.id)}
            disabled={loading}
            title="Approve"
            style={{
              width: 30, height: 30, borderRadius: 6, border: '1px solid #bbf7d0',
              backgroundColor: '#f0fdf4', color: '#16a34a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            <Icons.Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ContentNewsroomTab({ clientId }: { clientId: string }) {
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [meta, setMeta] = useState<NewsroomMeta | null>(null)
  const [verticals, setVerticals] = useState<{ id: string; name: string }[]>([])
  const [activeVertical, setActiveVertical] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = activeVertical ? `?verticalId=${activeVertical}` : ''
      const res = await apiFetch(`/api/v1/topic-queue/${clientId}${params}`)
      if (!res.ok) throw new Error('Failed to load topics')
      const { data, meta: m } = await res.json()
      setTopics(data ?? [])
      setMeta(m ?? null)

      // collect verticals from topics
      const seen = new Map<string, { id: string; name: string }>()
      for (const t of (data ?? []) as TopicItem[]) {
        if (t.vertical) seen.set(t.vertical.id, t.vertical)
      }
      if (seen.size > 0) setVerticals(Array.from(seen.values()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [clientId, activeVertical])

  useEffect(() => { load() }, [load])

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    setActionLoading(id)
    try {
      const res = await apiFetch(`/api/v1/topic-queue/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setTopics((prev) => prev.filter((t) => t.id !== id))
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    } catch {
      // silently ignore single-item action errors
    } finally {
      setActionLoading(null)
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const selectAll = () => {
    setSelected(new Set(topics.map((t) => t.id)))
  }

  const clearSelection = () => setSelected(new Set())

  const bulkAction = async (status: 'approved' | 'rejected') => {
    const ids = Array.from(selected)
    for (const id of ids) {
      await updateStatus(id, status)
    }
    clearSelection()
  }

  const generateBlogs = async () => {
    const approvedIds = topics
      .filter((t) => selected.has(t.id))
      .filter((t) => t.status === 'approved')
      .map((t) => t.id)
    if (approvedIds.length === 0) return

    setGenerating(true)
    try {
      const res = await apiFetch('/api/v1/topic-queue/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: approvedIds }),
      })
      if (!res.ok) throw new Error('Failed to generate')
      clearSelection()
      load()
    } catch {
      // ignore
    } finally {
      setGenerating(false)
    }
  }

  const pendingTopics = topics.filter((t) => t.status === 'pending')
  const approvedTopics = topics.filter((t) => t.status === 'approved')
  const selectedApproved = approvedTopics.filter((t) => selected.has(t.id))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icons.Newspaper className="h-5 w-5 text-violet-500" />
            <h2 className="text-[15px] font-semibold">Content Newsroom</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review AI-scored topics from scheduled research. Approve to generate blogs, reject to teach the system your preferences.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <Icons.RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Brain status bar */}
      {meta && (
        <div
          style={{
            borderRadius: 8, padding: '10px 14px',
            backgroundColor: meta.hasPreferenceProfile ? '#fdf5ff' : '#f9fafb',
            border: `1px solid ${meta.hasPreferenceProfile ? '#e9d5ff' : '#e5e7eb'}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <Icons.Brain className={cn('h-4 w-4 shrink-0', meta.hasPreferenceProfile ? 'text-violet-500' : 'text-gray-400')} />
          <div className="flex-1 min-w-0">
            {meta.hasPreferenceProfile ? (
              <p style={{ fontSize: 12, color: '#7c00cc', margin: 0 }}>
                Preference profile active — {meta.totalDecisions} decision{meta.totalDecisions !== 1 ? 's' : ''} recorded
                {meta.verticalCount > 1 ? ` across ${meta.verticalCount} verticals` : ''}. Topic scoring is personalized.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                No preference profile yet. Approve and reject topics to train the system — a profile is built after every 10 decisions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Vertical filter pills */}
      {verticals.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveVertical(null)}
            style={{
              fontSize: 11, fontWeight: 500, borderRadius: 20, padding: '4px 12px',
              border: activeVertical === null ? '1.5px solid #a200ee' : '1px solid #e5e7eb',
              backgroundColor: activeVertical === null ? '#fdf5ff' : '#f9fafb',
              color: activeVertical === null ? '#7c00cc' : '#6b7280',
              cursor: 'pointer',
            }}
          >
            All verticals
          </button>
          {verticals.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setActiveVertical(activeVertical === v.id ? null : v.id)}
              style={{
                fontSize: 11, fontWeight: 500, borderRadius: 20, padding: '4px 12px',
                border: activeVertical === v.id ? '1.5px solid #a200ee' : '1px solid #e5e7eb',
                backgroundColor: activeVertical === v.id ? '#fdf5ff' : '#f9fafb',
                color: activeVertical === v.id ? '#7c00cc' : '#6b7280',
                cursor: 'pointer',
              }}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {/* Selection bar — only when items are selected */}
      {selected.size > 0 && (
        <div
          style={{
            borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
            backgroundColor: '#fdf5ff', border: '1.5px solid #e9d5ff',
          }}
        >
          <span style={{ fontSize: 12, color: '#7c00cc', fontWeight: 600, flex: 1 }}>
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => bulkAction('rejected')}
            style={{
              fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              border: '1px solid #fee2e2', backgroundColor: '#fff7f7', color: '#dc2626',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <Icons.X className="h-3 w-3" />
            Reject all
          </button>
          <button
            type="button"
            onClick={() => bulkAction('approved')}
            style={{
              fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#16a34a',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <Icons.Check className="h-3 w-3" />
            Approve all
          </button>
          {selectedApproved.length > 0 && (
            <button
              type="button"
              onClick={generateBlogs}
              disabled={generating}
              style={{
                fontSize: 12, fontWeight: 600, borderRadius: 6, padding: '5px 14px', cursor: generating ? 'not-allowed' : 'pointer',
                border: 'none', backgroundColor: '#a200ee', color: '#ffffff', opacity: generating ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {generating ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Sparkles className="h-3 w-3" />}
              Generate {selectedApproved.length} blog{selectedApproved.length !== 1 ? 's' : ''}
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
          >
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 90, borderRadius: 10, backgroundColor: '#f3f4f6', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      )}

      {/* Pending topics */}
      {!loading && pendingTopics.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Pending review — {pendingTopics.length}
            </p>
            <button
              type="button"
              onClick={selected.size === pendingTopics.length ? clearSelection : selectAll}
              style={{ fontSize: 11, color: '#a200ee', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              {selected.size === pendingTopics.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          {pendingTopics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onApprove={(id) => updateStatus(id, 'approved')}
              onReject={(id) => updateStatus(id, 'rejected')}
              loading={actionLoading === t.id}
            />
          ))}
        </div>
      )}

      {/* Approved topics awaiting generation */}
      {!loading && approvedTopics.length > 0 && (
        <div className="space-y-3">
          <p style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Approved — ready to generate
          </p>
          {approvedTopics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              selected={selected.has(t.id)}
              onSelect={toggleSelect}
              onApprove={(id) => updateStatus(id, 'approved')}
              onReject={(id) => updateStatus(id, 'rejected')}
              loading={actionLoading === t.id}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && pendingTopics.length === 0 && approvedTopics.length === 0 && (
        <div
          style={{
            borderRadius: 12, border: '1px dashed #e5e7eb',
            padding: '48px 24px', textAlign: 'center',
          }}
        >
          <Icons.Newspaper className="h-8 w-8 text-gray-300 mx-auto mb-3" />
          <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No topics waiting for review</p>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0, maxWidth: 360, marginInline: 'auto' }}>
            Topics appear here after a scheduled research task runs with "Evaluate and queue" mode enabled.
            Go to Research → Scheduled Tasks to configure a task.
          </p>
        </div>
      )}
    </div>
  )
}
