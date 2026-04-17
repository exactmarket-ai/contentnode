import { create } from 'zustand'

export type LocalMediaServiceType = 'tts' | 'image-gen' | 'character-animation' | 'transcription'

export interface LocalMediaService {
  id: string
  type: LocalMediaServiceType
  label: string
  url: string
}

interface SettingsStore {
  ollamaModels: string[]
  setOllamaModels: (models: string[]) => void
  localMediaServices: LocalMediaService[]
  setLocalMediaServices: (services: LocalMediaService[]) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ollamaModels: [],
  setOllamaModels: (models) => set({ ollamaModels: models }),
  localMediaServices: [],
  setLocalMediaServices: (services) => set({ localMediaServices: services }),
}))
