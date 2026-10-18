import { performance } from 'node:perf_hooks'
import type {
  ListenerSnapshot,
  SubtitleMessage,
  SubtitleSubscription,
} from '@babel/contracts'
import type { Database } from '@babel/database'
import type { CredentialCipher } from '@babel/database/credentials'
import {
  readSubtitleListener,
  readSubtitlePaths,
  subtitlePathCurrent,
  type SubtitlePathStamp,
} from '@babel/database/subtitles'
import { RoomSubtitles } from './room-subtitles.ts'
import type { RunningSubtitlePath, SubtitleConsumer } from './speaker-subtitles.ts'

interface Delivery {
  message: SubtitleMessage
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
  sink: { send(event: SubtitleMessage): boolean; close(): void }
}

export class SubtitleDeliveryError extends Error {}

/** Ephemeral delivery only. No subtitle history or raw audio is persisted. */
export class SubtitleService {
  private readonly rooms = new Map<string, RoomSubtitles>()
  private readonly consumers = new Map<string, Consumer>()
  private paths = new Map<string, RunningSubtitlePath>()
  private pathVersion = 0
  private validUntil = 0
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
      deliver: (message, stamp, current) =>
        this.enqueue(consumer, { message, stamp, current }),
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
      if (!(await readSubtitleListener(this.db, consumer.input))) {
        this.close(consumer)
        return
      }
      if (event.message.type === 'subtitle') {
        const value = event.message.value
        if (
          !event.stamp ||
          !(await subtitlePathCurrent(
            this.db,
            value.roomId,
            value.sourceGeneration,
            event.stamp,
          ))
        ) {
          continue
        }
      }
      if (consumer.closed || event.current?.() === false) {
        continue
      }
      if (!consumer.sink.send(event.message)) {
        this.close(consumer)
        return
      }
    }
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
    for (const room of this.rooms.values()) {
      room.reconcile(
        [...this.consumers.values()].filter(
          (consumer) => consumer.listener.roomId === room.roomId,
        ),
        this.paths,
      )
    }
  }

  private check() {
    if (this.stopped || this.checking) {
      return
    }
    this.checking = this.refresh()
      .catch(() => {
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
    const saved = this.cipher ? await readSubtitlePaths(this.db, this.cipher) : []
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
    this.validUntil = performance.now() + 1_500
    await Promise.all(
      [...this.consumers.values()].map(async (consumer) => {
        if (!(await readSubtitleListener(this.db, consumer.input))) {
          this.close(consumer)
        }
      }),
    )
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
