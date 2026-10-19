import { roomCreationSchema } from '@babel/contracts'
import { createCommunityRoom, readInstallation } from '@babel/database/community-rooms'
import { installationChannels } from '../../../services/discord-installation'
import {
  communityOperation,
  installationConfiguration,
  installationCookie,
  readCommunityBody,
} from '../../../utils/community-rooms'
import { useDatabase } from '../../../utils/database'
import { requirePlayerOrigin } from '../../../utils/listeners'
import { roomCredentialCipher } from '../../../utils/management-configuration'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = installationConfiguration(event)
  const { id, browser } = installationCookie(event)
  const request = roomCreationSchema.safeParse(await readCommunityBody(event))
  if (!request.success) {
    throw createError({ statusCode: 400, statusMessage: '请选择语音频道' })
  }
  return communityOperation(async () => {
    const database = useDatabase(event)
    const installation = await readInstallation(database, id, browser)
    if (installation.consumedRoomId) {
      return { roomId: installation.consumedRoomId }
    }
    if (!installation.guildId || !installation.authorizedAt) {
      throw createError({ statusCode: 401, statusMessage: '请先完成 Discord 安装' })
    }
    const channels = await installationChannels(
      installation.guildId,
      config.botToken,
      config.clientId,
    )
    if (!channels.some((channel) => channel.id === request.data.voiceChannelId)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Bot 没有此语音频道的足够权限，请检查频道覆盖权限',
      })
    }
    const cipher = roomCredentialCipher(event)
    if (!cipher) {
      throw createError({ statusCode: 503, statusMessage: '凭据保护暂时不可用' })
    }
    return createCommunityRoom(
      database,
      id,
      browser,
      request.data.voiceChannelId,
      cipher,
      config.botToken,
    )
  })
})
