import type { OpenAISettings } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { openOpenAISession } from './openai-session.ts'

const supported = new Set([
  'es',
  'pt',
  'fr',
  'ja',
  'ru',
  'zh',
  'de',
  'ko',
  'hi',
  'id',
  'vi',
  'it',
  'en',
])
export function translationLanguage(code: string) {
  let locale: Intl.Locale
  try {
    locale = new Intl.Locale(code)
  } catch {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  if (!supported.has(locale.language)) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  return locale.language
}
export function openTranslation(input: {
  settings: OpenAISettings
  credential: string
  outputLanguage: string
  signal?: AbortSignal
  delta: (text: string) => void
}) {
  const seen = new Set<string>()
  const session = openOpenAISession({
    ...input,
    translation: true,
    configuration: {
      audio: { output: { language: translationLanguage(input.outputLanguage) } },
    },
    event(event) {
      if (event.type !== 'session.output_transcript.delta') {
        return
      }
      if (
        typeof event.delta !== 'string' ||
        event.delta.length > 16384 ||
        typeof event.event_id !== 'string'
      ) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      // elapsed_ms is alignment metadata, never an identity or utterance boundary.
      if (seen.has(event.event_id)) {
        return
      }
      seen.add(event.event_id)
      if (seen.size > 512) {
        const first = seen.values().next().value
        if (first) {
          seen.delete(first)
        }
      }
      input.delta(event.delta)
    },
  })
  return {
    ready: session.ready,
    finished: session.finished,
    append(audio: string) {
      session.send({ type: 'session.input_audio_buffer.append', audio })
    },
    end: session.end,
    close: session.close,
  }
}
