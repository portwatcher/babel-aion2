import { assertSameOrigin } from '@babel/auth/access'
import { listenerCredentialSchema } from '@babel/contracts'
import {
  createListenerService,
  ListenerError,
  unavailableListenerDelivery,
} from '@babel/database/listeners'
import { room } from '@babel/database/schema'
import type { H3Event } from 'h3'
import { useDatabase } from './database'

export const DEFAULT_ROOM_ID = '00000000-0000-4000-8000-000000000001'

export async function useListenerRoom(event: H3Event) {
  const database = useDatabase(event)
  await database
    .insert(room)
    .values({ id: DEFAULT_ROOM_ID, name: 'AION2 深渊站' })
    .onConflictDoNothing()
  return { database, roomId: DEFAULT_ROOM_ID }
}

export function useListeners(event: H3Event) {
  return createListenerService(useDatabase(event), unavailableListenerDelivery)
}

export function requireListenerCredential(event: H3Event) {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const authorization = getHeader(event, 'authorization') ?? ''
  const credential = listenerCredentialSchema.safeParse(
    authorization.startsWith('Bearer ') ? authorization.slice(7) : '',
  )
  if (!credential.success) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Listener credential required',
    })
  }
  return credential.data
}

export function requirePlayerOrigin(event: H3Event) {
  try {
    assertSameOrigin(
      getHeader(event, 'origin') ?? null,
      useRuntimeConfig(event).siteUrl,
    )
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: 'A same-origin request is required',
    })
  }
}

export function listenerSessionId(event: H3Event) {
  const id = getRouterParam(event, 'id')
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid listener session ID' })
  }
  return id
}

export async function listenerOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof ListenerError)) {
      throw error
    }
    const status = {
      INVALID_CREDENTIAL: 401,
      ENTRY_CONFLICT: 409,
      LANGUAGE_UNAVAILABLE: 400,
      SESSION_ENDED: 410,
      ROOM_NOT_FOUND: 404,
    }
    throw createError({ statusCode: status[error.code], statusMessage: error.code })
  }
}
