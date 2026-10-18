import { randomInt, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import type { ListenerReference, MediaOffer } from '@babel/contracts'
import type { Database } from '@babel/database'
import {
  authorizeMediaSession,
  closeMediaConnection,
  earlierMediaConnectionsStopped,
  mediaConnectionAuthorized,
  mediaConnectionsStopped,
  openMediaConnection,
  ListenerError,
} from '@babel/database/listeners'
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket,
} from 'werift'
import type { MediaNetwork } from './media-network.ts'

interface Entry {
  id: string
  attempt: number
  reference: ListenerReference
  roomId: string
  roomEpoch: number
  sequence: number
  timestamp: number
  startedAt: number
  peer: RTCPeerConnection | null
  track: MediaStreamTrack | null
  registered: boolean
  closing: boolean
  closed: boolean
  initialized: Promise<void>
  initializedDone: () => void
  offer: Promise<MediaOffer> | null
  answer: Promise<void> | null
  closingTask: Promise<void> | null
  expiresAt: number
  credentialExpiresAt: number
}

export class MediaPeerError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'NOT_FOUND' | 'BUSY') {
    super(code)
  }
}

export class MediaPeers {
  private readonly ownerId = randomUUID()
  private readonly entries = new Map<string, Entry>()
  private readonly roomEpochs = new Map<string, number>()
  private stopping = false
  private sweeping: Promise<void> | null = null
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly db: Database,
    private readonly network: MediaNetwork,
  ) {
    this.timer = setInterval(() => {
      if (!this.sweeping) {
        this.sweeping = this.sweep().finally(() => {
          this.sweeping = null
        })
      }
    }, 500)
    this.timer.unref()
  }

  async ready() {
    if (this.stopping) {
      return false
    }
    // Queries the real registration table as well as listener storage. Readiness
    // concerns revocable media admission; it does not assert a live Discord source.
    await mediaConnectionsStopped(this.db, {
      sessionId: this.ownerId,
      nicknameGeneration: 1,
    })
    await mediaConnectionAuthorized(this.db, this.ownerId, this.ownerId)
    return true
  }

  async offer(
    id: string,
    attempt: number,
    reference: ListenerReference,
    credential: string,
  ): Promise<MediaOffer> {
    if (this.stopping) {
      throw new MediaPeerError('UNAVAILABLE')
    }
    const listener = await authorizeMediaSession(this.db, reference, credential)
    if (this.stopping) {
      throw new MediaPeerError('UNAVAILABLE')
    }
    const existing = this.entries.get(id)
    if (existing) {
      this.match(existing, reference)
      if (existing.attempt !== attempt) {
        throw new ListenerError('ENTRY_CONFLICT')
      }
      await this.authorized(existing)
      if (!existing.offer) {
        throw new MediaPeerError('BUSY')
      }
      return existing.offer
    }
    let initializedDone = () => {}
    const initialized = new Promise<void>((resolve) => {
      initializedDone = resolve
    })
    const entry: Entry = {
      id,
      attempt,
      reference,
      roomId: listener.roomId,
      roomEpoch: this.roomEpochs.get(listener.roomId) ?? 0,
      sequence: randomInt(65_536),
      timestamp: randomInt(0x1_0000_0000),
      startedAt: performance.now(),
      peer: null,
      track: null,
      registered: false,
      closing: false,
      closed: false,
      initialized,
      initializedDone,
      offer: null,
      answer: null,
      closingTask: null,
      expiresAt: Date.now() + 45_000,
      credentialExpiresAt: Infinity,
    }
    this.entries.set(id, entry)
    entry.offer = this.create(entry, credential)
    return entry.offer
  }

  private match(entry: Entry, reference: ListenerReference) {
    if (
      entry.reference.sessionId !== reference.sessionId ||
      entry.reference.nicknameGeneration !== reference.nicknameGeneration
    ) {
      throw new ListenerError('INVALID_CREDENTIAL')
    }
  }

  private async authorized(entry: Entry) {
    const authorized = await mediaConnectionAuthorized(this.db, entry.id, this.ownerId)
    if (
      entry.closing ||
      Date.now() >= entry.expiresAt ||
      entry.roomEpoch !== (this.roomEpochs.get(entry.roomId) ?? 0)
    ) {
      // Retiring a source/peer does not revoke the listener. Let the browser
      // negotiate again; a terminal 410 would permanently stop its recovery.
      throw new MediaPeerError('BUSY')
    }
    if (!authorized) {
      throw new ListenerError('SESSION_ENDED')
    }
  }

  private async create(entry: Entry, credential: string): Promise<MediaOffer> {
    let result: MediaOffer | undefined
    let failure: unknown
    try {
      await openMediaConnection(
        this.db,
        entry.id,
        this.ownerId,
        entry.attempt,
        entry.reference,
        credential,
      )
      entry.registered = true
      for (const prior of this.entries.values()) {
        if (
          prior !== entry &&
          prior.registered &&
          // Only wait backwards in negotiation order. Three overlapping
          // recoveries can make both older entries unauthorized; letting them
          // close each other would deadlock their initialization promises.
          prior.attempt < entry.attempt &&
          prior.reference.sessionId === entry.reference.sessionId &&
          !(await mediaConnectionAuthorized(this.db, prior.id, this.ownerId))
        ) {
          await this.close(prior)
        }
      }
      const deadline = Date.now() + 2_000
      while (
        !(await earlierMediaConnectionsStopped(this.db, entry.id, entry.reference))
      ) {
        await this.authorized(entry)
        if (Date.now() >= deadline) {
          throw new MediaPeerError('BUSY')
        }
        await delay(50)
      }
      await this.authorized(entry)
      const network = this.network.create()
      entry.credentialExpiresAt = network.expiresAt
      const peer = new RTCPeerConnection({
        ...network.worker,
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
      entry.peer = peer
      entry.track = new MediaStreamTrack({ kind: 'audio' })
      peer.addTransceiver(entry.track, { direction: 'sendonly' })
      peer.connectionStateChange.subscribe((state) => {
        if (state === 'connected') {
          entry.expiresAt = entry.credentialExpiresAt
        }
        if (state === 'failed' || state === 'closed') {
          void this.close(entry).catch(() => {})
        }
      })
      await peer.setLocalDescription(await peer.createOffer())
      await this.authorized(entry)
      const description = peer.localDescription
      if (!description || description.type !== 'offer') {
        throw new MediaPeerError('UNAVAILABLE')
      }
      const candidates = description.sdp
        .split(/\r?\n/)
        .filter((line) => line.startsWith('a=candidate:'))
      if (
        !candidates.length ||
        (network.worker.iceTransportPolicy === 'relay' &&
          !candidates.some((line) => / typ relay(?: |$)/.test(line)))
      ) {
        throw new MediaPeerError('UNAVAILABLE')
      }
      result = {
        connectionId: entry.id,
        ice: {
          ...network.browser,
          renewAfterMs:
            network.browser.renewAfterMs === null
              ? null
              : Math.max(1_000, network.expiresAt - Date.now() - 30_000),
        },
        description: { type: 'offer', sdp: description.sdp },
      }
    } catch (error) {
      failure = error
    } finally {
      entry.initializedDone()
    }
    if (!result) {
      await this.close(entry).catch(() => {})
      throw failure ?? new MediaPeerError('UNAVAILABLE')
    }
    return result
  }

  async answer(
    id: string,
    reference: ListenerReference,
    credential: string,
    description: { type: 'answer'; sdp: string },
  ) {
    await authorizeMediaSession(this.db, reference, credential)
    const entry = this.entries.get(id)
    if (!entry) {
      throw new MediaPeerError('NOT_FOUND')
    }
    this.match(entry, reference)
    await entry.initialized
    await this.authorized(entry)
    if (!entry.peer || entry.answer) {
      throw new MediaPeerError('BUSY')
    }
    entry.answer = entry.peer.setRemoteDescription(description)
    try {
      await entry.answer
      await this.authorized(entry)
    } catch (error) {
      // Let the answer settle before close; no delayed SDP task may reopen an
      // already acknowledged transport.
      await this.close(entry).catch(() => {})
      throw error
    }
  }

  async disconnect(id: string, reference: ListenerReference, credential: string) {
    await authorizeMediaSession(this.db, reference, credential)
    const entry = this.entries.get(id)
    if (entry) {
      this.match(entry, reference)
      await this.close(entry)
    }
  }

  private close(entry: Entry): Promise<void> {
    entry.closing = true
    if (entry.closingTask) {
      return entry.closingTask
    }
    entry.closingTask = (async () => {
      await entry.initialized
      await entry.answer?.catch(() => {})
      entry.track?.stop()
      if (!entry.closed) {
        await entry.peer?.close()
        entry.closed = true
      }
      if (entry.registered) {
        await closeMediaConnection(this.db, entry.id, this.ownerId)
      }
      if (this.entries.get(entry.id) === entry) {
        this.entries.delete(entry.id)
      }
    })().finally(() => {
      entry.closingTask = null
    })
    return entry.closingTask
  }

  async revoke(reference: ListenerReference) {
    for (const entry of this.entries.values()) {
      if (
        entry.reference.sessionId === reference.sessionId &&
        entry.reference.nicknameGeneration === reference.nicknameGeneration
      ) {
        await this.close(entry)
      }
    }
    return mediaConnectionsStopped(this.db, reference)
  }

  publish(roomId: string, payload: Buffer) {
    const now = performance.now()
    for (const entry of this.entries.values()) {
      if (
        entry.roomId !== roomId ||
        entry.closing ||
        entry.closed ||
        Date.now() >= entry.credentialExpiresAt ||
        entry.roomEpoch !== (this.roomEpochs.get(roomId) ?? 0) ||
        entry.peer?.connectionState !== 'connected' ||
        !entry.track
      ) {
        continue
      }
      const elapsed = now - entry.startedAt
      entry.timestamp =
        (entry.timestamp + (elapsed > 40 ? Math.round(elapsed / 20) : 1) * 960) >>> 0
      entry.startedAt = now
      const header = new RtpHeader({
        payloadType: 111,
        sequenceNumber: entry.sequence++ % 65_536,
        timestamp: entry.timestamp,
      })
      try {
        entry.track.writeRtp(new RtpPacket(header, payload))
      } catch {
        void this.close(entry).catch(() => {})
      }
    }
  }

  async closeRoom(roomId: string) {
    this.roomEpochs.set(roomId, (this.roomEpochs.get(roomId) ?? 0) + 1)
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.roomId === roomId)
        .map((entry) => this.close(entry)),
    )
  }

  private async sweep() {
    await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        if (!entry.registered) {
          return
        }
        try {
          if (
            entry.closing ||
            Date.now() >= entry.expiresAt ||
            !(await mediaConnectionAuthorized(this.db, entry.id, this.ownerId))
          ) {
            await this.close(entry)
          }
        } catch {
          // A storage failure closes the peer. Failed acknowledgement remains in
          // storage and is retried; neither an exception nor a timeout is proof.
          await this.close(entry).catch(() => {})
        }
      }),
    )
  }

  async stop() {
    this.stopping = true
    clearInterval(this.timer)
    await this.sweeping
    await Promise.allSettled(
      [...this.entries.values()].map((entry) => this.close(entry)),
    )
  }
}
