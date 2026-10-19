import { entryRequestSchema } from '@babel/contracts'
import { checkRoomCharacter } from '../../../../utils/room-admission'
import { readCommunityBody } from '../../../../utils/community-rooms'
import {
  listenerOperation,
  requireListenerCredential,
  requirePlayerOrigin,
  useListeners,
} from '../../../../utils/listeners'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  const credential = requireListenerCredential(event)
  const request = entryRequestSchema.safeParse(await readCommunityBody(event))
  if (!request.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请检查游戏角色 ID 和字幕语言',
    })
  }
  const { roomId, profile } = await checkRoomCharacter(event, request.data.nickname)
  return listenerOperation(async () => {
    const session = await useListeners(event).enter(
      roomId,
      { ...request.data, nickname: profile.nickname },
      credential,
      profile,
    )
    setResponseStatus(event, session.state === 'JOINING' ? 202 : 200)
    return session
  })
})
