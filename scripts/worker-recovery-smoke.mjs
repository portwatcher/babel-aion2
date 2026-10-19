import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { RTCPeerConnection } from 'werift'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { startTestServer } from './test-server.mjs'
import {
  candidateSockets,
  portsBusy,
  portsReleased,
  startMediaWorker,
  until,
} from './fixtures/media-worker.mjs'

test('a killed runtime releases real media, persists only its closure and reconnects the same listener automatically', async (t) => {
  const database = await isolatedDatabase()
  await seedLegacyRoom(database.url)
  const secret = randomBytes(32).toString('base64url')
  const peers = []
  let worker, other, web, held
  t.after(async () => {
    await held?.query('rollback')
    held?.release()
    await Promise.allSettled(peers.map((peer) => peer.close()))
    await web?.close()
    await Promise.allSettled([worker?.close(), other?.close()])
    await database.close()
  })
  worker = await startMediaWorker(database.url, secret)
  other = await startMediaWorker(database.url, secret)
  web = await startTestServer(database.url, {
    environment: {
      NUXT_MEDIA_CONTROL_URL: worker.origin,
      NUXT_MEDIA_CONTROL_SECRET: secret,
    },
  })
  async function entry() {
    const credential = randomBytes(32).toString('base64url')
    const response = await fetch(`${web.origin}/api/player/sessions`, {
      method: 'POST',
      headers: {
        origin: web.origin,
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        nickname: `recovery-${randomUUID().slice(0, 12)}`,
        outputLanguage: null,
        requestId: randomUUID(),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    assert.equal(response.status, 200)
    const reference = await response.json()
    assert.equal(reference.state, 'ACTIVE')
    return {
      reference: {
        sessionId: reference.sessionId,
        nicknameGeneration: reference.nicknameGeneration,
      },
      credential,
    }
  }
  async function connect(target, listener, attempt) {
    const response = await target.control('/media', {
      ...listener,
      request: { operation: 'offer', connectionId: randomUUID(), attempt },
    })
    assert.equal(response.status, 200, 'Recovered listener could not negotiate')
    const offer = await response.json()
    const peer = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    peers.push(peer)
    await peer.setRemoteDescription(offer.description)
    await peer.setLocalDescription(await peer.createAnswer())
    const answer = await target.control('/media', {
      ...listener,
      request: {
        operation: 'answer',
        connectionId: offer.connectionId,
        description: { type: 'answer', sdp: peer.localDescription.sdp },
      },
    })
    assert.equal(answer.status, 200)
    await until(() => peer.connectionState === 'connected', 'real DTLS recovery peer')
    assert.ok(await portsBusy(candidateSockets(offer)))
    return offer
  }
  const listener = await entry()
  const old = await connect(worker, listener, 1)
  const survivor = await connect(other, await entry(), 1)
  const before = worker.runtime()
  held = await database.pool.connect()
  await held.query('begin')
  const blocker = (await held.query('select pg_backend_pid() as pid')).rows[0].pid
  await held.query('select id from media_connection where id=$1 for update', [
    old.connectionId,
  ])
  process.kill(before.pid, 'SIGKILL')
  await until(() => portsReleased(candidateSockets(old)), 'killed runtime UDP release')
  async function waitingForReceipt() {
    return (
      await database.pool.query(
        'select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as blocked',
        [blocker],
      )
    ).rows[0].blocked
  }
  await until(waitingForReceipt, 'supervisor blocked on physical exit receipt')
  await until(
    async () => !(await waitingForReceipt()),
    'bounded receipt query times out',
  )
  await until(waitingForReceipt, 'supervisor retries persistence before restart')
  assert.equal(
    (
      await database.pool.query('select closed_at from media_connection where id=$1', [
        old.connectionId,
      ])
    ).rows[0].closed_at,
    null,
  )
  assert.equal(
    await worker.control('/ready').then(
      (response) => response.ok,
      () => false,
    ),
    false,
  )
  await held.query('commit')
  held.release()
  held = undefined
  await until(
    async () => {
      const { rows } = await database.pool.query(
        'select closed_at from media_connection where id=$1',
        [old.connectionId],
      )
      return rows[0].closed_at
    },
    'confirmed exit closes its durable registration',
    10_000,
  )
  await until(async () => {
    try {
      return worker.runtime().pid !== before.pid && (await worker.control('/ready')).ok
    } catch {
      return false
    }
  }, 'automatic worker restart after confirmed exit')
  assert.ok(await portsBusy(candidateSockets(survivor)))
  assert.equal(
    (
      await database.pool.query('select closed_at from media_connection where id=$1', [
        survivor.connectionId,
      ])
    ).rows[0].closed_at,
    null,
    'Recovery closed a different live runtime',
  )
  const fresh = await connect(worker, listener, 2)
  const session = (
    await database.pool.query(
      'select state, nickname_generation from listener_session where id=$1',
      [listener.reference.sessionId],
    )
  ).rows[0]
  assert.equal(session.state, 'ACTIVE')
  assert.equal(
    Number(session.nickname_generation),
    listener.reference.nicknameGeneration,
  )
  assert.notEqual(fresh.connectionId, old.connectionId)
  const obsolete = await worker.control('/media', {
    ...listener,
    request: { operation: 'offer', connectionId: old.connectionId, attempt: 1 },
  })
  assert.equal(obsolete.status, 409)
  assert.ok(await portsBusy(candidateSockets(fresh)))
})
