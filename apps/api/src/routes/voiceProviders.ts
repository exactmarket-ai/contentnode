import type { FastifyInstance } from 'fastify'

export async function voiceProviderRoutes(app: FastifyInstance) {
  // Proxy ElevenLabs /v1/voices so the frontend can show the full voice library
  // without exposing the API key to the browser.
  app.get('/elevenlabs/voices', async (_req, reply) => {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return reply.code(200).send({ data: [] })
    }

    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        return reply.code(200).send({ data: [] })
      }
      const json = await res.json() as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] }
      const data = (json.voices ?? []).map(v => ({
        value: v.voice_id,
        label: v.name + (v.labels?.gender ? ` (${v.labels.gender})` : ''),
      }))
      return reply.send({ data })
    } catch {
      return reply.code(200).send({ data: [] })
    }
  })
}
