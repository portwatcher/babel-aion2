import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { administratorUserId, createAdministratorAuth } from '@babel/auth'
import { user } from '@babel/database/schema'
import { eq } from 'drizzle-orm'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createDatabase } from '../src/client.ts'

test('verified Access sign-in persists a Better Auth session that survives a new auth instance', async (t) => {
  const connectionString = process.env.DATABASE_URL
  assert.ok(connectionString, 'Set DATABASE_URL to the disposable local database')
  const database = createDatabase(connectionString)
  const keys = await generateKeyPair('RS256')
  const access = {
    teamDomain: 'babel-database.cloudflareaccess.com',
    audience: 'babel-local-test',
  }
  const issuer = `https://${access.teamDomain}`
  const subject = randomUUID()
  const email = `${subject}@example.test`
  const userId = administratorUserId({ subject, email, issuer })
  const publicKey = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'database-test',
    alg: 'RS256',
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [publicKey] }))
  const assertion = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'database-test' })
    .setIssuer(issuer)
    .setAudience(access.audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  const options = {
    database: database.db,
    access,
    siteUrl: 'http://localhost:3000',
    secret: randomBytes(48).toString('base64'),
  }
  try {
    const auth = createAdministratorAuth(options)
    const response = await auth.handler(
      new Request(`${options.siteUrl}/api/auth/sign-in/cloudflare`, {
        method: 'POST',
        headers: { origin: options.siteUrl, 'cf-access-jwt-assertion': assertion },
      }),
    )
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.user.id, userId)
    assert.equal(result.token, undefined)
    const cookies = response.headers.getSetCookie()
    assert.ok(cookies.some((cookie) => /HttpOnly/i.test(cookie)))
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ')
    const restartedAuth = createAdministratorAuth(options)
    const restored = await restartedAuth.api.getSession({
      headers: new Headers({ cookie }),
    })
    assert.equal(restored?.user.id, userId)
    assert.equal(restored?.user.email, email)

    const forged = await auth.handler(
      new Request(`${options.siteUrl}/api/auth/sign-in/cloudflare`, {
        method: 'POST',
        headers: { origin: options.siteUrl, 'cf-access-jwt-assertion': 'fabricated' },
      }),
    )
    assert.equal(forged.status, 401)
  } finally {
    await database.db.delete(user).where(eq(user.id, userId))
    await database.close()
  }
})
