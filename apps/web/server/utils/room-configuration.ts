import type { PublicRoomConfiguration } from '@babel/contracts'
import { room } from '@babel/database/schema'
import { eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDatabase } from './database'

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
    }
    // Entry persists JOINING, independently of command-delivery authorization.
    configuration.entryAvailable = true
  } catch {
    /* Keep the public lobby available when storage is unavailable. */
  }
  return configuration
}
