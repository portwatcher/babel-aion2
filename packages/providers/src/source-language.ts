import { eld } from 'eld/medium'

/** Local text identification, not language metadata from gpt-live-transcribe. */
export function sourceLanguage(text: string) {
  const result = eld.detect(text)
  return result.isReliable() ? result.language || 'und' : 'und'
}
