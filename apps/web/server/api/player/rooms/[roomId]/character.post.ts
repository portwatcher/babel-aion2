import { checkRoomCharacter } from '../../../../utils/room-admission'
import { readCommunityBody } from '../../../../utils/community-rooms'
import { requirePlayerOrigin } from '../../../../utils/listeners'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const body = await readCommunityBody(event)
  return (
    await checkRoomCharacter(
      event,
      body && typeof body === 'object' && 'nickname' in body
        ? body.nickname
        : undefined,
    )
  ).profile
})
