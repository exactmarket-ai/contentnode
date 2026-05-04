import React, { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { useVerticalTerm, invalidateVerticalTerm } from '@/hooks/useVerticalTerm'

interface VerticalItem { id: string; name: string; dimensionType: string; parentVerticalId?: string | null }

export function GtmVerticalsCard({ clientId, hideUnassigned = false }: { clientId: string; hideUnassigned?: boolean }) {
  const verticalTerm = useVerticalTerm()
  const [allVerticals, setAllVerticals] = useState<VerticalItem[]>([])
  const [clientVerticals, setClientVerticals] = useState<VerticalItem[]>([])
  const [newVerticalName, setNewVerticalName] = useState('')
  const [newVerticalDimType, setNewVerticalDimType] = useState('vertical')
  const [newVerticalParentId, setNewVerticalParentId] = useState('')
  const [addingVertical, setAddingVertical] = useState(false)
  const [renamingVerticalId, setRenamingVerticalId] = useState<string | null>(null)
  const [renamingVerticalName, setRenamingVerticalName] = useState('')
  const [editingVerticalTerm, setEditingVerticalTerm] = useState(false)
  const [verticalTermDraft, setVerticalTermDraft] = useState('')
  const [savingVerticalTerm, setSavingVerticalTerm] = useState(false)

  useEffect(() => {
    const fetches = hideUnassigned
      ? [apiFetch(`/api/v1/clients/${clientId}/verticals`).then((r) => r.json())]
      : [
          apiFetch('/api/v1/verticals').then((r) => r.json()),
          apiFetch(`/api/v1/clients/${clientId}/verticals`).then((r) => r.json()),
        ]
    Promise.all(fetches)
      .then((results) => {
        if (hideUnassigned) {
          setClientVerticals(results[0].data ?? [])
        } else {
          setAllVerticals(results[0].data ?? [])
          setClientVerticals(results[1].data ?? [])
        }
      })
      .catch(() => {})
  }, [clientId, hideUnassigned])

  const saveVerticalTerm = async () => {
    const trimmed = verticalTermDraft.trim()
    if (!trimmed) return
    setSavingVerticalTerm(true)
    try {
      await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verticalTerm: trimmed }),
      })
      invalidateVerticalTerm()
      setEditingVerticalTerm(false)
    } catch { /* silent */ } finally {
      setSavingVerticalTerm(false)
    }
  }

  const handleCreateVertical = async () => {
    const name = newVerticalName.trim()
    if (!name) return
    const res = await apiFetch('/api/v1/verticals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        dimensionType: newVerticalDimType,
        ...(newVerticalDimType !== 'vertical' && newVerticalParentId ? { parentVerticalId: newVerticalParentId } : {}),
      }),
    })
    if (!res.ok) return
    const { data } = await res.json()
    setAllVerticals((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    await apiFetch(`/api/v1/clients/${clientId}/verticals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verticalId: data.id }),
    })
    setClientVerticals((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewVerticalName('')
    setNewVerticalDimType('vertical')
    setNewVerticalParentId('')
    setAddingVertical(false)
  }

  const handleRenameVertical = async (v: VerticalItem) => {
    const name = renamingVerticalName.trim()
    if (!name || name === v.name) { setRenamingVerticalId(null); return }
    const res = await apiFetch(`/api/v1/verticals/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { setRenamingVerticalId(null); return }
    const { data } = await res.json()
    const updateList = (prev: VerticalItem[]) =>
      prev.map((x) => x.id === v.id ? data : x).sort((a, b) => a.name.localeCompare(b.name))
    setAllVerticals(updateList)
    setClientVerticals(updateList)
    setRenamingVerticalId(null)
  }

  const handleDeleteVertical = async (v: VerticalItem) => {
    if (!confirm(`Delete vertical "${v.name}"? All GTM framework data for this vertical across all clients will be lost.`)) return
    await apiFetch(`/api/v1/verticals/${v.id}`, { method: 'DELETE' })
    setAllVerticals((prev) => prev.filter((x) => x.id !== v.id))
    setClientVerticals((prev) => prev.filter((x) => x.id !== v.id))
  }

  const handleAssignVertical = async (v: VerticalItem) => {
    const res = await apiFetch(`/api/v1/clients/${clientId}/verticals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verticalId: v.id }),
    })
    if (!res.ok) return
    setClientVerticals((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const handleUnassignVertical = async (v: VerticalItem) => {
    await apiFetch(`/api/v1/clients/${clientId}/verticals/${v.id}`, { method: 'DELETE' })
    setClientVerticals((prev) => prev.filter((x) => x.id !== v.id))
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">GTM {verticalTerm}s</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Markets this client operates in. Each {verticalTerm.toLowerCase()} gets its own GTM Framework.</p>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAddingVertical(true)}
        >
          <Icons.Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Rename vertical term */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Term name:</span>
        {editingVerticalTerm ? (
          <>
            <input
              autoFocus
              value={verticalTermDraft}
              onChange={(e) => setVerticalTermDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveVerticalTerm(); if (e.key === 'Escape') setEditingVerticalTerm(false) }}
              className="h-6 rounded border border-border bg-background px-2 text-xs focus:border-blue-400 focus:outline-none"
            />
            <button
              disabled={savingVerticalTerm || !verticalTermDraft.trim()}
              onClick={() => void saveVerticalTerm()}
              className="text-[11px] text-blue-500 hover:text-blue-700 disabled:opacity-50"
            >
              {savingVerticalTerm ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditingVerticalTerm(false)} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </>
        ) : (
          <button
            onClick={() => { setVerticalTermDraft(verticalTerm); setEditingVerticalTerm(true) }}
            className="flex items-center gap-1 text-[11px] font-medium text-foreground hover:text-blue-500"
          >
            {verticalTerm}
            <Icons.Pencil className="h-2.5 w-2.5 opacity-50" />
          </button>
        )}
      </div>

      {/* Add new vertical inline */}
      {addingVertical && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={newVerticalDimType}
              onChange={(e) => { setNewVerticalDimType(e.target.value); setNewVerticalParentId('') }}
              className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:border-blue-400"
            >
              <option value="vertical">{verticalTerm}</option>
              <option value="solution">Solution</option>
              <option value="partner">Partner</option>
              <option value="country">Country</option>
            </select>
            <Input
              autoFocus
              value={newVerticalName}
              onChange={(e) => setNewVerticalName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateVertical(); if (e.key === 'Escape') { setAddingVertical(false); setNewVerticalName(''); setNewVerticalDimType('vertical'); setNewVerticalParentId('') } }}
              placeholder={`${newVerticalDimType === 'vertical' ? verticalTerm : newVerticalDimType.charAt(0).toUpperCase() + newVerticalDimType.slice(1)} name`}
              className="h-7 flex-1 text-xs"
            />
            <Button size="sm" className="h-7 text-xs px-3" onClick={() => void handleCreateVertical()}>Add</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setAddingVertical(false); setNewVerticalName(''); setNewVerticalDimType('vertical'); setNewVerticalParentId('') }}>Cancel</Button>
          </div>
          {newVerticalDimType !== 'vertical' && (() => {
            const parentCandidates = [...allVerticals, ...clientVerticals]
              .filter((v, i, arr) => v.dimensionType === 'vertical' && arr.findIndex((x) => x.id === v.id) === i)
            if (parentCandidates.length === 0) return null
            return (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">Belongs to {verticalTerm}:</span>
                <select
                  value={newVerticalParentId}
                  onChange={(e) => setNewVerticalParentId(e.target.value)}
                  className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:border-blue-400"
                >
                  <option value="">— None (show in all contexts) —</option>
                  {parentCandidates.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )
          })()}
        </div>
      )}

      {/* Assigned verticals */}
      {clientVerticals.length === 0 && !addingVertical && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">No verticals assigned yet.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Add a vertical to unlock the GTM Framework tab for this client.</p>
        </div>
      )}

      <div className="space-y-1.5">
        {clientVerticals.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Icons.Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {renamingVerticalId === v.id ? (
              <Input
                autoFocus
                value={renamingVerticalName}
                onChange={(e) => setRenamingVerticalName(e.target.value)}
                onBlur={() => void handleRenameVertical(v)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameVertical(v); if (e.key === 'Escape') setRenamingVerticalId(null) }}
                className="h-6 flex-1 text-xs"
              />
            ) : (
              <span className="flex-1 text-sm font-medium">{v.name}</span>
            )}
            {renamingVerticalId !== v.id && (
              <div className="flex items-center gap-0.5">
                <span className="mr-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {v.dimensionType === 'vertical' ? verticalTerm : v.dimensionType.charAt(0).toUpperCase() + v.dimensionType.slice(1)}
                </span>
                {v.parentVerticalId && (
                  <span className="mr-1 text-[10px] text-muted-foreground">
                    {[...allVerticals, ...clientVerticals].find((p) => p.id === v.parentVerticalId)?.name ?? ''}
                  </span>
                )}
                <Button
                  variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => { setRenamingVerticalId(v.id); setRenamingVerticalName(v.name) }}
                  title="Rename"
                >
                  <Icons.Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                  onClick={() => void handleDeleteVertical(v)}
                  title="Delete vertical entirely"
                >
                  <Icons.Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Other available verticals to assign */}
      {!hideUnassigned && allVerticals.filter((v) => !clientVerticals.find((cv) => cv.id === v.id)).length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] text-muted-foreground">Other verticals — click to assign:</p>
          <div className="flex flex-wrap gap-1.5">
            {allVerticals
              .filter((v) => !clientVerticals.find((cv) => cv.id === v.id))
              .map((v) => (
                <button
                  key={v.id}
                  onClick={() => void handleAssignVertical(v)}
                  className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                >
                  + {v.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
