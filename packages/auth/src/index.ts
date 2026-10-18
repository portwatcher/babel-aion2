import type { Database } from '@babel/database'
import { account, session, user, verification } from '@babel/database/schema'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import type { AccessConfiguration } from './access.ts'
import { cloudflareAccess } from './cloudflare.ts'

export { administratorUserId } from './cloudflare.ts'

export function createAdministratorAuth(options: {
  database: Database
  secret: string
  siteUrl: string
  access: AccessConfiguration
}) {
  if (options.secret.length < 32) {
    throw new Error('The Better Auth secret must contain at least 32 characters')
  }
  return betterAuth({
    appName: 'Babel Administration',
    baseURL: options.siteUrl,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: [new URL(options.siteUrl).origin],
    database: drizzleAdapter(options.database, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60, updateAge: 15 * 60 },
    advanced: {
      cookiePrefix: 'babel-admin',
      useSecureCookies: new URL(options.siteUrl).protocol === 'https:',
    },
    plugins: [cloudflareAccess(options.database, options.access, options.siteUrl)],
  })
}
