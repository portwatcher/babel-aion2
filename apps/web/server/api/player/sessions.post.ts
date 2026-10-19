import { entryRequestSchema } from '@babel/contracts'
import { communityRoom } from '@babel/database/schema'
import { eq } from 'drizzle-orm'
import { verifyAdmissionCharacter } from '../../utils/room-admission'
import {
  listenerOperation,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../utils/listeners'
import { useListenerRoom } from '../../utils/room-configuration'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const request = entryRequestSchema.safeParse(await readBody(event))
  if (!request.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid listener entry',
      data: request.error.flatten(),
    })
  }
  return listenerOperation(async () => {
    const { database, roomId } = await useListenerRoom(event)
    const [admission] = await database
      .select()
      .from(communityRoom)
      .where(eq(communityRoom.roomId, roomId))
    const character = admission
      ? await verifyAdmissionCharacter(admission, request.data.nickname)
      : undefined
    const session = await useListeners(event).enter(
      roomId,
      request.data,
      credential,
      character,
    )
    setResponseStatus(event, session.state === 'JOINING' ? 202 : 200)
    return session
  })
})
