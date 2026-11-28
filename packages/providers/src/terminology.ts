import type { GameTerm } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { subtitleText } from './subtitle-text.ts'

export interface RecognitionContext {
  prompt: string
  keywords?: string[]
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
  const fullContext = {
    // The live transcription API accepts at most 1,024 prompt characters.
    // Bound optional prose without splitting a surrogate pair; every literal
    // term and alternative remains in the separate keyword hints below.
    // Omit transcription.languages so gpt-live-transcribe auto-detects any
    // spoken language instead of biasing toward the term catalog's sort order.
    prompt: description.slice(0, 1024).replace(/[\uD800-\uDBFF]$/u, ''),
    keywords,
  }
  if (
    Buffer.byteLength(JSON.stringify(fullContext)) > 6000 ||
    keywords.some((term) => /[<>\r\n]/u.test(term))
  ) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  // When the global term catalog spans multiple languages/scripts (e.g. Hangul,
  // Katakana, Hanzi and Latin), passing mixed-script keywords or prompts into
  // gpt-live-transcribe hijacks onset syllables across scripts (such as
  // transcribing Japanese syllables as Korean Hangul). Keep recognition neutral
  // for multilingual catalogs and enforce exact terms in translation glossaries.
  const sourceFamilies = new Set(
    terms.map((term) => new Intl.Locale(term.sourceLanguage).language),
  )
  if (sourceFamilies.size > 1) {
    return { prompt: 'AION2 Steam Global / Asia voice chat battle commands.' }
  }
  return fullContext
}

function matchExpression(
  term: GameTerm,
  outputLanguage: string,
): { text: string; fromSource: boolean } | null {
  const canonical = new Intl.Locale(outputLanguage)
  const exact = term.expressions.find(
    (item) => new Intl.Locale(item.language).baseName === canonical.baseName,
  )
  if (exact) {
    return { text: exact.text, fromSource: false }
  }
  if (canonical.language === 'zh') {
    const targetScript = canonical.maximize().script
    const sameScript = term.expressions.find((item) => {
      const locale = new Intl.Locale(item.language)
      return locale.language === 'zh' && locale.maximize().script === targetScript
    })
    if (sameScript) {
      return { text: sameScript.text, fromSource: false }
    }
    const bareChinese = term.expressions.find(
      (item) => new Intl.Locale(item.language).baseName === 'zh',
    )
    if (bareChinese) {
      return { text: subtitleText(outputLanguage, bareChinese.text), fromSource: false }
    }
  } else {
    const family = term.expressions.find(
      (item) => new Intl.Locale(item.language).language === canonical.language,
    )
    if (family) {
      return { text: family.text, fromSource: false }
    }
  }
  if (new Intl.Locale(term.sourceLanguage).language === canonical.language) {
    return {
      text:
        canonical.language === 'zh'
          ? subtitleText(outputLanguage, term.sourceTerm)
          : term.sourceTerm,
      fromSource: true,
    }
  }
  return null
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
    const matched = matchExpression(term, outputLanguage)
    if (!matched) {
      continue
    }
    const target = matched.text
    if (/[<>\r\n]/u.test(target)) {
      throw new ProviderFailure('CONTEXT_TOO_LARGE')
    }
    const aliasValues = matched.fromSource
      ? [
          ...new Set([
            ...term.alternatives,
            ...term.expressions
              .map((item) => item.text)
              .filter(
                (item) =>
                  item !== term.sourceTerm &&
                  item !== target &&
                  !/[<>\r\n]/u.test(item),
              ),
          ]),
        ]
      : term.alternatives
    const aliases = aliasValues.length ? ` (${aliasValues.join(', ')})` : ''
    const note = term.context ? `${term.category}; ${term.context}` : term.category
    lines.push(`- ${term.sourceTerm}${aliases} => ${target} [${note}]`)
  }
  const glossary = lines.join('\n')
  if (Buffer.byteLength(glossary, 'utf8') > 6000) {
    throw new ProviderFailure('CONTEXT_TOO_LARGE')
  }
  return { glossary, termCount: lines.length }
}
