import { listPublicListeners } from '@babel/database/listeners'
import { requireCommunityRoom } from '../../../../utils/community-rooms'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { database, roomId } = await requireCommunityRoom(event)
  return { players: await listPublicListeners(database, roomId) }
})
