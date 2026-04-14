import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'

const SYNTHESIS_GOALS = [
  { value: 'pain_points', label: 'Pain Points' },
  { value: 'vocabulary', label: 'Vocabulary Map' },
  { value: 'objections', label: 'Objection Map' },
  { value: 'questions', label: 'Question Map (Content Ideas)' },
  { value: 'all', label: 'Full Audience Analysis' },
]

export function AudienceSignalConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  return (
    <>
      <FieldGroup label="Search Terms" description="One per line — what your audience would search for">
        <Textarea
          placeholder={'B2B marketing automation\nSaaS onboarding problems\nHubSpot alternatives'}
          className="text-xs min-h-[72px] font-mono"
          value={(config.searchTerms as string) ?? ''}
          onChange={(e) => onChange('searchTerms', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Subreddits (optional)" description="One per line — leave blank to search all of Reddit">
        <Textarea
          placeholder={'marketing\nentrepreneur\nSaaS'}
          className="text-xs min-h-[60px] font-mono"
          value={(config.subreddits as string) ?? ''}
          onChange={(e) => onChange('subreddits', e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">Without r/ prefix</p>
      </FieldGroup>

      <FieldGroup label="Max Posts to Analyze">
        <Input
          type="number"
          min={5}
          max={50}
          className="text-xs"
          value={(config.maxPosts as number) ?? 25}
          onChange={(e) => onChange('maxPosts', parseInt(e.target.value, 10) || 25)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">5–50 posts</p>
      </FieldGroup>

      <FieldGroup label="Min Upvotes to Include" description="Filter out low-signal posts">
        <Input
          type="number"
          min={1}
          className="text-xs"
          value={(config.minUpvotes as number) ?? 5}
          onChange={(e) => onChange('minUpvotes', parseInt(e.target.value, 10) || 5)}
        />
      </FieldGroup>

      <FieldGroup label="Analysis Goal">
        <Select
          value={(config.synthesisGoal as string) ?? 'all'}
          onValueChange={(v) => onChange('synthesisGoal', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNTHESIS_GOALS.map((g) => (
              <SelectItem key={g.value} value={g.value} className="text-xs">
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <div className="rounded-md bg-muted/30 border border-border p-2.5 mt-1">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Uses Reddit's public API — no API key required. Searches top posts from the past year. Fetches top comments from each post for deeper signal.
        </p>
      </div>
    </>
  )
}
