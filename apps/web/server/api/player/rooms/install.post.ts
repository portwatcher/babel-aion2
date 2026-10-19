import { roomInstallSchema } from '@babel/contracts'
import { beginInstallation } from '@babel/database/community-rooms'
import { discordAuthorizeUrl } from '../../../services/discord-installation'
import {
  communityOperation,
  installationConfiguration,
  readCommunityBody,
} from '../../../utils/community-rooms'
import { useDatabase } from '../../../utils/database'
import { requirePlayerOrigin } from '../../../utils/listeners'
import { verifyAdmissionCharacter } from '../../../utils/room-admission'

export default defineEventHandler(async (event) => {
  requirePlayerOrigin(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = installationConfiguration(event)
  const body = roomInstallSchema.safeParse(await readCommunityBody(event))
  if (!body.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请填写房间名称、区服和有效的角色 ID 列表',
    })
  }
  // The host must be a real character on the room's server, as for player rooms.
  const host = await verifyAdmissionCharacter(
    { server: body.data.server, allowedIds: [] },
    body.data.hostId,
  )
  return communityOperation(async () => {
    const installation = await beginInstallation(useDatabase(event), {
      ...body.data,
      hostId: host.nickname,
    })
    setCookie(
      event,
      'babel-room-installation',
      `${installation.id}.${installation.browser}`,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(config.redirectUri).protocol === 'https:',
        path: '/',
        maxAge: 15 * 60,
      },
    )
    return {
      url: discordAuthorizeUrl(config.clientId, config.redirectUri, installation.state),
    }
  })
})
