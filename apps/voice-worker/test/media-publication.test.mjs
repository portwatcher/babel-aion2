import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import opus from '@discordjs/opus'
import { RTCPeerConnection } from 'werift'
import { createDatabase } from '@babel/database'
import {
  createListenerService,
  subtitleConnectionsStopped,
} from '@babel/database/listeners'
import { MediaPeers } from '../src/media-peers.ts'
import { RoomAudio } from '../src/room-audio.ts'
import {
  candidateSockets,
  portsReleased,
  until,
} from '../../../scripts/fixtures/media-worker.mjs'

test('published Opus reaches only its room; source retirement closes actual transports and fences pending negotiation without ending the listener', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'Use disposable PostgreSQL')
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  )
  const database = createDatabase(process.env.DATABASE_URL)
  const peers = new MediaPeers(database.db, { iceServers: [], iceUseIpv6: false })
  const rooms = [randomUUID(), randomUUID()]
  const names = rooms.map((id) => `publication-${id.slice(0, 16)}`)
  const receivers = []
  let audio
  let held
  t.after(async () => {
    await held?.query('rollback')
    held?.release()
    audio?.close()
    await peers.stop()
    await Promise.all(receivers.map((peer) => peer.close()))
    try {
      await database.pool.query(
        'delete from media_connection where session_id in (select id from listener_session where room_id = any($1))',
        [rooms],
      )
      await database.pool.query(
        'delete from listener_session where room_id = any($1)',
        [rooms],
      )
      await database.pool.query('delete from nickname where key = any($1)', [names])
      await database.pool.query('delete from room where id = any($1)', [rooms])
    } finally {
      await database.close()
    }
  })
  await database.pool.query('insert into room(id, name) values ($1, $2), ($3, $4)', [
    rooms[0],
    names[0],
    rooms[1],
    names[1],
  ])
  const service = createListenerService(database.db, {
    ready: () => peers.ready(),
    revokeMedia: (reference) => peers.revoke(reference),
    revokeSubtitles: (reference) => subtitleConnectionsStopped(database.db, reference),
  })
  async function enter(index) {
    const credential = randomBytes(32).toString('base64url')
    const session = await service.enter(
      rooms[index],
      { nickname: names[index], outputLanguage: null, requestId: randomUUID() },
      credential,
    )
    assert.equal(session.state, 'ACTIVE')
    return { session, credential }
  }
  async function connect(entry, attempt) {
    const offer = await peers.offer(
      randomUUID(),
      attempt,
      entry.session,
      entry.credential,
    )
    const peer = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    receivers.push(peer)
    const packets = []
    const decoder = new opus.OpusEncoder(48_000, 2)
    const pcm = []
    peer.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe((packet) => {
        packets.push(packet)
        pcm.push(Buffer.from(decoder.decode(packet.payload)))
      }),
    )
    await peer.setRemoteDescription(offer.description)
    await peer.setLocalDescription(await peer.createAnswer())
    await peers.answer(offer.connectionId, entry.session, entry.credential, {
      type: 'answer',
      sdp: peer.localDescription.sdp,
    })
    await until(() => peer.connectionState === 'connected', 'actual media receiver')
    return { offer, packets, pcm }
  }
  const a = await enter(0)
  const b = await enter(1)
  const first = await connect(a, 1)
  const other = await connect(b, 1)
  audio = new RoomAudio(
    () => true,
    (packet) => peers.publish(rooms[0], packet),
    () => assert.fail('Opus mixer failed'),
  )
  function speak() {
    const pcm = Buffer.alloc(960 * 2 * 2 * 5)
    for (let sample = 0; sample < pcm.length / 4; sample += 1) {
      const value = Math.round(10_000 * Math.sin((2 * Math.PI * sample) / 48))
      pcm.writeInt16LE(value, sample * 4)
      pcm.writeInt16LE(value, sample * 4 + 2)
    }
    audio.receive('synthetic-speaker', pcm)
  }
  speak()
  await until(() => first.pcm.length >= 4, 'decoded real Opus RTP')
  let nonzero = 0
  for (const frame of first.pcm) {
    assert.equal(frame.length, 960 * 2 * 2)
    for (let offset = 0; offset < frame.length; offset += 2) {
      if (Math.abs(frame.readInt16LE(offset)) > 500) {
        nonzero += 1
      }
    }
  }
  assert.ok(nonzero > 1_000, 'Transport delivered no audible synthetic PCM')
  assert.equal(other.packets.length, 0, 'Another room received this source')
  for (let i = 1; i < first.packets.length; i += 1) {
    assert.equal(
      (first.packets[i].header.sequenceNumber -
        first.packets[i - 1].header.sequenceNumber +
        65_536) %
        65_536,
      1,
    )
    assert.equal(
      (first.packets[i].header.timestamp - first.packets[i - 1].header.timestamp) >>> 0,
      960,
    )
  }
  audio.close()
  await peers.closeRoom(rooms[0])
  assert.ok(await portsReleased(candidateSockets(first.offer)))
  assert.ok(
    (
      await database.pool.query('select closed_at from media_connection where id=$1', [
        first.offer.connectionId,
      ])
    ).rows[0].closed_at,
  )
  await delay(50)
  const retiredCount = first.packets.length
  const encoder = new opus.OpusEncoder(48_000, 2)
  peers.publish(rooms[0], encoder.encode(Buffer.alloc(960 * 2 * 2)))
  await delay(50)
  assert.equal(first.packets.length, retiredCount)
  assert.equal(
    (await service.restore(a.session.sessionId, a.credential)).state,
    'ACTIVE',
  )

  // Hold the real nickname lock while registration starts. Closing the source
  // must invalidate this pending offer before any transport can be admitted.
  held = await database.pool.connect()
  await held.query('begin')
  const owner = (await held.query('select pg_backend_pid() as pid')).rows[0].pid
  await held.query('select key from nickname where key=$1 for update', [names[0]])
  const pendingId = randomUUID()
  const pending = peers.offer(pendingId, 2, a.session, a.credential).then(
    () => ({ accepted: true }),
    (error) => ({ accepted: false, code: error.code }),
  )
  await until(
    async () =>
      (
        await database.pool.query(
          'select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked',
          [owner],
        )
      ).rows[0].blocked,
    'pending media registration',
  )
  const retiring = peers.closeRoom(rooms[0])
  await held.query('commit')
  held.release()
  held = undefined
  assert.deepEqual(await pending, { accepted: false, code: 'BUSY' })
  await retiring
  assert.ok(
    (
      await database.pool.query('select closed_at from media_connection where id=$1', [
        pendingId,
      ])
    ).rows[0].closed_at,
  )
  const recovered = await connect(a, 3)
  audio = new RoomAudio(
    () => true,
    (packet) => peers.publish(rooms[0], packet),
    () => assert.fail('Opus mixer failed'),
  )
  speak()
  await until(() => recovered.packets.length >= 3, 'fresh source media negotiation')
  assert.equal(first.packets.length, retiredCount)
  assert.equal(other.packets.length, 0)
})
