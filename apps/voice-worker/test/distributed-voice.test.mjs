import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import opus from '@discordjs/opus'
import { voiceScaleMetricsSchema } from '@babel/contracts'
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket } from 'werift'
import { isolatedDatabase } from '../../../scripts/fixtures/isolated-database.mjs'
import {
  candidateSockets,
  portsReleased,
  startMediaWorker,
  until,
} from '../../../scripts/fixtures/media-worker.mjs'
import { startTestServer } from '../../../scripts/test-server.mjs'

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

async function startCharacterIndex() {
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://127.0.0.1').searchParams.get('q') ?? ''
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        suggestions: [
          {
            name,
            href: `/c/as/siel/${encodeURIComponent(name)}`,
            region: 'as',
            server: 'Siel',
            className: 'Ranger',
            level: 45,
          },
        ],
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

test(
  'multiple voice-worker replicas share one room source, relay audio to remote listeners, revoke across replicas and fail over on owner exit',
  { timeout: 60_000 },
  async (t) => {
    const database = await isolatedDatabase()
    const index = await startCharacterIndex()
    const secret = randomBytes(32).toString('base64url')
    const encryptionKey = randomBytes(32).toString('base64')
    const suffix = randomUUID().slice(0, 10)
    const hostId = `host-${suffix}`
    const guestA = `guestA-${suffix}`
    const guestB = `guestB-${suffix}`
    const browsers = []
    let worker1
    let worker2
    let web
    let sending

    t.after(async () => {
      clearInterval(sending)
      await Promise.allSettled(browsers.map((peer) => peer.close()))
      await Promise.allSettled([web?.close(), worker1?.close(), worker2?.close()])
      index.close()
      await database.close()
    })

    const { rows: roomRows } = await database.pool.query(
      `insert into room(name, stopped, audio_source, host_character_id)
       values ($1, false, 'PLAYER', $2) returning id`,
      [`dist-${suffix}`, hostId],
    )
    const roomId = roomRows[0].id
    const { rows: admissionRows } = await database.pool.query(
      `insert into community_room(room_id, server, allowed_ids)
       values ($1, 'siel', $2) returning number`,
      [roomId, JSON.stringify([guestA, guestB, hostId])],
    )
    const roomNumber = admissionRows[0].number

    const workerEnv = {
      BABEL_RUNTIME_POD_IP: '127.0.0.1',
      PROVIDER_ENCRYPTION_KEY: encryptionKey,
      MEDIA_OPUS_FRAME_MS: '20',
    }
    worker1 = await startMediaWorker(database.url, secret, undefined, workerEnv)
    worker2 = await startMediaWorker(database.url, secret, undefined, workerEnv)

    // Both replicas advertise their private control URL in PostgreSQL.
    await until(async () => {
      const { rows } = await database.pool.query(
        'select id, control_url from runtime_owner where exited_at is null and control_url is not null',
      )
      return rows.length === 2
    }, 'both voice workers registered control_url')

    // Exactly one replica claims the room's exclusive voice_source_run.
    const initialRun = await until(async () => {
      const { rows } = await database.pool.query(
        'select id, owner_id from voice_source_run where room_id = $1 and closed_at is null',
        [roomId],
      )
      return rows.length === 1 ? rows[0] : null
    }, 'exclusive source claim by one worker')

    const ownerWorker =
      worker1.runtime().ownerId === initialRun.owner_id ? worker1 : worker2
    const remoteWorker = ownerWorker === worker1 ? worker2 : worker1

    web = await startTestServer(database.url, {
      environment: {
        NUXT_MEDIA_CONTROL_URL: worker1.origin,
        NUXT_MEDIA_CONTROL_SECRET: secret,
        NUXT_PROVIDER_ENCRYPTION_KEY: encryptionKey,
        BABEL_TEST_COMMUNITY_ORIGIN: `http://127.0.0.1:${index.address().port}`,
      },
      nodeImports: ['./scripts/fixtures/community-network.mjs'],
    })

    async function json(response, expected = 200) {
      const text = await response.text()
      assert.equal(
        response.status,
        expected,
        `expected ${expected}, got ${response.status}: ${text}`,
      )
      return JSON.parse(text)
    }

    async function enter(nickname) {
      const credential = randomBytes(32).toString('base64url')
      const session = await json(
        await fetch(`${web.origin}/api/player/rooms/${roomNumber}/sessions`, {
          method: 'POST',
          headers: {
            origin: web.origin,
            'content-type': 'application/json',
            authorization: `Bearer ${credential}`,
          },
          body: JSON.stringify({
            nickname,
            outputLanguage: null,
            requestId: randomUUID(),
          }),
        }),
      )
      assert.equal(session.state, 'ACTIVE')
      return { session, credential }
    }

    async function connectPeer(listener, attempt, microphone = null) {
      const connectionId = randomUUID()
      const offer = await json(
        await fetch(
          `${web.origin}/api/player/sessions/${listener.session.sessionId}/media`,
          {
            method: 'POST',
            headers: {
              origin: web.origin,
              'content-type': 'application/json',
              authorization: `Bearer ${listener.credential}`,
            },
            body: JSON.stringify({ operation: 'offer', connectionId, attempt }),
          },
        ),
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
        assert.ok(transceiver, 'host uplink transceiver negotiated')
        transceiver.direction = 'sendonly'
        await transceiver.sender.replaceTrack(microphone)
      }
      await peer.setLocalDescription(await peer.createAnswer())
      await json(
        await fetch(
          `${web.origin}/api/player/sessions/${listener.session.sessionId}/media`,
          {
            method: 'POST',
            headers: {
              origin: web.origin,
              'content-type': 'application/json',
              authorization: `Bearer ${listener.credential}`,
            },
            body: JSON.stringify({
              operation: 'answer',
              connectionId: offer.connectionId,
              description: { type: 'answer', sdp: peer.localDescription.sdp },
            }),
          },
        ),
      )
      await until(() => peer.connectionState === 'connected', 'WebRTC peer connected')
      const { rows } = await database.pool.query(
        'select owner_id from media_connection where id = $1',
        [offer.connectionId],
      )
      return { offer, peer, pcm, ownerId: rows[0]?.owner_id }
    }

    const host = await enter(hostId)
    const listenerA = await enter(guestA)
    const listenerB = await enter(guestB)

    const microphone = new MediaStreamTrack({ kind: 'audio' })
    const hostPeer = await connectPeer(host, 1, microphone)
    assert.ok(hostPeer.offer.uplinkMid, 'host receives uplink transceiver')
    assert.equal(
      hostPeer.ownerId,
      ownerWorker.runtime().ownerId,
      'host uplink routes to the room source-owner worker',
    )

    // With host on ownerWorker (1 open peer) and 0 peers on remoteWorker, the
    // first receive-only listener lands on remoteWorker via least-loaded routing.
    const peerA = await connectPeer(listenerA, 1)
    assert.equal(
      peerA.ownerId,
      remoteWorker.runtime().ownerId,
      'least-loaded routing places first guest on the remote fan-out worker',
    )
    const peerB = await connectPeer(listenerB, 1)
    assert.ok(
      [ownerWorker.runtime().ownerId, remoteWorker.runtime().ownerId].includes(
        peerB.ownerId,
      ),
    )

    // Host publishes Opus tone -> source owner encodes and relays to remote worker.
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

    await until(
      () => audible(peerA.pcm) > 1_000 && audible(peerB.pcm) > 1_000,
      'both local and remote-replica listeners hear the host audio via inter-worker relay',
      15_000,
    )
    assert.equal(hostPeer.pcm.length, 0, 'host hears no loopback')

    // Replacing guestA revokes its WebRTC peer on the remote worker before activating.
    const replacement = await enter(guestA)
    assert.ok(
      replacement.session.nicknameGeneration > listenerA.session.nicknameGeneration,
    )
    assert.ok(
      await portsReleased(candidateSockets(peerA.offer)),
      'cross-replica replacement physically closes old UDP sockets on remote worker',
    )

    // Stopping the source-owner worker hands exclusive room ownership over to the survivor.
    await ownerWorker.close()
    const failedOver = await until(async () => {
      const { rows } = await database.pool.query(
        'select owner_id from voice_source_run where room_id = $1 and closed_at is null',
        [roomId],
      )
      return rows.length === 1 && rows[0].owner_id === remoteWorker.runtime().ownerId
        ? rows[0]
        : null
    }, 'surviving replica takes over voice source after owner exit')
    assert.equal(failedOver.owner_id, remoteWorker.runtime().ownerId)
  },
)

test(
  'fan-out-only burst worker prioritizes listener traffic without claiming room sources and exposes KEDA scale metrics',
  { timeout: 60_000 },
  async (t) => {
    const database = await isolatedDatabase()
    const index = await startCharacterIndex()
    const secret = randomBytes(32).toString('base64url')
    const encryptionKey = randomBytes(32).toString('base64')
    const suffix = randomUUID().slice(0, 10)
    const hostId = `bhost-${suffix}`
    const guestA = `bguestA-${suffix}`
    const guestB = `bguestB-${suffix}`
    const guestC = `bguestC-${suffix}`
    const browsers = []
    let baseWorker
    let burstWorker
    let web
    let sending

    t.after(async () => {
      clearInterval(sending)
      await Promise.allSettled(browsers.map((peer) => peer.close()))
      await Promise.allSettled([
        web?.close(),
        baseWorker?.close(),
        burstWorker?.close(),
      ])
      index.close()
      await database.close()
    })

    const { rows: roomRows } = await database.pool.query(
      `insert into room(name, stopped, audio_source, host_character_id)
       values ($1, false, 'PLAYER', $2) returning id`,
      [`burst-${suffix}`, hostId],
    )
    const roomId = roomRows[0].id
    const { rows: admissionRows } = await database.pool.query(
      `insert into community_room(room_id, server, allowed_ids)
       values ($1, 'siel', $2) returning number`,
      [roomId, JSON.stringify([guestA, guestB, guestC, hostId])],
    )
    const roomNumber = admissionRows[0].number

    // Start the fan-out-only burst worker FIRST so it would claim the room if it
    // lacked source-ownership fencing.
    burstWorker = await startMediaWorker(database.url, secret, undefined, {
      BABEL_RUNTIME_POD_IP: '127.0.0.1',
      MEDIA_FANOUT_ONLY: 'true',
      MEDIA_OPUS_FRAME_MS: '20',
    })
    assert.equal((await burstWorker.control('/ready')).status, 200)
    assert.equal((await burstWorker.control('/subtitles/ready')).status, 503)
    assert.equal((await burstWorker.control('/source', { roomId })).status, 404)
    const unowned = await database.pool.query(
      'select id from voice_source_run where room_id = $1 and closed_at is null',
      [roomId],
    )
    assert.equal(
      unowned.rows.length,
      0,
      'fan-out-only burst worker never claims room sources',
    )

    baseWorker = await startMediaWorker(database.url, secret, undefined, {
      BABEL_RUNTIME_POD_IP: '127.0.0.1',
      PROVIDER_ENCRYPTION_KEY: encryptionKey,
      MEDIA_OPUS_FRAME_MS: '20',
      SCALE_BURST_ACTIVATION_LISTENERS: '2',
      SCALE_BURST_LISTENERS_PER_REPLICA: '2',
    })
    await until(async () => {
      const { rows } = await database.pool.query(
        'select owner_id from voice_source_run where room_id = $1 and closed_at is null',
        [roomId],
      )
      return rows.length === 1 && rows[0].owner_id === baseWorker.runtime().ownerId
    }, 'base worker claims room source')

    web = await startTestServer(database.url, {
      environment: {
        NUXT_MEDIA_CONTROL_URL: baseWorker.origin,
        NUXT_MEDIA_CONTROL_SECRET: secret,
        NUXT_PROVIDER_ENCRYPTION_KEY: encryptionKey,
        BABEL_TEST_COMMUNITY_ORIGIN: `http://127.0.0.1:${index.address().port}`,
      },
      nodeImports: ['./scripts/fixtures/community-network.mjs'],
    })

    async function json(response, expected = 200) {
      const text = await response.text()
      assert.equal(
        response.status,
        expected,
        `expected ${expected}, got ${response.status}: ${text}`,
      )
      return JSON.parse(text)
    }

    async function enter(nickname) {
      const credential = randomBytes(32).toString('base64url')
      const session = await json(
        await fetch(`${web.origin}/api/player/rooms/${roomNumber}/sessions`, {
          method: 'POST',
          headers: {
            origin: web.origin,
            'content-type': 'application/json',
            authorization: `Bearer ${credential}`,
          },
          body: JSON.stringify({
            nickname,
            outputLanguage: null,
            requestId: randomUUID(),
          }),
        }),
      )
      assert.equal(session.state, 'ACTIVE')
      return { session, credential }
    }

    async function connectPeer(listener, attempt, microphone = null) {
      const connectionId = randomUUID()
      const offer = await json(
        await fetch(
          `${web.origin}/api/player/sessions/${listener.session.sessionId}/media`,
          {
            method: 'POST',
            headers: {
              origin: web.origin,
              'content-type': 'application/json',
              authorization: `Bearer ${listener.credential}`,
            },
            body: JSON.stringify({ operation: 'offer', connectionId, attempt }),
          },
        ),
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
        assert.ok(transceiver)
        transceiver.direction = 'sendonly'
        await transceiver.sender.replaceTrack(microphone)
      }
      await peer.setLocalDescription(await peer.createAnswer())
      await json(
        await fetch(
          `${web.origin}/api/player/sessions/${listener.session.sessionId}/media`,
          {
            method: 'POST',
            headers: {
              origin: web.origin,
              'content-type': 'application/json',
              authorization: `Bearer ${listener.credential}`,
            },
            body: JSON.stringify({
              operation: 'answer',
              connectionId: offer.connectionId,
              description: { type: 'answer', sdp: peer.localDescription.sdp },
            }),
          },
        ),
      )
      await until(() => peer.connectionState === 'connected', 'WebRTC peer connected')
      const { rows } = await database.pool.query(
        'select owner_id from media_connection where id = $1',
        [offer.connectionId],
      )
      return { offer, peer, pcm, ownerId: rows[0]?.owner_id }
    }

    const host = await enter(hostId)
    const listenerA = await enter(guestA)
    const listenerB = await enter(guestB)

    const microphone = new MediaStreamTrack({ kind: 'audio' })
    const hostPeer = await connectPeer(host, 1, microphone)
    assert.equal(hostPeer.ownerId, baseWorker.runtime().ownerId)

    // Both receive-only listeners prefer the dedicated fan-out burst worker even
    // once burstWorker already holds more open peers than baseWorker.
    const peerA = await connectPeer(listenerA, 1)
    const peerB = await connectPeer(listenerB, 1)
    assert.equal(peerA.ownerId, burstWorker.runtime().ownerId)
    assert.equal(peerB.ownerId, burstWorker.runtime().ownerId)

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

    await until(
      () => audible(peerA.pcm) > 1_000 && audible(peerB.pcm) > 1_000,
      'burst-worker listeners receive relayed audio',
      15_000,
    )

    // KEDA scale endpoint requires Bearer authentication and reports live counts.
    const unauth = await fetch(`${baseWorker.origin}/metrics/scale`)
    assert.equal(unauth.status, 401)
    const scaleResponse = await baseWorker.control('/metrics/scale')
    assert.equal(scaleResponse.status, 200)
    const metrics = voiceScaleMetricsSchema.parse(await scaleResponse.json())
    assert.equal(metrics.activeSessions, 3)
    assert.equal(metrics.openMediaConnections, 3)
    assert.equal(metrics.activeListeners, 3)
    assert.equal(metrics.activeVoiceSources, 1)
    assert.equal(metrics.activeFanoutWorkers, 1)
    assert.equal(metrics.desiredBurstReplicas, 2)

    // Cross-replica revocation closes UDP sockets on the burst worker.
    await enter(guestA)
    assert.ok(await portsReleased(candidateSockets(peerA.offer)))

    // Scaling the burst worker down to 0 transparently falls back to baseWorker.
    await burstWorker.close()
    const listenerC = await enter(guestC)
    const peerC = await connectPeer(listenerC, 1)
    assert.equal(peerC.ownerId, baseWorker.runtime().ownerId)
    await until(
      () => audible(peerC.pcm) > 1_000,
      'fallback listener hears audio on base worker after burst scale-down',
      15_000,
    )
  },
)
