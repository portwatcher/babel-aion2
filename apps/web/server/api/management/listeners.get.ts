import { listManagementListeners } from '@babel/database/listeners'
import { requireAdministratorSession } from '../../utils/auth'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  await requireAdministratorSession(event)
  const { database, roomId } = await useListenerRoom(event)
  return { players: await listManagementListeners(database, roomId) }
})
