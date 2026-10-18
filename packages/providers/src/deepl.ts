import {
  deeplSettingsSchema,
  providerCredentialSchema,
  type DeepLSettings,
} from '@babel/contracts'
import { z } from 'zod'
import { ProviderFailure } from './errors.ts'

const translatedResponse = z.object({
  translations: z
    .array(
      z.object({
        text: z.string().min(1).max(16_384),
        detected_source_language: z.string().min(2).max(35),
      }),
    )
    .length(1),
})

function language(code: string, target: boolean) {
  try {
    const locale = new Intl.Locale(code)
    if (target && locale.language === 'zh') {
      return locale.maximize().script === 'Hant' ? 'ZH-HANT' : 'ZH-HANS'
    }
    if (target && ['en', 'pt', 'es'].includes(locale.language)) {
      return locale.baseName.toUpperCase()
    }
    return locale.language.toUpperCase()
  } catch {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
}

export async function translateDeepL(
  settings: DeepLSettings,
  credential: string,
  input: {
    text: string
    sourceLanguage: string
    outputLanguage: string
    context?: string
  },
  signal?: AbortSignal,
) {
  const valid = deeplSettingsSchema.safeParse(settings)
  if (
    !valid.success ||
    !providerCredentialSchema.safeParse(credential).success ||
    !input.text.length ||
    input.text.length > 8_192 ||
    (input.context?.length ?? 0) > 8_192
  ) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  const timeout = AbortSignal.timeout(valid.data.timeoutMs)
  const cancellation = signal ? AbortSignal.any([timeout, signal]) : timeout
  try {
    const response = await fetch(`${valid.data.endpoint}/v2/translate`, {
      method: 'POST',
      redirect: 'error',
      signal: cancellation,
      headers: {
        authorization: `DeepL-Auth-Key ${credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: [input.text],
        source_lang: language(input.sourceLanguage, false),
        target_lang: language(input.outputLanguage, true),
        model_type: valid.data.model,
        ...(input.context ? { context: input.context } : {}),
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      const codes: Record<
        number,
        Exclude<import('@babel/contracts').ProviderTestCode, 'PASS'>
      > = {
        400: 'INVALID_CONFIGURATION',
        401: 'INVALID_CREDENTIAL',
        403: 'INVALID_CREDENTIAL',
        429: 'RATE_LIMITED',
        456: 'QUOTA_EXHAUSTED',
      }
      throw new ProviderFailure(codes[response.status] ?? 'UNAVAILABLE')
    }
    // Enforce the response limit while reading, not after allocating an arbitrary body.
    const reader = response.body?.getReader()
    if (!reader) {
      throw new ProviderFailure('INVALID_RESPONSE')
    }
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const part = await reader.read()
      if (part.done) {
        break
      }
      bytes += part.value.byteLength
      if (bytes > 64 * 1024) {
        await reader.cancel()
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      chunks.push(part.value)
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new ProviderFailure('INVALID_RESPONSE')
    }
    const parsed = translatedResponse.safeParse(body)
    if (!parsed.success || !parsed.data.translations[0]) {
      throw new ProviderFailure('INVALID_RESPONSE')
    }
    return parsed.data.translations[0].text
  } catch (error) {
    if (error instanceof ProviderFailure) {
      throw error
    }
    if (cancellation.aborted) {
      throw new ProviderFailure('TIMEOUT')
    }
    // Provider messages and network error causes can echo credentials or text.
    throw new ProviderFailure('UNAVAILABLE')
  }
}
