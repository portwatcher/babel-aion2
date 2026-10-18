import { administratorUserId, createAdministratorAuth } from '@babel/auth'
import { assertSameOrigin, verifyAccessAssertion } from '@babel/auth/access'
import type { AdministratorIdentity } from '@babel/auth/access'
import type { H3Event } from 'h3'
import { useDatabase } from './database'

let auth: ReturnType<typeof createAdministratorAuth> | undefined

export async function requireAdministrator(
  event: H3Event,
): Promise<AdministratorIdentity> {
  if (event.context.administrator) {
    return event.context.administrator
  }
  const config = useRuntimeConfig(event)
  if (!config.accessTeamDomain || !config.accessAudience) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Administrator Access is not configured',
    })
  }
  const assertion = getHeader(event, 'cf-access-jwt-assertion')
  if (!assertion) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Cloudflare Access sign-in required',
    })
  }
  let identity: AdministratorIdentity
  try {
    identity = await verifyAccessAssertion(assertion, {
      teamDomain: config.accessTeamDomain,
      audience: config.accessAudience,
    })
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cloudflare Access identity could not be verified',
    })
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
    try {
      assertSameOrigin(getHeader(event, 'origin') ?? null, config.siteUrl)
    } catch {
      throw createError({
        statusCode: 403,
        statusMessage: 'A same-origin request is required',
      })
    }
  }
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  event.context.administrator = identity
  return identity
}

export function useAdministratorAuth(event: H3Event) {
  if (!auth) {
    const config = useRuntimeConfig(event)
    if (config.betterAuthSecret.length < 32) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Administrator sessions are not configured',
      })
    }
    auth = createAdministratorAuth({
      database: useDatabase(event),
      secret: config.betterAuthSecret,
      siteUrl: config.siteUrl,
      access: { teamDomain: config.accessTeamDomain, audience: config.accessAudience },
    })
  }
  return auth
}

export async function requireAdministratorSession(event: H3Event) {
  const identity = await requireAdministrator(event)
  const session = await useAdministratorAuth(event).api.getSession({
    headers: event.headers,
  })
  if (session?.user.id !== administratorUserId(identity)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'An administrator session is required',
    })
  }
  return { identity, session }
}
