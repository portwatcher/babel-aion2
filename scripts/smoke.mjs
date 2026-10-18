import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { startTestServer } from './test-server.mjs'

const server = await startTestServer()
const { origin } = server
try {
  assert.equal((await fetch(origin)).status, 200)
  const configuration = await (await fetch(`${origin}/api/player/config`)).json()
  assert.deepEqual(configuration.outputLanguages, [])
  assert.equal(configuration.entryAvailable, false)
  for (const path of [
    '/admin',
    '/admin/settings',
    '/api/management/status',
    '/api/management/listeners',
    '/api/auth/get-session',
  ]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 401, path)
    const forged = await fetch(`${origin}${path}`, {
      headers: {
        'cf-access-jwt-assertion': 'fabricated',
        'cf-access-authenticated-user-email': 'operator@example.test',
      },
    })
    assert.equal(forged.status, 403, `${path}: forged identity`)
  }
  const entry = await fetch(`${origin}/api/player/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
    },
    body: JSON.stringify({
      nickname: '玩家',
      outputLanguage: null,
      requestId: crypto.randomUUID(),
    }),
  })
  assert.equal(entry.status, 503)
  assert.equal((await fetch(`${origin}/api/health/ready`)).status, 503)
  console.log(
    'PASS built HTTP smoke: public lobby, empty languages, Access boundaries, closed entry and readiness.',
  )
} finally {
  await server.close()
}
