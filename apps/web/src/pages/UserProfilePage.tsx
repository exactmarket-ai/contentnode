import { useState, useRef, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser, invalidateCurrentUser } from '@/hooks/useCurrentUser'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settingsStore'
import { OLLAMA_MODELS } from '@/components/layout/config/shared'

const ROLE_LABELS: Record<string, string> = {
  owner:          'Owner',
  super_admin:    'Super Admin',
  admin:          'Admin',
  org_admin:      'Org Admin',
  client_manager: 'Client Manager',
  lead:           'Lead',
  editor:         'Editor',
  reviewer:       'Reviewer',
  viewer:         'Viewer',
  member:         'Member',
  api_user:       'API User',
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    if (parts.length === 1 && parts[0].length >= 1) return parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

// ── OllamaModelsSection ───────────────────────────────────────────────────────

function OllamaModelsSection() {
  const { ollamaModels, setOllamaModels } = useSettingsStore()
  const [models, setModels] = useState<string[]>([])
  const [input, setInput]   = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => { setModels(ollamaModels) }, [ollamaModels])

  const isDirty = JSON.stringify(models) !== JSON.stringify(ollamaModels)

  const addModel = () => {
    const v = input.trim()
    if (!v || models.includes(v)) return
    setModels((prev) => [...prev, v])
    setInput('')
  }

  const removeModel = (m: string) => setModels((prev) => prev.filter((x) => x !== m))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/v1/team/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ollamaModels: models }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? `Failed to save (${res.status})`)
        return
      }
      setOllamaModels(models)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const builtInSuggestions = OLLAMA_MODELS.map((m) => m.value).filter((v) => !models.includes(v))

  return (
    <div className="space-y-4 rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Icons.Cpu className="h-4 w-4 text-muted-foreground" />
            Ollama Models
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Models available on your local Ollama server — appear as suggestions in every workflow model picker.
          </p>
        </div>
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50',
              saved ? 'bg-emerald-600' : 'bg-primary',
            )}
          >
            {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Icons.Check className="h-3 w-3" /> : <Icons.Save className="h-3 w-3" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          list="ollama-profile-suggestions"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }}
          placeholder="e.g. llama3.1:70b"
          className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <datalist id="ollama-profile-suggestions">
          {builtInSuggestions.map((v) => <option key={v} value={v} />)}
        </datalist>
        <button
          onClick={addModel}
          disabled={!input.trim()}
          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Icons.Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {models.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No models added — pickers will show built-in suggestions.
        </p>
      ) : (
        <div className="space-y-1.5">
          {models.map((m) => (
            <div key={m} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm font-mono">{m}</span>
              <button onClick={() => removeModel(m)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Icons.X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ── Profile page ──────────────────────────────────────────────────────────────

export function UserProfilePage() {
  const { user, setUser } = useCurrentUser()

  const [name, setName]             = useState('')
  const [title, setTitle]           = useState('')
  const [department, setDepartment] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving]         = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) {
      setName(user.name ?? '')
      setTitle(user.title ?? '')
      setDepartment(user.department ?? '')
      setAvatarPreview(user.avatarUrl ?? null)
    }
  }, [user])

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const handleRemoveAvatar = async () => {
    setAvatarPreview(null)
    setAvatarFile(null)
    if (user?.avatarUrl) {
      await apiFetch('/api/v1/team/me/avatar', { method: 'DELETE' })
      invalidateCurrentUser()
      if (setUser) setUser((prev) => prev ? { ...prev, avatarUrl: null } : prev)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Upload avatar first if changed
      if (avatarFile) {
        setUploadingAvatar(true)
        const form = new FormData()
        form.append('file', avatarFile)
        const res = await apiFetch('/api/v1/team/me/avatar', { method: 'POST', body: form })
        const { data } = await res.json()
        setAvatarPreview(data.avatarUrl)
        setAvatarFile(null)
        setUploadingAvatar(false)
      }

      // Update profile fields
      const res = await apiFetch('/api/v1/team/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), title: title.trim(), department: department.trim() }),
      })
      const { data } = await res.json()

      invalidateCurrentUser()
      if (setUser) setUser(data)

      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
      setUploadingAvatar(false)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const initials = getInitials(user.name, user.email)

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Your Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How you appear to teammates and in the app
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Avatar section */}
        <div className="flex items-center gap-6">
          <div className="relative group">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt={user.name ?? user.email}
                className="h-24 w-24 rounded-full object-cover border-2 border-border"
              />
            ) : (
              <div className="h-24 w-24 rounded-full flex items-center justify-center text-2xl font-bold border-2 border-border bg-muted text-muted-foreground">
                {initials}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              <Icons.Camera className="h-6 w-6 text-white" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                {uploadingAvatar ? (
                  <span className="flex items-center gap-1.5"><Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading…</span>
                ) : 'Change photo'}
              </button>
              {(avatarPreview || user.avatarUrl) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG, GIF or WebP · max 5 MB</p>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <input
                type="text"
                value={user.email}
                readOnly
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
              />
              <p className="text-[10px] text-muted-foreground">Managed by your sign-in provider</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Job title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lead Content Strategist"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Department</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Content, Marketing"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
              <span className="text-xs text-muted-foreground">Assigned by your organization admin</span>
            </div>
          </div>
        </div>

        {/* Account info */}
        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account</p>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Member since</span>
            <span>{new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span className="text-muted-foreground">User ID</span>
            <span className="font-mono text-xs text-muted-foreground">{user.id}</span>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}

            className={cn(
              'flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors',
              saved
                ? 'bg-emerald-600 text-white'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              saving && 'opacity-60 cursor-not-allowed',
            )}
          >
            {saving && <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saved ? (
              <><Icons.Check className="h-3.5 w-3.5" />Saved</>
            ) : 'Save changes'}
          </button>
        </div>
      </form>

      {/* Ollama Models — separate save, outside the main form */}
      <OllamaModelsSection />
    </div>
  )
}
