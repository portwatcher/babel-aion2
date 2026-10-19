import type { RoomDirectory } from '@babel/contracts'
import { listCommunityRooms } from '@babel/database/community-rooms'
import { useDatabase } from '../../../utils/database'

export default defineEventHandler(async (event): Promise<RoomDirectory> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event)
  const creationAvailable = Boolean(
    config.databaseUrl &&
    config.discordClientId &&
    config.discordClientSecret &&
    config.discordBotToken &&
    config.providerEncryptionKey,
  )
  if (!config.databaseUrl) {
    return { rooms: [], available: false, creationAvailable: false }
  }
  try {
    return {
      rooms: await listCommunityRooms(useDatabase(event)),
      available: true,
      creationAvailable,
    }
  } catch {
    return { rooms: [], available: false, creationAvailable: false }
  }
})
