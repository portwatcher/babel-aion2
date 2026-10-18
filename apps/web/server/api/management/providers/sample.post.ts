import {
  providerSampleRequestSchema,
  providerSampleResultSchema,
} from '@babel/contracts'
import { ProviderConfigurationError } from '@babel/database/providers'
import { previewSubtitleSample, readPcmWave } from '@babel/providers'
import { providerOperation } from '../../../utils/provider-configuration'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) => {
    // Bound authenticated upload allocation, including chunked input. Audio and
    // transcript text are never written to storage, audit rows, or logs.
    const reader = getRequestWebStream(event)?.getReader()
    if (!reader) {
      throw new ProviderConfigurationError('INVALID_AUDIO')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        size += chunk.value.byteLength
        if (size > 1_400_000) {
          await reader.cancel()
          throw new ProviderConfigurationError('REQUEST_TOO_LARGE')
        }
        chunks.push(chunk.value)
      }
    } finally {
      reader.releaseLock()
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new ProviderConfigurationError('INVALID_AUDIO')
    }
    const parsed = providerSampleRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new ProviderConfigurationError('INVALID_AUDIO')
    }
    const input = parsed.data
    const bytes = Buffer.from(input.audioBase64, 'base64')
    if (bytes.toString('base64') !== input.audioBase64) {
      throw new ProviderConfigurationError('INVALID_AUDIO')
    }
    let audio
    try {
      audio = readPcmWave(bytes)
    } catch {
      throw new ProviderConfigurationError('INVALID_AUDIO')
    }
    return service.sample(
      [input.recognition, input.translation],
      actor,
      async (providers) => {
        const recognition = providers.find((value) => value.id === input.recognition.id)
        const translation = providers.find((value) => value.id === input.translation.id)
        if (
          recognition?.settings.type !== 'soniox' ||
          translation?.settings.type !== 'deepl'
        ) {
          throw new ProviderConfigurationError('INVALID_CONFIGURATION')
        }
        return providerSampleResultSchema.parse(
          await previewSubtitleSample({
            recognition: { ...recognition, settings: recognition.settings },
            translation: { ...translation, settings: translation.settings },
            outputLanguage: input.outputLanguage,
            audio,
          }),
        )
      },
    )
  }),
)
