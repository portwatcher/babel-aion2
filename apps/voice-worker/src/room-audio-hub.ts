import type { AudioRelayEvent } from '@babel/contracts'
import type { PacketDuration } from './room-audio.ts'

export interface AudioRelaySink {
  send(line: string): boolean
  close(): void
}

interface RoomChannel {
  generation: number
  subscribers: Set<AudioRelaySink>
}

/**
 * Publishes already-encoded room Opus packets to peer voice-worker replicas so
 * receive-only WebRTC listeners can scale horizontally across replicas while
 * keeping one exclusive source receiver, mixer, encoder and subtitle pipeline.
 */
export class RoomAudioHub {
  private readonly rooms = new Map<string, RoomChannel>()
  private closed = false

  openRoom(roomId: string, sourceGeneration: number) {
    if (this.closed) {
      return
    }
    const existing = this.rooms.get(roomId)
    if (existing) {
      if (existing.generation === sourceGeneration) {
        return
      }
      this.closeChannel(roomId, existing)
    }
    this.rooms.set(roomId, { generation: sourceGeneration, subscribers: new Set() })
  }

  publish(
    roomId: string,
    sourceGeneration: number,
    packet: Buffer,
    durationMs: PacketDuration,
  ) {
    const channel = this.rooms.get(roomId)
    if (
      this.closed ||
      !channel ||
      channel.generation !== sourceGeneration ||
      !channel.subscribers.size
    ) {
      return
    }
    const event: AudioRelayEvent = {
      type: 'frame',
      durationMs,
      payload: packet.toString('base64'),
    }
    const line = JSON.stringify(event) + '\n'
    for (const subscriber of [...channel.subscribers]) {
      if (!subscriber.send(line)) {
        channel.subscribers.delete(subscriber)
        subscriber.close()
      }
    }
  }

  subscribe(roomId: string, sink: AudioRelaySink) {
    const channel = this.rooms.get(roomId)
    if (this.closed || !channel) {
      return null
    }
    const start: AudioRelayEvent = {
      type: 'start',
      roomId,
      sourceGeneration: channel.generation,
    }
    if (!sink.send(JSON.stringify(start) + '\n')) {
      sink.close()
      return null
    }
    channel.subscribers.add(sink)
    return () => {
      channel.subscribers.delete(sink)
    }
  }

  closeRoom(roomId: string, sourceGeneration?: number) {
    const channel = this.rooms.get(roomId)
    if (
      !channel ||
      (sourceGeneration !== undefined && channel.generation !== sourceGeneration)
    ) {
      return
    }
    this.closeChannel(roomId, channel)
  }

  close() {
    this.closed = true
    for (const [roomId, channel] of [...this.rooms]) {
      this.closeChannel(roomId, channel)
    }
  }

  private closeChannel(roomId: string, channel: RoomChannel) {
    if (this.rooms.get(roomId) === channel) {
      this.rooms.delete(roomId)
    }
    for (const subscriber of [...channel.subscribers]) {
      channel.subscribers.delete(subscriber)
      subscriber.close()
    }
  }
}
