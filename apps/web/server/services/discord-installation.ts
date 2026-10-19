import { z } from 'zod'

const snowflake = z.string().regex(/^[1-9][0-9]{16,19}$/)
export const BOT_PERMISSIONS = (1024n | 1048576n | 2097152n).toString()
const roleSchema = z.object({ id: snowflake, permissions: z.string().regex(/^\d+$/) })
const channelSchema = z.object({
  id: snowflake,
  name: z.string(),
  type: z.number(),
  guild_id: snowflake,
  permission_overwrites: z
    .array(
      z.object({
        id: snowflake,
        type: z.number(),
        allow: z.string().regex(/^\d+$/),
        deny: z.string().regex(/^\d+$/),
      }),
    )
    .default([]),
})
export class DiscordInstallationError extends Error {}

async function discordRequest(path: string, token: string, bot = true) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `${bot ? 'Bot' : 'Bearer'} ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new DiscordInstallationError('Discord request failed')
  }
  return response.json() as Promise<unknown>
}

export function discordAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
) {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds bot applications.commands',
    permissions: BOT_PERMISSIONS,
    integration_type: '0',
    state,
  }).toString()
  return url.toString()
}

export async function authorizeInstallation(
  config: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
) {
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new DiscordInstallationError('Authorization failed')
  }
  const token = z
    .object({ access_token: z.string().min(1), guild: z.object({ id: snowflake }) })
    .parse(await response.json())
  const identity = z
    .object({ id: snowflake })
    .parse(await discordRequest('/users/@me', token.access_token, false))
  const guilds = z
    .array(
      z.object({
        id: snowflake,
        permissions: z.string().regex(/^\d+$/),
        owner: z.boolean().optional(),
      }),
    )
    .parse(
      await discordRequest('/users/@me/guilds?limit=200', token.access_token, false),
    )
  const guild = guilds.find((guild) => guild.id === token.guild.id)
  if (!guild || (!guild.owner && (BigInt(guild.permissions) & (8n | 32n)) === 0n)) {
    throw new DiscordInstallationError('Server management permission required')
  }
  return { guildId: guild.id, creatorId: identity.id }
}

export async function installationChannels(
  guildId: string,
  botToken: string,
  clientId: string,
) {
  snowflake.parse(guildId)
  const application = z
    .object({ id: snowflake })
    .parse(await discordRequest('/oauth2/applications/@me', botToken))
  if (application.id !== clientId) {
    throw new DiscordInstallationError('Bot application mismatch')
  }
  const identity = z
    .object({ id: snowflake, bot: z.literal(true) })
    .parse(await discordRequest('/users/@me', botToken))
  const [rawMember, rawRoles, rawChannels] = await Promise.all([
    discordRequest(`/guilds/${guildId}/members/${identity.id}`, botToken),
    discordRequest(`/guilds/${guildId}/roles`, botToken),
    discordRequest(`/guilds/${guildId}/channels`, botToken),
  ])
  const member = z.object({ roles: z.array(snowflake) }).parse(rawMember)
  const roles = z.array(roleSchema).parse(rawRoles)
  const channels = z.array(channelSchema).parse(rawChannels)
  const roleIds = new Set([guildId, ...member.roles])
  let base = 0n
  for (const role of roles) {
    if (roleIds.has(role.id)) {
      base |= BigInt(role.permissions)
    }
  }
  return channels
    .filter((channel) => {
      if (channel.type !== 2 || channel.guild_id !== guildId) {
        return false
      }
      if ((base & 8n) !== 0n) {
        return true
      }
      let permissions = base
      const everyone = channel.permission_overwrites.find(
        (item) => item.type === 0 && item.id === guildId,
      )
      if (everyone) {
        permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow)
      }
      let deny = 0n
      let allow = 0n
      for (const item of channel.permission_overwrites) {
        if (item.type === 0 && item.id !== guildId && roleIds.has(item.id)) {
          deny |= BigInt(item.deny)
          allow |= BigInt(item.allow)
        }
      }
      permissions = (permissions & ~deny) | allow
      const own = channel.permission_overwrites.find(
        (item) => item.type === 1 && item.id === identity.id,
      )
      if (own) {
        permissions = (permissions & ~BigInt(own.deny)) | BigInt(own.allow)
      }
      return (permissions & BigInt(BOT_PERMISSIONS)) === BigInt(BOT_PERMISSIONS)
    })
    .map(({ id, name }) => ({ id, name }))
}
