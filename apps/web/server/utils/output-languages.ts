import { administratorUserId } from '@babel/auth'
import { languageCodeSchema } from '@babel/contracts'
import {
  createLanguageService,
  LanguageConfigurationError,
} from '@babel/database/languages'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import { requireAdministratorSession } from './auth'
import { useDatabase } from './database'
import { BodyInputError, readBoundedJson } from './bounded-json'
import { providerConfigurationFailure } from './provider-configuration'

export async function languageOperation<T>(
  event: H3Event,
  operation: (
    service: ReturnType<typeof createLanguageService>,
    actor: string,
  ) => Promise<T>,
) {
  const { identity } = await requireAdministratorSession(event)
  try {
    return await operation(
      createLanguageService(useDatabase(event)),
      administratorUserId(identity),
    )
  } catch (error) {
    if (error instanceof LanguageConfigurationError) {
      const statuses = {
        NOT_FOUND: 404,
        VERSION_CONFLICT: 409,
        INVALID_LANGUAGE: 400,
        INVALID_PATH: 400,
        PATH_UNVALIDATED: 409,
        DELIVERY_UNAVAILABLE: 503,
        LANGUAGE_ENABLED: 409,
        TERMINOLOGY_CHANGED: 409,
        VERSION_EXHAUSTED: 503,
      }
      throw createError({
        statusCode: statuses[error.code],
        statusMessage: error.code,
        data: { code: error.code },
      })
    }
    if (error instanceof BodyInputError) {
      throw createError({
        statusCode: error.code === 'TOO_LARGE' ? 413 : 400,
        statusMessage: 'Invalid language request',
        data: { code: 'INVALID_LANGUAGE' },
      })
    }
    return providerConfigurationFailure(error)
  }
}
export function outputCode(event: H3Event) {
  const value = languageCodeSchema.safeParse(getRouterParam(event, 'code'))
  if (!value.success) {
    throw new LanguageConfigurationError('INVALID_LANGUAGE')
  }
  return value.data
}
export async function languageBody<T>(event: H3Event, schema: z.ZodType<T>) {
  const value = schema.safeParse(await readBoundedJson(event, 32_768))
  if (!value.success) {
    throw new LanguageConfigurationError('INVALID_LANGUAGE')
  }
  return value.data
}
