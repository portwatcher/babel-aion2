import { audioRelayEventSchema } from '@babel/contracts'
import type { Database } from '@babel/database'
import { readRoomVoiceOwner } from '@babel/database/voice-sources'
import type { MediaPeers } from './media-peers.ts'

interface RelaySubscription {
  key: string
  ownerId: string
  generation: number
  controlUrl: string
  controller: AbortController
  retry: ReturnType<typeof setTimeout> | undefined
  attempts: number
  epoch: number
}

/**
 * Pulls encoded Opus frames from whichever peer voice-worker owns a room's
 * exclusive voice source, only while this worker actually has receive-only
 * listeners in that room.
 */
export class RemoteRoomAudio {
  private readonly relays = new Map<string, RelaySubscription>()
  private readonly runs = new Map<string, string>()
  private readonly timer: ReturnType<typeof setInterval>
  private reconciling: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly db: Database,
    private readonly secret: string,
    private readonly ownerId: string,
    private readonly peers: Pick<
      MediaPeers,
      'activeSendingRooms' | 'publish' | 'closeRoom'
    >,
    private readonly ownsLocally: (roomId: string) => boolean,
  ) {
    this.timer = setInterval(() => this.check(), 500)
    this.timer.unref()
  }

  private check() {
    if (this.stopped || this.reconciling) {
      return
    }
    this.reconciling = this.reconcile()
      .catch(() => {})
      .finally(() => {
        this.reconciling = null
      })
  }

  private async reconcile() {
    const wanted = new Set<string>()
    for (const roomId of this.peers.activeSendingRooms()) {
      if (!this.ownsLocally(roomId)) {
        wanted.add(roomId)
      }
    }
    for (const roomId of [...this.relays.keys()]) {
      if (!wanted.has(roomId)) {
        this.stopRoom(roomId)
      }
    }
    for (const roomId of [...this.runs.keys()]) {
      if (!wanted.has(roomId)) {
        this.runs.delete(roomId)
      }
    }
    if (!wanted.size || this.stopped) {
      return
    }
    await Promise.allSettled([...wanted].map((roomId) => this.syncRoom(roomId)))
  }

  private async syncRoom(roomId: string) {
    const owner = await readRoomVoiceOwner(this.db, roomId)
    if (this.stopped || this.ownsLocally(roomId)) {
      this.stopRoom(roomId)
      return
    }
    if (!owner || owner.ownerId === this.ownerId || !owner.controlUrl) {
      const prior = this.runs.get(roomId)
      this.stopRoom(roomId)
      if (!owner && prior !== undefined) {
        this.runs.delete(roomId)
        await this.peers.closeRoom(roomId)
      }
      return
    }
    const previousRun = this.runs.get(roomId)
    if (previousRun !== undefined && owner.runId !== previousRun) {
      this.stopRoom(roomId)
      this.runs.set(roomId, owner.runId)
      await this.peers.closeRoom(roomId)
      return
    }
    this.runs.set(roomId, owner.runId)
    const key = `${owner.runId}:${owner.ownerId}:${owner.sourceGeneration}:${owner.controlUrl}`
    const existing = this.relays.get(roomId)
    if (existing?.key === key) {
      return
    }
    this.stopRoom(roomId)
    const subscription: RelaySubscription = {
      key,
      ownerId: owner.ownerId,
      generation: owner.sourceGeneration,
      controlUrl: owner.controlUrl,
      controller: new AbortController(),
      retry: undefined,
      attempts: 0,
      epoch: 0,
    }
    this.relays.set(roomId, subscription)
    void this.connect(roomId, subscription)
  }

  private async connect(roomId: string, subscription: RelaySubscription) {
    if (this.stopped || this.relays.get(roomId) !== subscription) {
      return
    }
    const active = ++subscription.epoch
    const cancellation = new AbortController()
    subscription.controller = cancellation
    let deadline = setTimeout(() => cancellation.abort(), 5_000)
    try {
      const destination = new URL('/relay/audio', subscription.controlUrl)
      if (!['http:', 'https:'].includes(destination.protocol)) {
        throw new Error('Invalid relay destination')
      }
      const response = await fetch(destination, {
        method: 'POST',
        redirect: 'error',
        signal: cancellation.signal,
        headers: {
          authorization: `Bearer ${this.secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ roomId }),
      })
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.startsWith('application/x-ndjson')
      ) {
        throw new Error('Relay unavailable')
      }
      subscription.attempts = 0
      const decoder = new TextDecoder()
      let pending = ''
      let started = false
      clearTimeout(deadline)
      deadline = setTimeout(() => cancellation.abort(), 15_000)
      for await (const chunk of response.body) {
        if (
          this.stopped ||
          this.relays.get(roomId) !== subscription ||
          subscription.epoch !== active
        ) {
          break
        }
        clearTimeout(deadline)
        deadline = setTimeout(() => cancellation.abort(), 15_000)
        pending += decoder.decode(chunk, { stream: true })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (!line) {
            continue
          }
          if (Buffer.byteLength(line) > 64 * 1024) {
            throw new Error('Frame too large')
          }
          const event = audioRelayEventSchema.parse(JSON.parse(line))
          if (event.type === 'start') {
            if (
              event.roomId !== roomId ||
              event.sourceGeneration !== subscription.generation
            ) {
              throw new Error('Wrong relay stream')
            }
            started = true
            continue
          }
          if (!started) {
            throw new Error('Missing relay start')
          }
          this.peers.publish(
            roomId,
            Buffer.from(event.payload, 'base64'),
            event.durationMs,
          )
        }
        if (Buffer.byteLength(pending) > 64 * 1024) {
          throw new Error('Frame too large')
        }
      }
    } catch {
      /* Transient owner restart or network hiccup; retry below while still needed. */
    } finally {
      clearTimeout(deadline)
      cancellation.abort()
      if (
        !this.stopped &&
        this.relays.get(roomId) === subscription &&
        subscription.epoch === active
      ) {
        const delayMs = Math.min(2_000, 250 * 2 ** Math.min(subscription.attempts++, 3))
        subscription.retry = setTimeout(() => {
          void this.connect(roomId, subscription)
        }, delayMs)
        subscription.retry.unref()
      }
    }
  }

  private stopRoom(roomId: string) {
    const subscription = this.relays.get(roomId)
    if (!subscription) {
      return
    }
    subscription.epoch += 1
    clearTimeout(subscription.retry)
    subscription.controller.abort()
    this.relays.delete(roomId)
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    for (const roomId of [...this.relays.keys()]) {
      this.stopRoom(roomId)
    }
    this.runs.clear()
    await this.reconciling
  }
}
