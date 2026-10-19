import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import opus from '@discordjs/opus'
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket } from 'werift'
import { createDatabase } from '@babel/database'
import { createPlayerRoom } from '@babel/database/community-rooms'
import { registerRuntimeOwner } from '@babel/database/runtime-owners'
import {
  createListenerService,
  subtitleConnectionsStopped,
} from '@babel/database/listeners'
import { MediaPeers } from '../src/media-peers.ts'
import { createMediaNetwork } from '../src/media-network.ts'
import { PlayerSource } from '../src/player-source.ts'
import { RoomAudio } from '../src/room-audio.ts'
import { until } from '../../../scripts/fixtures/media-worker.mjs'

function tone() {
  const pcm = Buffer.alloc(960 * 2 * 2)
  for (let sample = 0; sample < 960; sample += 1) {
    const value = Math.round(10_000 * Math.sin((2 * Math.PI * sample) / 48))
    pcm.writeInt16LE(value, sample * 4)
    pcm.writeInt16LE(value, sample * 4 + 2)
  }
  return pcm
}

function audible(frames) {
  let count = 0
  for (const frame of frames) {
    for (let offset = 0; offset < frame.length; offset += 2) {
      if (Math.abs(frame.readInt16LE(offset)) > 500) {
        count += 1
      }
    }
  }
  return count
}

test('only the host character of a player-source room publishes; other listeners hear the host and the host hears nothing back', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'Use disposable PostgreSQL')
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  )
  const database = createDatabase(process.env.DATABASE_URL)
  const ownerId = randomUUID()
  await registerRuntimeOwner(database.db, ownerId)
  const peers = new MediaPeers(database.db, createMediaNetwork({}), ownerId)
  const suffix = randomUUID().slice(0, 12)
  const hostId = `host-${suffix}`
  const guestId = `guest-${suffix}`
  const browsers = []
  let roomId
  let audio
  let sending
  t.after(async () => {
    clearInterval(sending)
    audio?.close()
    await peers.stop()
    await Promise.all(browsers.map((peer) => peer.close()))
    try {
      if (roomId) {
        await database.pool.query(
          'delete from media_connection where session_id in (select id from listener_session where room_id = $1)',
          [roomId],
        )
        await database.pool.query('delete from listener_session where room_id = $1', [
          roomId,
        ])
        await database.pool.query('delete from audit_event where resource_id = $1', [
          roomId,
        ])
        await database.pool.query('delete from room where id = $1', [roomId])
      }
      await database.pool.query('delete from nickname where key = any($1)', [
        [hostId, guestId],
      ])
      await database.pool.query('delete from runtime_owner where id=$1', [ownerId])
    } finally {
      await database.close()
    }
  })

  const created = await createPlayerRoom(database.db, {
    name: `player-${suffix}`,
    server: 'siel',
    allowedIds: [guestId],
    hostId,
  })
  roomId = created.roomId
  const stored = (
    await database.pool.query(
      'select r.audio_source, r.host_character_id, r.discord_guild_id, c.allowed_ids, c.guild_id from room r join community_room c on c.room_id = r.id where r.id = $1',
      [roomId],
    )
  ).rows[0]
  assert.equal(stored.audio_source, 'PLAYER')
  assert.equal(stored.host_character_id, hostId)
  assert.equal(stored.discord_guild_id, null)
  assert.equal(stored.guild_id, null)
  assert.deepEqual(
    stored.allowed_ids,
    [guestId, hostId],
    'host joins its own allowlist',
  )

  const service = createListenerService(database.db, {
    ready: () => peers.ready(),
    revokeMedia: (reference) => peers.revoke(reference),
    revokeSubtitles: (reference) => subtitleConnectionsStopped(database.db, reference),
  })
  async function enter(nickname) {
    const credential = randomBytes(32).toString('base64url')
    const session = await service.enter(
      roomId,
      { nickname, outputLanguage: null, requestId: randomUUID() },
      credential,
      {
        nickname,
        server: 'siel',
        region: 'as',
        profileUrl: 'https://aion2index.com/',
        description: '',
      },
    )
    assert.equal(session.state, 'ACTIVE')
    return { session, credential }
  }
  async function connect(listener, attempt, microphone) {
    const offer = await peers.offer(
      randomUUID(),
      attempt,
      listener.session,
      listener.credential,
    )
    const peer = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    browsers.push(peer)
    const decoder = new opus.OpusEncoder(48_000, 2)
    const pcm = []
    peer.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe((packet) => {
        pcm.push(Buffer.from(decoder.decode(packet.payload)))
      }),
    )
    await peer.setRemoteDescription(offer.description)
    if (microphone && offer.uplinkMid) {
      const transceiver = peer
        .getTransceivers()
        .find((candidate) => candidate.mid === offer.uplinkMid)
      assert.ok(transceiver, 'uplink transceiver is negotiated')
      transceiver.direction = 'sendonly'
      await transceiver.sender.replaceTrack(microphone)
    }
    await peer.setLocalDescription(await peer.createAnswer())
    await peers.answer(offer.connectionId, listener.session, listener.credential, {
      type: 'answer',
      sdp: peer.localDescription.sdp,
    })
    await until(() => peer.connectionState === 'connected', 'browser media peer')
    return { offer, peer, pcm }
  }

  const received = []
  const removed = []
  const source = new PlayerSource(
    hostId,
    (id, pcm, name) => {
      received.push({ id, name, pcm })
      audio.receive(id, pcm)
    },
    (id) => removed.push(id),
  )
  audio = new RoomAudio(
    () => true,
    (packet) => peers.publish(roomId, packet),
    () => assert.fail('Opus mixer failed'),
  )
  peers.attachUplink(roomId, source)

  const host = await enter(hostId)
  const guest = await enter(guestId)
  const microphone = new MediaStreamTrack({ kind: 'audio' })
  const hostBrowser = await connect(host, 1, microphone)
  const guestBrowser = await connect(guest, 1, null)
  assert.ok(hostBrowser.offer.uplinkMid, 'host is offered an uplink')
  assert.equal(guestBrowser.offer.uplinkMid, null, 'guests cannot publish')

  const encoder = new opus.OpusEncoder(48_000, 2)
  const frame = encoder.encode(tone())
  let sequence = 0
  sending = setInterval(() => {
    sequence += 1
    microphone.writeRtp(
      new RtpPacket(
        new RtpHeader({
          payloadType: 111,
          sequenceNumber: sequence % 65_536,
          timestamp: (sequence * 960) >>> 0,
        }),
        frame,
      ),
    )
  }, 20)
  await until(() => received.length >= 5, 'decoded host microphone')
  assert.ok(received.every((item) => item.name === hostId))
  assert.equal(new Set(received.map((item) => item.id)).size, 1)
  assert.ok(audible(received.map((item) => item.pcm)) > 1_000)
  const [speaker] = source.status()
  assert.equal(speaker?.displayName, hostId)
  assert.ok(speaker.receivedFrames >= 5)
  await until(() => audible(guestBrowser.pcm) > 1_000, 'guest hears the host')
  assert.equal(hostBrowser.pcm.length, 0, 'host receives no copy of its own mix')

  // A detached source no longer receives host audio.
  peers.detachUplink(roomId, source)
  const detachedAt = received.length
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(received.length, detachedAt)

  // Closing the host peer removes the speaker; a stopped room offers no uplink.
  peers.attachUplink(roomId, source)
  await peers.disconnect(hostBrowser.offer.connectionId, host.session, host.credential)
  assert.deepEqual(removed, [received[0].id])
  assert.deepEqual(source.status(), [])
  await database.pool.query('update room set stopped = true where id = $1', [roomId])
  const stopped = await peers.offer(randomUUID(), 2, host.session, host.credential)
  assert.equal(stopped.uplinkMid, null)
})
