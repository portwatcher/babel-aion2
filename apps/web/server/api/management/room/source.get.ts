import { requireAdministratorSession } from '../../../utils/auth'
import { useListenerRoom } from '../../../utils/room-configuration'
import { voiceSourceStatus } from '../../../utils/media-control'

export default defineEventHandler(async (event) => {
  await requireAdministratorSession(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { roomId } = await useListenerRoom(event)
  const source = await voiceSourceStatus(roomId)
  if (!source) {
    throw createError({ statusCode: 503, statusMessage: 'Voice worker unavailable' })
  }
  return source
})
