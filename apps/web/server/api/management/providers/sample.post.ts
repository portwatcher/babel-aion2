import {
  providerSampleRequestSchema,
  providerSampleResultSchema,
} from '@babel/contracts'
import { ProviderConfigurationError } from '@babel/database/providers'
import { createTermService } from '@babel/database/terms'
import { previewSubtitleSample, readPcmWave } from '@babel/providers'
import { providerOperation } from '../../../utils/provider-configuration'
import { BodyInputError, readBoundedJson } from '../../../utils/bounded-json'
import { useDatabase } from '../../../utils/database'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) => {
    // Bound authenticated upload allocation, including chunked input. Audio and
    // transcript text are never written to storage, audit rows, or logs.
    let body: unknown
    try {
      body = await readBoundedJson(event, 1_400_000)
    } catch (error) {
      throw new ProviderConfigurationError(
        error instanceof BodyInputError && error.code === 'TOO_LARGE'
          ? 'REQUEST_TOO_LARGE'
          : 'INVALID_AUDIO',
      )
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
    const terminology = input.includeTerms
      ? await createTermService(useDatabase(event)).snapshot()
      : null
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
            terminology,
          }),
        )
      },
    )
  }),
)
