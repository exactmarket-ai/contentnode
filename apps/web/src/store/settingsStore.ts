import { create } from 'zustand'

interface SettingsStore {
  ollamaModels: string[]
  setOllamaModels: (models: string[]) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ollamaModels: [],
  setOllamaModels: (models) => set({ ollamaModels: models }),
}))
