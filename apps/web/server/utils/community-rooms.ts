import { z } from 'zod'
import { roomNumberParameterSchema } from '@babel/contracts'
import { and, eq, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { communityRoom, room } from '@babel/database/schema'
import { CommunityRoomError } from '@babel/database/community-rooms'
import { useDatabase } from './database'
import { readJsonBody } from './bounded-json'

function publicRoomNumber(event: H3Event) {
  const result = roomNumberParameterSchema.safeParse(getRouterParam(event, 'roomId'))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid room number' })
  }
  return result.data
}
export async function requireCommunityRoom(event: H3Event) {
  const roomNumber = publicRoomNumber(event)
  const database = useDatabase(event)
  const [record] = await database
    .select({ room, admission: communityRoom })
    .from(room)
    .innerJoin(communityRoom, eq(room.id, communityRoom.roomId))
    .where(and(eq(communityRoom.number, roomNumber), isNull(room.disbandedAt)))
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: '房间不存在' })
  }
  return { database, roomId: record.room.id, ...record }
}
export function installationConfiguration(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (
    !config.discordClientId ||
    !config.discordClientSecret ||
    !config.discordBotToken ||
    !config.providerEncryptionKey
  ) {
    throw createError({ statusCode: 503, statusMessage: 'Discord 房间创建尚未配置' })
  }
  return {
    clientId: config.discordClientId,
    clientSecret: config.discordClientSecret,
    botToken: config.discordBotToken,
    redirectUri: new URL('/api/discord/callback', config.siteUrl).toString(),
  }
}
export function installationCookie(event: H3Event) {
  const value = getCookie(event, 'babel-room-installation') ?? ''
  const parsed = z
    .object({ id: z.uuid(), browser: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse({ id: value.split('.')[0], browser: value.split('.')[1] })
  if (!parsed.success) {
    throw createError({ statusCode: 401, statusMessage: '请先安装 Discord Bot' })
  }
  return parsed.data
}
export function readCommunityBody(event: H3Event) {
  return readJsonBody(event)
}
export async function communityOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CommunityRoomError) {
      throw createError({
        statusCode: error.code === 'SOURCE_CHANNEL_CONFLICT' ? 409 : 401,
        statusMessage:
          error.code === 'SOURCE_CHANNEL_CONFLICT'
            ? '同一 Discord 服务器的房间共享音频来源，请使用现有语音频道'
            : '安装已过期，请重新安装',
      })
    }
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    throw createError({
      statusCode: 503,
      statusMessage: '房间服务暂时不可用，请稍后重试',
    })
  }
}
