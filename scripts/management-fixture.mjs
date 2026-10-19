import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import { startTestServer } from './test-server.mjs'

export async function createManagementFixture(databaseUrl, { legacyRoom = true } = {}) {
  if (legacyRoom) {
    await seedLegacyRoom(databaseUrl)
  }
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))
  const subject = randomUUID()
  const issuer = 'https://babel-smoke.cloudflareaccess.com'
  const keys = await generateKeyPair('RS256')
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'local-management',
    alg: 'RS256',
  }
  const key = randomBytes(32)
  const environment = {
    BABEL_TEST_JWKS: JSON.stringify({ keys: [jwk] }),
    NUXT_ACCESS_TEAM_DOMAIN: new URL(issuer).hostname,
    NUXT_ACCESS_AUDIENCE: 'babel-smoke',
    NUXT_PROVIDER_ENCRYPTION_KEY: key.toString('base64'),
    NUXT_BETTER_AUTH_SECRET: randomBytes(48).toString('base64'),
  }
  async function assertion() {
    return new SignJWT({ email: `${subject}@example.test` })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(issuer)
      .setAudience('babel-smoke')
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keys.privateKey)
  }
  return {
    environment: Object.freeze(environment),
    key,
    actor: `cf_${createHash('sha256').update(`${issuer}\0${subject}`).digest('hex')}`,
    assertion,
    start(overrides = {}, nodeImports = []) {
      return startTestServer(databaseUrl, {
        nodeImports: ['./scripts/fixtures/access-jwks.mjs', ...nodeImports],
        environment: { ...environment, ...overrides },
      })
    },
    async signIn(server) {
      const jwt = await assertion()
      const response = await fetch(`${server.origin}/api/auth/sign-in/cloudflare`, {
        method: 'POST',
        headers: {
          origin: server.origin,
          'cf-access-jwt-assertion': jwt,
          'content-type': 'application/json',
        },
        body: '{}',
      })
      assert.equal(response.status, 200, 'Verified Access identity must sign in')
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ')
      assert.ok(cookie)
      return { jwt, cookie }
    },
  }
}
