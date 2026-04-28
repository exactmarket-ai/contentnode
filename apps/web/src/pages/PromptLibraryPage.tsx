import React from 'react'
import * as Icons from 'lucide-react'

// These components are defined in ClientDetailPage and exported for reuse here.
// They accept an optional clientId; when omitted they operate on the agency-level
// global templates / global image prompts.
import { AgencyPromptLibrary } from './ClientDetailPage'

export function PromptLibraryPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Icons.BookOpen className="h-5 w-5" style={{ color: '#a200ee' }} />
          <h1 className="text-xl font-semibold" style={{ color: '#1a1a14' }}>Prompt Library</h1>
        </div>
        <AgencyPromptLibrary />
      </div>
    </div>
  )
}
