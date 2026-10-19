import { administratorUserId } from '@babel/auth'
import { roomAdmissionSchema } from '@babel/contracts'
import {
  publishExistingRoom,
  RoomPublicationError,
} from '@babel/database/room-publication'
import { requireAdministratorSession } from '../../../utils/auth'
import { readCommunityBody } from '../../../utils/community-rooms'
import { useListenerRoom } from '../../../utils/room-configuration'
import { useListeners } from '../../../utils/listeners'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  const input = roomAdmissionSchema.safeParse(await readCommunityBody(event))
  if (!input.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请选择区服并检查角色 ID 名单',
    })
  }
  const actor = administratorUserId(identity)
  const { database, roomId } = await useListenerRoom(event)
  try {
    const references = await publishExistingRoom(database, roomId, input.data, actor)
    // Revocation is already durable. Normal reconciliation retries closures if
    // either transport is unavailable, without authorizing old credentials.
    await Promise.allSettled(
      references.map((reference) => useListeners(event).remove(reference, actor)),
    )
    return { admission: input.data }
  } catch (error) {
    if (error instanceof RoomPublicationError) {
      const message = {
        NOT_FOUND: '房间不存在',
        SOURCE_UNCONFIGURED: '请先保存完整的 Discord 房间来源',
        ALREADY_PUBLISHED: '加入规则已确定，请重新加载',
        GUILD_IN_USE: '此 Discord 服务器已有其他房间',
      }
      throw createError({
        statusCode: error.code === 'NOT_FOUND' ? 404 : 409,
        statusMessage: message[error.code],
      })
    }
    throw createError({
      statusCode: 503,
      statusMessage: '暂时无法开放原有房间，请重试',
    })
  }
})
