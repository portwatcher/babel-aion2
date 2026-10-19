import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'
import WebSocket from 'ws'
import { startTestServer } from './test-server.mjs'

const databaseUrl = process.env.DATABASE_URL
await seedLegacyRoom(databaseUrl)
assert.ok(databaseUrl, 'Use the disposable local database')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))
const pool = new Pool({ connectionString: databaseUrl, max: 2 })
const firstServer = await startTestServer(databaseUrl)
let secondServer
const sockets = []
const nickname = `ws-${randomUUID().slice(0, 8)}`

async function until(predicate, description) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const result = await predicate()
    if (result) {
      return result
    }
    await setTimeout(40)
  }
  throw new Error(`Timed out: ${description}`)
}

async function enter(server) {
  const credential = randomBytes(32).toString('base64url')
  const response = await fetch(`${server.origin}/api/player/sessions`, {
    method: 'POST',
    headers: {
      origin: server.origin,
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ nickname, outputLanguage: null, requestId: randomUUID() }),
  })
  assert.equal(response.status, 202)
  return { session: await response.json(), credential }
}

async function connect(server, entry, autoPong = true) {
  const socket = new WebSocket(
    `${server.origin.replace('http:', 'ws:')}/api/player/ws`,
    { headers: { origin: server.origin } },
  )
  sockets.push(socket)
  const messages = []
  const closed = once(socket, 'close')
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString())
    messages.push(message)
    if (autoPong && message.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', nonce: message.nonce }))
    }
  })
  await once(socket, 'open')
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      sessionId: entry.session.sessionId,
      credential: entry.credential,
    }),
  )
  return {
    socket,
    messages,
    closed,
    message: (predicate, label) => until(() => messages.find(predicate), label),
  }
}

async function openConnections(sessionId) {
  const result = await pool.query(
    'select count(*)::int as count from player_connection where session_id = $1 and closed_at is null',
    [sessionId],
  )
  return result.rows[0].count
}

try {
  secondServer = await startTestServer(databaseUrl)
  const foreign = new WebSocket(
    `${firstServer.origin.replace('http:', 'ws:')}/api/player/ws`,
    { headers: { origin: 'https://attacker.example' } },
  )
  sockets.push(foreign)
  const rejected = new Promise((resolve, reject) => {
    foreign.on('unexpected-response', (_request, response) => {
      response.resume()
      resolve(response.statusCode)
    })
    foreign.on('open', () => reject(new Error('Foreign origin upgraded')))
    foreign.on('error', () => {})
  })
  assert.equal(await rejected, 403)
  foreign.terminate()

  const a = await enter(firstServer)
  const invalid = await connect(firstServer, {
    ...a,
    credential: randomBytes(32).toString('base64url'),
  })
  await invalid.message(
    (m) => m.type === 'error' && m.code === 'INVALID_CREDENTIAL',
    'invalid credential rejection',
  )
  assert.equal((await invalid.closed)[0], 4401)
  assert.equal(
    invalid.messages.some((m) => m.type === 'players' || m.type === 'session'),
    false,
  )
  assert.equal(await openConnections(a.session.sessionId), 0)

  const current = await connect(firstServer, a, false)
  await current.message(
    (m) => m.type === 'session' && m.session.state === 'JOINING',
    'initial listener state',
  )
  await current.message(
    (m) =>
      m.type === 'players' &&
      m.players.some((p) => p.sessionId === a.session.sessionId),
    'complete player list',
  )
  assert.equal(await openConnections(a.session.sessionId), 1)
  const ping = await current.message(
    (m) => m.type === 'ping',
    'server heartbeat challenge',
  )
  await pool.query('update listener_session set last_seen_at = $1 where id = $2', [
    new Date(0),
    a.session.sessionId,
  ])
  current.socket.send(JSON.stringify({ type: 'pong', nonce: ping.nonce }))
  await until(
    async () =>
      (
        await pool.query('select last_seen_at from listener_session where id = $1', [
          a.session.sessionId,
        ])
      ).rows[0].last_seen_at.getTime() > 0,
    'persisted heartbeat',
  )

  // The replacement occurs in a different Node process. A local-only registry
  // cannot satisfy these assertions.
  const b = await enter(secondServer)
  const ended = await current.message(
    (m) => m.type === 'session' && m.session.state === 'REPLACED',
    'cross-process terminal message',
  )
  assert.equal(ended.session.terminalReason, 'DUPLICATE_NICKNAME_REPLACED')
  assert.equal((await current.closed)[0], 4409)
  await until(
    async () => (await openConnections(a.session.sessionId)) === 0,
    'confirmed physical socket close',
  )
  const oldReconnect = await connect(secondServer, a)
  await oldReconnect.message(
    (m) => m.type === 'session' && m.session.state === 'REPLACED',
    'old credential reconnect denial',
  )
  assert.equal((await oldReconnect.closed)[0], 4409)
  assert.equal(await openConnections(a.session.sessionId), 0)

  const live = await connect(secondServer, b)
  await live.message(
    (m) => m.type === 'configuration' && m.configuration.outputLanguages.length === 0,
    'public configuration',
  )
  live.socket.send(
    JSON.stringify({
      type: 'subtitle',
      translatedText: 'forbidden player publication',
    }),
  )
  assert.equal((await live.closed)[0], 4400)
  await until(
    async () => (await openConnections(b.session.sessionId)) === 0,
    'invalid publisher closed',
  )
  const recovered = await connect(firstServer, b)
  await recovered.message(
    (m) =>
      m.type === 'session' &&
      m.session.nicknameGeneration === b.session.nicknameGeneration,
    'same-generation network recovery',
  )
  recovered.socket.close()
  await recovered.closed
  await until(
    async () => (await openConnections(b.session.sessionId)) === 0,
    'normal browser close acknowledgement',
  )
  const restarting = await connect(firstServer, b)
  await restarting.message((m) => m.type === 'session', 'connection before restart')
  await firstServer.close()
  await restarting.closed
  await until(
    async () => (await openConnections(b.session.sessionId)) === 0,
    'server shutdown close acknowledgement',
  )
  const afterRestart = await connect(secondServer, b)
  await afterRestart.message(
    (m) => m.type === 'session' && m.session.sessionId === b.session.sessionId,
    'same listener after server shutdown',
  )
  afterRestart.socket.close()
  await afterRestart.closed
  assert.equal(
    (await pool.query('select generation from nickname where key = $1', [nickname]))
      .rows[0].generation,
    String(b.session.nicknameGeneration),
  )
  console.log(
    'PASS real player WebSockets across two Node processes: origin and credential isolation, heartbeat, list repair, terminal replacement, old reconnect denial, forbidden publication, close acknowledgements and server restart.',
  )
} finally {
  for (const socket of sockets) {
    socket.terminate()
  }
  await Promise.all([firstServer.close(), secondServer?.close()])
  await pool.query('delete from listener_session where nickname_key = $1', [nickname])
  await pool.query('delete from nickname where key = $1', [nickname])
  await pool.end()
}
