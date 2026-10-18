import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { startTestServer } from './test-server.mjs'

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, 'Set DATABASE_URL to the disposable local PostgreSQL service')
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname),
  'HTTP database smoke is restricted to a local database',
)
const pool = new Pool({ connectionString: databaseUrl, max: 1 })
let server = await startTestServer(databaseUrl)
const nickname = `http-${randomUUID().slice(0, 8)}`
const credential = () => randomBytes(32).toString('base64url')
const a = {
  token: credential(),
  body: { nickname, outputLanguage: null, requestId: randomUUID() },
}
const b = {
  token: credential(),
  body: { nickname, outputLanguage: null, requestId: randomUUID() },
}

async function call(
  path,
  { token, method = 'GET', body, origin = server.origin } = {},
) {
  return fetch(`${server.origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method === 'GET' ? {} : { origin }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

try {
  assert.equal((await call('/api/health/ready')).status, 200)
  assert.equal(
    (await call('/api/player/sessions', { method: 'POST', body: a.body })).status,
    401,
  )
  assert.equal(
    (
      await call('/api/player/sessions', {
        method: 'POST',
        token: a.token,
        body: a.body,
        origin: 'https://attacker.example',
      })
    ).status,
    403,
  )
  const firstResponse = await call('/api/player/sessions', {
    method: 'POST',
    token: a.token,
    body: a.body,
  })
  assert.equal(firstResponse.status, 202)
  assert.match(firstResponse.headers.get('cache-control'), /no-store/)
  const first = await firstResponse.json()
  assert.equal(first.state, 'JOINING')
  assert.equal(
    (await call(`/api/player/sessions/${first.sessionId}`, { token: b.token })).status,
    401,
  )
  const secondResponse = await call('/api/player/sessions', {
    method: 'POST',
    token: b.token,
    body: b.body,
  })
  assert.equal(secondResponse.status, 202)
  const second = await secondResponse.json()
  assert.equal(second.nicknameGeneration, first.nicknameGeneration + 1)
  const replaced = await (
    await call(`/api/player/sessions/${first.sessionId}`, { token: a.token })
  ).json()
  assert.equal(replaced.terminalReason, 'DUPLICATE_NICKNAME_REPLACED')
  assert.equal(
    (
      await call(`/api/player/sessions/${first.sessionId}/heartbeat`, {
        method: 'POST',
        token: a.token,
      })
    ).status,
    410,
  )
  const repeated = await (
    await call('/api/player/sessions', { method: 'POST', token: a.token, body: a.body })
  ).json()
  assert.equal(repeated.sessionId, first.sessionId)
  assert.equal(repeated.state, 'REPLACED')
  assert.equal(
    (
      await call('/api/player/sessions', {
        method: 'POST',
        token: a.token,
        body: { ...a.body, nickname: `${nickname}x` },
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await call(`/api/player/sessions/${second.sessionId}/language`, {
        method: 'PATCH',
        token: b.token,
        body: { outputLanguage: 'ja' },
      })
    ).status,
    400,
  )
  const players = (await (await call('/api/player/players')).json()).players.filter(
    (p) => p.nickname === nickname,
  )
  assert.equal(players.length, 2)
  assert.equal(
    players.find((p) => p.sessionId === first.sessionId).state,
    'DISCONNECTING',
  )
  assert.deepEqual(Object.keys(players[0]).sort(), [
    'joinedAt',
    'nickname',
    'sessionId',
    'state',
  ])
  assert.equal(
    (
      await call(`/api/management/listeners/${second.sessionId}`, {
        method: 'DELETE',
        body: { nicknameGeneration: second.nicknameGeneration },
      })
    ).status,
    401,
  )

  await server.close()
  server = await startTestServer(databaseUrl)
  const restored = await (
    await call(`/api/player/sessions/${second.sessionId}`, { token: b.token })
  ).json()
  assert.deepEqual(restored, second)
  const removed = await (
    await call(`/api/player/sessions/${second.sessionId}`, {
      method: 'DELETE',
      token: b.token,
    })
  ).json()
  assert.equal(removed.terminalReason, 'PLAYER_LEFT')
  assert.equal(
    (
      await call(`/api/player/sessions/${second.sessionId}/heartbeat`, {
        method: 'POST',
        token: b.token,
      })
    ).status,
    410,
  )
  console.log(
    'PASS built HTTP + PostgreSQL: origin and bearer checks, replacement, request replay, language refusal, public list, management denial, process restart, and leave.',
  )
} finally {
  await server.close()
  await pool.query('delete from listener_session where nickname_key = $1', [nickname])
  await pool.query('delete from nickname where key = $1', [nickname])
  await pool.end()
}
