import type { RoomAudioSource, RoomDirectory } from '@babel/contracts'
import { listCommunityRooms } from '@babel/database/community-rooms'
import { useDatabase } from '../../../utils/database'

export default defineEventHandler(async (event): Promise<RoomDirectory> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event)
  const unavailable = {
    rooms: [],
    available: false,
    creationAvailable: false,
    creationSources: [],
  }
  if (!config.databaseUrl) {
    return unavailable
  }
  // Player-source rooms need no Discord application or bot credential.
  const creationSources: RoomAudioSource[] = ['PLAYER']
  if (
    config.discordClientId &&
    config.discordClientSecret &&
    config.discordBotToken &&
    config.providerEncryptionKey
  ) {
    creationSources.push('DISCORD')
  }
  try {
    return {
      rooms: await listCommunityRooms(useDatabase(event)),
      available: true,
      creationAvailable: true,
      creationSources,
    }
  } catch {
    return unavailable
  }
})
