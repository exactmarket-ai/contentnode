import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FieldGroup } from '../shared'

const TRANSLATE_LANGUAGES = [
  { value: 'EN-GB',  label: 'English (UK)' },
  { value: 'EN-US',  label: 'English (US)' },
  { value: 'ES',     label: 'Spanish' },
  { value: 'FR',     label: 'French' },
  { value: 'DE',     label: 'German' },
  { value: 'IT',     label: 'Italian' },
  { value: 'PT-BR',  label: 'Portuguese (BR)' },
  { value: 'PT-PT',  label: 'Portuguese (EU)' },
  { value: 'NL',     label: 'Dutch' },
  { value: 'PL',     label: 'Polish' },
  { value: 'RU',     label: 'Russian' },
  { value: 'JA',     label: 'Japanese' },
  { value: 'ZH',     label: 'Chinese' },
  { value: 'KO',     label: 'Korean' },
  { value: 'AR',     label: 'Arabic' },
  { value: 'SV',     label: 'Swedish' },
  { value: 'DA',     label: 'Danish' },
  { value: 'FI',     label: 'Finnish' },
  { value: 'NB',     label: 'Norwegian' },
]

// DeepL supports formality for these target languages
const DEEPL_FORMALITY_LANGS = new Set([
  'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT-BR', 'PT-PT', 'RU', 'JA',
])

export function TranslateConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const targetLanguage = (config.target_language as string) ?? 'ES'
  const sourceLanguage = (config.source_language as string) ?? 'auto'
  const provider = (config.provider as string) ?? 'deepl'
  const formality = (config.formality as string) ?? 'default'
  const preserveFormatting = (config.preserve_formatting as boolean) ?? true

  const showFormality = provider === 'deepl' && DEEPL_FORMALITY_LANGS.has(targetLanguage)

  return (
    <>
      <FieldGroup label="Target Language">
        <Select value={targetLanguage} onValueChange={(v) => onChange('target_language', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRANSLATE_LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value} className="text-xs">
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Source Language">
        <Select value={sourceLanguage} onValueChange={(v) => onChange('source_language', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto" className="text-xs text-muted-foreground">Auto-detect</SelectItem>
            {TRANSLATE_LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value} className="text-xs">
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Provider">
        <Select value={provider} onValueChange={(v) => onChange('provider', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="deepl" className="text-xs">DeepL</SelectItem>
            <SelectItem value="google" className="text-xs">Google Translate</SelectItem>
          </SelectContent>
        </Select>
      </FieldGroup>

      {showFormality && (
        <FieldGroup label="Formality">
          <Select value={formality} onValueChange={(v) => onChange('formality', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-xs">Default</SelectItem>
              <SelectItem value="prefer_more" className="text-xs">More formal</SelectItem>
              <SelectItem value="prefer_less" className="text-xs">Less formal</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      )}

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Preserve Formatting</Label>
        <button
          type="button"
          role="switch"
          aria-checked={preserveFormatting}
          onClick={() => onChange('preserve_formatting', !preserveFormatting)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none',
            preserveFormatting ? 'bg-blue-600' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform',
              preserveFormatting ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Charged per character. Usage tracked in Usage &gt; Translation.
      </p>
    </>
  )
}
