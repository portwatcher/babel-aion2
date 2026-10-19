import { requireCommunityRoom } from '../../../../utils/community-rooms'
import { publicRoomConfiguration } from '../../../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { roomId, admission } = await requireCommunityRoom(event)
  const configuration = await publicRoomConfiguration(event, roomId)
  configuration.admission = {
    server: admission.server,
    restricted: admission.allowedIds.length > 0,
  }
  return configuration
})
