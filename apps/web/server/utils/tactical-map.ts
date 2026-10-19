import { z } from 'zod'
import type { H3Event } from 'h3'
import { MapAccessError } from '@babel/database/tactical-map'
import { requireCommunityRoom } from './community-rooms'
import { requireListenerCredential } from './listeners'

export async function mapMember(event: H3Event) {
  const credential = requireListenerCredential(event)
  const id = z.uuid().safeParse(getHeader(event, 'x-listener-session'))
  if (!id.success) {
    throw createError({ statusCode: 401, statusMessage: 'Listener session required' })
  }
  return { ...(await requireCommunityRoom(event)), sessionId: id.data, credential }
}
export async function mapOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof MapAccessError) {
      throw createError({
        statusCode: { UNAUTHORIZED: 401, FORBIDDEN: 403, LIMIT: 429, CONFLICT: 409 }[
          error.code
        ],
        statusMessage: error.code,
      })
    }
    throw createError({ statusCode: 503, statusMessage: 'Map unavailable' })
  }
}
