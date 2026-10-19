import { readInstallation } from '@babel/database/community-rooms'
import { installationChannels } from '../../../services/discord-installation'
import {
  communityOperation,
  installationConfiguration,
  installationCookie,
} from '../../../utils/community-rooms'
import { useDatabase } from '../../../utils/database'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return communityOperation(async () => {
    const config = installationConfiguration(event)
    const { id, browser } = installationCookie(event)
    const installation = await readInstallation(useDatabase(event), id, browser)
    if (!installation.authorizedAt || !installation.guildId) {
      throw createError({ statusCode: 401, statusMessage: '请先完成 Discord 安装' })
    }
    return {
      name: installation.name,
      server: installation.server,
      allowedIds: installation.allowedIds,
      roomId: installation.consumedRoomId,
      channels: (
        await installationChannels(
          installation.guildId,
          config.botToken,
          config.clientId,
        )
      ).filter(
        (channel) =>
          !installation.sharedVoiceChannelId ||
          channel.id === installation.sharedVoiceChannelId,
      ),
    }
  })
})
