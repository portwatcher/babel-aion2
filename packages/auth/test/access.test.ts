import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  assertSameOrigin,
  isAdministratorPath,
  verifyAccessAssertion,
} from '../src/access.ts'

test('Access accepts a signed identity and rejects forged, stale and misdirected assertions', async (t) => {
  const keys = await generateKeyPair('RS256')
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'operator-key',
    alg: 'RS256',
  }
  const config = {
    teamDomain: 'babel-unit.cloudflareaccess.com',
    audience: 'babel-test',
  }
  const issuer = `https://${config.teamDomain}`
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  })
  const now = Math.floor(Date.now() / 1_000)
  const claims = {
    sub: 'operator',
    email: 'operator@example.test',
    iss: issuer,
    aud: config.audience,
    iat: now,
    exp: now + 300,
  }
  const sign = (overrides = {}) =>
    new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'operator-key' })
      .sign(keys.privateKey)

  assert.deepEqual(await verifyAccessAssertion(await sign(), config), {
    subject: 'operator',
    email: 'operator@example.test',
    issuer,
  })
  for (const overrides of [
    { aud: 'another-application' },
    { iss: 'https://other.cloudflareaccess.com' },
    { exp: now - 1 },
    { nbf: now + 300 },
    { iat: now + 300 },
    { email: '' },
    { sub: '' },
  ]) {
    await assert.rejects(verifyAccessAssertion(await sign(overrides), config))
  }
  const attacker = await generateKeyPair('RS256')
  const forged = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'operator-key' })
    .sign(attacker.privateKey)
  await assert.rejects(verifyAccessAssertion(forged, config))
  await assert.rejects(verifyAccessAssertion('fabricated', config))
})

test('management mutations require the configured origin, including an explicit Origin header', () => {
  assert.doesNotThrow(() =>
    assertSameOrigin('https://babel.example', 'https://babel.example'),
  )
  for (const origin of [
    null,
    'null',
    'https://attacker.example',
    'https://babel.example.attacker.test',
  ]) {
    assert.throws(() => assertSameOrigin(origin, 'https://babel.example'))
  }
})

test('admin page, management API and auth paths share a boundary with public player routes excluded', () => {
  for (const path of [
    '/admin',
    '/admin/settings',
    '/api/management/status',
    '/api/auth/get-session',
    '/api/%6danagement/status',
    '/ADMIN',
    '/Admin/settings',
    '/API/Management/status',
  ]) {
    assert.equal(isAdministratorPath(path), true, path)
  }
  for (const path of [
    '/',
    '/api/player/config',
    '/administrator',
    '/api/management-public',
  ]) {
    assert.equal(isAdministratorPath(path), false, path)
  }
  assert.throws(() => isAdministratorPath('/api/%ZZ'))
})
