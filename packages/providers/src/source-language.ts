import { eld } from 'eld/large'
import { franc } from 'franc-min'

/** Local text identification, not language metadata from gpt-live-transcribe. */
export function sourceLanguage(text: string) {
  const result = eld.detect(text)
  if (!result.isReliable()) {
    return 'und'
  }
  // ELD has a Malay model but no Indonesian model. Distinguish them locally
  // rather than treating every Malay result as an Indonesian source.
  if (result.language === 'ms' && franc(text) === 'ind') {
    return 'id'
  }
  return result.language || 'und'
}
