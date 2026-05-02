import { useState, useRef, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser, invalidateCurrentUser } from '@/hooks/useCurrentUser'
import { cn } from '@/lib/utils'
import { useSettingsStore, type LocalMediaService, type LocalMediaServiceType } from '@/store/settingsStore'
import { OLLAMA_MODELS } from '@/components/layout/config/shared'

const ROLE_LABELS: Record<string, string> = {
  owner:    'Owner',
  admin:    'Admin',
  org_admin: 'Org Admin',
  editor:   'Editor',
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
  const [showInstructions, setShowInstructions] = useState(false)

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
            Models installed on your local Ollama server — appear in every workflow model picker.
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

      {/* Instructions */}
      <button
        onClick={() => setShowInstructions((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icons.HelpCircle className="h-3.5 w-3.5" />
        {showInstructions ? 'Hide setup instructions' : 'How to set up Ollama'}
        <Icons.ChevronDown className={cn('h-3 w-3 transition-transform', showInstructions && 'rotate-180')} />
      </button>

      {showInstructions && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-xs">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">1. Install Ollama</p>
            <p className="text-muted-foreground">Download and install from <span className="font-mono bg-muted px-1 rounded">ollama.com</span> — available for Mac, Windows, and Linux.</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">2. Start the server</p>
            <p className="text-muted-foreground">Ollama runs automatically on Mac after install. On other systems, run:</p>
            <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px]">ollama serve</code>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">3. Pull a model</p>
            <p className="text-muted-foreground">Open your terminal and run one of these to download a model:</p>
            <div className="space-y-1">
              <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px]">ollama pull llama3.1:8b</code>
              <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px]">ollama pull gemma3:12b</code>
              <code className="block bg-muted rounded px-2 py-1 font-mono text-[11px]">ollama pull mistral</code>
            </div>
            <p className="text-muted-foreground mt-1">Browse all available models at <span className="font-mono bg-muted px-1 rounded">ollama.com/library</span></p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">4. Add the model name here</p>
            <p className="text-muted-foreground">Type the exact model name (e.g. <span className="font-mono bg-muted px-1 rounded">llama3.1:8b</span>) into the field below and click Add. It will then appear in all model dropdowns across ContentNode.</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <p className="font-medium">Note on hardware</p>
            <p className="mt-0.5 text-amber-700">Larger models (70B+) require significant RAM or VRAM. Start with 7B–12B models if you're unsure about your machine's capacity.</p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          list="ollama-profile-suggestions"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }}
          placeholder="e.g. llama3.1:8b"
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
          No models added — pickers will show built-in suggestions only.
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

// ── LocalMediaServicesSection ─────────────────────────────────────────────────

const SERVICE_TYPE_META: Record<LocalMediaServiceType, { label: string; icon: keyof typeof Icons; defaultUrl: string; description: string; instructions: { title: string; steps: Array<{ label: string; code?: string; note?: string }> } }> = {
  'tts': {
    label: 'Text-to-Speech',
    icon: 'Mic',
    defaultUrl: 'http://localhost:5002',
    description: 'Local TTS engine — converts generated text to audio',
    instructions: {
      title: 'Setting up a local TTS server',
      steps: [
        { label: 'Install Coqui TTS (recommended)', code: 'pip install TTS' },
        { label: 'Start the server on port 5002', code: 'tts-server --port 5002 --use_cuda false' },
        { label: 'Verify it\'s running', code: 'curl http://localhost:5002/api/tts?text=hello', note: 'Should return an audio file' },
        { label: 'Alternative: Piper TTS', note: 'Download from github.com/rhasspy/piper — faster, lower memory, great for production. Runs on port 5000 by default.' },
      ],
    },
  },
  'image-gen': {
    label: 'Image Generation',
    icon: 'Image',
    defaultUrl: 'http://localhost:7860',
    description: 'Local Stable Diffusion server for image creation',
    instructions: {
      title: 'Setting up local image generation',
      steps: [
        { label: 'Option A: AUTOMATIC1111 (most popular)', code: 'git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui\ncd stable-diffusion-webui && ./webui.sh --api', note: 'Runs on port 7860. The --api flag enables the REST API that ContentNode uses.' },
        { label: 'Option B: ComfyUI (more flexible)', code: 'git clone https://github.com/comfyanonymous/ComfyUI\ncd ComfyUI && python main.py', note: 'Runs on port 8188 by default.' },
        { label: 'Download a model checkpoint', note: 'Place .safetensors model files in stable-diffusion-webui/models/Stable-diffusion/. Download from civitai.com or huggingface.co.' },
        { label: 'Verify the API is live', code: 'curl http://localhost:7860/sdapi/v1/sd-models', note: 'Should return a list of loaded models.' },
      ],
    },
  },
  'character-animation': {
    label: 'Character Animation',
    icon: 'Video',
    defaultUrl: 'http://localhost:7860',
    description: 'Local talking-head / avatar animation (SadTalker, Wav2Lip)',
    instructions: {
      title: 'Setting up local character animation',
      steps: [
        { label: 'Option A: SadTalker (recommended)', code: 'git clone https://github.com/OpenTalker/SadTalker\ncd SadTalker\npip install -r requirements.txt\npython app_sadtalker.py', note: 'Launches a Gradio interface on port 7860. Uses a portrait image + audio to generate a talking video.' },
        { label: 'Download SadTalker checkpoints', code: 'bash scripts/download_models.sh', note: 'Run from inside the SadTalker directory. Downloads ~2 GB of model weights.' },
        { label: 'Option B: Wav2Lip', code: 'git clone https://github.com/Rudrabha/Wav2Lip\ncd Wav2Lip && pip install -r requirements.txt', note: 'Better lip sync accuracy. Requires CUDA GPU. Run the inference script directly rather than a server — contact support for integration details.' },
        { label: 'Hardware note', note: 'Character animation models are GPU-intensive. A dedicated NVIDIA GPU with 8 GB+ VRAM is strongly recommended for real-time or batch use.' },
      ],
    },
  },
  'transcription': {
    label: 'Transcription',
    icon: 'FileAudio',
    defaultUrl: 'http://localhost:8000',
    description: 'Local Whisper server — audio-to-text without sending audio to the cloud',
    instructions: {
      title: 'Setting up a local Whisper transcription server',
      steps: [
        { label: 'Option A: faster-whisper-server (recommended)', code: 'pip install faster-whisper-server\nuvicorn faster_whisper_server.main:app --port 8000', note: 'OpenAI-compatible API. Runs the large-v3 model by default.' },
        { label: 'Option B: whisper.cpp (lowest memory use)', code: 'git clone https://github.com/ggerganov/whisper.cpp\ncd whisper.cpp && make\nbash ./models/download-ggml-model.sh base.en\n./server -m models/ggml-base.en.bin --port 8080', note: 'No GPU required. Very fast on Apple Silicon via Metal.' },
        { label: 'Verify transcription is working', code: 'curl http://localhost:8000/v1/audio/transcriptions \\\n  -F file=@sample.mp3 \\\n  -F model=whisper-1', note: 'Compatible with OpenAI\'s transcription API format.' },
        { label: 'Model size guide', note: 'tiny/base = fast, lower accuracy. small/medium = good balance. large-v3 = highest accuracy, needs 10 GB+ RAM.' },
      ],
    },
  },
}

function InstructionPanel({ type }: { type: LocalMediaServiceType }) {
  const meta = SERVICE_TYPE_META[type]
  const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-xs">
      <p className="font-semibold text-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {meta.instructions.title}
      </p>
      {meta.instructions.steps.map((step, i) => (
        <div key={i} className="space-y-1">
          <p className="font-medium text-foreground">{i + 1}. {step.label}</p>
          {step.code && (
            <pre className="bg-muted rounded px-2 py-1.5 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">{step.code}</pre>
          )}
          {step.note && <p className="text-muted-foreground">{step.note}</p>}
        </div>
      ))}
    </div>
  )
}

function LocalMediaServicesSection() {
  const { localMediaServices, setLocalMediaServices } = useSettingsStore()
  const [services, setServices] = useState<LocalMediaService[]>([])
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Add form state
  const [addType, setAddType]   = useState<LocalMediaServiceType>('tts')
  const [addLabel, setAddLabel] = useState('')
  const [addUrl, setAddUrl]     = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [showInstructions, setShowInstructions] = useState<LocalMediaServiceType | null>(null)
  const [expandedInstructions, setExpandedInstructions] = useState<LocalMediaServiceType | null>(null)

  useEffect(() => { setServices(localMediaServices) }, [localMediaServices])

  const isDirty = JSON.stringify(services) !== JSON.stringify(localMediaServices)

  const openAdd = (type: LocalMediaServiceType) => {
    setAddType(type)
    setAddLabel('')
    setAddUrl(SERVICE_TYPE_META[type].defaultUrl)
    setShowAdd(true)
    setShowInstructions(null)
  }

  const addService = () => {
    const url = addUrl.trim()
    const label = addLabel.trim() || SERVICE_TYPE_META[addType].label
    if (!url.startsWith('http')) return
    const newService: LocalMediaService = {
      id: crypto.randomUUID(),
      type: addType,
      label,
      url,
    }
    setServices((prev) => [...prev, newService])
    setShowAdd(false)
    setAddLabel('')
    setAddUrl('')
  }

  const removeService = (id: string) => setServices((prev) => prev.filter((s) => s.id !== id))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/v1/team/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localMediaServices: services }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? `Failed to save (${res.status})`)
        return
      }
      setLocalMediaServices(services)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const serviceTypes: LocalMediaServiceType[] = ['tts', 'image-gen', 'character-animation', 'transcription']

  return (
    <div className="space-y-4 rounded-xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Icons.Server className="h-4 w-4 text-muted-foreground" />
            Local Media Services
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Register locally-running AI services for audio, video, and image generation — no data leaves your machine.
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

      {/* Service type cards — quick add buttons */}
      <div className="grid grid-cols-2 gap-2">
        {serviceTypes.map((type) => {
          const meta = SERVICE_TYPE_META[type]
          const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
          const count = services.filter((s) => s.type === type).length
          return (
            <div key={type} className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium leading-snug">{meta.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">{meta.description}</p>
                  </div>
                </div>
                {count > 0 && (
                  <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{count}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => openAdd(type)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Icons.Plus className="h-3 w-3" />
                  Add
                </button>
                <button
                  onClick={() => setExpandedInstructions(expandedInstructions === type ? null : type)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground border border-border transition-colors"
                >
                  <Icons.BookOpen className="h-3 w-3" />
                  Setup guide
                </button>
              </div>
              {expandedInstructions === type && <InstructionPanel type={type} />}
            </div>
          )
        })}
      </div>

      {/* Add service form */}
      {showAdd && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-semibold">
            Add {SERVICE_TYPE_META[addType].label} service
          </p>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Label (optional)</label>
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder={SERVICE_TYPE_META[addType].label}
                className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Local URL</label>
              <input
                autoFocus
                type="text"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addService(); if (e.key === 'Escape') setShowAdd(false) }}
                placeholder={SERVICE_TYPE_META[addType].defaultUrl}
                className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs font-mono outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground">
                Default for {SERVICE_TYPE_META[addType].label}: <span className="font-mono">{SERVICE_TYPE_META[addType].defaultUrl}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addService}
              disabled={!addUrl.trim().startsWith('http')}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Icons.Plus className="h-3.5 w-3.5" />
              Add service
            </button>
            <button
              onClick={() => { setShowAdd(false); setShowInstructions(null) }}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowInstructions(showInstructions === addType ? null : addType)}
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icons.HelpCircle className="h-3 w-3" />
              {showInstructions === addType ? 'Hide guide' : 'How to install'}
            </button>
          </div>
          {showInstructions === addType && <InstructionPanel type={addType} />}
        </div>
      )}

      {/* Registered services list */}
      {services.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No local services registered yet. Add one above to enable offline media processing.
        </p>
      ) : (
        <div className="space-y-1.5">
          {services.map((s) => {
            const meta = SERVICE_TYPE_META[s.type]
            const Icon = Icons[meta.icon] as React.ComponentType<{ className?: string }>
            return (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 gap-3">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{s.url}</p>
                </div>
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium border border-border text-muted-foreground">
                  {meta.label}
                </span>
                <button onClick={() => removeService(s.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                  <Icons.X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
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
    <div className="flex flex-col h-full overflow-y-auto">
    <div className="mx-auto max-w-2xl w-full px-6 py-10 space-y-8">
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

      {/* Local AI sections — separate saves, outside the main form */}
      <OllamaModelsSection />
      <LocalMediaServicesSection />
    </div>
    </div>
  )
}
