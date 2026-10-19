import type { H3Event } from 'h3'
import { nicknameSchema } from '@babel/contracts'
import { lookupCharacter, CharacterLookupError } from '../services/aion2-index'
import { requireCommunityRoom } from './community-rooms'

export async function checkRoomCharacter(event: H3Event, input: unknown) {
  const destination = await requireCommunityRoom(event)
  return {
    ...destination,
    profile: await verifyAdmissionCharacter(destination.admission, input),
  }
}

export async function verifyAdmissionCharacter(
  admission: { server: string; allowedIds: string[] },
  input: unknown,
) {
  const result = nicknameSchema.safeParse(input)
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: '请输入有效的游戏角色 ID' })
  }
  const id = result.data.normalize('NFC')
  const allowed = admission.allowedIds
  if (allowed.length && !allowed.includes(id)) {
    throw createError({
      statusCode: 403,
      statusMessage: '此角色不在房主指定的加入名单中',
    })
  }
  try {
    const profile = await lookupCharacter({
      nickname: result.data,
      server: admission.server,
    })
    return profile
  } catch (error) {
    if (error instanceof CharacterLookupError && error.code === 'NOT_FOUND') {
      throw createError({
        statusCode: 404,
        statusMessage: 'AION2 Index 未找到本区服的此角色，请检查角色 ID',
      })
    }
    throw createError({
      statusCode: 503,
      statusMessage: 'AION2 Index 暂时无法验证，请稍后重试',
    })
  }
}
