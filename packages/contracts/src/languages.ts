export interface OutputLanguage {
  code: string
  name: string
}

function locale(code: string): Intl.Locale | null {
  try {
    return new Intl.Locale(code)
  } catch {
    return null
  }
}

export function selectOutputLanguage(
  enabled: readonly OutputLanguage[],
  preferences: readonly string[],
  saved: string | null = null,
  defaultCode: string | null = null,
): string | null {
  const exact = (code: string | null) => {
    const canonical = code ? locale(code)?.baseName : null
    return enabled.find((item) => locale(item.code)?.baseName === canonical)?.code
  }
  const savedMatch = exact(saved)
  if (savedMatch) {
    return savedMatch
  }
  for (const code of preferences) {
    const exactMatch = exact(code)
    if (exactMatch) {
      return exactMatch
    }
    const requested = locale(code)?.maximize()
    if (!requested) {
      continue
    }
    const match = enabled.find((item) => {
      const candidate = locale(item.code)?.maximize()
      return (
        candidate?.language === requested.language &&
        candidate?.script === requested.script
      )
    })
    if (match) {
      return match.code
    }
  }
  return exact(defaultCode) ?? enabled[0]?.code ?? null
}
