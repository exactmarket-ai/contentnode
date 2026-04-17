import { useState, useEffect } from 'react'
import { OLLAMA_MODELS } from '@/components/layout/config/shared'
import { useSettingsStore } from '@/store/settingsStore'

export interface OllamaModelOption {
  value: string
  label: string
}

/**
 * Fetches the list of models installed on the local Ollama server.
 * Falls back to profile models + hardcoded defaults if Ollama isn't running.
 */
export function useOllamaModels(): OllamaModelOption[] {
  const profileModels = useSettingsStore((s) => s.ollamaModels)
  const [installedModels, setInstalledModels] = useState<string[]>([])

  useEffect(() => {
    fetch('http://localhost:11434/api/tags')
      .then((r) => r.json())
      .then((data) => {
        const names: string[] = (data.models ?? []).map((m: { name: string }) => m.name)
        setInstalledModels(names)
      })
      .catch(() => {
        // Ollama not running — will fall back to profile + hardcoded list
      })
  }, [])

  const hardcodedValues = OLLAMA_MODELS.map((m) => m.value)

  // Priority: installed > profile > hardcoded, all deduped
  const merged = [
    ...installedModels,
    ...profileModels,
    ...hardcodedValues,
  ].filter((v, i, arr) => arr.indexOf(v) === i)

  return merged.map((v) => ({
    value: v,
    label: OLLAMA_MODELS.find((m) => m.value === v)?.label ?? v,
  }))
}
