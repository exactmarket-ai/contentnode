import { useEffect, useRef, useState } from 'react'

export interface DimensionItem {
  id: string
  name: string
  dimensionType: string
}

interface DimensionBarProps {
  items: DimensionItem[]
  selected: Record<string, string>
  onChange: (type: string, id: string) => void
  loading?: boolean
  verticalTerm?: string
  children?: React.ReactNode
}

const TYPE_PRIORITY = ['vertical', 'solution', 'partner', 'country']

function typeLabel(type: string, verticalTerm?: string): string {
  if (type === 'vertical') return verticalTerm ?? 'Vertical'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function TypeDropdown({ label, items, selectedId, onChange }: {
  label: string
  items: DimensionItem[]
  selectedId: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = items.find((i) => i.id === selectedId) ?? null

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">{label}</span>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-[120px] items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted/40"
        >
          <span className="flex-1 truncate font-medium">{selected ? selected.name : 'Company'}</span>
          <svg className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover shadow-xl"
            style={{ backgroundColor: 'hsl(var(--popover))' }}
          >
            <div className="max-h-48 overflow-y-auto p-1">
              <button
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                onClick={() => { onChange(''); setOpen(false) }}
              >
                {!selectedId && <span className="text-blue-500">✓</span>}
                <span className={!selectedId ? '' : 'ml-4'}>Company</span>
              </button>
              {[...items].sort((a, b) => a.name.localeCompare(b.name)).map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                  onClick={() => { onChange(item.id); setOpen(false) }}
                >
                  {selectedId === item.id && <span className="text-blue-500">✓</span>}
                  <span className={selectedId === item.id ? '' : 'ml-4'}>{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function DimensionBar({ items, selected, onChange, loading, verticalTerm, children }: DimensionBarProps) {
  const byType = new Map<string, DimensionItem[]>()
  for (const item of items) {
    if (!byType.has(item.dimensionType)) byType.set(item.dimensionType, [])
    byType.get(item.dimensionType)!.push(item)
  }

  const types = [...byType.keys()].sort((a, b) => {
    const ai = TYPE_PRIORITY.indexOf(a)
    const bi = TYPE_PRIORITY.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border bg-background px-5 py-3">
      {loading ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
      ) : types.length === 0 ? (
        <>
          <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">{verticalTerm ?? 'Vertical'}</span>
          <span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">Company</span>
        </>
      ) : (
        types.map((type) => (
          <TypeDropdown
            key={type}
            label={typeLabel(type, verticalTerm)}
            items={byType.get(type)!}
            selectedId={selected[type] ?? ''}
            onChange={(id) => onChange(type, id)}
          />
        ))
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  )
}
