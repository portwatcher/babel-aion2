import { playerRoomCreationSchema } from '@babel/contracts'
import { createPlayerRoom } from '@babel/database/community-rooms'
import { communityOperation, readCommunityBody } from '../../../utils/community-rooms'
import { useDatabase } from '../../../utils/database'
import { requirePlayerOrigin } from '../../../utils/listeners'
import { verifyAdmissionCharacter } from '../../../utils/room-admission'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  if (!useRuntimeConfig(event).databaseUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: '房间服务暂时不可用，请稍后重试',
    })
  }
  const request = playerRoomCreationSchema.safeParse(await readCommunityBody(event))
  if (!request.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请填写房间名称、区服和有效的角色 ID 列表',
    })
  }
  // The host must be a real character on the room's server. The allowlist is
  // checked after creation adds the host, so it is not applied here.
  const host = await verifyAdmissionCharacter(
    { server: request.data.server, allowedIds: [] },
    request.data.hostId,
  )
  return communityOperation(() =>
    createPlayerRoom(useDatabase(event), { ...request.data, hostId: host.nickname }),
  )
})
