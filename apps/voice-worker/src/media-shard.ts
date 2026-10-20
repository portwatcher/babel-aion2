import { createSecretKey, randomInt } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { isMainThread, parentPort } from 'node:worker_threads'
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  type PeerConfig,
  type RTCRtpSender,
} from 'werift'

/** Main thread to shard calls; each receives exactly one reply with its `seq`. */
export type ShardCall =
  | { op: 'create'; id: string; config: Partial<PeerConfig>; uplink: boolean }
  | { op: 'answer'; id: string; sdp: string }
  | { op: 'close'; id: string }

export type ShardRequest =
  | (ShardCall & { seq: number })
  // Starts publication to a connected sending peer until its credential expires.
  | { op: 'deliver'; id: string; roomId: string; until: number }
  // Stops publication immediately, before an orderly close completes.
  | { op: 'withhold'; id: string }
  | { op: 'publish'; roomId: string; payload: Uint8Array; durationMs: number }

export type ShardEvent =
  | {
      op: 'reply'
      seq: number
      ok: boolean
      offer?: { sdp: string; uplinkMid: string | null }
    }
  | { op: 'state'; id: string; state: string }
  | { op: 'uplink'; id: string; payload: Uint8Array }
  // Publication failed; the owner closes the peer through its normal lifecycle.
  | { op: 'failed'; id: string }

interface Peer {
  id: string
  connection: RTCPeerConnection
  track: MediaStreamTrack | null
  sender: RTCRtpSender | null
  roomId: string | null
  until: number
  sequence: number
  timestamp: number
  startedAt: number
}

type SrtpSession = NonNullable<RTCRtpSender['dtlsTransport']>['srtp']

/**
 * Node derives a key object from a Buffer key on every createCipheriv call, and
 * werift creates a cipher per packet. Werift's SRTP ciphers pass the session key
 * only to createCipheriv, which accepts a cached KeyObject equally.
 */
function cacheSrtpKey(session: SrtpSession) {
  const cipher: unknown = Reflect.get(session.localContext, 'cipher')
  if (cipher && typeof cipher === 'object') {
    const key: unknown = Reflect.get(cipher, 'srtpSessionKey')
    if (Buffer.isBuffer(key)) {
      Reflect.set(cipher, 'srtpSessionKey', createSecretKey(key))
    }
  }
}

/**
 * Owns WebRTC peers and their per-packet SRTP work. It holds no credentials and
 * makes no authorization decisions: the owning MediaPeers instance does.
 */
export class PeerShard {
  private readonly peers = new Map<string, Peer>()
  private readonly rooms = new Map<string, Set<Peer>>()
  private readonly post: (event: ShardEvent) => void

  constructor(post: (event: ShardEvent) => void) {
    this.post = post
  }

  handle(request: ShardRequest) {
    if (request.op === 'publish') {
      this.publish(request.roomId, request.payload, request.durationMs)
    } else if (request.op === 'deliver') {
      this.deliver(request.id, request.roomId, request.until)
    } else if (request.op === 'withhold') {
      const peer = this.peers.get(request.id)
      if (peer) {
        this.detach(peer)
      }
    } else {
      void this.respond(request)
    }
  }

  private async respond(request: ShardCall & { seq: number }) {
    try {
      if (request.op === 'create') {
        const offer = await this.create(request.id, request.config, request.uplink)
        this.post({ op: 'reply', seq: request.seq, ok: true, offer })
      } else if (request.op === 'answer') {
        const peer = this.peers.get(request.id)
        if (!peer) {
          throw new Error('Unknown peer')
        }
        await peer.connection.setRemoteDescription({ type: 'answer', sdp: request.sdp })
        this.post({ op: 'reply', seq: request.seq, ok: true })
      } else {
        await this.close(request.id)
        this.post({ op: 'reply', seq: request.seq, ok: true })
      }
    } catch {
      this.post({ op: 'reply', seq: request.seq, ok: false })
    }
  }

  private async create(id: string, config: Partial<PeerConfig>, uplink: boolean) {
    const connection = new RTCPeerConnection({
      ...config,
      codecs: {
        audio: [
          new RTCRtpCodecParameters({
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            payloadType: 111,
          }),
        ],
      },
    })
    const peer: Peer = {
      id,
      connection,
      track: null,
      sender: null,
      roomId: null,
      until: 0,
      sequence: randomInt(65_536),
      timestamp: randomInt(0x1_0000_0000),
      startedAt: performance.now(),
    }
    this.peers.set(id, peer)
    let receiver: ReturnType<RTCPeerConnection['addTransceiver']> | null = null
    if (uplink) {
      // The host publishes the room's audio and does not receive its own mix.
      receiver = connection.addTransceiver('audio', { direction: 'recvonly' })
      receiver.onTrack.subscribe((track) => {
        track.onReceiveRtp.subscribe((rtp) => {
          // A copy: the packet buffer may be a view of shared memory.
          this.post({ op: 'uplink', id, payload: new Uint8Array(rtp.payload) })
        })
      })
    } else {
      peer.track = new MediaStreamTrack({ kind: 'audio' })
      peer.sender = connection.addTransceiver(peer.track, {
        direction: 'sendonly',
      }).sender
    }
    connection.connectionStateChange.subscribe((state) => {
      this.post({ op: 'state', id, state })
    })
    await connection.setLocalDescription(await connection.createOffer())
    const description = connection.localDescription
    if (!description || description.type !== 'offer') {
      throw new Error('Offer unavailable')
    }
    return { sdp: description.sdp, uplinkMid: receiver ? (receiver.mid ?? null) : null }
  }

  private deliver(id: string, roomId: string, until: number) {
    const peer = this.peers.get(id)
    if (!peer?.track || peer.roomId) {
      return
    }
    peer.roomId = roomId
    peer.until = until
    const members = this.rooms.get(roomId) ?? new Set<Peer>()
    members.add(peer)
    this.rooms.set(roomId, members)
  }

  private publish(roomId: string, payload: Uint8Array, durationMs: number) {
    const members = this.rooms.get(roomId)
    if (!members) {
      return
    }
    const now = performance.now()
    const wall = Date.now()
    const data = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
    for (const peer of members) {
      const transport = peer.sender?.dtlsTransport
      if (
        !peer.sender ||
        !transport?.srtp ||
        wall >= peer.until ||
        peer.connection.connectionState !== 'connected'
      ) {
        continue
      }
      cacheSrtpKey(transport.srtp)
      // Keep the 48 kHz media clock continuous across gaps of two packets or more.
      const elapsed = now - peer.startedAt
      const packets = elapsed > 2 * durationMs ? Math.round(elapsed / durationMs) : 1
      peer.timestamp = (peer.timestamp + packets * durationMs * 48) >>> 0
      peer.startedAt = now
      // The negotiated stream has no header extensions and is identified by the
      // SSRC in the offer, so the packet is encrypted and sent directly. This
      // skips werift's per-packet copy, extension and bandwidth bookkeeping.
      const header = new RtpHeader({
        payloadType: 111,
        sequenceNumber: peer.sequence++ % 65_536,
        timestamp: peer.timestamp,
        ssrc: peer.sender.ssrc,
      })
      transport.sendRtp(data, header).then(
        (size) => {
          if (!size && peer.connection.connectionState !== 'connected') {
            this.failed(peer)
          }
        },
        () => this.failed(peer),
      )
    }
  }

  private failed(peer: Peer) {
    if (peer.roomId) {
      this.detach(peer)
      this.post({ op: 'failed', id: peer.id })
    }
  }

  private detach(peer: Peer) {
    if (peer.roomId) {
      const members = this.rooms.get(peer.roomId)
      members?.delete(peer)
      if (members?.size === 0) {
        this.rooms.delete(peer.roomId)
      }
      peer.roomId = null
    }
  }

  /** Resolves only after the actual peer, and its sockets, have stopped. */
  private async close(id: string) {
    const peer = this.peers.get(id)
    if (!peer) {
      return
    }
    this.detach(peer)
    peer.track?.stop()
    await peer.connection.close()
    this.peers.delete(id)
  }

  async stop() {
    await Promise.allSettled([...this.peers.keys()].map((id) => this.close(id)))
  }
}

if (!isMainThread && parentPort) {
  const port = parentPort
  const shard = new PeerShard((event) => port.postMessage(event))
  port.on('message', (request: ShardRequest) => shard.handle(request))
}
