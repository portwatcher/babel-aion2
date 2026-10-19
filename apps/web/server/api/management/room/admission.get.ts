import { communityRoom } from '@babel/database/schema'
import { eq } from 'drizzle-orm'
import { requireAdministratorSession } from '../../../utils/auth'
import { useListenerRoom } from '../../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  await requireAdministratorSession(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const { database, roomId } = await useListenerRoom(event)
  const [admission] = await database
    .select()
    .from(communityRoom)
    .where(eq(communityRoom.roomId, roomId))
  return {
    admission: admission
      ? { server: admission.server, allowedIds: admission.allowedIds }
      : null,
  }
})
