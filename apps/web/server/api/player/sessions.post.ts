import { entryRequestSchema } from '@babel/contracts'
import {
  listenerOperation,
  requireListenerCredential,
  requirePlayerOrigin,
  useListenerRoom,
  useListeners,
} from '../../utils/listeners'

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
    const { roomId } = await useListenerRoom(event)
    const session = await useListeners(event).enter(roomId, request.data, credential)
    setResponseStatus(event, session.state === 'JOINING' ? 202 : 200)
    return session
  })
})
