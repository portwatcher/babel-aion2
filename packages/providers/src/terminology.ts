import type { GameTerm } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'

export interface RecognitionContext {
  general: Array<{ key: string; value: string }>
  terms: string[]
  text: string
}
function bounded(value: unknown) {
  // A conservative UTF-8 budget below Soniox's documented context ceiling.
  // Reject excess context instead of silently dropping administrator entries.
  if (Buffer.byteLength(JSON.stringify(value)) > 6_000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
}
export function recognitionTerminology(
  terms: GameTerm[],
): RecognitionContext | undefined {
  if (terms.length > 2_000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  if (!terms.length) {
    return undefined
  }
  const context = {
    general: [{ key: 'domain', value: 'AION2 Steam Global / Asia battle commands' }],
    terms: [
      ...new Set(terms.flatMap((term) => [term.sourceTerm, ...term.alternatives])),
    ],
    text: JSON.stringify(
      terms.map((term) => ({
        term: term.sourceTerm,
        language: term.sourceLanguage,
        category: term.category,
        context: term.context,
      })),
    ),
  }
  bounded(context)
  return context
}
export function translationTerminology(
  terms: GameTerm[],
  sourceLanguage: string,
  outputLanguage: string,
) {
  if (sourceLanguage === 'und') {
    return { count: 0, context: undefined }
  }
  const source = new Intl.Locale(sourceLanguage)
  const applicable = terms.flatMap((term) => {
    const candidate = new Intl.Locale(term.sourceLanguage)
    const expression = term.expressions.find(
      (value) => value.language === outputLanguage,
    )
    if (
      !expression ||
      candidate.language !== source.language ||
      (candidate.script && source.script && candidate.script !== source.script)
    ) {
      return []
    }
    return [
      {
        source: term.sourceTerm,
        alternatives: term.alternatives,
        output: expression.text,
        category: term.category,
        context: term.context,
      },
    ]
  })
  if (!applicable.length) {
    return { count: 0, context: undefined }
  }
  const value = { game: 'AION2 Steam Global / Asia', terminology: applicable }
  bounded(value)
  return { count: applicable.length, context: JSON.stringify(value) }
}
