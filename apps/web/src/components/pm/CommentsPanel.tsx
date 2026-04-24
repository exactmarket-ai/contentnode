// Threaded comment panel for a workflow run. Supports @mention autocomplete,
// mention highlighting, and real-time optimistic posting.
import { useState, useEffect, useRef, useMemo } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { timeAgo } from './types'
import type { Member } from './types'

interface Comment {
  id: string
  body: string
  createdAt: string
  user: { id: string; name: string | null; avatarStorageKey: string | null }
}

function CommentAvatar({ user }: { user: Comment['user'] }) {
  const initials = user.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  if (user.avatarStorageKey) {
    return <img src={user.avatarStorageKey} alt={user.name ?? ''} className="h-6 w-6 rounded-full object-cover shrink-0 border border-border" />
  }
  return (
    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-[9px] font-semibold shrink-0">
      {initials}
    </div>
  )
}

function renderBody(body: string): React.ReactNode {
  const parts = body.split(/(@\w+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^@\w+/.test(part)
          ? <span key={i} className="font-semibold text-blue-600 bg-blue-50 rounded px-0.5">{part}</span>
          : part,
      )}
    </>
  )
}

export function CommentsPanel({
  runId,
  members,
  currentUserId,
}: {
  runId: string
  members: Member[]
  currentUserId: string
}) {
  const [comments,   setComments]   = useState<Comment[]>([])
  const [loading,    setLoading]    = useState(true)
  const [body,       setBody]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null)
  const [mentionIdx,   setMentionIdx]   = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)

  // Load comments
  useEffect(() => {
    if (!runId) return
    setLoading(true)
    apiFetch(`/api/v1/runs/${runId}/comments`)
      .then((r) => r.json())
      .then(({ data }) => setComments(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [runId])

  // Scroll to bottom when comments load or are added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  // @mention suggestions
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return members
      .filter((m) =>
        m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
      )
      .slice(0, 6)
  }, [mentionQuery, members])

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val    = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setBody(val)
    setMentionIdx(0)

    const beforeCursor = val.slice(0, cursor)
    const match        = beforeCursor.match(/@(\w*)$/)
    if (match) {
      const start = cursor - match[0].length
      setMentionQuery(match[1])
      setMentionRange({ start, end: cursor })
    } else {
      setMentionQuery(null)
      setMentionRange(null)
    }
  }

  function insertMention(m: Member) {
    if (!mentionRange) return
    const firstName = m.name?.split(/\s+/)[0] ?? m.email.split('@')[0]
    const before    = body.slice(0, mentionRange.start)
    const after     = body.slice(mentionRange.end)
    const newBody   = `${before}@${firstName} ${after}`
    setBody(newBody)
    setMentionQuery(null)
    setMentionRange(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Navigate @mention dropdown
    if (mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionSuggestions.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionSuggestions[mentionIdx])
        return
      }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    // Submit on Ctrl/Cmd+Enter
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleSubmit() {
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setBody('')
    setMentionQuery(null)

    try {
      const res = await apiFetch(`/api/v1/runs/${runId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setComments((prev) => [...prev, data])
      }
    } catch {}
    finally { setSubmitting(false) }
  }

  const memberInitials = (m: Member) =>
    m.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <div className="flex flex-col h-full">
      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && (
          <div className="flex justify-center py-6">
            <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && comments.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
            <Icons.MessageCircle className="h-7 w-7 opacity-20" />
            <p className="text-xs">No comments yet. Be the first.</p>
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className={cn('flex gap-2.5', c.user.id === currentUserId && 'flex-row-reverse')}>
            <CommentAvatar user={c.user} />
            <div className={cn('flex-1 min-w-0', c.user.id === currentUserId && 'items-end flex flex-col')}>
              <div className={cn(
                'flex items-baseline gap-1.5 mb-1',
                c.user.id === currentUserId && 'flex-row-reverse',
              )}>
                <span className="text-[11px] font-semibold text-foreground">
                  {c.user.id === currentUserId ? 'You' : (c.user.name ?? 'Unknown')}
                </span>
                <span className="text-[9px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </div>
              <div className={cn(
                'rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[85%] whitespace-pre-wrap',
                c.user.id === currentUserId
                  ? 'bg-blue-500 text-white rounded-tr-sm'
                  : 'bg-muted/60 text-foreground rounded-tl-sm border border-border/50',
              )}>
                {c.user.id === currentUserId
                  ? c.body
                  : renderBody(c.body)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Compose area */}
      <div className="shrink-0 border-t border-border px-3 py-3 relative">
        {/* @mention dropdown */}
        {mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden z-50">
            <p className="px-3 py-1.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border/40">
              Mention
            </p>
            {mentionSuggestions.map((m, i) => (
              <button
                key={m.id}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  i === mentionIdx ? 'bg-blue-50' : 'hover:bg-gray-50',
                )}
              >
                <div className={cn(
                  'h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold',
                  i === mentionIdx ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600',
                )}>
                  {m.avatarStorageKey
                    ? <img src={m.avatarStorageKey} alt="" className="h-full w-full rounded-full object-cover" />
                    : memberInitials(m)}
                </div>
                <div>
                  <p className="text-[11px] font-medium text-foreground">{m.name ?? m.email}</p>
                  {m.name && <p className="text-[9px] text-muted-foreground">{m.email}</p>}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment… use @name to mention someone"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 leading-relaxed"
          />
          <button
            onClick={handleSubmit}
            disabled={!body.trim() || submitting}
            className="h-9 w-9 shrink-0 rounded-xl bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send (Ctrl+Enter)"
          >
            {submitting
              ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Icons.Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground/60 text-right">Ctrl+Enter to send</p>
      </div>
    </div>
  )
}
