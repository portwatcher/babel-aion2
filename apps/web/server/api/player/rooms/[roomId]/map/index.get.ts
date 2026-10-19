import { readMap } from '@babel/database/tactical-map'
import { mapMember, mapOperation } from '../../../../../utils/tactical-map'

export default defineEventHandler(async (event) => {
  const { database, roomId, sessionId, credential } = await mapMember(event)
  return mapOperation(async () => ({
    strokes: await readMap(database, roomId, sessionId, credential),
  }))
})
