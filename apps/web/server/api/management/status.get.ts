import { requireAdministratorSession } from '../../utils/auth'
import {
  mediaReady,
  subtitlesReady,
  voiceSourceStatus,
} from '../../utils/media-control'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  let roomId: string | null = null
  try {
    roomId = (await useListenerRoom(event)).roomId
  } catch (error) {
    if (!isError(error) || error.statusCode !== 404 || getQuery(event).roomId) {
      throw error
    }
  }
  const [source, media, subtitles] = await Promise.all([
    roomId ? voiceSourceStatus(roomId) : null,
    mediaReady(),
    subtitlesReady(),
  ])
  return {
    administrator: { email: identity.email },
    services: {
      discord: source?.state ?? 'UNAVAILABLE',
      media: media ? 'READY' : 'UNAVAILABLE',
      subtitles: subtitles ? 'READY' : 'UNAVAILABLE',
    },
    availableProviders: subtitles ? ['openai'] : [],
    configurationEditable: true,
  }
})
