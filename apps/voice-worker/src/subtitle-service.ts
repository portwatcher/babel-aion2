import { performance } from 'node:perf_hooks'
import type {
  ListenerSnapshot,
  SubtitleMessage,
  SubtitleSubscription,
} from '@babel/contracts'
import type { Database } from '@babel/database'
import type { CredentialCipher } from '@babel/database/credentials'
import {
  authorizedSubtitleListeners,
  readRoomSources,
  readSubtitleListener,
  readSubtitlePaths,
  type SubtitlePathStamp,
} from '@babel/database/subtitles'
import { babelTracer, parentContext, traceparent } from '@babel/telemetry'
import { RoomSubtitles } from './room-subtitles.ts'
import type { RunningSubtitlePath, SubtitleConsumer } from './speaker-subtitles.ts'

interface Delivery {
  message: SubtitleMessage
  queuedAt: number
  stamp?: SubtitlePathStamp
  current?: () => boolean
}
interface Consumer extends SubtitleConsumer {
  input: SubtitleSubscription
  listener: ListenerSnapshot
  queue: Delivery[]
  sending: boolean
  closed: boolean
  state: string
  // Start of the latest successful authorization that included this consumer.
  authorizedAt: number
  sink: { send(event: SubtitleMessage): boolean; close(): void }
}

export class SubtitleDeliveryError extends Error {}

// Authorization and path snapshots are refreshed every 500 ms. A delivery is only
// sent while its listener and path were confirmed within this window.
const VALIDITY_MS = 1_500
// Consecutive storage failures tolerated before subscribers are disconnected.
// Delivery already stops once VALIDITY_MS lapses.
const MAX_REFRESH_FAILURES = 3

/** Ephemeral delivery only. No subtitle history or raw audio is persisted. */
export class SubtitleService {
  private readonly rooms = new Map<string, RoomSubtitles>()
  private readonly consumers = new Map<string, Consumer>()
  private paths = new Map<string, RunningSubtitlePath>()
  private pathVersion = 0
  private validUntil = 0
  private roomSources = new Map<string, number>()
  private readonly roomReads = new Map<string, Promise<void>>()
  private failures = 0
  private readonly timer: ReturnType<typeof setInterval>
  private checking: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher | null,
  ) {
    this.timer = setInterval(() => this.check(), 500)
    this.timer.unref()
    this.check()
  }

  async ready() {
    if (!this.cipher || this.stopped) {
      return false
    }
    await readSubtitlePaths(this.db, this.cipher)
    return true
  }

  source(roomId: string, generation: number, allowed: () => boolean) {
    this.retire(roomId)
    const room = new RoomSubtitles(
      roomId,
      generation,
      () => !this.stopped && performance.now() < this.validUntil && allowed(),
    )
    this.rooms.set(roomId, room)
    this.reconcileRooms()
    return {
      receive: (id: string, name: string, pcm: Buffer) => room.receive(id, name, pcm),
      remove: (id: string) => room.remove(id),
      close: () => {
        if (this.rooms.get(roomId) === room) {
          this.retire(roomId)
        }
      },
    }
  }

  private retire(roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    room.close()
    this.rooms.delete(roomId)
    for (const consumer of this.consumers.values()) {
      if (consumer.listener.roomId !== roomId) {
        continue
      }
      this.state(consumer, 'STOPPED', room.sourceGeneration)
    }
  }

  async subscribe(input: SubtitleSubscription, sink: Consumer['sink']) {
    const checkedAt = performance.now()
    const listener = await readSubtitleListener(this.db, input)
    if (this.stopped || !listener?.outputLanguage) {
      throw new SubtitleDeliveryError('Listener unavailable')
    }
    const previous = this.consumers.get(input.connectionId)
    if (previous) {
      this.close(previous)
    }
    const consumer: Consumer = {
      id: input.connectionId,
      input,
      listener,
      outputLanguage: listener.outputLanguage,
      sink,
      queue: [],
      sending: false,
      closed: false,
      state: '',
      authorizedAt: checkedAt,
      deliver: (message, stamp, current) =>
        this.enqueue(consumer, { message, stamp, current, queuedAt: Date.now() }),
    }
    this.consumers.set(consumer.id, consumer)
    this.reconcileRooms()
    return () => this.close(consumer)
  }

  private state(
    consumer: Consumer,
    state: 'WAITING' | 'STOPPED' | 'UNAVAILABLE',
    generation: number,
    failure: 'INVALID_CONFIGURATION' | 'UNAVAILABLE' | null = null,
  ) {
    const key = `${state}:${generation}:${failure}`
    if (consumer.state === key) {
      return
    }
    consumer.state = key
    consumer.deliver({
      type: 'subtitle-state',
      roomId: consumer.listener.roomId,
      sourceGeneration: generation,
      speakerId: null,
      streamGeneration: 0,
      outputLanguage: consumer.outputLanguage,
      state,
      failure,
    })
  }

  private enqueue(consumer: Consumer, event: Delivery) {
    if (consumer.closed) {
      return
    }
    // Replace an unsent revision of the same display window immediately. This
    // bounds slow-client work without a debounce.
    if (event.message.type === 'subtitle') {
      const incoming = event.message.value
      consumer.queue = consumer.queue.filter((pending) => {
        if (pending.message.type !== 'subtitle') {
          return true
        }
        const previous = pending.message.value
        const kept =
          previous.speakerId !== incoming.speakerId ||
          previous.streamGeneration !== incoming.streamGeneration ||
          previous.configurationVersion !== incoming.configurationVersion ||
          previous.sequence > incoming.sequence
        if (!kept && previous.latency && !incoming.latency) {
          // The replacement is what the listener sees first; keep measuring it.
          event = {
            ...event,
            queuedAt: pending.queuedAt,
            message: {
              type: 'subtitle',
              value: { ...incoming, latency: previous.latency },
            },
          }
        }
        return kept
      })
    }
    if (consumer.queue.length >= 16) {
      this.close(consumer)
      return
    }
    consumer.queue.push(event)
    if (!consumer.sending) {
      consumer.sending = true
      void this.drain(consumer)
        .catch(() => this.close(consumer))
        .finally(() => {
          consumer.sending = false
        })
    }
  }

  private async drain(consumer: Consumer) {
    while (!consumer.closed && consumer.queue.length) {
      const event = consumer.queue.shift()
      if (!event || event.current?.() === false) {
        continue
      }
      // Fail closed: without a recent confirmation the event is dropped.
      if (performance.now() - consumer.authorizedAt >= VALIDITY_MS) {
        continue
      }
      if (event.message.type === 'subtitle') {
        const value = event.message.value
        if (
          !event.stamp ||
          !(await this.pathCurrent(value.roomId, value.sourceGeneration, event.stamp))
        ) {
          continue
        }
        if (consumer.closed || event.current?.() === false) {
          continue
        }
      }
      if (!this.send(consumer, event)) {
        this.close(consumer)
        return
      }
    }
  }

  /** The room source and every revision of the language path are still current. */
  private async pathCurrent(
    roomId: string,
    generation: number,
    stamp: SubtitlePathStamp,
  ) {
    if (
      performance.now() >= this.validUntil ||
      this.paths.get(stamp.code)?.key !== JSON.stringify(stamp)
    ) {
      return false
    }
    const cached = this.roomSources.get(roomId)
    if (cached === undefined || cached < generation) {
      // A source started after the last snapshot: confirm it once, not per event.
      let read = this.roomReads.get(roomId)
      if (!read) {
        read = readRoomSources(this.db, [roomId])
          .then((sources) => {
            const current = sources.get(roomId)
            if (current === undefined) {
              this.roomSources.delete(roomId)
            } else {
              this.roomSources.set(roomId, current)
            }
          })
          .finally(() => this.roomReads.delete(roomId))
        this.roomReads.set(roomId, read)
      }
      await read
    }
    return this.roomSources.get(roomId) === generation
  }

  /** Queue wait is part of speech-to-screen time. */
  private send(consumer: Consumer, event: Delivery) {
    const message = event.message
    if (message.type !== 'subtitle' || !message.value.latency) {
      return consumer.sink.send(message)
    }
    const latency = message.value.latency
    const span = babelTracer().startSpan(
      'babel.subtitle.worker_delivery',
      {
        startTime: event.queuedAt,
        attributes: { 'babel.output_language': message.value.outputLanguage },
      },
      parentContext(latency.traceparent),
    )
    const next = traceparent(span)
    const sent = consumer.sink.send({
      ...message,
      value: {
        ...message.value,
        latency: next ? { ...latency, traceparent: next } : latency,
      },
    })
    span.end()
    return sent
  }

  private close(consumer: Consumer) {
    if (consumer.closed) {
      return
    }
    consumer.closed = true
    consumer.queue = []
    if (this.consumers.get(consumer.id) === consumer) {
      this.consumers.delete(consumer.id)
    }
    consumer.sink.close()
    this.reconcileRooms()
  }

  private reconcileRooms() {
    for (const consumer of this.consumers.values()) {
      const room = this.rooms.get(consumer.listener.roomId)
      this.state(
        consumer,
        !room
          ? 'STOPPED'
          : this.paths.has(consumer.outputLanguage)
            ? 'WAITING'
            : 'UNAVAILABLE',
        room?.sourceGeneration ?? 0,
        room && !this.paths.has(consumer.outputLanguage)
          ? 'INVALID_CONFIGURATION'
          : null,
      )
    }
    const members = new Map<string, Consumer[]>()
    for (const consumer of this.consumers.values()) {
      const group = members.get(consumer.listener.roomId)
      if (group) {
        group.push(consumer)
      } else {
        members.set(consumer.listener.roomId, [consumer])
      }
    }
    for (const room of this.rooms.values()) {
      room.reconcile(members.get(room.roomId) ?? [], this.paths)
    }
  }

  private check() {
    if (this.stopped || this.checking) {
      return
    }
    this.checking = this.refresh()
      .then(() => {
        this.failures = 0
      })
      .catch(() => {
        this.failures += 1
        if (this.failures < MAX_REFRESH_FAILURES) {
          return
        }
        this.validUntil = 0
        for (const consumer of [...this.consumers.values()]) {
          this.close(consumer)
        }
      })
      .finally(() => {
        this.checking = null
      })
  }

  private async refresh() {
    const startedAt = performance.now()
    const consumers = [...this.consumers.values()]
    const [saved, authorized, sources] = await Promise.all([
      this.cipher ? readSubtitlePaths(this.db, this.cipher) : [],
      authorizedSubtitleListeners(
        this.db,
        consumers.map((consumer) => consumer.input),
      ),
      readRoomSources(this.db, [...this.rooms.keys()]),
    ])
    if (this.stopped) {
      return
    }
    const paths = new Map<string, RunningSubtitlePath>()
    for (const path of saved) {
      const key = JSON.stringify(path.stamp)
      const previous = this.paths.get(path.stamp.code)
      paths.set(path.stamp.code, {
        ...path,
        key,
        group: JSON.stringify([
          path.stamp.recognitionId,
          path.stamp.recognitionVersion,
          path.stamp.terminologyVersion,
        ]),
        version: previous?.key === key ? previous.version : ++this.pathVersion,
      })
    }
    this.paths = paths
    this.roomSources = sources
    this.validUntil = startedAt + VALIDITY_MS
    for (const consumer of consumers) {
      if (authorized.has(consumer.id)) {
        consumer.authorizedAt = Math.max(consumer.authorizedAt, startedAt)
      } else {
        this.close(consumer)
      }
    }
    this.reconcileRooms()
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    await this.checking
    for (const id of this.rooms.keys()) {
      this.retire(id)
    }
    for (const consumer of [...this.consumers.values()]) {
      this.close(consumer)
    }
  }
}
