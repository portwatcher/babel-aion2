// A child process that behaves like many player browsers: HTTP entry, the
// authenticated player WebSocket and a receive-only WebRTC peer per listener.
// A room host instead publishes a synthetic Opus tone through its uplink.
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import opus from '@discordjs/opus'
import WebSocket from 'ws'
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket } from 'werift'

const listeners = []
const totals = {
  entered: 0,
  sockets: 0,
  connected: 0,
  packets: 0,
  socketClosures: 0,
  peerFailures: 0,
  renegotiations: 0,
  errors: 0,
  reasons: {},
}

function count(reason) {
  totals.reasons[reason] = (totals.reasons[reason] ?? 0) + 1
}

async function api(origin, path, credential, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
}

function tone() {
  const pcm = Buffer.alloc(960 * 2 * 2)
  for (let sample = 0; sample < 960; sample += 1) {
    const value = Math.round(8_000 * Math.sin((2 * Math.PI * sample) / 48))
    pcm.writeInt16LE(value, sample * 4)
    pcm.writeInt16LE(value, sample * 4 + 2)
  }
  return pcm
}

function socket(listener) {
  const ws = new WebSocket(`${listener.origin.replace('http:', 'ws:')}/api/player/ws`, {
    headers: { origin: listener.origin },
  })
  ws.on('message', (data) => {
    const event = JSON.parse(data.toString())
    if (event.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
    } else if (event.type === 'session' && !listener.socketOpen) {
      listener.socketOpen = true
      totals.sockets += 1
    }
  })
  ws.on('open', () =>
    ws.send(
      JSON.stringify({
        type: 'authenticate',
        sessionId: listener.session.sessionId,
        credential: listener.credential,
      }),
    ),
  )
  ws.on('close', (code) => {
    if (listener.socketOpen && !listener.stopping) {
      totals.socketClosures += 1
      count(`socket ${code}`)
    }
    if (listener.socketOpen) {
      totals.sockets -= 1
    }
    listener.socketOpen = false
  })
  ws.on('error', () => {})
  listener.ws = ws
}

/** One negotiation, as the browser's listener audio controller performs it. */
async function negotiate(listener) {
  listener.attempt += 1
  const request = {
    operation: 'offer',
    connectionId: randomUUID(),
    attempt: listener.attempt,
  }
  const path = `/api/player/sessions/${listener.session.sessionId}/media`
  const response = await api(listener.origin, path, listener.credential, request)
  if (response.status !== 200) {
    throw new Error(`offer ${response.status}`)
  }
  const offer = await response.json()
  // With a relay-only configuration, use the issued TURN credentials over UDP,
  // as a browser would; otherwise connect directly.
  const relay = offer.ice.servers.flatMap((server) =>
    server.urls
      .filter((url) => url.startsWith('turn:') && url.includes('transport=udp'))
      .map((urls) => ({
        urls,
        username: server.username,
        credential: server.credential,
      })),
  )
  const peer = new RTCPeerConnection({
    iceServers: relay.slice(0, 1),
    iceTransportPolicy: offer.ice.policy === 'relay' ? 'relay' : 'all',
    iceUseIpv6: false,
  })
  listener.peer = peer
  peer.onTrack.subscribe((track) =>
    track.onReceiveRtp.subscribe(() => {
      listener.packets += 1
      totals.packets += 1
    }),
  )
  // Like a browser whose ICE attempt times out, give up on a stalled attempt.
  const stalled = setTimeout(() => {
    if (listener.peer === peer && !listener.connected) {
      count('peer stalled before connect')
      recover(listener, peer)
    }
  }, 30_000)
  peer.connectionStateChange.subscribe((state) => {
    if (listener.peer !== peer) {
      return
    }
    if (state === 'connected' && !listener.connected) {
      clearTimeout(stalled)
      listener.connected = true
      totals.connected += 1
    } else if (['disconnected', 'failed', 'closed'].includes(state)) {
      clearTimeout(stalled)
      if (listener.connected) {
        listener.connected = false
        totals.connected -= 1
        if (!listener.stopping) {
          totals.peerFailures += 1
          count(`peer ${state} after connect`)
        }
      } else if (!listener.stopping) {
        count(`peer ${state} before connect`)
      }
      recover(listener, peer)
    }
  })
  await peer.setRemoteDescription(offer.description)
  if (listener.host) {
    const transceiver = peer
      .getTransceivers()
      .find((candidate) => candidate.mid === offer.uplinkMid)
    if (!transceiver) {
      throw new Error('host uplink missing')
    }
    transceiver.direction = 'sendonly'
    listener.microphone = new MediaStreamTrack({ kind: 'audio' })
    await transceiver.sender.replaceTrack(listener.microphone)
  }
  await peer.setLocalDescription(await peer.createAnswer())
  const answer = await api(listener.origin, path, listener.credential, {
    operation: 'answer',
    connectionId: offer.connectionId,
    description: { type: 'answer', sdp: peer.localDescription.sdp },
  })
  if (answer.status !== 200) {
    throw new Error(`answer ${answer.status}`)
  }
}

/** The browser retries a failed or lost media connection after 1.5 s. */
function recover(listener, peer) {
  if (listener.stopping || listener.retrying || (peer && listener.peer !== peer)) {
    return
  }
  listener.retrying = true
  listener.microphone = null
  listener.peer?.close().catch(() => {})
  listener.peer = null
  setTimeout(() => {
    listener.retrying = false
    totals.renegotiations += 1
    void media(listener)
  }, 1_500)
}

async function media(listener) {
  try {
    await negotiate(listener)
  } catch (error) {
    totals.errors += 1
    count(error instanceof Error ? error.message.slice(0, 40) : 'unknown')
    recover(listener, listener.peer)
  }
}

async function join(listener) {
  listener.credential = randomBytes(32).toString('base64url')
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await api(
        listener.origin,
        `/api/player/rooms/${listener.roomNumber}/sessions`,
        listener.credential,
        { nickname: listener.nickname, outputLanguage: null, requestId: randomUUID() },
      )
      if (![200, 202].includes(response.status)) {
        throw new Error(`entry ${response.status}`)
      }
      listener.session = await response.json()
      totals.entered += 1
      break
    } catch (error) {
      totals.errors += 1
      count(error instanceof Error ? error.message.slice(0, 40) : 'unknown')
      if (attempt >= 4) {
        return
      }
      await delay(1_000 * (attempt + 1))
    }
  }
  socket(listener)
  await media(listener)
}

function publish() {
  const frame = new opus.OpusEncoder(48_000, 2).encode(tone())
  let sequence = 0
  setInterval(() => {
    sequence += 1
    for (const listener of listeners) {
      listener.microphone?.writeRtp(
        new RtpPacket(
          new RtpHeader({
            payloadType: 111,
            sequenceNumber: sequence % 65_536,
            timestamp: (sequence * 960) >>> 0,
          }),
          frame,
        ),
      )
    }
  }, 20)
}

process.on('message', async (message) => {
  if (message.type === 'start') {
    publish()
    for (const item of message.listeners) {
      const listener = {
        ...item,
        packets: 0,
        attempt: 0,
        connected: false,
        socketOpen: false,
      }
      listeners.push(listener)
      void join(listener)
      await delay(message.joinIntervalMs)
    }
  } else if (message.type === 'report') {
    // Per-listener packet counts: each listener's own audio continuity.
    const receivers = listeners.filter((listener) => !listener.host)
    process.send({
      type: 'report',
      totals,
      packets: receivers.map((listener) => listener.packets),
    })
  } else if (message.type === 'stop') {
    for (const listener of listeners) {
      listener.stopping = true
      listener.ws?.close()
    }
    await Promise.allSettled(listeners.map((listener) => listener.peer?.close()))
    process.send({ type: 'stopped' })
    process.exit(0)
  }
})
