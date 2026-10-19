import OpenCC from 'opencc-js'

let simplified: ((text: string) => string) | undefined
let traditional: ((text: string) => string) | undefined

/** Script conversion is local and synchronous; it creates no provider request. */
export function subtitleText(language: string, text: string) {
  const locale = new Intl.Locale(language).maximize()
  if (locale.language !== 'zh') {
    return text
  }
  if (locale.script === 'Hant') {
    traditional ??= OpenCC.Converter({ from: 'cn', to: 'tw' })
    return traditional(text)
  }
  simplified ??= OpenCC.Converter({ from: 't', to: 'cn' })
  return simplified(text)
}
