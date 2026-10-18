import { administratorUserId } from '@babel/auth'
import { CredentialProtectionError } from '@babel/database/credentials'
import {
  createProviderService,
  ProviderConfigurationError,
} from '@babel/database/providers'
import { testProviderConnection } from '@babel/providers'
import { z } from 'zod'
import type { H3Event } from 'h3'
import { requireAdministratorSession } from './auth'
import { useDatabase } from './database'
import { roomCredentialCipher } from './management-configuration'

export async function providerOperation<T>(
  event: H3Event,
  operation: (
    service: ReturnType<typeof createProviderService>,
    actor: string,
  ) => Promise<T>,
) {
  const { identity } = await requireAdministratorSession(event)
  try {
    return await operation(
      createProviderService(
        useDatabase(event),
        roomCredentialCipher(event),
        testProviderConnection,
      ),
      administratorUserId(identity),
    )
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      const statuses = {
        NOT_FOUND: 404,
        VERSION_CONFLICT: 409,
        INVALID_CONFIGURATION: 400,
        INVALID_AUDIO: 400,
        REQUEST_TOO_LARGE: 413,
        TYPE_IMMUTABLE: 409,
        TEST_IN_PROGRESS: 409,
        TEST_COOLDOWN: 429,
        PROVIDER_IN_USE: 409,
        CONNECTION_TEST_FAILED: 422,
      }
      throw createError({
        statusCode: statuses[error.code],
        statusMessage: error.code,
        data: {
          code: error.code,
          ...(error.testCode ? { testCode: error.testCode } : {}),
        },
      })
    }
    if (error instanceof CredentialProtectionError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Credential protection unavailable',
      })
    }
    // Do not forward driver/transport error causes or credential-bearing parameters.
    throw createError({
      statusCode: 503,
      statusMessage: 'Provider configuration unavailable',
    })
  }
}

export function providerId(event: H3Event) {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) {
    throw new ProviderConfigurationError('INVALID_CONFIGURATION')
  }
  return id.data
}

export async function providerBody<T>(
  event: H3Event,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw new ProviderConfigurationError('INVALID_CONFIGURATION')
  }
  const input = schema.safeParse(body)
  if (!input.success) {
    throw new ProviderConfigurationError('INVALID_CONFIGURATION')
  }
  return input.data
}
