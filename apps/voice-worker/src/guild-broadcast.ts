import type { VoiceSourceConfiguration } from '@babel/database/voice-sources'
import { RoomAudio, type PacketDuration } from './room-audio.ts'
import type { MediaPeers } from './media-peers.ts'
import type { SubtitleService } from './subtitle-service.ts'

interface Destination {
  generation: number
  subtitles: ReturnType<SubtitleService['source']>
}

/** One Discord PCM timeline and Opus encoder, with independent room delivery. */
export class GuildBroadcast {
  private readonly destinations = new Map<string, Destination>()
  private readonly audio: RoomAudio
  private closed = false
  private readonly pendingClosures = new Set<string>()

  constructor(
    private readonly allowed: () => boolean,
    private readonly peers: Pick<MediaPeers, 'publish' | 'closeRoom'>,
    private readonly subtitles: Pick<SubtitleService, 'source'>,
    failed: () => void,
    packetMs: PacketDuration = 20,
  ) {
    this.audio = new RoomAudio(
      allowed,
      (packet, durationMs) => {
        for (const roomId of this.destinations.keys()) {
          this.peers.publish(roomId, packet, durationMs)
        }
      },
      failed,
      packetMs,
    )
  }

  async reconcile(rooms: VoiceSourceConfiguration[]) {
    const active = new Map(
      rooms.filter((room) => !room.stopped).map((room) => [room.id, room]),
    )
    for (const [roomId, destination] of this.destinations) {
      if (active.get(roomId)?.sourceGeneration === destination.generation) {
        continue
      }
      this.destinations.delete(roomId)
      destination.subtitles.close()
      this.pendingClosures.add(roomId)
    }
    await this.closeRetired()
    if (this.closed) {
      return
    }
    for (const configuration of active.values()) {
      const roomId = configuration.id
      if (this.destinations.has(roomId)) {
        continue
      }
      const permitted = () =>
        !this.closed && this.allowed() && this.destinations.get(roomId) === destination
      const destination: Destination = {
        generation: configuration.sourceGeneration,
        subtitles: this.subtitles.source(
          roomId,
          configuration.sourceGeneration,
          permitted,
        ),
      }
      this.destinations.set(roomId, destination)
    }
  }

  receive(id: string, name: string, pcm: Buffer) {
    if (this.closed || !this.allowed()) {
      return
    }
    this.audio.receive(id, pcm)
    for (const destination of this.destinations.values()) {
      destination.subtitles.receive(id, name, pcm)
    }
  }

  remove(id: string) {
    this.audio.remove(id)
    for (const destination of this.destinations.values()) {
      destination.subtitles.remove(id)
    }
  }

  private async closeRetired() {
    await Promise.all(
      [...this.pendingClosures].map(async (roomId) => {
        await this.peers.closeRoom(roomId)
        this.pendingClosures.delete(roomId)
      }),
    )
  }

  async close() {
    this.closed = true
    this.audio.close()
    for (const [roomId, destination] of this.destinations) {
      destination.subtitles.close()
      this.pendingClosures.add(roomId)
    }
    this.destinations.clear()
    await this.closeRetired()
  }
}
