import {
  createCredentialCipher,
  CredentialProtectionError,
} from '@babel/database/credentials'
import { RoomConfigurationError } from '@babel/database/room-settings'
import { isError, type H3Event } from 'h3'

export async function readRoomConfigurationBody(event: H3Event): Promise<unknown> {
  try {
    return await readBody(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid room configuration' })
  }
}

export function roomCredentialCipher(event: H3Event) {
  try {
    return createCredentialCipher(useRuntimeConfig(event).providerEncryptionKey)
  } catch {
    return null
  }
}

export async function roomConfigurationOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (isError(error)) {
      throw error
    }
    if (error instanceof CredentialProtectionError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Credential protection unavailable',
      })
    }
    if (error instanceof RoomConfigurationError) {
      const status = {
        NOT_FOUND: 404,
        VERSION_CONFLICT: 409,
        INVALID_CONFIGURATION: 400,
      }
      throw createError({ statusCode: status[error.code], statusMessage: error.code })
    }
    // SQL failure details can contain bound parameters, including ciphertext.
    throw createError({
      statusCode: 503,
      statusMessage: 'Room configuration unavailable',
    })
  }
}
