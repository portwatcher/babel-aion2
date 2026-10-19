import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { Pool } from 'pg'
import WebSocket from 'ws'
import { RTCPeerConnection } from 'werift'
import { startTestServer } from './test-server.mjs'
import {
  startMediaWorker,
  until,
  candidateSockets,
  portsBusy,
  portsReleased,
} from './fixtures/media-worker.mjs'

const databaseUrl = process.env.DATABASE_URL
await seedLegacyRoom(databaseUrl)
assert.ok(databaseUrl, 'Use disposable PostgreSQL')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))
const pool = new Pool({ connectionString: databaseUrl, max: 4 })
const secret = randomBytes(32).toString('base64url')
const nickname = `media-${randomUUID().slice(0, 12)}`
const receivers = []
const sockets = []
let worker
let first
let second
let held
let nextHeld

async function api(
  server,
  path,
  credential,
  body,
  method = 'POST',
  origin = server.origin,
) {
  return fetch(`${server.origin}${path}`, {
    method,
    headers: {
      origin,
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
}

async function enter(server) {
  const credential = randomBytes(32).toString('base64url')
  const response = await api(server, '/api/player/sessions', credential, {
    nickname,
    outputLanguage: null,
    requestId: randomUUID(),
  })
  assert.ok([200, 202].includes(response.status), 'Entry failed')
  return { session: await response.json(), credential }
}

async function media(
  server,
  entry,
  command,
  credential = entry.credential,
  origin = server.origin,
) {
  return api(
    server,
    `/api/player/sessions/${entry.session.sessionId}/media`,
    credential,
    command,
    'POST',
    origin,
  )
}

async function offer(server, entry, attempt) {
  const request = { operation: 'offer', connectionId: randomUUID(), attempt }
  const response = await media(server, entry, request)
  assert.equal(response.status, 200, 'Offer was not accepted')
  return { request, offer: await response.json() }
}

async function connect(server, entry, created) {
  const peer = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
  receivers.push(peer)
  await peer.setRemoteDescription(created.offer.description)
  await peer.setLocalDescription(await peer.createAnswer())
  const response = await media(server, entry, {
    operation: 'answer',
    connectionId: created.offer.connectionId,
    description: { type: 'answer', sdp: peer.localDescription.sdp },
  })
  assert.equal(response.status, 200, 'Answer was not accepted')
  await until(() => peer.connectionState === 'connected', 'actual WebRTC connection')
  assert.ok(
    peer
      .getTransceivers()
      .every((transceiver) => transceiver.currentDirection === 'recvonly'),
  )
  assert.ok(
    await portsBusy(candidateSockets(created.offer)),
    'Worker did not own its advertised sockets',
  )
  return peer
}

async function connectionClosed(id) {
  const result = await pool.query(
    'select closed_at from media_connection where id = $1',
    [id],
  )
  return Boolean(result.rows[0]?.closed_at)
}

async function playerSocket(server, entry) {
  const socket = new WebSocket(
    `${server.origin.replace('http:', 'ws:')}/api/player/ws`,
    { headers: { origin: server.origin } },
  )
  sockets.push(socket)
  const messages = []
  const closed = once(socket, 'close')
  socket.on('message', (data) => {
    const event = JSON.parse(data.toString())
    messages.push(event)
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
    () => messages.some((event) => event.type === 'session'),
    'player socket authentication',
  )
  return { messages, closed }
}

try {
  worker = await startMediaWorker(databaseUrl, secret)
  const environment = {
    NUXT_MEDIA_CONTROL_URL: worker.origin,
    NUXT_MEDIA_CONTROL_SECRET: secret,
  }
  first = await startTestServer(databaseUrl, { environment })
  second = await startTestServer(databaseUrl, { environment })
  assert.equal((await fetch(`${worker.origin}/ready`)).status, 401)
  const a = await enter(first)
  assert.equal(a.session.state, 'ACTIVE')
  const aSocket = await playerSocket(first, a)
  const a1 = await offer(first, a, 1)
  const replay = await media(first, a, a1.request)
  assert.equal(replay.status, 200)
  assert.ok((await replay.json()).description.sdp === a1.offer.description.sdp)
  await connect(first, a, a1)
  assert.equal(
    (await media(first, a, a1.request, randomBytes(32).toString('base64url'))).status,
    401,
  )
  assert.equal(
    (await media(first, a, a1.request, a.credential, 'https://attacker.example'))
      .status,
    403,
  )

  const a2 = await offer(second, a, 2)
  await until(
    () => connectionClosed(a1.request.connectionId),
    'prior negotiation acknowledgement',
  )
  assert.ok(
    await portsReleased(candidateSockets(a1.offer)),
    'Closed negotiation kept an actual UDP socket',
  )
  const aReceiver = await connect(second, a, a2)
  assert.equal(
    (
      await media(first, a, {
        operation: 'offer',
        connectionId: randomUUID(),
        attempt: 1,
      })
    ).status,
    409,
  )
  assert.equal((await media(first, a, a1.request)).status, 409)
  assert.equal(aReceiver.connectionState, 'connected')
  assert.ok(
    await portsBusy(candidateSockets(a2.offer)),
    'An obsolete request closed the current peer',
  )

  // Hold the real acknowledgement row, not a simulated transport callback. The
  // worker can close its sockets but replacement cannot claim delivery stopped.
  held = await pool.connect()
  await held.query('begin')
  await held.query('select id from media_connection where id = $1 for update', [
    a2.request.connectionId,
  ])
  const enteringB = enter(second)
  const joining = await until(async () => {
    const result = await pool.query(
      'select state, id from listener_session where nickname = $1 and id <> $2 order by nickname_generation desc limit 1',
      [nickname, a.session.sessionId],
    )
    return result.rows[0]
  }, 'replacement registration')
  assert.equal(joining.state, 'JOINING')
  await until(
    () => portsReleased(candidateSockets(a2.offer)),
    'actual sender socket release',
  )
  assert.equal(await connectionClosed(a2.request.connectionId), false)
  const uncertain = await pool.query(
    'select delivery_stopped_at from listener_session where id = $1',
    [a.session.sessionId],
  )
  assert.equal(uncertain.rows[0].delivery_stopped_at, null)
  await held.query('commit')
  held.release()
  held = undefined
  const b = await enteringB
  await aSocket.closed
  assert.ok(
    aSocket.messages.some(
      (event) =>
        event.type === 'session' &&
        event.session.terminalReason === 'DUPLICATE_NICKNAME_REPLACED',
    ),
  )
  await until(async () => {
    const response = await api(
      second,
      `/api/player/sessions/${b.session.sessionId}`,
      b.credential,
      undefined,
      'GET',
    )
    assert.equal(response.status, 200)
    b.session = await response.json()
    return b.session.state === 'ACTIVE'
  }, 'replacement authorization after both transports stop')
  assert.equal(
    (
      await media(first, a, {
        operation: 'offer',
        connectionId: randomUUID(),
        attempt: 3,
      })
    ).status,
    410,
  )
  const b1 = await offer(second, b, 1)
  await connect(second, b, b1)
  const delayed = await worker.control('/revoke', {
    sessionId: a.session.sessionId,
    nicknameGeneration: a.session.nicknameGeneration,
  })
  assert.equal(delayed.status, 200)
  assert.ok((await delayed.json()).stopped)
  assert.ok(
    await portsBusy(candidateSockets(b1.offer)),
    'Delayed old-session cleanup affected replacement',
  )
  const language = await api(
    first,
    `/api/player/sessions/${b.session.sessionId}/language`,
    b.credential,
    { outputLanguage: null },
    'PATCH',
  )
  assert.equal(language.status, 200)
  assert.equal((await language.json()).nicknameGeneration, b.session.nicknameGeneration)
  assert.ok(
    await portsBusy(candidateSockets(b1.offer)),
    'Subscription operation interrupted media',
  )

  const port = worker.port
  await worker.close()
  await until(
    () => connectionClosed(b1.request.connectionId),
    'graceful worker shutdown acknowledgement',
  )
  assert.ok(await portsReleased(candidateSockets(b1.offer)))
  worker = await startMediaWorker(databaseUrl, secret, port)
  const b2 = await offer(first, b, 2)
  await connect(first, b, b2)
  assert.equal((await media(first, b, b1.request)).status, 409)
  assert.equal(
    (
      await media(first, b, {
        operation: 'close',
        connectionId: b2.request.connectionId,
      })
    ).status,
    200,
  )
  held = await pool.connect()
  await held.query('begin')
  await held.query('select key from nickname where key = $1 for update', [nickname])
  const enteringC = enter(second)
  const blockedOnNickname = async () => {
    const result = await pool.query(
      "select count(*)::int as count from pg_stat_activity where wait_event_type = 'Lock' and query like '%nickname%'",
    )
    return result.rows[0].count
  }
  await until(
    async () => (await blockedOnNickname()) >= 1,
    'replacement waiting for nickname lock',
  )
  const lateId = randomUUID()
  const lateOffer = media(first, b, {
    operation: 'offer',
    connectionId: lateId,
    attempt: 3,
  })
  await until(
    async () => (await blockedOnNickname()) >= 2,
    'in-flight media admission waiting behind replacement',
  )
  await held.query('commit')
  held.release()
  held = undefined
  const c = await enteringC
  assert.equal(
    (await lateOffer).status,
    410,
    'Pre-revocation read admitted an obsolete negotiation',
  )
  assert.equal(
    (
      await pool.query(
        'select count(*)::int as count from media_connection where id = $1',
        [lateId],
      )
    ).rows[0].count,
    0,
  )
  assert.equal(c.session.state, 'ACTIVE')
  const c1 = await offer(second, c, 1)
  await connect(second, c, c1)
  // Slow persistence of the first peer's real close receipt overlaps three
  // recoveries. A later negotiation must never wait for an earlier one that is
  // itself waiting for the later one to initialize.
  held = await pool.connect()
  await held.query('begin')
  await held.query('select id from media_connection where id = $1 for update', [
    c1.request.connectionId,
  ])
  const recoveryRequests = [2, 3, 4].map((attempt) => ({
    operation: 'offer',
    connectionId: randomUUID(),
    attempt,
  }))
  const recovering = [media(first, c, recoveryRequests[0])]
  const blockedOnMedia = async () => {
    const result = await pool.query(
      "select count(*)::int as count from pg_stat_activity where wait_event_type = 'Lock' and query like '%media_connection%'",
    )
    return result.rows[0].count
  }
  await until(
    async () => (await blockedOnMedia()) >= 1,
    'first recovery waiting to supersede prior peer',
  )
  nextHeld = await pool.connect()
  await nextHeld.query('begin')
  // Queue this row lock behind the first recovery's UPDATE, before the worker
  // can queue its closed_at acknowledgement. Registration can then complete.
  const nextLock = nextHeld.query(
    'select id from media_connection where id = $1 for update',
    [c1.request.connectionId],
  )
  await until(async () => (await blockedOnMedia()) >= 2, 'queued close receipt lock')
  await held.query('commit')
  held.release()
  held = nextHeld
  nextHeld = undefined
  await nextLock
  for (let index = 0; index < recoveryRequests.length; index++) {
    if (index > 0) {
      recovering.push(media(first, c, recoveryRequests[index]))
    }
    await until(async () => {
      const result = await pool.query('select id from media_connection where id = $1', [
        recoveryRequests[index].connectionId,
      ])
      return result.rowCount === 1
    }, 'overlapping registered recovery')
  }
  await held.query('commit')
  held.release()
  held = undefined
  const recovered = await Promise.all(recovering)
  for (const response of recovered.slice(0, -1)) {
    assert.ok(
      [200, 409, 410].includes(response.status),
      `Obsolete recovery stalled with status ${response.status}`,
    )
  }
  const latestResponse = recovered.at(-1)
  assert.equal(latestResponse.status, 200, 'Concurrent recovery did not converge')
  const latest = {
    request: recoveryRequests.at(-1),
    offer: await latestResponse.json(),
  }
  await connect(first, c, latest)
  await until(async () => {
    const result = await pool.query(
      'select count(*)::int as count from media_connection where session_id = $1 and closed_at is null',
      [c.session.sessionId],
    )
    return result.rows[0].count === 1
  }, 'single surviving media connection after concurrent recovery')
  assert.ok(await portsReleased(candidateSockets(c1.offer)))
  const leave = await api(
    first,
    `/api/player/sessions/${c.session.sessionId}`,
    c.credential,
    undefined,
    'DELETE',
  )
  assert.equal(leave.status, 200)
  await until(
    () => connectionClosed(latest.request.connectionId),
    'explicit leave acknowledgement',
  )
  assert.ok(await portsReleased(candidateSockets(latest.offer)))
  console.log(
    'PASS media admission: actual receive-only WebRTC, idempotent offers, stale-attempt rejection, cross-web replacement, held acknowledgement, in-flight admission fencing, concurrent recovery, old-credential denial, scoped cleanup, language stability and graceful worker recovery. Discord/PCM delivery NOT RUN.',
  )
} finally {
  if (held) {
    await held.query('rollback')
    held.release()
  }
  if (nextHeld) {
    await nextHeld.query('rollback')
    nextHeld.release()
  }
  for (const socket of sockets) {
    socket.terminate()
  }
  await Promise.allSettled(receivers.map((peer) => peer.close()))
  await Promise.allSettled([first?.close(), second?.close()])
  await worker?.close()
  await pool.query('delete from listener_session where nickname = $1', [nickname])
  await pool.query('delete from nickname where key = $1', [nickname])
  await pool.end()
}
