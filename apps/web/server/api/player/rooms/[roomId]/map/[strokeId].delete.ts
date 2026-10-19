import { z } from 'zod'
import { eraseMap } from '@babel/database/tactical-map'
import { mapMember, mapOperation } from '../../../../../utils/tactical-map'
import { requirePlayerOrigin } from '../../../../../utils/listeners'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const { database, roomId, sessionId, credential } = await mapMember(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'strokeId'))
  if (!id.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid stroke ID' })
  }
  return mapOperation(async () => {
    await eraseMap(database, roomId, sessionId, credential, id.data)
    return { saved: true }
  })
})
