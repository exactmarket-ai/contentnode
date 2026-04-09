import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { SearchAndReplaceExtension, searchState, searchPluginKey, srSetSearch, srNext, srPrev } from './SearchAndReplace'

function writerFetch(token: string, path: string, options?: RequestInit) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
}

interface AssignmentMeta {
  assignmentId: string
  writerName: string | null
  writerEmail: string
  status: string
  workflowName: string
  runId: string
}

interface HumanizerStruggle {
  passes: number
  bestScore: number | null
  finalScore: number | null
  struggled: boolean
  message: string | null
}

interface DraftData {
  assignmentId: string
  status: string
  workflowName: string
  primaryContent: string
  allOutputs: { nodeId: string; content: string; label?: string }[]
  submittedContent: string | null
  humanizerStruggle: HumanizerStruggle | null
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function plainTextToHtml(text: string) {
  return '<p>' + text
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, '<br>'))
    .join('</p><p>') + '</p>'
}

function countWords(html: string) {
  return htmlToPlainText(html).split(/\s+/).filter(Boolean).length
}

// ─── Toolbar button ──────────────────────────────────────────────────────────

function ToolBtn({
  active, onClick, title, children,
}: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      style={{
        background: active ? '#e8e7e3' : 'transparent',
        border: active ? '1px solid #c5c4be' : '1px solid transparent',
        borderRadius: 4,
        padding: '3px 7px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        color: active ? '#1a1a1a' : '#444',
        lineHeight: 1.4,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {children}
    </button>
  )
}

const Divider = () => (
  <span style={{ width: 1, height: 18, background: '#d1d0cb', display: 'inline-block', margin: '0 4px', verticalAlign: 'middle' }} />
)

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page:     { display: 'flex', flexDirection: 'column' as const, height: '100vh', background: '#f5f4f0', color: '#1a1a1a', fontFamily: 'system-ui, sans-serif' },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #ddd', padding: '10px 24px', background: '#fff' },
  toolbar:  { display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid #ddd', padding: '6px 24px', background: '#fff', flexWrap: 'wrap' as const },
  banner:   { borderBottom: '1px solid #ddd', background: '#eeede9', padding: '8px 24px', fontSize: 12, color: '#666' },
  editorWrap: { display: 'flex', flex: 1, overflow: 'hidden' },
  editorPane: { display: 'flex', flex: 1, flexDirection: 'column' as const, padding: 24, overflow: 'auto' },
  footer:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #ddd', padding: '10px 24px', background: '#fff' },
  btn:      { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { background: '#bfdbfe', color: '#93c5fd', border: 'none', borderRadius: 6, padding: '8px 24px', fontSize: 13, fontWeight: 600, cursor: 'not-allowed' },
  btnGhost: { background: 'transparent', color: '#555', border: '1px solid #d1d0cb', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
  badge:    { background: '#eeede9', border: '1px solid #d1d0cb', borderRadius: 9999, padding: '2px 10px', fontSize: 11, color: '#555' },
  centered: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f5f4f0', color: '#1a1a1a' },
}

const editorStyles = `
  .tiptap-writer {
    flex: 1;
    min-height: 100%;
    background: #fff;
    color: #1a1a1a;
    border: 1px solid #d1d0cb;
    border-radius: 8px;
    padding: 24px 28px;
    font-size: 14px;
    line-height: 1.75;
    font-family: Georgia, serif;
    outline: none;
    overflow-y: auto;
  }
  .tiptap-writer:focus-within { border-color: #2563eb; }
  .tiptap-writer p { margin: 0 0 0.75em; }
  .tiptap-writer h1 { font-size: 1.75em; font-weight: 700; margin: 0 0 0.5em; }
  .tiptap-writer h2 { font-size: 1.4em; font-weight: 700; margin: 0 0 0.5em; }
  .tiptap-writer h3 { font-size: 1.15em; font-weight: 600; margin: 0 0 0.5em; }
  .tiptap-writer ul { margin: 0 0 0.75em; padding-left: 1.5em; list-style: disc; }
  .tiptap-writer ol { margin: 0 0 0.75em; padding-left: 1.5em; list-style: decimal; }
  .tiptap-writer li { margin-bottom: 0.25em; }
  .tiptap-writer blockquote { border-left: 3px solid #d1d0cb; margin: 0 0 0.75em; padding-left: 1em; color: #555; font-style: italic; }
  .tiptap-writer strong { font-weight: 700; }
  .tiptap-writer em { font-style: italic; }
  .tiptap-writer u { text-decoration: underline; }
  .tiptap-writer p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    color: #aaa;
    pointer-events: none;
    float: left;
    height: 0;
  }
  @keyframes spin { to { transform: rotate(360deg) } }
`

// ─── Main component ───────────────────────────────────────────────────────────

export function WriterPortalPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [phase, setPhase] = useState<'loading' | 'error' | 'editing' | 'submitted'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<AssignmentMeta | null>(null)
  const [draft, setDraft] = useState<DraftData | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveToast, setSaveToast] = useState(false)
  const [originalWords, setOriginalWords] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const [replaceVal, setReplaceVal] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: 'AI draft will appear here…' }),
      SearchAndReplaceExtension,
    ],
    content: '',
    editorProps: { attributes: { class: 'tiptap-writer' } },
  })

  useEffect(() => {
    if (!token) {
      setError('No access token provided. Please use the link from your email.')
      setPhase('error')
      return
    }

    async function load() {
      try {
        const verifyRes = await writerFetch(token, `/writer/verify?token=${token}`)
        if (!verifyRes.ok) {
          const body = await verifyRes.json().catch(() => ({}))
          setError((body as { error?: string }).error ?? 'Invalid or expired link.')
          setPhase('error')
          return
        }
        const { data: metaData } = await verifyRes.json() as { data: AssignmentMeta }
        setMeta(metaData)

        const draftRes = await writerFetch(token, `/writer/draft?token=${token}`)
        if (!draftRes.ok) {
          setError('Could not load draft content.')
          setPhase('error')
          return
        }
        const { data: draftData } = await draftRes.json() as { data: DraftData }
        setDraft(draftData)

        const initialText = draftData.submittedContent ?? draftData.primaryContent
        setOriginalWords(countWords(plainTextToHtml(draftData.primaryContent)))

        if (editor) {
          editor.commands.setContent(plainTextToHtml(initialText))
        }

        setPhase(metaData.status === 'submitted' ? 'submitted' : 'editing')
      } catch {
        setError('Failed to connect. Please try again.')
        setPhase('error')
      }
    }

    load()
  }, [token, editor])

  // Keyboard shortcut: Ctrl/Cmd+H to toggle search panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        setShowSearch((v) => {
          if (!v) setTimeout(() => searchInputRef.current?.focus(), 50)
          return !v
        })
      }
      if (e.key === 'Escape') setShowSearch(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const [matchCount, setMatchCount] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)

  const dispatch = (meta: unknown) => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, meta))
    setMatchCount(searchState.results.length)
    setMatchIndex(searchState.currentIndex)
    // Scroll current match into view
    const match = searchState.results[searchState.currentIndex]
    if (match) {
      editor.commands.setTextSelection({ from: match.from, to: match.to })
      editor.commands.scrollIntoView()
    }
  }

  const handleSearchChange = (val: string) => {
    setSearchVal(val)
    srSetSearch(val, dispatch)
  }

  const handleFindNext = () => { srNext(dispatch) }
  const handleFindPrev = () => { srPrev(dispatch) }

  const handleReplaceCurrent = () => {
    if (!editor || !searchState.results.length) return
    const match = searchState.results[searchState.currentIndex]
    if (!match) return
    editor.chain().setTextSelection({ from: match.from, to: match.to }).insertContent(searchState.replaceTerm).run()
    dispatch({ replaced: true })
  }

  const handleReplaceAll = () => {
    if (!editor || !searchState.searchTerm || !searchState.results.length) return
    // Sort back-to-front so positions stay valid as we replace
    const sorted = [...searchState.results].sort((a, b) => b.from - a.from)
    let tr = editor.state.tr
    const replaceText = searchState.replaceTerm
    for (const m of sorted) {
      if (replaceText) {
        tr = tr.replaceWith(m.from, m.to, editor.state.schema.text(replaceText))
      } else {
        tr = tr.delete(m.from, m.to)
      }
    }
    editor.view.dispatch(tr)
    searchState.results = []
    searchState.currentIndex = 0
    setMatchCount(0)
    setMatchIndex(0)
  }

  const words = editor ? countWords(editor.getHTML()) : 0
  const delta = words - originalWords
  const deltaLabel = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`
  const deltaColor = delta > 0 ? '#a16207' : delta < 0 ? '#be123c' : '#888'

  const handleCopyFormatted = useCallback(async () => {
    if (!editor) return
    const html = editor.getHTML()
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([htmlToPlainText(html)], { type: 'text/plain' }) }),
      ])
      setSaveToast(true)
      setTimeout(() => setSaveToast(false), 2500)
    } catch {
      // Fallback: plain text copy
      await navigator.clipboard.writeText(htmlToPlainText(html))
      setSaveToast(true)
      setTimeout(() => setSaveToast(false), 2500)
    }
  }, [editor])

  const handleDownload = useCallback(() => {
    if (!editor) return
    const html = editor.getHTML()
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${draft?.workflowName ?? 'Draft'}</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.75;color:#1a1a1a}h1,h2,h3{margin-top:1.5em}ul,ol{padding-left:1.5em}</style></head><body>${html}</body></html>`
    const blob = new Blob([full], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft?.workflowName ?? 'draft'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }, [editor, draft])

  async function handleSubmit() {
    if (!editor || editor.isEmpty) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const html = editor.getHTML()
      const plain = htmlToPlainText(html)
      const res = await writerFetch(token, `/writer/submit?token=${token}`, {
        method: 'POST',
        body: JSON.stringify({ content: plain, contentHtml: html }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSubmitError((body as { error?: string }).error ?? 'Submission failed.')
        return
      }
      setPhase('submitted')
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'loading') {
    return (
      <div style={S.centered}>
        <style>{editorStyles}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #2563eb', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: '#777', fontSize: 13 }}>Loading your assignment…</p>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={S.centered}>
        <style>{editorStyles}</style>
        <div style={{ maxWidth: 400, border: '1px solid #fca5a5', background: '#fff1f1', borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: 8 }}>Access Error</p>
          <p style={{ color: '#555', fontSize: 13 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (phase === 'submitted') {
    return (
      <div style={S.centered}>
        <style>{editorStyles}</style>
        <div style={{ maxWidth: 520, border: '1px solid #d1d0cb', background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, color: '#16a34a' }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#1a1a1a' }}>Submitted!</h1>
          <p style={{ color: '#555', marginBottom: 4, fontSize: 14 }}>
            Your polished version of <strong style={{ color: '#1a1a1a' }}>{meta?.workflowName ?? draft?.workflowName}</strong> has been received.
          </p>
          <p style={{ color: '#777', fontSize: 13 }}>The agency team will review your submission.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <style>{editorStyles}</style>

      {/* Header */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo.png" alt="ContentNode AI" style={{ height: 28, objectFit: 'contain' }} />
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{draft?.workflowName ?? 'Writer Portal'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {meta?.writerName && <span style={{ fontSize: 13, color: '#555' }}>Hi, {meta.writerName}</span>}
          <span style={S.badge}>{words} words <span style={{ color: deltaColor }}>({deltaLabel})</span></span>
        </div>
      </header>

      {/* Formatting toolbar */}
      {editor && (
        <div style={S.toolbar}>
          {/* Headings */}
          <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</ToolBtn>
          <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</ToolBtn>
          <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">H3</ToolBtn>
          <Divider />
          {/* Inline */}
          <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)"><strong>B</strong></ToolBtn>
          <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)"><em>I</em></ToolBtn>
          <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)"><u>U</u></ToolBtn>
          <Divider />
          {/* Lists */}
          <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</ToolBtn>
          <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</ToolBtn>
          <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">" Quote</ToolBtn>
          <Divider />
          {/* History */}
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo (⌘Z)">↩ Undo</ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo (⌘⇧Z)">↪ Redo</ToolBtn>
          <Divider />
          {/* Export */}
          <ToolBtn onClick={handleCopyFormatted} title="Copy with formatting — paste into Word or Google Docs">⎘ Copy formatted</ToolBtn>
          <ToolBtn onClick={handleDownload} title="Download as .html file">↓ Download</ToolBtn>
          <Divider />
          <ToolBtn active={showSearch} onClick={() => { setShowSearch((v) => { if (!v) setTimeout(() => searchInputRef.current?.focus(), 50); return !v }) }} title="Search & Replace (⌘H)">⌕ Find &amp; Replace</ToolBtn>
        </div>
      )}

      {/* Search & Replace panel */}
      {showSearch && (
        <div style={{ borderBottom: '1px solid #ddd', background: '#fafaf8', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              ref={searchInputRef}
              value={searchVal}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleFindNext() }}
              placeholder="Find…"
              style={{ height: 28, border: '1px solid #d1d0cb', borderRadius: 5, padding: '0 10px', fontSize: 13, outline: 'none', width: 180, background: '#fff', color: '#1a1a1a' }}
            />
            <span style={{ fontSize: 11, color: '#888', minWidth: 60 }}>
              {matchCount > 0 ? `${matchIndex + 1} / ${matchCount}` : searchVal ? '0 results' : ''}
            </span>
            <button onMouseDown={(e) => { e.preventDefault(); handleFindPrev() }} title="Previous" style={{ ...S.btnGhost, padding: '4px 8px', fontSize: 12 }}>↑</button>
            <button onMouseDown={(e) => { e.preventDefault(); handleFindNext() }} title="Next" style={{ ...S.btnGhost, padding: '4px 8px', fontSize: 12 }}>↓</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              value={replaceVal}
              onChange={(e) => { setReplaceVal(e.target.value); searchState.replaceTerm = e.target.value }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleReplaceCurrent() }}
              placeholder="Replace with…"
              style={{ height: 28, border: '1px solid #d1d0cb', borderRadius: 5, padding: '0 10px', fontSize: 13, outline: 'none', width: 180, background: '#fff', color: '#1a1a1a' }}
            />
            <button onMouseDown={(e) => { e.preventDefault(); handleReplaceCurrent() }} style={{ ...S.btnGhost, fontSize: 12 }}>Replace</button>
            <button onMouseDown={(e) => { e.preventDefault(); handleReplaceAll() }} style={{ ...S.btnGhost, fontSize: 12 }}>Replace All</button>
          </div>
          <button onMouseDown={(e) => { e.preventDefault(); setShowSearch(false); handleSearchChange('') }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18, lineHeight: 1 }} title="Close (Esc)">×</button>
        </div>
      )}

      {/* AI score banner */}
      {draft?.humanizerStruggle?.finalScore !== null && draft?.humanizerStruggle?.finalScore !== undefined && (() => {
        const score = draft.humanizerStruggle!.finalScore!
        const bg     = score < 15 ? '#f0fdf4' : score <= 35 ? '#fefce8' : '#fff1f2'
        const color  = score < 15 ? '#15803d' : score <= 35 ? '#a16207' : '#be123c'
        const border = score < 15 ? '#bbf7d0' : score <= 35 ? '#fde68a' : '#fecdd3'
        const label  = score < 15 ? 'Good — light editing needed' : score <= 35 ? 'Moderate — vary sentence structure and add your voice' : 'High — substantial rewriting needed'
        return (
          <div style={{ background: bg, borderBottom: `1px solid ${border}`, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ background: border, border: `1px solid ${color}40`, borderRadius: 9999, padding: '3px 14px', fontSize: 14, color, fontWeight: 700, flexShrink: 0 }}>AI {score}%</span>
            <span style={{ fontSize: 12, color }}>{label}</span>
          </div>
        )
      })()}

      {/* Instruction banner */}
      <div style={S.banner}>
        Review and polish the AI-generated draft below. Keep the word count within ~10% of the original ({originalWords} words). When done, click <strong>Submit</strong>.
      </div>

      {/* Editor + sidebar */}
      <div style={S.editorWrap}>
        <div style={S.editorPane}>
          <EditorContent editor={editor} style={{ display: 'flex', flexDirection: 'column', flex: 1 }} />
        </div>

        {draft && draft.allOutputs.length > 1 && (
          <div style={{ width: 280, overflowY: 'auto', borderLeft: '1px solid #ddd', background: '#eeede9', padding: 16, flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>All Node Outputs</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft.allOutputs.map((o, i) => (
                <button key={o.nodeId}
                  onClick={() => editor?.commands.setContent(plainTextToHtml(o.content))}
                  style={{ border: '1px solid #d1d0cb', background: '#fff', borderRadius: 6, padding: 10, textAlign: 'left', cursor: 'pointer' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#1a1a1a' }}>{o.label ?? `Output ${i + 1}`}</p>
                  <p style={{ fontSize: 11, color: '#777', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const }}>{o.content.slice(0, 120)}…</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={S.footer}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {submitError && <p style={{ fontSize: 13, color: '#dc2626' }}>{submitError}</p>}
          {saveToast && <p style={{ fontSize: 12, color: '#16a34a' }}>Copied to clipboard</p>}
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !editor || editor.isEmpty}
          style={submitting || !editor || editor.isEmpty ? S.btnDisabled : S.btn}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </footer>
    </div>
  )
}
