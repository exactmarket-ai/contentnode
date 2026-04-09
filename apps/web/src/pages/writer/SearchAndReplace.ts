import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'

export interface Match { from: number; to: number }

export interface SearchState {
  searchTerm: string
  replaceTerm: string
  currentIndex: number
  results: Match[]
}

// Shared state — one writer per page, no multi-instance concerns
export const searchState: SearchState = {
  searchTerm: '',
  replaceTerm: '',
  currentIndex: 0,
  results: [],
}

export const searchPluginKey = new PluginKey<DecorationSet>('searchReplace')

function collectMatches(doc: PmNode, term: string): Match[] {
  const out: Match[] = []
  if (!term) return out
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(node.text)) !== null) {
      out.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return out
}

function buildDecos(doc: PmNode, results: Match[], cur: number): DecorationSet {
  return DecorationSet.create(
    doc,
    results.map((r, i) =>
      Decoration.inline(r.from, r.to, {
        style: i === cur
          ? 'background:#fde68a;border-radius:2px;outline:2px solid #f59e0b'
          : 'background:#fef9c3;border-radius:2px',
      })
    )
  )
}

export const SearchAndReplaceExtension = Extension.create({
  name: 'searchAndReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(searchPluginKey)
            if (meta !== undefined || tr.docChanged) {
              const results = collectMatches(tr.doc, searchState.searchTerm)
              searchState.results = results
              return buildDecos(tr.doc, results, searchState.currentIndex)
            }
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations: (state) => searchPluginKey.getState(state),
        },
      }),
    ]
  },
})

// Helper functions called directly from the UI

export function srSetSearch(term: string, dispatch: (meta: unknown) => void) {
  searchState.searchTerm = term
  searchState.currentIndex = 0
  dispatch({ search: true })
}

export function srNext(dispatch: (meta: unknown) => void) {
  if (!searchState.results.length) return
  searchState.currentIndex = (searchState.currentIndex + 1) % searchState.results.length
  dispatch({ move: true })
}

export function srPrev(dispatch: (meta: unknown) => void) {
  if (!searchState.results.length) return
  searchState.currentIndex = (searchState.currentIndex - 1 + searchState.results.length) % searchState.results.length
  dispatch({ move: true })
}
