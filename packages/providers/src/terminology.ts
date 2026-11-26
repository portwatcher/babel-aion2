import type { GameTerm } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { subtitleText } from './subtitle-text.ts'

export interface RecognitionContext {
  prompt: string
  keywords: string[]
}

export interface TranslationTerminology {
  glossary: string
  termCount: number
}

export function recognitionTerminology(
  terms: GameTerm[],
): RecognitionContext | undefined {
  if (!terms.length) {
    return undefined
  }
  if (terms.length > 2000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  const keywords = [
    ...new Set(terms.flatMap((term) => [term.sourceTerm, ...term.alternatives])),
  ]
  const description =
    'AION2 Steam Global / Asia battle commands. ' +
    terms
      .map((term) => term.sourceTerm + ': ' + term.category + '; ' + term.context)
      .join('\n')
  const context = {
    // The live transcription API accepts at most 1,024 prompt characters.
    // Bound optional prose without splitting a surrogate pair; every literal
    // term and alternative remains in the separate keyword hints below.
    // Omit transcription.languages so gpt-live-transcribe auto-detects any
    // spoken language instead of biasing toward the term catalog's sort order.
    prompt: description.slice(0, 1024).replace(/[\uD800-\uDBFF]$/u, ''),
    keywords,
  }
  if (
    Buffer.byteLength(JSON.stringify(context)) > 6000 ||
    keywords.some((term) => /[<>\r\n]/u.test(term))
  ) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  return context
}

function matchExpression(term: GameTerm, outputLanguage: string): string | null {
  const canonical = new Intl.Locale(outputLanguage)
  const exact = term.expressions.find(
    (item) => new Intl.Locale(item.language).baseName === canonical.baseName,
  )
  if (exact) {
    return exact.text
  }
  if (canonical.language === 'zh') {
    const targetScript = canonical.maximize().script
    const sameScript = term.expressions.find((item) => {
      const locale = new Intl.Locale(item.language)
      return locale.language === 'zh' && locale.maximize().script === targetScript
    })
    if (sameScript) {
      return sameScript.text
    }
    const bareChinese = term.expressions.find(
      (item) => new Intl.Locale(item.language).baseName === 'zh',
    )
    return bareChinese ? subtitleText(outputLanguage, bareChinese.text) : null
  }
  const family = term.expressions.find(
    (item) => new Intl.Locale(item.language).language === canonical.language,
  )
  return family ? family.text : null
}

export function translationTerminology(
  terms: GameTerm[],
  outputLanguage: string,
): TranslationTerminology {
  if (!terms.length) {
    return { glossary: '', termCount: 0 }
  }
  if (terms.length > 2000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  const lines: string[] = []
  for (const term of terms) {
    if (
      /[<>\r\n]/u.test(term.sourceTerm) ||
      term.alternatives.some((item) => /[<>\r\n]/u.test(item))
    ) {
      throw new ProviderFailure('CONTEXT_TOO_LARGE')
    }
    const target = matchExpression(term, outputLanguage)
    if (!target) {
      continue
    }
    if (/[<>\r\n]/u.test(target)) {
      throw new ProviderFailure('CONTEXT_TOO_LARGE')
    }
    const aliases = term.alternatives.length ? ` (${term.alternatives.join(', ')})` : ''
    const note = term.context ? `${term.category}; ${term.context}` : term.category
    lines.push(`- ${term.sourceTerm}${aliases} => ${target} [${note}]`)
  }
  const glossary = lines.join('\n')
  if (Buffer.byteLength(glossary, 'utf8') > 6000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  return { glossary, termCount: lines.length }
}
