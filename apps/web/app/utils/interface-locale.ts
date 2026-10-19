export const interfaceLocales = ['en', 'zh-CN', 'ja', 'ko'] as const
export type InterfaceLocale = (typeof interfaceLocales)[number]
export const interfaceLocaleKey = 'babel-interface-locale'

export function toInterfaceLocale(value: unknown): InterfaceLocale | null {
  if (typeof value !== 'string') {
    return null
  }
  const base = value.trim().replaceAll('_', '-').toLowerCase().split('-')[0]
  switch (base) {
    case 'en':
      return 'en'
    case 'zh':
    case 'cn':
      return 'zh-CN'
    case 'ja':
    case 'jp':
      return 'ja'
    case 'ko':
    case 'kr':
      return 'ko'
    default:
      return null
  }
}

export function browserInterfaceLocale(
  preferences: readonly string[],
): InterfaceLocale {
  for (const preference of preferences) {
    const locale = toInterfaceLocale(preference)
    if (locale) {
      return locale
    }
  }
  return 'en'
}

export function requestInterfaceLocale(header: string | undefined): InterfaceLocale {
  const preferences = (header ?? '').split(',').flatMap((part, index) => {
    const [tag, ...parameters] = part.trim().split(';')
    const parameter = parameters.find((value) => value.trim().startsWith('q='))
    const quality = parameter === undefined ? 1 : Number(parameter.trim().slice(2))
    return tag && Number.isFinite(quality) && quality > 0 && quality <= 1
      ? [{ tag, quality, index }]
      : []
  })
  preferences.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return browserInterfaceLocale(preferences.map(({ tag }) => tag))
}

export function isAdministratorInterface(path: string): boolean {
  try {
    const normalized = decodeURIComponent(path).replace(/\/{2,}/g, '/')
    return normalized === '/admin' || normalized.startsWith('/admin/')
  } catch {
    return false
  }
}
