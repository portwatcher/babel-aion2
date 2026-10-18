import { mediaRequestSchema } from '@babel/contracts'
import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../../../utils/listeners'
import { mediaOperation } from '../../../../utils/media-control'
import { readBoundedJson, BodyInputError } from '../../../../utils/bounded-json'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  let body: unknown
  try {
    body = await readBoundedJson(event, 80 * 1024)
  } catch (error) {
    if (!(error instanceof BodyInputError)) {
      throw error
    }
    throw createError({
      statusCode: error.code === 'TOO_LARGE' ? 413 : 400,
      statusMessage: 'Invalid media request',
    })
  }
  const request = mediaRequestSchema.safeParse(body)
  if (!request.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid media request' })
  }
  return listenerOperation(async () => {
    const session = await useListeners(event).restore(id, credential)
    if (session.state !== 'ACTIVE') {
      throw createError({
        statusCode: session.state === 'JOINING' ? 409 : 410,
        statusMessage: 'Listener is not authorized for media',
      })
    }
    return mediaOperation(session, credential, request.data)
  })
})
