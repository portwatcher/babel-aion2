import { administratorUserId } from '@babel/auth'
import { listenerReferenceSchema } from '@babel/contracts'
import { readJsonBody } from '../../../utils/bounded-json'
import { requireAdministratorSession } from '../../../utils/auth'
import {
  listenerOperation,
  listenerSessionId,
  useListeners,
} from '../../../utils/listeners'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const body: unknown = await readJsonBody(event)
  const reference = listenerReferenceSchema.safeParse({
    ...(typeof body === 'object' && body !== null ? body : {}),
    sessionId: listenerSessionId(event),
  })
  if (!reference.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid listener reference' })
  }
  const removed = await listenerOperation(() =>
    useListeners(event).remove(reference.data, administratorUserId(identity)),
  )
  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Listener generation not found',
    })
  }
  return removed
})
