import type { GameTerm } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'

export interface RecognitionContext {
  prompt: string
  keywords: string[]
  languages: string[]
}
export function recognitionTerminology(
  terms: GameTerm[],
): RecognitionContext | undefined {
  if (!terms.length) {
    return undefined
  }
  const keywords = [
    ...new Set(terms.flatMap((term) => [term.sourceTerm, ...term.alternatives])),
  ]
  const context = {
    prompt:
      'AION2 Steam Global / Asia battle commands. ' +
      terms
        .map((term) => term.sourceTerm + ': ' + term.category + '; ' + term.context)
        .join('\n'),
    keywords,
    languages: [
      ...new Set(terms.map((term) => new Intl.Locale(term.sourceLanguage).language)),
    ],
  }
  if (
    Buffer.byteLength(JSON.stringify(context)) > 6000 ||
    keywords.some((term) => /[<>\r\n]/u.test(term))
  ) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  return context
}
