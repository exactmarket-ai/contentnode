/**
 * Shared voice data and hooks for VoiceOutputNode + VoiceOutputConfig.
 * Single source of truth — edit here, both places update.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from './api'

// ─── Static voice lists ───────────────────────────────────────────────────────

export const VOICES_OPENAI = [
  { value: 'echo',    label: 'Echo — calm, professional'      },
  { value: 'shimmer', label: 'Shimmer — soft, gentle'         },
  { value: 'alloy',   label: 'Alloy — neutral, versatile'     },
  { value: 'ash',     label: 'Ash — warm, natural'            },
  { value: 'ballad',  label: 'Ballad — expressive, narrative' },
  { value: 'coral',   label: 'Coral — bright, conversational' },
  { value: 'sage',    label: 'Sage — composed, thoughtful'    },
  { value: 'verse',   label: 'Verse — dynamic, clear'         },
  { value: 'marin',   label: 'Marin — smooth, confident'      },
  { value: 'cedar',   label: 'Cedar — deep, grounded'         },
]

export const VOICES_ELEVENLABS_FALLBACK = [
  { value: 'rachel', label: 'Rachel — warm, versatile (F)' },
  { value: 'adam',   label: 'Adam — deep, confident (M)'   },
  { value: 'josh',   label: 'Josh — young, dynamic (M)'    },
]

export const VOICES_LOCAL = [
  { value: 'af_heart',    label: 'Heart — warm, expressive (AF)'        },
  { value: 'af_bella',    label: 'Bella — smooth, natural (AF)'         },
  { value: 'af_aoede',    label: 'Aoede — clear, neutral (AF)'          },
  { value: 'af_alloy',    label: 'Alloy — versatile, confident (AF)'    },
  { value: 'af_jessica',  label: 'Jessica — bright, conversational (AF)'},
  { value: 'af_kore',     label: 'Kore — composed, steady (AF)'         },
  { value: 'af_nicole',   label: 'Nicole — gentle, warm (AF)'           },
  { value: 'af_nova',     label: 'Nova — energetic, clear (AF)'         },
  { value: 'af_river',    label: 'River — calm, measured (AF)'          },
  { value: 'af_sarah',    label: 'Sarah — soft, young (AF)'             },
  { value: 'af_sky',      label: 'Sky — airy, light (AF)'               },
  { value: 'am_michael',  label: 'Michael — deep, professional (AM)'    },
  { value: 'am_adam',     label: 'Adam — authoritative (AM)'            },
  { value: 'am_echo',     label: 'Echo — calm, steady (AM)'             },
  { value: 'am_eric',     label: 'Eric — clear, neutral (AM)'           },
  { value: 'am_fenrir',   label: 'Fenrir — bold, resonant (AM)'         },
  { value: 'am_liam',     label: 'Liam — energetic, young (AM)'         },
  { value: 'am_onyx',     label: 'Onyx — deep, rich (AM)'               },
  { value: 'am_puck',     label: 'Puck — expressive, dynamic (AM)'      },
  { value: 'am_santa',    label: 'Santa — warm, jolly (AM)'             },
  { value: 'bf_alice',    label: 'Alice — crisp, British (BF)'          },
  { value: 'bf_emma',     label: 'Emma — warm, British (BF)'            },
  { value: 'bf_isabella', label: 'Isabella — refined, British (BF)'     },
  { value: 'bf_lily',     label: 'Lily — light, British (BF)'           },
  { value: 'bm_lewis',    label: 'Lewis — grounded, British (BM)'       },
  { value: 'bm_daniel',   label: 'Daniel — authoritative, British (BM)' },
  { value: 'bm_fable',    label: 'Fable — storytelling, British (BM)'   },
  { value: 'bm_george',   label: 'George — steady, British (BM)'        },
]

// ─── Starred voices (localStorage, shared key) ────────────────────────────────

const STARRED_KEY = 'contentnode:starred_voices'

export function useStarredVoices(): [Set<string>, (voice: string) => void] {
  const [starred, setStarred] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STARRED_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })

  const toggle = useCallback((voice: string) => {
    setStarred(prev => {
      const next = new Set(prev)
      if (next.has(voice)) next.delete(voice)
      else next.add(voice)
      localStorage.setItem(STARRED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  return [starred, toggle]
}

// ─── Live ElevenLabs voice fetch ──────────────────────────────────────────────

export function useElevenLabsVoices(enabled: boolean) {
  const [voices, setVoices] = useState<{ value: string; label: string }[]>(VOICES_ELEVENLABS_FALLBACK)
  const [loading, setLoading] = useState(false)

  const fetchVoices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/v1/voice-providers/elevenlabs/voices')
      if (res.ok) {
        const json = await res.json() as { data: { value: string; label: string }[] }
        if (json.data?.length) setVoices(json.data)
      }
    } catch { /* keep fallback */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (enabled) fetchVoices()
  }, [enabled, fetchVoices])

  return { voices, loading, refetch: fetchVoices }
}

// ─── Resolve voice list for a given provider ──────────────────────────────────

export function voicesForProvider(
  provider: string,
  elVoices: { value: string; label: string }[],
): { value: string; label: string }[] {
  if (provider === 'elevenlabs') return elVoices
  if (provider === 'local')      return VOICES_LOCAL
  return VOICES_OPENAI
}
