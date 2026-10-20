import { languageChangeSchema } from '@babel/contracts'
import { readJsonBody } from '../../../../utils/bounded-json'
import {
  listenerOperation,
  listenerSessionId,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../../../utils/listeners'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const id = listenerSessionId(event)
  const request = languageChangeSchema.safeParse(await readJsonBody(event))
  if (!request.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid output language' })
  }
  return listenerOperation(() =>
    useListeners(event).changeLanguage(id, credential, request.data.outputLanguage),
  )
})
