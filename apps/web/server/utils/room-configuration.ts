import { DEFAULT_ROOM_ID, type PublicRoomConfiguration } from '@babel/contracts'
import { communityRoom, outputLanguage, room } from '@babel/database/schema'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDatabase } from './database'
import { voiceSourceConfigured } from '@babel/database/voice-sources'
import { voiceSourceStatus } from './media-control'
import { z } from 'zod'

export { DEFAULT_ROOM_ID } from '@babel/contracts'

export async function useListenerRoom(event?: H3Event, selectedRoomId?: string) {
  const database = useDatabase(event)
  if (!selectedRoomId && event?.path.startsWith('/api/management/')) {
    const query = getQuery(event).roomId
    if (query !== undefined) {
      const parsed = z.uuid().safeParse(query)
      if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid room ID' })
      }
      const [saved] = await database
        .select({ id: room.id })
        .from(room)
        .where(and(eq(room.id, parsed.data), isNull(room.disbandedAt)))
      if (!saved) {
        throw createError({ statusCode: 404, statusMessage: 'Room not found' })
      }
      selectedRoomId = saved.id
    }
  }
  if (selectedRoomId) {
    return { database, roomId: selectedRoomId }
  }
  const [saved] = await database
    .select({ id: room.id })
    .from(room)
    .where(isNull(room.disbandedAt))
    .orderBy(
      sql`case when ${room.id} = ${DEFAULT_ROOM_ID} then 0 else 1 end`,
      asc(room.createdAt),
      asc(room.id),
    )
    .limit(1)
  if (!saved) {
    throw createError({ statusCode: 404, statusMessage: 'No installed rooms' })
  }
  return { database, roomId: saved.id }
}

export async function publicRoomConfiguration(
  event?: H3Event,
  selectedRoomId = DEFAULT_ROOM_ID,
): Promise<PublicRoomConfiguration> {
  const configuration: PublicRoomConfiguration = {
    room: { id: selectedRoomId, name: 'AION2 深渊战', audioState: 'UNCONFIGURED' },
    outputLanguages: [],
    defaultOutputLanguage: null,
    entryAvailable: false,
  }
  if (!useRuntimeConfig(event).databaseUrl) {
    return configuration
  }
  try {
    const { database, roomId } = await useListenerRoom(
      event,
      selectedRoomId === DEFAULT_ROOM_ID ? undefined : selectedRoomId,
    )
    configuration.room.id = roomId
    await database.execute(sql`select id from player_connection limit 1`)
    const [saved] = await database
      .select()
      .from(room)
      .where(and(eq(room.id, roomId), isNull(room.disbandedAt)))
    if (saved) {
      configuration.room.name = saved.name
      const [admission] = await database
        .select()
        .from(communityRoom)
        .where(eq(communityRoom.roomId, roomId))
      if (admission) {
        configuration.room.number = admission.number
        if (saved.hostCharacterId) {
          configuration.room.hostId = saved.hostCharacterId
        }
        configuration.admission = {
          server: admission.server,
          restricted: admission.allowedIds.length > 0,
        }
      }
      configuration.outputLanguages = await database
        .select({ code: outputLanguage.code, name: outputLanguage.name })
        .from(outputLanguage)
        .where(
          and(
            eq(outputLanguage.enabled, true),
            isNotNull(outputLanguage.pathValidatedAt),
          ),
        )
        .orderBy(asc(outputLanguage.order), asc(outputLanguage.code))
      configuration.defaultOutputLanguage = configuration.outputLanguages.some(
        (language) => language.code === saved.defaultOutputLanguage,
      )
        ? saved.defaultOutputLanguage
        : null
      if (voiceSourceConfigured(saved)) {
        const source = await voiceSourceStatus(roomId)
        configuration.room.audioState = source?.state ?? 'UNAVAILABLE'
        if (
          saved.stopped &&
          source &&
          !['STOPPED', 'UNAVAILABLE'].includes(source.state)
        ) {
          configuration.room.audioState = 'STOPPING'
        }
      }
    }
    // Entry persists JOINING, independently of command-delivery authorization.
    configuration.entryAvailable = Boolean(saved)
  } catch {
    /* Keep the public lobby available when storage is unavailable. */
  }
  return configuration
}
