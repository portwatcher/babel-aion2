import { listPublicListeners } from '@babel/database/listeners'
import { useListenerRoom } from '../../utils/listeners'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { database, roomId } = await useListenerRoom(event)
  return { players: await listPublicListeners(database, roomId) }
})
