// Shared UI components reused across PM views.
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Member } from './types'

export function Avatar({
  user,
  size = 'sm',
}: {
  user: { name: string | null; avatarStorageKey: string | null } | null
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!user) return null
  const dims = size === 'lg' ? 'h-8 w-8 text-xs' : size === 'md' ? 'h-6 w-6 text-[10px]' : 'h-5 w-5 text-[9px]'
  const initials = user.name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  if (user.avatarStorageKey) {
    return (
      <img
        src={user.avatarStorageKey}
        alt={user.name ?? ''}
        className={cn(dims, 'rounded-full object-cover border border-border shrink-0')}
        title={user.name ?? ''}
      />
    )
  }
  return (
    <div
      className={cn(dims, 'rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-semibold shrink-0')}
      title={user.name ?? ''}
    >
      {initials}
    </div>
  )
}

export function AssigneePicker({
  current,
  members,
  onAssign,
  size = 'sm',
}: {
  current: { id: string; name: string | null; avatarStorageKey: string | null } | null
  members: Member[]
  onAssign: (m: Member | null) => void
  size?: 'sm' | 'md'
}) {
  const [open, setOpen]     = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current!.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const initials = (name: string | null) =>
    name?.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  const btnDims = size === 'md' ? 'h-7 w-7' : 'h-5 w-5'

  const dropdown = open && coords
    ? createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 }}
          className="w-52 rounded-xl border border-gray-200 bg-white shadow-2xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assign to</p>
          {current && (
            <button
              onClick={() => { onAssign(null); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50"
            >
              <Icons.UserMinus className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          <div className="max-h-52 overflow-y-auto">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => { onAssign(m); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                  current?.id === m.id ? 'bg-blue-50' : 'hover:bg-gray-50',
                )}
              >
                <div className={cn('h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold', current?.id === m.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600')}>
                  {m.avatarStorageKey
                    ? <img src={m.avatarStorageKey} alt="" className="h-full w-full rounded-full object-cover" />
                    : initials(m.name)}
                </div>
                <span className="text-[11px] font-medium truncate">{m.name ?? m.email}</span>
                {current?.id === m.id && <Icons.Check className="h-3 w-3 text-blue-500 ml-auto" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title={current ? `${current.name ?? 'Assigned'} — click to change` : 'Assign someone'}
        className={cn(
          'flex items-center justify-center rounded-full border transition-all shrink-0 hover:ring-2 hover:ring-blue-400 hover:ring-offset-1',
          btnDims,
          current
            ? 'bg-blue-500 border-blue-500 text-white'
            : 'border-dashed border-gray-300 text-gray-400 hover:border-blue-400',
        )}
      >
        {current
          ? (current.avatarStorageKey
              ? <img src={current.avatarStorageKey} alt="" className="h-full w-full rounded-full object-cover" />
              : <span className="text-[9px] font-bold">{initials(current.name)}</span>)
          : <Icons.Plus className="h-2.5 w-2.5" />}
      </button>
      {dropdown}
    </>
  )
}
