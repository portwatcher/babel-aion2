import { setTimeout as delay } from 'node:timers/promises'
import type { ListenerReference, MediaOffer } from '@babel/contracts'
import type { Database } from '@babel/database'
import { runtimeOwnerActive } from '@babel/database/runtime-owners'
import { readUplinkHost } from '@babel/database/voice-sources'
import {
  authorizedMediaConnections,
  authorizeMediaSession,
  closeMediaConnection,
  earlierMediaConnectionsStopped,
  mediaConnectionAuthorized,
  mediaConnectionsStopped,
  openMediaConnection,
  ListenerError,
} from '@babel/database/listeners'
import opus from '@discordjs/opus'
import type { MediaNetwork } from './media-network.ts'
import type { PlayerUplink } from './player-source.ts'
import { MediaShards } from './media-shards.ts'

interface Entry {
  id: string
  attempt: number
  reference: ListenerReference
  roomId: string
  nickname: string
  roomEpoch: number
  // The peer exists on a shard (created or being created).
  created: boolean
  // A listener peer that receives the room's audio.
  sending: boolean
  connectionState: string
  // Set only for a PLAYER room host: this peer receives instead of sending.
  uplink: { id: string; decoder: InstanceType<typeof opus.OpusEncoder> } | null
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

// Consecutive storage failures tolerated before every peer is closed. Explicit
// revocation closes peers directly; this sweep is the backstop for missed ones.
const MAX_SWEEP_FAILURES = 3

export class MediaPeers {
  private readonly entries = new Map<string, Entry>()
  // Sending peers by room: publication touches only its room's listeners.
  private readonly rooms = new Map<string, Set<Entry>>()
  private sweepFailures = 0
  private readonly roomEpochs = new Map<string, number>()
  private readonly uplinks = new Map<string, PlayerUplink>()
  private stopping = false
  private sweeping: Promise<void> | null = null
  private readonly timer: ReturnType<typeof setInterval>
  private readonly shards: MediaShards

  constructor(
    private readonly db: Database,
    private readonly network: MediaNetwork,
    private readonly ownerId: string,
    // Worker threads for peers; 0 keeps them in-process. A lost thread is fatal.
    options: { threads?: number; failed?: () => void } = {},
  ) {
    this.shards = new MediaShards(
      options.threads ?? 0,
      {
        state: (id, state) => this.changed(id, state),
        uplink: (id, payload) => {
          const entry = this.entries.get(id)
          if (entry) {
            this.receiveUplink(entry, payload)
          }
        },
        failed: (id) => {
          const entry = this.entries.get(id)
          if (entry) {
            void this.close(entry).catch(() => {})
          }
        },
      },
      options.failed ?? (() => {}),
    )
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
    return runtimeOwnerActive(this.db, this.ownerId)
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
      nickname: listener.nickname.normalize('NFC'),
      roomEpoch: this.roomEpochs.get(listener.roomId) ?? 0,
      created: false,
      sending: false,
      connectionState: 'new',
      uplink: null,
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
    const members = this.rooms.get(entry.roomId) ?? new Set<Entry>()
    members.add(entry)
    this.rooms.set(entry.roomId, members)
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
      const host = await readUplinkHost(this.db, entry.roomId)
      const network = this.network.create()
      entry.credentialExpiresAt = network.expiresAt
      const uplink = host !== null && host === entry.nickname
      if (uplink) {
        // The host publishes the room's audio and does not receive its own mix.
        entry.uplink = {
          id: `player:${entry.id}`,
          decoder: new opus.OpusEncoder(48_000, 2),
        }
      } else {
        entry.sending = true
      }
      entry.created = true
      const offer = await this.shards.create(entry.id, network.worker, uplink)
      await this.authorized(entry)
      const candidates = offer.sdp
        .split(/\r?\n/)
        .filter((line) => line.startsWith('a=candidate:'))
      if (
        !candidates.length ||
        (network.worker.iceTransportPolicy === 'relay' &&
          !candidates.some((line) => / typ relay(?: |$)/.test(line)))
      ) {
        throw new MediaPeerError('UNAVAILABLE')
      }
      if (uplink && !offer.uplinkMid) {
        throw new MediaPeerError('UNAVAILABLE')
      }
      result = {
        connectionId: entry.id,
        uplinkMid: offer.uplinkMid,
        ice: {
          ...network.browser,
          renewAfterMs:
            network.browser.renewAfterMs === null
              ? null
              : Math.max(1_000, network.expiresAt - Date.now() - 30_000),
        },
        description: { type: 'offer', sdp: offer.sdp },
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
    if (!entry.created || entry.answer) {
      throw new MediaPeerError('BUSY')
    }
    entry.answer = this.shards.answer(entry.id, description.sdp)
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

  private changed(id: string, state: string) {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    entry.connectionState = state
    if (state === 'connected') {
      entry.expiresAt = entry.credentialExpiresAt
      if (entry.sending && this.live(entry)) {
        this.shards.deliver(entry.id, entry.roomId, entry.credentialExpiresAt)
      }
    }
    if (state === 'failed' || state === 'closed') {
      void this.close(entry).catch(() => {})
    }
  }

  private close(entry: Entry): Promise<void> {
    if (!entry.closing && entry.created) {
      this.shards.withhold(entry.id)
    }
    entry.closing = true
    if (entry.closingTask) {
      return entry.closingTask
    }
    entry.closingTask = (async () => {
      await entry.initialized
      await entry.answer?.catch(() => {})
      if (!entry.closed) {
        if (entry.created) {
          await this.shards.close(entry.id)
        }
        entry.closed = true
      }
      if (entry.uplink) {
        this.uplinks.get(entry.roomId)?.remove(entry.uplink.id)
      }
      if (entry.registered) {
        await closeMediaConnection(this.db, entry.id, this.ownerId)
      }
      if (this.entries.get(entry.id) === entry) {
        this.entries.delete(entry.id)
      }
      const members = this.rooms.get(entry.roomId)
      members?.delete(entry)
      if (members?.size === 0) {
        this.rooms.delete(entry.roomId)
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

  private live(entry: Entry) {
    return (
      !entry.closing &&
      !entry.closed &&
      Date.now() < entry.credentialExpiresAt &&
      entry.roomEpoch === (this.roomEpochs.get(entry.roomId) ?? 0) &&
      entry.connectionState === 'connected'
    )
  }

  attachUplink(roomId: string, uplink: PlayerUplink) {
    this.uplinks.set(roomId, uplink)
  }

  detachUplink(roomId: string, uplink: PlayerUplink) {
    if (this.uplinks.get(roomId) === uplink) {
      this.uplinks.delete(roomId)
    }
  }

  private receiveUplink(entry: Entry, payload: Buffer) {
    const sink = this.uplinks.get(entry.roomId)
    if (!entry.uplink || !sink || sink.hostId !== entry.nickname || !this.live(entry)) {
      return
    }
    let pcm: Buffer
    try {
      pcm = entry.uplink.decoder.decode(payload)
    } catch {
      // A corrupt or empty packet is dropped without closing the host peer.
      return
    }
    sink.receive(entry.uplink.id, entry.nickname, pcm)
  }

  /** Liveness of each peer is enforced by the shards' delivery membership. */
  publish(roomId: string, payload: Buffer, durationMs = 20) {
    if (this.rooms.has(roomId)) {
      this.shards.publish(roomId, payload, durationMs)
    }
  }

  async closeRoom(roomId: string) {
    this.roomEpochs.set(roomId, (this.roomEpochs.get(roomId) ?? 0) + 1)
    await Promise.all(
      [...(this.rooms.get(roomId) ?? [])].map((entry) => this.close(entry)),
    )
  }

  private async sweep() {
    const registered = [...this.entries.values()].filter((entry) => entry.registered)
    if (!registered.length) {
      return
    }
    let authorized: Set<string>
    try {
      authorized = await authorizedMediaConnections(
        this.db,
        registered.map((entry) => entry.id),
        this.ownerId,
      )
      this.sweepFailures = 0
    } catch {
      // A storage failure is not proof of authorization. After repeated failures
      // close every peer. Failed acknowledgement remains in storage and is retried.
      this.sweepFailures += 1
      if (this.sweepFailures >= MAX_SWEEP_FAILURES) {
        await Promise.allSettled(registered.map((entry) => this.close(entry)))
      }
      return
    }
    await Promise.allSettled(
      registered.map(async (entry) => {
        if (
          entry.closing ||
          Date.now() >= entry.expiresAt ||
          !authorized.has(entry.id)
        ) {
          await this.close(entry)
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
    await this.shards.stop()
  }
}
