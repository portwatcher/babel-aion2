import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { startMediaWorker, until } from './fixtures/media-worker.mjs'
import { startTestServer } from './test-server.mjs'

test('confirmed web process exit releases only its sockets, preserves reconnect identity and unblocks replacement without accepting old credentials', async (t) => {
  const database = await isolatedDatabase()
  await seedLegacyRoom(database.url)
  const secret = randomBytes(32).toString('base64url')
  const sockets = []
  let worker, first, second, held
  t.after(async () => {
    await held?.query('rollback')
    held?.release()
    for (const socket of sockets) {
      socket.terminate()
    }
    await Promise.allSettled([first?.close(), second?.close()])
    await worker?.close()
    await database.close()
  })
  worker = await startMediaWorker(database.url, secret)
  const environment = {
    NUXT_MEDIA_CONTROL_URL: worker.origin,
    NUXT_MEDIA_CONTROL_SECRET: secret,
  }
  first = await startTestServer(database.url, { environment })
  second = await startTestServer(database.url, { environment })
  async function api(server, entry, path, method = 'GET', body) {
    return fetch(`${server.origin}${path}`, {
      method,
      headers: {
        origin: server.origin,
        authorization: `Bearer ${entry.credential}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }
  async function enter(nickname = `web-crash-${randomUUID().slice(0, 12)}`) {
    const credential = randomBytes(32).toString('base64url')
    const response = await api(second, { credential }, '/api/player/sessions', 'POST', {
      nickname,
      outputLanguage: null,
      requestId: randomUUID(),
    })
    assert.ok([200, 202].includes(response.status))
    return { nickname, credential, session: await response.json() }
  }
  async function connect(server, entry) {
    const socket = new WebSocket(
      `${server.origin.replace('http:', 'ws:')}/api/player/ws`,
      {
        origin: server.origin,
      },
    )
    sockets.push(socket)
    const events = [],
      closed = once(socket, 'close')
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString())
      events.push(event)
      if (event.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
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
    await until(
      () => events.some((event) => event.type === 'session'),
      'real authenticated player socket',
    )
    return { socket, events, closed }
  }
  async function registrations(entry) {
    return (
      await database.pool.query(
        'select id, closed_at from player_connection where session_id=$1 order by opened_at',
        [entry.session.sessionId],
      )
    ).rows
  }
  const entry = await enter(),
    other = await enter()
  assert.equal(entry.session.state, 'ACTIVE')
  const old = await connect(first, entry),
    survivor = await connect(second, other)
  assert.equal((await registrations(entry)).filter((row) => !row.closed_at).length, 1)
  const oldId = (await registrations(entry))[0].id
  const sameListener = await connect(second, entry)
  const survivorId = (await registrations(entry)).at(-1).id
  const originalPid = first.runtime().pid
  process.kill(originalPid, 'SIGKILL')
  assert.equal((await old.closed)[0], 1006, 'Killed transport did not physically close')
  await until(
    async () => (await registrations(entry)).find((row) => row.id === oldId).closed_at,
    'confirmed web exit persisted its socket closure',
  )
  await until(async () => {
    try {
      return (
        first.runtime().pid !== originalPid &&
        (await fetch(`${first.origin}/api/health/ready`)).ok
      )
    } catch {
      return false
    }
  }, 'automatic web process restart')
  const recovered = await connect(first, entry)
  const snapshot = recovered.events.find((event) => event.type === 'session').session
  assert.equal(snapshot.sessionId, entry.session.sessionId)
  assert.equal(snapshot.nicknameGeneration, entry.session.nicknameGeneration)
  assert.equal(sameListener.socket.readyState, WebSocket.OPEN)
  assert.equal(
    (await registrations(entry)).find((row) => row.id === survivorId).closed_at,
    null,
  )
  assert.equal(survivor.socket.readyState, WebSocket.OPEN)
  assert.equal((await registrations(other)).filter((row) => !row.closed_at).length, 1)

  const open = (await registrations(entry)).find(
    (row) => !row.closed_at && row.id !== survivorId,
  )
  assert.ok(open)
  held = await database.pool.connect()
  await held.query('begin')
  await held.query('select id from player_connection where id=$1 for update', [open.id])
  process.kill(first.runtime().pid, 'SIGKILL')
  await recovered.closed
  const replacement = await enter(entry.nickname)
  assert.equal(
    replacement.session.state,
    'JOINING',
    'Replacement bypassed uncertain delivery',
  )
  const pending = (
    await database.pool.query(
      'select delivery_stopped_at from listener_session where id=$1',
      [entry.session.sessionId],
    )
  ).rows[0]
  assert.equal(pending.delivery_stopped_at, null)
  await held.query('commit')
  held.release()
  held = undefined
  await until(async () => {
    const response = await api(
      second,
      replacement,
      `/api/player/sessions/${replacement.session.sessionId}`,
    )
    assert.equal(response.status, 200)
    replacement.session = await response.json()
    return replacement.session.state === 'ACTIVE'
  }, 'replacement activation after confirmed web exit')
  assert.ok(replacement.session.nicknameGeneration > entry.session.nicknameGeneration)
  assert.equal((await sameListener.closed)[0], 4409)
  const denied = await connect(second, entry)
  assert.equal((await denied.closed)[0], 4409)
  assert.equal(
    denied.events.find((event) => event.type === 'session').session.terminalReason,
    'DUPLICATE_NICKNAME_REPLACED',
  )
  assert.equal(
    denied.events.some(
      (event) => event.type === 'subtitles' || event.type === 'players',
    ),
    false,
  )
  assert.ok((await registrations(entry)).every((row) => row.closed_at))
  assert.equal(survivor.socket.readyState, WebSocket.OPEN)
  assert.equal((await registrations(other)).filter((row) => !row.closed_at).length, 1)
  const normalShutdown = await connect(second, replacement)
  await second.close()
  assert.equal(
    (await normalShutdown.closed)[0],
    1012,
    'Normal restart closed the socket abnormally',
  )
  assert.equal((await survivor.closed)[0], 1012)
  assert.ok((await registrations(replacement)).every((row) => row.closed_at))
})
