import { mapStrokeInputSchema } from '@babel/contracts'
import { drawMap } from '@babel/database/tactical-map'
import { mapMember, mapOperation } from '../../../../../utils/tactical-map'
import { requirePlayerOrigin } from '../../../../../utils/listeners'
import { readCommunityBody } from '../../../../../utils/community-rooms'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const { database, roomId, sessionId, credential } = await mapMember(event)
  const body = mapStrokeInputSchema.safeParse(await readCommunityBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid map stroke' })
  }
  return mapOperation(async () => {
    await drawMap(database, roomId, sessionId, credential, body.data)
    return { saved: true }
  })
})
