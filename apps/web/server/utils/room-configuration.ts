import type { PublicRoomConfiguration } from '@babel/contracts'
import { outputLanguage, room } from '@babel/database/schema'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDatabase } from './database'
import { voiceSourceConfigured } from '@babel/database/voice-sources'
import { voiceSourceStatus } from './media-control'

export const DEFAULT_ROOM_ID = '00000000-0000-4000-8000-000000000001'

export async function useListenerRoom(event?: H3Event) {
  const database = useDatabase(event)
  await database
    .insert(room)
    .values({ id: DEFAULT_ROOM_ID, name: 'AION2 深渊站' })
    .onConflictDoNothing()
  return { database, roomId: DEFAULT_ROOM_ID }
}

export async function publicRoomConfiguration(
  event?: H3Event,
): Promise<PublicRoomConfiguration> {
  const configuration: PublicRoomConfiguration = {
    room: { id: DEFAULT_ROOM_ID, name: 'AION2 深渊站', audioState: 'UNCONFIGURED' },
    outputLanguages: [],
    defaultOutputLanguage: null,
    entryAvailable: false,
  }
  if (!useRuntimeConfig(event).databaseUrl) {
    return configuration
  }
  try {
    const { database, roomId } = await useListenerRoom(event)
    await database.execute(sql`select id from player_connection limit 1`)
    const [saved] = await database.select().from(room).where(eq(room.id, roomId))
    if (saved) {
      configuration.room.name = saved.name
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
    configuration.entryAvailable = true
  } catch {
    /* Keep the public lobby available when storage is unavailable. */
  }
  return configuration
}
