import {
  providerSampleResultSchema,
  type ProviderSampleRequest,
} from '@babel/contracts'
import {
  ProviderConfigurationError,
  type createProviderService,
} from '@babel/database/providers'
import { createTermService } from '@babel/database/terms'
import { previewSubtitleSample, readPcmWave } from '@babel/providers'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import { BodyInputError, readBoundedJson } from './bounded-json'
import { useDatabase } from './database'

export async function readSampleBody<T>(event: H3Event, schema: z.ZodType<T>) {
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
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ProviderConfigurationError('INVALID_AUDIO')
  }
  return parsed.data
}

export async function runProviderSample(
  event: H3Event,
  service: ReturnType<typeof createProviderService>,
  actor: string,
  input: ProviderSampleRequest,
) {
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
        recognition?.settings.type !== 'openai' ||
        translation?.settings.type !== 'openai'
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
}
