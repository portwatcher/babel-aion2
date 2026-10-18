import { createHash } from 'node:crypto'
import type { Database } from '@babel/database'
import { user } from '@babel/database/schema'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { assertSameOrigin, verifyAccessAssertion } from './access.ts'
import type { AccessConfiguration, AdministratorIdentity } from './access.ts'

export function administratorUserId(identity: AdministratorIdentity): string {
  const digest = createHash('sha256')
    .update(`${identity.issuer}\0${identity.subject}`)
    .digest('hex')
  return `cf_${digest}`
}

export function cloudflareAccess(
  database: Database,
  access: AccessConfiguration,
  siteUrl: string,
) {
  return {
    id: 'cloudflare-access',
    endpoints: {
      signInCloudflare: createAuthEndpoint(
        '/sign-in/cloudflare',
        { method: 'POST' },
        async (ctx) => {
          let identity: AdministratorIdentity
          try {
            assertSameOrigin(ctx.headers?.get('origin') ?? null, siteUrl)
            identity = await verifyAccessAssertion(
              ctx.headers?.get('cf-access-jwt-assertion') ?? '',
              access,
            )
          } catch {
            throw new APIError('UNAUTHORIZED', {
              message: 'Cloudflare Access sign-in required',
            })
          }
          const [administrator] = await database
            .insert(user)
            .values({
              id: administratorUserId(identity),
              email: identity.email.toLowerCase(),
              name: identity.email,
              emailVerified: true,
            })
            .onConflictDoUpdate({
              target: user.id,
              set: {
                email: identity.email.toLowerCase(),
                name: identity.email,
                updatedAt: new Date(),
              },
            })
            .returning()
          if (!administrator) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not save administrator identity',
            })
          }
          const session = await ctx.context.internalAdapter.createSession(
            administrator.id,
          )
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not create administrator session',
            })
          }
          await setSessionCookie(ctx, { session, user: administrator })
          return ctx.json({
            user: {
              id: administrator.id,
              name: administrator.name,
              email: administrator.email,
            },
            expiresAt: session.expiresAt,
          })
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
