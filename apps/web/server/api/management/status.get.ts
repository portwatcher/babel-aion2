import { requireAdministratorSession } from '../../utils/auth'
import {
  mediaReady,
  subtitlesReady,
  voiceSourceStatus,
} from '../../utils/media-control'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const { roomId } = await useListenerRoom(event)
  const [source, media, subtitles] = await Promise.all([
    voiceSourceStatus(roomId),
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
    availableProviders: subtitles ? ['soniox', 'deepl'] : [],
    configurationEditable: true,
  }
})
