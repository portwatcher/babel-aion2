import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { networkInterfaces } from 'node:os'
import { RTCPeerConnection } from 'werift'
import { turnAllocation } from '../../../scripts/fixtures/turn-allocation.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import opus from '@discordjs/opus'
import { createLiveSubtitleFixture } from '../../../scripts/fixtures/live-subtitles.mjs'
import {
  until,
  candidateSockets,
  portsReleased,
} from '../../../scripts/fixtures/media-worker.mjs'

const turn = JSON.parse(process.env.BABEL_TEST_TURN)
const exec = promisify(execFile)
function environment(url) {
  return {
    MEDIA_TURN_URLS: JSON.stringify([url]),
    MEDIA_TURN_SHARED_SECRET: turn.secret,
    MEDIA_ICE_POLICY: 'relay',
    MEDIA_BROWSER_ICE_POLICY: 'relay',
    MEDIA_TURN_TTL_SECONDS: '60',
  }
}

async function receive(t, fixture, listener, attempt = 1) {
  const path = `/api/player/sessions/${listener.session.sessionId}/media`
  const started = Date.now()
  const response = await listener.request(path, 'POST', {
    operation: 'offer',
    connectionId: randomUUID(),
    attempt,
  })
  const offeredAt = Date.now()
  const offer = await fixture.json(response)
  const receiver = new RTCPeerConnection({
    iceServers: offer.ice.servers.flatMap((server) =>
      server.urls.map((url) => ({
        urls: url,
        username: server.username,
        credential: server.credential,
      })),
    ),
    iceTransportPolicy: offer.ice.policy,
    iceUseIpv6: false,
  })
  t.after(() => receiver.close())
  const decoder = new opus.OpusEncoder(48_000, 2)
  let packets = 0,
    nonzero = 0
  receiver.onTrack.subscribe((track) =>
    track.onReceiveRtp.subscribe((packet) => {
      packets++
      const frame = decoder.decode(packet.payload)
      for (let i = 0; i < frame.length; i += 2) {
        if (Math.abs(frame.readInt16LE(i)) > 500) {
          nonzero++
          break
        }
      }
    }),
  )
  await receiver.setRemoteDescription(offer.description)
  await receiver.setLocalDescription(await receiver.createAnswer())
  await fixture.json(
    await listener.request(path, 'POST', {
      operation: 'answer',
      connectionId: offer.connectionId,
      description: { type: 'answer', sdp: receiver.localDescription.sdp },
    }),
  )
  await until(
    () => receiver.connectionState === 'connected',
    'actual media network connection',
  )
  await until(() => nonzero > 10, 'nonzero Opus decoded through configured transport')
  return { offer, receiver, started, offeredAt, packets: () => packets }
}

test(
  'authenticated media delivers through real TURN UDP, TCP, TLS and UDP-to-TCP fallback',
  { timeout: 100_000 },
  async (t) => {
    for (const [transport, url] of Object.entries({
      udp: turn.udp,
      tcp: turn.tcp,
      tls: turn.tls,
      fallback: turn.tcp.replace('transport=tcp', 'transport=udp'),
    })) {
      const f = await createLiveSubtitleFixture(environment(url))
      try {
        f.speak('synthetic-source')
        const listener = await f.enter(`network-${transport}`)
        const media = await receive(t, f, listener)
        const configuration = media.offer.ice
        assert.equal(configuration.policy, 'relay')
        assert.ok(
          configuration.renewAfterMs > 1000 && configuration.renewAfterMs <= 30_000,
        )
        const pair = media.receiver.iceTransports[0].getSelectedCandidatePair()
        assert.match(pair.local.candidate, / typ relay /)
        assert.match(pair.remote.candidate, / typ relay /)
        const secretFree = JSON.stringify(media.offer)
        assert.ok(
          !secretFree.includes(turn.secret),
          'TURN shared secret must remain server-only',
        )
        assert.ok(
          !secretFree.includes(listener.credential),
          'Listener credential is not a TURN username',
        )
        const username = configuration.servers[0].username
        const expires = Number(username.split(':')[0]) * 1000
        assert.ok(expires > Date.now())
        // Minting happens after authorization, between request and response.
        // TURN timestamps have one-second precision; a request can cross a second.
        assert.ok(expires >= media.started + 59_000)
        assert.ok(expires <= media.offeredAt + 60_000)
        const publicConfig = await (
          await fetch(`${f.web.origin}/api/player/config`)
        ).text()
        assert.ok(!publicConfig.includes(configuration.servers[0].credential))
        const rejected = await fetch(
          `${f.web.origin}/api/player/sessions/${listener.session.sessionId}/media`,
          {
            method: 'POST',
            headers: { origin: f.web.origin, 'content-type': 'application/json' },
            body: JSON.stringify({
              operation: 'offer',
              connectionId: randomUUID(),
              attempt: 2,
            }),
          },
        )
        assert.equal(rejected.status, 401)
        assert.ok(
          !(await rejected.text()).includes(configuration.servers[0].credential),
        )
        await media.receiver.close()
        t.diagnostic(
          `${transport}: nonzero decoded Opus; relay candidate selected at both ends`,
        )
      } finally {
        await f.close()
      }
    }
  },
)

test(
  'TURN credential expiry closes actual delivery; renewal uses fresh credentials in the same listener',
  { timeout: 85_000 },
  async (t) => {
    const f = await createLiveSubtitleFixture(environment(turn.udp))
    t.after(() => f.close())
    f.speak('synthetic-source')
    const listener = await f.enter('network-expiry')
    const media = await receive(t, f, listener)
    const expires = Number(media.offer.ice.servers[0].username.split(':')[0]) * 1000
    await delay(Math.max(0, expires - Date.now()) + 600)
    await until(async () => {
      const { rows } = await f.database.pool.query(
        'select closed_at from media_connection where id=$1',
        [media.offer.connectionId],
      )
      return Boolean(rows[0]?.closed_at)
    }, 'physical peer close acknowledged after credential expiry')
    const ended = media.packets()
    await delay(600)
    assert.equal(
      media.packets(),
      ended,
      'Expired peer must stop receiving while PCM continues',
    )
    const credential = media.offer.ice.servers[0]
    assert.equal(
      await turnAllocation(turn.udp, credential),
      401,
      'Expired temporary credentials must receive an actual TURN authentication denial',
    )
    const renewed = await receive(t, f, listener, 2)
    assert.equal(
      await turnAllocation(turn.udp, renewed.offer.ice.servers[0]),
      200,
      'Fresh credentials allocate through the same real TURN request path',
    )
    assert.notEqual(
      renewed.offer.ice.servers[0].username,
      media.offer.ice.servers[0].username,
    )
    assert.notEqual(
      renewed.offer.ice.servers[0].credential,
      media.offer.ice.servers[0].credential,
    )
    assert.equal(
      (
        await f.json(
          await listener.request(
            `/api/player/sessions/${listener.session.sessionId}`,
            'GET',
          ),
        )
      ).nicknameGeneration,
      listener.session.nicknameGeneration,
    )
  },
)

test(
  'TLS rejects an untrusted relay certificate and invalid network settings fail worker startup',
  { timeout: 15_000 },
  async () => {
    const relay = new URL(turn.tls.replace('turns:', 'https://'))
    const tls = await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {createTurnClient} from 'werift';
      try {
        const client = await createTurnClient({address:JSON.parse(process.env.RELAY_ADDRESS), username:'test', password:'test'}, {transport:'tls',connectTimeoutMs:2000});
        await client.close(); process.exitCode=1;
      } catch(error) {
        if (['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code)) {
          process.stdout.write('UNTRUSTED_TLS_REJECTED');
        } else {
          process.exitCode=1;
        }
      }
    `,
      ],
      {
        env: {
          PATH: process.env.PATH,
          RELAY_ADDRESS: JSON.stringify([relay.hostname, Number(relay.port)]),
        },
        timeout: 5000,
      },
    )
    assert.equal(tls.stdout, 'UNTRUSTED_TLS_REJECTED')
    for (const config of [
      { MEDIA_TURN_URLS: JSON.stringify([turn.udp]) },
      { MEDIA_ICE_POLICY: 'relay' },
      { ...environment(turn.udp), MEDIA_TURN_TTL_SECONDS: '1' },
      { ...environment(turn.udp), MEDIA_WORKER_TURN_URL: 'https://relay.invalid/' },
      { ...environment(turn.udp), MEDIA_ICE_POLICY: 'all' },
      { MEDIA_ICE_PORT_RANGE: '43400-43431' },
    ]) {
      let status, output
      try {
        await exec(process.execPath, ['apps/voice-worker/dist/index.mjs'], {
          env: {
            PATH: process.env.PATH,
            DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
            MEDIA_CONTROL_SECRET:
              'fixture-control-secret-at-least-thirty-two-characters',
            MEDIA_CONTROL_PORT: '0',
            ...config,
          },
          timeout: 2000,
        })
      } catch (error) {
        status = error.code
        output = error.stdout + error.stderr
      }
      assert.equal(
        status,
        1,
        'Malformed network configuration must exit before binding',
      )
      assert.equal(output.trim(), 'Babel worker configuration is invalid.')
    }
  },
)

test(
  'relay authentication failure returns no offer and closes its registration',
  { timeout: 25_000 },
  async (t) => {
    const f = await createLiveSubtitleFixture({
      ...environment(turn.udp),
      MEDIA_TURN_SHARED_SECRET: 'incorrect-fixture-secret-with-enough-characters',
    })
    t.after(() => f.close())
    const listener = await f.enter('network-unavailable')
    const connectionId = randomUUID()
    const response = await listener.request(
      `/api/player/sessions/${listener.session.sessionId}/media`,
      'POST',
      {
        operation: 'offer',
        connectionId,
        attempt: 1,
      },
    )
    assert.equal(response.status, 503)
    const body = await response.text()
    assert.ok(!body.includes('incorrect-fixture-secret'))
    assert.ok(!body.includes('credential'))
    const { rows } = await f.database.pool.query(
      'select closed_at from media_connection where id=$1',
      [connectionId],
    )
    assert.ok(
      rows[0]?.closed_at,
      'No unusable negotiation may remain registered as open',
    )
  },
)

test(
  'configured STUN and a bounded local UDP range support simultaneous authorized peers',
  { timeout: 25_000 },
  async (t) => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
    assert.ok(address, 'A non-loopback local IPv4 interface is required')
    const f = await createLiveSubtitleFixture({
      MEDIA_STUN_URL: turn.stun,
      MEDIA_ICE_BIND_ADDRESS: address,
      MEDIA_ICE_PORT_RANGE: '43400-43431',
    })
    t.after(() => f.close())
    const a = await f.enter('network-direct-a'),
      b = await f.enter('network-direct-b')
    f.speak('synthetic-source')
    const media = await Promise.all([receive(t, f, a), receive(t, f, b)])
    const sockets = media.flatMap(({ offer }) => candidateSockets(offer))
    assert.equal(new Set(sockets.map(({ port }) => port)).size, 2)
    for (const { offer } of media) {
      assert.match(offer.description.sdp, / typ srflx /)
    }
    for (const socket of sockets) {
      assert.equal(socket.address, address)
      assert.ok(socket.port >= 43400 && socket.port <= 43431)
    }
    await f.peers.stop()
    assert.ok(
      await portsReleased(sockets),
      'Configured UDP ports must be physically reusable after close',
    )
  },
)
