import { Worker } from 'node:worker_threads'
import type { PeerConfig } from 'werift'
import {
  PeerShard,
  type ShardCall,
  type ShardEvent,
  type ShardRequest,
} from './media-shard.ts'

/** Peer events delivered back to the owning MediaPeers instance. */
export interface ShardEvents {
  state(id: string, state: string): void
  uplink(id: string, payload: Buffer): void
  failed(id: string): void
}

interface Channel {
  post(request: ShardRequest): void
  stop(): Promise<void>
}

class Shard {
  peers = 0
  private sequence = 0
  private readonly pending = new Map<
    number,
    (event: Extract<ShardEvent, { op: 'reply' }> | null) => void
  >()
  readonly channel: Channel

  constructor(create: (receive: (event: ShardEvent) => void) => Channel) {
    this.channel = create((event) => {
      if (event.op === 'reply') {
        this.pending.get(event.seq)?.(event)
        this.pending.delete(event.seq)
      }
    })
  }

  request(call: ShardCall) {
    const seq = ++this.sequence
    return new Promise<Extract<ShardEvent, { op: 'reply' }> | null>((resolve) => {
      this.pending.set(seq, resolve)
      this.channel.post({ ...call, seq })
    })
  }

  /** The shard is gone: its peers and sockets stopped with it. */
  abandon() {
    for (const resolve of this.pending.values()) {
      resolve(null)
    }
    this.pending.clear()
  }
}

export class MediaShardError extends Error {}

/**
 * WebRTC peers spread over worker threads, so SRTP and socket work for many
 * listeners uses more than one CPU core. `threads: 0` keeps peers in-process.
 */
export class MediaShards {
  private readonly shards: Shard[] = []
  private readonly owners = new Map<string, Shard>()
  private stopping = false

  constructor(threads: number, events: ShardEvents, failed: () => void) {
    const dispatch = (event: ShardEvent) => {
      if (event.op === 'state') {
        events.state(event.id, event.state)
      } else if (event.op === 'uplink') {
        events.uplink(
          event.id,
          Buffer.from(
            event.payload.buffer,
            event.payload.byteOffset,
            event.payload.byteLength,
          ),
        )
      } else if (event.op === 'failed') {
        events.failed(event.id)
      }
    }
    if (threads === 0) {
      this.shards.push(
        new Shard((receive) => {
          const shard = new PeerShard((event) => {
            // Asynchronous like a thread boundary, but preserving order.
            queueMicrotask(() => {
              receive(event)
              dispatch(event)
            })
          })
          return { post: (request) => shard.handle(request), stop: () => shard.stop() }
        }),
      )
      return
    }
    const script = new URL(
      import.meta.url.endsWith('.ts') ? './media-shard.ts' : './media-shard.mjs',
      import.meta.url,
    )
    for (let index = 0; index < threads; index += 1) {
      const shard: Shard = new Shard((receive) => {
        const worker = new Worker(script)
        let stopped = false
        worker.on('message', (event: ShardEvent) => {
          receive(event)
          dispatch(event)
        })
        const lost = () => {
          if (!stopped && !this.stopping) {
            shard.abandon()
            failed()
          }
        }
        worker.on('error', lost)
        worker.on('exit', lost)
        return {
          post: (request) => worker.postMessage(request),
          stop: async () => {
            stopped = true
            await worker.terminate()
          },
        }
      })
      this.shards.push(shard)
    }
  }

  /** Places a new peer on the least loaded shard and returns its offer. */
  async create(id: string, config: Partial<PeerConfig>, uplink: boolean) {
    if (this.stopping) {
      throw new MediaShardError('Stopping')
    }
    const shard = this.shards.reduce((least, candidate) =>
      candidate.peers < least.peers ? candidate : least,
    )
    shard.peers += 1
    this.owners.set(id, shard)
    const reply = await shard.request({ op: 'create', id, config, uplink })
    if (!reply?.ok || !reply.offer) {
      throw new MediaShardError('Offer unavailable')
    }
    return reply.offer
  }

  async answer(id: string, sdp: string) {
    const reply = await this.owners.get(id)?.request({ op: 'answer', id, sdp })
    if (!reply?.ok) {
      throw new MediaShardError('Answer rejected')
    }
  }

  /** Resolves once the peer has actually stopped (or its shard no longer exists). */
  async close(id: string) {
    const shard = this.owners.get(id)
    if (!shard) {
      return
    }
    const reply = await shard.request({ op: 'close', id })
    if (reply && !reply.ok) {
      throw new MediaShardError('Close unconfirmed')
    }
    if (this.owners.get(id) === shard) {
      this.owners.delete(id)
      shard.peers -= 1
    }
  }

  withhold(id: string) {
    this.owners.get(id)?.channel.post({ op: 'withhold', id })
  }

  deliver(id: string, roomId: string, until: number) {
    this.owners.get(id)?.channel.post({ op: 'deliver', id, roomId, until })
  }

  /** One encoded packet per shard; each shard writes it to its room members. */
  publish(roomId: string, payload: Buffer, durationMs: number) {
    for (const shard of this.shards) {
      if (shard.peers) {
        shard.channel.post({ op: 'publish', roomId, payload, durationMs })
      }
    }
  }

  async stop() {
    this.stopping = true
    await Promise.allSettled(this.shards.map((shard) => shard.channel.stop()))
    for (const shard of this.shards) {
      shard.abandon()
    }
  }
}
